import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./helpers";
import { getPrismaClient } from "@utils/prisma";

after(async () => {
    await getPrismaClient().$disconnect();
});

test("server risponde e rotte vecchie sparite", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/sub/api/events/", payload: {} });
    assert.equal(res.statusCode, 404);
});
