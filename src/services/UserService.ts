import { User } from "@prisma/client";
import { Service } from "fastify-decorators";
import httpErrors from "http-errors";
import { PublicUser, UpdateProfileDTO, ChangePasswordDTO } from "@models/User";
import { UserRepository } from "@repositories/UserRepository";
import { comparePasswords, encryptPasswordSync } from "@utils/crypto";
import { isUniqueViolation } from "@utils/prisma";

@Service()
export class UserService {
    constructor(private readonly userRepository: UserRepository) {}

    toPublic(user: User): PublicUser {
        const { id, username, email, avatarUrl, isPlatformAdmin } = user;
        return { id, username, email, avatarUrl, isPlatformAdmin };
    }

    async updateProfile(userId: number, data: UpdateProfileDTO): Promise<User> {
        try {
            return await this.userRepository.update(userId, data);
        } catch (e) {
            if (isUniqueViolation(e)) throw new httpErrors.Conflict("Username già in uso");
            throw e;
        }
    }

    async changePassword(userId: number, { currentPassword, newPassword }: ChangePasswordDTO): Promise<User> {
        const user = await this.userRepository.findById(userId);
        if (!user || !(await comparePasswords(user.password, currentPassword))) {
            throw new httpErrors.BadRequest("Password attuale non corretta");
        }
        return this.userRepository.update(userId, { password: encryptPasswordSync(newPassword), tokenVersion: { increment: 1 } });
    }
}
