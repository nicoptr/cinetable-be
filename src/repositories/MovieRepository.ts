import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";
import { TmdbMovie } from "@models/Movie";

@Service()
export class MovieRepository {
    upsert(m: TmdbMovie) {
        const { tmdbId, ...data } = m;
        return getPrismaClient().movie.upsert({ where: { tmdbId }, create: m, update: data });
    }
}
