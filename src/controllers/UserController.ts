import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, PATCH } from "fastify-decorators";
import { UserService } from "@services/UserService";
import { ChangePasswordDTO, ChangePasswordInputSchema, PublicUserSchema, UpdateProfileDTO, UpdateProfileInputSchema } from "@models/User";
import { Authenticate } from "@middleware/Authenticate";
import { setSessionCookie } from "@utils/session";

@Controller({
    route: "/users",
    tags: [{ name: "Users", description: "Profile" }],
})
export class UserController {
    constructor(private readonly userService: UserService) {}

    @PATCH("/me", {
        schema: {
            operationId: "updateProfile",
            summary: "Update username and avatar",
            body: UpdateProfileInputSchema,
            response: { 200: PublicUserSchema },
        },
        onRequest: [Authenticate()],
    })
    async updateProfile(req: FastifyRequest<{ Body: UpdateProfileDTO }>, reply: FastifyReply) {
        const user = await this.userService.updateProfile(req.user.id, req.body);
        reply.status(200).send(this.userService.toPublic(user));
    }

    @PATCH("/me/password", {
        schema: {
            operationId: "changePassword",
            summary: "Change password",
            body: ChangePasswordInputSchema,
        },
        onRequest: [Authenticate()],
        config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    })
    async changePassword(req: FastifyRequest<{ Body: ChangePasswordDTO }>, reply: FastifyReply) {
        const user = await this.userService.changePassword(req.user.id, req.body);
        await setSessionCookie(reply, user);
        reply.status(204).send();
    }
}
