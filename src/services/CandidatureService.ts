import { Season } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { CandidatureRepository } from "@repositories/CandidatureRepository";
import { MovieRepository } from "@repositories/MovieRepository";
import { SeasonService } from "@services/SeasonService";
import { TmdbClient } from "@services/TmdbClient";
import { EmailSenderService } from "@services/EmailSenderService";
import { MyCandidatureView } from "@models/Candidature";
import { toMovieView } from "@models/Movie";
import { requirePresident } from "@utils/membership";
import { candidatureDuplicateTemplate } from "../templates/email/candidatureDuplicateTemplate";

const BANNED = "Film non disponibile per questa rassegna";

function assertOpen(s: Pick<Season, "status" | "candidaturesCloseAt">) {
    if (s.status !== "OPEN" || s.candidaturesCloseAt <= new Date()) throw new httpErrors.BadRequest("Le candidature non sono aperte");
}

@Service()
export class CandidatureService {
    constructor(
        private readonly repo: CandidatureRepository,
        private readonly seasons: SeasonService,
        private readonly movies: MovieRepository,
        private readonly tmdb: TmdbClient,
        private readonly email: EmailSenderService,
    ) {}

    /** Stesso film da due partecipanti: entrambe DUPLICATE e film escluso dalla rassegna. */
    async submit(userId: number, cineforumId: number, seasonId: number, tmdbId: number): Promise<MyCandidatureView> {
        const { season, participant } = await this.seasons.requireParticipant(userId, cineforumId, seasonId);
        assertOpen(season);
        if (await this.repo.isBanned(season.id, tmdbId)) throw new httpErrors.BadRequest(BANNED);
        // rete fuori dalla transazione
        const movie = await this.tmdb.getMovie(tmdbId);
        if (!movie) throw new httpErrors.BadRequest("Film non trovato");
        await this.movies.upsert(movie);

        const outcome = await this.repo.transaction(async tx => {
            const locked = await this.repo.lockSeason(tx, season.id);
            assertOpen(locked);
            if (await this.repo.isBanned(season.id, tmdbId, tx)) throw new httpErrors.BadRequest(BANNED);

            const current = await this.repo.findValid(tx, participant.id);
            if (current?.tmdbId === tmdbId) return { status: "VALID" as const, notify: [] };
            // prima di creare la nuova VALID: l'indice parziale ne ammette una sola per partecipante
            if (current) await this.repo.setStatus(tx, [current.id], "WITHDRAWN");

            const others = await this.repo.findValidByMovie(tx, season.id, tmdbId);
            const status = others.length ? "DUPLICATE" as const : "VALID" as const;
            await this.repo.create(tx, { seasonId: season.id, participantId: participant.id, tmdbId, status });
            if (!others.length) return { status, notify: [] };
            await this.repo.setStatus(tx, others.map(o => o.id), "DUPLICATE");
            await this.repo.ban(tx, season.id, tmdbId);
            return { status, notify: [userId, ...others.map(o => o.participant.userId)], closeAt: locked.candidaturesCloseAt };
        });

        if (outcome.closeAt) {
            const html = candidatureDuplicateTemplate(movie.title, outcome.closeAt);
            const recipients = await this.repo.emailsOf(outcome.notify);
            await Promise.all(recipients.map(r => this.email.send(r.email, "Scegli un altro film", html)));
        }
        return { status: outcome.status, movie: toMovieView(movie) };
    }

    /** Solo la propria candidatura: il film si vede anche se annullata per duplicato. */
    async mine(userId: number, cineforumId: number, seasonId: number): Promise<MyCandidatureView> {
        const { participant } = await this.seasons.requireParticipant(userId, cineforumId, seasonId);
        const last = await this.repo.latest(participant.id);
        if (!last || last.status === "WITHDRAWN") return { status: "NONE", movie: null };
        return { status: last.status, movie: toMovieView(last.movie) };
    }

    async progress(userId: number, cineforumId: number, seasonId: number) {
        await requirePresident(userId, cineforumId);
        const { season } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        const rows = await this.repo.participantsProgress(season.id);
        const missing = rows.filter(r => r._count.candidatures === 0).map(r => ({ userId: r.userId, username: r.user.username }));
        return { expected: rows.length, valid: rows.length - missing.length, missing };
    }
}
