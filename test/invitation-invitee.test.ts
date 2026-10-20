import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb, lastEmailTo } from "./helpers";
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

let ip = 0;
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ cinofili_token: res.cookies.find(c => c.name === "cinofili_token")!.value });
async function loginAs(email: string) {
    const user = await getPrismaClient().user.create({
        data: { username: email.split("@")[0]!, email, password: encryptPasswordSync("password1"), emailVerifiedAt: new Date() },
    });
    const res = await app.inject({
        method: "POST", url: `${URL}/auth/login`, remoteAddress: `10.3.0.${++ip}`,
        payload: { usernameOrEmail: email, password: "password1" },
    });
    return { userId: user.id, cookies: cookieOf(res) };
}
/** Presidente + invito a `invitee`; restituisce cineforum, cookie del presidente, id invito e token. */
async function setup(presEmail: string, invitee: string) {
    const { cookies } = await loginAs(presEmail);
    const cf = (await app.inject({ method: "POST", url: `${URL}/cineforums`, cookies, payload: { name: "Club" } })).json().id as number;
    const [inv] = (await app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/invitations`, cookies, payload: { emails: [invitee] } })).json();
    const token = /token=([0-9a-f]{64})/.exec(lastEmailTo(invitee.trim().toLowerCase()).html)![1]!;
    return { cookies, cf, id: inv.id as number, token };
}
const register = (payload: object) =>
    app.inject({ method: "POST", url: `${URL}/auth/register`, remoteAddress: `10.3.0.${++ip}`, payload });
const lookup = (token: string) => app.inject({ method: "GET", url: `${URL}/invitations/token/${token}` });
const memberships = (cf: number) => getPrismaClient().membership.count({ where: { cineforumId: cf } });

test("nuovo utente si registra dal link ed è dentro il cineforum", async () => {
    const { cf, token } = await setup("p1@x.it", "Dario@X.it");
    const info = await lookup(token);
    assert.equal(info.statusCode, 200);
    assert.deepEqual(info.json(), { email: "dario@x.it", cineforumName: "Club", invitedBy: "p1", userExists: false });
    const r = await register({ email: " dario@x.it", username: "dario", password: "password1", inviteToken: token });
    assert.equal(r.statusCode, 201);
    const me = await app.inject({ method: "GET", url: `${URL}/auth/me`, cookies: cookieOf(r) });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().memberships[0].role, "MEMBER");
    assert.equal(me.json().memberships[0].cineforumId, cf);
    assert.equal((await getPrismaClient().user.findUniqueOrThrow({ where: { email: "dario@x.it" } })).emailVerifiedAt !== null, true);
});

test("link riusato dopo l'accettazione → 404 e nessuna seconda membership", async () => {
    const { cf, token } = await setup("p2@x.it", "ele@x.it");
    assert.equal((await register({ email: "ele@x.it", username: "ele", password: "password1", inviteToken: token })).statusCode, 201);
    assert.equal((await lookup(token)).statusCode, 404);
    assert.equal((await lookup(token)).json().message, "Invito non valido o scaduto");
    const again = await register({ email: "ele@x.it", username: "ele2", password: "password1", inviteToken: token });
    assert.equal(again.statusCode, 400);
    assert.equal(await memberships(cf), 2);
});

test("invito per un'altra email → 400 e nessun utente creato", async () => {
    const { token } = await setup("p3@x.it", "fra@x.it");
    const r = await register({ email: "altro@x.it", username: "altro", password: "password1", inviteToken: token });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().message, "Questo invito è per un altro indirizzo email");
    assert.equal(await getPrismaClient().user.count({ where: { email: "altro@x.it" } }), 0);
});

test("invito scaduto → 404 su token, 404 su accept, registrazione rifiutata", async () => {
    const { token, id } = await setup("p4@x.it", "gigi@x.it");
    await getPrismaClient().invitation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await lookup(token)).statusCode, 404);
    assert.equal((await register({ email: "gigi@x.it", username: "gigi", password: "password1", inviteToken: token })).statusCode, 400);
    const { cookies } = await loginAs("gigi@x.it");
    assert.equal((await app.inject({ method: "POST", url: `${URL}/invitations/${id}/accept`, cookies })).statusCode, 404);
    assert.deepEqual((await app.inject({ method: "GET", url: `${URL}/invitations/mine`, cookies })).json(), []);
});

test("invito revocato → registrazione con quel token rifiutata", async () => {
    const { cookies, cf, id, token } = await setup("p5@x.it", "hugo@x.it");
    await app.inject({ method: "DELETE", url: `${URL}/cineforums/${cf}/invitations/${id}`, cookies });
    assert.equal((await lookup(token)).statusCode, 404);
    const r = await register({ email: "hugo@x.it", username: "hugo", password: "password1", inviteToken: token });
    assert.equal(r.statusCode, 400);
    assert.equal(await getPrismaClient().user.count({ where: { email: "hugo@x.it" } }), 0);
});

test("utente già registrato: lo vede in /invitations/mine, accetta, diventa MEMBER", async () => {
    const { cf, id, token } = await setup("p6@x.it", "ivo@x.it");
    const { cookies } = await loginAs("ivo@x.it");
    assert.equal((await lookup(token)).json().userExists, true);
    const mine = await app.inject({ method: "GET", url: `${URL}/invitations/mine`, cookies });
    assert.equal(mine.json().length, 1);
    assert.deepEqual({ ...mine.json()[0], expiresAt: undefined }, { id, cineforumId: cf, cineforumName: "Club", invitedBy: "p6" });
    const acc = await app.inject({ method: "POST", url: `${URL}/invitations/${id}/accept`, cookies });
    assert.equal(acc.statusCode, 200);
    assert.deepEqual(acc.json(), { cineforumId: cf });
    const me = await app.inject({ method: "GET", url: `${URL}/auth/me`, cookies });
    assert.equal(me.json().memberships[0].role, "MEMBER");
    assert.equal((await app.inject({ method: "POST", url: `${URL}/invitations/${id}/accept`, cookies })).statusCode, 404);
    assert.equal(await memberships(cf), 2);
});

test("non posso accettare né rifiutare l'invito di un altro → 404", async () => {
    const { cf, id } = await setup("p7@x.it", "lia@x.it");
    const { cookies } = await loginAs("intruso@x.it");
    assert.equal((await app.inject({ method: "POST", url: `${URL}/invitations/${id}/accept`, cookies })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: `${URL}/invitations/${id}/decline`, cookies })).statusCode, 404);
    assert.equal(await memberships(cf), 1);
    assert.equal((await getPrismaClient().invitation.findUniqueOrThrow({ where: { id } })).status, "PENDING");
});

test("decline → sparisce da mine; il presidente lo vede DECLINED", async () => {
    const { cookies: pres, cf, id } = await setup("p8@x.it", "max@x.it");
    const { cookies } = await loginAs("max@x.it");
    assert.equal((await app.inject({ method: "POST", url: `${URL}/invitations/${id}/decline`, cookies })).statusCode, 204);
    assert.deepEqual((await app.inject({ method: "GET", url: `${URL}/invitations/mine`, cookies })).json(), []);
    const list = await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/invitations`, cookies: pres });
    assert.equal(list.json()[0].status, "DECLINED");
    assert.equal((await app.inject({ method: "POST", url: `${URL}/invitations/${id}/accept`, cookies })).statusCode, 404);
});

test("mine e accept richiedono il login", async () => {
    assert.equal((await app.inject({ method: "GET", url: `${URL}/invitations/mine` })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: `${URL}/invitations/1/accept` })).statusCode, 401);
});
