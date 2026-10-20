import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb } from "./helpers";
import { makeCineforum, makeUser, stubTmdb } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";

const URL = "/sub/api";
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
let app: Awaited<ReturnType<typeof buildApp>>;

const MOVIES = [
    { tmdbId: 1091, title: "La cosa", originalTitle: "The Thing", year: 1982, posterPath: null },
    { tmdbId: 550, title: "Fight Club", originalTitle: "Fight Club", year: 1999, posterPath: null },
    { tmdbId: 603, title: "Matrix", originalTitle: "The Matrix", year: 1999, posterPath: null },
    { tmdbId: 680, title: "Pulp Fiction", originalTitle: "Pulp Fiction", year: 1994, posterPath: null },
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

/** Come final-night: Regia premia il film di A, Trama va a pari merito a B e C; C non vota il film del presidente. */
async function setup(tag: string) {
    const db = getPrismaClient();
    const presi = await makeUser(`presi-${tag}@x.it`);
    const [A, B, C] = [await makeUser(`a-${tag}@x.it`), await makeUser(`b-${tag}@x.it`), await makeUser(`c-${tag}@x.it`)];
    const users = [presi, A, B, C];
    const cf = await makeCineforum(presi, [A, B, C]);
    const category = await db.category.create({ data: { cineforumId: cf, name: `Categoria ${tag}` } });
    const regia = await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Regia?" } });
    const trama = await db.award.create({ data: { cineforumId: cf, name: "Trama", question: "Trama?" } });
    const created = await app.inject({
        method: "POST", url: `${URL}/cineforums/${cf}/seasons`, cookies: presi.cookies,
        payload: { name: `Rassegna ${tag}`, candidaturesCloseAt: days(7), categoryIds: [category.id], awardIds: [regia.id, trama.id], participantUserIds: users.map(u => u.id) },
    });
    const id: number = created.json().id;
    const base = `${URL}/cineforums/${cf}/seasons/${id}`;
    await app.inject({ method: "POST", url: `${base}/launch`, cookies: presi.cookies });
    for (const [i, u] of users.entries()) {
        await app.inject({ method: "PUT", url: `${base}/candidature`, cookies: u.cookies, payload: { tmdbId: MOVIES[i]!.tmdbId } });
    }
    await db.season.update({ where: { id }, data: { candidaturesCloseAt: new Date(Date.now() - 1000) } });
    const films: { cid: number; proposer: U }[] = [];
    for (let i = 0; i < 4; i++) {
        const cid: number = (await app.inject({ method: "POST", url: `${base}/reveal-next`, cookies: presi.cookies })).json().candidatureId;
        await db.candidature.update({ where: { id: cid }, data: { screeningAt: new Date(Date.now() - 1000), location: `Sala ${i}` } });
        await app.inject({ method: "POST", url: `${base}/candidatures/${cid}/open-voting`, cookies: presi.cookies });
        const row = await db.candidature.findUniqueOrThrow({ where: { id: cid }, include: { participant: true } });
        films.push({ cid, proposer: users.find(u => u.id === row.participant.userId)! });
    }
    for (const f of films) {
        for (const v of users.filter(u => u !== f.proposer && !(u === C && f.proposer === presi))) {
            const r = f.proposer === A ? (v === presi ? 91 : 90) : 50;
            const t = f.proposer === B || f.proposer === C ? 80 : 40;
            const res = await app.inject({
                method: "POST", url: `${base}/candidatures/${f.cid}/votes`, cookies: v.cookies,
                payload: { votes: [{ awardId: regia.id, value: r }, { awardId: trama.id, value: t }] },
            });
            assert.equal(res.statusCode, 201);
        }
    }
    const open = (awardId: number) => app.inject({ method: "POST", url: `${base}/awards/${awardId}/open`, cookies: presi.cookies });
    const summary = (who: { cookies: Record<string, string> }) => app.inject({ method: "GET", url: `${base}/summary`, cookies: who.cookies });
    return { presi, A, B, C, regia, trama, cf, id, base, films, open, summary };
}

test("scheda disponibile solo a rassegna conclusa", async () => {
    const s = await setup("a");
    const early = await s.summary(s.A);
    assert.equal(early.statusCode, 404);
    assert.equal(early.json().message, "Scheda disponibile a rassegna conclusa");
    await s.open(s.regia.id);
    assert.equal((await s.summary(s.A)).statusCode, 404);
    await s.open(s.trama.id);
    assert.equal((await s.summary(s.A)).statusCode, 200);
});

test("scheda completa: film in ordine con proponente, medie per premio, vincitori", async () => {
    const s = await setup("b");
    await s.open(s.regia.id);
    await s.open(s.trama.id);
    const res = await s.summary(s.B);
    const body = res.json();
    assert.equal(body.season.id, s.id);
    assert.equal(body.season.name, "Rassegna b");
    assert.ok(!Number.isNaN(Date.parse(body.season.concludedAt)));
    assert.equal(body.categories.length, 1);
    assert.equal(body.participants.length, 4);

    assert.equal(body.films.length, 4);
    assert.deepEqual(body.films.map((f: { order: number }) => f.order), [...body.films.map((f: { order: number }) => f.order)].sort((a, b) => a - b));
    assert.equal(new Set(body.films.map((f: { order: number }) => f.order)).size, 4);
    for (const f of body.films) {
        const mine = s.films.find(x => x.cid && x.proposer.id === f.proposer.userId)!;
        assert.ok(mine);
        assert.equal(f.scores.length, 2);
        assert.equal(typeof f.category.name, "string");
        assert.ok(f.location.startsWith("Sala "));
        assert.ok(f.screeningAt);
    }
    const ofUser = (u: U) => body.films.find((f: { proposer: { userId: number } }) => f.proposer.userId === u.id);
    const fa = ofUser(s.A);
    assert.deepEqual(fa.scores.find((x: { awardId: number }) => x.awardId === s.regia.id), { awardId: s.regia.id, average: 90.3, votes: 3 });
    assert.deepEqual(fa.awardsWon, [s.regia.id]);
    assert.deepEqual(ofUser(s.B).awardsWon, [s.trama.id]);
    assert.deepEqual(ofUser(s.C).awardsWon, [s.trama.id]);
    assert.deepEqual(ofUser(s.presi).awardsWon, []);
    // il presidente è stato votato da 2 su 3: le medie contano solo i voti ricevuti
    assert.equal(ofUser(s.presi).scores[0].votes, 2);

    assert.deepEqual(body.awards.map((a: { awardId: number }) => a.awardId), [s.regia.id, s.trama.id]);
    for (const a of body.awards) {
        for (const w of a.winners) {
            const f = body.films.find((x: { proposer: { userId: number } }) => x.proposer.userId === w.proposer.userId);
            assert.ok(f.awardsWon.includes(a.awardId));
        }
    }
    assert.ok(!res.body.includes('"value"'));
});

test("film senza voti: media null e 0 voti", async () => {
    const s = await setup("c");
    await getPrismaClient().vote.deleteMany({ where: { candidatureId: s.films[0]!.cid } });
    await s.open(s.regia.id);
    await s.open(s.trama.id);
    const f = (await s.summary(s.A)).json().films.find((x: { proposer: { userId: number } }) => x.proposer.userId === s.films[0]!.proposer.id);
    for (const sc of f.scores) assert.deepEqual([sc.average, sc.votes], [null, 0]);
    assert.deepEqual(f.awardsWon, []);
});

test("la scheda resta uguale nel tempo", async () => {
    const s = await setup("d");
    await s.open(s.regia.id);
    await s.open(s.trama.id);
    const first = (await s.summary(s.A)).json();
    assert.deepEqual((await s.summary(s.A)).json(), first);
    const vote = await app.inject({
        method: "POST", url: `${s.base}/candidatures/${s.films[0]!.cid}/votes`, cookies: s.C.cookies,
        payload: { votes: [{ awardId: s.regia.id, value: 1 }, { awardId: s.trama.id, value: 1 }] },
    });
    assert.equal(vote.statusCode, 400);
    const patch = await app.inject({ method: "PATCH", url: s.base, cookies: s.presi.cookies, payload: { description: "nuova" } });
    assert.equal(patch.statusCode, 400);
    const del = await app.inject({ method: "DELETE", url: `${URL}/cineforums/${s.cf}/awards/${s.regia.id}`, cookies: s.presi.cookies });
    assert.equal(del.statusCode, 409);
    assert.deepEqual((await s.summary(s.B)).json(), first);
    // è nell'elenco delle rassegne
    const list = await app.inject({ method: "GET", url: `${URL}/cineforums/${s.cf}/seasons`, cookies: s.A.cookies });
    assert.equal(list.json().find((x: { id: number }) => x.id === s.id).status, "DONE");
});

test("estraneo → 404; rassegna di un altro cineforum → 404", async () => {
    const s = await setup("e");
    await s.open(s.regia.id);
    await s.open(s.trama.id);
    const stranger = await makeUser("stranger-e@x.it");
    assert.equal((await s.summary(stranger)).statusCode, 404);
    const other = await makeCineforum(stranger);
    const wrong = await app.inject({ method: "GET", url: `${URL}/cineforums/${other}/seasons/${s.id}/summary`, cookies: stranger.cookies });
    assert.equal(wrong.statusCode, 404);
});
