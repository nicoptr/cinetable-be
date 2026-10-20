import httpErrors from "http-errors";

/** Un id di path non numerico è una risorsa che non esiste: 404, non 400/500. */
export function parseId(raw: string, notFound = "Cineforum non trovato"): number {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new httpErrors.NotFound(notFound);
    return id;
}
