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

/**
 * Rassegna con premi Regia e Trama, `reveal` film svelati, proiettati e col voto aperto.
 * Voti (se tutti svelati): Regia premia il film di A (90, 90, 91 → 90.3), Trama vede B e C a pari merito (80).
 * C non vota il film del presidente: resta un voto da dare.
 */
async function setup(tag: string, reveal = 4) {
    const db = getPrismaClient();
    const presi = await makeUser(`presi-${tag}@x.it`);
    const [A, B, C] = [await makeUser(`a-${tag}@x.it`), await makeUser(`b-${tag}@x.it`), await makeUser(`c-${tag}@x.it`)];
    const users = [presi, A!, B!, C!];
    const cf = await makeCineforum(presi, [A!, B!, C!]);
    const category = await db.category.create({ data: { cineforumId: cf, name: `Categoria ${tag}` } });
    const [regia, trama] = [
        await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Regia?" } }),
        await db.award.create({ data: { cineforumId: cf, name: "Trama", question: "Trama?" } }),
    ];
    const other = await db.award.create({ data: { cineforumId: cf, name: "Estraneo", question: "Estraneo?" } });
    const created = await app.inject({
        method: "POST", url: `${URL}/cineforums/${cf}/seasons`, cookies: presi.cookies,
        payload: { name: `Rassegna ${tag}`, candidaturesCloseAt: days(7), categoryIds: [category.id], awardIds: [regia!.id, trama!.id], participantUserIds: users.map(u => u.id) },
    });
    const id: number = created.json().id;
    const base = `${URL}/cineforums/${cf}/seasons/${id}`;
    await app.inject({ method: "POST", url: `${base}/launch`, cookies: presi.cookies });
    for (const [i, u] of users.entries()) {
        await app.inject({ method: "PUT", url: `${base}/candidature`, cookies: u.cookies, payload: { tmdbId: MOVIES[i]!.tmdbId } });
    }
    await db.season.update({ where: { id }, data: { candidaturesCloseAt: new Date(Date.now() - 1000) } });
    const films: { cid: number; order: number; proposer: U }[] = [];
    for (let i = 0; i < reveal; i++) {
        const order: number = (await app.inject({ method: "POST", url: `${base}/reveal-next`, cookies: presi.cookies })).json().order;
        const row = await db.candidature.findFirstOrThrow({ where: { seasonId: id, projectionOrder: order }, include: { participant: true } });
        await db.candidature.update({ where: { id: row.id }, data: { screeningAt: new Date(Date.now() - 1000) } });
        await app.inject({ method: "POST", url: `${base}/program/${order}/open-voting`, cookies: presi.cookies });
        films.push({ cid: row.id, order, proposer: users.find(u => u.id === row.participant.userId)! });
    }
    const vote = (who: U, order: number, r: number, t: number) => app.inject({
        method: "POST", url: `${base}/program/${order}/votes`, cookies: who.cookies,
        payload: { votes: [{ awardId: regia!.id, value: r }, { awardId: trama!.id, value: t }] },
    });
    if (reveal === 4) {
        for (const f of films) {
            for (const v of users.filter(u => u !== f.proposer && !(u === C && f.proposer === presi))) {
                const r = f.proposer === A ? (v === presi ? 91 : 90) : 50;
                const t = f.proposer === B || f.proposer === C ? 80 : 40;
                assert.equal((await vote(v, f.order, r, t)).statusCode, 201);
            }
        }
    }
    const open = (awardId: number, who: U = presi) => app.inject({ method: "POST", url: `${base}/awards/${awardId}/open`, cookies: who.cookies });
    const results = (who: U) => app.inject({ method: "GET", url: `${base}/results`, cookies: who.cookies });
    const season = (who: U) => app.inject({ method: "GET", url: base, cookies: who.cookies });
    const film = (u: U) => films.find(f => f.proposer === u)!;
    return { presi, A: A!, B: B!, C: C!, users, regia: regia!, trama: trama!, other, id, base, films, film, vote, open, results, season };
}

test("busta per busta: risultato visibile a tutti solo dopo l'apertura", async () => {
    const s = await setup("a");
    const before = (await s.results(s.B)).json();
    assert.deepEqual(before, { awards: [], allRevealed: false, proposers: [] });

    const r1 = await s.open(s.regia.id);
    assert.equal(r1.statusCode, 200);
    const a1 = r1.json();
    assert.equal(a1.awardId, s.regia.id);
    assert.equal(a1.name, "Regia");
    assert.equal(a1.question, "Regia?");
    assert.ok(!Number.isNaN(Date.parse(a1.revealedAt)));
    assert.equal(a1.winners.length, 1);
    const w = a1.winners[0];
    assert.equal(w.movie.tmdbId, MOVIES[1]!.tmdbId); // il film di A
    assert.deepEqual(w.proposer, { userId: s.A.id, username: `a-a`, avatarUrl: null });
    assert.equal(w.average, 90.3);
    assert.equal(w.votes, 3);
    assert.equal(typeof w.category.name, "string");

    const mid = (await s.results(s.C)).json();
    assert.deepEqual(mid.awards, [a1]);
    assert.equal(mid.allRevealed, false);
    assert.deepEqual(mid.proposers, []);
    // nessun altro proponente trapela
    for (const u of [s.presi, s.B, s.C]) assert.ok(!JSON.stringify(mid).includes(`"userId":${u.id}`));
    assert.equal((await s.season(s.C)).json().status, "FINAL");

    // dopo la prima apertura il voto mancante non entra più
    const db = getPrismaClient();
    const count = await db.vote.count();
    const late = await s.vote(s.C, s.film(s.presi).order, 100, 100);
    assert.equal(late.statusCode, 400);
    assert.equal(late.json().message, "Le votazioni sono chiuse");
    assert.equal(await db.vote.count(), count);

    const r2 = (await s.open(s.trama.id)).json();
    assert.deepEqual(r2.winners.map((x: { proposer: { userId: number } }) => x.proposer.userId).sort(), [s.B.id, s.C.id].sort());
    for (const x of r2.winners) assert.equal(x.average, 80);
    const end = (await s.results(s.B)).json();
    assert.deepEqual(end.awards, [a1, r2]);
    assert.equal(end.allRevealed, true);
    assert.equal(end.proposers.length, 4);
    for (const f of s.films) {
        const p = end.proposers.find((x: { order: number }) => x.order === f.order);
        assert.equal(p.proposer.userId, f.proposer.id);
    }
    assert.equal((await s.season(s.B)).json().status, "DONE");
});

test("apertura prima di aver svelato tutto → 400", async () => {
    const s = await setup("b", 2);
    const r = await s.open(s.regia.id);
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().message, "Svela e proietta tutti i film prima della serata finale");
    // ultimo film svelato ma non ancora proiettato
    const t = await setup("b2", 4);
    await getPrismaClient().candidature.update({ where: { id: t.films[3]!.cid }, data: { screeningAt: new Date(Date.now() + 86400000) } });
    assert.equal((await t.open(t.regia.id)).json().message, "Svela e proietta tutti i film prima della serata finale");
    for (const x of [s, t]) {
        assert.equal((await x.season(x.presi)).json().status, "SCREENING");
        assert.equal(await getPrismaClient().seasonAward.count({ where: { seasonId: x.id, revealedAt: { not: null } } }), 0);
    }
    // tutto proiettato ma un film senza voto aperto: perderebbe ogni premio in silenzio
    const u = await setup("b3", 4);
    await getPrismaClient().candidature.update({ where: { id: u.films[2]!.cid }, data: { votingOpenedAt: null } });
    const closed = await u.open(u.regia.id);
    assert.equal(closed.statusCode, 400);
    assert.equal(closed.json().message, "Apri il voto su tutti i film prima della serata finale");
    assert.equal(await getPrismaClient().seasonAward.count({ where: { seasonId: u.id, revealedAt: { not: null } } }), 0);
    assert.equal((await u.season(u.presi)).json().status, "SCREENING");
    // fuori da SCREENING/FINAL: non modificabile
    await getPrismaClient().season.update({ where: { id: s.id }, data: { status: "OPEN" } });
    assert.equal((await s.open(s.regia.id)).json().message, "Non modificabile in questa fase");
});

test("membro non presidente non apre buste → 403; premio estraneo → 404", async () => {
    const s = await setup("c");
    assert.equal((await s.open(s.regia.id, s.A)).statusCode, 403);
    assert.equal((await s.open(s.other.id)).statusCode, 404);
    assert.equal((await s.open(999999)).statusCode, 404);
    const stranger = await makeUser("stranger-c@x.it");
    assert.equal((await s.results(stranger)).statusCode, 404);
    assert.equal((await s.season(s.A)).json().status, "SCREENING");
});

test("riaprire la stessa busta restituisce lo stesso risultato", async () => {
    const s = await setup("d");
    const first = (await s.open(s.trama.id)).json();
    assert.deepEqual((await s.open(s.trama.id)).json(), first);
    await s.open(s.regia.id);
    assert.equal((await s.season(s.A)).json().status, "DONE");
    // anche a rassegna conclusa
    const again = await s.open(s.trama.id);
    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.json(), first);
});

test("aperture simultanee di buste diverse: entrambe aperte, rassegna DONE", async () => {
    const s = await setup("e");
    const rs = await Promise.all([s.open(s.regia.id), s.open(s.trama.id)]);
    assert.deepEqual(rs.map(r => r.statusCode), [200, 200]);
    assert.equal((await s.season(s.A)).json().status, "DONE");
});
