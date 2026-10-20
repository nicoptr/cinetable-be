import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, GET, PATCH, POST, PUT } from "fastify-decorators";
import { CandidatureService } from "@services/CandidatureService";
import {
    CandidatureDTO, CandidatureInputSchema, CandidatureProgressSchema, MyCandidatureViewSchema, ProgramItemSchema, ScreeningDTO, ScreeningInputSchema,
} from "@models/Candidature";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Params = { id: string; seasonId: string };
const ids = (p: Params) => [parseId(p.id), parseId(p.seasonId, "Rassegna non trovata")] as const;

@Controller({
    route: "/cineforums/:id/seasons/:seasonId",
    tags: [{ name: "Candidatures", description: "Secret movie candidatures of a season" }],
})
export class CandidatureController {
    constructor(private readonly service: CandidatureService) {}

    @PUT("/candidature", {
        schema: { operationId: "submitCandidature", summary: "Propose or change my movie (participants)", body: CandidatureInputSchema, response: { 200: MyCandidatureViewSchema } },
        onRequest: [Authenticate()],
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

    @PATCH("/candidatures/:candidatureId/screening", {
        schema: { operationId: "planScreening", summary: "Set date and place of a revealed movie (president only)", body: ScreeningInputSchema, response: { 200: ProgramItemSchema } },
        onRequest: [Authenticate()],
    })
    async planScreening(req: FastifyRequest<{ Params: Params & { candidatureId: string }; Body: ScreeningDTO }>, reply: FastifyReply) {
        const candidatureId = parseId(req.params.candidatureId, "Film non trovato");
        reply.status(200).send(await this.service.planScreening(req.user.id, ...ids(req.params), candidatureId, req.body));
    }
}
