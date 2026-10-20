import { z } from "zod";

export const PublicUserSchema = z.object({
    id: z.number(),
    username: z.string(),
    email: z.string(),
    avatarUrl: z.string().nullable(),
    isPlatformAdmin: z.boolean(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const MeSchema = PublicUserSchema.extend({
    memberships: z.array(z.object({
        cineforumId: z.number(),
        name: z.string(),
        role: z.enum(["PRESIDENT", "MEMBER"]),
    })),
});
