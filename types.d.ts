import http from "http";
import { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, } from "fastify";
import { FastifyBaseLogger } from "fastify/types/logger";
import { ZodTypeProvider } from "fastify-type-provider-zod";

type FastifyApplication = FastifyInstance<
    http.Server,
    RawRequestDefaultExpression<http.Server>,
    RawReplyDefaultExpression<http.Server>,
    FastifyBaseLogger,
    ZodTypeProvider
>;

declare module "fastify" {
    export interface FastifyInstance<
        HttpServer = http.Server,
        HttpRequest = http.IncomingMessage,
        HttpResponse = http.ServerResponse,
    > {
        authenticate: (
            request: FastifyRequest,
            reply: FastifyReply
        ) => Promise<void>;
    }
}

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: { id: number; v: number };
        user: { id: number };
    }
}
