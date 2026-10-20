import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";
import { TmdbMovie } from "@models/Movie";

@Service()
export class MovieRepository {
    find(tmdbId: number): Promise<TmdbMovie | null> {
        return getPrismaClient().movie.findUnique({ where: { tmdbId }, select: { tmdbId: true, title: true, originalTitle: true, year: true, posterPath: true } });
    }

    upsert(m: TmdbMovie) {
        const { tmdbId, ...data } = m;
        return getPrismaClient().movie.upsert({ where: { tmdbId }, create: m, update: data });
    }
}
