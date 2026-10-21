import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, DELETE, GET, PATCH, POST } from "fastify-decorators";
import { z } from "zod";
import { SeasonService } from "@services/SeasonService";
import { ResultsService } from "@services/ResultsService";
import { SummaryService } from "@services/SummaryService";
import { AwardResultSchema, SeasonResultsSchema, SeasonDTO, SeasonInputSchema, SeasonListItemSchema, SeasonSummarySchema, SeasonUpdateDTO, SeasonUpdateSchema, SeasonViewSchema } from "@models/Season";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Item = { id: string; seasonId: string };
const seasonId = (p: Item) => parseId(p.seasonId, "Edizione non trovata");

@Controller({
    route: "/cineforums/:id/seasons",
    tags: [{ name: "Seasons", description: "Seasons (edizioni) of a cineforum" }],
})
export class SeasonController {
    constructor(private readonly service: SeasonService, private readonly results: ResultsService, private readonly summary: SummaryService) {}

    @GET("/", {
        schema: { operationId: "listSeasons", summary: "List seasons (members)", response: { 200: z.array(SeasonListItemSchema) } },
        onRequest: [Authenticate()],
    })
    async list(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.list(req.user.id, parseId(req.params.id)));
    }

    @POST("/", {
        schema: { operationId: "createSeason", summary: "Create a draft season (president only)", body: SeasonInputSchema, response: { 201: SeasonViewSchema } },
        onRequest: [Authenticate()],
    })
    async create(req: FastifyRequest<{ Params: { id: string }; Body: SeasonDTO }>, reply: FastifyReply) {
        reply.status(201).send(await this.service.create(req.user.id, parseId(req.params.id), req.body));
    }

    @GET("/:seasonId", {
        schema: { operationId: "getSeason", summary: "Season detail (members)", response: { 200: SeasonViewSchema } },
        onRequest: [Authenticate()],
    })
    async get(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.get(req.user.id, parseId(req.params.id), seasonId(req.params)));
    }

    @PATCH("/:seasonId", {
        schema: { operationId: "updateSeason", summary: "Update, fields depend on status (president only)", body: SeasonUpdateSchema, response: { 200: SeasonViewSchema } },
        onRequest: [Authenticate()],
    })
    async update(req: FastifyRequest<{ Params: Item; Body: SeasonUpdateDTO }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.update(req.user.id, parseId(req.params.id), seasonId(req.params), req.body));
    }

    @DELETE("/:seasonId", {
        schema: { operationId: "deleteSeason", summary: "Delete a draft season (president only)" },
        onRequest: [Authenticate()],
    })
    async delete(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        await this.service.delete(req.user.id, parseId(req.params.id), seasonId(req.params));
        reply.status(204).send();
    }

    @POST("/:seasonId/launch", {
        schema: { operationId: "launchSeason", summary: "Draw categories and open the season (president only)", response: { 200: SeasonViewSchema } },
        onRequest: [Authenticate()],
    })
    async launch(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.launch(req.user.id, parseId(req.params.id), seasonId(req.params)));
    }

    @POST("/:seasonId/awards/:awardId/open", {
        schema: { operationId: "openEnvelope", summary: "Open an award envelope at the final night; idempotent (president only)", response: { 200: AwardResultSchema } },
        onRequest: [Authenticate()],
    })
    async openEnvelope(req: FastifyRequest<{ Params: Item & { awardId: string } }>, reply: FastifyReply) {
        const awardId = parseId(req.params.awardId, "Award non trovato");
        reply.status(200).send(await this.results.open(req.user.id, parseId(req.params.id), seasonId(req.params), awardId));
    }

    @GET("/:seasonId/results", {
        schema: { operationId: "getSeasonResults", summary: "Opened envelopes; every proposer once all are open (members)", response: { 200: SeasonResultsSchema } },
        onRequest: [Authenticate()],
    })
    async getResults(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        reply.status(200).send(await this.results.results(req.user.id, parseId(req.params.id), seasonId(req.params)));
    }

    @GET("/:seasonId/summary", {
        schema: { operationId: "getSeasonSummary", summary: "Permanent recap of a concluded season (members)", response: { 200: SeasonSummarySchema } },
        onRequest: [Authenticate()],
    })
    async getSummary(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        reply.status(200).send(await this.summary.get(req.user.id, parseId(req.params.id), seasonId(req.params)));
    }
}
