import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./helpers";
import { getPrismaClient } from "@utils/prisma";

after(async () => {
    await getPrismaClient().$disconnect();
});

const me = (headers: Record<string, string> = {}) => buildApp().then(app => app.inject({ method: "GET", url: "/sub/api/auth/me", headers }));

test("senza ORIGIN_SECRET il controllo è spento; Cache-Control: no-store", async () => {
    const res = await me();
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["cache-control"], "no-store");
});

test("con ORIGIN_SECRET serve l'header x-origin-secret uguale", async () => {
    process.env.ORIGIN_SECRET = "segreto-di-prova";
    try {
        for (const headers of [{} as Record<string, string>, { "x-origin-secret": "sbagliato" }, { "x-origin-secret": "segreto-di-prova-" }]) {
            const res = await me(headers);
            assert.equal(res.statusCode, 403);
            assert.equal(res.json().code, "ORIGIN_FORBIDDEN");
            assert.equal(res.headers["cache-control"], "no-store");
        }
        assert.equal((await me({ "x-origin-secret": "segreto-di-prova" })).statusCode, 401);
    } finally {
        delete process.env.ORIGIN_SECRET;
    }
});
