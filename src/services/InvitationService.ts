import { Invitation } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { InvitationRepository } from "@repositories/InvitationRepository";
import { EmailSenderService } from "@services/EmailSenderService";
import { InvitationView } from "@models/Invitation";
import { requirePresident } from "@utils/membership";
import { expiresIn, generateToken, TOKEN_TTL } from "@utils/tokens";
import { cineforumInvitationTemplate } from "../templates/email/cineforumInvitationTemplate";

export function toInvitationView(i: Invitation): InvitationView {
    return {
        id: i.id,
        email: i.email,
        status: i.status === "PENDING" && i.expiresAt < new Date() ? "EXPIRED" : i.status,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
    };
}

@Service()
export class InvitationService {
    constructor(
        private readonly repository: InvitationRepository,
        private readonly email: EmailSenderService,
    ) {}

    async create(userId: number, cineforumId: number, rawEmails: string[]): Promise<InvitationView[]> {
        await requirePresident(userId, cineforumId);
        const emails = [...new Set(rawEmails)];
        const skip = new Set(await this.repository.findMemberEmails(cineforumId, emails));
        for (const i of await this.repository.findStatusByEmails(cineforumId, emails)) {
            if (i.status === "ACCEPTED") skip.add(i.email);
        }
        const context = await this.repository.findEmailContext(cineforumId, userId);
        const views: InvitationView[] = [];
        for (const email of emails.filter(e => !skip.has(e))) {
            const { token, hash } = generateToken();
            const invitation = await this.repository.upsert(cineforumId, email, userId, hash, expiresIn(TOKEN_TTL.INVITATION));
            await this.sendEmail(invitation, token, context);
            views.push(toInvitationView(invitation));
        }
        return views;
    }

    async list(userId: number, cineforumId: number): Promise<InvitationView[]> {
        await requirePresident(userId, cineforumId);
        return (await this.repository.findByCineforum(cineforumId)).map(toInvitationView);
    }

    async resend(userId: number, cineforumId: number, id: number): Promise<InvitationView> {
        await this.findOpen(userId, cineforumId, id);
        const { token, hash } = generateToken();
        const renewed = await this.repository.renew(id, hash, expiresIn(TOKEN_TTL.INVITATION));
        await this.sendEmail(renewed, token, await this.repository.findEmailContext(cineforumId, userId));
        return toInvitationView(renewed);
    }

    async revoke(userId: number, cineforumId: number, id: number): Promise<InvitationView> {
        await this.findOpen(userId, cineforumId, id);
        return toInvitationView(await this.repository.revoke(id));
    }

    /** Invito PENDING o scaduto (ancora PENDING in DB) del cineforum, altrimenti 404/400. */
    private async findOpen(userId: number, cineforumId: number, id: number): Promise<void> {
        await requirePresident(userId, cineforumId);
        const invitation = await this.repository.findInCineforum(cineforumId, id);
        if (!invitation) throw new httpErrors.NotFound("Invito non trovato");
        if (invitation.status !== "PENDING") throw new httpErrors.BadRequest("L'invito non è più attivo");
    }

    private sendEmail(invitation: Invitation, token: string, ctx: { cineforumName: string; inviterUsername: string }) {
        const url = `${process.env.CLIENT_URL}/invito?token=${token}`;
        return this.email.send(invitation.email, `Invito a ${ctx.cineforumName}`,
            cineforumInvitationTemplate(ctx.cineforumName, ctx.inviterUsername, url, invitation.expiresAt));
    }
}
