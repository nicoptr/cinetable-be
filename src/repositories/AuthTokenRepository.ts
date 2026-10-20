import { AuthToken, AuthTokenType } from "@prisma/client";
import { Service } from "fastify-decorators";
import { getPrismaClient } from "@utils/prisma";

@Service()
export class AuthTokenRepository {
    create(userId: number, type: AuthTokenType, tokenHash: string, expiresAt: Date): Promise<AuthToken> {
        return getPrismaClient().authToken.create({ data: { userId, type, tokenHash, expiresAt } });
    }

    /** Restituisce il token solo se non usato e non scaduto, marcandolo usato nella stessa transazione. */
    consume(tokenHash: string, type: AuthTokenType): Promise<AuthToken | null> {
        return getPrismaClient().$transaction(async tx => {
            const { count } = await tx.authToken.updateMany({
                where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
                data: { usedAt: new Date() },
            });
            return count === 0 ? null : tx.authToken.findUnique({ where: { tokenHash } });
        });
    }
}
