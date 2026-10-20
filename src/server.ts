import fastify, { FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import { AuthController } from "@controllers/AuthController";
import { UserController } from "@controllers/UserController";
import { CineforumController } from "@controllers/CineforumController";
import { InvitationController, InviteeController } from "@controllers/InvitationController";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifyCron from "fastify-cron";
import * as process from "process";
import { LOGGER } from "@utils/winston";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { bootstrap } from "fastify-decorators";
import { ZodError } from "zod";
import { FastifyApplication } from "../types";
import httpErrors, { HttpError } from "http-errors";
import { removeAnsi } from "@utils/prisma";

export class APIServer {
    private readonly server: FastifyApplication;

    constructor() {
        const app = fastify({
            logger: process.env.NODE_ENV === 'development',
            disableRequestLogging: true,
            pluginTimeout: 100000,
        })
        this.server = app.withTypeProvider<ZodTypeProvider>();
        this.setupMultipart();
        this.configureAuthentication();
        this.addSecurityConfiguration();
        this.configureSwagger();
        this.configureCors();
        this.registerController();
        this.setupFastifyConfiguration();
    }

    public async start() {
        try {
            await this.ready();
            this.server.swagger();
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
                if (error instanceof HttpError && error.statusCode < 500) LOGGER.warn(`${error}`);
                else LOGGER.error(`${error} \n ${error.stack}`);
                if (error instanceof ZodError) {
                    reply.status(400).send({
                        error: error.name,
                        message: "Schema validation error",
                        issues: error.issues,
                    });
                    LOGGER.warn("End of error log");
                    return;
                }

                if (error instanceof HttpError) {
                    return reply.status(error.statusCode).send({
                        error: "HttpError",
                        code: (error as HttpError & { code?: string }).code ?? error.statusCode,
                        message: removeAnsi(error.message),
                        ...(process.env.NODE_ENV === "development" && {
                            stack: removeAnsi(error.stack ?? ""),
                        }),
                    });
                }

                reply.status(500).send({ error: "InternalServerError", message: "Errore imprevisto" });
            }
        );
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
                        apiKey: {
                            type: "apiKey",
                            description: "Bearer token",
                            name: "Authorization",
                            in: "header",
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
            controllers: [AuthController, UserController, CineforumController, InvitationController, InviteeController],
            prefix: "/sub/api"
        });
    }

    private setupMultipart() {
        LOGGER.info("Setup Multipart Configuration!");

        this.server.register(fastifyMultipart);
    }

}
