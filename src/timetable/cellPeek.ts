/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timetable: the full text of a cut-off cell
 * ------------------------------------------
 * Hold Shift while hovering a cell its column cuts off (a long Synopsis, a
 * list of characters) to read all of it in a panel under the cell. Letting go
 * of Shift, or leaving the cell, puts it away. A cell that already shows
 * everything never opens it. The Synopsis and Pending Edits icons in a row's
 * control panel use the same panel, without Shift. The panel hangs from the
 * window, so a short table pane never clips it, and it never takes a click.
 */

export interface PeekBox {
    left: number;
    top: number;
    bottom: number;
}

/** Room left between the panel and the cell, and between the panel and the window's edges (px). */
const PEEK_GAP = 4;
const PEEK_MARGIN = 8;

/**
 * Where the panel goes: under the cell, lined up with its left edge; above
 * the cell when there isn't room below; always inside the window's margins.
 */
export function placePeek(
    cell: PeekBox,
    panel: { width: number; height: number },
    viewport: { width: number; height: number }
): { left: number; top: number } {
    const left = Math.max(PEEK_MARGIN, Math.min(cell.left, viewport.width - PEEK_MARGIN - panel.width));
    const below = cell.bottom + PEEK_GAP;
    const above = cell.top - PEEK_GAP - panel.height;
    if (below + panel.height <= viewport.height - PEEK_MARGIN) return { left, top: below };
    if (above >= PEEK_MARGIN) return { left, top: above };
    return { left, top: Math.max(PEEK_MARGIN, viewport.height - PEEK_MARGIN - panel.height) };
}

/** True when a cell's text runs past its column (one line per cell, so only the width matters). */
export function isCutOff(cell: Pick<HTMLElement, 'scrollWidth' | 'clientWidth'>): boolean {
    return cell.scrollWidth > cell.clientWidth + 1;
}

/** The panel. The table tells it which cell is under the pointer and whether Shift is held. */
export class CellPeek {
    private readonly panel: HTMLElement;
    private cell: HTMLElement | null = null;
    private shown: HTMLElement | null = null;
    private held = false;
    /** A control-panel icon under the pointer and its text: shown at once, Shift or not. */
    private icon: { anchor: HTMLElement; text: string } | null = null;

    constructor(doc: Document) {
        this.panel = doc.body.createDiv({ cls: 'ert-timetable-peek', attr: { role: 'tooltip' } });
    }

    /** The pointer is over a Synopsis or Pending Edits icon (or has left it). */
    showText(anchor: HTMLElement | null, text = ''): void {
        const trimmed = text.trim();
        this.icon = anchor && trimmed ? { anchor, text: trimmed } : null;
        this.update();
    }

    /** The pointer is over this cell (or none), with Shift held or not. */
    hover(cell: HTMLElement | null, held: boolean): void {
        this.cell = cell;
        this.held = held;
        this.update();
    }

    /** Shift went down or up. */
    shift(held: boolean): void {
        this.held = held;
        this.update();
    }

    /** The cell under the pointer, if any. */
    hoveredCell(): HTMLElement | null {
        return this.cell;
    }

    isHeld(): boolean {
        return this.held;
    }

    hide(): void {
        this.shown = null;
        this.panel.removeClass('is-visible');
    }

    destroy(): void {
        this.panel.remove();
    }

    private update(): void {
        if (this.icon && !this.icon.anchor.isConnected) this.icon = null;
        if (this.icon) {
            this.show(this.icon.anchor, this.icon.text);
            return;
        }
        const cell = this.cell;
        if (!this.held || !cell || !cell.isConnected || !isCutOff(cell)) {
            this.hide();
            return;
        }
        const text = cell.innerText.trim();
        if (!text) {
            this.hide();
            return;
        }
        this.show(cell, text);
    }

    private show(anchor: HTMLElement, text: string): void {
        if (this.shown === anchor) return;
        this.panel.setText(text);
        this.panel.addClass('is-visible');
        const box = anchor.getBoundingClientRect();
        const win = anchor.win;
        const { left, top } = placePeek(box, { width: this.panel.offsetWidth, height: this.panel.offsetHeight }, { width: win.innerWidth, height: win.innerHeight });
        this.panel.setCssProps({ '--ert-peek-left': `${left}px`, '--ert-peek-top': `${top}px` });
        this.shown = anchor;
    }
}
