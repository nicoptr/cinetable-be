import { Prisma } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { CandidatureRepository } from "@repositories/CandidatureRepository";
import { SeasonService } from "@services/SeasonService";
import { AwardResult, SeasonResults } from "@models/Season";
import { toMovieView } from "@models/Movie";
import { requirePresident } from "@utils/membership";
import { getPrismaClient } from "@utils/prisma";
import { findWinners } from "@utils/winners";

type Db = Prisma.TransactionClient;

const NOT_EDITABLE = "Non modificabile in questa fase";
const NOT_READY = "Svela e proietta tutti i film prima della serata finale";

const envelopeSelect = { revealedAt: true, award: { select: { id: true, name: true, question: true } } } satisfies Prisma.SeasonAwardSelect;
type Envelope = Prisma.SeasonAwardGetPayload<{ select: typeof envelopeSelect }>;

/** Film e proponente: solo per i vincitori di buste aperte, o per tutti quando sono aperte tutte. */
const filmSelect = {
    id: true,
    movie: true,
    participant: { select: { userId: true, category: { select: { id: true, name: true } }, user: { select: { username: true, avatarUrl: true } } } },
} satisfies Prisma.CandidatureSelect;
type Film = Prisma.CandidatureGetPayload<{ select: typeof filmSelect }>;

const proposerOf = (f: Film) => ({ userId: f.participant.userId, username: f.participant.user.username, avatarUrl: f.participant.user.avatarUrl });

@Service()
export class ResultsService {
    constructor(private readonly candidatures: CandidatureRepository, private readonly seasons: SeasonService) {}

    /** Apre una busta. La prima porta la rassegna in FINAL (voti chiusi), l'ultima in DONE. */
    async open(userId: number, cineforumId: number, seasonId: number, awardId: number): Promise<AwardResult> {
        await requirePresident(userId, cineforumId);
        const { season } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        const where = { seasonId_awardId: { seasonId: season.id, awardId } };

        return this.candidatures.transaction(async tx => {
            // stesso lock del voto: nessun voto entra dopo un risultato annunciato
            const { status } = await this.candidatures.lockSeason(tx, season.id);
            const envelope = await tx.seasonAward.findUnique({ where, select: envelopeSelect });
            if (!envelope) throw new httpErrors.NotFound("Premio non trovato");
            if (envelope.revealedAt) return this.result(tx, season.id, envelope);

            if (status !== "SCREENING" && status !== "FINAL") throw new httpErrors.BadRequest(NOT_EDITABLE);
            const hidden = await tx.candidature.count({ where: { seasonId: season.id, status: "VALID", revealedAt: null } });
            if (hidden || (await this.candidatures.findPendingScreening(tx, season.id))) throw new httpErrors.BadRequest(NOT_READY);

            await tx.seasonAward.updateMany({ where: { seasonId: season.id, awardId, revealedAt: null }, data: { revealedAt: new Date() } });
            const closed = (await tx.seasonAward.count({ where: { seasonId: season.id, revealedAt: null } })) === 0;
            await tx.season.update({ where: { id: season.id }, data: { status: closed ? "DONE" : "FINAL" } });
            return this.result(tx, season.id, await tx.seasonAward.findUniqueOrThrow({ where, select: envelopeSelect }));
        });
    }

    async results(userId: number, cineforumId: number, seasonId: number): Promise<SeasonResults> {
        const { season } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        const db = getPrismaClient();
        const envelopes = await db.seasonAward.findMany({ where: { seasonId: season.id }, select: envelopeSelect, orderBy: [{ revealedAt: "asc" }, { awardId: "asc" }] });
        const open = envelopes.filter(e => e.revealedAt);
        const allRevealed = open.length === envelopes.length;
        const films = allRevealed
            ? await db.candidature.findMany({ where: { seasonId: season.id, status: "VALID" }, select: filmSelect, orderBy: { projectionOrder: "asc" } })
            : [];
        return {
            awards: await Promise.all(open.map(e => this.result(db, season.id, e))),
            allRevealed,
            proposers: films.map(f => ({ candidatureId: f.id, movie: toMovieView(f.movie), proposer: proposerOf(f) })),
        };
    }

    /** Somma e numero di voti ricevuti da ogni film valido per un premio (solo chi ha voti). */
    async scores(db: Db, seasonId: number, awardId: number) {
        const groups = await db.vote.groupBy({
            by: ["candidatureId"],
            where: { awardId, candidature: { seasonId, status: "VALID" } },
            _sum: { value: true },
            _count: { _all: true },
        });
        return new Map(groups.map(g => [g.candidatureId, { candidatureId: g.candidatureId, sum: g._sum.value ?? 0, count: g._count._all }]));
    }

    /** Da chiamare solo su buste aperte: espone i proponenti dei vincitori. */
    private async result(db: Db, seasonId: number, e: Envelope): Promise<AwardResult> {
        const scores = await this.scores(db, seasonId, e.award.id);
        const winners = await db.candidature.findMany({ where: { id: { in: findWinners([...scores.values()]) } }, select: filmSelect, orderBy: { projectionOrder: "asc" } });
        return {
            awardId: e.award.id,
            name: e.award.name,
            question: e.award.question,
            revealedAt: e.revealedAt!.toISOString(),
            winners: winners.map(f => {
                const { sum, count } = scores.get(f.id)!;
                return {
                    movie: toMovieView(f.movie),
                    category: f.participant.category,
                    proposer: proposerOf(f),
                    average: Math.round((sum * 10) / count) / 10,
                    votes: count,
                };
            }),
        };
    }
}
