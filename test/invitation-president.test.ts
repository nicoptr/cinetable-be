import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb, lastEmailTo, TEST_OUTBOX } from "./helpers";
import { getPrismaClient } from "@utils/prisma";
import { encryptPasswordSync } from "@utils/crypto";
import { hashToken } from "@utils/tokens";
import { getInstanceByToken } from "fastify-decorators";
import { EmailSenderService } from "@services/EmailSenderService";

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
        method: "POST", url: `${URL}/auth/login`, remoteAddress: `10.2.0.${++ipCounter}`,
        payload: { usernameOrEmail: email, password: "password1" },
    });
    return { userId: user.id, cookies: { cinofili_token: res.cookies.find(c => c.name === "cinofili_token")!.value } };
}
async function setup(presEmail: string, name = "Club") {
    const { cookies, userId } = await loginAs(presEmail);
    const { id } = (await app.inject({ method: "POST", url: `${URL}/cineforums`, cookies, payload: { name } })).json();
    return { cookies, userId, cf: id as number };
}
const invite = (cf: number, cookies: Record<string, string>, emails: string[]) =>
    app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/invitations`, cookies, payload: { emails } });
const tokenOf = (email: string) => /token=([0-9a-f]{64})/.exec(lastEmailTo(email).html)![1]!;

test("invito: email inviata, token mai restituito dall'API", async () => {
    const { cookies, cf } = await setup("pres1@x.it");
    const r = await invite(cf, cookies, ["Carlo@X.it", "carlo@x.it "]);
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().length, 1);
    assert.equal(r.json()[0].status, "PENDING");
    assert.equal(JSON.stringify(r.json()).includes("token"), false);
    assert.match(lastEmailTo("carlo@x.it").html, /invito\?token=[0-9a-f]{64}/);
    const list = await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/invitations`, cookies });
    assert.equal(list.json().length, 1);
    assert.equal(JSON.stringify(list.json()).includes("token"), false);
});

test("rinvio cambia il token: il vecchio non esiste più in DB", async () => {
    const { cookies, cf } = await setup("pres2@x.it");
    const [inv] = (await invite(cf, cookies, ["dina@x.it"])).json();
    const old = tokenOf("dina@x.it");
    const r = await app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/invitations/${inv.id}/resend`, cookies });
    assert.equal(r.statusCode, 200);
    const fresh = tokenOf("dina@x.it");
    assert.notEqual(old, fresh);
    const db = getPrismaClient();
    assert.equal(await db.invitation.findUnique({ where: { tokenHash: hashToken(old) } }), null);
    assert.ok(await db.invitation.findUnique({ where: { tokenHash: hashToken(fresh) } }));
});

test("reinvitare una email esistente rinnova il token senza duplicare", async () => {
    const { cookies, cf } = await setup("pres3@x.it");
    await invite(cf, cookies, ["elia@x.it"]);
    const old = tokenOf("elia@x.it");
    const r = await invite(cf, cookies, ["elia@x.it"]);
    assert.equal(r.json().length, 1);
    assert.notEqual(tokenOf("elia@x.it"), old);
    assert.equal(await getPrismaClient().invitation.count({ where: { cineforumId: cf } }), 1);
});

test("revoca → REVOKED; resend e revoca su REVOKED → 400; scaduto → EXPIRED e rinviabile", async () => {
    const { cookies, cf } = await setup("pres4@x.it");
    const [inv] = (await invite(cf, cookies, ["fede@x.it"])).json();
    const del = await app.inject({ method: "DELETE", url: `${URL}/cineforums/${cf}/invitations/${inv.id}`, cookies });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().status, "REVOKED");
    const base = `${URL}/cineforums/${cf}/invitations/${inv.id}`;
    assert.equal((await app.inject({ method: "POST", url: `${base}/resend`, cookies })).statusCode, 400);
    assert.equal((await app.inject({ method: "DELETE", url: base, cookies })).statusCode, 400);
    assert.equal((await app.inject({ method: "DELETE", url: `${URL}/cineforums/${cf}/invitations/999999`, cookies })).statusCode, 404);

    const [exp] = (await invite(cf, cookies, ["gina@x.it"])).json();
    await getPrismaClient().invitation.update({ where: { id: exp.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const list = await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/invitations`, cookies });
    assert.equal(list.json().find((i: { id: number }) => i.id === exp.id).status, "EXPIRED");
    const re = await app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/invitations/${exp.id}/resend`, cookies });
    assert.equal(re.json().status, "PENDING");
});

test("membro non presidente → 403; estraneo → 404", async () => {
    const { cookies, cf } = await setup("pres5@x.it");
    const { userId, cookies: membro } = await loginAs("membro5@x.it");
    await getPrismaClient().membership.create({ data: { userId, cineforumId: cf, role: "MEMBER" } });
    const { cookies: estraneo } = await loginAs("estraneo5@x.it");
    assert.equal((await invite(cf, membro, ["h@x.it"])).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/invitations`, cookies: membro })).statusCode, 403);
    assert.equal((await invite(cf, estraneo, ["h@x.it"])).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/invitations`, cookies: estraneo })).statusCode, 404);
    assert.equal((await invite(cf, cookies, ["h@x.it"])).statusCode, 201);
});

test("nome cineforum con HTML viene escapato nell'email", async () => {
    const { cookies, cf } = await setup("pres6@x.it", "<img src=x onerror=alert(1)>");
    await invite(cf, cookies, ["ivo@x.it"]);
    const { html } = lastEmailTo("ivo@x.it");
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.equal(html.includes("<img src=x"), false);
});

test("già membro → saltato", async () => {
    const { cookies, cf } = await setup("pres7@x.it");
    const { userId } = await loginAs("socio7@x.it");
    await getPrismaClient().membership.create({ data: { userId, cineforumId: cf, role: "MEMBER" } });
    const before = TEST_OUTBOX.length;
    const r = await invite(cf, cookies, ["socio7@x.it"]);
    assert.equal(r.statusCode, 201);
    assert.deepEqual(r.json(), []);
    assert.equal(TEST_OUTBOX.length, before);
});

test("rate limit per utente: 20 richieste/ora poi 429", async () => {
    const { cookies, cf } = await setup("pres8@x.it");
    for (let i = 0; i < 20; i++) assert.equal((await invite(cf, cookies, [`rl${i}@x.it`])).statusCode, 201);
    assert.equal((await invite(cf, cookies, ["rl-extra@x.it"])).statusCode, 429);
    const { cookies: altro, cf: cf2 } = await setup("pres9@x.it");
    assert.equal((await invite(cf2, altro, ["ok@x.it"])).statusCode, 201);
});

test("limite giornaliero: oltre 100 inviti → 429 senza creare nulla", async () => {
    const { cookies, cf } = await setup("pres-cap@x.it");
    const batch = (from: number) => Array.from({ length: 50 }, (_, i) => `cap${from + i}@x.it`);
    assert.equal((await invite(cf, cookies, batch(0))).statusCode, 201);
    assert.equal((await invite(cf, cookies, batch(50))).statusCode, 201);
    const r = await invite(cf, cookies, ["extra@x.it"]);
    assert.equal(r.statusCode, 429);
    assert.equal(r.json().message, "Hai raggiunto il limite di inviti per oggi");
    assert.equal(await getPrismaClient().invitation.count({ where: { cineforumId: cf } }), 100);
});

test("SMTP giù durante un invito: 201 lo stesso", async () => {
    const { cookies, cf } = await setup("pres-smtp@x.it");
    const mailer = getInstanceByToken<EmailSenderService>(EmailSenderService);
    const original = mailer.transporter;
    mailer.transporter = { sendMail: async () => { throw new Error("smtp down"); } } as unknown as typeof original;
    try {
        const r = await invite(cf, cookies, ["smtpdown@x.it"]);
        assert.equal(r.statusCode, 201);
        assert.equal(r.json().length, 1);
    } finally {
        mailer.transporter = original;
    }
});
