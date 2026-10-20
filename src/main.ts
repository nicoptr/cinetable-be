import "module-alias/register";
import "reflect-metadata";

import { APIServer } from "./server";
import { initializePrismaClient } from "@utils/prisma";
import { LOGGER } from "@utils/winston";
import { seed } from "../prisma/seed";
import process from "process";
import { banner } from "@utils/banner";

async function start() {
    if (process.env.NODE_ENV === "production" && ((process.env.JWT_SECRET ?? "").length < 32 || !process.env.CLIENT_URL)) {
        LOGGER.error("Configurazione non valida: in production servono JWT_SECRET (min 32 caratteri) e CLIENT_URL");
        process.exit(1);
    }
    if (process.env.NODE_ENV === "production" && !process.env.TMDB_API_TOKEN) {
        LOGGER.error("Configurazione non valida: in production serve TMDB_API_TOKEN");
        process.exit(1);
    }
    console.log('\x1b[1;32m%s\x1b[0m', banner);
    const prismaClient = await initializePrismaClient();

    if (process.env.SEED_DB === "true") {
        await seed(prismaClient);
    }

    const apiServer = new APIServer();
    await apiServer.start();

    const graceful = async () => {
        await prismaClient.$disconnect();
        await apiServer.stop();
        process.exit(0);
    };

    // Stop graceful
    process.on("SIGTERM", graceful);
    process.on("SIGINT", graceful);
}

start()
    .catch(err => {
        LOGGER.error(`Couldn't start server: ${err.message} ${err.stack}`);
        process.exit(-1);
    });
