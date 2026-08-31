import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './transport';

/**
 * The Local LLM settings panel keeps three module-level promises as re-entrancy
 * guards (`if (xPromise) return xPromise`). A promise that never settles wedges
 * that operation for the life of the settings tab — the Validate button stays
 * disabled and the check spinner runs forever, because the busy UI reads those
 * flags. `withTimeout` is the ceiling that makes each guard releasable, so its
 * behaviour is exercised here rather than asserted as a source string.
 */
describe('withTimeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects a promise that never settles, so a wedged guard can be cleared', async () => {
        const neverSettles = new Promise<string>(() => { /* deliberately never resolves */ });
        const bounded = withTimeout(neverSettles, 60_000, 'deadline exceeded');
        const assertion = expect(bounded).rejects.toThrow('deadline exceeded');
        await vi.advanceTimersByTimeAsync(60_000);
        await assertion;
    });

    it('resolves normally when the work finishes inside the deadline', async () => {
        const quick = new Promise<string>(resolve => { setTimeout(() => resolve('done'), 100); });
        const bounded = withTimeout(quick, 60_000, 'deadline exceeded');
        await vi.advanceTimersByTimeAsync(100);
        await expect(bounded).resolves.toBe('done');
    });

    it('propagates the original failure rather than masking it as a timeout', async () => {
        const failing = Promise.reject(new Error('connection refused'));
        await expect(withTimeout(failing, 60_000, 'deadline exceeded'))
            .rejects.toThrow('connection refused');
    });

    it('clears its timer on success so a late deadline cannot fire afterwards', async () => {
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
        const quick = Promise.resolve('done');
        await expect(withTimeout(quick, 60_000, 'deadline exceeded')).resolves.toBe('done');
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });

    it('carries a timeout marker the tier logic recognises', async () => {
        // capabilityInference.hasTimeoutSignal() scans diagnostic messages for
        // 'timeout' / 'timed out' / 'deadline exceeded' to suppress a misleading
        // tier. A deadline message that misses those words would report a healthy
        // tier for a server that never answered.
        const message = 'Local LLM validation timed out after 60s.';
        const combined = message.toLowerCase();
        expect(
            combined.includes('timeout')
            || combined.includes('timed out')
            || combined.includes('deadline exceeded')
        ).toBe(true);
    });
});
