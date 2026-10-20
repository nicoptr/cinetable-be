import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";
import { CategoryDTO, CategoryUpdateDTO } from "@models/Category";

const select = { id: true, name: true, description: true } as const;

@Service()
export class CategoryRepository {
    private get db() {
        return getPrismaClient();
    }

    list(cineforumId: number) {
        return this.db.category.findMany({ where: { cineforumId }, select, orderBy: { id: "asc" } });
    }

    create(cineforumId: number, data: CategoryDTO) {
        return this.db.category.create({ data: { ...data, cineforumId }, select });
    }

    /** Una categoria di un altro cineforum non esiste: null. */
    findInCineforum(id: number, cineforumId: number) {
        return this.db.category.findFirst({ where: { id, cineforumId }, select: { id: true, _count: { select: { seasons: true } } } });
    }

    update(id: number, data: CategoryUpdateDTO) {
        return this.db.category.update({ where: { id }, data, select });
    }

    delete(id: number) {
        return this.db.category.delete({ where: { id } });
    }
}
