import { Membership, Participant, Season } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { SeasonRepository, SeasonRow } from "@repositories/SeasonRepository";
import { CandidatureRepository } from "@repositories/CandidatureRepository";
import { EmailSenderService } from "@services/EmailSenderService";
import { SeasonDTO, SeasonListItem, SeasonUpdateDTO, SeasonView } from "@models/Season";
import { toNextScreening, toProgramItem } from "@models/Candidature";
import { requireMember, requirePresident } from "@utils/membership";
import { shuffle } from "@utils/random";
import { seasonLaunchedTemplate } from "../templates/email/seasonLaunchedTemplate";
import { seasonLink } from "@utils/links";

const NOT_EDITABLE = "Non modificabile in questa fase";
/** Campi modificabili per stato; DRAFT: tutti (null = nessun limite). */
const EDITABLE: Record<Season["status"], string[] | null> = {
    DRAFT: null,
    OPEN: ["description", "finalNightAt", "candidaturesCloseAt"],
    SCREENING: ["description", "finalNightAt"],
    FINAL: ["description", "finalNightAt"],
    DONE: [],
};

function assertEditable(status: Season["status"], data: SeasonUpdateDTO) {
    const allowed = EDITABLE[status];
    if (allowed && Object.keys(data).some(k => !allowed.includes(k))) throw new httpErrors.BadRequest(NOT_EDITABLE);
}

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** `checkClose`: la scadenza nel passato conta solo se è stata appena impostata (o all'avvio). */
function dateProblems(closeAt: Date, finalNightAt: Date | null, checkClose = true): string[] {
    const problems: string[] = [];
    if (checkClose && closeAt <= new Date()) problems.push("la chiusura delle candidature deve essere futura");
    if (finalNightAt && finalNightAt <= closeAt) problems.push("la serata finale deve essere dopo la chiusura delle candidature");
    return problems;
}

function launchProblems(s: SeasonRow): string[] {
    const problems: string[] = [];
    if (!s.categories.length) problems.push("aggiungi almeno una categoria");
    if (!s.awards.length) problems.push("aggiungi almeno un award");
    if (s.participants.length < 2) problems.push("aggiungi almeno 2 partecipanti");
    if (s.categories.length && s.participants.length % s.categories.length) problems.push("il numero dei partecipanti deve essere un multiplo di quello delle categorie");
    return [...problems, ...dateProblems(s.candidaturesCloseAt, s.finalNightAt)];
}

type Access = { season: Season; membership: Membership; participant: Participant | null };

@Service()
export class SeasonService {
    constructor(private readonly repo: SeasonRepository, private readonly candidatures: CandidatureRepository, private readonly email: EmailSenderService) {}

    /** Non membro, edizione inesistente o di un altro cineforum: sempre 404. */
    async requireSeason(userId: number, cineforumId: number, seasonId: number): Promise<Access> {
        const membership = await requireMember(userId, cineforumId);
        const season = await this.repo.findInCineforum(seasonId, cineforumId);
        if (!season) throw new httpErrors.NotFound("Edizione non trovata");
        const participant = await this.repo.findParticipant(season.id, userId);
        return { season, membership, participant };
    }

    async requireParticipant(userId: number, cineforumId: number, seasonId: number): Promise<Access & { participant: Participant }> {
        const access = await this.requireSeason(userId, cineforumId, seasonId);
        if (!access.participant) throw new httpErrors.Forbidden("Non partecipi a questa edizione");
        return access as Access & { participant: Participant };
    }

    async list(userId: number, cineforumId: number): Promise<SeasonListItem[]> {
        await requireMember(userId, cineforumId);
        const rows = await this.repo.list(cineforumId);
        return rows.map(s => ({ ...s, candidaturesCloseAt: s.candidaturesCloseAt.toISOString(), finalNightAt: s.finalNightAt?.toISOString() ?? null }));
    }

    async get(userId: number, cineforumId: number, seasonId: number): Promise<SeasonView> {
        const { season, membership, participant } = await this.requireSeason(userId, cineforumId, seasonId);
        return this.view(season.id, membership, participant);
    }

    async create(userId: number, cineforumId: number, data: SeasonDTO): Promise<SeasonView> {
        const membership = await requirePresident(userId, cineforumId);
        await this.validateMembership(cineforumId, data);
        const { id } = await this.repo.create(cineforumId, data);
        return this.view(id, membership, await this.repo.findParticipant(id, userId));
    }

    async update(userId: number, cineforumId: number, seasonId: number, data: SeasonUpdateDTO): Promise<SeasonView> {
        await requirePresident(userId, cineforumId);
        const { season, membership } = await this.requireSeason(userId, cineforumId, seasonId);
        assertEditable(season.status, data);

        if (season.status !== "DRAFT") {
            const problems = dateProblems(data.candidaturesCloseAt ?? season.candidaturesCloseAt, data.finalNightAt ?? season.finalNightAt, "candidaturesCloseAt" in data);
            if (problems.length) throw new httpErrors.BadRequest(capitalize(problems[0]!));
        }
        await this.validateMembership(cineforumId, data);
        await this.candidatures.transaction(async tx => {
            // stesso lock di reveal-next: lo stato può essere cambiato nel frattempo
            const { status } = await this.candidatures.lockSeason(tx, season.id);
            assertEditable(status, data);
            await this.repo.update(season.id, data, tx);
        });
        return this.view(season.id, membership, await this.repo.findParticipant(season.id, userId));
    }

    async delete(userId: number, cineforumId: number, seasonId: number): Promise<void> {
        await requirePresident(userId, cineforumId);
        const { season } = await this.requireSeason(userId, cineforumId, seasonId);
        if (!(await this.repo.deleteDraft(season.id))) throw new httpErrors.BadRequest("Si può eliminare solo una bozza");
    }

    async launch(userId: number, cineforumId: number, seasonId: number): Promise<SeasonView> {
        await requirePresident(userId, cineforumId);
        const { season, membership } = await this.requireSeason(userId, cineforumId, seasonId);
        // stesso lock di update: bozza e completezza verificate sullo stato che si va ad avviare
        const launched = await this.candidatures.transaction(async tx => {
            const { status } = await this.candidatures.lockSeason(tx, season.id);
            if (status !== "DRAFT") throw new httpErrors.BadRequest("L'edizione è già stata avviata");
            const current = await this.repo.findFull(season.id, tx);
            const problems = launchProblems(current);
            if (problems.length) throw new httpErrors.BadRequest(`Per avviare l'edizione: ${problems.join("; ")}`);
            const categories = current.categories.map(c => c.id);
            await this.repo.launch(tx, season.id, shuffle(current.participants).map((p, i) => ({ userId: p.userId, categoryId: categories[i % categories.length]! })));
            return current;
        });

        const recipients = await this.repo.participantsWithEmail(season.id);
        await Promise.all(recipients.map(r => this.email.send(
            r.user.email, `Sei in gara: ${launched.name}`, seasonLaunchedTemplate(launched.name, r.category!.name, launched.candidaturesCloseAt, seasonLink(cineforumId, season.id)),
        )));
        return this.view(season.id, membership, await this.repo.findParticipant(season.id, userId));
    }

    /** Solo appartenenza al cineforum dei campi presenti: la completezza si verifica all'avvio. */
    private async validateMembership(cineforumId: number, d: SeasonUpdateDTO) {
        if (d.categoryIds && (await this.repo.countCategories(d.categoryIds, cineforumId)) !== d.categoryIds.length) throw new httpErrors.BadRequest("Categorie non valide");
        if (d.awardIds && (await this.repo.countAwards(d.awardIds, cineforumId)) !== d.awardIds.length) throw new httpErrors.BadRequest("Award non validi");
        if (d.participantUserIds && (await this.repo.countMembers(d.participantUserIds, cineforumId)) !== d.participantUserIds.length) throw new httpErrors.BadRequest("Partecipanti non validi");
    }

    private async view(seasonId: number, membership: Membership, participant: Participant | null): Promise<SeasonView> {
        const [s, next] = await Promise.all([this.repo.findFull(seasonId), this.candidatures.findNextToReveal(seasonId)]);
        const viewer = { participantId: participant?.id ?? null, isPresident: membership.role === "PRESIDENT" };
        const myCategory = participant?.categoryId ? s.categories.find(c => c.id === participant.categoryId) ?? null : null;
        return {
            id: s.id, name: s.name, description: s.description, status: s.status,
            candidaturesCloseAt: s.candidaturesCloseAt.toISOString(), finalNightAt: s.finalNightAt?.toISOString() ?? null,
            categories: s.categories,
            awards: s.awards.map(a => a.award),
            participants: s.participants.map(p => ({ userId: p.userId, username: p.user.username, avatarUrl: p.user.avatarUrl })),
            myRole: membership.role,
            isParticipant: !!participant,
            myCategory,
            candidatures: { valid: s._count.candidatures, expected: s.participants.length },
            program: s.candidatures.map(c => toProgramItem(c, viewer)),
            // le svelate sono VALID e dopo la chiusura non cambiano più stato
            remainingToReveal: s._count.candidatures - s.candidatures.length,
            nextScreening: toNextScreening(next),
        };
    }
}
