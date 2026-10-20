import { Invitation, Prisma } from "@prisma/client";
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

    countSentSince(invitedById: number, since: Date): Promise<number> {
        return this.db.invitation.count({ where: { invitedById, updatedAt: { gte: since } } });
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

    /** Aggiornamento condizionato a PENDING: null se nel frattempo l'invito è cambiato di stato. */
    async renew(id: number, tokenHash: string, expiresAt: Date): Promise<Invitation | null> {
        const { count } = await this.db.invitation.updateMany({ where: { id, status: "PENDING" }, data: { tokenHash, expiresAt } });
        return count === 1 ? this.db.invitation.findUniqueOrThrow({ where: { id } }) : null;
    }

    async revoke(id: number): Promise<Invitation | null> {
        const { count } = await this.db.invitation.updateMany({ where: { id, status: "PENDING" }, data: { status: "REVOKED" } });
        return count === 1 ? this.db.invitation.findUniqueOrThrow({ where: { id } }) : null;
    }

    findPendingByTokenHash(tokenHash: string) {
        return this.db.invitation.findFirst({
            where: { tokenHash, status: "PENDING", expiresAt: { gt: new Date() } },
            include: { cineforum: { select: { name: true } }, invitedBy: { select: { username: true } } },
        });
    }

    async userExists(email: string): Promise<boolean> {
        return (await this.db.user.count({ where: { email } })) > 0;
    }

    async findUserEmail(userId: number): Promise<string> {
        return (await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email;
    }

    findPendingForEmail(email: string) {
        return this.db.invitation.findMany({
            where: { email, status: "PENDING", expiresAt: { gt: new Date() } },
            include: { cineforum: { select: { name: true } }, invitedBy: { select: { username: true } } },
            orderBy: { id: "desc" },
        });
    }

    /** Invito PENDING, non scaduto e intestato a `email`. */
    findPendingFor(id: number, email: string, db: Prisma.TransactionClient = this.db): Promise<Invitation | null> {
        return db.invitation.findFirst({ where: { id, email, status: "PENDING", expiresAt: { gt: new Date() } } });
    }

    /** true se l'invito era ancora PENDING e non scaduto (e ora è ACCEPTED). */
    async markAccepted(db: Prisma.TransactionClient, id: number): Promise<boolean> {
        const { count } = await db.invitation.updateMany({ where: { id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "ACCEPTED" } });
        return count === 1;
    }

    async decline(id: number, email: string): Promise<boolean> {
        const { count } = await this.db.invitation.updateMany({
            where: { id, email, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "DECLINED" },
        });
        return count === 1;
    }
}
