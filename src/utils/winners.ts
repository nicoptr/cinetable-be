export type Score = { candidatureId: number; sum: number; count: number };

/** Tutti gli id con la media più alta; medie confrontate in modo esatto (sumA·countB vs sumB·countA). Senza voti non si concorre. */
export function findWinners(scores: Score[]): number[] {
    let best: Score[] = [];
    for (const s of scores) {
        if (s.count === 0) continue;
        const top = best[0];
        const diff = top ? s.sum * top.count - top.sum * s.count : 1;
        if (diff > 0) best = [s];
        else if (diff === 0) best.push(s);
    }
    return best.map(s => s.candidatureId);
}
