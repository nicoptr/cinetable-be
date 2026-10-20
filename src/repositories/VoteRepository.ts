import { Prisma } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";

type Db = Prisma.TransactionClient;

@Service()
export class VoteRepository {
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
        return getPrismaClient().$transaction(fn);
    }

    seasonAwardIds(seasonId: number): Promise<number[]> {
        return getPrismaClient().seasonAward.findMany({ where: { seasonId }, select: { awardId: true } }).then(r => r.map(a => a.awardId));
    }

    hasVoted(tx: Db, candidatureId: number, participantId: number) {
        return tx.vote.findFirst({ where: { candidatureId, participantId }, select: { id: true } }).then(Boolean);
    }

    createMany(tx: Db, candidatureId: number, participantId: number, votes: { awardId: number; value: number }[]) {
        return tx.vote.createMany({ data: votes.map(v => ({ ...v, candidatureId, participantId })) });
    }

    mine(candidatureId: number, participantId: number) {
        return getPrismaClient().vote.findMany({ where: { candidatureId, participantId }, select: { awardId: true, value: true }, orderBy: { awardId: "asc" } });
    }

    /** Condizionato a `votingOpenedAt: null`: true solo per chi lo apre davvero. */
    async openVoting(id: number): Promise<boolean> {
        const { count } = await getPrismaClient().candidature.updateMany({ where: { id, votingOpenedAt: null }, data: { votingOpenedAt: new Date() } });
        return count === 1;
    }

    /** Email dei partecipanti (proponente escluso); `missing`: solo chi non ha ancora votato. */
    recipients(seasonId: number, candidatureId: number, proposerId: number, missing: boolean) {
        return getPrismaClient().participant.findMany({
            where: { seasonId, id: { not: proposerId }, ...(missing && { votes: { none: { candidatureId } } }) },
            select: { user: { select: { email: true } } },
        });
    }
}
