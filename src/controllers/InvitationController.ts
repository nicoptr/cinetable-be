import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, DELETE, GET, POST } from "fastify-decorators";
import { z } from "zod";
import { InvitationService } from "@services/InvitationService";
import { InvitationCreateDTO, InvitationCreateSchema, InvitationViewSchema } from "@models/Invitation";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Params = { Params: { id: string; invitationId: string } };
const invitationId = (req: FastifyRequest<Params>) => parseId(req.params.invitationId, "Invito non trovato");

@Controller({
    route: "/cineforums/:id/invitations",
    tags: [{ name: "Invitations", description: "Cineforum invitations (president side)" }],
})
export class InvitationController {
    constructor(private readonly service: InvitationService) {}

    @POST("/", {
        schema: {
            operationId: "createInvitations",
            summary: "Invite people by email (president only)",
            body: InvitationCreateSchema,
            response: { 201: z.array(InvitationViewSchema) },
        },
        onRequest: [Authenticate()],
        // preHandler: deve girare dopo Authenticate, altrimenti req.user non esiste ancora
        config: { rateLimit: { max: 20, timeWindow: "1 hour", hook: "preHandler", keyGenerator: (req: FastifyRequest) => `user:${req.user.id}` } },
    })
    async create(req: FastifyRequest<{ Params: { id: string }; Body: InvitationCreateDTO }>, reply: FastifyReply) {
        reply.status(201).send(await this.service.create(req.user.id, parseId(req.params.id), req.body.emails));
    }

    @GET("/", {
        schema: {
            operationId: "listInvitations",
            summary: "Invitations of the cineforum (president only)",
            response: { 200: z.array(InvitationViewSchema) },
        },
        onRequest: [Authenticate()],
    })
    async list(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.list(req.user.id, parseId(req.params.id)));
    }

    @POST("/:invitationId/resend", {
        schema: {
            operationId: "resendInvitation",
            summary: "New token, new expiry and a new email (president only)",
            response: { 200: InvitationViewSchema },
        },
        onRequest: [Authenticate()],
    })
    async resend(req: FastifyRequest<Params>, reply: FastifyReply) {
        reply.status(200).send(await this.service.resend(req.user.id, parseId(req.params.id), invitationId(req)));
    }

    @DELETE("/:invitationId", {
        schema: {
            operationId: "revokeInvitation",
            summary: "Revoke a pending invitation (president only)",
            response: { 200: InvitationViewSchema },
        },
        onRequest: [Authenticate()],
    })
    async revoke(req: FastifyRequest<Params>, reply: FastifyReply) {
        reply.status(200).send(await this.service.revoke(req.user.id, parseId(req.params.id), invitationId(req)));
    }
}
