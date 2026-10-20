import { PrismaClient } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import httpErrors from "http-errors";
import { LOGGER } from "@utils/winston";
import * as process from "process";
import { PaginateOptions } from "@utils/exz";

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


// https://www.prisma.io/docs/reference/api-reference/error-reference#error-codes
export function mapPrismaErrorToHttpError(err: PrismaClientKnownRequestError) {
    switch (err.code) {
        case "P2002":
            LOGGER.error(`Vincolo di unicità violato per il campo: ${(err.meta!.target as unknown as string[]).join(", ")}`);
            return new httpErrors.BadRequest(`Vincolo di unicità violato per il campo: ${(err.meta!.target as unknown as string[]).join(", ")}`);
        case "P2003":
            LOGGER.error(`Vincolo sulla chiave esterna violato per: ${err.meta!.field_name as string}`);
            return new httpErrors.BadRequest(`Vincolo sulla chiave esterna violato per: ${err.meta!.field_name as string}`);
        case "P2025": // Record not found
            LOGGER.error(`Campo non trovato: ${err.meta ? err.meta.cause as string : err.message}`);
            return new httpErrors.NotFound(`Campo non trovato: ${err.meta ? err.meta.cause as string : err.message}`);
        default:
            LOGGER.error(`${err.name}: ${removeAnsi(err.message)}`);
            return new httpErrors.InternalServerError(`${err.name}: ${err.message}`);
    }
}

export function mapPrismaErrorToConsoleError(err: PrismaClientKnownRequestError) {
    switch (err.code) {
        case "P2002":
            LOGGER.error(`Vincolo di unicità violato per il campo: ${(err.meta!.target as unknown as string[]).join(", ")}`);
            break;
        case "P2003":
            LOGGER.error(`Vincolo sulla chiave esterna violato per: ${err.meta!.field_name as string}`);
            break;
        case "P2025": // Record not found
            LOGGER.error(`Campo non trovato: ${err.meta ? err.meta.cause as string : err.message}`);
            break;
        default:
            LOGGER.error(`${err.name}: ${err.message}`);
    }
}

/**
 * Restituisce una nuova query con la proprietà "deleted" settata a false se diversa da null o undefined
 * @param query
 */
export function evaluateQuery(query: any) {
    return {
        ...query
    };
}

export function setPaginationAndPopulation(options: PaginateOptions) {
    return {
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        include: options?.populate ? getPopulateOptions(options.populate) : {},
        orderBy: options.sort
    };
}

export function setPagination(options: PaginateOptions) {
    return {
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        orderBy: options.sort
    };
}

export function getPaginationMetadata(options: PaginateOptions, totalDocs: number) {
    const totalPages = Math.ceil(totalDocs / options.limit);
    return {
        totalDocs,
        totalPages,
        hasNextPage: options.page < totalPages,
        nextPage: options.page < totalPages ? (options.page + 1) : undefined,
        hasPrevPage: options.page !== 1,
        prevPage: options.page !== 1 ? (options.page - 1) : undefined,
        page: options.page,
        limit: options.limit
    }
}

/**
 * Restituisce un oggetto contenente la formattazione json (per prisma) che consente
 * di popolare ricorsivamente figli e figli di figli (potenzialmente all'infinito)
 * @example fields: "cargo suppliers.supplier orders.order.customer orders.productionLane"
 * Se si vuole popolare più campi che condividono lo stesso padre ripetere nel populate: padre.figlio1 padre.figlio2
 * @param fields
 */
export function getPopulateOptions(fields: string | undefined) {
    return fields?.split(" ").reduce((acc, field) => ({
        ...deepMerge(acc, destructPopulation(field)),
    }), {}) ?? {};
}

function deepMerge(a: any, b: any): any {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
        out[k] = typeof v === "object" && v !== null && typeof out[k] === "object" ? deepMerge(out[k], v) : v;
    }
    return out;
}

export function destructPopulation(field: string): object {
    if(!field.includes(".")) {
        return {
            [field]: true
        }
    }

    const fields = field.split(".");
    return {
        [fields[0] as string]: {
            include: {
                ...destructPopulation(fields.slice(1).join("."))
            }
        }
    };
}

/**
 * Valido solo per la creazione di relazioni molti a molti
 * Restituisce un oggetto contenente la formattazione json (per prisma) che consente
 * di creare il record nella relazione indicata
 * @param arr key -> name of relation, field --> name of field, ids -> array of id for every field
 * Nel caso in cui la relazione abbia campi propri, non usare questo metodo
 * @example for Products { key: "suppliers", field: "supplier", ids: [4] }
 */
export function connectEntitiesOnCreate(arr?: { key: string, field: string, ids: number[] }[]) {
    if(!arr) return {};

    return arr.reduce((acc, { key, field, ids }) => ({
        ...acc,
        [key]: connectQueryOnCreate(field, ids)
    }), {});
}

export function connectQueryOnCreate(field: string, ids: number[]) {
    return {
        create: ids.map(id => ({
            [field]: {
                connect: { id }
            }
        }))
    }
}


export function removeAnsi(string: String): String {
    return string
        .replace(/\x1B\[[0-9;]*[mK]/g, "")  // remove ANSI
        .replace(/[\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g, "") // remove whitespaces
        .normalize("NFKC")
        .trim();
}
