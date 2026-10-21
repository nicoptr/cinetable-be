import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { CandidatureRepository } from "@repositories/CandidatureRepository";
import { VoteRepository } from "@repositories/VoteRepository";
import { SeasonService } from "@services/SeasonService";
import { EmailSenderService } from "@services/EmailSenderService";
import { ProgramItem, toProgramItem } from "@models/Candidature";
import { VoteDTO } from "@models/Vote";
import { requirePresident } from "@utils/membership";
import { isUniqueViolation } from "@utils/prisma";
import { votingOpenTemplate } from "../templates/email/votingOpenTemplate";
import { voteReminderTemplate } from "../templates/email/voteReminderTemplate";

const NOT_EDITABLE = "Non modificabile in questa fase";

@Service()
export class VoteService {
    constructor(
        private readonly repo: VoteRepository,
        private readonly candidatures: CandidatureRepository,
        private readonly seasons: SeasonService,
        private readonly email: EmailSenderService,
    ) {}

    /** Come planScreening: non svelata o di un'altra edizione è indistinguibile da inesistente. */
    private async requireRevealed(seasonId: number, order: number) {
        const c = await this.candidatures.findRevealed(seasonId, order);
        if (!c) throw new httpErrors.NotFound("Film non trovato");
        return c;
    }

    async openVoting(userId: number, cineforumId: number, seasonId: number, order: number): Promise<ProgramItem> {
        await requirePresident(userId, cineforumId);
        const { season, participant } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        if (season.status !== "SCREENING") throw new httpErrors.BadRequest(NOT_EDITABLE);
        const c = await this.requireRevealed(season.id, order);
        if (!c.screeningAt || c.screeningAt > new Date()) throw new httpErrors.BadRequest("Il voto si apre dopo la proiezione");

        // l'email parte solo da chi apre davvero: la seconda chiamata non rimanda nulla
        if (await this.repo.openVoting(c.id)) {
            const html = votingOpenTemplate(c.movie.title);
            const recipients = await this.repo.recipients(season.id, c.id, c.participantId, false);
            await Promise.all(recipients.map(r => this.email.send(r.user.email, `Vota il film: ${c.movie.title}`, html)));
        }
        return toProgramItem(await this.candidatures.findProgramRow(c.id), { participantId: participant?.id ?? null, isPresident: true });
    }

    async vote(userId: number, cineforumId: number, seasonId: number, order: number, data: VoteDTO): Promise<{ submitted: true }> {
        const { season, participant } = await this.seasons.requireParticipant(userId, cineforumId, seasonId);
        const c = await this.requireRevealed(season.id, order);
        if (!c.votingOpenedAt) throw new httpErrors.BadRequest("Il voto non è aperto");
        if (c.participantId === participant.id) throw new httpErrors.Forbidden("Non puoi votare il tuo film");

        const awardIds = await this.repo.seasonAwardIds(season.id);
        const sent = new Set(data.votes.map(v => v.awardId));
        if (sent.size !== data.votes.length || sent.size !== awardIds.length || !awardIds.every(id => sent.has(id))) {
            throw new httpErrors.BadRequest("Vota tutti i premi, una volta ciascuno");
        }
        const already = new httpErrors.Conflict("Hai già votato questo film");
        try {
            await this.repo.transaction(async tx => {
                // stesso lock dell'apertura delle buste: un voto non entra dopo un risultato annunciato
                const { status } = await this.candidatures.lockSeason(tx, season.id);
                if (status === "FINAL" || status === "DONE") throw new httpErrors.BadRequest("Le votazioni sono chiuse");
                if (await this.repo.hasVoted(tx, c.id, participant.id)) throw already;
                await this.repo.createMany(tx, c.id, participant.id, data.votes);
            });
        } catch (err) {
            // due invii simultanei: il vincolo unico lascia passare solo il primo
            if (isUniqueViolation(err)) throw already;
            throw err;
        }
        return { submitted: true };
    }

    async mine(userId: number, cineforumId: number, seasonId: number, order: number) {
        const { season, participant } = await this.seasons.requireParticipant(userId, cineforumId, seasonId);
        const c = await this.requireRevealed(season.id, order);
        return this.repo.mine(c.id, participant.id);
    }

    /** Solo il numero di email inviate: i nomi di chi non ha votato rivelerebbero il proponente. */
    async remind(userId: number, cineforumId: number, seasonId: number, order: number): Promise<{ sent: number }> {
        await requirePresident(userId, cineforumId);
        const { season } = await this.seasons.requireSeason(userId, cineforumId, seasonId);
        if (season.status !== "SCREENING") throw new httpErrors.BadRequest(NOT_EDITABLE);
        const c = await this.requireRevealed(season.id, order);
        if (!c.votingOpenedAt) throw new httpErrors.BadRequest("Il voto non è aperto");

        const recipients = await this.repo.recipients(season.id, c.id, c.participantId, true);
        const html = voteReminderTemplate(c.movie.title);
        await Promise.all(recipients.map(r => this.email.send(r.user.email, "Manca il tuo voto", html)));
        return { sent: recipients.length };
    }
}
