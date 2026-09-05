type PendingReplayRequest = {
    durationMs: number;
    removeClasses: string[];
};

type ClassEffectState = {
    pendingReplay: PendingReplayRequest | null;
    pendingRemovalClasses: Set<string> | null;
    timeoutId: number | null;
};

type DeferredClassState = {
    rafId: number | null;
};

const classEffectStateByElement = new WeakMap<HTMLElement, Map<string, ClassEffectState>>();
const deferredClassStateByElement = new WeakMap<HTMLElement, Map<string, DeferredClassState>>();
const pendingReplayClassNamesByElement = new Map<HTMLElement, Set<string>>();
let replayFlushRafId: number | null = null;

function getElementClassEffectStateMap(el: HTMLElement): Map<string, ClassEffectState> {
    let classState = classEffectStateByElement.get(el);
    if (!classState) {
        classState = new Map<string, ClassEffectState>();
        classEffectStateByElement.set(el, classState);
    }
    return classState;
}

function getClassEffectState(el: HTMLElement, className: string): ClassEffectState {
    const classState = getElementClassEffectStateMap(el);
    let effectState = classState.get(className);
    if (!effectState) {
        effectState = {
            pendingReplay: null,
            pendingRemovalClasses: null,
            timeoutId: null
        };
        classState.set(className, effectState);
    }

    return effectState;
}

function getDeferredClassState(el: HTMLElement, className: string): DeferredClassState {
    let classState = deferredClassStateByElement.get(el);
    if (!classState) {
        classState = new Map<string, DeferredClassState>();
        deferredClassStateByElement.set(el, classState);
    }

    let deferredState = classState.get(className);
    if (!deferredState) {
        deferredState = { rafId: null };
        classState.set(className, deferredState);
    }

    return deferredState;
}

function cleanupReplayState(el: HTMLElement, className: string): void {
    const classState = classEffectStateByElement.get(el);
    const effectState = classState?.get(className);
    if (!classState || !effectState) return;
    if (effectState.pendingReplay || effectState.timeoutId !== null) return;

    classState.delete(className);
    if (classState.size === 0) {
        classEffectStateByElement.delete(el);
    }
}

function cleanupDeferredClassState(el: HTMLElement, className: string): void {
    const classState = deferredClassStateByElement.get(el);
    const deferredState = classState?.get(className);
    if (!classState || !deferredState) return;
    if (deferredState.rafId !== null) return;

    classState.delete(className);
    if (classState.size === 0) {
        deferredClassStateByElement.delete(el);
    }
}

function scheduleReplayFlush(): void {
    if (replayFlushRafId !== null) return;

    replayFlushRafId = window.requestAnimationFrame(() => {
        replayFlushRafId = null;

        for (const [el, classNames] of pendingReplayClassNamesByElement) {
            const classState = classEffectStateByElement.get(el);
            if (!classState) continue;

            for (const className of classNames) {
                const effectState = classState.get(className);
                const pendingReplay = effectState?.pendingReplay;
                if (!effectState || !pendingReplay) continue;

                effectState.pendingReplay = null;
                effectState.pendingRemovalClasses = null;

                if (!el.isConnected) {
                    cleanupReplayState(el, className);
                    continue;
                }

                el.classList.add(className);

                if (pendingReplay.durationMs > 0) {
                    effectState.timeoutId = window.setTimeout(() => {
                        effectState.timeoutId = null;
                        if (el.isConnected) {
                            el.classList.remove(className);
                        }
                        cleanupReplayState(el, className);
                    }, pendingReplay.durationMs);
                } else {
                    cleanupReplayState(el, className);
                }
            }
        }

        pendingReplayClassNamesByElement.clear();
    });
}

export function replayTransientClass(
    el: HTMLElement,
    className: string,
    options: {
        removeClasses?: string[];
        durationMs?: number;
    } = {}
): void {
    const { removeClasses = [], durationMs = 0 } = options;
    const effectState = getClassEffectState(el, className);

    if (effectState.timeoutId !== null) {
        window.clearTimeout(effectState.timeoutId);
        effectState.timeoutId = null;
    }

    const classesToRemove = Array.from(new Set([className, ...removeClasses]));
    if (!effectState.pendingRemovalClasses) {
        effectState.pendingRemovalClasses = new Set(classesToRemove);
        el.classList.remove(...classesToRemove);
    } else {
        const newlyRemovedClasses = classesToRemove.filter((cls) => !effectState.pendingRemovalClasses?.has(cls));
        if (newlyRemovedClasses.length > 0) {
            newlyRemovedClasses.forEach((cls) => effectState.pendingRemovalClasses?.add(cls));
            el.classList.remove(...newlyRemovedClasses);
        }
    }

    effectState.pendingReplay = {
        durationMs,
        removeClasses
    };

    let pendingClasses = pendingReplayClassNamesByElement.get(el);
    if (!pendingClasses) {
        pendingClasses = new Set<string>();
        pendingReplayClassNamesByElement.set(el, pendingClasses);
    }
    pendingClasses.add(className);
    scheduleReplayFlush();
}

export function scheduleClassAfterPaint(
    el: HTMLElement,
    className: string,
    options: {
        delayFrames?: number;
    } = {}
): void {
    const { delayFrames = 2 } = options;
    const deferredState = getDeferredClassState(el, className);

    if (deferredState.rafId !== null) {
        window.cancelAnimationFrame(deferredState.rafId);
        deferredState.rafId = null;
    }

    let remainingFrames = Math.max(1, delayFrames);
    const tick = () => {
        if (!el.isConnected) {
            deferredState.rafId = null;
            cleanupDeferredClassState(el, className);
            return;
        }

        if (remainingFrames > 1) {
            remainingFrames -= 1;
            deferredState.rafId = window.requestAnimationFrame(tick);
            return;
        }

        deferredState.rafId = null;
        el.classList.add(className);
        cleanupDeferredClassState(el, className);
    };

    deferredState.rafId = window.requestAnimationFrame(tick);
}
