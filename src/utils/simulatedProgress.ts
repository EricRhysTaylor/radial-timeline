export interface SimulatedProgressConfig {
    durationMs: number;
    startPercent?: number;
    maxPercent?: number;
    jitter?: number;
    completeOnDuration?: boolean;
}

/**
 * Lightweight helper to simulate a smooth progress animation when the real
 * progress is unknown (e.g., single long API calls). Keeps the bar moving with
 * gentle easing and a small jitter so it never looks frozen.
 */
export class SimulatedProgress {
    private timeoutId: number | null = null;
    private startTime = 0;
    private resolved = false;
    private config: (Required<SimulatedProgressConfig> & { completeOnDuration: boolean }) | null = null;
    private readonly onUpdate: (percent: number) => void;

    constructor(onUpdate: (percent: number) => void) {
        this.onUpdate = onUpdate;
    }

    start(config: SimulatedProgressConfig): void {
        this.stop();

        this.config = {
            durationMs: Math.max(1000, config.durationMs),
            startPercent: config.startPercent ?? 6,
            maxPercent: config.maxPercent ?? 92,
            jitter: config.jitter ?? 0.6,
            completeOnDuration: config.completeOnDuration ?? false
        };
        this.resolved = false;
        this.startTime = performance.now();

        this.onUpdate(this.config.startPercent);
        this.tick();
    }

    complete(): void {
        this.resolved = true;
        this.stop();
        this.onUpdate(100);
    }

    fail(): void {
        this.resolved = true;
        this.stop();
        this.onUpdate(0);
    }

    stop(): void {
        if (this.timeoutId !== null) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.config = null;
    }

    private tick = (): void => {
        if (!this.config || this.resolved) {
            this.timeoutId = null;
            return;
        }

        const now = performance.now();
        const elapsed = now - this.startTime;
        const t = Math.min(1, elapsed / this.config.durationMs);

        // Linear pacing: the caller passes a well-calibrated duration, so the bar
        // should track wall-clock time at a steady rate rather than easing out.
        const base = this.config.startPercent +
            (this.config.maxPercent - this.config.startPercent) * t;

        // Small oscillation keeps the bar feeling alive while waiting — including
        // after the estimate has been exceeded. The bar holds at maxPercent and
        // oscillates via jitter rather than freezing; the real progress is
        // unknown until the API responds.
        const jitter = this.config.jitter * Math.sin(elapsed / 900);
        const percent = Math.max(
            this.config.startPercent,
            Math.min(this.config.maxPercent, base + jitter)
        );

        this.onUpdate(percent);

        if (this.config.completeOnDuration && t >= 1) {
            this.timeoutId = null;
            return;
        }

        // Keep scheduling until externally resolved (complete/fail/stop). Past
        // the estimate the bar still oscillates at the cap so the user can see
        // we're still waiting rather than concluding the modal has frozen.
        this.timeoutId = window.setTimeout(this.tick, 16);
    };
}
