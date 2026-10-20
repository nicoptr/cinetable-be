import { z } from "zod";

export const LoginInputSchema = z.object({
    usernameOrEmail: z.string().trim().min(1),
    password: z.string().min(1),
});
export type LoginDTO = z.infer<typeof LoginInputSchema>;

export const RegisterInputSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    username: z.string().trim().min(3).max(30),
    password: z.string().min(8),
    inviteToken: z.string().optional(),
}).strict();
export type RegisterDTO = z.infer<typeof RegisterInputSchema>;

export const TokenInputSchema = z.object({ token: z.string().min(1) });
export const EmailInputSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const ResetPasswordInputSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });
