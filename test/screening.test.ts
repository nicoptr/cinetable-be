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

/** Presidente + A, B, C partecipanti, edizione avviata. `candidate`: ognuno candida un film diverso e la scadenza passa. */
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
        payload: { name: `Edizione ${tag}`, candidaturesCloseAt: days(7), categoryIds: [category.id], awardIds: [award.id], participantUserIds: users.map(u => u.id) },
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
    const plan = (order: number | string, payload: object, who: U = presi) =>
        app.inject({ method: "PATCH", url: `${base}/program/${order}/screening`, cookies: who.cookies, payload });
    /** La riga dietro un ordine di proiezione (solo dal DB: l'id non esce mai). */
    const schedule = (payload: object, who: U = presi) => app.inject({ method: "POST", url: `${base}/next-screening`, cookies: who.cookies, payload });
    const rowOf = (order: number) => db.candidature.findFirstOrThrow({ where: { seasonId: id, projectionOrder: order }, include: { participant: true } });
    /** Chi ha proposto il film (solo dal DB). */
    const proposerOf = async (order: number) => {
        const c = await rowOf(order);
        return users.find(u => u.id === c.participant.userId)!;
    };
    /** Proiezione appena avvenuta. */
    const screened = async (order: number) => db.candidature.update({ where: { id: (await rowOf(order)).id }, data: { screeningAt: new Date(Date.now() - 1000) } });
    return { presi, A, B, C, users, cf, id, base, put, closeNow, reveal, season, plan, schedule, rowOf, proposerOf, screened };
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
    assert.equal(item.isMine, (await s.proposerOf(item.order)) === s.presi);
    assert.ok(!("candidatureId" in item));
    assert.equal(item.votesMissing, 3);

    // ordine fissato al primo svelamento: una permutazione di 1..4 sulle VALID
    const rows = await db.candidature.findMany({ where: { seasonId: s.id }, orderBy: { projectionOrder: "asc" } });
    assert.deepEqual(rows.map(r => r.projectionOrder), [1, 2, 3, 4]);
    assert.equal(rows[0]!.revealedAt !== null, true);
    assert.equal((await db.season.findUniqueOrThrow({ where: { id: s.id } })).status, "SCREENING");

    const proposer = await s.proposerOf(item.order);
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

    const planned = await s.plan(item.order, { screeningAt: days(2), location: "Sala <1>" });
    assert.equal(planned.statusCode, 200);
    assert.equal(planned.json().location, "Sala <1>");
    assert.equal(planned.json().order, item.order);
    assert.equal((await s.reveal()).json().message, "Proietta il film in programma prima di svelare il prossimo");

    await s.screened(item.order);
    const second = await s.reveal();
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().order, 2);
    assert.equal(second.json().movie.tmdbId, rows[1]!.tmdbId);
    const program = (await s.season(s.A)).json().program;
    assert.deepEqual(program.map((p: { order: number }) => p.order), [1, 2]);

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

test("screening su film non svelato → 404", async () => {
    const s = await setup("d");
    const item = (await s.reveal()).json();
    TEST_OUTBOX.length = 0;
    const hidden = await getPrismaClient().candidature.findFirstOrThrow({ where: { seasonId: s.id, revealedAt: null } });
    const notFound = await s.plan(hidden.projectionOrder!, { screeningAt: days(1), location: "Sala" });
    assert.equal(notFound.statusCode, 404);
    for (const order of [999999, "abc"]) {
        const r = await s.plan(order, { screeningAt: days(1), location: "Sala" });
        assert.equal(r.statusCode, 404);
        assert.equal(r.body, notFound.body);
    }

    assert.equal((await s.plan(item.order, { screeningAt: days(1), location: "Sala" }, s.A)).statusCode, 403);
    for (const payload of [{ screeningAt: days(1) }, { screeningAt: days(1), location: "" }, { screeningAt: days(1), location: "x".repeat(201) }, { screeningAt: days(1), location: "Sala", x: 1 }]) {
        assert.equal((await s.plan(item.order, payload)).statusCode, 400);
    }
    assert.equal(TEST_OUTBOX.length, 0);

    const when = new Date("2030-03-15T19:30:00Z"); // 20:30 a Roma
    assert.equal((await s.plan(item.order, { screeningAt: when.toISOString(), location: "Sala <1>" })).statusCode, 200);
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
    TEST_OUTBOX.length = 0;
    const cid = (await s.rowOf(item.order)).id;
    await s.screened(item.order);
    const done = await s.plan(item.order, { screeningAt: days(1), location: "Sala" });
    assert.equal(done.statusCode, 400);
    assert.equal(done.json().message, "Proiezione già avvenuta");

    await db.candidature.update({ where: { id: cid }, data: { screeningAt: null } });
    for (const status of ["FINAL", "DONE"] as const) {
        await db.season.update({ where: { id: s.id }, data: { status } });
        const res = await s.plan(item.order, { screeningAt: days(1), location: "Sala" });
        assert.equal(res.statusCode, 400);
        assert.equal(res.json().message, "Non modificabile in questa fase");
    }
    assert.equal(TEST_OUTBOX.length, 0);
});

test("isMine true solo per il proponente", async () => {
    const s = await setup("e");
    const item = (await s.reveal()).json();
    const proposer = await s.proposerOf(item.order);
    for (const viewer of s.users) {
        const p = (await s.season(viewer)).json().program[0];
        assert.equal(p.isMine, viewer === proposer);
        assert.equal(p.myVoteSubmitted, false);
        assert.equal("votesMissing" in p, viewer === s.presi);
    }
});

test("screening: data passata ammessa solo se il film non ne ha ancora una", async () => {
    const s = await setup("g");
    const item = (await s.reveal()).json();
    // proiezione già avvenuta da registrare: ammessa, e sblocca reveal-next
    const recorded = await s.plan(item.order, { screeningAt: days(-1), location: "Sala" });
    assert.equal(recorded.statusCode, 200);
    assert.equal(new Date(recorded.json().screeningAt).getTime() < Date.now(), true);
    assert.equal((await s.reveal()).statusCode, 200);

    // data futura già fissata: non si sposta nel passato
    const second = 2;
    assert.equal((await s.plan(second, { screeningAt: days(1), location: "Sala" })).statusCode, 200);
    const past = await s.plan(second, { screeningAt: days(-1), location: "Sala" });
    assert.equal(past.statusCode, 400);
    assert.equal(past.json().message, "La proiezione non può essere nel passato");
});

test("PATCH della scadenza e primo reveal-next simultanei: mai entrambi a buon fine", async () => {
    for (const tag of ["h1", "h2", "h3"]) {
        const s = await setup(tag);
        const [r, p] = await Promise.all([
            s.reveal(),
            app.inject({ method: "PATCH", url: s.base, cookies: s.presi.cookies, payload: { candidaturesCloseAt: days(3) } }),
        ]);
        assert.notDeepEqual([r.statusCode, p.statusCode], [200, 200]);
        assert.ok([r.statusCode, p.statusCode].includes(200));
    }
});

const escaped = (t: string) => t.replace("<", "&lt;").replace(">", "&gt;");
const emailOf = async (u: U) => (await getPrismaClient().user.findUniqueOrThrow({ where: { id: u.id } })).email;
/** Il prossimo film coperto (solo dal DB). */
const nextHidden = (seasonId: number) => getPrismaClient().candidature.findFirstOrThrow({
    where: { seasonId, status: "VALID", revealedAt: null }, orderBy: { projectionOrder: "asc" }, include: { movie: true, participant: true },
});

test("next-screening in OPEN chiusa: parte SCREENING, email a tutti con la categoria e senza titolo", async () => {
    const s = await setup("n1");
    const when = new Date("2030-03-15T19:30:00Z"); // 20:30 a Roma
    const res = await s.schedule({ screeningAt: when.toISOString(), location: "Sala <1>" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { screeningAt: when.toISOString(), location: "Sala <1>", categoryName: "Categoria n1" });
    assert.equal((await getPrismaClient().season.findUniqueOrThrow({ where: { id: s.id } })).status, "SCREENING");

    const next = await nextHidden(s.id);
    assert.equal(next.screeningAt?.toISOString(), when.toISOString());
    assert.equal(next.location, "Sala <1>");
    assert.deepEqual(TEST_OUTBOX.map(m => m.to).sort(), (await Promise.all(s.users.map(emailOf))).sort());
    for (const m of TEST_OUTBOX) {
        assert.equal(m.subject, "Prossima proiezione");
        assert.ok(m.html.includes("Categoria n1") && m.html.includes("Sala &lt;1&gt;") && m.html.includes("15-03-2030 alle 20:30"), m.html);
        for (const movie of MOVIES) {
            assert.ok(!m.html.includes(escaped(movie.title)) && !m.html.includes(movie.originalTitle), m.html);
            if (movie.posterPath) assert.ok(!m.html.includes(movie.posterPath), m.html);
        }
    }
});

test("next-screening: 403 al membro, 400 con film mancanti, nel passato o prima della proiezione in programma", async () => {
    const s = await setup("n2", false);
    await s.put(s.A, 1091);
    await s.put(s.B, 550);
    await s.closeNow();
    assert.equal((await s.schedule({ screeningAt: days(2), location: "Sala" }, s.A)).statusCode, 403);
    const missing = await s.schedule({ screeningAt: days(2), location: "Sala" });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().message, "Mancano ancora dei film: sposta la scadenza per chi deve candidare");
    assert.equal((await getPrismaClient().season.findUniqueOrThrow({ where: { id: s.id } })).status, "OPEN");

    await getPrismaClient().season.update({ where: { id: s.id }, data: { candidaturesCloseAt: new Date(days(1)) } });
    await s.put(s.C, 603);
    await s.put(s.presi, 680);
    await s.closeNow();
    const past = await s.schedule({ screeningAt: days(-1), location: "Sala" });
    assert.equal(past.statusCode, 400);
    assert.equal(past.json().message, "La proiezione non può essere nel passato");
    for (const payload of [{ screeningAt: days(1) }, { screeningAt: days(1), location: "" }, { screeningAt: days(1), location: "Sala", x: 1 }]) {
        assert.equal((await s.schedule(payload)).statusCode, 400);
    }

    const item = (await s.reveal()).json();
    assert.equal((await s.plan(item.order, { screeningAt: days(3), location: "Sala" })).statusCode, 200);
    TEST_OUTBOX.length = 0;
    const early = await s.schedule({ screeningAt: days(2), location: "Sala" });
    assert.equal(early.statusCode, 400);
    assert.equal(early.json().message, "La proiezione deve essere dopo quella già in programma");
    assert.equal(TEST_OUTBOX.length, 0);
    assert.equal((await s.schedule({ screeningAt: days(4), location: "Sala" })).statusCode, 200);
});

test("next-screening: riprogrammare sovrascrive e rimanda l'email; la vista mostra la serata ma non il film", async () => {
    const s = await setup("n3");
    assert.equal((await s.season(s.A)).json().nextScreening, null);
    await s.schedule({ screeningAt: days(2), location: "Sala" });
    TEST_OUTBOX.length = 0;
    const later = new Date(Date.now() + 5 * 86400000);
    assert.equal((await s.schedule({ screeningAt: later.toISOString(), location: "Cantina" })).statusCode, 200);
    assert.equal(TEST_OUTBOX.length, 4);
    assert.ok(TEST_OUTBOX.every(m => m.html.includes("Cantina")));

    const next = await nextHidden(s.id);
    assert.equal(next.location, "Cantina");
    for (const viewer of s.users) {
        const view = (await s.season(viewer)).json();
        assert.deepEqual(view.nextScreening, { screeningAt: later.toISOString(), location: "Cantina", categoryName: "Categoria n3" });
        assert.deepEqual(view.program, []);
        const raw = JSON.stringify(view);
        for (const m of MOVIES) assert.ok(!raw.includes(m.title) && !raw.includes(m.originalTitle) && !raw.includes(`"tmdbId":${m.tmdbId}`), raw);
        assert.ok(!raw.includes("thing.jpg") && !raw.includes("matrix.jpg"), raw);
    }
});

test("reveal-next tiene data e luogo programmati e manda a tutti l'email con il titolo", async () => {
    const s = await setup("n4");
    const when = new Date("2030-03-15T19:30:00Z");
    await s.schedule({ screeningAt: when.toISOString(), location: "Sala <1>" });
    const next = await nextHidden(s.id);
    TEST_OUTBOX.length = 0;

    const item = (await s.reveal()).json();
    assert.equal(item.movie.tmdbId, next.tmdbId);
    assert.equal(item.screeningAt, when.toISOString());
    assert.equal(item.location, "Sala <1>");
    assert.equal((await s.season(s.A)).json().nextScreening, null);
    assert.deepEqual(TEST_OUTBOX.map(m => m.to).sort(), (await Promise.all(s.users.map(emailOf))).sort());
    for (const m of TEST_OUTBOX) {
        assert.equal(m.subject, "Svelato il prossimo film");
        assert.ok(m.html.includes(escaped(next.movie.title)) && m.html.includes("Sala &lt;1&gt;") && m.html.includes("15-03-2030 alle 20:30"), m.html);
    }
    // la proiezione fissata è in programma: il prossimo si svela dopo
    assert.equal((await s.reveal()).json().message, "Proietta il film in programma prima di svelare il prossimo");

    await s.screened(item.order);
    TEST_OUTBOX.length = 0;
    const second = (await s.reveal()).json();
    assert.equal(second.screeningAt, null);
    assert.equal(TEST_OUTBOX.length, 4);
    for (const m of TEST_OUTBOX) assert.ok(m.html.includes(escaped(second.movie.title)) && !m.html.includes("Ci vediamo"), m.html);
});
