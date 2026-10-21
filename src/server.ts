import fastify, { FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import { AuthController } from "@controllers/AuthController";
import { UserController } from "@controllers/UserController";
import { CineforumController } from "@controllers/CineforumController";
import { InvitationController, InviteeController } from "@controllers/InvitationController";
import { CategoryController } from "@controllers/CategoryController";
import { AwardController } from "@controllers/AwardController";
import { SeasonController } from "@controllers/SeasonController";
import { MovieController } from "@controllers/MovieController";
import { CandidatureController } from "@controllers/CandidatureController";
import { VoteController } from "@controllers/VoteController";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import fastifyHelmet from "@fastify/helmet";
import * as process from "process";
import { LOGGER } from "@utils/winston";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { bootstrap, getInstanceByToken } from "fastify-decorators";
import { ZodError } from "zod";
import { FastifyApplication } from "../types";
import httpErrors, { HttpError } from "http-errors";
import { removeAnsi } from "@utils/prisma";
import { ReminderService } from "@services/ReminderService";
import { parseTrustProxy } from "@utils/proxy";
import { createHash, timingSafeEqual } from "crypto";

const sha256 = (v: string) => createHash("sha256").update(v).digest();

export class APIServer {
    private readonly server: FastifyApplication;

    constructor() {
        const app = fastify({
            logger: process.env.NODE_ENV === 'development',
            disableRequestLogging: true,
            pluginTimeout: 100000,
            trustProxy: parseTrustProxy(process.env.TRUST_PROXY) ?? false,
        })
        this.server = app.withTypeProvider<ZodTypeProvider>();
        this.guardApi();
        this.configureAuthentication();
        this.addSecurityConfiguration();
        if (process.env.NODE_ENV !== "production") this.configureSwagger();
        this.configureCors();
        this.registerController();
        this.setupFastifyConfiguration();
    }

    public async start() {
        try {
            await this.ready();
            if (process.env.NODE_ENV !== "test") getInstanceByToken<ReminderService>(ReminderService).start();
            if (process.env.NODE_ENV !== "production") this.server.swagger();
            await this.server.listen({ host: process.env.HOST!, port: +process.env.PORT! })
                .then(async () => {
                    LOGGER.info(`API Server up and running in ${process.env.NODE_ENV} environment on port ${process.env.PORT!}!`);
                    LOGGER.info(`OpenAPI docs available at http://localhost:${process.env.PORT!}/docs`);
                });
        } catch (err) {
            this.server.log.error(err);
            process.exit(1);
        }
    }

    public get app(): FastifyApplication {
        return this.server;
    }

    public async ready(): Promise<void> {
        await this.server.ready();
    }

    public async stop() {
        getInstanceByToken<ReminderService>(ReminderService).stop();
        return new Promise<boolean>(async resolve => {

            if (this.server) {
                this.server.close(() => resolve(true));
            } else {
                return resolve(true);
            }
        });
    }

    private setupFastifyConfiguration() {
        LOGGER.info("Setup Fastify Configuration!");

        this.server.setValidatorCompiler(validatorCompiler);
        this.server.setSerializerCompiler(serializerCompiler);
        this.server.setErrorHandler(
            (error: Error, req: FastifyRequest, reply: FastifyReply) => {
                const sc = (error as Error & { statusCode?: number }).statusCode;
                if (typeof sc === "number" && sc < 500) LOGGER.warn(`${error}`);
                else LOGGER.error(`${error} \n ${error.stack}`);
                if (error instanceof ZodError) {
                    reply.status(400).send({
                        error: error.name,
                        message: "Dati non validi",
                        issues: error.issues,
                    });
                    LOGGER.warn("End of error log");
                    return;
                }

                if (error instanceof HttpError) {
                    return reply.status(error.statusCode).send({
                        error: "HttpError",
                        code: (error as HttpError & { code?: string }).code ?? String(error.statusCode),
                        message: removeAnsi(error.message),
                        ...(process.env.NODE_ENV === "development" && {
                            stack: removeAnsi(error.stack ?? ""),
                        }),
                    });
                }

                const status = (error as Error & { statusCode?: number }).statusCode;
                if (typeof status === "number" && status < 500) {
                    return reply.status(status).send({
                        error: "HttpError",
                        code: String((error as Error & { code?: string }).code ?? status),
                        message: removeAnsi(error.message),
                    });
                }

                reply.status(500).send({ error: "InternalServerError", message: "Errore imprevisto" });
            }
        );
    }

    /**
     * Su ogni richiesta, non solo `/sub/api`: il router decodifica il path (`/sub/%61pi`), un controllo sull'URL grezzo si aggira.
     * `ORIGIN_SECRET` letto a ogni richiesta: assente = controllo spento (dev, e2e).
     */
    private guardApi() {
        this.server.addHook("onRequest", async (req, reply) => {
            reply.header("Cache-Control", "no-store");
            const secret = process.env.ORIGIN_SECRET;
            if (!secret) return;
            const given = req.headers["x-origin-secret"];
            // hash: timingSafeEqual vuole lunghezze uguali e così la lunghezza del segreto non trapela
            if (typeof given === "string" && timingSafeEqual(sha256(given), sha256(secret))) return;
            return reply.code(403).send({ code: "ORIGIN_FORBIDDEN" });
        });
    }

    private configureAuthentication() {
        LOGGER.info("Setup Authenticator!");
        this.server.register(fastifyCookie);
        this.server.register(fastifyRateLimit, {
            global: false,
            errorResponseBuilder: () => new httpErrors.TooManyRequests("Troppi tentativi, riprova tra poco"),
        });
        this.server.register(fastifyJwt, {
            secret: process.env.JWT_SECRET!,
            cookie: { cookieName: "cinofili_token", signed: false },
            verify: { onlyCookie: true },
            sign: { expiresIn: "7d" },
        });
    }

    private addSecurityConfiguration() {
        this.server.register(fastifyHelmet, {
            contentSecurityPolicy: {
                directives: {
                    ...fastifyHelmet.contentSecurityPolicy.getDefaultDirectives(),
                    "script-src": ["'self'", "'unsafe-inline'"],
                },
            },
            crossOriginOpenerPolicy: {
                policy: "unsafe-none",
            },
        });
    }

    private configureCors() {
        LOGGER.info("Setup CORS configuration!");
        this.server.register(fastifyCors, {
            origin: process.env.CLIENT_URL ?? false,
            credentials: true,
        });
    }

    private configureSwagger() {
        LOGGER.info("Setup SWAGGER!");

        this.server.register(fastifySwagger, {
            openapi: {
                info: {
                    title: "",
                    description: process.env.npm_package_version!,
                    version: process.env.npm_package_version!,
                },
                components: {
                    securitySchemes: {
                        cookieAuth: {
                            type: "apiKey",
                            name: "cinofili_token",
                            in: "cookie",
                        },
                    },
                },
            },
            transform: jsonSchemaTransform,
            hideUntagged: true
        });

        this.server.register(fastifySwaggerUI, {
            routePrefix: "/docs",
            staticCSP:
                "default-src 'self'; base-uri 'self'; font-src 'self' https: data:; frame-ancestors 'self'; img-src 'self' data: validator.swagger.io; object-src 'none'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; style-src 'self' fonts.googleapis.com; upgrade-insecure-requests;",
            theme: {
                title: "Cinofili API",
            },
            initOAuth: undefined,
            uiConfig: {
                persistAuthorization: true,
            }
        });

    }

    private registerController() {
        LOGGER.info("Load All Controllers!");
        // Log.info(resolve(__dirname, "controllers"));

        this.server.register(bootstrap, {
            // directory: resolve(__dirname, "controllers"),
            // mask: /\.controller\./,
            controllers: [AuthController, UserController, CineforumController, InvitationController, InviteeController, CategoryController, AwardController, SeasonController, MovieController, CandidatureController, VoteController],
            prefix: "/sub/api"
        });
    }

}
