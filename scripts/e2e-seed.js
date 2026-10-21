#!/usr/bin/env node
/**
 * Seed deterministico per gli e2e del frontend: `node scripts/e2e-seed.js <base|open|late|screening|final|done>`.
 * Legge DATABASE_URL da `.env.e2e` e rifiuta qualsiasi DB il cui nome non finisca con `_e2e`.
 * Svuota tutte le tabelle (RESTART IDENTITY) e ricrea tutto sempre nello stesso ordine: gli id sono fissi.
 *
 * base
 *   utenti (id): 1 anna (presidente), 2 bruno, 3 carla, 4 dario — `<nome>@e2e.it`, password `password-e2e`
 *   cineforum 1 "Cinofili del giovedì": anna PRESIDENT, bruno/carla/dario MEMBER
 *   categorie 1 "Horror anni '80", 2 "Commedia italiana"; premi 1 "Miglior film", 2 "Miglior regia"
 *   film: 1091 La cosa, 550 Fight Club, 620 Ghostbusters, 11216 Nuovo Cinema Paradiso
 *   invito 1 PENDING a ospite@e2e.it per il cineforum 1 (token INVITE_TOKEN_NEW)
 *   cineforum 2 "Cineclub di Dario" (dario PRESIDENT, unico membro), invito 2 PENDING a carla@e2e.it (token INVITE_TOKEN_CARLA)
 *   utente 5 `nuovo` (nuovo@e2e.it) non verificato, token di verifica VERIFY_TOKEN
 * open      = base + edizione 1 "Stagione 1" OPEN, scadenza +7 giorni, serata finale +30 giorni, 4 partecipanti,
 *             anna/carla → Horror anni '80, bruno/dario → Commedia italiana, entrambi i premi
 * late      = open + candidature VALID solo di anna (1091) e bruno (620), scadenza nel passato: carla e dario mancano
 * screening = open + candidature VALID (anna 1091, bruno 620, carla 550, dario 11216), scadenza nel passato;
 *             stato ancora OPEN: il primo reveal-next fissa l'ordine e passa a SCREENING, come in produzione
 * final     = screening + ordine fisso e tutte svelate: 1 La cosa (anna), 2 Ghostbusters (bruno),
 *             3 Fight Club (carla), 4 Nuovo Cinema Paradiso (dario); proiettate ieri, voto aperto, tutti hanno votato.
 *             Stato SCREENING: è l'apertura della prima busta a portarla in FINAL.
 *             Voti [Miglior film, Miglior regia] (votante → film):
 *               anna  → Ghostbusters [60,50]  Fight Club [90,70]  Paradiso [70,60]
 *               bruno → La cosa [70,95]       Fight Club [85,60]  Paradiso [65,55]
 *               carla → La cosa [75,90]       Ghostbusters [55,45] Paradiso [80,65]
 *               dario → La cosa [60,85]       Ghostbusters [50,40] Fight Club [95,75]
 *             Medie Miglior film:  Fight Club 90 · Paradiso 71.7 · La cosa 68.3 · Ghostbusters 55  → vince Fight Club (carla)
 *             Medie Miglior regia: La cosa 90 · Fight Club 68.3 · Paradiso 60 · Ghostbusters 45    → vince La cosa (anna)
 * done      = final + buste aperte (prima "Miglior film", poi "Miglior regia"), stato DONE
 */
const path = require("node:path");
const { createHash } = require("node:crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.e2e"), override: true });
const { PrismaClient } = require("@prisma/client");
const { hashSync } = require("bcryptjs");

const INVITE_TOKEN_NEW = "e2e0000000000000000000000000000000000000000000000000000000000001";
const INVITE_TOKEN_CARLA = "e2e0000000000000000000000000000000000000000000000000000000000002";
const VERIFY_TOKEN = "e2e0000000000000000000000000000000000000000000000000000000000003";
const PASSWORD = "password-e2e";

const SCENARIOS = ["base", "open", "screening", "final", "done"];
const scenario = process.argv[2];
const late = scenario === "late";
if (!SCENARIOS.includes(scenario) && !late) {
    console.error(`Uso: node scripts/e2e-seed.js <${[...SCENARIOS, "late"].join("|")}>`);
    process.exit(1);
}
const dbName = (() => {
    try {
        return new URL(process.env.DATABASE_URL).pathname;
    } catch {
        return "";
    }
})();
if (!/_e2e$/.test(dbName)) {
    console.error("DATABASE_URL non è un database e2e: mi rifiuto di svuotarlo");
    process.exit(1);
}

const sha256 = t => createHash("sha256").update(t).digest("hex");
const DAY = 86400000;
const at = days => new Date(Date.now() + days * DAY);
const level = late ? 2 : SCENARIOS.indexOf(scenario);

const MOVIES = [
    { tmdbId: 1091, title: "La cosa", originalTitle: "The Thing", year: 1982, posterPath: "/tzGY49kseSE9QAKk47uuDGwnSCu.jpg" },
    { tmdbId: 550, title: "Fight Club", originalTitle: "Fight Club", year: 1999, posterPath: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg" },
    { tmdbId: 620, title: "Ghostbusters", originalTitle: "Ghostbusters", year: 1984, posterPath: "/7E8nLijS9AwwUEPu2oFYOVKhdFA.jpg" },
    { tmdbId: 11216, title: "Nuovo Cinema Paradiso", originalTitle: "Nuovo Cinema Paradiso", year: 1988, posterPath: "/8SRUfRUi6x4O68n0VCbDNRa6iGL.jpg" },
];
// [username, categoria (1 horror, 2 commedia), film candidato]
const PLAYERS = [["anna", 1, 1091], ["bruno", 2, 620], ["carla", 1, 550], ["dario", 2, 11216]];
const PROJECTION = [1091, 620, 550, 11216];
// VOTES[votante][tmdbId] = [Miglior film, Miglior regia]
const VOTES = {
    anna: { 620: [60, 50], 550: [90, 70], 11216: [70, 60] },
    bruno: { 1091: [70, 95], 550: [85, 60], 11216: [65, 55] },
    carla: { 1091: [75, 90], 620: [55, 45], 11216: [80, 65] },
    dario: { 1091: [60, 85], 620: [50, 40], 550: [95, 75] },
};

async function main(db) {
    await db.$executeRawUnsafe(
        'TRUNCATE "User","Cineforum","Membership","Invitation","AuthToken","Category","Award","Season","SeasonAward","Participant","Movie","Candidature","BannedMovie","Vote" RESTART IDENTITY CASCADE',
    );
    const password = hashSync(PASSWORD, 4);
    const users = {};
    for (const [name] of PLAYERS) {
        users[name] = await db.user.create({ data: { username: name, email: `${name}@e2e.it`, password, emailVerifiedAt: new Date() } });
    }
    const club = await db.cineforum.create({ data: { name: "Cinofili del giovedì" } });
    for (const [name] of PLAYERS) {
        await db.membership.create({ data: { userId: users[name].id, cineforumId: club.id, role: name === "anna" ? "PRESIDENT" : "MEMBER" } });
    }
    const horror = await db.category.create({ data: { cineforumId: club.id, name: "Horror anni '80" } });
    const comedy = await db.category.create({ data: { cineforumId: club.id, name: "Commedia italiana" } });
    const bestFilm = await db.award.create({ data: { cineforumId: club.id, name: "Miglior film", question: "Quanto ti è piaciuto?" } });
    const bestDirection = await db.award.create({ data: { cineforumId: club.id, name: "Miglior regia", question: "Quanto ti ha convinto la regia?" } });
    for (const m of MOVIES) await db.movie.create({ data: m });
    await db.invitation.create({
        data: { cineforumId: club.id, email: "ospite@e2e.it", tokenHash: sha256(INVITE_TOKEN_NEW), expiresAt: at(7), invitedById: users.anna.id },
    });
    const darioClub = await db.cineforum.create({ data: { name: "Cineclub di Dario" } });
    await db.membership.create({ data: { userId: users.dario.id, cineforumId: darioClub.id, role: "PRESIDENT" } });
    await db.invitation.create({
        data: { cineforumId: darioClub.id, email: "carla@e2e.it", tokenHash: sha256(INVITE_TOKEN_CARLA), expiresAt: at(7), invitedById: users.dario.id },
    });
    const nuovo = await db.user.create({ data: { username: "nuovo", email: "nuovo@e2e.it", password } });
    await db.authToken.create({ data: { userId: nuovo.id, type: "VERIFY_EMAIL", tokenHash: sha256(VERIFY_TOKEN), expiresAt: at(1) } });
    if (level < 1) return;

    const categoryOf = { 1: horror.id, 2: comedy.id };
    const season = await db.season.create({
        data: {
            cineforumId: club.id, name: "Stagione 1", status: "OPEN", candidaturesCloseAt: at(7), finalNightAt: at(30),
            categories: { connect: [{ id: horror.id }, { id: comedy.id }] },
            awards: { create: [{ awardId: bestFilm.id }, { awardId: bestDirection.id }] },
        },
    });
    const participants = {};
    for (const [name, cat] of PLAYERS) {
        participants[name] = await db.participant.create({ data: { seasonId: season.id, userId: users[name].id, categoryId: categoryOf[cat] } });
    }
    if (level < 2) return;

    const candidatures = {};
    for (const [name, , tmdbId] of late ? PLAYERS.slice(0, 2) : PLAYERS) {
        candidatures[tmdbId] = await db.candidature.create({ data: { seasonId: season.id, participantId: participants[name].id, tmdbId } });
    }
    await db.season.update({ where: { id: season.id }, data: { candidaturesCloseAt: at(-1) } });
    if (late || level < 3) return;

    const yesterday = at(-1);
    for (const [i, tmdbId] of PROJECTION.entries()) {
        await db.candidature.update({
            where: { id: candidatures[tmdbId].id },
            data: { projectionOrder: i + 1, revealedAt: at(-3), screeningAt: yesterday, location: "Casa di Anna", votingOpenedAt: yesterday },
        });
    }
    await db.season.update({ where: { id: season.id }, data: { status: "SCREENING", candidaturesCloseAt: at(-4) } });
    for (const [voter, films] of Object.entries(VOTES)) {
        for (const [tmdbId, [film, direction]] of Object.entries(films)) {
            await db.vote.createMany({
                data: [
                    { candidatureId: candidatures[tmdbId].id, awardId: bestFilm.id, participantId: participants[voter].id, value: film },
                    { candidatureId: candidatures[tmdbId].id, awardId: bestDirection.id, participantId: participants[voter].id, value: direction },
                ],
            });
        }
    }
    if (level < 4) return;

    await db.seasonAward.update({ where: { seasonId_awardId: { seasonId: season.id, awardId: bestFilm.id } }, data: { revealedAt: at(-0.02) } });
    await db.seasonAward.update({ where: { seasonId_awardId: { seasonId: season.id, awardId: bestDirection.id } }, data: { revealedAt: at(-0.01) } });
    await db.season.update({ where: { id: season.id }, data: { status: "DONE" } });
}

const db = new PrismaClient();
main(db)
    .then(() => console.log(`e2e seed: ${scenario}`))
    .catch(err => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
