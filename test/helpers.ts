import "module-alias/register";
import "reflect-metadata";
import { APIServer } from "../src/server";
import { getPrismaClient, initializePrismaClient } from "@utils/prisma";
import { TEST_OUTBOX } from "@services/EmailSenderService";
import { FastifyApplication } from "../types";

export { TEST_OUTBOX };

let app: FastifyApplication | undefined;

export async function buildApp(): Promise<FastifyApplication> {
    if (!app) {
        await initializePrismaClient();
        const server = new APIServer();
        await server.ready();
        app = server.app;
    }
    return app;
}

export async function resetDb(): Promise<void> {
    await getPrismaClient().$executeRawUnsafe(
        'TRUNCATE "User","Cineforum","Membership","Invitation","AuthToken","Category","Award","Season","Movie" RESTART IDENTITY CASCADE'
    );
    TEST_OUTBOX.length = 0;
}

export function lastEmailTo(email: string) {
    const mail = [...TEST_OUTBOX].reverse().find(m => m.to === email);
    if (!mail) throw new Error(`Nessuna email inviata a ${email}`);
    return mail;
}
