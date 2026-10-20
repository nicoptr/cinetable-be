import { z } from "zod";
import { Prisma } from "@prisma/client";
import { MovieView, MovieViewSchema, toMovieView } from "@models/Movie";

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

export const ScreeningInputSchema = z.object({ screeningAt: z.coerce.date(), location: z.string().trim().min(1).max(200) }).strict();
export type ScreeningDTO = z.infer<typeof ScreeningInputSchema>;

/** Quel che serve a un ProgramItem: `participantId` solo per `isMine`, non esce mai. */
export const programSelect = {
    id: true, projectionOrder: true, screeningAt: true, location: true, votingOpenedAt: true, participantId: true,
    movie: true,
    participant: { select: { category: { select: { id: true, name: true } } } },
    season: { select: { _count: { select: { participants: true } } } },
} satisfies Prisma.CandidatureSelect;
export type ProgramRow = Prisma.CandidatureGetPayload<{ select: typeof programSelect }>;

export const ProgramItemSchema = z.object({
    candidatureId: z.number(),
    order: z.number(),
    movie: MovieViewSchema,
    category: z.object({ id: z.number(), name: z.string() }).nullable(),
    screeningAt: z.date().nullable(),
    location: z.string().nullable(),
    votingOpen: z.boolean(),
    isMine: z.boolean(),
    myVoteSubmitted: z.boolean(),
    votesMissing: z.number().optional(),
});
export type ProgramItem = z.infer<typeof ProgramItemSchema>;
export type Viewer = { participantId: number | null; isPresident: boolean };

/**
 * Unico punto che descrive un film agli altri: va chiamato solo su candidature svelate
 * e non espone mai il proponente.
 */
export function toProgramItem(c: ProgramRow, viewer: Viewer): ProgramItem {
    return {
        candidatureId: c.id,
        order: c.projectionOrder!,
        movie: toMovieView(c.movie),
        category: c.participant.category,
        screeningAt: c.screeningAt,
        location: c.location,
        votingOpen: c.votingOpenedAt != null,
        isMine: c.participantId === viewer.participantId,
        myVoteSubmitted: false, // Task 6
        // nessun voto finché non arriva il Task 6: mancano tutti tranne il proponente
        ...(viewer.isPresident && { votesMissing: c.season._count.participants - 1 }),
    };
}
