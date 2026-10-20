import { z } from "zod";
import { ProgramItemSchema } from "@models/Candidature";
import { MovieViewSchema } from "@models/Movie";

const ids = (min: number) => z.array(z.number().int().positive()).min(min).refine(a => new Set(a).size === a.length, "Valori duplicati");

export const SeasonInputSchema = z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    candidaturesCloseAt: z.coerce.date(),
    finalNightAt: z.coerce.date().optional(),
    categoryIds: ids(1),
    awardIds: ids(1),
    participantUserIds: ids(2),
}).strict();
export type SeasonDTO = z.infer<typeof SeasonInputSchema>;

export const SeasonUpdateSchema = SeasonInputSchema.partial();
export type SeasonUpdateDTO = z.infer<typeof SeasonUpdateSchema>;

const categoryView = z.object({ id: z.number(), name: z.string(), description: z.string().nullable() });

export const SeasonSummarySchema = z.object({
    id: z.number(),
    name: z.string(),
    status: z.enum(["DRAFT", "OPEN", "SCREENING", "FINAL", "DONE"]),
    candidaturesCloseAt: z.date(),
    finalNightAt: z.date().nullable(),
});

export const SeasonViewSchema = SeasonSummarySchema.extend({
    description: z.string().nullable(),
    categories: z.array(categoryView),
    awards: z.array(z.object({ id: z.number(), name: z.string(), question: z.string() })),
    participants: z.array(z.object({ userId: z.number(), username: z.string(), avatarUrl: z.string().nullable() })),
    myRole: z.enum(["PRESIDENT", "MEMBER"]),
    isParticipant: z.boolean(),
    myCategory: categoryView.nullable(),
    candidatures: z.object({ valid: z.number(), expected: z.number() }),
    /** Solo i film svelati, in ordine di proiezione. */
    program: z.array(ProgramItemSchema),
    remainingToReveal: z.number(),
});
export type SeasonView = z.infer<typeof SeasonViewSchema>;

const proposerView = z.object({ userId: z.number(), username: z.string(), avatarUrl: z.string().nullable() });

export const AwardResultSchema = z.object({
    awardId: z.number(),
    name: z.string(),
    question: z.string(),
    revealedAt: z.string(),
    winners: z.array(z.object({
        movie: MovieViewSchema,
        category: z.object({ id: z.number(), name: z.string() }).nullable(),
        proposer: proposerView,
        /** Arrotondata a 1 decimale, solo per mostrarla: il vincitore si decide sul confronto esatto. */
        average: z.number(),
        votes: z.number(),
    })),
});
export type AwardResult = z.infer<typeof AwardResultSchema>;

export const SeasonResultsSchema = z.object({
    /** Solo le buste aperte, in ordine di apertura. */
    awards: z.array(AwardResultSchema),
    allRevealed: z.boolean(),
    /** Vuoto finché non sono aperte tutte le buste. */
    proposers: z.array(z.object({ candidatureId: z.number(), movie: MovieViewSchema, proposer: proposerView })),
});
export type SeasonResults = z.infer<typeof SeasonResultsSchema>;
