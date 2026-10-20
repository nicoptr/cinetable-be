import { Prisma, User } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";

@Service()
export class UserRepository {
    private get users() {
        return getPrismaClient().user;
    }

    create(data: { username: string; email: string; password: string; emailVerifiedAt?: Date }): Promise<User> {
        return this.users.create({ data });
    }

    /** Utente non verificato + token di verifica, atomici. */
    createWithVerificationToken(data: { username: string; email: string; password: string }, tokenHash: string, expiresAt: Date): Promise<User> {
        return this.users.create({
            data: { ...data, authTokens: { create: { type: "VERIFY_EMAIL", tokenHash, expiresAt } } },
        });
    }

    findById(id: number): Promise<User | null> {
        return this.users.findUnique({ where: { id } });
    }

    findByEmail(email: string): Promise<User | null> {
        return this.users.findUnique({ where: { email } });
    }

    findByUsernameOrEmail(value: string): Promise<User | null> {
        return this.users.findFirst({ where: value.includes("@") ? { email: value.toLowerCase() } : { username: value } });
    }

    update(id: number, data: Prisma.UserUpdateInput): Promise<User> {
        return this.users.update({ where: { id }, data });
    }

    async findMemberships(userId: number) {
        const rows = await getPrismaClient().membership.findMany({
            where: { userId },
            include: { cineforum: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
        });
        return rows.map(m => ({ cineforumId: m.cineforumId, name: m.cineforum.name, role: m.role }));
    }
}
