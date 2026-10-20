import { Invitation } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";

@Service()
export class InvitationRepository {
    private get db() {
        return getPrismaClient();
    }

    /** Nuovo invito o, se esiste già per (cineforum, email), lo riporta a PENDING con nuovo token. */
    upsert(cineforumId: number, email: string, invitedById: number, tokenHash: string, expiresAt: Date): Promise<Invitation> {
        return this.db.invitation.upsert({
            where: { cineforumId_email: { cineforumId, email } },
            create: { cineforumId, email, invitedById, tokenHash, expiresAt },
            update: { invitedById, tokenHash, expiresAt, status: "PENDING" },
        });
    }

    findByCineforum(cineforumId: number): Promise<Invitation[]> {
        return this.db.invitation.findMany({ where: { cineforumId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    }

    findInCineforum(cineforumId: number, id: number): Promise<Invitation | null> {
        return this.db.invitation.findFirst({ where: { id, cineforumId } });
    }

    findStatusByEmails(cineforumId: number, emails: string[]) {
        return this.db.invitation.findMany({ where: { cineforumId, email: { in: emails } }, select: { email: true, status: true } });
    }

    /** Emails (tra quelle date) di chi è già membro del cineforum. */
    async findMemberEmails(cineforumId: number, emails: string[]): Promise<string[]> {
        const users = await this.db.user.findMany({
            where: { email: { in: emails }, memberships: { some: { cineforumId } } },
            select: { email: true },
        });
        return users.map(u => u.email);
    }

    /** Nome del cineforum e username di chi invita, per l'email. */
    async findEmailContext(cineforumId: number, inviterId: number) {
        const [cineforum, inviter] = await Promise.all([
            this.db.cineforum.findUniqueOrThrow({ where: { id: cineforumId }, select: { name: true } }),
            this.db.user.findUniqueOrThrow({ where: { id: inviterId }, select: { username: true } }),
        ]);
        return { cineforumName: cineforum.name, inviterUsername: inviter.username };
    }

    renew(id: number, tokenHash: string, expiresAt: Date): Promise<Invitation> {
        return this.db.invitation.update({ where: { id }, data: { tokenHash, expiresAt } });
    }

    revoke(id: number): Promise<Invitation> {
        return this.db.invitation.update({ where: { id }, data: { status: "REVOKED" } });
    }
}
