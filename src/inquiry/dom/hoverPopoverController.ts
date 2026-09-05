/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { Disposable } from '../../core/disposable';

/**
 * Hooks the host (InquiryView) supplies so the controller stays free of
 * domain semantics. `beforeShow` typically refreshes panel contents;
 * `positionPanel` re-anchors the panel against its trigger.
 */
export interface HoverPopoverHooks {
    beforeShow?: () => void;
    positionPanel?: () => void;
}

/**
 * Owns the show/hide/pin/hover-timer state of a popover panel.
 *
 * The controller does not know about sessions, the trigger element, or the
 * surrounding layout — it only flips the `ert-hidden` class on a panel
 * element and manages a single hide-debounce timer. Domain refresh and
 * positioning are delegated to the host through {@link HoverPopoverHooks}.
 *
 * `toggle()` and `unpin()` are exposed for clickable popovers; hover-only
 * popovers simply never call them and remain unpinned.
 *
 * Cleanup is idempotent and clears the pending timer; safe to register with
 * a {@link DisposableRegistry}.
 */
export class HoverPopoverController implements Disposable {
    private panel: HTMLElement | null = null;
    private pinned = false;
    private hideTimer: number | undefined;

    constructor(
        private readonly hooks: HoverPopoverHooks,
        private readonly hideDelayMs: number
    ) {}

    attach(panel: HTMLElement): void {
        this.panel = panel;
    }

    show(): void {
        if (!this.panel) return;
        this.cancelHide();
        this.hooks.beforeShow?.();
        this.hooks.positionPanel?.();
        this.panel.classList.remove('ert-hidden');
    }

    hide(force = false): void {
        if (!this.panel) return;
        if (this.pinned && !force) return;
        this.cancelHide();
        this.panel.classList.add('ert-hidden');
    }

    toggle(): void {
        if (!this.panel) return;
        if (this.pinned) {
            this.pinned = false;
            this.hide(true);
            return;
        }
        this.pinned = true;
        this.show();
    }

    scheduleHide(): void {
        if (this.pinned) return;
        this.cancelHide();
        this.hideTimer = window.setTimeout(() => {
            this.hide(true);
        }, this.hideDelayMs);
    }

    cancelHide(): void {
        if (this.hideTimer !== undefined) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = undefined;
        }
    }

    unpin(): void {
        this.pinned = false;
    }

    isPinned(): boolean {
        return this.pinned;
    }

    cleanup(): void {
        this.cancelHide();
        this.pinned = false;
        this.panel = null;
    }
}
