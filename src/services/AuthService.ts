import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { UserRepository } from "@repositories/UserRepository";
import { UserService } from "@services/UserService";
import { AuthTokenRepository } from "@repositories/AuthTokenRepository";
import { InvitationService } from "@services/InvitationService";
import { EmailSenderService } from "@services/EmailSenderService";
import { LoginDTO, RegisterDTO } from "@models/Auth";
import { comparePasswords, encryptPassword, encryptPasswordSync } from "@utils/crypto";
import { expiresIn, generateToken, hashToken, TOKEN_TTL } from "@utils/tokens";
import { getPrismaClient, isUniqueViolation } from "@utils/prisma";
import { verifyEmailTemplate } from "../templates/email/verifyEmailTemplate";
import { resetPasswordTemplate } from "../templates/email/resetPasswordTemplate";

// hash fittizio: il confronto avviene anche se l'utente non esiste (tempi di risposta costanti)
const DUMMY_HASH = encryptPasswordSync("dummy-password");

@Service()
export class AuthService {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly userService: UserService,
        private readonly authTokenRepository: AuthTokenRepository,
        private readonly email: EmailSenderService,
        private readonly invitations: InvitationService,
    ) {}

    async register({ email, username, password, inviteToken }: RegisterDTO) {
        if (inviteToken !== undefined) return this.registerWithInvite({ email, username, password }, inviteToken);
        let user;
        const { token, hash } = generateToken();
        try {
            user = await this.userRepository.createWithVerificationToken(
                { email, username, password: await encryptPassword(password) }, hash, expiresIn(TOKEN_TTL.VERIFY_EMAIL));
        } catch (e) {
            if (isUniqueViolation(e)) throw new httpErrors.Conflict("Email o username già in uso");
            throw e;
        }
        await this.sendVerification(user, token);
        return user;
    }

    /** Utente già verificato (il link d'invito prova la casella) e membro nella stessa transazione. */
    private async registerWithInvite(data: { email: string; username: string; password: string }, inviteToken: string) {
        const invitation = await this.invitations.findByToken(inviteToken);
        if (!invitation) throw new httpErrors.BadRequest("Invito non valido o scaduto");
        if (invitation.email !== data.email) throw new httpErrors.BadRequest("Questo invito è per un altro indirizzo email");
        const password = await encryptPassword(data.password);
        try {
            return await getPrismaClient().$transaction(async tx => {
                const user = await tx.user.create({ data: { ...data, password, emailVerifiedAt: new Date() } });
                await this.invitations.acceptInTx(tx, invitation, user.id);
                return user;
            });
        } catch (e) {
            if (isUniqueViolation(e)) throw new httpErrors.Conflict("Email o username già in uso");
            throw e;
        }
    }

    async verifyEmail(token: string) {
        const row = await this.authTokenRepository.consume(hashToken(token), "VERIFY_EMAIL");
        if (!row) throw new httpErrors.BadRequest("Link non valido o scaduto");
        return this.userRepository.update(row.userId, { emailVerifiedAt: new Date() });
    }

    async resendVerification(email: string) {
        const user = await this.userRepository.findByEmail(email);
        if (!user || user.emailVerifiedAt) return;
        const { token, hash } = generateToken();
        await this.authTokenRepository.create(user.id, "VERIFY_EMAIL", hash, expiresIn(TOKEN_TTL.VERIFY_EMAIL));
        await this.sendVerification(user, token);
    }

    async forgotPassword(email: string) {
        const user = await this.userRepository.findByEmail(email);
        if (!user) return;
        const { token, hash } = generateToken();
        await this.authTokenRepository.create(user.id, "RESET_PASSWORD", hash, expiresIn(TOKEN_TTL.RESET_PASSWORD));
        const url = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
        await this.email.send(user.email, "Reimposta la password", resetPasswordTemplate(user.username, url));
    }

    async resetPassword(token: string, password: string) {
        const row = await this.authTokenRepository.consume(hashToken(token), "RESET_PASSWORD");
        if (!row) throw new httpErrors.BadRequest("Link non valido o scaduto");
        // il link arriva via email: averlo usato prova il possesso della casella
        await this.userRepository.update(row.userId, {
            password: await encryptPassword(password),
            tokenVersion: { increment: 1 },
            emailVerifiedAt: new Date(),
        });
    }

    private sendVerification(user: { email: string; username: string }, token: string) {
        const url = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
        return this.email.send(user.email, "Conferma la tua email", verifyEmailTemplate(user.username, url));
    }

    async login({ usernameOrEmail, password }: LoginDTO) {
        const user = await this.userRepository.findByUsernameOrEmail(usernameOrEmail);
        const ok = await comparePasswords(user?.password ?? DUMMY_HASH, password);
        if (!user || !ok) throw new httpErrors.Unauthorized("Username o password non validi!");
        if (!user.emailVerifiedAt) {
            throw Object.assign(new httpErrors.Forbidden("Conferma la tua email prima di accedere"), { code: "EMAIL_NOT_VERIFIED" });
        }
        return user;
    }

    async me(userId: number) {
        const user = await this.userRepository.findById(userId);
        if (!user) throw new httpErrors.Unauthorized();
        return { ...this.userService.toPublic(user), memberships: await this.userRepository.findMemberships(userId) };
    }
}
