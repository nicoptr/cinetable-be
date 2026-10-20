import { Service } from "fastify-decorators";
import { CineforumRepository } from "@repositories/CineforumRepository";
import { CineforumDTO, CineforumUpdateDTO } from "@models/Cineforum";
import { requireMember, requirePresident } from "@utils/membership";

@Service()
export class CineforumService {
    constructor(private readonly repo: CineforumRepository) {}

    create(userId: number, data: CineforumDTO) {
        return this.repo.createWithPresident(userId, data);
    }

    async listMine(userId: number) {
        const rows = await this.repo.findByMember(userId);
        return rows.map(({ cineforum: { id, name, description }, role }) => ({ id, name, description, role }));
    }

    async get(userId: number, id: number) {
        const { role } = await requireMember(userId, id);
        const { name, description, memberships } = await this.repo.findWithMembers(id);
        return {
            id, name, description, myRole: role,
            members: memberships.map(m => ({ userId: m.userId, username: m.user.username, avatarUrl: m.user.avatarUrl, role: m.role })),
        };
    }

    async update(userId: number, id: number, data: CineforumUpdateDTO) {
        await requirePresident(userId, id);
        return this.repo.update(id, data);
    }
}
