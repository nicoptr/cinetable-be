import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { AwardRepository } from "@repositories/AwardRepository";
import { AwardDTO, AwardUpdateDTO } from "@models/Award";
import { requireMember, requirePresident } from "@utils/membership";

@Service()
export class AwardService {
    constructor(private readonly repo: AwardRepository) {}

    async list(userId: number, cineforumId: number) {
        await requireMember(userId, cineforumId);
        return this.repo.list(cineforumId);
    }

    async create(userId: number, cineforumId: number, data: AwardDTO) {
        await requirePresident(userId, cineforumId);
        return this.repo.create(cineforumId, data);
    }

    async update(userId: number, cineforumId: number, id: number, data: AwardUpdateDTO) {
        await requirePresident(userId, cineforumId);
        await this.find(id, cineforumId);
        // gli archivi passati non cambiano
        if (await this.repo.countStartedSeasons(id)) throw new httpErrors.Conflict("Usato in un'edizione avviata: crea un nuovo premio");
        return this.repo.update(id, data);
    }

    async delete(userId: number, cineforumId: number, id: number) {
        await requirePresident(userId, cineforumId);
        const award = await this.find(id, cineforumId);
        if (award._count.seasons > 0) throw new httpErrors.Conflict("Premio usato in un'edizione");
        await this.repo.delete(id);
    }

    private async find(id: number, cineforumId: number) {
        const award = await this.repo.findInCineforum(id, cineforumId);
        if (!award) throw new httpErrors.NotFound("Premio non trovato");
        return award;
    }
}
