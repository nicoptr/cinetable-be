import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, GET, PATCH, POST } from "fastify-decorators";
import { z } from "zod";
import { SeasonService } from "@services/SeasonService";
import { SeasonDTO, SeasonInputSchema, SeasonSummarySchema, SeasonUpdateDTO, SeasonUpdateSchema, SeasonViewSchema } from "@models/Season";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Item = { id: string; seasonId: string };
const seasonId = (p: Item) => parseId(p.seasonId, "Rassegna non trovata");

@Controller({
    route: "/cineforums/:id/seasons",
    tags: [{ name: "Seasons", description: "Seasons (rassegne) of a cineforum" }],
})
export class SeasonController {
    constructor(private readonly service: SeasonService) {}

    @GET("/", {
        schema: { operationId: "listSeasons", summary: "List seasons (members)", response: { 200: z.array(SeasonSummarySchema) } },
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

    @POST("/:seasonId/launch", {
        schema: { operationId: "launchSeason", summary: "Draw categories and open the season (president only)", response: { 200: SeasonViewSchema } },
        onRequest: [Authenticate()],
    })
    async launch(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.launch(req.user.id, parseId(req.params.id), seasonId(req.params)));
    }
}
