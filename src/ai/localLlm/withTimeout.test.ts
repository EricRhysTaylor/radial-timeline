import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './transport';
import { hasTimeoutSignal } from './capabilityInference';
import { en } from '../../i18n/locales/en';

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

    it('produces a message the production timeout detector recognises', () => {
        // capabilityInference.hasTimeoutSignal() scans diagnostic messages to
        // suppress a misleading tier when the server never answered. Asserting the
        // marker words by hand would only restate the deadline string; this runs
        // the real detector over a report carrying that message.
        const message = en.settings.ai.localLlm.validationDeadline;
        const check = (ok: boolean, text: string) => ({ ok, message: text });
        const report = {
            modelId: 'local-model',
            reachable: check(true, 'responded with 1 models.'),
            modelAvailable: check(true, 'model present.'),
            basicCompletion: check(false, message),
            structuredJson: check(false, message),
            repairPath: check(true, 'no repair fallback enabled.')
        } as unknown as Parameters<typeof hasTimeoutSignal>[0];
        expect(hasTimeoutSignal(report)).toBe(true);
    });

    it('does not flag an ordinary failure as a timeout', () => {
        const check = (ok: boolean, text: string) => ({ ok, message: text });
        const report = {
            modelId: 'local-model',
            reachable: check(false, 'Connection refused.'),
            modelAvailable: check(false, 'Model check skipped because backend is unreachable.'),
            basicCompletion: check(false, 'Malformed JSON in reply.'),
            structuredJson: check(false, 'Malformed JSON in reply.'),
            repairPath: check(true, 'no repair fallback enabled.')
        } as unknown as Parameters<typeof hasTimeoutSignal>[0];
        expect(hasTimeoutSignal(report)).toBe(false);
    });
});
