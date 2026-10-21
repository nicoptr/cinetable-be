// TRUST_PROXY = numero di proxy fidati davanti a Fastify (hop count) oppure "false". null = valore non valido.
export function parseTrustProxy(raw: string | undefined): number | false | null {
    if (!raw || raw === "false") return false;
    return /^\d+$/.test(raw) ? Number(raw) : null;
}
