import { Cineforum } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";
import { CineforumDTO, CineforumUpdateDTO } from "@models/Cineforum";

@Service()
export class CineforumRepository {
    private get db() {
        return getPrismaClient();
    }

    createWithPresident(userId: number, data: CineforumDTO): Promise<Cineforum> {
        return this.db.cineforum.create({ data: { ...data, memberships: { create: { userId, role: "PRESIDENT" } } } });
    }

    findByMember(userId: number) {
        return this.db.membership.findMany({
            where: { userId },
            include: { cineforum: true },
            orderBy: { createdAt: "asc" },
        });
    }

    findWithMembers(id: number) {
        return this.db.cineforum.findUniqueOrThrow({
            where: { id },
            include: {
                memberships: {
                    include: { user: { select: { username: true, avatarUrl: true } } },
                    orderBy: { createdAt: "asc" },
                },
            },
        });
    }

    update(id: number, data: CineforumUpdateDTO): Promise<Cineforum> {
        return this.db.cineforum.update({ where: { id }, data });
    }
}
