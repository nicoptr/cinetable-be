import { Membership } from "@prisma/client";
import httpErrors from "http-errors";
import { getPrismaClient } from "@utils/prisma";

/** Non membro e cineforum inesistente sono indistinguibili: sempre 404. */
export async function requireMember(userId: number, cineforumId: number): Promise<Membership> {
    const membership = await getPrismaClient().membership.findUnique({ where: { userId_cineforumId: { userId, cineforumId } } });
    if (!membership) throw new httpErrors.NotFound("Cineforum non trovato");
    return membership;
}

export async function requirePresident(userId: number, cineforumId: number): Promise<Membership> {
    const membership = await requireMember(userId, cineforumId);
    if (membership.role !== "PRESIDENT") throw new httpErrors.Forbidden("Solo il presidente può farlo");
    return membership;
}
