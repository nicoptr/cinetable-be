import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getInstanceByToken } from "fastify-decorators";
import { buildApp, resetDb, lastEmailTo, TEST_OUTBOX } from "./helpers";
import { getPrismaClient } from "@utils/prisma";
import { encryptPasswordSync } from "@utils/crypto";
import { EmailSenderService } from "@services/EmailSenderService";

const URL = "/sub/api";
let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
    app = await buildApp();
    await resetDb();
    await getPrismaClient().user.create({ data: { username: "anna", email: "anna@x.it", password: encryptPasswordSync("password1"), emailVerifiedAt: new Date() } });
});
after(async () => {
    await getPrismaClient().$disconnect();
});

// IP distinto per ogni chiamata: i test non condividono il bucket del rate limit
let ipCounter = 0;
const post = (path: string, payload: object, cookies?: Record<string, string>) =>
    app.inject({ method: "POST", url: `${URL}${path}`, remoteAddress: `10.1.0.${++ipCounter}`, payload, cookies });
const register = (payload: object) => post("/auth/register", payload);
const tokenFrom = (email: string) => /token=([0-9a-f]{64})/.exec(lastEmailTo(email).html)![1]!;

test("registrazione → email di verifica → verifica → cookie", async () => {
    const r = await register({ email: " Bea@X.it ", username: "bea", password: "password1" });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().email, "bea@x.it");
    assert.equal(r.cookies.length, 0);
    const token = tokenFrom("bea@x.it");
    const v = await post("/auth/verify-email", { token });
    assert.equal(v.statusCode, 200);
    assert.ok(v.cookies.find(c => c.name === "cinofili_token"));
    const again = await post("/auth/verify-email", { token });
    assert.equal(again.statusCode, 400);
    assert.equal(again.json().message, "Link non valido o scaduto");
});

test("login prima della verifica → 403 EMAIL_NOT_VERIFIED", async () => {
    await register({ email: "carl@x.it", username: "carl", password: "password1" });
    const res = await post("/auth/login", { usernameOrEmail: "carl@x.it", password: "password1" });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "EMAIL_NOT_VERIFIED");
});

test("campi extra nella registrazione → 400", async () => {
    const res = await register({ email: "eve@x.it", username: "eve", password: "password1", isPlatformAdmin: true });
    assert.equal(res.statusCode, 400);
});

test("email o username duplicati → 409", async () => {
    const e = await register({ email: "ANNA@x.it", username: "altro", password: "password1" });
    assert.equal(e.statusCode, 409);
    assert.equal(e.json().message, "Email o username già in uso");
    const u = await register({ email: "nuova@x.it", username: "anna", password: "password1" });
    assert.equal(u.statusCode, 409);
});

test("registrazione con inviteToken vuoto o sconosciuto → 400, nessun utente creato", async () => {
    const res = await register({ email: "inv@x.it", username: "inv", password: "password1", inviteToken: "abc" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().message, "Invito non valido o scaduto");
    const empty = await register({ email: "inv@x.it", username: "inv", password: "password1", inviteToken: "" });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().message, "Invito non valido o scaduto");
    assert.equal(await getPrismaClient().user.count({ where: { email: "inv@x.it" } }), 0);
});

test("resend-verification: 204 sempre, email solo se non verificato", async () => {
    await register({ email: "dan@x.it", username: "dan", password: "password1" });
    TEST_OUTBOX.length = 0;
    assert.equal((await post("/auth/resend-verification", { email: "dan@x.it" })).statusCode, 204);
    assert.equal(TEST_OUTBOX.length, 1);
    assert.equal((await post("/auth/resend-verification", { email: "anna@x.it" })).statusCode, 204);
    assert.equal((await post("/auth/resend-verification", { email: "nessuno@x.it" })).statusCode, 204);
    assert.equal(TEST_OUTBOX.length, 1);
});

test("reset password invalida le sessioni vecchie", async () => {
    const login = (password: string) => post("/auth/login", { usernameOrEmail: "anna@x.it", password });
    const cookieA = { cinofili_token: (await login("password1")).cookies.find(c => c.name === "cinofili_token")!.value };
    assert.equal((await post("/auth/forgot-password", { email: "anna@x.it" })).statusCode, 204);
    const html = lastEmailTo("anna@x.it").html;
    assert.match(html, /reimposta-password\?token=/);
    const token = tokenFrom("anna@x.it");
    assert.equal((await post("/auth/reset-password", { token, password: "nuovapass1" })).statusCode, 204);
    assert.equal((await post("/auth/reset-password", { token, password: "altrapass1" })).statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url: `${URL}/auth/me`, cookies: cookieA })).statusCode, 401);
    assert.equal((await login("nuovapass1")).statusCode, 200);
    assert.equal((await login("password1")).statusCode, 401);
});

test("reset password verifica l'email se non lo era", async () => {
    await post("/auth/forgot-password", { email: "carl@x.it" });
    await post("/auth/reset-password", { token: tokenFrom("carl@x.it"), password: "password2" });
    const res = await post("/auth/login", { usernameOrEmail: "carl", password: "password2" });
    assert.equal(res.statusCode, 200);
});

test("forgot-password su email inesistente → 204 e nessuna email", async () => {
    TEST_OUTBOX.length = 0;
    assert.equal((await post("/auth/forgot-password", { email: "boh@x.it" })).statusCode, 204);
    assert.equal(TEST_OUTBOX.length, 0);
});

test("SMTP giù: la registrazione riesce lo stesso", async () => {
    const mailer = getInstanceByToken<EmailSenderService>(EmailSenderService);
    const original = mailer.transporter;
    mailer.transporter = { sendMail: async () => { throw new Error("smtp down"); } } as unknown as typeof original;
    try {
        const res = await register({ email: "fay@x.it", username: "fay", password: "password1" });
        assert.equal(res.statusCode, 201);
    } finally {
        mailer.transporter = original;
    }
});

test("PATCH /users/me: username e avatar https", async () => {
    const login = await post("/auth/login", { usernameOrEmail: "carl", password: "password2" });
    const cookies = { cinofili_token: login.cookies[0]!.value };
    const patch = (payload: object) => app.inject({ method: "PATCH", url: `${URL}/users/me`, cookies, payload });
    assert.equal((await app.inject({ method: "PATCH", url: `${URL}/users/me`, payload: {} })).statusCode, 401);
    const ok = await patch({ username: "carlo", avatarUrl: "https://x.it/a.png" });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().username, "carlo");
    assert.equal(ok.json().avatarUrl, "https://x.it/a.png");
    assert.equal((await patch({ avatarUrl: "http://x.it/a.png" })).statusCode, 400);
    assert.equal((await patch({ username: "anna" })).statusCode, 409);
});

test("PATCH /users/me/password: cambia, invalida le altre sessioni, mantiene la corrente", async () => {
    const login = (password: string) => post("/auth/login", { usernameOrEmail: "carlo", password });
    const old = { cinofili_token: (await login("password2")).cookies[0]!.value };
    const patch = (payload: object) => app.inject({ method: "PATCH", url: `${URL}/users/me/password`, cookies: old, payload });
    assert.equal((await patch({ currentPassword: "sbagliata1", newPassword: "terzapass1" })).statusCode, 400);
    const res = await patch({ currentPassword: "password2", newPassword: "terzapass1" });
    assert.equal(res.statusCode, 204);
    const fresh = { cinofili_token: res.cookies.find(c => c.name === "cinofili_token")!.value };
    assert.equal((await app.inject({ method: "GET", url: `${URL}/auth/me`, cookies: old })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: `${URL}/auth/me`, cookies: fresh })).statusCode, 200);
    assert.equal((await login("terzapass1")).statusCode, 200);
});

test("username che sembra un'email, caratteri non ammessi o password > 72: 400", async () => {
    assert.equal((await register({ email: "v@x.it", username: "victim@x.it", password: "password1" })).statusCode, 400);
    assert.equal((await register({ email: "w@x.it", username: "wi<b>x", password: "password1" })).statusCode, 400);
    assert.equal((await register({ email: "p@x.it", username: "pippo", password: "a".repeat(73) })).statusCode, 400);
});

test("errori 4xx di Fastify non diventano 500 (body JSON vuoto)", async () => {
    const r = await app.inject({
        method: "POST", url: `${URL}/auth/logout`, remoteAddress: `10.1.0.${++ipCounter}`,
        headers: { "content-type": "application/json" }, payload: "",
    });
    assert.equal(r.statusCode, 400);
    assert.equal(typeof r.json().code, "string");
});
