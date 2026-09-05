type FocusState = {
    rafId: number | null;
};

const focusStateByElement = new WeakMap<HTMLElement, FocusState>();

function getFocusState(el: HTMLElement): FocusState {
    let state = focusStateByElement.get(el);
    if (!state) {
        state = { rafId: null };
        focusStateByElement.set(el, state);
    }
    return state;
}

export function scheduleFocusAfterPaint(
    el: HTMLElement,
    options: {
        delayFrames?: number;
        preventScroll?: boolean;
        selectText?: boolean;
    } = {}
): void {
    const {
        delayFrames = 2,
        preventScroll = true,
        selectText = false
    } = options;
    const state = getFocusState(el);

    if (state.rafId !== null) {
        window.cancelAnimationFrame(state.rafId);
        state.rafId = null;
    }

    let remainingFrames = Math.max(1, delayFrames);
    const tick = () => {
        if (!el.isConnected) {
            state.rafId = null;
            return;
        }

        if (remainingFrames > 1) {
            remainingFrames -= 1;
            state.rafId = window.requestAnimationFrame(tick);
            return;
        }

        state.rafId = null;
        el.focus({ preventScroll });
        if (selectText && el.instanceOf(HTMLInputElement)) {
            el.select();
        }
    };

    state.rafId = window.requestAnimationFrame(tick);
}
