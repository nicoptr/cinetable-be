import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, resetDb } from "./helpers";
import { makeCineforum, makeUser } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";

const URL = "/sub/api";
let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
    app = await buildApp();
    await resetDb();
});
after(async () => {
    await getPrismaClient().$disconnect();
});

test("presidente crea categoria, membro la legge, membro non può crearla", async () => {
    const presi = await makeUser("presi@x.it");
    const membro = await makeUser("membro@x.it");
    const cf = await makeCineforum(presi, [membro]);
    const res = await app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/categories`, cookies: presi.cookies, payload: { name: "Horror" } });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.json(), { id: res.json().id, name: "Horror", description: null });
    const list = await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/categories`, cookies: membro.cookies });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().length, 1);
    const denied = await app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/categories`, cookies: membro.cookies, payload: { name: "Giallo" } });
    assert.equal(denied.statusCode, 403);
    const bad = await app.inject({ method: "POST", url: `${URL}/cineforums/${cf}/categories`, cookies: presi.cookies, payload: { name: "Giallo", x: 1 } });
    assert.equal(bad.statusCode, 400);
});

test("estraneo → 404 su GET", async () => {
    const presi = await makeUser("presi2@x.it");
    const estraneo = await makeUser("estraneo2@x.it");
    const cf = await makeCineforum(presi);
    for (const path of ["categories", "awards"]) {
        const res = await app.inject({ method: "GET", url: `${URL}/cineforums/${cf}/${path}`, cookies: estraneo.cookies });
        assert.equal(res.statusCode, 404);
    }
});

test("categoria di un altro cineforum nel path del mio → 404 su PATCH e DELETE", async () => {
    const presi = await makeUser("presi3@x.it");
    const altro = await makeUser("altro3@x.it");
    const mio = await makeCineforum(presi);
    const suo = await makeCineforum(altro);
    const cat = await getPrismaClient().category.create({ data: { cineforumId: suo, name: "Sua" } });
    const patch = await app.inject({ method: "PATCH", url: `${URL}/cineforums/${mio}/categories/${cat.id}`, cookies: presi.cookies, payload: { name: "Mia" } });
    assert.equal(patch.statusCode, 404);
    const del = await app.inject({ method: "DELETE", url: `${URL}/cineforums/${mio}/categories/${cat.id}`, cookies: presi.cookies });
    assert.equal(del.statusCode, 404);
    assert.equal(await getPrismaClient().category.count({ where: { id: cat.id } }), 1);
});

test("premio con domanda: CRUD", async () => {
    const presi = await makeUser("presi4@x.it");
    const cf = await makeCineforum(presi);
    const base = `${URL}/cineforums/${cf}/awards`;
    const created = await app.inject({ method: "POST", url: base, cookies: presi.cookies, payload: { name: "Miglior regia", question: "Quanto ti è piaciuta la regia?" } });
    assert.equal(created.statusCode, 201);
    const { id } = created.json();
    assert.deepEqual(created.json(), { id, name: "Miglior regia", question: "Quanto ti è piaciuta la regia?" });
    const short = await app.inject({ method: "POST", url: base, cookies: presi.cookies, payload: { name: "Premio", question: "Boh" } });
    assert.equal(short.statusCode, 400);
    const patched = await app.inject({ method: "PATCH", url: `${base}/${id}`, cookies: presi.cookies, payload: { name: "Regia" } });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().name, "Regia");
    assert.equal(patched.json().question, "Quanto ti è piaciuta la regia?");
    assert.equal((await app.inject({ method: "GET", url: base, cookies: presi.cookies })).json().length, 1);
    assert.equal((await app.inject({ method: "DELETE", url: `${base}/${id}`, cookies: presi.cookies })).statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url: base, cookies: presi.cookies })).json().length, 0);
});

test("DELETE di categoria o premio usati in un'edizione → 409", async () => {
    const presi = await makeUser("presi5@x.it");
    const cf = await makeCineforum(presi);
    const db = getPrismaClient();
    const cat = await db.category.create({ data: { cineforumId: cf, name: "Horror" } });
    const award = await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Quanto ti è piaciuta?" } });
    await db.season.create({
        data: {
            cineforumId: cf, name: "Stagione 1", candidaturesCloseAt: new Date(),
            categories: { connect: { id: cat.id } }, awards: { create: { awardId: award.id } },
        },
    });
    const c = await app.inject({ method: "DELETE", url: `${URL}/cineforums/${cf}/categories/${cat.id}`, cookies: presi.cookies });
    assert.equal(c.statusCode, 409);
    assert.equal(c.json().message, "Categoria usata in un'edizione");
    const a = await app.inject({ method: "DELETE", url: `${URL}/cineforums/${cf}/awards/${award.id}`, cookies: presi.cookies });
    assert.equal(a.statusCode, 409);
    assert.equal(a.json().message, "Premio usato in un'edizione");
});

test("PATCH di categoria o premio usati in un'edizione avviata → 409; in bozza no", async () => {
    const presi = await makeUser("presi6@x.it");
    const cf = await makeCineforum(presi);
    const db = getPrismaClient();
    const cat = await db.category.create({ data: { cineforumId: cf, name: "Horror" } });
    const award = await db.award.create({ data: { cineforumId: cf, name: "Regia", question: "Quanto ti è piaciuta?" } });
    const season = await db.season.create({
        data: {
            cineforumId: cf, name: "Stagione 1", candidaturesCloseAt: new Date(),
            categories: { connect: { id: cat.id } }, awards: { create: { awardId: award.id } },
        },
    });
    const patchCat = () => app.inject({ method: "PATCH", url: `${URL}/cineforums/${cf}/categories/${cat.id}`, cookies: presi.cookies, payload: { name: "Thriller" } });
    const patchAward = () => app.inject({ method: "PATCH", url: `${URL}/cineforums/${cf}/awards/${award.id}`, cookies: presi.cookies, payload: { name: "Fotografia" } });
    // in bozza si modificano ancora
    assert.equal((await patchCat()).statusCode, 200);
    assert.equal((await patchAward()).statusCode, 200);

    for (const status of ["OPEN", "DONE"] as const) {
        await db.season.update({ where: { id: season.id }, data: { status } });
        const c = await patchCat();
        assert.equal(c.statusCode, 409);
        assert.equal(c.json().message, "Usata in un'edizione avviata: crea una nuova categoria");
        const a = await patchAward();
        assert.equal(a.statusCode, 409);
        assert.equal(a.json().message, "Usato in un'edizione avviata: crea un nuovo premio");
    }
    assert.equal((await db.category.findUniqueOrThrow({ where: { id: cat.id } })).name, "Thriller");
    assert.equal((await db.award.findUniqueOrThrow({ where: { id: award.id } })).name, "Fotografia");
});
