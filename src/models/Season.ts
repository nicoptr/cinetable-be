import { z } from "zod";

const ids = z.array(z.number().int().positive());

export const SeasonInputSchema = z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    candidaturesCloseAt: z.coerce.date(),
    finalNightAt: z.coerce.date().optional(),
    categoryIds: ids.min(1),
    awardIds: ids.min(1),
    participantUserIds: ids.min(2),
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
});
export type SeasonView = z.infer<typeof SeasonViewSchema>;
