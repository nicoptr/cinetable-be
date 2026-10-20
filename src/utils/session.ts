import { FastifyReply } from "fastify";

export const SESSION_COOKIE = "cinofili_token";
const SEVEN_DAYS = 7 * 24 * 60 * 60;

const cookieOptions = () => ({
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
});

export async function setSessionCookie(reply: FastifyReply, user: { id: number; tokenVersion: number }): Promise<void> {
    const token = await reply.jwtSign({ id: user.id, v: user.tokenVersion });
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SEVEN_DAYS });
}

export function clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, cookieOptions());
}
