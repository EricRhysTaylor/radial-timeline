import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DisposableRegistry, clearTrackedTimer, type Disposable } from './disposable';

describe('DisposableRegistry', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    it('runs every registered cleanup once on disposeAll', () => {
        const registry = new DisposableRegistry();
        const a = vi.fn();
        const b = vi.fn();
        const c: Disposable = { cleanup: vi.fn() };

        registry.add(a);
        registry.add(b);
        registry.add(c);

        registry.disposeAll();

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
        expect(c.cleanup).toHaveBeenCalledTimes(1);
    });

    it('disposes in LIFO order so later-registered items tear down first', () => {
        const registry = new DisposableRegistry();
        const order: string[] = [];

        registry.add(() => order.push('first'));
        registry.add(() => order.push('second'));
        registry.add(() => order.push('third'));

        registry.disposeAll();

        expect(order).toEqual(['third', 'second', 'first']);
    });

    it('continues disposing remaining items after one throws', () => {
        const registry = new DisposableRegistry();
        const before = vi.fn();
        const after = vi.fn();
        const boom = () => { throw new Error('boom'); };

        // Registered first → disposed last (LIFO), so we want `after` LIFO-after
        // the throwing item to confirm the loop continues past the throw.
        registry.add(before);
        registry.add(boom);
        registry.add(after);

        registry.disposeAll();

        expect(after).toHaveBeenCalledTimes(1);
        expect(before).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: a second disposeAll is a no-op', () => {
        const registry = new DisposableRegistry();
        const fn = vi.fn();
        registry.add(fn);

        registry.disposeAll();
        registry.disposeAll();

        expect(fn).toHaveBeenCalledTimes(1);
        expect(registry.isDisposed).toBe(true);
    });

    it('runs late add() calls immediately after disposal', () => {
        const registry = new DisposableRegistry();
        registry.disposeAll();

        const late = vi.fn();
        registry.add(late);

        expect(late).toHaveBeenCalledTimes(1);
        expect(registry.size).toBe(0);
    });

    it('reports size of pending items before disposal', () => {
        const registry = new DisposableRegistry();
        expect(registry.size).toBe(0);

        registry.add(() => undefined);
        registry.add(() => undefined);
        expect(registry.size).toBe(2);

        registry.disposeAll();
        expect(registry.size).toBe(0);
    });

    it('accepts both Disposable and DisposeFn forms in the same registry', () => {
        const registry = new DisposableRegistry();
        const fn = vi.fn();
        const obj: Disposable = { cleanup: vi.fn() };

        registry.add(fn);
        registry.add(obj);

        registry.disposeAll();

        expect(fn).toHaveBeenCalledTimes(1);
        expect(obj.cleanup).toHaveBeenCalledTimes(1);
    });
});

describe('clearTrackedTimer', () => {
    let clearTimeoutSpy: ReturnType<typeof vi.fn>;
    let clearIntervalSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        clearTimeoutSpy = vi.fn();
        clearIntervalSpy = vi.fn();
        vi.stubGlobal('window', {
            clearTimeout: clearTimeoutSpy,
            clearInterval: clearIntervalSpy,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('clears a setTimeout handle and nulls the field', () => {
        // In the browser, `window.setTimeout` returns a number — mimic that.
        const host: { t?: number } = { t: 42 };

        clearTrackedTimer(host, 't');

        expect(clearTimeoutSpy).toHaveBeenCalledWith(42);
        expect(clearIntervalSpy).not.toHaveBeenCalled();
        expect(host.t).toBeUndefined();
    });

    it('clears a setInterval handle when kind is "interval"', () => {
        const host: { i?: number } = { i: 99 };

        clearTrackedTimer(host, 'i', 'interval');

        expect(clearIntervalSpy).toHaveBeenCalledWith(99);
        expect(clearTimeoutSpy).not.toHaveBeenCalled();
        expect(host.i).toBeUndefined();
    });

    it('is a no-op when the field is undefined', () => {
        const host: { t?: number } = {};

        expect(() => clearTrackedTimer(host, 't')).not.toThrow();

        expect(clearTimeoutSpy).not.toHaveBeenCalled();
        expect(host.t).toBeUndefined();
    });

    it('does not clear non-numeric values (defensive against host objects)', () => {
        // Node's setTimeout returns an object, not a number. The helper must
        // bail out cleanly in that case rather than passing an object to
        // clearTimeout (which would no-op silently, leaving the field set).
        const host = { t: { fake: true } as unknown as number | undefined };

        clearTrackedTimer(host as { t?: number }, 't');

        expect(clearTimeoutSpy).not.toHaveBeenCalled();
        expect(host.t).toEqual({ fake: true });
    });
});
