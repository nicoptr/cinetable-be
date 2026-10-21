import { Season } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { CandidatureRepository } from "@repositories/CandidatureRepository";
import { MovieRepository } from "@repositories/MovieRepository";
import { SeasonService } from "@services/SeasonService";
import { TmdbClient } from "@services/TmdbClient";
import { EmailSenderService } from "@services/EmailSenderService";
import { MyCandidatureView, ProgramItem, ScreeningDTO, toProgramItem } from "@models/Candidature";
import { toMovieView } from "@models/Movie";
import { requirePresident } from "@utils/membership";
import { candidatureDuplicateTemplate } from "../templates/email/candidatureDuplicateTemplate";
import { screeningPlannedTemplate } from "../templates/email/screeningPlannedTemplate";
import { shuffle } from "@utils/random";

const BANNED = "Film non disponibile per questa edizione";

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

    /** Stesso film da due partecipanti: entrambe DUPLICATE e film escluso dall'edizione. */
    async submit(userId: number, cineforumId: number, seasonId: number, tmdbId: number): Promise<MyCandidatureView> {
        const { season, participant } = await this.seasons.requireParticipant(userId, cineforumId, seasonId);
        assertOpen(season);
        if (await this.repo.isBanned(season.id, tmdbId)) throw new httpErrors.BadRequest(BANNED);
        // già in cache: niente TMDB; altrimenti rete fuori dalla transazione
        let movie = await this.movies.find(tmdbId);
        if (!movie) {
            movie = await this.tmdb.getMovie(tmdbId);
            if (!movie) throw new httpErrors.BadRequest("Film non trovato");
            await this.movies.upsert(movie);
        }

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

    /** Svela il prossimo film; al primo svelamento sorteggia l'ordine di proiezione. */
    async revealNext(userId: number, cineforumId: number, seasonId: number): Promise<ProgramItem> {
        await requirePresident(userId, cineforumId);
        const { season, participant } = await this.seasons.requireSeason(userId, cineforumId, seasonId);

        const revealedId = await this.repo.transaction(async tx => {
            // due clic contemporanei passano uno alla volta
            const locked = await this.repo.lockSeason(tx, season.id);
            if (locked.status !== "OPEN" && locked.status !== "SCREENING") throw new httpErrors.BadRequest("Non ci sono film da svelare in questa fase");
            if (locked.candidaturesCloseAt > new Date()) throw new httpErrors.BadRequest("Le candidature sono ancora aperte");
            const valid = await this.repo.validIds(tx, season.id);
            if (valid.length < (await this.repo.countParticipants(tx, season.id))) {
                throw new httpErrors.BadRequest("Mancano ancora dei film: sposta la scadenza per chi deve candidare");
            }
            if (locked.status === "OPEN") await this.repo.startScreening(tx, season.id, shuffle(valid).map(c => c.id));
            if (await this.repo.findPendingScreening(tx, season.id)) throw new httpErrors.BadRequest("Proietta il film in programma prima di svelare il prossimo");
            const next = await this.repo.findNextToReveal(tx, season.id);
            if (!next || !(await this.repo.reveal(tx, next.id))) throw new httpErrors.BadRequest("Hai già svelato tutti i film");
            return next.id;
        });
        return toProgramItem(await this.repo.findProgramRow(revealedId), { participantId: participant?.id ?? null, isPresident: true });
    }

    /** Solo film svelati: gli altri sono indistinguibili da inesistenti. */
    async planScreening(userId: number, cineforumId: number, seasonId: number, order: number, data: ScreeningDTO): Promise<ProgramItem> {
        await requirePresident(userId, cineforumId);
        const { season, participant } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        if (season.status !== "SCREENING") throw new httpErrors.BadRequest("Non modificabile in questa fase");
        const revealed = await this.repo.findRevealed(season.id, order);
        if (!revealed) throw new httpErrors.NotFound("Film non trovato");
        // una proiezione già fatta non torna nel futuro: bloccherebbe di nuovo reveal-next
        if (revealed.screeningAt && revealed.screeningAt <= new Date()) throw new httpErrors.BadRequest("Proiezione già avvenuta");
        // senza data si può registrare una proiezione già avvenuta; una data futura non si sposta nel passato
        if (revealed.screeningAt && data.screeningAt < new Date()) throw new httpErrors.BadRequest("La proiezione non può essere nel passato");

        const row = await this.repo.planScreening(revealed.id, data);
        const html = screeningPlannedTemplate(row.movie.title, data.screeningAt, data.location);
        const recipients = await this.repo.participantEmails(season.id);
        await Promise.all(recipients.map(r => this.email.send(r.user.email, "Prossima proiezione", html)));
        return toProgramItem(row, { participantId: participant?.id ?? null, isPresident: true });
    }

    /**
     * Sblocca un'edizione OPEN ferma su chi non avrà mai un film valido. Il presidente vede già
     * questi nomi in `progress.missing`: non trapela nulla di nuovo.
     */
    async removeParticipant(userId: number, cineforumId: number, seasonId: number, targetUserId: number): Promise<void> {
        await requirePresident(userId, cineforumId);
        const { season } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        await this.repo.transaction(async tx => {
            const { status } = await this.repo.lockSeason(tx, season.id);
            const target = await this.repo.findParticipantProgress(tx, season.id, targetUserId);
            if (!target) throw new httpErrors.NotFound("Partecipante non trovato");
            if (status !== "OPEN" || target._count.candidatures > 0) throw new httpErrors.BadRequest("Puoi rimuovere solo chi non ha ancora un film valido");
            if ((await this.repo.countParticipants(tx, season.id)) <= 2) throw new httpErrors.BadRequest("Un'edizione ha almeno 2 partecipanti");
            await this.repo.deleteParticipant(tx, target.id);
        });
    }
}
