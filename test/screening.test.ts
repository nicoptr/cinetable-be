import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb, TEST_OUTBOX } from "./helpers";
import { makeCineforum, makeUser, stubTmdb } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";

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

/** Presidente + A, B, C partecipanti, rassegna avviata. `candidate`: ognuno candida un film diverso e la scadenza passa. */
async function setup(tag: string, candidate = true) {
    const presi = await makeUser(`presi-${tag}@x.it`);
    const [A, B, C] = [await makeUser(`a-${tag}@x.it`), await makeUser(`b-${tag}@x.it`), await makeUser(`c-${tag}@x.it`)];
    const users = [presi, A, B, C];
    const cf = await makeCineforum(presi, [A, B, C]);
    const db = getPrismaClient();
    const category = await db.category.create({ data: { cineforumId: cf, name: `Categoria ${tag}` } });
    const award = await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Regia?" } });
    const created = await app.inject({
        method: "POST", url: `${URL}/cineforums/${cf}/seasons`, cookies: presi.cookies,
        payload: { name: `Rassegna ${tag}`, candidaturesCloseAt: days(7), categoryIds: [category.id], awardIds: [award.id], participantUserIds: users.map(u => u.id) },
    });
    const id: number = created.json().id;
    const base = `${URL}/cineforums/${cf}/seasons/${id}`;
    assert.equal((await app.inject({ method: "POST", url: `${base}/launch`, cookies: presi.cookies })).statusCode, 200);
    const put = (who: U, tmdbId: number) => app.inject({ method: "PUT", url: `${base}/candidature`, cookies: who.cookies, payload: { tmdbId } });
    const closeNow = () => db.season.update({ where: { id }, data: { candidaturesCloseAt: new Date(Date.now() - 1000) } });
    if (candidate) {
        for (const [i, u] of users.entries()) assert.equal((await put(u, MOVIES[i]!.tmdbId)).json().status, "VALID");
        await closeNow();
    }
    TEST_OUTBOX.length = 0;
    const reveal = (who: U = presi) => app.inject({ method: "POST", url: `${base}/reveal-next`, cookies: who.cookies });
    const season = (who: U) => app.inject({ method: "GET", url: base, cookies: who.cookies });
    const plan = (candidatureId: number, payload: object, who: U = presi) =>
        app.inject({ method: "PATCH", url: `${base}/candidatures/${candidatureId}/screening`, cookies: who.cookies, payload });
    /** Chi ha proposto la candidatura (solo dal DB). */
    const proposerOf = async (candidatureId: number) => {
        const c = await db.candidature.findUniqueOrThrow({ where: { id: candidatureId }, include: { participant: true } });
        return users.find(u => u.id === c.participant.userId)!;
    };
    return { presi, A, B, C, users, cf, id, base, put, closeNow, reveal, season, plan, proposerOf };
}

const usernameOf = async (u: U) => (await getPrismaClient().user.findUniqueOrThrow({ where: { id: u.id } })).username;

test("non si svela prima della scadenza né con film mancanti", async () => {
    const s = await setup("a", false);
    await s.put(s.A, 1091);
    await s.put(s.B, 550);
    await s.put(s.C, 603);
    const early = await s.reveal();
    assert.equal(early.statusCode, 400);
    assert.equal(early.json().message, "Le candidature sono ancora aperte");

    await s.closeNow();
    const missing = await s.reveal();
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().message, "Mancano ancora dei film: sposta la scadenza per chi deve candidare");

    assert.equal((await s.reveal(s.A)).statusCode, 403);
    const db = getPrismaClient();
    assert.equal((await db.season.findUniqueOrThrow({ where: { id: s.id } })).status, "OPEN");
    assert.equal(await db.candidature.count({ where: { seasonId: s.id, revealedAt: { not: null } } }), 0);
});

test("svelamento uno alla volta, ordine casuale stabile, proponente mai nel ProgramItem", async () => {
    const s = await setup("b");
    const db = getPrismaClient();
    const first = await s.reveal();
    assert.equal(first.statusCode, 200);
    const item = first.json();
    assert.equal(item.order, 1);
    assert.equal(item.screeningAt, null);
    assert.equal(item.votingOpen, false);
    assert.equal(item.isMine, (await s.proposerOf(item.candidatureId)) === s.presi);
    assert.equal(item.votesMissing, 3);

    // ordine fissato al primo svelamento: una permutazione di 1..4 sulle VALID
    const rows = await db.candidature.findMany({ where: { seasonId: s.id }, orderBy: { projectionOrder: "asc" } });
    assert.deepEqual(rows.map(r => r.projectionOrder), [1, 2, 3, 4]);
    assert.equal(rows[0]!.id, item.candidatureId);
    assert.equal((await db.season.findUniqueOrThrow({ where: { id: s.id } })).status, "SCREENING");

    const proposer = await s.proposerOf(item.candidatureId);
    const proposerName = await usernameOf(proposer);
    for (const viewer of s.users) {
        const view = (await s.season(viewer)).json();
        assert.equal(view.program.length, 1);
        assert.equal(view.remainingToReveal, 3);
        const program = JSON.stringify(view.program);
        assert.ok(!program.includes(proposerName), program);
        assert.ok(!program.includes("userId") && !program.includes("username"), program);
        // nessun film non svelato in tutta la vista
        const raw = JSON.stringify(view);
        for (const m of MOVIES.filter(m => m.tmdbId !== item.movie.tmdbId)) assert.ok(!raw.includes(m.title), raw);
        assert.equal(view.program[0].isMine, viewer === proposer);
    }
    const revealed = JSON.stringify(item);
    assert.ok(!revealed.includes(proposerName) && !revealed.includes("userId"), revealed);

    const unplanned = await s.reveal();
    assert.equal(unplanned.statusCode, 400);
    assert.equal(unplanned.json().message, "Proietta il film in programma prima di svelare il prossimo");

    const planned = await s.plan(item.candidatureId, { screeningAt: days(2), location: "Sala <1>" });
    assert.equal(planned.statusCode, 200);
    assert.equal(planned.json().location, "Sala <1>");
    assert.equal(planned.json().candidatureId, item.candidatureId);
    assert.equal((await s.reveal()).json().message, "Proietta il film in programma prima di svelare il prossimo");

    await db.candidature.update({ where: { id: item.candidatureId }, data: { screeningAt: new Date(Date.now() - 1000) } });
    const second = await s.reveal();
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().order, 2);
    assert.equal(second.json().candidatureId, rows[1]!.id);
    const program = (await s.season(s.A)).json().program;
    assert.deepEqual(program.map((p: { candidatureId: number }) => p.candidatureId), [rows[0]!.id, rows[1]!.id]);

    // svela il resto, poi niente più da svelare
    for (const row of rows.slice(1)) {
        await db.candidature.update({ where: { id: row.id }, data: { screeningAt: new Date(Date.now() - 1000) } });
        const r = await s.reveal();
        if (row === rows.at(-1)) {
            assert.equal(r.statusCode, 400);
            assert.equal(r.json().message, "Hai già svelato tutti i film");
        } else assert.equal(r.statusCode, 200);
    }
    assert.equal((await s.season(s.presi)).json().remainingToReveal, 0);
});

test("due reveal-next simultanei svelano un solo film", async () => {
    const s = await setup("c");
    const [r1, r2] = await Promise.all([s.reveal(), s.reveal()]);
    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 400]);
    assert.equal(await getPrismaClient().candidature.count({ where: { seasonId: s.id, revealedAt: { not: null } } }), 1);
});

test("screening su candidatura non svelata → 404", async () => {
    const s = await setup("d");
    const other = await setup("d2");
    const item = (await s.reveal()).json();
    const hidden = await getPrismaClient().candidature.findFirstOrThrow({ where: { seasonId: s.id, revealedAt: null } });
    const notFound = await s.plan(hidden.id, { screeningAt: days(1), location: "Sala" });
    assert.equal(notFound.statusCode, 404);
    assert.equal((await s.plan(999999, { screeningAt: days(1), location: "Sala" })).json().message, notFound.json().message);
    // candidatura svelata ma di un'altra rassegna
    const foreign = (await other.reveal()).json();
    assert.equal((await s.plan(foreign.candidatureId, { screeningAt: days(1), location: "Sala" })).statusCode, 404);

    assert.equal((await s.plan(item.candidatureId, { screeningAt: days(1), location: "Sala" }, s.A)).statusCode, 403);
    const past = await s.plan(item.candidatureId, { screeningAt: days(-1), location: "Sala" });
    assert.equal(past.statusCode, 400);
    for (const payload of [{ screeningAt: days(1) }, { screeningAt: days(1), location: "" }, { screeningAt: days(1), location: "x".repeat(201) }, { screeningAt: days(1), location: "Sala", x: 1 }]) {
        assert.equal((await s.plan(item.candidatureId, payload)).statusCode, 400);
    }
    assert.equal(TEST_OUTBOX.length, 0);

    const when = new Date("2030-03-15T19:30:00Z"); // 20:30 a Roma
    assert.equal((await s.plan(item.candidatureId, { screeningAt: when.toISOString(), location: "Sala <1>" })).statusCode, 200);
    assert.equal(TEST_OUTBOX.length, 4);
    for (const m of TEST_OUTBOX) {
        assert.equal(m.subject, "Prossima proiezione");
        assert.ok(m.html.includes(item.movie.title.replace("<", "&lt;").replace(">", "&gt;")), m.html);
        assert.ok(m.html.includes("Sala &lt;1&gt;"), m.html);
        assert.ok(m.html.includes("15-03-2030 alle 20:30"), m.html);
    }
});

test("screening: proiezione già avvenuta → 400; fuori da SCREENING → 400, nessuna email", async () => {
    const s = await setup("f");
    const db = getPrismaClient();
    const item = (await s.reveal()).json();
    await db.candidature.update({ where: { id: item.candidatureId }, data: { screeningAt: new Date(Date.now() - 1000) } });
    const done = await s.plan(item.candidatureId, { screeningAt: days(1), location: "Sala" });
    assert.equal(done.statusCode, 400);
    assert.equal(done.json().message, "Proiezione già avvenuta");

    await db.candidature.update({ where: { id: item.candidatureId }, data: { screeningAt: null } });
    for (const status of ["FINAL", "DONE"] as const) {
        await db.season.update({ where: { id: s.id }, data: { status } });
        const res = await s.plan(item.candidatureId, { screeningAt: days(1), location: "Sala" });
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().message, "Non modificabile in questa fase");
    }
    assert.equal(TEST_OUTBOX.length, 0);
});

test("isMine true solo per il proponente", async () => {
    const s = await setup("e");
    const item = (await s.reveal()).json();
    const proposer = await s.proposerOf(item.candidatureId);
    for (const viewer of s.users) {
        const p = (await s.season(viewer)).json().program[0];
        assert.equal(p.isMine, viewer === proposer);
        assert.equal(p.myVoteSubmitted, false);
        assert.equal("votesMissing" in p, viewer === s.presi);
    }
});
