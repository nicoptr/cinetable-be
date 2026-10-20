import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb, TEST_OUTBOX } from "./helpers";
import { makeCineforum, makeUser } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";
import { shuffle } from "@utils/random";

const URL = "/sub/api";
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
    app = await buildApp();
    await resetDb();
});
after(async () => {
    await getPrismaClient().$disconnect();
});

type U = Awaited<ReturnType<typeof makeUser>>;

async function setup(tag: string, memberCount = 3, categoryCount = 2) {
    const presi = await makeUser(`presi-${tag}@x.it`);
    const members: U[] = [];
    for (let i = 0; i < memberCount; i++) members.push(await makeUser(`m${i}-${tag}@x.it`));
    const cf = await makeCineforum(presi, members);
    const db = getPrismaClient();
    const categories = await Promise.all(Array.from({ length: categoryCount }, (_, i) => db.category.create({ data: { cineforumId: cf, name: `Categoria ${tag}${i}` } })));
    const award = await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Quanto ti è piaciuta la regia?" } });
    const body = {
        name: `Rassegna ${tag}`,
        candidaturesCloseAt: days(7),
        categoryIds: categories.map(c => c.id),
        awardIds: [award.id],
        participantUserIds: [presi.id, ...members.map(m => m.id)],
    };
    return { presi, members, cf, categories, award, body };
}

const create = (cf: number, who: U, payload: unknown) =>
    app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/seasons`, cookies: who.cookies, payload: payload as object });
const get = (cf: number, id: number, who: U) =>
    app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/seasons/${id}`, cookies: who.cookies });
const launch = (cf: number, id: number, who: U) =>
    app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/seasons/${id}/launch`, cookies: who.cookies });
const patch = (cf: number, id: number, who: U, payload: unknown) =>
    app.inject({ method: "PATCH", url: `${URL}/cineforums/${cf}/seasons/${id}`, cookies: who.cookies, payload: payload as object });

test("bozza → avvio: ognuno riceve solo la sua categoria", async () => {
    const { presi, members, cf, categories, body } = await setup("a");
    const created = await create(cf, presi, body);
    assert.equal(created.statusCode, 201);
    const view = created.json();
    assert.equal(view.status, "DRAFT");
    assert.equal(view.myCategory, null);
    assert.equal(view.candidatures.expected, 4);
    assert.equal(view.participants.length, 4);
    TEST_OUTBOX.length = 0;

    const res = await launch(cf, view.id, presi);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "OPEN");

    const names = new Set(categories.map(c => c.name));
    const assigned: string[] = [];
    for (const u of [presi, ...members]) {
        const v = (await get(cf, view.id, u)).json();
        assert.ok(v.myCategory);
        assigned.push(v.myCategory.name);
        assert.ok(!JSON.stringify(v).includes("categoryId"));
    }
    assert.equal(new Set(assigned).size, names.size);
    const counts = names.size && [...names].map(n => assigned.filter(a => a === n).length);
    assert.deepEqual(counts, [2, 2]);

    assert.equal(TEST_OUTBOX.length, 4);
    for (const u of [presi, ...members]) {
        const email = (await getPrismaClient().user.findUniqueOrThrow({ where: { id: u.id } })).email;
        const mail = TEST_OUTBOX.find(m => m.to === email)!;
        const mine = (await get(cf, view.id, u)).json().myCategory.name;
        assert.equal(mail.subject, `Sei in gara: ${body.name}`);
        assert.ok(mail.html.includes(mine));
        const other = [...names].find(n => n !== mine)!;
        assert.ok(!mail.html.includes(other));
    }
});

test("shuffle non muta l'input e restituisce una permutazione", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...input];
    const out = shuffle(input);
    assert.deepEqual(input, copy);
    assert.deepEqual([...out].sort((a, b) => a - b), copy);
});

test("membro non presidente non può creare/avviare → 403", async () => {
    const { presi, members, cf, body } = await setup("b");
    assert.equal((await create(cf, members[0]!, body)).statusCode, 403);
    const id = (await create(cf, presi, body)).json().id;
    assert.equal((await launch(cf, id, members[0]!)).statusCode, 403);
    assert.equal((await patch(cf, id, members[0]!, { description: "x" })).statusCode, 403);
});

test("rassegna di un altro cineforum nel path del mio → 404", async () => {
    const mine = await setup("c");
    const theirs = await setup("c2");
    const id = (await create(theirs.cf, theirs.presi, theirs.body)).json().id;
    assert.equal((await get(mine.cf, id, mine.presi)).statusCode, 404);
    assert.equal((await launch(mine.cf, id, mine.presi)).statusCode, 404);
    assert.equal((await patch(mine.cf, id, mine.presi, { description: "x" })).statusCode, 404);
    assert.equal((await get(theirs.cf, id, mine.presi)).statusCode, 404);
});

test("validazioni: partecipante non membro, categorie in eccesso, date", async () => {
    const { presi, cf, body } = await setup("d", 3, 2);
    const estraneo = await makeUser("estraneo-d@x.it");
    const bad: [object, string][] = [
        [{ ...body, participantUserIds: [...body.participantUserIds, estraneo.id] }, "Partecipanti non validi"],
        [{ ...body, participantUserIds: body.participantUserIds.slice(0, 1) }, ""],
        [{ ...body, participantUserIds: [body.participantUserIds[0], body.participantUserIds[0]] }, "Valori duplicati"],
        [{ ...body, awardIds: [body.awardIds[0], body.awardIds[0]] }, "Valori duplicati"],
        [{ ...body, categoryIds: [body.categoryIds[0], body.categoryIds[0]] }, "Valori duplicati"],
        [{ ...body, candidaturesCloseAt: days(-1) }, "La chiusura delle candidature deve essere futura"],
        [{ ...body, finalNightAt: days(3) }, "La serata finale deve essere dopo la chiusura delle candidature"],
        [{ ...body, categoryIds: [999999] }, "Categorie non valide"],
        [{ ...body, awardIds: [999999] }, "Premi non validi"],
    ];
    for (const [b, msg] of bad) {
        const res = await create(cf, presi, b);
        assert.equal(res.statusCode, 400);
        assert.ok(res.body.includes(msg), res.body);
    }

    const many = await setup("d2", 1, 3); // 2 partecipanti, 3 categorie
    const res = await create(many.cf, many.presi, many.body);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().message, "Non puoi avere più categorie che partecipanti");
});

test("in OPEN posso prorogare la scadenza ma non cambiare le categorie", async () => {
    const { presi, cf, categories, body } = await setup("e");
    const id = (await create(cf, presi, body)).json().id;
    assert.equal((await launch(cf, id, presi)).statusCode, 200);
    const ok = await patch(cf, id, presi, { candidaturesCloseAt: days(10) });
    assert.equal(ok.statusCode, 200);
    assert.equal(new Date(ok.json().candidaturesCloseAt).getTime() > Date.now() + 9 * 86400000, true);
    const no = await patch(cf, id, presi, { categoryIds: [categories[0]!.id] });
    assert.equal(no.statusCode, 400);
    assert.equal(no.json().message, "Non modificabile in questa fase");
    assert.equal((await patch(cf, id, presi, { candidaturesCloseAt: days(-1) })).statusCode, 400);
});

test("in DRAFT posso cambiare tutto; in DONE nulla", async () => {
    const { presi, members, cf, body } = await setup("f");
    const id = (await create(cf, presi, body)).json().id;
    const res = await patch(cf, id, presi, { name: "Nuovo nome", participantUserIds: [presi.id, members[0]!.id] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().name, "Nuovo nome");
    assert.equal(res.json().participants.length, 2);
    await getPrismaClient().season.update({ where: { id }, data: { status: "DONE" } });
    const done = await patch(cf, id, presi, { description: "x" });
    assert.equal(done.statusCode, 400);
});

test("launch due volte → 400; elenco rassegne", async () => {
    const { presi, members, cf, body } = await setup("g");
    const id = (await create(cf, presi, body)).json().id;
    assert.equal((await launch(cf, id, presi)).statusCode, 200);
    assert.equal((await launch(cf, id, presi)).statusCode, 400);
    const list = await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/seasons`, cookies: members[0]!.cookies });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(Object.keys(list.json()[0]).sort(), ["candidaturesCloseAt", "finalNightAt", "id", "name", "status"]);
});

test("DELETE: solo bozze, solo il presidente", async () => {
    const { presi, members, cf, body } = await setup("h");
    const del = (id: number, who: U) => app.inject({ method: "DELETE", url: `${URL}/cineforums/${cf}/seasons/${id}`, cookies: who.cookies });
    const draft = (await create(cf, presi, body)).json().id;
    assert.equal((await del(draft, members[0]!)).statusCode, 403);
    assert.equal((await del(draft, presi)).statusCode, 204);
    assert.equal((await get(cf, draft, presi)).statusCode, 404);
    assert.equal((await del(draft, presi)).statusCode, 404);

    const started = (await create(cf, presi, body)).json().id;
    assert.equal((await launch(cf, started, presi)).statusCode, 200);
    const no = await del(started, presi);
    assert.equal(no.statusCode, 400);
    assert.equal(no.json().message, "Si può eliminare solo una bozza");
    assert.equal((await get(cf, started, presi)).statusCode, 200);
});

test("date nelle risposte: stringhe ISO", async () => {
    const { presi, cf, body } = await setup("i");
    const night = days(9);
    const view = (await create(cf, presi, { ...body, finalNightAt: night })).json();
    assert.equal(view.candidaturesCloseAt, body.candidaturesCloseAt);
    assert.equal(view.finalNightAt, night);
    const list = (await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/seasons`, cookies: presi.cookies })).json();
    assert.equal(list[0].candidaturesCloseAt, view.candidaturesCloseAt);
    assert.equal(list[0].finalNightAt, view.finalNightAt);
});
