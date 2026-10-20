import { z } from "zod";

export const AwardInputSchema = z.object({
    name: z.string().trim().min(2).max(80),
    question: z.string().trim().min(5).max(300),
}).strict();
export type AwardDTO = z.infer<typeof AwardInputSchema>;

export const AwardUpdateSchema = AwardInputSchema.partial();
export type AwardUpdateDTO = z.infer<typeof AwardUpdateSchema>;

export const AwardSchema = z.object({
    id: z.number(),
    name: z.string(),
    question: z.string(),
});
