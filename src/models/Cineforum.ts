import { z } from "zod";

export const CineforumInputSchema = z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
}).strict();
export type CineforumDTO = z.infer<typeof CineforumInputSchema>;

export const CineforumUpdateSchema = CineforumInputSchema.partial();
export type CineforumUpdateDTO = z.infer<typeof CineforumUpdateSchema>;

const Role = z.enum(["PRESIDENT", "MEMBER"]);

export const CineforumSchema = z.object({
    id: z.number(),
    name: z.string(),
    description: z.string().nullable(),
});

export const CineforumListItemSchema = CineforumSchema.extend({ role: Role });

export const CineforumDetailSchema = CineforumSchema.extend({
    myRole: Role,
    members: z.array(z.object({
        userId: z.number(),
        username: z.string(),
        avatarUrl: z.string().nullable(),
        role: Role,
    })),
});
