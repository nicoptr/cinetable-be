import { Invitation, Prisma } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { InvitationRepository } from "@repositories/InvitationRepository";
import { EmailSenderService } from "@services/EmailSenderService";
import { InvitationView, InviteInfo, MyInvitation } from "@models/Invitation";
import { requirePresident } from "@utils/membership";
import { getPrismaClient, isUniqueViolation } from "@utils/prisma";
import { expiresIn, generateToken, hashToken, TOKEN_TTL } from "@utils/tokens";
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

const INVITES_PER_DAY = 100;
const NOT_ACTIVE = "L'invito non è più attivo";
const INVALID = "Invito non valido o scaduto";

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
        const toInvite = emails.filter(e => !skip.has(e));
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (await this.repository.countSentSince(userId, since) + toInvite.length > INVITES_PER_DAY) {
            throw new httpErrors.TooManyRequests("Hai raggiunto il limite di inviti per oggi");
        }
        const views: InvitationView[] = [];
        const sends: Promise<void>[] = [];
        for (const email of toInvite) {
            const { token, hash } = generateToken();
            try {
                const invitation = await this.repository.upsert(cineforumId, email, userId, hash, expiresIn(TOKEN_TTL.INVITATION));
                sends.push(this.sendEmail(invitation, token, context));
                views.push(toInvitationView(invitation));
            } catch (e) {
                if (!isUniqueViolation(e)) throw e; // invito concorrente allo stesso indirizzo: già invitato
            }
        }
        await Promise.all(sends);
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
        if (!renewed) throw new httpErrors.BadRequest(NOT_ACTIVE);
        await this.sendEmail(renewed, token, await this.repository.findEmailContext(cineforumId, userId));
        return toInvitationView(renewed);
    }

    async revoke(userId: number, cineforumId: number, id: number): Promise<InvitationView> {
        await this.findOpen(userId, cineforumId, id);
        const revoked = await this.repository.revoke(id);
        if (!revoked) throw new httpErrors.BadRequest(NOT_ACTIVE);
        return toInvitationView(revoked);
    }

    /** Invito PENDING o scaduto (ancora PENDING in DB) del cineforum, altrimenti 404/400. */
    private async findOpen(userId: number, cineforumId: number, id: number): Promise<void> {
        await requirePresident(userId, cineforumId);
        const invitation = await this.repository.findInCineforum(cineforumId, id);
        if (!invitation) throw new httpErrors.NotFound("Invito non trovato");
        if (invitation.status !== "PENDING") throw new httpErrors.BadRequest(NOT_ACTIVE);
    }

    /** Invito PENDING e non scaduto per quel token, con i dati per mostrarlo; null se non valido. */
    findByToken(token: string) {
        return this.repository.findPendingByTokenHash(hashToken(token));
    }

    async info(token: string): Promise<InviteInfo> {
        const invitation = await this.findByToken(token);
        if (!invitation) throw new httpErrors.NotFound(INVALID);
        return {
            email: invitation.email,
            cineforumName: invitation.cineforum.name,
            invitedBy: invitation.invitedBy.username,
            userExists: await this.repository.userExists(invitation.email),
        };
    }

    /** Membro MEMBER + invito ACCEPTED, nella transazione del chiamante. Fallisce se l'invito non è più valido. */
    async acceptInTx(tx: Prisma.TransactionClient, invitation: Invitation, userId: number): Promise<void> {
        if (!(await this.repository.markAccepted(tx, invitation.id))) throw new httpErrors.NotFound(INVALID);
        await tx.membership.upsert({
            where: { userId_cineforumId: { userId, cineforumId: invitation.cineforumId } },
            create: { userId, cineforumId: invitation.cineforumId, role: "MEMBER" },
            update: {},
        });
    }

    async mine(userId: number): Promise<MyInvitation[]> {
        const rows = await this.repository.findPendingForEmail(await this.repository.findUserEmail(userId));
        return rows.map(i => ({
            id: i.id,
            cineforumId: i.cineforumId,
            cineforumName: i.cineforum.name,
            invitedBy: i.invitedBy.username,
            expiresAt: i.expiresAt.toISOString(),
        }));
    }

    async accept(userId: number, id: number): Promise<{ cineforumId: number }> {
        const email = await this.repository.findUserEmail(userId);
        return getPrismaClient().$transaction(async tx => {
            const invitation = await this.repository.findPendingFor(id, email, tx);
            if (!invitation) throw new httpErrors.NotFound(INVALID);
            await this.acceptInTx(tx, invitation, userId);
            return { cineforumId: invitation.cineforumId };
        });
    }

    async decline(userId: number, id: number): Promise<void> {
        if (!(await this.repository.decline(id, await this.repository.findUserEmail(userId)))) throw new httpErrors.NotFound(INVALID);
    }

    private sendEmail(invitation: Invitation, token: string, ctx: { cineforumName: string; inviterUsername: string }) {
        const url = `${process.env.CLIENT_URL}/invito?token=${token}`;
        return this.email.send(invitation.email, `Invito a ${ctx.cineforumName}`,
            cineforumInvitationTemplate(ctx.cineforumName, ctx.inviterUsername, url, invitation.expiresAt));
    }
}
