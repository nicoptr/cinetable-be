import { z } from "zod";

export const LoginInputSchema = z.object({
    usernameOrEmail: z.string().trim().min(1),
    password: z.string().min(1),
});
export type LoginDTO = z.infer<typeof LoginInputSchema>;
