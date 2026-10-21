import { buildApp } from "./helpers";
import { getInstanceByToken } from "fastify-decorators";
import { TmdbClient } from "@services/TmdbClient";
import { TmdbMovie } from "@models/Movie";
import { getPrismaClient } from "@utils/prisma";
import { encryptPasswordSync } from "@utils/crypto";

let ipCounter = 0;

/** Utente verificato creato via Prisma + login (un remoteAddress diverso per ogni login). */
export async function makeUser(email: string): Promise<{ id: number; cookies: Record<string, string> }> {
    const app = await buildApp();
    const user = await getPrismaClient().user.create({
        data: { username: email.split("@")[0]!, email, password: encryptPasswordSync("password1"), emailVerifiedAt: new Date() },
    });
    const res = await app.inject({
        method: "POST", url: "/sub/api/auth/login", remoteAddress: `10.2.0.${++ipCounter}`,
        payload: { usernameOrEmail: email, password: "password1" },
    });
    return { id: user.id, cookies: { cinetable_token: res.cookies.find(c => c.name === "cinetable_token")!.value } };
}

/** Cineforum con presidente e membri, creato via Prisma. */
export async function makeCineforum(president: { id: number }, members: { id: number }[] = []): Promise<number> {
    const cineforum = await getPrismaClient().cineforum.create({
        data: {
            name: "Cineforum di test",
            memberships: { create: [{ userId: president.id, role: "PRESIDENT" }, ...members.map(m => ({ userId: m.id, role: "MEMBER" as const }))] },
        },
    });
    return cineforum.id;
}

/** Sostituisce search/getMovie di TmdbClient con versioni che leggono dall'array (nessuna rete). */
export function stubTmdb(movies: TmdbMovie[]): void {
    const client = getInstanceByToken<TmdbClient>(TmdbClient);
    client.search = async (query, _page) => ({
        results: movies.filter(m => m.title.toLowerCase().includes(query.toLowerCase())),
        totalPages: 1,
    });
    client.getMovie = async tmdbId => movies.find(m => m.tmdbId === tmdbId) ?? null;
}
