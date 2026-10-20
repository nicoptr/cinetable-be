import { Membership, Participant, Season } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { SeasonRepository, SeasonRow } from "@repositories/SeasonRepository";
import { EmailSenderService } from "@services/EmailSenderService";
import { SeasonDTO, SeasonUpdateDTO, SeasonView } from "@models/Season";
import { requireMember, requirePresident } from "@utils/membership";
import { shuffle } from "@utils/random";
import { seasonLaunchedTemplate } from "../templates/email/seasonLaunchedTemplate";

const NOT_EDITABLE = "Non modificabile in questa fase";
/** Campi modificabili per stato; DRAFT: tutti (null = nessun limite). */
const EDITABLE: Record<Season["status"], string[] | null> = {
    DRAFT: null,
    OPEN: ["description", "finalNightAt", "candidaturesCloseAt"],
    SCREENING: ["description", "finalNightAt"],
    FINAL: ["description", "finalNightAt"],
    DONE: [],
};

type Access = { season: Season; membership: Membership; participant: Participant | null };

@Service()
export class SeasonService {
    constructor(private readonly repo: SeasonRepository, private readonly email: EmailSenderService) {}

    /** Non membro, rassegna inesistente o di un altro cineforum: sempre 404. */
    async requireSeason(userId: number, cineforumId: number, seasonId: number): Promise<Access> {
        const membership = await requireMember(userId, cineforumId);
        const season = await this.repo.findInCineforum(seasonId, cineforumId);
        if (!season) throw new httpErrors.NotFound("Rassegna non trovata");
        const participant = await this.repo.findParticipant(season.id, userId);
        return { season, membership, participant };
    }

    async requireParticipant(userId: number, cineforumId: number, seasonId: number): Promise<Access & { participant: Participant }> {
        const access = await this.requireSeason(userId, cineforumId, seasonId);
        if (!access.participant) throw new httpErrors.Forbidden("Non partecipi a questa rassegna");
        return access as Access & { participant: Participant };
    }

    async list(userId: number, cineforumId: number) {
        await requireMember(userId, cineforumId);
        return this.repo.list(cineforumId);
    }

    async get(userId: number, cineforumId: number, seasonId: number): Promise<SeasonView> {
        const { season, membership, participant } = await this.requireSeason(userId, cineforumId, seasonId);
        return this.view(season.id, membership, participant);
    }

    async create(userId: number, cineforumId: number, data: SeasonDTO): Promise<SeasonView> {
        const membership = await requirePresident(userId, cineforumId);
        await this.validate(cineforumId, data);
        const { id } = await this.repo.create(cineforumId, data);
        return this.view(id, membership, await this.repo.findParticipant(id, userId));
    }

    async update(userId: number, cineforumId: number, seasonId: number, data: SeasonUpdateDTO): Promise<SeasonView> {
        await requirePresident(userId, cineforumId);
        const { season, membership } = await this.requireSeason(userId, cineforumId, seasonId);
        const allowed = EDITABLE[season.status];
        if (allowed && Object.keys(data).some(k => !allowed.includes(k))) throw new httpErrors.BadRequest(NOT_EDITABLE);

        const current = await this.repo.findFull(season.id);
        await this.validate(cineforumId, {
            name: current.name,
            candidaturesCloseAt: current.candidaturesCloseAt,
            finalNightAt: current.finalNightAt ?? undefined,
            categoryIds: current.categories.map(c => c.id),
            awardIds: current.awards.map(a => a.award.id),
            participantUserIds: current.participants.map(p => p.userId),
            ...data,
        }, data);
        await this.repo.update(season.id, data);
        return this.view(season.id, membership, await this.repo.findParticipant(season.id, userId));
    }

    async launch(userId: number, cineforumId: number, seasonId: number): Promise<SeasonView> {
        await requirePresident(userId, cineforumId);
        const { season, membership } = await this.requireSeason(userId, cineforumId, seasonId);
        if (season.status !== "DRAFT") throw new httpErrors.BadRequest("La rassegna è già stata avviata");
        if (season.candidaturesCloseAt <= new Date()) throw new httpErrors.BadRequest("La chiusura delle candidature deve essere futura");

        const current = await this.repo.findFull(season.id);
        const categories = current.categories.map(c => c.id);
        const assignments = shuffle(current.participants).map((p, i) => ({ userId: p.userId, categoryId: categories[i % categories.length]! }));
        if (!(await this.repo.launch(season.id, assignments))) throw new httpErrors.BadRequest("La rassegna è già stata avviata");

        const recipients = await this.repo.participantsWithEmail(season.id);
        await Promise.all(recipients.map(r => this.email.send(
            r.user.email, `Sei in gara: ${season.name}`, seasonLaunchedTemplate(season.name, r.category!.name, season.candidaturesCloseAt),
        )));
        return this.view(season.id, membership, await this.repo.findParticipant(season.id, userId));
    }

    /** `changed`: se presente, controlla l'appartenenza al cineforum solo dei campi cambiati. */
    private async validate(cineforumId: number, d: SeasonDTO, changed: Partial<SeasonDTO> = d) {
        if ("candidaturesCloseAt" in changed && d.candidaturesCloseAt <= new Date()) throw new httpErrors.BadRequest("La chiusura delle candidature deve essere futura");
        if (d.finalNightAt && d.finalNightAt <= d.candidaturesCloseAt) throw new httpErrors.BadRequest("La serata finale deve essere dopo la chiusura delle candidature");
        if (changed.categoryIds && (await this.repo.countCategories(d.categoryIds, cineforumId)) !== d.categoryIds.length) throw new httpErrors.BadRequest("Categorie non valide");
        if (changed.awardIds && (await this.repo.countAwards(d.awardIds, cineforumId)) !== d.awardIds.length) throw new httpErrors.BadRequest("Premi non validi");
        if (changed.participantUserIds && (await this.repo.countMembers(d.participantUserIds, cineforumId)) !== d.participantUserIds.length) throw new httpErrors.BadRequest("Partecipanti non validi");
        if (d.categoryIds.length > d.participantUserIds.length) throw new httpErrors.BadRequest("Non puoi avere più categorie che partecipanti");
    }

    private async view(seasonId: number, membership: Membership, participant: Participant | null): Promise<SeasonView> {
        const s: SeasonRow = await this.repo.findFull(seasonId);
        const myCategory = participant?.categoryId ? s.categories.find(c => c.id === participant.categoryId) ?? null : null;
        return {
            id: s.id, name: s.name, description: s.description, status: s.status,
            candidaturesCloseAt: s.candidaturesCloseAt, finalNightAt: s.finalNightAt,
            categories: s.categories,
            awards: s.awards.map(a => a.award),
            participants: s.participants.map(p => ({ userId: p.userId, username: p.user.username, avatarUrl: p.user.avatarUrl })),
            myRole: membership.role,
            isParticipant: !!participant,
            myCategory,
            candidatures: { valid: 0, expected: s.participants.length },
        };
    }
}
