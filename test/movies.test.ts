import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import httpErrors from "http-errors";
import { getInstanceByToken } from "fastify-decorators";
import { buildApp, resetDb } from "./helpers";
import { makeUser, stubTmdb } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";
import { TmdbClient } from "@services/TmdbClient";

const URL = "/sub/api";
let app: Awaited<ReturnType<typeof buildApp>>;
let cookies: Record<string, string>;

const thing = { tmdbId: 1091, title: "La cosa", originalTitle: "The Thing", year: 1982, posterPath: "/abc.jpg" };

before(async () => {
    app = await buildApp();
    await resetDb();
    cookies = (await makeUser("anna@x.it")).cookies;
});
after(async () => {
    await getPrismaClient().$disconnect();
});

const search = (qs: string, c?: Record<string, string>) => app.inject({ method: "GET", url: `${URL}/movies/search${qs}`, cookies: c });

test("ricerca restituisce MovieView con posterUrl w500", async () => {
    stubTmdb([thing]);
    const res = await search("?q=cosa", cookies);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { results: [{ ...thing, posterUrl: "https://image.tmdb.org/t/p/w500/abc.jpg" }], totalPages: 1 });
});

test("senza login → 401", async () => {
    assert.equal((await search("?q=cosa")).statusCode, 401);
});

test("q vuota → 400", async () => {
    assert.equal((await search("?q=", cookies)).statusCode, 400);
});

test("TMDB giù → 502 'Servizio film non disponibile, riprova'", async () => {
    getInstanceByToken<TmdbClient>(TmdbClient).search = async () => {
        throw new httpErrors.BadGateway("Servizio film non disponibile, riprova");
    };
    const res = await search("?q=cosa", cookies);
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().message, "Servizio film non disponibile, riprova");
});

test("TmdbClient mappa la risposta TMDB", async () => {
    const realFetch = globalThis.fetch;
    const prevToken = process.env.TMDB_API_TOKEN;
    process.env.TMDB_API_TOKEN = "tok-test";
    let seen: { url: string; auth: string | null } | undefined;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        seen = { url: String(input), auth: new Headers(init?.headers).get("Authorization") };
        return new Response(JSON.stringify({
            results: [{ id: 1091, title: "La cosa", original_title: "The Thing", release_date: "1982-06-25", poster_path: "/p.jpg" }],
            total_pages: 1,
        }), { status: 200 });
    }) as typeof fetch;
    try {
        const out = await new TmdbClient().search("la cosa", 1);
        assert.deepEqual(out, { results: [{ tmdbId: 1091, title: "La cosa", originalTitle: "The Thing", year: 1982, posterPath: "/p.jpg" }], totalPages: 1 });
        assert.ok(seen!.url.includes("language=it-IT"));
        assert.ok(seen!.url.includes("query=la%20cosa"));
        assert.equal(seen!.auth, "Bearer tok-test");
    } finally {
        globalThis.fetch = realFetch;
        if (prevToken === undefined) delete process.env.TMDB_API_TOKEN; else process.env.TMDB_API_TOKEN = prevToken;
    }
});
