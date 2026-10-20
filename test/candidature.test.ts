import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb, TEST_OUTBOX } from "./helpers";
import { makeCineforum, makeUser, stubTmdb } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";
import { getInstanceByToken } from "fastify-decorators";
import { TmdbClient } from "@services/TmdbClient";

const URL = "/sub/api";
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
let app: Awaited<ReturnType<typeof buildApp>>;

const MOVIES = [
    { tmdbId: 1091, title: "La cosa <1982>", originalTitle: "The Thing", year: 1982, posterPath: "/thing.jpg" },
    { tmdbId: 550, title: "Fight Club", originalTitle: "Fight Club", year: 1999, posterPath: null },
    { tmdbId: 603, title: "Matrix", originalTitle: "The Matrix", year: 1999, posterPath: "/matrix.jpg" },
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

/** Presidente + 3 membri (A, B, C), tutti partecipanti, rassegna avviata. `outsider`: membro non partecipante. */
async function setup(tag: string) {
    const presi = await makeUser(`presi-${tag}@x.it`);
    const [A, B, C, outsider] = [await makeUser(`a-${tag}@x.it`), await makeUser(`b-${tag}@x.it`), await makeUser(`c-${tag}@x.it`), await makeUser(`o-${tag}@x.it`)];
    const cf = await makeCineforum(presi, [A, B, C, outsider]);
    const db = getPrismaClient();
    const category = await db.category.create({ data: { cineforumId: cf, name: `Categoria ${tag}` } });
    const award = await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Regia?" } });
    const created = await app.inject({
        method: "POST", url: `${URL}/cineforums/${cf}/seasons`, cookies: presi.cookies,
        payload: { name: `Rassegna ${tag}`, candidaturesCloseAt: days(7), categoryIds: [category.id], awardIds: [award.id], participantUserIds: [presi.id, A.id, B.id, C.id] },
    });
    const id: number = created.json().id;
    assert.equal((await app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/seasons/${id}/launch`, cookies: presi.cookies })).statusCode, 200);
    TEST_OUTBOX.length = 0;
    const base = `${URL}/cineforums/${cf}/seasons/${id}`;
    const put = (who: U, tmdbId: number, path = base) => app.inject({ method: "PUT", url: `${path}/candidature`, cookies: who.cookies, payload: { tmdbId } });
    const mine = (who: U, path = base) => app.inject({ method: "GET", url: `${path}/candidature`, cookies: who.cookies });
    const season = (who: U) => app.inject({ method: "GET", url: base, cookies: who.cookies });
    const progress = (who: U) => app.inject({ method: "GET", url: `${base}/progress`, cookies: who.cookies });
    return { presi, A, B, C, outsider, cf, id, base, put, mine, season, progress };
}

const emailOf = async (u: U) => (await getPrismaClient().user.findUniqueOrThrow({ where: { id: u.id } })).email;

test("candidatura valida e contatore", async () => {
    const { A, presi, put, mine, season } = await setup("a");
    assert.deepEqual((await mine(A)).json(), { status: "NONE", movie: null });
    const res = await put(A, 1091);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "VALID");
    assert.equal(res.json().movie.tmdbId, 1091);
    assert.equal(res.json().movie.posterUrl, "https://image.tmdb.org/t/p/w500/thing.jpg");
    assert.deepEqual((await mine(A)).json(), res.json());
    assert.deepEqual((await season(presi)).json().candidatures, { valid: 1, expected: 4 });
    assert.equal(TEST_OUTBOX.length, 0);
});

test("stesso film da due persone → entrambe DUPLICATE, film escluso, due email", async () => {
    const { presi, A, B, C, put, mine, season } = await setup("b");
    assert.equal((await put(A, 1091)).json().status, "VALID");
    const b = await put(B, 1091);
    assert.equal(b.statusCode, 200);
    assert.equal(b.json().status, "DUPLICATE");
    const a = (await mine(A)).json();
    assert.equal(a.status, "DUPLICATE");
    assert.equal(a.movie.tmdbId, 1091);
    assert.deepEqual((await season(presi)).json().candidatures, { valid: 0, expected: 4 });

    const c = await put(C, 1091);
    assert.equal(c.statusCode, 400);
    assert.equal(c.json().message, "Film non disponibile per questa rassegna");

    assert.deepEqual(TEST_OUTBOX.map(m => m.to).sort(), [await emailOf(A), await emailOf(B)].sort());
    for (const m of TEST_OUTBOX) {
        assert.equal(m.subject, "Scegli un altro film");
        assert.ok(m.html.includes("La cosa &lt;1982&gt;"), m.html);
        assert.ok(m.html.includes("ora di Roma"));
    }
    const presiEmail = await emailOf(presi);
    assert.ok(!TEST_OUTBOX.some(m => m.to === presiEmail));
});

test("stesso film nello stesso istante → entrambe DUPLICATE", async () => {
    const { A, B, put, mine } = await setup("c");
    const [r1, r2] = await Promise.all([put(A, 1091), put(B, 1091)]);
    // serializzate dal lock: la prima risponde VALID al suo commit, la seconda la annulla
    assert.deepEqual([r1.json().status, r2.json().status].sort(), ["DUPLICATE", "VALID"]);
    assert.equal((await mine(A)).json().status, "DUPLICATE");
    assert.equal((await mine(B)).json().status, "DUPLICATE");
    assert.equal(TEST_OUTBOX.length, 2);
});

test("tre candidature uguali → tutte DUPLICATE", async () => {
    const s = await setup("d");
    await s.put(s.A, 1091);
    await s.put(s.B, 1091);
    assert.equal((await s.put(s.C, 1091)).statusCode, 400);

    // variante: A su 550, poi B e C in parallelo sullo stesso film
    const t = await setup("d2");
    assert.equal((await t.put(t.A, 550)).json().status, "VALID");
    const [rb, rc] = await Promise.all([t.put(t.B, 550), t.put(t.C, 550)]);
    // chi arriva primo crea il duplicato, il secondo trova il film escluso
    assert.deepEqual([rb.statusCode, rc.statusCode].sort(), [200, 400]);
    assert.equal([rb, rc].find(r => r.statusCode === 200)!.json().status, "DUPLICATE");
    assert.equal((await t.mine(t.A)).json().status, "DUPLICATE");
    assert.equal(await getPrismaClient().candidature.count({ where: { seasonId: t.id, status: "VALID" } }), 0);
});

test("cambio film: la vecchia diventa WITHDRAWN e il vecchio film torna libero", async () => {
    const { A, B, put, mine, id } = await setup("e");
    await put(A, 1091);
    const changed = await put(A, 550);
    assert.equal(changed.json().status, "VALID");
    assert.equal(changed.json().movie.tmdbId, 550);
    assert.equal((await mine(A)).json().movie.tmdbId, 550);
    assert.equal((await put(B, 1091)).json().status, "VALID");
    const rows = await getPrismaClient().candidature.findMany({ where: { seasonId: id }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map(r => [r.tmdbId, r.status]), [[1091, "WITHDRAWN"], [550, "VALID"], [1091, "VALID"]]);
    assert.equal(TEST_OUTBOX.length, 0);
});

test("dopo un duplicato posso candidare un altro film", async () => {
    const { A, B, put, mine } = await setup("e2");
    await put(A, 1091);
    await put(B, 1091);
    assert.equal((await put(A, 603)).json().status, "VALID");
    assert.equal((await mine(A)).json().movie.tmdbId, 603);
});

test("ripresentare lo stesso film è idempotente", async () => {
    const { A, put, id } = await setup("f");
    const first = (await put(A, 1091)).json();
    assert.deepEqual((await put(A, 1091)).json(), first);
    assert.equal(await getPrismaClient().candidature.count({ where: { seasonId: id } }), 1);
});

test("film inesistente → 400; body non valido → 400", async () => {
    const { A, put, base } = await setup("g");
    const res = await put(A, 999);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().message, "Film non trovato");
    for (const payload of [{ tmdbId: 0 }, { tmdbId: 1.5 }, { tmdbId: 1091, x: 1 }, {}]) {
        assert.equal((await app.inject({ method: "PUT", url: `${base}/candidature`, cookies: A.cookies, payload })).statusCode, 400);
    }
});

test("scadenza passata → 400; proroga del presidente → di nuovo accettata", async () => {
    const { presi, A, put, id, base } = await setup("h");
    await getPrismaClient().season.update({ where: { id }, data: { candidaturesCloseAt: new Date(Date.now() - 1000) } });
    const closed = await put(A, 1091);
    assert.equal(closed.statusCode, 400);
    assert.equal(closed.json().message, "Le candidature non sono aperte");
    assert.equal((await app.inject({ method: "PATCH", url: base, cookies: presi.cookies, payload: { candidaturesCloseAt: days(3) } })).statusCode, 200);
    assert.equal((await put(A, 1091)).json().status, "VALID");

    await getPrismaClient().season.update({ where: { id }, data: { status: "SCREENING" } });
    assert.equal((await put(A, 550)).json().message, "Le candidature non sono aperte");
});

test("non partecipante → 403; estraneo → 404; rassegna di altro cineforum → 404", async () => {
    const s = await setup("i");
    const other = await setup("i2");
    const stranger = await makeUser("stranger-i@x.it");
    assert.equal((await s.put(s.outsider, 1091)).statusCode, 403);
    assert.equal((await s.mine(s.outsider)).statusCode, 403);
    assert.equal((await s.put(stranger, 1091)).statusCode, 404);
    assert.equal((await s.mine(stranger)).statusCode, 404);
    const wrongPath = `${URL}/cineforums/${s.cf}/seasons/${other.id}`;
    assert.equal((await s.put(s.A, 1091, wrongPath)).statusCode, 404);
    assert.equal((await s.mine(s.A, wrongPath)).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `${wrongPath}/progress`, cookies: s.presi.cookies })).statusCode, 404);
});

test("progress: solo il presidente, solo nomi dei mancanti, nessun film", async () => {
    const { presi, A, B, C, put, progress } = await setup("j");
    await put(A, 1091);
    await put(B, 550);
    await put(C, 550); // B e C duplicati: tornano tra i mancanti
    await put(presi, 603);
    assert.equal((await progress(A)).statusCode, 403);
    const res = await progress(presi);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
        expected: 4,
        valid: 2,
        missing: [{ userId: B.id, username: "b-j" }, { userId: C.id, username: "c-j" }],
    });
    const raw = JSON.stringify(res.json());
    for (const m of MOVIES) {
        assert.equal(raw.includes(String(m.tmdbId)), false);
        assert.equal(raw.includes(m.title), false);
    }
});

test("la vista della rassegna non rivela film altrui", async () => {
    const { presi, A, put, season } = await setup("k");
    await put(A, 1091);
    const raw = (await season(presi)).body;
    assert.equal(raw.includes("1091"), false);
    assert.equal(raw.includes("La cosa"), false);
});

test("film già in cache: niente TMDB", async () => {
    const { A, put } = await setup("cache");
    assert.equal((await put(A, 1091)).statusCode, 200); // ora è nella tabella Movie
    const client = getInstanceByToken<TmdbClient>(TmdbClient);
    client.getMovie = async () => { throw new Error("TMDB non va chiamato"); };
    try {
        assert.notEqual((await put(A, 680)).statusCode, 200); // non in cache: passa da TMDB, che qui fallisce
        const res = await put(A, 1091);
        assert.equal(res.statusCode, 200);
        assert.equal(res.json().status, "VALID");
        assert.equal(res.json().movie.posterUrl, "https://image.tmdb.org/t/p/w500/thing.jpg");
    } finally {
        stubTmdb(MOVIES);
    }
});

test("rimozione di chi non ha un film valido sblocca lo svelamento", async () => {
    const { presi, A, B, C, base, put, progress, id } = await setup("rm");
    const db = getPrismaClient();
    const remove = (who: U, target: U) => app.inject({ method: "DELETE", url: `${base}/participants/${target.id}`, cookies: who.cookies });
    assert.equal((await put(presi, 1091)).json().status, "VALID");
    assert.equal((await put(A, 550)).json().status, "VALID");
    // B e C sullo stesso film: entrambe DUPLICATE; B ne sceglie un altro, C sparisce
    assert.equal((await put(B, 603)).json().status, "VALID");
    assert.equal((await put(C, 603)).json().status, "DUPLICATE");
    assert.equal((await put(B, 680)).json().status, "VALID");
    await db.season.update({ where: { id }, data: { candidaturesCloseAt: new Date(Date.now() - 1000) } });
    const reveal = () => app.inject({ method: "POST", url: `${base}/reveal-next`, cookies: presi.cookies });
    assert.equal((await reveal()).json().message, "Mancano ancora dei film: sposta la scadenza per chi deve candidare");

    assert.equal((await remove(A, C)).statusCode, 403);
    const valid = await remove(presi, A);
    assert.equal(valid.statusCode, 400);
    assert.equal(valid.json().message, "Puoi rimuovere solo chi non ha ancora un film valido");
    assert.equal((await remove(presi, { ...C, id: 999999 })).statusCode, 404);

    const ok = await remove(presi, C);
    assert.equal(ok.statusCode, 204);
    assert.equal(await db.candidature.count({ where: { seasonId: id, participant: { userId: C.id } } }), 0);
    assert.deepEqual((await progress(presi)).json(), { expected: 3, valid: 3, missing: [] });
    assert.equal((await reveal()).statusCode, 200);
    // fuori da OPEN non si rimuove più nessuno
    assert.equal((await remove(presi, A)).json().message, "Puoi rimuovere solo chi non ha ancora un film valido");
});

test("rimozione: restano almeno 2 partecipanti", async () => {
    const { presi, A, B, C, base } = await setup("rm2");
    const remove = (target: U) => app.inject({ method: "DELETE", url: `${base}/participants/${target.id}`, cookies: presi.cookies });
    assert.equal((await remove(C)).statusCode, 204);
    assert.equal((await remove(B)).statusCode, 204);
    const last = await remove(A);
    assert.equal(last.statusCode, 400);
    assert.equal(last.json().message, "Una rassegna ha almeno 2 partecipanti");
});
