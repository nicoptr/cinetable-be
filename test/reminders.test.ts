import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getInstanceByToken } from "fastify-decorators";
import { buildApp, resetDb, TEST_OUTBOX } from "./helpers";
import { makeCineforum, makeUser } from "./game-helpers";
import { getPrismaClient } from "@utils/prisma";
import { ReminderService } from "@services/ReminderService";

const hours = (n: number) => new Date(Date.now() + n * 3600000);

before(async () => {
    await buildApp();
    await resetDb();
});
after(async () => {
    await getPrismaClient().$disconnect();
});

test("promemoria solo a chi non ha una candidatura valida, solo entro 72 h", async () => {
    const db = getPrismaClient();
    const service = getInstanceByToken<ReminderService>(ReminderService);
    const [A, B, C] = [await makeUser("a-rem@x.it"), await makeUser("b-rem@x.it"), await makeUser("c-rem@x.it")];
    const cf = await makeCineforum(A, [B, C]);
    const category = await db.category.create({ data: { cineforumId: cf, name: "Horror <b>" } });
    await db.movie.createMany({ data: [1, 2].map(tmdbId => ({ tmdbId, title: `F${tmdbId}`, originalTitle: `F${tmdbId}` })) });

    const mk = (name: string, status: "DRAFT" | "OPEN", closeInHours: number) => db.season.create({
        data: {
            cineforumId: cf, name, status, candidaturesCloseAt: hours(closeInHours),
            participants: { create: [A, B, C].map(u => ({ userId: u.id, categoryId: category.id })) },
        },
        include: { participants: true },
    });
    const open = await mk("Rassegna <i>", "OPEN", 48);
    const part = (u: { id: number }) => open.participants.find(p => p.userId === u.id)!;
    await db.candidature.create({ data: { seasonId: open.id, participantId: part(A).id, tmdbId: 1, status: "VALID" } });
    await db.candidature.create({ data: { seasonId: open.id, participantId: part(B).id, tmdbId: 2, status: "DUPLICATE" } });
    await mk("Lontana", "OPEN", 120);
    await mk("Scaduta", "OPEN", -1);
    await mk("Bozza", "DRAFT", 48);
    TEST_OUTBOX.length = 0;

    assert.equal(await service.sendDeadlineReminders(new Date()), 2);
    assert.deepEqual(TEST_OUTBOX.map(m => m.to).sort(), ["b-rem@x.it", "c-rem@x.it"]);
    for (const m of TEST_OUTBOX) {
        assert.equal(m.subject, "Promemoria: candida il tuo film");
        assert.match(m.html, /Rassegna &lt;i&gt;/);
        assert.match(m.html, /Horror &lt;b&gt;/);
    }
});
