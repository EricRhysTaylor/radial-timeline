import type { RunDurationEstimate } from '../utils/simulatedProgress';

/**
 * One shared observation for the next Gossamer request, regardless of signal
 * or model. Schema 2 drops manuscript-size scaling: across 17 Sherlock runs a
 * 35% larger manuscript took about 10% longer, so the latest duration alone is
 * the better guess. Schema-1 observations are ignored.
 */
export interface GossamerRunTiming {
    schemaVersion: 2;
    durationMs: number;
}

/** A vault's first Gossamer request: observed runs took 12-20s. */
export const GOSSAMER_FIRST_RUN_MS = 20_000;

export function estimateGossamerRunMs(previous: GossamerRunTiming | undefined): RunDurationEstimate {
    if (previous?.schemaVersion === 2 && Number.isFinite(previous.durationMs) && previous.durationMs > 0) {
        return { durationMs: previous.durationMs, source: 'latest_run' };
    }
    return { durationMs: GOSSAMER_FIRST_RUN_MS, source: 'first_run_default' };
}
