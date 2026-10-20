import { FastifyReply, FastifyRequest } from "fastify";
import { Controller, GET, POST } from "fastify-decorators";
import { AuthService } from "@services/AuthService";
import { UserService } from "@services/UserService";
import {
    EmailInputSchema, LoginDTO, LoginInputSchema, RegisterDTO, RegisterInputSchema, ResetPasswordInputSchema, TokenInputSchema,
} from "@models/Auth";
import { z } from "zod";
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

    @POST("/register", {
        schema: {
            operationId: "register",
            summary: "Self-registration; sends the verification email (or logs in when registering from an invite)",
            body: RegisterInputSchema,
            response: { 201: PublicUserSchema },
        },
        config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    })
    async register(req: FastifyRequest<{ Body: RegisterDTO }>, reply: FastifyReply) {
        const user = await this.authService.register(req.body);
        if (user.emailVerifiedAt) await setSessionCookie(reply, user); // registrazione da invito: già verificato
        reply.status(201).send(this.userService.toPublic(user));
    }

    @POST("/verify-email", {
        schema: {
            operationId: "verifyEmail",
            summary: "Verify email with the emailed token and log in",
            body: TokenInputSchema,
            response: { 200: PublicUserSchema },
        },
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    })
    async verifyEmail(req: FastifyRequest<{ Body: z.infer<typeof TokenInputSchema> }>, reply: FastifyReply) {
        const user = await this.authService.verifyEmail(req.body.token);
        await setSessionCookie(reply, user);
        reply.status(200).send(this.userService.toPublic(user));
    }

    @POST("/resend-verification", {
        schema: { operationId: "resendVerification", summary: "Resend the verification email", body: EmailInputSchema },
        config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    })
    async resendVerification(req: FastifyRequest<{ Body: z.infer<typeof EmailInputSchema> }>, reply: FastifyReply) {
        await this.authService.resendVerification(req.body.email);
        reply.status(204).send();
    }

    @POST("/forgot-password", {
        schema: { operationId: "forgotPassword", summary: "Send the password reset email", body: EmailInputSchema },
        config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    })
    async forgotPassword(req: FastifyRequest<{ Body: z.infer<typeof EmailInputSchema> }>, reply: FastifyReply) {
        await this.authService.forgotPassword(req.body.email);
        reply.status(204).send();
    }

    @POST("/reset-password", {
        schema: { operationId: "resetPassword", summary: "Set a new password with the emailed token", body: ResetPasswordInputSchema },
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    })
    async resetPassword(req: FastifyRequest<{ Body: z.infer<typeof ResetPasswordInputSchema> }>, reply: FastifyReply) {
        await this.authService.resetPassword(req.body.token, req.body.password);
        reply.status(204).send();
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
