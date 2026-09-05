/*
 * Radial Timeline — Session Log List renderer
 *
 * Renders private-audience session-log rows into DOM. Two modes:
 *   - 'preview': full row with date headers, mode/stage chips, words, scene
 *                chips, optional note. Used by the settings card expand panels.
 *   - 'compact': single-line row with date · duration · mode · 1–2 scene chips.
 *                Used by the timeline session popover "recent" footer.
 *
 * The renderer is private-only. Friends/community surfaces must go through
 * their dedicated projection functions in `WritingSessionLog.ts` first and
 * render with a separate, future component.
 *
 * ERT classes only. No inline styles unless dynamically computed.
 */

import { setIcon } from 'obsidian';
import type { PrivateSessionLogRow } from '../../services/WritingSessionLog';
import type { WritingSessionMode, WritingSessionStage } from '../../types/settings';

export type SessionLogListMode = 'preview' | 'compact';

export interface SessionLogListOptions {
    mode: SessionLogListMode;
    /** Click handler for a scene chip. Receives the vault path. */
    onSceneClick?: (path: string) => void;
    /** Override "today" for relative date formatting. Defaults to new Date(). */
    referenceDate?: Date;
    /** Customize the empty-state message. */
    emptyMessage?: string;
}

const MODE_LABEL: Record<WritingSessionMode, string> = {
    drafting: 'Drafting',
    revising: 'Revising',
    editing: 'Editing',
    planning: 'Planning',
};

const STAGE_LABEL: Record<WritingSessionStage, string> = {
    Zero: 'Zero',
    Author: 'Author',
    House: 'House',
    Press: 'Press',
    Mixed: 'Mixed',
};

const PREVIEW_SCENE_CHIP_LIMIT = 4;
const COMPACT_SCENE_CHIP_LIMIT = 2;

function basenameNoExt(path: string): string {
    const slash = path.lastIndexOf('/');
    const base = slash >= 0 ? path.slice(slash + 1) : path;
    return base.endsWith('.md') ? base.slice(0, -3) : base;
}

function formatDurationMs(ms: number): string {
    const totalMin = Math.max(0, Math.round(ms / 60000));
    if (totalMin < 60) return `${totalMin}m`;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

function formatTime(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    const hh = parsed.getHours();
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    const ampm = hh < 12 ? 'am' : 'pm';
    const display = hh % 12 === 0 ? 12 : hh % 12;
    return `${display}:${mm}${ampm}`;
}

function startOfLocalDay(date: Date): Date {
    const out = new Date(date.getTime());
    out.setHours(0, 0, 0, 0);
    return out;
}

function daysBetween(a: Date, b: Date): number {
    const ms = startOfLocalDay(a).getTime() - startOfLocalDay(b).getTime();
    return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Author's chosen day for the row, when present, else the local day of
 * endedAt. Prefer this for ANY display that says "Today / Yesterday / Sat":
 * if the author backdated the session via the completion modal,
 * `sessionDate` is the truth. `endedAt` is just when the clock physically
 * stopped, which can differ for late-night saves crossing the local day.
 */
function rowDayDate(row: PrivateSessionLogRow): Date | null {
    if (row.sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(row.sessionDate)) {
        const [y, m, d] = row.sessionDate.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const parsed = new Date(row.endedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeDateHeader(row: PrivateSessionLogRow, reference: Date): string {
    const parsed = rowDayDate(row);
    if (!parsed) return '';
    const delta = daysBetween(reference, parsed);
    if (delta === 0) return 'Today';
    if (delta === 1) return 'Yesterday';
    if (delta > 1 && delta < 7) {
        return parsed.toLocaleDateString(undefined, { weekday: 'long' });
    }
    return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCompactDate(row: PrivateSessionLogRow, reference: Date): string {
    const parsed = rowDayDate(row);
    if (!parsed) return '';
    const delta = daysBetween(reference, parsed);
    if (delta === 0) return 'Today';
    if (delta === 1) return 'Yesterday';
    if (delta > 1 && delta < 7) {
        return parsed.toLocaleDateString(undefined, { weekday: 'short' });
    }
    return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Stable per-day key for grouping. Uses sessionDate when present (so
 * backdated sessions group with the author's chosen day), else the local
 * day-portion of endedAt.
 */
function rowDayKey(row: PrivateSessionLogRow): string {
    if (row.sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(row.sessionDate)) {
        return row.sessionDate;
    }
    const parsed = new Date(row.endedAt);
    if (Number.isNaN(parsed.getTime())) return '';
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function appendSceneChip(parent: HTMLElement, path: string, options: SessionLogListOptions, kind: 'touched' | 'completed'): void {
    const chip = parent.createSpan({
        cls: `ert-session-log-row__chip ert-session-log-row__chip--${kind}`,
        text: basenameNoExt(path),
    });
    if (options.onSceneClick) {
        // Only set the title (native tooltip) when the chip is itself the
        // click target. In compact mode the chip is non-interactive and the
        // row carries the aria-label — setting a chip title here would
        // double-fire two tooltips on hover.
        chip.setAttribute('title', path);
        chip.classList.add('ert-session-log-row__chip--clickable');
        chip.onclick = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            options.onSceneClick?.(path);
        };
    }
}

function appendChipOverflow(parent: HTMLElement, count: number): void {
    if (count <= 0) return;
    parent.createSpan({
        cls: 'ert-session-log-row__chip ert-session-log-row__chip--more',
        text: `+${count}`,
    });
}

function renderPreviewRow(parent: HTMLElement, row: PrivateSessionLogRow, options: SessionLogListOptions): void {
    const li = parent.createDiv({ cls: 'ert-session-log-row ert-session-log-row--preview' });
    li.setAttribute('data-mode', row.mode);
    if (row.stage) li.setAttribute('data-stage', row.stage);

    const head = li.createDiv({ cls: 'ert-session-log-row__head' });
    head.createSpan({ cls: 'ert-session-log-row__time', text: formatTime(row.endedAt) });
    head.createSpan({ cls: 'ert-session-log-row__duration', text: formatDurationMs(row.durationMs) });
    head.createSpan({ cls: `ert-session-log-row__mode ert-session-log-row__mode--${row.mode}`, text: MODE_LABEL[row.mode] });
    if (row.stage) {
        head.createSpan({
            cls: `ert-session-log-row__stage ert-session-log-row__stage--${row.stage}`,
            text: STAGE_LABEL[row.stage],
        });
    }
    if (typeof row.wordsAdded === 'number' && row.wordsAdded > 0) {
        head.createSpan({ cls: 'ert-session-log-row__words', text: `+${row.wordsAdded.toLocaleString()} w` });
    }

    const allChipPaths = [
        ...row.scenesCompletedPaths.map(path => ({ path, kind: 'completed' as const })),
        ...row.scenePaths
            .filter(path => !row.scenesCompletedPaths.includes(path))
            .map(path => ({ path, kind: 'touched' as const })),
    ];
    if (allChipPaths.length > 0) {
        const chips = li.createDiv({ cls: 'ert-session-log-row__chips' });
        allChipPaths.slice(0, PREVIEW_SCENE_CHIP_LIMIT).forEach(item => appendSceneChip(chips, item.path, options, item.kind));
        appendChipOverflow(chips, Math.max(0, allChipPaths.length - PREVIEW_SCENE_CHIP_LIMIT));
    }

    if (row.note) {
        li.createDiv({ cls: 'ert-session-log-row__note', text: row.note });
    }
}

function renderCompactRow(parent: HTMLElement, row: PrivateSessionLogRow, options: SessionLogListOptions): void {
    const reference = options.referenceDate ?? new Date();
    const li = parent.createDiv({ cls: 'ert-session-log-row ert-session-log-row--compact' });
    li.setAttribute('data-mode', row.mode);
    if (row.stage) li.setAttribute('data-stage', row.stage);

    li.createSpan({ cls: 'ert-session-log-row__date', text: formatCompactDate(row, reference) });
    li.createSpan({ cls: 'ert-session-log-row__duration', text: formatDurationMs(row.durationMs) });
    const modeDot = li.createSpan({ cls: `ert-session-log-row__mode-dot ert-session-log-row__mode-dot--${row.mode}` });
    modeDot.setAttribute('aria-label', MODE_LABEL[row.mode]);
    modeDot.setAttribute('title', MODE_LABEL[row.mode]);

    const allChipPaths = [
        ...row.scenesCompletedPaths.map(path => ({ path, kind: 'completed' as const })),
        ...row.scenePaths
            .filter(path => !row.scenesCompletedPaths.includes(path))
            .map(path => ({ path, kind: 'touched' as const })),
    ];
    // In compact mode, individual chips are not interactive — the whole row
    // is the click target so the entire row hover-feedbacks as one unit.
    if (allChipPaths.length > 0) {
        const chips = li.createSpan({ cls: 'ert-session-log-row__chips' });
        allChipPaths.slice(0, COMPACT_SCENE_CHIP_LIMIT).forEach(item =>
            appendSceneChip(chips, item.path, { ...options, onSceneClick: undefined }, item.kind),
        );
        appendChipOverflow(chips, Math.max(0, allChipPaths.length - COMPACT_SCENE_CHIP_LIMIT));
    }

    const primaryPath = allChipPaths[0]?.path;
    if (primaryPath && options.onSceneClick) {
        li.classList.add('ert-session-log-row--clickable');
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        li.setAttribute('aria-label', `Open ${primaryPath}`);
        li.onclick = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            options.onSceneClick?.(primaryPath);
        };
        li.onkeydown = (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                options.onSceneClick?.(primaryPath);
            }
        };
    }
}

/**
 * Render `rows` into `container` (cleared first). Empty state shows
 * `options.emptyMessage` when no rows present.
 */
export function renderSessionLogList(
    container: HTMLElement,
    rows: PrivateSessionLogRow[],
    options: SessionLogListOptions,
): void {
    container.empty();
    container.classList.add('ert-session-log-list', `ert-session-log-list--${options.mode}`);

    if (rows.length === 0) {
        const empty = container.createDiv({ cls: 'ert-session-log-list__empty' });
        const iconEl = empty.createSpan({ cls: 'ert-session-log-list__empty-icon' });
        setIcon(iconEl, 'timer-off');
        empty.createSpan({ text: options.emptyMessage ?? 'No sessions in this window yet.' });
        return;
    }

    if (options.mode === 'compact') {
        rows.forEach(row => renderCompactRow(container, row, options));
        return;
    }

    // preview mode: group by day with relative headers
    const reference = options.referenceDate ?? new Date();
    let currentKey = '';
    let currentGroup: HTMLElement | null = null;
    for (const row of rows) {
        const key = rowDayKey(row);
        if (key !== currentKey || !currentGroup) {
            currentKey = key;
            const group = container.createDiv({ cls: 'ert-session-log-group' });
            group.createDiv({
                cls: 'ert-session-log-group__header',
                text: formatRelativeDateHeader(row, reference),
            });
            currentGroup = group.createDiv({ cls: 'ert-session-log-group__rows' });
        }
        renderPreviewRow(currentGroup, row, options);
    }
}
