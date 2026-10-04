/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Hold Shift in Narrative mode to read the ring in the book's own terms:
 * every beat with an In This Book line shows that name in place of its
 * beat-system name ("Debate" → "The Flight from Detection") until Shift is
 * released.
 *
 * Shift is shared with the subplot ring key — both are "what is this called"
 * peeks, so one key shows both. Narrative only: Chronologue owns Shift for
 * elapsed-time comparison and draws no beats, and Gossamer identifies beats
 * by their canonical label text.
 */

import { RadialTimelineView } from '../TimeLineView';
import { showBeatLabels } from '../../renderer/dom/BeatLabelAdjuster';
import { isTypingInField } from '../../utils/domFocus';

type PeekKey = Pick<KeyboardEvent, 'key' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey'>;

/**
 * What a key event does to the peek. Shift alone shows the names; any other
 * key pressed meanwhile means Shift was part of a chord (Cmd+Shift+P), not a
 * peek, so the names go away rather than flash while the chord lands.
 */
export function beatNamePeekAction(event: PeekKey, phase: 'down' | 'up'): 'show' | 'hide' | 'none' {
    if (event.key !== 'Shift') return phase === 'down' ? 'hide' : 'none';
    if (phase === 'up') return 'hide';
    const chordModifierHeld = event.metaKey || event.ctrlKey || event.altKey;
    if (event.repeat || chordModifierHeld) return 'none';
    return 'show';
}

export function setupBeatNameKeyController(view: RadialTimelineView, container: HTMLElement): void {
    if (view.currentMode !== 'narrative') return;
    if (!container.querySelector('[data-beat-label-in-book]')) return;

    const doc = container.ownerDocument;
    // SAFE: the container is part of a live view; its document always has a window (popout-safe)
    const win = doc.defaultView!;
    let namesShown = false;

    const setNamesShown = (shown: boolean) => {
        if (shown === namesShown) return;
        namesShown = shown;
        showBeatLabels(container, shown ? 'in-book' : 'canonical');
    };

    const handleKey = (phase: 'down' | 'up') => (e: KeyboardEvent) => {
        const action = beatNamePeekAction(e, phase);
        if (action === 'hide') setNamesShown(false);
        if (action !== 'show') return;
        if (view.app.workspace.getActiveViewOfType(RadialTimelineView) !== view) return;
        if (isTypingInField(doc)) return;
        setNamesShown(true);
    };

    view.renderScope.registerDomEvent(doc, 'keydown', handleKey('down'));
    view.renderScope.registerDomEvent(doc, 'keyup', handleKey('up'));
    view.renderScope.registerDomEvent(win, 'blur', () => setNamesShown(false));
}
