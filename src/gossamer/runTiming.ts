/** One shared observation for the next Gossamer request, regardless of signal or model. */
export interface GossamerRunTiming {
    schemaVersion: 1;
    durationMs: number;
    manuscriptWords: number;
}

export function estimateGossamerRunMs(words: number, previous?: GossamerRunTiming): number {
    if (!previous || previous.schemaVersion !== 1
        || !Number.isFinite(previous.durationMs) || previous.durationMs <= 0
        || !Number.isFinite(previous.manuscriptWords) || previous.manuscriptWords <= 0
        || !Number.isFinite(words) || words <= 0) {
        return 60000;
    }

    return Math.min(300000, Math.max(5000, previous.durationMs * words / previous.manuscriptWords));
}
