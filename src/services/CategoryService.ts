import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { CategoryRepository } from "@repositories/CategoryRepository";
import { CategoryDTO, CategoryUpdateDTO } from "@models/Category";
import { requireMember, requirePresident } from "@utils/membership";

@Service()
export class CategoryService {
    constructor(private readonly repo: CategoryRepository) {}

    async list(userId: number, cineforumId: number) {
        await requireMember(userId, cineforumId);
        return this.repo.list(cineforumId);
    }

    async create(userId: number, cineforumId: number, data: CategoryDTO) {
        await requirePresident(userId, cineforumId);
        return this.repo.create(cineforumId, data);
    }

    async update(userId: number, cineforumId: number, id: number, data: CategoryUpdateDTO) {
        await requirePresident(userId, cineforumId);
        await this.find(id, cineforumId);
        // gli archivi passati non cambiano
        if (await this.repo.countStartedSeasons(id)) throw new httpErrors.Conflict("Usata in una rassegna avviata: crea una nuova categoria");
        return this.repo.update(id, data);
    }

    async delete(userId: number, cineforumId: number, id: number) {
        await requirePresident(userId, cineforumId);
        const category = await this.find(id, cineforumId);
        if (category._count.seasons > 0) throw new httpErrors.Conflict("Categoria usata in una rassegna");
        await this.repo.delete(id);
    }

    private async find(id: number, cineforumId: number) {
        const category = await this.repo.findInCineforum(id, cineforumId);
        if (!category) throw new httpErrors.NotFound("Categoria non trovata");
        return category;
    }
}
