import { describe, expect, it, vi, afterEach } from 'vitest';
import { AIRateLimiter } from './rateLimit';

afterEach(() => vi.useRealTimers());
describe('provider queue', () => {
    it('serializes concurrent waiters across request windows', async () => {
        vi.useFakeTimers();
        const limiter = new AIRateLimiter();
        const entered: number[] = [];
        await limiter.waitForSlot('anthropic', 1);
        const work = [1, 2, 3].map(i => limiter.waitForSlot('anthropic', 1).then(() => entered.push(i)));
        await vi.advanceTimersByTimeAsync(60000);
        expect(entered).toEqual([1]);
        await vi.advanceTimersByTimeAsync(60000);
        expect(entered).toEqual([1, 2]);
        await vi.advanceTimersByTimeAsync(60000);
        await Promise.all(work);
        expect(entered).toEqual([1, 2, 3]);
    });

    it('stops cancelled queued work and allows subsequent requests', async () => {
        vi.useFakeTimers();
        const limiter = new AIRateLimiter();
        await limiter.waitForSlot('google', 1);
        let allowed = true;
        const pending = limiter.waitForSlot('google', 1, () => { if (!allowed) throw new Error('cancelled'); });
        const rejected = expect(pending).rejects.toThrow('cancelled');
        await vi.advanceTimersByTimeAsync(1);
        allowed = false;
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        const following = limiter.waitForSlot('google', 1);
        await vi.advanceTimersByTimeAsync(60000);
        await following;
    });
});
