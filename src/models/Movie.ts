import { z } from "zod";

export type TmdbMovie = { tmdbId: number; title: string; originalTitle: string; year: number | null; posterPath: string | null };
export type MovieView = TmdbMovie & { posterUrl: string | null };

export const toMovieView = (m: TmdbMovie): MovieView => ({
    ...m,
    posterUrl: m.posterPath ? `https://image.tmdb.org/t/p/w500${m.posterPath}` : null,
});

export const MovieSearchQuerySchema = z.object({
    q: z.string().trim().min(1).max(100),
    page: z.coerce.number().int().min(1).max(20).default(1),
});
export type MovieSearchQuery = z.infer<typeof MovieSearchQuerySchema>;

export const MovieViewSchema = z.object({
    tmdbId: z.number(),
    title: z.string(),
    originalTitle: z.string(),
    year: z.number().nullable(),
    posterPath: z.string().nullable(),
    posterUrl: z.string().nullable(),
});
export const MovieSearchResponseSchema = z.object({ results: z.array(MovieViewSchema), totalPages: z.number() });
