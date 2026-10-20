import { compare, genSaltSync, hash, hashSync } from "bcryptjs";
import { randomBytes } from "crypto";

/**
 * Encrypts a given password and returns the encrypted version
 *
 * @param password
 * @returns Encrypted password
 */
export function encryptPasswordSync(password: string): string {
    return hashSync(password, genSaltSync(parseInt(process.env.SALT_ROUNDS || "12")));
}

/** Async variant: does not block the event loop (use on request paths). */
export async function encryptPassword(password: string): Promise<string> {
    return hash(password, parseInt(process.env.SALT_ROUNDS || "12"));
}

/**
 * Compare passwords
 *
 * @param password
 * @param candidatePassword
 * @returns Promise which resolves to true if the passswords are the same
 */
export async function comparePasswords(password: string, candidatePassword: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        compare(candidatePassword, password, (err, succ) => {
            if (err) return reject(err);
            return resolve(succ);
        });
    });
}


export function generateRandomString(len: number) {
    return randomBytes(len).toString('hex').toUpperCase();
}
