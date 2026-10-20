import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { TmdbMovie } from "@models/Movie";

type TmdbRaw = { id: number; title: string; original_title: string; release_date?: string | null; poster_path?: string | null };

const toMovie = (r: TmdbRaw): TmdbMovie => ({
    tmdbId: r.id,
    title: r.title,
    originalTitle: r.original_title,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) || null : null,
    posterPath: r.poster_path ?? null,
});

@Service()
export class TmdbClient {
    /** Ritorna null su 404; rete o 5xx → 502. */
    private async get(path: string, params = ""): Promise<any | null> {
        const base = process.env.TMDB_BASE_URL ?? "https://api.themoviedb.org/3";
        let res: Response;
        try {
            res = await fetch(`${base}${path}?language=it-IT${params}`, {
                headers: { Authorization: `Bearer ${process.env.TMDB_API_TOKEN}`, Accept: "application/json" },
                signal: AbortSignal.timeout(5000),
            });
        } catch {
            throw new httpErrors.BadGateway("Servizio film non disponibile, riprova");
        }
        if (res.status === 404) return null;
        if (!res.ok) throw new httpErrors.BadGateway("Servizio film non disponibile, riprova");
        try {
            return await res.json();
        } catch {
            throw new httpErrors.BadGateway("Servizio film non disponibile, riprova");
        }
    }

    async search(query: string, page: number): Promise<{ results: TmdbMovie[]; totalPages: number }> {
        const body = await this.get("/search/movie", `&query=${encodeURIComponent(query)}&page=${page}`);
        return { results: (body?.results ?? []).map(toMovie), totalPages: body?.total_pages ?? 0 };
    }

    async getMovie(tmdbId: number): Promise<TmdbMovie | null> {
        const body = await this.get(`/movie/${tmdbId}`);
        return body ? toMovie(body) : null;
    }
}
