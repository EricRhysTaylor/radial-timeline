import { sleep } from '../../utils/sleep';

export class AIRateLimiter {
    private history = new Map<string, number[]>();

    async waitForSlot(key: string, requestsPerMinute: number): Promise<void> {
        if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) return;
        const now = Date.now();
        const windowMs = 60_000;
        const list = this.history.get(key) || [];
        const recent = list.filter(ts => now - ts < windowMs);

        if (recent.length >= requestsPerMinute) {
            const earliest = recent[0];
            const waitMs = Math.max(0, windowMs - (now - earliest));
            await sleep(waitMs);
        }

        const after = (this.history.get(key) || []).filter(ts => Date.now() - ts < windowMs);
        after.push(Date.now());
        this.history.set(key, after);
    }
}
