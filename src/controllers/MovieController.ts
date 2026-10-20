import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, GET } from "fastify-decorators";
import { TmdbClient } from "@services/TmdbClient";
import { MovieSearchQuery, MovieSearchQuerySchema, MovieSearchResponseSchema, toMovieView } from "@models/Movie";
import { Authenticate } from "@middleware/Authenticate";

@Controller({ route: "/movies", tags: [{ name: "Movies", description: "TMDB movie search" }] })
export class MovieController {
    constructor(private readonly tmdb: TmdbClient) {}

    @GET("/search", {
        schema: { operationId: "searchMovies", summary: "Search TMDB movies", querystring: MovieSearchQuerySchema, response: { 200: MovieSearchResponseSchema } },
        onRequest: [Authenticate()],
        // preHandler: deve girare dopo Authenticate, altrimenti req.user non esiste ancora
        config: { rateLimit: { max: 30, timeWindow: "1 minute", hook: "preHandler", keyGenerator: (req: FastifyRequest) => `user:${req.user.id}` } },
    })
    async search(req: FastifyRequest<{ Querystring: MovieSearchQuery }>, reply: FastifyReply) {
        const { results, totalPages } = await this.tmdb.search(req.query.q, req.query.page);
        reply.status(200).send({ results: results.map(toMovieView), totalPages });
    }
}
