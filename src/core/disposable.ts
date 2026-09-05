/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * A resource that can be released when the plugin unloads.
 *
 * Implementations must be idempotent: calling `cleanup()` a second time is a no-op.
 * Disposal must be synchronous — Obsidian's `onunload()` does not await async work.
 */
export interface Disposable {
    cleanup(): void;
}

export type DisposeFn = () => void;

/**
 * Tracks `Disposable` instances and inline cleanup closures so the plugin can
 * tear them down together in `onunload()`.
 *
 * Failures in one cleanup must not block the others — see {@link disposeAll}.
 */
export class DisposableRegistry {
    private items: Array<Disposable | DisposeFn> = [];
    private disposed = false;

    add(item: Disposable | DisposeFn): void {
        if (this.disposed) {
            // Late registration after disposeAll(): run immediately so the caller
            // can't accidentally hold a resource past plugin teardown.
            this.runOne(item);
            return;
        }
        this.items.push(item);
    }

    /**
     * Run every registered cleanup in LIFO order (mirrors stack-unwinding so
     * later, dependent registrations tear down before the things they relied on).
     *
     * One throwing cleanup is logged and the loop continues; this is the one
     * place the codebase tolerates a per-item catch, because the alternative
     * is a leaked resource on every unload.
     */
    disposeAll(): void {
        if (this.disposed) return;
        this.disposed = true;
        const pending = this.items.splice(0).reverse();
        for (const item of pending) {
            this.runOne(item);
        }
    }

    get size(): number {
        return this.items.length;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    private runOne(item: Disposable | DisposeFn): void {
        try {
            if (typeof item === 'function') {
                item();
            } else {
                item.cleanup();
            }
        } catch (error) {
            console.error('[RadialTimeline] Disposable cleanup failed:', error);
        }
    }
}

export type TimerKind = 'timeout' | 'interval';

/**
 * Clear a `setTimeout` / `setInterval` handle stored on a host field and
 * null the field. No-op when the handle is already undefined (or, defensively,
 * when the field holds a non-numeric value — e.g. a Node `Timeout` object
 * encountered under test).
 *
 * Centralizes the repeated `if (h.x !== undefined) { clearX(h.x); h.x = undefined; }`
 * pattern across the codebase. Safe to register as a {@link DisposeFn}.
 *
 * The constraint `K extends keyof H` keeps the caller from typo-ing a field
 * name; field-shape correctness is enforced at runtime by the numeric guard.
 */
export function clearTrackedTimer<H extends object, K extends keyof H>(
    host: H,
    key: K,
    kind: TimerKind = 'timeout'
): void {
    const value = host[key] as unknown;
    if (typeof value !== 'number') return;
    if (kind === 'interval') {
        window.clearInterval(value);
    } else {
        window.clearTimeout(value);
    }
    (host as Record<string, unknown>)[key as string] = undefined;
}

