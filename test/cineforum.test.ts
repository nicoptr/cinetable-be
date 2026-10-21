import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb } from "./helpers";
import { getPrismaClient } from "@utils/prisma";
import { encryptPasswordSync } from "@utils/crypto";

const URL = "/sub/api";
let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
    app = await buildApp();
    await resetDb();
});
after(async () => {
    await getPrismaClient().$disconnect();
});

let ipCounter = 0;
async function loginAs(email: string) {
    const user = await getPrismaClient().user.create({
        data: { username: email.split("@")[0]!, email, password: encryptPasswordSync("password1"), emailVerifiedAt: new Date() },
    });
    const res = await app.inject({
        method: "POST", url: `${URL}/auth/login`, remoteAddress: `10.1.0.${++ipCounter}`,
        payload: { usernameOrEmail: email, password: "password1" },
    });
    return { userId: user.id, cookies: { cinetable_token: res.cookies.find(c => c.name === "cinetable_token")!.value } };
}
const create = (cookies: Record<string, string>, payload: object) =>
    app.inject({ method: "POST", url: `${URL}/cineforums`, cookies, payload });

test("chi crea è presidente", async () => {
    const { cookies } = await loginAs("presi@x.it");
    const res = await create(cookies, { name: "  Cinefili  ", description: "Il club" });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.json(), { id: res.json().id, name: "Cinefili", description: "Il club" });
    const list = await app.inject({ method: "GET", url: `${URL}/cineforums`, cookies });
    assert.deepEqual(list.json(), [{ id: res.json().id, name: "Cinefili", description: "Il club", role: "PRESIDENT" }]);
    const one = await app.inject({ method: "GET", url: `${URL}/cineforums/${res.json().id}`, cookies });
    assert.equal(one.json().myRole, "PRESIDENT");
    assert.equal(one.json().members.length, 1);
    assert.equal(one.json().members[0].username, "presi");
});

test("senza cookie → 401, nome troppo corto → 400", async () => {
    assert.equal((await app.inject({ method: "GET", url: `${URL}/cineforums` })).statusCode, 401);
    const { cookies } = await loginAs("v@x.it");
    assert.equal((await create(cookies, { name: "a" })).statusCode, 400);
});

test("non membro → 404 uguale a inesistente", async () => {
    const { cookies } = await loginAs("owner@x.it");
    const { cookies: estraneo } = await loginAs("estraneo@x.it");
    const { id } = (await create(cookies, { name: "Privato" })).json();
    const a = await app.inject({ method: "GET", url: `${URL}/cineforums/${id}`, cookies: estraneo });
    const b = await app.inject({ method: "GET", url: `${URL}/cineforums/999999`, cookies: estraneo });
    assert.equal(a.statusCode, 404);
    assert.deepEqual(a.json(), b.json());
    const p = await app.inject({ method: "PATCH", url: `${URL}/cineforums/${id}`, cookies: estraneo, payload: { name: "Hack" } });
    assert.equal(p.statusCode, 404);
    const c = await app.inject({ method: "GET", url: `${URL}/cineforums/abc`, cookies: estraneo });
    assert.equal(c.statusCode, 404);
});

test("membro non presidente non può modificare → 403; il presidente sì", async () => {
    const { cookies } = await loginAs("pres2@x.it");
    const { userId, cookies: membro } = await loginAs("membro@x.it");
    const { id } = (await create(cookies, { name: "Club" })).json();
    await getPrismaClient().membership.create({ data: { userId, cineforumId: id, role: "MEMBER" } });
    const no = await app.inject({ method: "PATCH", url: `${URL}/cineforums/${id}`, cookies: membro, payload: { name: "Nuovo" } });
    assert.equal(no.statusCode, 403);
    const ok = await app.inject({ method: "PATCH", url: `${URL}/cineforums/${id}`, cookies, payload: { name: "Nuovo" } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().name, "Nuovo");
    const view = await app.inject({ method: "GET", url: `${URL}/cineforums/${id}`, cookies: membro });
    assert.equal(view.json().myRole, "MEMBER");
    assert.equal(view.json().members.length, 2);
});

test("/auth/me elenca le membership", async () => {
    const { cookies } = await loginAs("me@x.it");
    const { id } = (await create(cookies, { name: "MioClub" })).json();
    const res = await app.inject({ method: "GET", url: `${URL}/auth/me`, cookies });
    assert.deepEqual(res.json().memberships, [{ cineforumId: id, name: "MioClub", role: "PRESIDENT" }]);
});
