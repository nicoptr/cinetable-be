import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, DELETE, GET, PATCH, POST } from "fastify-decorators";
import { z } from "zod";
import { AwardService } from "@services/AwardService";
import { AwardDTO, AwardInputSchema, AwardSchema, AwardUpdateDTO, AwardUpdateSchema } from "@models/Award";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Item = { id: string; awardId: string };

@Controller({
    route: "/cineforums/:id/awards",
    tags: [{ name: "Awards", description: "Awards of a cineforum" }],
})
export class AwardController {
    constructor(private readonly service: AwardService) {}

    @GET("/", {
        schema: { operationId: "listAwards", summary: "List awards (members)", response: { 200: z.array(AwardSchema) } },
        onRequest: [Authenticate()],
    })
    async list(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.list(req.user.id, parseId(req.params.id)));
    }

    @POST("/", {
        schema: { operationId: "createAward", summary: "Create (award, president only)", body: AwardInputSchema, response: { 201: AwardSchema } },
        onRequest: [Authenticate()],
    })
    async create(req: FastifyRequest<{ Params: { id: string }; Body: AwardDTO }>, reply: FastifyReply) {
        reply.status(201).send(await this.service.create(req.user.id, parseId(req.params.id), req.body));
    }

    @PATCH("/:awardId", {
        schema: { operationId: "updateAward", summary: "Update (president only)", body: AwardUpdateSchema, response: { 200: AwardSchema } },
        onRequest: [Authenticate()],
    })
    async update(req: FastifyRequest<{ Params: Item; Body: AwardUpdateDTO }>, reply: FastifyReply) {
        const { id, awardId } = req.params;
        reply.status(200).send(await this.service.update(req.user.id, parseId(id), parseId(awardId, "Award non trovato"), req.body));
    }

    @DELETE("/:awardId", {
        schema: { operationId: "deleteAward", summary: "Delete; 409 if used in a season (president only)" },
        onRequest: [Authenticate()],
    })
    async delete(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        const { id, awardId } = req.params;
        await this.service.delete(req.user.id, parseId(id), parseId(awardId, "Award non trovato"));
        reply.status(204).send();
    }
}
