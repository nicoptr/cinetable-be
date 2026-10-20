import { z } from "zod";
import { MovieView, MovieViewSchema } from "@models/Movie";

export const CandidatureInputSchema = z.object({ tmdbId: z.number().int().positive() }).strict();
export type CandidatureDTO = z.infer<typeof CandidatureInputSchema>;

export const MyCandidatureViewSchema = z.object({
    status: z.enum(["VALID", "DUPLICATE", "NONE"]),
    movie: MovieViewSchema.nullable(),
});
export type MyCandidatureView = { status: "VALID" | "DUPLICATE" | "NONE"; movie: MovieView | null };

/** Solo conteggi e nomi di chi manca: mai i film degli altri. */
export const CandidatureProgressSchema = z.object({
    expected: z.number(),
    valid: z.number(),
    missing: z.array(z.object({ userId: z.number(), username: z.string() })),
});
