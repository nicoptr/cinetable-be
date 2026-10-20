import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, GET, PATCH, POST } from "fastify-decorators";
import httpErrors from "http-errors";
import { z } from "zod";
import { CineforumService } from "@services/CineforumService";
import {
    CineforumDetailSchema, CineforumDTO, CineforumInputSchema, CineforumListItemSchema, CineforumSchema, CineforumUpdateDTO, CineforumUpdateSchema,
} from "@models/Cineforum";
import { Authenticate } from "@middleware/Authenticate";

/** Un :id non numerico è un cineforum che non esiste: 404, non 400/500. */
function parseId(raw: string): number {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new httpErrors.NotFound("Cineforum non trovato");
    return id;
}

@Controller({
    route: "/cineforums",
    tags: [{ name: "Cineforums", description: "Cineforums and membership" }],
})
export class CineforumController {
    constructor(private readonly service: CineforumService) {}

    @POST("/", {
        schema: {
            operationId: "createCineforum",
            summary: "Create a cineforum; the creator becomes president",
            body: CineforumInputSchema,
            response: { 201: CineforumSchema },
        },
        onRequest: [Authenticate()],
    })
    async create(req: FastifyRequest<{ Body: CineforumDTO }>, reply: FastifyReply) {
        reply.status(201).send(await this.service.create(req.user.id, req.body));
    }

    @GET("/", {
        schema: {
            operationId: "listMyCineforums",
            summary: "Cineforums I belong to",
            response: { 200: z.array(CineforumListItemSchema) },
        },
        onRequest: [Authenticate()],
    })
    async list(req: FastifyRequest, reply: FastifyReply) {
        reply.status(200).send(await this.service.listMine(req.user.id));
    }

    @GET("/:id", {
        schema: {
            operationId: "getCineforum",
            summary: "Cineforum detail with members (members only)",
            response: { 200: CineforumDetailSchema },
        },
        onRequest: [Authenticate()],
    })
    async get(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.get(req.user.id, parseId(req.params.id)));
    }

    @PATCH("/:id", {
        schema: {
            operationId: "updateCineforum",
            summary: "Update name/description (president only)",
            body: CineforumUpdateSchema,
            response: { 200: CineforumSchema },
        },
        onRequest: [Authenticate()],
    })
    async update(req: FastifyRequest<{ Params: { id: string }; Body: CineforumUpdateDTO }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.update(req.user.id, parseId(req.params.id), req.body));
    }
}
