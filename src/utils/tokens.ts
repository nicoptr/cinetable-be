import { createHash, randomBytes } from "node:crypto";

export const TOKEN_TTL = {
    VERIFY_EMAIL: 24 * 3600_000,
    RESET_PASSWORD: 3600_000,
    INVITATION: 7 * 24 * 3600_000,
};

export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("hex");
    return { token, hash: hashToken(token) };
}

export function expiresIn(ms: number): Date {
    return new Date(Date.now() + ms);
}
