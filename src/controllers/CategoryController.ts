import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, DELETE, GET, PATCH, POST } from "fastify-decorators";
import { z } from "zod";
import { CategoryService } from "@services/CategoryService";
import { CategoryDTO, CategoryInputSchema, CategorySchema, CategoryUpdateDTO, CategoryUpdateSchema } from "@models/Category";
import { Authenticate } from "@middleware/Authenticate";
import { parseId } from "@utils/params";

type Item = { id: string; categoryId: string };

@Controller({
    route: "/cineforums/:id/categories",
    tags: [{ name: "Categories", description: "Categories of a cineforum" }],
})
export class CategoryController {
    constructor(private readonly service: CategoryService) {}

    @GET("/", {
        schema: { operationId: "listCategories", summary: "List categories (members)", response: { 200: z.array(CategorySchema) } },
        onRequest: [Authenticate()],
    })
    async list(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        reply.status(200).send(await this.service.list(req.user.id, parseId(req.params.id)));
    }

    @POST("/", {
        schema: { operationId: "createCategory", summary: "Create (category, president only)", body: CategoryInputSchema, response: { 201: CategorySchema } },
        onRequest: [Authenticate()],
    })
    async create(req: FastifyRequest<{ Params: { id: string }; Body: CategoryDTO }>, reply: FastifyReply) {
        reply.status(201).send(await this.service.create(req.user.id, parseId(req.params.id), req.body));
    }

    @PATCH("/:categoryId", {
        schema: { operationId: "updateCategory", summary: "Update (president only)", body: CategoryUpdateSchema, response: { 200: CategorySchema } },
        onRequest: [Authenticate()],
    })
    async update(req: FastifyRequest<{ Params: Item; Body: CategoryUpdateDTO }>, reply: FastifyReply) {
        const { id, categoryId } = req.params;
        reply.status(200).send(await this.service.update(req.user.id, parseId(id), parseId(categoryId, "Categoria non trovata"), req.body));
    }

    @DELETE("/:categoryId", {
        schema: { operationId: "deleteCategory", summary: "Delete; 409 if used in a season (president only)" },
        onRequest: [Authenticate()],
    })
    async delete(req: FastifyRequest<{ Params: Item }>, reply: FastifyReply) {
        const { id, categoryId } = req.params;
        await this.service.delete(req.user.id, parseId(id), parseId(categoryId, "Categoria non trovata"));
        reply.status(204).send();
    }
}
