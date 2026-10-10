export class AIRateLimiter {
    private history = new Map<string, number[]>();
    private queues = new Map<string, Promise<void>>();

    async waitForSlot(key: string, requestsPerMinute: number, assertActive?: () => void): Promise<void> {
        assertActive?.();
        if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) return;
        const prior = this.queues.get(key) ?? Promise.resolve(); // SAFE: first request for this provider has no predecessor
        const pending = prior.then(async () => {
            for (;;) {
                assertActive?.();
                const now = Date.now();
                const recent = (this.history.get(key) ?? []).filter(ts => now - ts < 60_000); // SAFE: no requests yet means empty history
                if (recent.length < requestsPerMinute) {
                    recent.push(now);
                    this.history.set(key, recent);
                    return;
                }
                // Recheck permission during the wait and reserve only after the
                // predecessor releases the queue; concurrent callers cannot burst.
                await new Promise<void>(resolve => window.setTimeout(resolve, Math.min(100, 60_000 - (now - recent[0]))));
            }
        });
        const released = pending.then(() => undefined, () => undefined);
        this.queues.set(key, released);
        try { await pending; }
        finally { if (this.queues.get(key) === released) this.queues.delete(key); }
    }
}
