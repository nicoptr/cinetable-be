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

export const InviteInfoSchema = z.object({
    email: z.string(),
    cineforumName: z.string(),
    invitedBy: z.string(),
    userExists: z.boolean(),
});
export type InviteInfo = z.infer<typeof InviteInfoSchema>;

export const MyInvitationSchema = z.object({
    id: z.number(),
    cineforumId: z.number(),
    cineforumName: z.string(),
    invitedBy: z.string(),
    expiresAt: z.string(),
});
export type MyInvitation = z.infer<typeof MyInvitationSchema>;
