import { PrismaClient } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { LOGGER } from "@utils/winston";
import * as process from "process";

let db: PrismaClient;
export async function initializePrismaClient() {
    db = new PrismaClient({ log: ['info', 'error'], errorFormat: "pretty" });
    try {
        await db.$connect();
        LOGGER.info("Start connection on DB!");
    } catch (err: unknown) {
        LOGGER.error(`Couldn't start server: ${(err as Error).message} ${(err as Error).stack}`);
        process.exit(0);
    }
    return db;
}

export function getPrismaClient() {
    return db;
}


export function isUniqueViolation(err: unknown): boolean {
    return err instanceof PrismaClientKnownRequestError && err.code === "P2002";
}

export function removeAnsi(string: String): String {
    return string
        .replace(/\x1B\[[0-9;]*[mK]/g, "")  // remove ANSI
        .replace(/[\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g, "") // remove whitespaces
        .normalize("NFKC")
        .trim();
}
