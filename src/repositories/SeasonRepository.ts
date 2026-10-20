import { Prisma } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";

const summary = { id: true, name: true, status: true, candidaturesCloseAt: true, finalNightAt: true } as const;
const full = {
    ...summary,
    description: true,
    categories: { select: { id: true, name: true, description: true }, orderBy: { id: "asc" } },
    awards: { select: { award: { select: { id: true, name: true, question: true } } }, orderBy: { awardId: "asc" } },
    participants: { select: { userId: true, categoryId: true, user: { select: { username: true, avatarUrl: true } } }, orderBy: { id: "asc" } },
} satisfies Prisma.SeasonSelect;

export type SeasonRow = Prisma.SeasonGetPayload<{ select: typeof full }>;

@Service()
export class SeasonRepository {
    private get db() {
        return getPrismaClient();
    }

    list(cineforumId: number) {
        return this.db.season.findMany({ where: { cineforumId }, select: summary, orderBy: { createdAt: "desc" } });
    }

    /** Una rassegna di un altro cineforum non esiste: null. */
    findInCineforum(id: number, cineforumId: number) {
        return this.db.season.findFirst({ where: { id, cineforumId } });
    }

    findFull(id: number): Promise<SeasonRow> {
        return this.db.season.findUniqueOrThrow({ where: { id }, select: full });
    }

    /** Quanti degli id passati appartengono al cineforum. */
    countCategories(ids: number[], cineforumId: number) {
        return this.db.category.count({ where: { id: { in: ids }, cineforumId } });
    }

    countAwards(ids: number[], cineforumId: number) {
        return this.db.award.count({ where: { id: { in: ids }, cineforumId } });
    }

    countMembers(userIds: number[], cineforumId: number) {
        return this.db.membership.count({ where: { userId: { in: userIds }, cineforumId } });
    }

    create(cineforumId: number, d: { name: string; description?: string; candidaturesCloseAt: Date; finalNightAt?: Date; categoryIds: number[]; awardIds: number[]; participantUserIds: number[] }) {
        return this.db.season.create({
            data: {
                cineforumId,
                name: d.name,
                description: d.description,
                candidaturesCloseAt: d.candidaturesCloseAt,
                finalNightAt: d.finalNightAt,
                categories: { connect: d.categoryIds.map(id => ({ id })) },
                awards: { create: d.awardIds.map(awardId => ({ awardId })) },
                participants: { create: d.participantUserIds.map(userId => ({ userId })) },
            },
            select: { id: true },
        });
    }

    /** Solo i campi presenti in `d` cambiano; liste (categorie, premi, partecipanti) sono sostituite per intero. */
    update(id: number, d: { name?: string; description?: string; candidaturesCloseAt?: Date; finalNightAt?: Date; categoryIds?: number[]; awardIds?: number[]; participantUserIds?: number[] }) {
        return this.db.season.update({
            where: { id },
            data: {
                name: d.name,
                description: d.description,
                candidaturesCloseAt: d.candidaturesCloseAt,
                finalNightAt: d.finalNightAt,
                categories: d.categoryIds && { set: d.categoryIds.map(c => ({ id: c })) },
                awards: d.awardIds && { deleteMany: {}, create: d.awardIds.map(awardId => ({ awardId })) },
                participants: d.participantUserIds && { deleteMany: {}, create: d.participantUserIds.map(userId => ({ userId })) },
            },
            select: { id: true },
        });
    }

    /** Transizione DRAFT → OPEN con assegnazione delle categorie; false se non era più in bozza. */
    launch(id: number, assignments: { userId: number; categoryId: number }[]) {
        return this.db.$transaction(async tx => {
            const { count } = await tx.season.updateMany({ where: { id, status: "DRAFT" }, data: { status: "OPEN" } });
            if (count === 0) return false;
            for (const a of assignments) {
                await tx.participant.update({ where: { seasonId_userId: { seasonId: id, userId: a.userId } }, data: { categoryId: a.categoryId } });
            }
            return true;
        });
    }

    participantsWithEmail(seasonId: number) {
        return this.db.participant.findMany({
            where: { seasonId },
            select: { user: { select: { email: true } }, category: { select: { name: true } } },
        });
    }

    findParticipant(seasonId: number, userId: number) {
        return this.db.participant.findUnique({ where: { seasonId_userId: { seasonId, userId } } });
    }
}
