import { randomInt } from "crypto";

/** Fisher–Yates con randomInt (crittografico); non muta l'input. */
export function shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
}
