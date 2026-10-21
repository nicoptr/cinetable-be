import { Prisma, Season } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { CandidatureRepository } from "@repositories/CandidatureRepository";
import { MovieRepository } from "@repositories/MovieRepository";
import { SeasonService } from "@services/SeasonService";
import { TmdbClient } from "@services/TmdbClient";
import { EmailSenderService } from "@services/EmailSenderService";
import { MyCandidatureView, NextScreening, ProgramItem, ScreeningDTO, toNextScreening, toProgramItem } from "@models/Candidature";
import { toMovieView } from "@models/Movie";
import { requirePresident } from "@utils/membership";
import { candidatureDuplicateTemplate } from "../templates/email/candidatureDuplicateTemplate";
import { screeningPlannedTemplate } from "../templates/email/screeningPlannedTemplate";
import { screeningScheduledTemplate } from "../templates/email/screeningScheduledTemplate";
import { filmRevealedTemplate } from "../templates/email/filmRevealedTemplate";
import { shuffle } from "@utils/random";

type Db = Prisma.TransactionClient;

const BANNED = "Film non disponibile per questa edizione";
const ALL_REVEALED = "Hai già svelato tutti i film";

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

    /** Svela il prossimo film; al primo svelamento sorteggia l'ordine di proiezione. Data e luogo già fissati restano. */
    async revealNext(userId: number, cineforumId: number, seasonId: number): Promise<ProgramItem> {
        await requirePresident(userId, cineforumId);
        const { season, participant } = await this.seasons.requireSeason(userId, cineforumId, seasonId);

        const revealedId = await this.repo.transaction(async tx => {
            await this.lockForReveal(tx, season.id);
            if (await this.repo.findPendingScreening(tx, season.id)) throw new httpErrors.BadRequest("Proietta il film in programma prima di svelare il prossimo");
            const next = await this.repo.findNextToReveal(season.id, tx);
            if (!next || !(await this.repo.reveal(tx, next.id))) throw new httpErrors.BadRequest(ALL_REVEALED);
            return next.id;
        });
        const row = await this.repo.findProgramRow(revealedId);
        const html = filmRevealedTemplate(row.movie.title, row.screeningAt, row.location);
        await this.sendToParticipants(season.id, "Svelato il prossimo film", html);
        return toProgramItem(row, { participantId: participant?.id ?? null, isPresident: true });
    }

    /** Data e luogo del film che reveal-next svelerebbe; si può riprogrammare finché resta coperto. */
    async scheduleNext(userId: number, cineforumId: number, seasonId: number, data: ScreeningDTO): Promise<NextScreening> {
        await requirePresident(userId, cineforumId);
        const { season } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        if (data.screeningAt <= new Date()) throw new httpErrors.BadRequest("La proiezione non può essere nel passato");

        const scheduled = await this.repo.transaction(async tx => {
            await this.lockForReveal(tx, season.id);
            const next = await this.repo.findNextToReveal(season.id, tx);
            if (!next) throw new httpErrors.BadRequest(ALL_REVEALED);
            const pending = await this.repo.findPendingScreening(tx, season.id);
            if (pending?.screeningAt && data.screeningAt <= pending.screeningAt) throw new httpErrors.BadRequest("La proiezione deve essere dopo quella già in programma");
            return toNextScreening(await this.repo.scheduleScreening(tx, next.id, data))!;
        });
        await this.sendToParticipants(season.id, "Prossima proiezione", screeningScheduledTemplate(scheduled.categoryName, data.screeningAt, data.location));
        return scheduled;
    }

    /** Stato comune a svelamento e programmazione; dalla prima chiamata l'ordine è sorteggiato e l'edizione è in SCREENING. */
    private async lockForReveal(tx: Db, seasonId: number) {
        // due clic contemporanei passano uno alla volta
        const locked = await this.repo.lockSeason(tx, seasonId);
        if (locked.status !== "OPEN" && locked.status !== "SCREENING") throw new httpErrors.BadRequest("Non ci sono film da svelare in questa fase");
        if (locked.candidaturesCloseAt > new Date()) throw new httpErrors.BadRequest("Le candidature sono ancora aperte");
        const valid = await this.repo.validIds(tx, seasonId);
        if (valid.length < (await this.repo.countParticipants(tx, seasonId))) {
            throw new httpErrors.BadRequest("Mancano ancora dei film: sposta la scadenza per chi deve candidare");
        }
        if (locked.status === "OPEN") await this.repo.startScreening(tx, seasonId, shuffle(valid).map(c => c.id));
    }

    /** Tutti i partecipanti, proponente compreso. */
    private async sendToParticipants(seasonId: number, subject: string, html: string) {
        const recipients = await this.repo.participantEmails(seasonId);
        await Promise.all(recipients.map(r => this.email.send(r.user.email, subject, html)));
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
        const next = await this.repo.findNextToReveal(season.id);
        if (next?.screeningAt && data.screeningAt >= next.screeningAt) throw new httpErrors.BadRequest("La proiezione deve essere prima di quella già programmata per il prossimo film");

        const row = await this.repo.planScreening(revealed.id, data);
        await this.sendToParticipants(season.id, "Prossima proiezione", screeningPlannedTemplate(row.movie.title, data.screeningAt, data.location));
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
