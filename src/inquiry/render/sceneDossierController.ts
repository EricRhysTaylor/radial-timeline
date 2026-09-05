/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { Disposable } from '../../core/disposable';
import type { InquirySceneDossier } from '../types/inquiryViewTypes';

/**
 * Host hooks for the scene dossier popover. The controller owns the
 * timer/bookkeeping lifecycle; the host owns all SVG element work and any
 * cross-cutting flag updates (e.g. `minimapResultPreviewActive`).
 */
export interface SceneDossierHooks {
    /** Perform the visual show: render dossier into SVG and toggle any related state. */
    onRender(dossier: InquirySceneDossier, hoverKey: string): void;
    /** Perform the visual hide: remove `is-visible`, reset preview flags, etc. */
    onClear(): void;
}

export interface SceneDossierDelays {
    readonly hoverDelayMs: number;
    readonly hideDelayMs: number;
}

/**
 * Lifecycle controller for the scene dossier hover popover.
 *
 * Owns the two debounce timers (show / hide), the active hover key, and the
 * visibility flag. All SVG element interaction is delegated to the host via
 * {@link SceneDossierHooks}.
 *
 * Cleanup is idempotent and clears both timers; safe to register with a
 * {@link DisposableRegistry}.
 */
export class SceneDossierController implements Disposable {
    private showTimer: number | undefined;
    private hideTimer: number | undefined;
    private activeKey: string | undefined;
    private visible = false;

    constructor(
        private readonly hooks: SceneDossierHooks,
        private readonly delays: SceneDossierDelays
    ) {}

    /**
     * Schedule a dossier render for the given hover key. If the dossier is
     * already visible OR the same key is currently active, render immediately
     * (matches the legacy snap-on-rehover behavior).
     */
    queue(hoverKey: string, dossier: InquirySceneDossier): void {
        this.cancelHide();
        this.cancelShow();
        const showImmediately = this.visible || this.activeKey === hoverKey;
        if (showImmediately) {
            this.renderNow(dossier, hoverKey);
            return;
        }
        this.showTimer = window.setTimeout(() => {
            this.showTimer = undefined;
            this.renderNow(dossier, hoverKey);
        }, this.delays.hoverDelayMs);
    }

    /**
     * Hide the dossier. `immediate=true` skips the debounce and the
     * already-hidden short-circuit (used during clearResultPreview and on
     * close, when the caller wants synchronous teardown).
     */
    hide(immediate = false): void {
        this.cancelShow();
        const clear = (): void => {
            this.hideTimer = undefined;
            this.visible = false;
            this.activeKey = undefined;
            this.hooks.onClear();
        };
        if (immediate) {
            this.cancelHide();
            clear();
            return;
        }
        if (!this.visible) {
            this.hooks.onClear();
            return;
        }
        this.cancelHide();
        this.hideTimer = window.setTimeout(clear, this.delays.hideDelayMs);
    }

    isVisible(): boolean {
        return this.visible;
    }

    cleanup(): void {
        this.cancelShow();
        this.cancelHide();
        this.visible = false;
        this.activeKey = undefined;
    }

    private renderNow(dossier: InquirySceneDossier, hoverKey: string): void {
        this.cancelHide();
        this.hooks.onRender(dossier, hoverKey);
        this.activeKey = hoverKey;
        this.visible = true;
    }

    private cancelShow(): void {
        if (this.showTimer === undefined) return;
        window.clearTimeout(this.showTimer);
        this.showTimer = undefined;
    }

    private cancelHide(): void {
        if (this.hideTimer === undefined) return;
        window.clearTimeout(this.hideTimer);
        this.hideTimer = undefined;
    }
}
