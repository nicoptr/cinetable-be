import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb, TEST_OUTBOX } from "./helpers";
import { makeCineforum, makeUser, stubTmdb } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";

const URL = "/sub/api";
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
let app: Awaited<ReturnType<typeof buildApp>>;

const MOVIES = [
    { tmdbId: 1091, title: "La <cosa>", originalTitle: "The Thing", year: 1982, posterPath: null },
    { tmdbId: 550, title: "Fight <Club>", originalTitle: "Fight Club", year: 1999, posterPath: null },
    { tmdbId: 603, title: "<Matrix>", originalTitle: "The Matrix", year: 1999, posterPath: null },
    { tmdbId: 680, title: "Pulp <Fiction>", originalTitle: "Pulp Fiction", year: 1994, posterPath: null },
];

before(async () => {
    app = await buildApp();
    await resetDb();
    stubTmdb(MOVIES);
});
after(async () => {
    await getPrismaClient().$disconnect();
});

type U = Awaited<ReturnType<typeof makeUser>>;

/** Edizione con due premi, primo film svelato e già proiettato (voto non ancora aperto). */
async function setup(tag: string) {
    const db = getPrismaClient();
    const presi = await makeUser(`presi-${tag}@x.it`);
    const [A, B, C] = [await makeUser(`a-${tag}@x.it`), await makeUser(`b-${tag}@x.it`), await makeUser(`c-${tag}@x.it`)];
    const users = [presi, A, B, C];
    const cf = await makeCineforum(presi, [A, B, C]);
    const category = await db.category.create({ data: { cineforumId: cf, name: `Categoria ${tag}` } });
    const awards = [
        await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Regia?" } }),
        await db.award.create({ data: { cineforumId: cf, name: "Trama", question: "Trama?" } }),
    ];
    const other = await db.award.create({ data: { cineforumId: cf, name: "Estraneo", question: "Estraneo?" } });
    const created = await app.inject({
        method: "POST", url: `${URL}/cineforums/${cf}/seasons`, cookies: presi.cookies,
        payload: { name: `Edizione ${tag}`, candidaturesCloseAt: days(7), categoryIds: [category.id], awardIds: awards.map(a => a.id), participantUserIds: users.map(u => u.id) },
    });
    const id: number = created.json().id;
    const base = `${URL}/cineforums/${cf}/seasons/${id}`;
    await app.inject({ method: "POST", url: `${base}/launch`, cookies: presi.cookies });
    for (const [i, u] of users.entries()) {
        await app.inject({ method: "PUT", url: `${base}/candidature`, cookies: u.cookies, payload: { tmdbId: MOVIES[i]!.tmdbId } });
    }
    await db.season.update({ where: { id }, data: { candidaturesCloseAt: new Date(Date.now() - 1000) } });
    const item = (await app.inject({ method: "POST", url: `${base}/reveal-next`, cookies: presi.cookies })).json();
    const order: number = item.order;
    // l'id resta interno: lo legge solo il test, dal DB
    const row = await db.candidature.findFirstOrThrow({ where: { seasonId: id, projectionOrder: order }, include: { participant: true } });
    const cid = row.id;
    await db.candidature.update({ where: { id: cid }, data: { screeningAt: new Date(Date.now() - 1000) } });
    const proposer = users.find(u => u.id === row.participant.userId)!;
    const voters = users.filter(u => u !== proposer && u !== presi); // votanti semplici, non presidente
    const path = `${base}/program/${order}`;
    const full = (v: number) => ({ votes: awards.map(a => ({ awardId: a.id, value: v })) });
    const vote = (who: U, payload: object = full(70)) => app.inject({ method: "POST", url: `${path}/votes`, cookies: who.cookies, payload });
    const open = (who: U = presi) => app.inject({ method: "POST", url: `${path}/open-voting`, cookies: who.cookies });
    const remind = (who: U = presi) => app.inject({ method: "POST", url: `${path}/vote-reminder`, cookies: who.cookies });
    const mine = (who: U) => app.inject({ method: "GET", url: `${path}/votes/me`, cookies: who.cookies });
    const season = (who: U) => app.inject({ method: "GET", url: base, cookies: who.cookies });
    TEST_OUTBOX.length = 0;
    return { presi, users, proposer, voters, awards, other, id, base, cid, order, path, full, vote, open, remind, mine, season };
}

test("voto completo, immutabile, non sul proprio film", async () => {
    const s = await setup("a");
    assert.equal((await s.open()).statusCode, 200);
    const [v] = s.voters;
    assert.equal((await s.mine(v!)).json().length, 0);
    const ok = await s.vote(v!);
    assert.equal(ok.statusCode, 201);
    assert.deepEqual(ok.json(), { submitted: true });
    const again = await s.vote(v!);
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().message, "Hai già votato questo film");
    assert.equal((await s.mine(v!)).json().length, 2);
    const own = await s.vote(s.proposer);
    assert.equal(own.statusCode, 403);
    assert.equal(own.json().message, "Non puoi votare il tuo film");
    const item = (await s.season(v!)).json().program[0];
    assert.equal(item.myVoteSubmitted, true);
    assert.equal(item.votesMissing, undefined);
    // non membro: 404
    const stranger = await makeUser("stranger-a@x.it");
    assert.equal((await s.vote(stranger)).statusCode, 404);
});

test("voti incompleti o premio estraneo → 400", async () => {
    const s = await setup("b");
    await s.open();
    const [v] = s.voters;
    const [a1, a2] = s.awards;
    const bad = [
        { votes: [{ awardId: a1!.id, value: 50 }] },
        { votes: [{ awardId: a1!.id, value: 50 }, { awardId: a1!.id, value: 60 }] },
        { votes: [{ awardId: a1!.id, value: 50 }, { awardId: a2!.id, value: 50 }, { awardId: s.other.id, value: 50 }] },
        { votes: [{ awardId: a1!.id, value: 50 }, { awardId: s.other.id, value: 50 }] },
    ];
    for (const p of bad) {
        const r = await s.vote(v!, p);
        assert.equal(r.statusCode, 400);
        assert.equal(r.json().message, "Vota tutti gli award, una volta ciascuno");
    }
    for (const value of [-1, 101, 1.5, "7"]) {
        assert.equal((await s.vote(v!, { votes: [{ awardId: a1!.id, value }, { awardId: a2!.id, value: 1 }] })).statusCode, 400);
    }
    assert.equal((await s.vote(v!, { votes: s.full(1).votes, x: 1 })).statusCode, 400);
    assert.equal(await getPrismaClient().vote.count({ where: { candidatureId: s.cid } }), 0);
    // estremi validi
    assert.equal((await s.vote(v!, { votes: [{ awardId: a1!.id, value: 0 }, { awardId: a2!.id, value: 100 }] })).statusCode, 201);
});

test("voto prima dell'apertura → 400; stagione chiusa → 400", async () => {
    const s = await setup("c");
    const [v] = s.voters;
    const early = await s.vote(v!);
    assert.equal(early.statusCode, 400);
    assert.equal(early.json().message, "Il voto non è aperto");
    await s.open();
    for (const status of ["FINAL", "DONE"] as const) {
        await getPrismaClient().season.update({ where: { id: s.id }, data: { status } });
        const r = await s.vote(v!);
        assert.equal(r.statusCode, 400);
        assert.equal(r.json().message, "Le votazioni sono chiuse");
        assert.equal((await s.open()).json().message, "Non modificabile in questa fase");
        assert.equal((await s.remind()).json().message, "Non modificabile in questa fase");
    }
});

test("doppio invio simultaneo → un 201 e un 409", async () => {
    const s = await setup("d");
    await s.open();
    const [v] = s.voters;
    const rs = await Promise.all([s.vote(v!), s.vote(v!)]);
    assert.deepEqual(rs.map(r => r.statusCode).sort(), [201, 409]);
    assert.equal(await getPrismaClient().vote.count({ where: { candidatureId: s.cid } }), 2);
});

test("presidente vede votesMissing, gli altri no; vote-reminder restituisce solo il numero", async () => {
    const s = await setup("e");
    await s.open();
    assert.equal((await s.season(s.presi)).json().program[0].votesMissing, 3);
    await s.vote(s.voters[0]!);
    assert.equal((await s.season(s.presi)).json().program[0].votesMissing, 2);
    for (const u of s.users.filter(u => u !== s.presi)) assert.equal((await s.season(u)).json().program[0].votesMissing, undefined);

    TEST_OUTBOX.length = 0;
    const reminder = await s.remind();
    assert.equal(reminder.statusCode, 200);
    assert.deepEqual(Object.keys(reminder.json()), ["sent"]);
    assert.equal(reminder.json().sent, 2);
    assert.equal(TEST_OUTBOX.length, 2);
    for (const m of TEST_OUTBOX) assert.equal(m.subject, "Manca il tuo voto");
    const db = getPrismaClient();
    const voted = (await db.user.findUniqueOrThrow({ where: { id: s.voters[0]!.id } })).email;
    const proposer = (await db.user.findUniqueOrThrow({ where: { id: s.proposer.id } })).email;
    assert.ok(!TEST_OUTBOX.some(m => m.to === voted || m.to === proposer));
});

test("open-voting prima della proiezione → 400; poi idempotente con email", async () => {
    const s = await setup("f");
    const db = getPrismaClient();
    await db.candidature.update({ where: { id: s.cid }, data: { screeningAt: new Date(Date.now() + 86400000) } });
    const early = await s.open();
    assert.equal(early.statusCode, 400);
    assert.equal(early.json().message, "Il voto si apre dopo la proiezione");
    await db.candidature.update({ where: { id: s.cid }, data: { screeningAt: null } });
    assert.equal((await s.open()).statusCode, 400);
    await db.candidature.update({ where: { id: s.cid }, data: { screeningAt: new Date(Date.now() - 1000) } });

    assert.equal((await s.open(s.voters[0]!)).statusCode, 403);
    assert.equal((await s.remind()).statusCode, 400); // voto non ancora aperto
    const r = await s.open();
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().votingOpen, true);
    assert.equal(TEST_OUTBOX.length, 3);
    assert.ok(r.json().movie.title.includes("<"));
    const title = r.json().movie.title.replace("<", "&lt;").replace(">", "&gt;");
    for (const m of TEST_OUTBOX) {
        assert.equal(m.subject, `Vota il film: ${r.json().movie.title}`);
        assert.ok(m.html.includes(title), m.html);
    }
    const proposer = (await db.user.findUniqueOrThrow({ where: { id: s.proposer.id } })).email;
    assert.ok(!TEST_OUTBOX.some(m => m.to === proposer));
    TEST_OUTBOX.length = 0;
    assert.equal((await s.open()).statusCode, 200);
    assert.equal(TEST_OUTBOX.length, 0);
});

test("ordine non svelato, inesistente o non numerico → 404 identico", async () => {
    const s = await setup("g");
    const hidden = await getPrismaClient().candidature.findFirstOrThrow({ where: { seasonId: s.id, revealedAt: null } });
    assert.notEqual(hidden.projectionOrder, null);
    const at = (order: string | number, suffix: string, who: U, method: "GET" | "POST" = "POST") =>
        app.inject({ method, url: `${s.base}/program/${order}/${suffix}`, cookies: who.cookies, payload: method === "POST" ? s.full(1) : undefined });
    const ref = await at(999999, "votes/me", s.voters[0]!, "GET");
    assert.equal(ref.statusCode, 404);
    for (const order of [hidden.projectionOrder!, 999999, 0, "abc"]) {
        assert.equal((await at(order, "open-voting", s.presi)).statusCode, 404);
        assert.equal((await at(order, "vote-reminder", s.presi)).statusCode, 404);
        assert.equal((await at(order, "votes", s.voters[0]!)).statusCode, 404);
        const me = await at(order, "votes/me", s.voters[0]!, "GET");
        assert.equal(me.statusCode, ref.statusCode);
        assert.equal(me.body, ref.body);
    }
    // l'ordine svelato risponde
    assert.equal((await at(s.order, "votes/me", s.voters[0]!, "GET")).statusCode, 200);
});
