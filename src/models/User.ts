import { z } from "zod";
import { UsernameSchema } from "@models/Auth";

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

export const UpdateProfileInputSchema = z.object({
    username: UsernameSchema.optional(),
    avatarUrl: z.string().url().startsWith("https://").nullable().optional(),
}).strict();
export type UpdateProfileDTO = z.infer<typeof UpdateProfileInputSchema>;

export const ChangePasswordInputSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(72),
}).strict();
export type ChangePasswordDTO = z.infer<typeof ChangePasswordInputSchema>;
