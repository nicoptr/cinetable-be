import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { UserRepository } from "@repositories/UserRepository";
import { UserService } from "@services/UserService";
import { LoginDTO } from "@models/Auth";
import { comparePasswords, encryptPasswordSync } from "@utils/crypto";

// hash fittizio: il confronto avviene anche se l'utente non esiste (tempi di risposta costanti)
const DUMMY_HASH = encryptPasswordSync("dummy-password");

@Service()
export class AuthService {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly userService: UserService,
    ) {}

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
