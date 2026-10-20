import { User } from "@prisma/client";
import { Service } from "fastify-decorators";
import { PublicUser } from "@models/User";

@Service()
export class UserService {
    toPublic(user: User): PublicUser {
        const { id, username, email, avatarUrl, isPlatformAdmin } = user;
        return { id, username, email, avatarUrl, isPlatformAdmin };
    }
}
