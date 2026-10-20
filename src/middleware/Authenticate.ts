import { FastifyReply, FastifyRequest } from "fastify";
import httpErrors from "http-errors";
import { UserRepository } from "@repositories/UserRepository";
import { getInstanceByToken } from "fastify-decorators";

export function Authenticate() {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            await req.jwtVerify();
        } catch (err) {
            throw new httpErrors.Unauthorized();
        }
        const { id, v } = req.user as unknown as { id: number; v: number };
        const user = await getInstanceByToken<UserRepository>(UserRepository).findById(id);
        if (!user || user.tokenVersion !== v) throw new httpErrors.Unauthorized();
        req.user = { id };
    };
}
