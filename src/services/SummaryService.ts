import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { ResultsService } from "@services/ResultsService";
import { SeasonService } from "@services/SeasonService";
import { SeasonRecap } from "@models/Season";
import { toMovieView } from "@models/Movie";
import { getPrismaClient } from "@utils/prisma";
import { findWinners } from "@utils/winners";

const person = (u: { id: number; username: string; avatarUrl: string | null }) => ({ userId: u.id, username: u.username, avatarUrl: u.avatarUrl });

/** Scheda di una rassegna DONE, calcolata al volo: dopo DONE i dati sorgente non cambiano più. */
@Service()
export class SummaryService {
    constructor(private readonly seasons: SeasonService, private readonly results: ResultsService) {}

    async get(userId: number, cineforumId: number, seasonId: number): Promise<SeasonRecap> {
        const { season } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        if (season.status !== "DONE") throw new httpErrors.NotFound("Scheda disponibile a rassegna conclusa");
        const db = getPrismaClient();

        const [{ awards }, categories, participants, candidatures] = await Promise.all([
            this.results.results(userId, cineforumId, seasonId),
            db.category.findMany({ where: { seasons: { some: { id: season.id } } }, select: { id: true, name: true, description: true }, orderBy: { id: "asc" } }),
            db.participant.findMany({ where: { seasonId: season.id }, select: { user: { select: { id: true, username: true, avatarUrl: true } } }, orderBy: { id: "asc" } }),
            db.candidature.findMany({
                where: { seasonId: season.id, status: "VALID" },
                include: { movie: true, participant: { include: { category: { select: { id: true, name: true } }, user: { select: { id: true, username: true, avatarUrl: true } } } } },
                orderBy: { projectionOrder: "asc" },
            }),
        ]);
        const perAward = await Promise.all(awards.map(async a => {
            const scores = await this.results.scores(db, season.id, a.awardId);
            return { awardId: a.awardId, scores, winners: new Set(findWinners([...scores.values()])) };
        }));

        return {
            season: {
                id: season.id, name: season.name, description: season.description,
                candidaturesCloseAt: season.candidaturesCloseAt.toISOString(),
                finalNightAt: season.finalNightAt?.toISOString() ?? null,
                concludedAt: awards[awards.length - 1]!.revealedAt,
            },
            categories,
            participants: participants.map(p => person(p.user)),
            films: candidatures.map(c => ({
                order: c.projectionOrder!,
                movie: toMovieView(c.movie),
                category: c.participant.category,
                proposer: person(c.participant.user),
                screeningAt: c.screeningAt?.toISOString() ?? null,
                location: c.location,
                scores: perAward.map(a => {
                    const s = a.scores.get(c.id);
                    return { awardId: a.awardId, average: s ? Math.round((s.sum * 10) / s.count) / 10 : null, votes: s?.count ?? 0 };
                }),
                awardsWon: perAward.filter(a => a.winners.has(c.id)).map(a => a.awardId),
            })),
            awards,
        };
    }
}
