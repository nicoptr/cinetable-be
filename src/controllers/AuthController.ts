import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, GET, POST } from "fastify-decorators";
import { AuthService } from "@services/AuthService";
import { UserService } from "@services/UserService";
import { LoginDTO, LoginInputSchema } from "@models/Auth";
import { MeSchema, PublicUserSchema } from "@models/User";
import { Authenticate } from "@middleware/Authenticate";
import { clearSessionCookie, setSessionCookie } from "@utils/session";

@Controller({
    route: "/auth",
    tags: [{ name: "Auth", description: "Authorization" }],
})
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
    ) {}

    @POST("/login", {
        schema: {
            operationId: "login",
            summary: "Login with username or email and password",
            body: LoginInputSchema,
            response: { 200: PublicUserSchema },
        },
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    })
    async login(req: FastifyRequest<{ Body: LoginDTO }>, reply: FastifyReply) {
        const user = await this.authService.login(req.body);
        await setSessionCookie(reply, user);
        reply.status(200).send(this.userService.toPublic(user));
    }

    @POST("/logout", {
        schema: { operationId: "logout", summary: "Logout" },
    })
    async logout(req: FastifyRequest, reply: FastifyReply) {
        clearSessionCookie(reply);
        reply.status(204).send();
    }

    @GET("/me", {
        schema: {
            operationId: "getMe",
            summary: "Current user with memberships",
            response: { 200: MeSchema },
        },
        onRequest: [Authenticate()],
    })
    async me(req: FastifyRequest, reply: FastifyReply) {
        reply.status(200).send(await this.authService.me(req.user.id));
    }
}
