/**
 * Estimated progress for a single AI request whose real progress is unknown
 * until the response arrives. Inquiry and Gossamer both time their bars from
 * the latest completed request: answer length, not manuscript size, drives
 * wall time, so the estimate is a duration and the bar must never claim
 * "done" before the response does.
 */

export type RunDurationSource = 'latest_run' | 'first_run_default';

/** What a progress bar was timed for, and where that time came from. */
export interface RunDurationEstimate {
    durationMs: number;
    source: RunDurationSource;
}

/** Share of the track filled when the estimated time arrives. */
export const PROGRESS_AT_ESTIMATE = 0.9;
/** The bar never fills past this until the response arrives. */
export const PROGRESS_CEILING = 0.98;
/** Overrun easing: the gap to the ceiling shrinks by e^-2 per estimated duration. */
const OVERRUN_EASE_RATE = 2;
/** Guards a zero budget; real estimates are seconds long. */
const MIN_ESTIMATE_MS = 1000;

/**
 * Linear to PROGRESS_AT_ESTIMATE at the estimated time, then easing toward
 * PROGRESS_CEILING. Answer length varies per request by about ±40%, so an
 * overrun keeps moving instead of sitting at 100%.
 */
export function getEstimatedProgressRatio(elapsedMs: number, estimateMs: number): number {
    if (elapsedMs <= 0) return 0;
    const t = elapsedMs / Math.max(MIN_ESTIMATE_MS, estimateMs);
    if (t <= 1) return PROGRESS_AT_ESTIMATE * t;
    return PROGRESS_AT_ESTIMATE
        + (PROGRESS_CEILING - PROGRESS_AT_ESTIMATE) * (1 - Math.exp(-OVERRUN_EASE_RATE * (t - 1)));
}

/** Drives a percent display from the shared curve until the caller completes, fails or stops it. */
export class SimulatedProgress {
    private timeoutId: number | null = null;
    private startTime = 0;
    private estimateMs = 0;
    private readonly onUpdate: (percent: number) => void;

    constructor(onUpdate: (percent: number) => void) {
        this.onUpdate = onUpdate;
    }

    start(estimateMs: number): void {
        this.stop();
        this.estimateMs = estimateMs;
        this.startTime = performance.now();
        this.onUpdate(0);
        this.timeoutId = window.setTimeout(this.tick, 16);
    }

    complete(): void {
        this.stop();
        this.onUpdate(100);
    }

    fail(): void {
        this.stop();
        this.onUpdate(0);
    }

    stop(): void {
        if (this.timeoutId !== null) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    private tick = (): void => {
        this.onUpdate(getEstimatedProgressRatio(performance.now() - this.startTime, this.estimateMs) * 100);
        this.timeoutId = window.setTimeout(this.tick, 16);
    };
}
