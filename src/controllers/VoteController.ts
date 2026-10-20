import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, GET, POST } from "fastify-decorators";
import { z } from "zod";
import { VoteService } from "@services/VoteService";
import { ProgramItemSchema } from "@models/Candidature";
import { MyVoteSchema, VoteDTO, VoteInputSchema } from "@models/Vote";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Params = { id: string; seasonId: string; candidatureId: string };
const ids = (p: Params) => [parseId(p.id), parseId(p.seasonId, "Rassegna non trovata"), parseId(p.candidatureId, "Film non trovato")] as const;

@Controller({
    route: "/cineforums/:id/seasons/:seasonId/candidatures/:candidatureId",
    tags: [{ name: "Votes", description: "Immutable votes on screened movies" }],
})
export class VoteController {
    constructor(private readonly service: VoteService) {}

    @POST("/open-voting", {
        schema: { operationId: "openVoting", summary: "Open voting on a screened movie (president only)", response: { 200: ProgramItemSchema } },
        onRequest: [Authenticate()],
    })
    async open(req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.openVoting(req.user.id, ...ids(req.params)));
    }

    @POST("/votes", {
        schema: { operationId: "submitVotes", summary: "Vote every award of the season at once, once (participants)", body: VoteInputSchema, response: { 201: z.object({ submitted: z.literal(true) }) } },
        onRequest: [Authenticate()],
    })
    async vote(req: FastifyRequest<{ Params: Params; Body: VoteDTO }>, reply: FastifyReply) {
        reply.status(201).send(await this.service.vote(req.user.id, ...ids(req.params), req.body));
    }

    @GET("/votes/me", {
        schema: { operationId: "getMyVotes", summary: "My votes on this movie (participants)", response: { 200: z.array(MyVoteSchema) } },
        onRequest: [Authenticate()],
    })
    async mine(req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.mine(req.user.id, ...ids(req.params)));
    }

    @POST("/vote-reminder", {
        schema: { operationId: "sendVoteReminder", summary: "Email whoever has not voted yet; returns only a count (president only)", response: { 200: z.object({ sent: z.number() }) } },
        onRequest: [Authenticate()],
        config: { rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", keyGenerator: (req: FastifyRequest) => `user:${req.user.id}` } },
    })
    async remind(req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.remind(req.user.id, ...ids(req.params)));
    }
}
