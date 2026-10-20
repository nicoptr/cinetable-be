import { Prisma, Season } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";
import { programSelect } from "@models/Candidature";

type Db = Prisma.TransactionClient;

@Service()
export class CandidatureRepository {
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
        return getPrismaClient().$transaction(fn);
    }

    /** Blocca la riga della rassegna fino al commit: le candidature della stessa rassegna passano una alla volta. */
    async lockSeason(tx: Db, seasonId: number): Promise<Pick<Season, "status" | "candidaturesCloseAt">> {
        const rows = await tx.$queryRaw<Pick<Season, "status" | "candidaturesCloseAt">[]>`SELECT status, "candidaturesCloseAt" FROM "Season" WHERE id = ${seasonId} FOR UPDATE`;
        return rows[0]!;
    }

    async isBanned(seasonId: number, tmdbId: number, db: Db = getPrismaClient()): Promise<boolean> {
        return !!(await db.bannedMovie.findUnique({ where: { seasonId_tmdbId: { seasonId, tmdbId } } }));
    }

    findValid(tx: Db, participantId: number) {
        return tx.candidature.findFirst({ where: { participantId, status: "VALID" } });
    }

    findValidByMovie(tx: Db, seasonId: number, tmdbId: number) {
        return tx.candidature.findMany({ where: { seasonId, tmdbId, status: "VALID" }, select: { id: true, participant: { select: { userId: true } } } });
    }

    setStatus(tx: Db, ids: number[], status: "WITHDRAWN" | "DUPLICATE") {
        return tx.candidature.updateMany({ where: { id: { in: ids } }, data: { status } });
    }

    create(tx: Db, d: { seasonId: number; participantId: number; tmdbId: number; status: "VALID" | "DUPLICATE" }) {
        return tx.candidature.create({ data: d });
    }

    ban(tx: Db, seasonId: number, tmdbId: number) {
        return tx.bannedMovie.create({ data: { seasonId, tmdbId } });
    }

    latest(participantId: number) {
        return getPrismaClient().candidature.findFirst({ where: { participantId }, orderBy: { id: "desc" }, include: { movie: true } });
    }

    /** Partecipanti con il numero (0 o 1) di candidature valide. */
    participantsProgress(seasonId: number) {
        return getPrismaClient().participant.findMany({
            where: { seasonId },
            select: { userId: true, user: { select: { username: true } }, _count: { select: { candidatures: { where: { status: "VALID" } } } } },
            orderBy: { id: "asc" },
        });
    }

    emailsOf(userIds: number[]) {
        return getPrismaClient().user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
    }

    countParticipants(tx: Db, seasonId: number) {
        return tx.participant.count({ where: { seasonId } });
    }

    validIds(tx: Db, seasonId: number) {
        return tx.candidature.findMany({ where: { seasonId, status: "VALID" }, select: { id: true } });
    }

    /** Fissa l'ordine di proiezione (1..n) e passa la rassegna in programmazione. */
    async startScreening(tx: Db, seasonId: number, orderedIds: number[]) {
        for (const [i, id] of orderedIds.entries()) await tx.candidature.update({ where: { id }, data: { projectionOrder: i + 1 } });
        await tx.season.update({ where: { id: seasonId }, data: { status: "SCREENING" } });
    }

    /** Un film svelato senza data o con la proiezione ancora da fare. */
    findPendingScreening(tx: Db, seasonId: number) {
        return tx.candidature.findFirst({
            where: { seasonId, status: "VALID", revealedAt: { not: null }, OR: [{ screeningAt: null }, { screeningAt: { gt: new Date() } }] },
            select: { id: true },
        });
    }

    findNextToReveal(tx: Db, seasonId: number) {
        return tx.candidature.findFirst({ where: { seasonId, status: "VALID", revealedAt: null }, orderBy: { projectionOrder: "asc" }, select: { id: true } });
    }

    /** Condizionato a `revealedAt: null`: true solo per chi lo svela davvero. */
    async reveal(tx: Db, id: number): Promise<boolean> {
        const { count } = await tx.candidature.updateMany({ where: { id, revealedAt: null }, data: { revealedAt: new Date() } });
        return count === 1;
    }

    findProgramRow(id: number) {
        return getPrismaClient().candidature.findUniqueOrThrow({ where: { id }, select: programSelect });
    }

    /** Per ordine di proiezione: un film non svelato o di un'altra rassegna non esiste, null. `id` resta interno. */
    findRevealed(seasonId: number, order: number) {
        return getPrismaClient().candidature.findFirst({
            where: { seasonId, projectionOrder: order, revealedAt: { not: null } },
            select: { id: true, screeningAt: true, votingOpenedAt: true, participantId: true, movie: { select: { title: true } } },
        });
    }

    planScreening(id: number, d: { screeningAt: Date; location: string }) {
        return getPrismaClient().candidature.update({ where: { id }, data: d, select: programSelect });
    }

    /** Partecipante con il numero (0 o 1) di candidature valide. */
    findParticipantProgress(tx: Db, seasonId: number, userId: number) {
        return tx.participant.findUnique({
            where: { seasonId_userId: { seasonId, userId } },
            select: { id: true, _count: { select: { candidatures: { where: { status: "VALID" } } } } },
        });
    }

    /** Le sue candidature DUPLICATE/WITHDRAWN se ne vanno in cascata. */
    deleteParticipant(tx: Db, id: number) {
        return tx.participant.delete({ where: { id } });
    }

    participantEmails(seasonId: number) {
        return getPrismaClient().participant.findMany({ where: { seasonId }, select: { user: { select: { email: true } } } });
    }
}
