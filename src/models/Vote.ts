import { z } from "zod";

export const VoteInputSchema = z.object({
    votes: z.array(z.object({ awardId: z.number().int(), value: z.number().int().min(0).max(100) }).strict()),
}).strict();
export type VoteDTO = z.infer<typeof VoteInputSchema>;

export const MyVoteSchema = z.object({ awardId: z.number(), value: z.number() });
