import { z } from "zod";

export const CategoryInputSchema = z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
}).strict();
export type CategoryDTO = z.infer<typeof CategoryInputSchema>;

export const CategoryUpdateSchema = CategoryInputSchema.partial();
export type CategoryUpdateDTO = z.infer<typeof CategoryUpdateSchema>;

export const CategorySchema = z.object({
    id: z.number(),
    name: z.string(),
    description: z.string().nullable(),
});
