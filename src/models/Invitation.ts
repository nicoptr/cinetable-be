import { z } from "zod";

export const InvitationCreateSchema = z.object({
    emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(50),
}).strict();
export type InvitationCreateDTO = z.infer<typeof InvitationCreateSchema>;

export const InvitationViewSchema = z.object({
    id: z.number(),
    email: z.string(),
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"]),
    expiresAt: z.string(),
    createdAt: z.string(),
});
export type InvitationView = z.infer<typeof InvitationViewSchema>;
