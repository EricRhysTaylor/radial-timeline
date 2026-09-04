import { describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { RadialTimelineView } from './TimeLineView';
import type RadialTimelinePlugin from '../main';

// Every render replaces the SVG. Listeners, cleanups, and timers bound to the
// old SVG used to be registered on the view itself, so they survived until the
// view closed — one full generation per render. The render scope is a child
// Component that is unloaded at the top of the next render and with the view.

function makeView(): RadialTimelineView {
    const plugin = {
        settings: { currentMode: 'narrative' },
        openScenePaths: new Set<string>(),
        getRendererService: () => undefined
    } as unknown as RadialTimelinePlugin; // SAFE: the constructor reads only these three members; the rest of the plugin is never touched here
    const view = new RadialTimelineView({} as never, plugin);
    view.load();
    return view;
}

function resetRenderScope(view: RadialTimelineView): void {
    (view as unknown as { resetRenderScope: () => void }).resetRenderScope(); // SAFE: exercising the private reset that renderTimeline calls first
}

describe('RadialTimelineView render scope', () => {
    it('is a loaded child Component of the view', () => {
        const view = makeView();
        const scope = view.renderScope;
        expect(scope).toBeInstanceOf(Component);
        expect(view.renderScope).toBe(scope);
    });

    it('runs every registration from the previous render when the next render begins', () => {
        const view = makeView();
        const cleanup = vi.fn();
        const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
        const handler = () => {};

        view.renderScope.register(cleanup);
        view.renderScope.registerDomEvent(target as unknown as HTMLElement, 'pointerover', handler);
        expect(target.addEventListener).toHaveBeenCalledWith('pointerover', handler);
        expect(cleanup).not.toHaveBeenCalled();

        resetRenderScope(view);

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(target.removeEventListener).toHaveBeenCalledWith('pointerover', handler);
    });

    it('hands out a fresh scope after a reset, so the next render starts empty', () => {
        const view = makeView();
        const first = view.renderScope;
        const staleCleanup = vi.fn();
        first.register(staleCleanup);

        resetRenderScope(view);
        const second = view.renderScope;

        expect(second).not.toBe(first);
        expect(staleCleanup).toHaveBeenCalledTimes(1);

        resetRenderScope(view);
        // The stale registration belonged to the first generation only.
        expect(staleCleanup).toHaveBeenCalledTimes(1);
    });

    it('unloads the current scope with the view', () => {
        const view = makeView();
        const cleanup = vi.fn();
        view.renderScope.register(cleanup);

        view.unload();

        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
