import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, DELETE, GET, PATCH, POST, PUT } from "fastify-decorators";
import { CandidatureService } from "@services/CandidatureService";
import {
    CandidatureDTO, CandidatureInputSchema, CandidatureProgressSchema, MyCandidatureViewSchema, NextScreeningSchema, ProgramItemSchema, ScreeningDTO, ScreeningInputSchema,
} from "@models/Candidature";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Params = { id: string; seasonId: string };
const ids = (p: Params) => [parseId(p.id), parseId(p.seasonId, "Edizione non trovata")] as const;

@Controller({
    route: "/cineforums/:id/seasons/:seasonId",
    tags: [{ name: "Candidatures", description: "Secret movie candidatures of a season" }],
})
export class CandidatureController {
    constructor(private readonly service: CandidatureService) {}

    @PUT("/candidature", {
        schema: { operationId: "submitCandidature", summary: "Propose or change my movie (participants)", body: CandidatureInputSchema, response: { 200: MyCandidatureViewSchema } },
        onRequest: [Authenticate()],
        config: { rateLimit: { max: 30, timeWindow: "1 minute", hook: "preHandler", keyGenerator: (req: FastifyRequest) => `user:${req.user.id}` } },
    })
    async submit(req: FastifyRequest<{ Params: Params; Body: CandidatureDTO }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.submit(req.user.id, ...ids(req.params), req.body.tmdbId));
    }

    @GET("/candidature", {
        schema: { operationId: "getMyCandidature", summary: "My latest candidature (participants)", response: { 200: MyCandidatureViewSchema } },
        onRequest: [Authenticate()],
    })
    async mine(req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.mine(req.user.id, ...ids(req.params)));
    }

    @GET("/progress", {
        schema: { operationId: "getCandidatureProgress", summary: "Who still lacks a valid candidature (president only)", response: { 200: CandidatureProgressSchema } },
        onRequest: [Authenticate()],
    })
    async progress(req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.progress(req.user.id, ...ids(req.params)));
    }

    @POST("/reveal-next", {
        schema: { operationId: "revealNextMovie", summary: "Reveal the next movie in random order (president only)", response: { 200: ProgramItemSchema } },
        onRequest: [Authenticate()],
    })
    async revealNext(req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.revealNext(req.user.id, ...ids(req.params)));
    }

    @POST("/next-screening", {
        schema: { operationId: "scheduleNextScreening", summary: "Set date and place of the next movie before revealing it (president only)", body: ScreeningInputSchema, response: { 200: NextScreeningSchema } },
        onRequest: [Authenticate()],
    })
    async scheduleNext(req: FastifyRequest<{ Params: Params; Body: ScreeningDTO }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.scheduleNext(req.user.id, ...ids(req.params), req.body));
    }

    @PATCH("/program/:order/screening", {
        schema: { operationId: "planScreening", summary: "Set date and place of a revealed movie (president only)", body: ScreeningInputSchema, response: { 200: ProgramItemSchema } },
        onRequest: [Authenticate()],
    })
    async planScreening(req: FastifyRequest<{ Params: Params & { order: string }; Body: ScreeningDTO }>, reply: FastifyReply) {
        const order = parseId(req.params.order, "Film non trovato");
        reply.status(200).send(await this.service.planScreening(req.user.id, ...ids(req.params), order, req.body));
    }

    @DELETE("/participants/:userId", {
        schema: { operationId: "removeParticipant", summary: "Remove a participant without a valid movie from an open season (president only)" },
        onRequest: [Authenticate()],
    })
    async removeParticipant(req: FastifyRequest<{ Params: Params & { userId: string } }>, reply: FastifyReply) {
        const target = parseId(req.params.userId, "Partecipante non trovato");
        await this.service.removeParticipant(req.user.id, ...ids(req.params), target);
        reply.status(204).send();
    }
}
