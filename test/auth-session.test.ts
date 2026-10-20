import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb } from "./helpers";
import { getPrismaClient } from "@utils/prisma";
import { encryptPasswordSync } from "@utils/crypto";

const URL = "/sub/api/auth";
let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
    app = await buildApp();
    await resetDb();
    const db = getPrismaClient();
    await db.user.create({ data: { username: "anna", email: "anna@x.it", password: encryptPasswordSync("password1"), emailVerifiedAt: new Date() } });
    await db.user.create({ data: { username: "bob", email: "bob@x.it", password: encryptPasswordSync("password1") } });
});
after(async () => {
    await getPrismaClient().$disconnect();
});

const login = (usernameOrEmail: string, password = "password1") =>
    app.inject({ method: "POST", url: `${URL}/login`, payload: { usernameOrEmail, password } });

async function sessionCookie() {
    const res = await login("anna@x.it");
    const c = res.cookies.find(c => c.name === "cinofili_token")!;
    return { cinofili_token: c.value };
}

test("login imposta cookie httpOnly e il JWT non contiene dati sensibili", async () => {
    const res = await login("anna@x.it");
    assert.equal(res.statusCode, 200);
    const c = res.cookies.find(c => c.name === "cinofili_token")!;
    assert.equal(c.httpOnly, true);
    assert.equal(c.sameSite, "Lax");
    const payload = JSON.parse(Buffer.from(c.value.split(".")[1]!, "base64url").toString());
    assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "id", "v"]);
    assert.equal(res.json().password, undefined);
    assert.equal("token" in res.json(), false);
});

test("me senza cookie → 401", async () => {
    const res = await app.inject({ method: "GET", url: `${URL}/me` });
    assert.equal(res.statusCode, 401);
});

test("me con cookie → 200 con memberships []", async () => {
    const res = await app.inject({ method: "GET", url: `${URL}/me`, cookies: await sessionCookie() });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().email, "anna@x.it");
    assert.deepEqual(res.json().memberships, []);
    assert.equal(res.json().password, undefined);
});

test("me con tokenVersion cambiata → 401", async () => {
    const cookies = await sessionCookie();
    await getPrismaClient().user.update({ where: { email: "anna@x.it" }, data: { tokenVersion: { increment: 1 } } });
    const res = await app.inject({ method: "GET", url: `${URL}/me`, cookies });
    assert.equal(res.statusCode, 401);
    await getPrismaClient().user.update({ where: { email: "anna@x.it" }, data: { tokenVersion: 0 } });
});

test("logout cancella il cookie", async () => {
    const res = await app.inject({ method: "POST", url: `${URL}/logout`, cookies: await sessionCookie() });
    assert.equal(res.statusCode, 204);
    const c = res.cookies.find(c => c.name === "cinofili_token")!;
    assert.ok(c.value === "" || c.maxAge === 0);
});

test("password errata → 401 'Username o password non validi!'", async () => {
    const res = await login("anna@x.it", "sbagliata1");
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().message, "Username o password non validi!");
});

test("utente inesistente → 401 identico", async () => {
    const res = await login("nessuno@x.it");
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().message, "Username o password non validi!");
});

test("email non verificata → 403 EMAIL_NOT_VERIFIED", async () => {
    const res = await login("bob");
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "EMAIL_NOT_VERIFIED");
});

test("email con maiuscole e spazi nel login funziona", async () => {
    const res = await login(" ANNA@x.it ");
    assert.equal(res.statusCode, 200);
});
