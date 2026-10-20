import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";
import { AwardDTO, AwardUpdateDTO } from "@models/Award";

const select = { id: true, name: true, question: true } as const;

@Service()
export class AwardRepository {
    private get db() {
        return getPrismaClient();
    }

    list(cineforumId: number) {
        return this.db.award.findMany({ where: { cineforumId }, select, orderBy: { id: "asc" } });
    }

    create(cineforumId: number, data: AwardDTO) {
        return this.db.award.create({ data: { ...data, cineforumId }, select });
    }

    /** Un premio di un altro cineforum non esiste: null. */
    findInCineforum(id: number, cineforumId: number) {
        return this.db.award.findFirst({ where: { id, cineforumId }, select: { id: true, _count: { select: { seasons: true } } } });
    }

    /** Rassegne avviate (non più bozze) che usano il premio. */
    countStartedSeasons(id: number) {
        return this.db.seasonAward.count({ where: { awardId: id, season: { status: { not: "DRAFT" } } } });
    }

    update(id: number, data: AwardUpdateDTO) {
        return this.db.award.update({ where: { id }, data, select });
    }

    delete(id: number) {
        return this.db.award.delete({ where: { id } });
    }
}
