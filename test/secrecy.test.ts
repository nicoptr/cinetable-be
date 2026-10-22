import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb } from "./helpers";
import { makeCineforum, makeUser, stubTmdb, scheduleAndReveal } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";

/**
 * Verifica trasversale della segretezza (spec §7): in ogni fase, presidente partecipante e un membro
 * chiamano ogni GET del gioco; nessun corpo contiene un film non svelato e non proprio, né la coppia
 * (proponente, film altrui) prima che la busta vinta da quel film, o tutte, siano aperte.
 * L'id di una candidatura (sequenziale: tradirebbe l'ordine di invio) non esce mai, in nessuna fase.
 */
const URL = "/sub/api";
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
let app: Awaited<ReturnType<typeof buildApp>>;

const MOVIES = ["A", "B", "C", "D"].map((l, i) => ({
    tmdbId: 987001 + i, title: `TitoloSegreto${l}`, originalTitle: `OriginaleSegreto${l}`, year: 2001, posterPath: `/locandinaSegreta${l}.jpg`,
}));
/** Ciò che identifica un film in un corpo: id TMDB, titoli, locandina. */
const marks = (m: (typeof MOVIES)[number]) => [String(m.tmdbId), m.title, m.originalTitle, m.posterPath];

/** Chiavi di un ProgramItem: nessun proponente, nessun participantId. */
const PROGRAM_KEYS = ["order", "movie", "category", "screeningAt", "location", "votingOpen", "isMine", "myVoteSubmitted", "votesMissing"];
const PROPOSER_KEYS = new Set(["proposer", "userId", "participantId", "participant", "user", "username", "avatarUrl"]);

before(async () => {
    app = await buildApp();
    await resetDb();
    // id riconoscibili: nessun altro numero nei corpi può valere tanto
    await getPrismaClient().$executeRawUnsafe('ALTER SEQUENCE "Candidature_id_seq" RESTART WITH 700001');
    stubTmdb(MOVIES);
});
after(async () => {
    await getPrismaClient().$disconnect();
});

type U = Awaited<ReturnType<typeof makeUser>> & { name: string };
type Film = { cid: number; order: number | null; tmdbId: number; movie: (typeof MOVIES)[number]; proposer: U };

const hasKeyDeep = (v: unknown, keys: Set<string>): boolean =>
    !!v && typeof v === "object" && Object.entries(v).some(([k, x]) => keys.has(k) || hasKeyDeep(x, keys));

test("nessuna risposta del gioco tradisce film non svelati o proponenti", async () => {
    const db = getPrismaClient();
    const mk = async (name: string): Promise<U> => ({ ...(await makeUser(`${name}@x.it`)), name });
    const presi = await mk("proppresi");
    const [A, B, C] = [await mk("propalfa"), await mk("propbeta"), await mk("propgamma")];
    const users = [presi, A, B, C];
    const cf = await makeCineforum(presi, [A, B, C]);
    const cats = [
        await db.category.create({ data: { cineforumId: cf, name: "Cat uno" } }),
        await db.category.create({ data: { cineforumId: cf, name: "Cat due" } }),
    ];
    const [regia, trama] = [
        await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Regia?" } }),
        await db.award.create({ data: { cineforumId: cf, name: "Trama", question: "Trama?" } }),
    ];
    const created = await app.inject({
        method: "POST", url: `${URL}/cineforums/${cf}/seasons`, cookies: presi.cookies,
        payload: { name: "Edizione segreta", candidaturesCloseAt: days(7), categoryIds: cats.map(c => c.id), awardIds: [regia.id, trama.id], participantUserIds: users.map(u => u.id) },
    });
    const id: number = created.json().id;
    const base = `${URL}/cineforums/${cf}/seasons/${id}`;
    assert.equal((await app.inject({ method: "POST", url: `${base}/launch`, cookies: presi.cookies })).statusCode, 200);
    for (const [i, u] of users.entries()) {
        const r = await app.inject({ method: "PUT", url: `${base}/candidature`, cookies: u.cookies, payload: { tmdbId: MOVIES[i]!.tmdbId } });
        assert.equal(r.statusCode, 200);
    }
    const rows = await db.candidature.findMany({ where: { seasonId: id }, include: { participant: true, movie: true } });
    const films: Film[] = rows.map(r => {
        const movie = MOVIES.find(m => m.tmdbId === r.movie.tmdbId)!;
        return { cid: r.id, order: null, tmdbId: movie.tmdbId, movie, proposer: users.find(u => u.id === r.participant.userId)! };
    });
    assert.equal(films.length, 4);
    assert.ok(films.every(f => f.cid >= 700001), "sequenza delle candidature non impostata");
    const cids = new Set(films.map(f => f.cid));
    const isCid = (x: unknown) => (typeof x === "number" || typeof x === "string") && cids.has(Number(x));

    // stato noto al test, aggiornato a ogni passo
    const revealed = new Set<number>();
    const wonOpen = new Set<number>(); // candidature vincitrici di buste aperte
    let allOpen = false;

    /** Controlla un corpo dal punto di vista di `viewer`. */
    function check(viewer: U, label: string, body: string) {
        const where = `${label} [${viewer.name}]`;
        for (const f of films) {
            if (revealed.has(f.cid) || f.proposer === viewer) continue;
            for (const m of marks(f.movie)) assert.ok(!body.includes(m), `${where}: film non svelato ${m}`);
        }
        let json: unknown;
        try { json = JSON.parse(body); } catch { return; }
        const walk = (v: unknown): void => {
            if (!v || typeof v !== "object") return;
            if (Array.isArray(v)) {
                for (const x of v) assert.ok(!isCid(x), `${where}: id di candidatura ${x} in un array`);
                return v.forEach(walk);
            }
            const o = v as Record<string, unknown>;
            // nessun id di candidatura, sotto nessuna chiave, nemmeno come stringa
            for (const [k, x] of Object.entries(o)) {
                assert.ok(!isCid(x), `${where}: id di candidatura ${x} in ${k}`);
            }
            const movie = o.movie as { tmdbId?: number } | null | undefined;
            const f = movie && films.find(x => x.tmdbId === movie.tmdbId);
            if (f) {
                if ("order" in o && "votingOpen" in o) {
                    for (const k of Object.keys(o)) assert.ok(PROGRAM_KEYS.includes(k), `${where}: campo ${k} in un ProgramItem`);
                }
                const pairingAllowed = allOpen || wonOpen.has(f.cid) || f.proposer === viewer;
                if (!pairingAllowed) {
                    const rest = { ...o, movie: undefined };
                    assert.ok(!hasKeyDeep(rest, PROPOSER_KEYS), `${where}: proponente accanto a ${f.movie.title}`);
                    const s = JSON.stringify(rest);
                    for (const u of users) assert.ok(!s.includes(`"${u.name}"`), `${where}: ${u.name} accanto a ${f.movie.title}`);
                }
            }
            Object.values(o).forEach(walk);
        };
        walk(json);
    }

    /** Ogni GET del gioco, per presidente e membro semplice. */
    async function sweep(phase: string, summaryStatus: number) {
        for (const viewer of [presi, A]) {
            const routes = [
                base, `${URL}/cineforums/${cf}/seasons`, `${base}/progress`, `${base}/results`, `${base}/summary`,
                `${base}/candidature`, `${URL}/cineforums/${cf}/categories`, `${URL}/cineforums/${cf}/awards`,
                `${URL}/cineforums/${cf}`, `${URL}/cineforums`, `${URL}/cineforums/${cf}/invitations`, `${URL}/invitations/mine`,
                `${URL}/auth/me`,
                // anche gli ordini non svelati: devono essere indistinguibili da inesistenti
                ...[1, 2, 3, 4, 999999].map(n => `${base}/program/${n}/votes/me`),
            ];
            for (const url of routes) {
                const r = await app.inject({ method: "GET", url, cookies: viewer.cookies });
                assert.ok(r.statusCode < 500, `${phase} ${url}: ${r.statusCode}`);
                check(viewer, `${phase} GET ${url}`, r.body);
            }
            const missing = await app.inject({ method: "GET", url: `${base}/program/999999/votes/me`, cookies: viewer.cookies });
            assert.equal(missing.statusCode, 404);
            for (const n of [1, 2, 3, 4]) {
                if (films.some(f => f.order === n && revealed.has(f.cid))) continue;
                const r = await app.inject({ method: "GET", url: `${base}/program/${n}/votes/me`, cookies: viewer.cookies });
                assert.equal(r.statusCode, missing.statusCode, `${phase} votes/me ordine ${n} non svelato`);
                assert.equal(r.body, missing.body, `${phase} votes/me ordine ${n} non svelato`);
            }
            const s = await app.inject({ method: "GET", url: `${base}/summary`, cookies: viewer.cookies });
            assert.equal(s.statusCode, summaryStatus, `${phase} summary`);
            // la propria candidatura si vede sempre
            const mine = (await app.inject({ method: "GET", url: `${base}/candidature`, cookies: viewer.cookies })).json();
            assert.equal(mine.movie.tmdbId, films.find(f => f.proposer === viewer)!.tmdbId);
        }
    }

    // OPEN: tutte le candidature dentro, nessuno svelato
    await sweep("OPEN", 404);
    assert.deepEqual((await app.inject({ method: "GET", url: base, cookies: presi.cookies })).json().program, []);

    // SCREENING con un film svelato
    await db.season.update({ where: { id }, data: { candidaturesCloseAt: new Date(Date.now() - 1000) } });
    const revealOne = async () => {
        const r = await scheduleAndReveal(app, base, presi.cookies);
        assert.equal(r.statusCode, 200);
        const order: number = r.json().order;
        const f = films.find(x => x.movie.tmdbId === r.json().movie.tmdbId)!;
        f.order = order;
        revealed.add(f.cid);
        check(presi, "POST reveal-next", r.body);
        const sc = await app.inject({ method: "PATCH", url: `${base}/program/${order}/screening`, cookies: presi.cookies, payload: { screeningAt: new Date(Date.now() + 2 * 86400000).toISOString(), location: "Sala" } });
        assert.equal(sc.statusCode, 200);
        check(presi, "PATCH screening", sc.body);
        await db.candidature.update({ where: { id: f.cid }, data: { screeningAt: new Date(Date.now() - 1000) } });
        const ov = await app.inject({ method: "POST", url: `${base}/program/${order}/open-voting`, cookies: presi.cookies });
        assert.equal(ov.statusCode, 200);
        check(presi, "POST open-voting", ov.body);
        const rem = await app.inject({ method: "POST", url: `${base}/program/${order}/vote-reminder`, cookies: presi.cookies });
        check(presi, "POST vote-reminder", rem.body);
    };
    await revealOne();
    await sweep("SCREENING", 404);

    // tutti svelati, voti: Regia → film di A, Trama → film di B
    for (let i = 0; i < 3; i++) await revealOne();
    for (const f of films) {
        for (const v of users.filter(u => u !== f.proposer)) {
            const r = await app.inject({
                method: "POST", url: `${base}/program/${f.order}/votes`, cookies: v.cookies,
                payload: { votes: [{ awardId: regia.id, value: f.proposer === A ? 90 : 50 }, { awardId: trama.id, value: f.proposer === B ? 80 : 40 }] },
            });
            assert.equal(r.statusCode, 201);
            check(v, "POST votes", r.body);
        }
    }
    await sweep("SCREENING tutti svelati", 404);

    // FINAL: una busta aperta, solo il vincitore ha un proponente
    const o1 = await app.inject({ method: "POST", url: `${base}/awards/${regia.id}/open`, cookies: presi.cookies });
    assert.equal(o1.statusCode, 200);
    wonOpen.add(films.find(f => f.proposer === A)!.cid);
    check(presi, "POST open Regia", o1.body);
    assert.equal(o1.json().winners.length, 1);
    await sweep("FINAL", 404);

    // DONE: tutto pubblico, la scheda esiste
    const o2 = await app.inject({ method: "POST", url: `${base}/awards/${trama.id}/open`, cookies: presi.cookies });
    assert.equal(o2.statusCode, 200);
    allOpen = true;
    await sweep("DONE", 200);
});
