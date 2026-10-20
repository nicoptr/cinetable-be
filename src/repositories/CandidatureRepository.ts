import { Prisma, Season } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";

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
}
