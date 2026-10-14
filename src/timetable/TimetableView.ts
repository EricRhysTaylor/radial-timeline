/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timetable: the Bases view
 * -------------------------
 * One row per note, in the wheel's manuscript order, with the wheel's color
 * language: the scene number sits in a cell painted with the scene's status
 * fill, and the Rings column shows subplot membership as a strip of squares in
 * ring order. The Base's own filters choose the rows and its toolbar sets the
 * columns, sort and grouping. Every value shown is the note's own frontmatter,
 * so the wheel, this table and Obsidian's built-in Table never disagree.
 */

import {
    BasesView,
    Keymap,
    Menu,
    Notice,
    Platform,
    TFile,
    getFrontMatterInfo,
    normalizePath,
    parsePropertyId,
    setIcon,
    stringifyYaml,
    type App,
    type BasesAllOptions,
    type BasesEntry,
    type BasesEntryGroup,
    type BasesPropertyId,
    type QueryController,
} from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { TimelineItem } from '../types';
import { getFormattingLocale, t, tCount } from '../i18n';
import { getActiveBook, getBookIdForPath, getSagaBooks, getTimelineScope } from '../utils/books';
import { getConfiguredActCount, parseActLabels, resolveActLabel } from '../utils/acts';
import { canonicalizeFrontmatterKey, getActiveFrontmatterMappings, readBeatPurpose } from '../utils/frontmatter';
import { listAuthorQueries } from '../utils/authorQueryComments';
import { formatElapsedTime, parseWhenField } from '../utils/date';
import { formatSceneWhen, whenTextHasClock } from '../utils/whenFormat';
import { normalizeStatus } from '../utils/text';
import { isOverdueDateString } from '../utils/date';
import { convertFromEarth, formatElapsedTimePlanetary, getActivePlanetaryProfile } from '../utils/planetaryTime';
import { formatRuntimeValue } from '../utils/runtimeEstimator';
import { latestGossamerScore } from '../utils/gossamer';
import { parseRange, isScoreInRange } from '../utils/rangeValidation';
import { getToggleableModes } from '../modes/ModeRegistry';
import { tooltip } from '../utils/tooltip';
import { mountSvgMarkup } from '../utils/svgDom';
import { renderDefs } from '../renderer/components/Defs';
import { computeCacheableValues } from '../renderer/utils/Precompute';
import type { PluginRendererFacade } from '../utils/sceneHelpers';
import { runPromotion } from '../services/PromoteToSceneEntry';
import {
    belongsInTimetable,
    buildRingLayout,
    buildTableRow,
    compareChronologicalRows,
    compareManuscriptRows,
    displayName,
    distinctColorSlots,
    elapsedSincePrevious,
    groupProgress,
    planColoring,
    readRuntimeSeconds,
    readWhen,
    runningTotals,
    sceneNumberFill,
    withActDividers,
    withDayDividers,
    type RingLayout,
    type TimetableLine,
    type TimetableRow,
} from './timetableModel';
import { authorKeyFor, TIMETABLE_VIEW_TYPE } from './timetableFiles';
import { SketchDrawer, type SketchDrawerHost } from './SketchDrawer';
import { openInReadingPane } from './readingPane';
import { renderLegendSurface, wireLegendTrigger, type LegendSection } from '../view/interactions/LegendPanel';
import {
    clearTimelineColoring,
    clearTimelineLens,
    currentNotePath,
    currentTimelineColoring,
    currentTimelineLens,
    currentTimelineMode,
    setTimelineColoring,
    setTimelineLens,
    trackTimetable,
    type TimelineModeState,
} from './timetableRegistry';
import {
    addPublishStageMenuItems,
    addStatusMenuItems,
    applyStageToFrontmatter,
    applyStatusToFrontmatter,
    PUBLISH_STAGE_OPTIONS,
    showSceneContextMenu,
    STATUS_OPTIONS,
} from '../view/interactions/SceneContextMenu';
import { applySubplotMembershipChangeToMany } from '../services/SubplotMembership';
import { readSubplotColor, SUBPLOT_COLOR_SLOTS } from '../renderer/utils/subplotColors';
import type { BookProfile, PlanetaryProfile } from '../types/settings';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RINGS_PER_LINE_DEFAULT = 5;
const RINGS_REFRESH_DELAY_MS = 300;

/** Column widths (px). The number column holds the chevron, number cell, Promote and query count. */
const NUMBER_COLUMN_WIDTH = 150;
const OTHER_COLUMN_WIDTH = 140;
const MIN_COLUMN_WIDTH = 48;
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = { When: 220, Duration: 100, Chapter: 150, Synopsis: 360, Act: 56 };
const NAME_COLUMN_WIDTH = 220;

/** Rows a bulk edit can change: scenes, sketches and notes the timeline can't see yet. */
const SELECTABLE_KINDS = new Set(['scene', 'sketch', 'unclassed']);

/** Width of the columns a Chronologue micro-mode adds (Gap, Running time). */
const MICRO_COLUMN_WIDTH = 120;

/** The icon for each timeline mode on the Timetable's mode button. */
const MODE_ICONS: Record<string, string> = { narrative: 'list-ordered', progress: 'gauge', chronologue: 'clock', gossamer: 'activity' };

/** Properties with a fixed set of values: clicking their cell offers a quick pick. */
const PICKABLE_PROPERTIES = new Set(['Status', 'Publish Stage', 'Act']);

/** A column resize in progress. */
interface ColumnResize {
    property: BasesPropertyId;
    startX: number;
    startWidth: number;
    width: number;
    tableWidth: number;
    col: HTMLElement;
    table: HTMLElement;
}

interface TableItem {
    entry: BasesEntry;
    row: TimetableRow;
    frontmatter: Record<string, unknown> | undefined;
}

interface TableGroup {
    /** Stable identity for collapsing. */
    id: string;
    /** Header text, or null when the table isn't grouped. */
    label: string | null;
    /** The act every row shares, when the group is an act (so + New sketch can prefill it). */
    act?: number | null;
    items: TableItem[];
}

/** A table column: one of the Base's properties, or a column a Chronologue micro-mode adds. */
type Column =
    | { kind: 'property'; property: BasesPropertyId }
    | { kind: 'gap' }
    | { kind: 'running' };

/** What Chronologue order computes for the rows: story order, gaps (Shift) and running time (Runtime). */
interface ChronologueContext {
    group: TableGroup;
    lines: TimetableLine[];
    gap: Map<string, number | null>;
    running: Map<string, number>;
    /** The planetary calendar, when Alt is on and a profile is active. */
    profile: PlanetaryProfile | null;
}

/** The mode the table is drawn in, and what that mode computed. */
interface ModeContext {
    state: TimelineModeState;
    chronologue: ChronologueContext | null;
}

interface WheelRings {
    key: string;
    order: string[];
    colorIndex: Map<string, number>;
}

/** View options shown in the Bases toolbar's view menu. */
export function timetableViewOptions(): BasesAllOptions[] {
    return [
        { type: 'toggle', key: 'ringsColumn', displayName: t('ui.timetable.optionRings'), default: true },
        { type: 'slider', key: 'ringsPerLine', displayName: t('ui.timetable.optionRingsPerLine'), default: RINGS_PER_LINE_DEFAULT, min: 3, max: 8, step: 1 },
        { type: 'toggle', key: 'openAllSketches', displayName: t('ui.timetable.optionOpenSketches'), default: false },
        { type: 'toggle', key: 'lens', displayName: t('ui.timetable.optionLens'), default: false },
    ];
}

/**
 * Open a note from the table without covering the table: reveal it where it
 * is already open, otherwise use an editor tab or an empty tab in the main
 * area, otherwise split a pane beside the Timetable. Cmd/Ctrl-click always
 * opens a new tab.
 */
async function openFromTimetable(app: App, file: TFile, evt: MouseEvent, fromEl: HTMLElement): Promise<void> {
    const tableLeaf = app.workspace.getLeavesOfType('bases').find(leaf => leaf.view.containerEl.contains(fromEl));
    if (!tableLeaf) {
        await app.workspace.openLinkText(file.path, '', 'tab');
        return;
    }
    await openInReadingPane(app, file, tableLeaf, { evt });
}

function frontmatterKey(frontmatter: Record<string, unknown> | undefined, name: string): unknown {
    if (!frontmatter) return undefined;
    if (Object.prototype.hasOwnProperty.call(frontmatter, name)) return frontmatter[name];
    const lower = name.toLowerCase();
    const key = Object.keys(frontmatter).find(candidate => candidate.toLowerCase() === lower);
    return key === undefined ? undefined : frontmatter[key];
}

/** A menu title with the wheel menu's check mark for the current value. */
function checkedTitle(label: string, current: boolean): string {
    return current ? `${label}  ✓` : label;
}

function modeName(mode: string): string {
    return t(`timeline.modes.${mode}.name`);
}

function modeIcon(mode: string): string {
    const icon = MODE_ICONS[mode];
    return typeof icon === 'string' ? icon : 'list-ordered';
}

function firstText(value: unknown): string {
    const first: unknown = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first.trim() : (typeof first === 'number' ? String(first) : '');
}

export class TimetableView extends BasesView {
    type = TIMETABLE_VIEW_TYPE;
    readonly rootEl: HTMLElement;
    /** The ✱ key's button, made once and moved into each redrawn corner. */
    private keyButton: HTMLButtonElement | null = null;
    private readonly patternPrefix = `ert-timetable-${Math.random().toString(36).slice(2, 9)}-`;
    private readonly collapsed = new Set<string>();
    private rings: WheelRings | null = null;
    private ringsTimer: number | null = null;
    private ringsGeneration = 0;
    /** Sketch drawers, kept across redraws so an open editor keeps its text. */
    private readonly drawers = new Map<string, SketchDrawer>();
    private readonly openDrawers = new Set<string>();
    /** Drawers the author closed while "Open every sketch" is on. */
    private readonly closedDrawers = new Set<string>();
    /** A sketch just created here: open its drawer and put the cursor in it. */
    private focusPath: string | null = null;
    /** A redraw that waited for the author to stop typing in a drawer. */
    private renderDeferred = false;
    private decorateGeneration = 0;
    private readonly rowEls = new Map<string, HTMLElement>();
    private readonly synopsisFromBody = new Map<string, HTMLElement>();
    private hoveredPath: string | null = null;
    private resizing: ColumnResize | null = null;
    private linkedRow: HTMLElement | null = null;
    private currentRow: HTMLElement | null = null;
    /** A mode the author pinned the table to; null follows the timeline. Not saved. */
    private modePin: string | null = null;
    /** The ring the timeline's subplot key spotlights, if any. */
    private ringSpotlight: string | null = null;
    /** The lens toggle was just pressed here, so this table takes the lens from any other. */
    private claimLens = false;
    /** The column this table colors the timeline by, if any. Not saved. */
    private coloringProperty: BasesPropertyId | null = null;
    private claimColoring = false;
    /** Rows picked for a bulk edit, by path. Not saved. */
    private readonly selected = new Set<string>();
    private lastToggled: string | null = null;
    private readonly rowItems = new Map<string, TableItem>();
    private readonly groupHeaderEls = new Map<string, HTMLElement>();
    private readonly groupIdForAct = new Map<number, string>();
    private readonly actDividerEls = new Map<number, HTMLElement>();
    private readonly drawerHost: SketchDrawerHost = {
        promote: file => { void runPromotion(this.plugin, [file]); },
        openNote: (file, evt) => { void openFromTimetable(this.plugin.app, file, evt, this.rootEl); },
        close: path => this.closeDrawer(path),
        editingEnded: () => {
            if (this.renderDeferred) this.render();
        },
    };

    constructor(controller: QueryController, containerEl: HTMLElement, private readonly plugin: RadialTimelinePlugin) {
        super(controller);
        this.rootEl = containerEl.createDiv({ cls: 'ert-timetable' });
    }

    onload(): void {
        this.register(trackTimetable(this));
        this.setUpKey();
        // One set of delegated handlers: rows are redrawn on every data update.
        this.registerDomEvent(this.rootEl, 'click', (evt: MouseEvent) => this.handleClick(evt));
        this.registerDomEvent(this.rootEl, 'keydown', (evt: KeyboardEvent) => {
            if (evt.key !== 'Enter' && evt.key !== ' ') return;
            const toggle = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__group-toggle') : null;
            if (!toggle) return;
            evt.preventDefault();
            this.toggleGroup(toggle.dataset.groupId ?? '');
        });
        // Esc clears picked rows wherever focus is (after a bulk menu or a row click it sits on the page).
        // On the app's scope, so an open menu or dialog takes Esc first.
        const escape = this.plugin.app.scope.register([], 'Escape', (evt: KeyboardEvent) => this.clearSelectionOnEscape(evt));
        this.register(() => this.plugin.app.scope.unregister(escape));
        this.registerDomEvent(this.rootEl, 'contextmenu', (evt: MouseEvent) => this.handleContextMenu(evt));
        // Column resizing: the handle captures the pointer, so its moves bubble here.
        this.registerDomEvent(this.rootEl, 'pointerdown', (evt: PointerEvent) => this.startResize(evt));
        this.registerDomEvent(this.rootEl, 'pointermove', (evt: PointerEvent) => this.moveResize(evt));
        this.registerDomEvent(this.rootEl, 'pointerup', () => this.endResize());
        this.registerDomEvent(this.rootEl, 'pointercancel', () => this.endResize());
        // Hovering a scene's row lights it up on the wheel.
        this.registerDomEvent(this.rootEl, 'mouseover', (evt: MouseEvent) => {
            const row = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__row.is-scene') : null;
            const path = row?.dataset.path ?? null;
            if (path === this.hoveredPath) return;
            this.hoveredPath = path;
            this.plugin.highlightSceneOnTimeline(path);
        });
        this.registerDomEvent(this.rootEl, 'mouseleave', () => {
            if (this.hoveredPath === null) return;
            this.hoveredPath = null;
            this.plugin.highlightSceneOnTimeline(null);
        });
    }

    // ── Column widths ───────────────────────────────────────────────────

    /** Saved widths, under the same `columnSize` key Obsidian's own table uses. */
    private columnSizes(): Record<string, number> {
        const raw = this.config.get('columnSize');
        const sizes: Record<string, number> = {};
        if (!raw || typeof raw !== 'object') return sizes;
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof value === 'number' && Number.isFinite(value)) sizes[key] = value;
        }
        return sizes;
    }

    private defaultColumnWidth(property: BasesPropertyId): number {
        const { type, name } = parsePropertyId(property);
        if (type === 'file' && name === 'name') return NAME_COLUMN_WIDTH;
        if (type !== 'note') return OTHER_COLUMN_WIDTH;
        const width = DEFAULT_COLUMN_WIDTHS[canonicalizeFrontmatterKey(name, getActiveFrontmatterMappings(this.plugin.settings))];
        return typeof width === 'number' ? width : OTHER_COLUMN_WIDTH;
    }

    private startResize(evt: PointerEvent): void {
        const handle = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__resize') : null;
        const property = handle?.dataset.property as BasesPropertyId | undefined;
        const table = handle?.closest<HTMLElement>('.ert-timetable__table');
        const col = property ? table?.querySelector<HTMLElement>(`col[data-property="${CSS.escape(property)}"]`) : null;
        const header = handle?.parentElement;
        if (!handle || !property || !table || !col || !header) return;
        evt.preventDefault();
        handle.setPointerCapture(evt.pointerId);
        const startWidth = header.getBoundingClientRect().width;
        this.resizing = { property, startX: evt.clientX, startWidth, width: startWidth, tableWidth: table.getBoundingClientRect().width, col, table };
    }

    private moveResize(evt: PointerEvent): void {
        const resize = this.resizing;
        if (!resize) return;
        resize.width = Math.max(MIN_COLUMN_WIDTH, Math.round(resize.startWidth + evt.clientX - resize.startX));
        resize.col.setCssProps({ '--ert-timetable-col-width': `${resize.width}px` });
        resize.table.setCssProps({ '--ert-timetable-width': `${Math.round(resize.tableWidth + resize.width - resize.startWidth)}px` });
    }

    /** Save the new width in the .base file, as Obsidian's table does. */
    private endResize(): void {
        const resize = this.resizing;
        if (!resize) return;
        this.resizing = null;
        if (resize.width === Math.round(resize.startWidth)) return;
        this.config.set('columnSize', { ...this.columnSizes(), [resize.property]: resize.width });
    }

    /** The wheel is hovering this scene: light up its row and bring it into view. */
    markLinkedRow(path: string | null, color: string | null): void {
        if (this.linkedRow) {
            this.linkedRow.removeClass('is-linked');
            this.linkedRow.setCssProps({ '--ert-timetable-link-color': '' });
        }
        this.linkedRow = path ? this.rowEls.get(path) ?? null : null;
        if (!this.linkedRow) return;
        this.linkedRow.addClass('is-linked');
        if (color) this.linkedRow.setCssProps({ '--ert-timetable-link-color': color });
        this.linkedRow.scrollIntoView({ block: 'nearest' });
    }

    /** A note was opened in an editor: mark its row (and bring it into view). */
    markCurrentNote(path: string | null): void {
        this.setCurrentRow(path);
        this.revealCurrentRow();
    }

    /** Bring the open note's row into view, centred when it was out of sight (as after a wheel click); a visible row stays put. */
    private revealCurrentRow(): void {
        const row = this.currentRow;
        const scroller = row?.closest<HTMLElement>('.bases-view');
        if (!row || !scroller) {
            row?.scrollIntoView({ block: 'nearest' });
            return;
        }
        const box = row.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        const header = row.closest('table')?.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        if (box.top >= view.top + header && box.bottom <= view.bottom) return;
        row.scrollIntoView({ block: 'center' });
    }

    private setCurrentRow(path: string | null): void {
        this.currentRow?.removeClass('is-current');
        this.currentRow = path ? this.rowEls.get(path) ?? null : null;
        this.currentRow?.addClass('is-current');
    }

    /** The subplot key spotlights a ring: dim the rows outside it, as the wheel does. */
    markRing(subplot: string | null): void {
        this.ringSpotlight = subplot;
        for (const [path, element] of this.rowEls) {
            const item = this.rowItems.get(path);
            element.toggleClass('is-out-of-ring', subplot !== null && item !== undefined && !item.row.subplots.includes(subplot));
        }
    }

    /** An act label (a book label in saga scope) was clicked on the timeline: show that part of the table. */
    revealSegment(index: number): void {
        const saga = [...this.groupHeaderEls.keys()].some(id => id.startsWith('book:'));
        let groupId: string | undefined;
        if (saga) {
            const book = getSagaBooks(this.plugin.settings)[index];
            groupId = book ? `book:${book.id}` : undefined;
        } else {
            groupId = this.groupIdForAct.get(index + 1);
            if (!groupId) {
                this.actDividerEls.get(index + 1)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                return;
            }
        }
        if (!groupId) return;
        if (this.collapsed.delete(groupId)) this.render();
        this.groupHeaderEls.get(groupId)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    // ── Following the timeline's mode ───────────────────────────────────

    /** The mode the table is drawn in: the timeline's, unless the author pinned another. */
    private modeState(): TimelineModeState {
        const timeline = currentTimelineMode() ?? { mode: this.plugin.settings.currentMode || 'narrative', shift: false, alt: false, runtime: false };
        if (this.modePin === null || this.modePin === timeline.mode) return timeline;
        return { mode: this.modePin, shift: false, alt: false, runtime: false };
    }

    private modeTooltip(state: TimelineModeState): string {
        const micro = [
            state.shift ? t('ui.timetable.microShift') : '',
            state.alt ? t('ui.timetable.microAlt') : '',
            state.runtime ? t('ui.timetable.microRuntime') : '',
        ].filter(part => part.length > 0);
        const label = [modeName(state.mode), ...micro].join(' · ');
        return this.modePin === null ? t('ui.timetable.modeFollowing', { mode: label }) : t('ui.timetable.modePinned', { mode: label });
    }

    /** Follow the timeline (the default), or pin the table to one mode. */
    private showModeMenu(anchor: HTMLElement): void {
        const menu = new Menu();
        const timeline = currentTimelineMode()?.mode ?? this.plugin.settings.currentMode ?? 'narrative';
        menu.addItem(item => item
            .setTitle(checkedTitle(t('ui.timetable.modeFollowItem', { mode: modeName(timeline) }), this.modePin === null))
            .setIcon('link')
            .onClick(() => {
                this.modePin = null;
                this.render();
            }));
        menu.addSeparator();
        for (const mode of getToggleableModes()) {
            menu.addItem(item => item
                .setTitle(checkedTitle(modeName(mode.id), this.modePin === mode.id))
                .setIcon(modeIcon(mode.id))
                .onClick(() => {
                    this.modePin = mode.id;
                    this.render();
                }));
        }
        const rect = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
    }

    /**
     * Chronologue order: the rows in story order (beats left out, as on the
     * wheel), with a divider for each new day, the gap since the previous
     * dated row (Shift) and the running time (Runtime). A sort the author set
     * in the Bases toolbar still wins.
     */
    private chronologueContext(groups: TableGroup[], state: TimelineModeState): ChronologueContext {
        const { settings } = this.plugin;
        const authorSorted = this.config.getSort().length > 0;
        const keyed = groups
            .flatMap(group => group.items)
            .filter(item => item.row.kind !== 'beat')
            .map(item => ({ item, row: item.row, when: readWhen(item.frontmatter, settings).when }));
        if (!authorSorted) keyed.sort(compareChronologicalRows);
        const gaps = elapsedSincePrevious(keyed.map(entry => entry.when));
        const totals = runningTotals(keyed.map(entry => entry.row.kind === 'scene' ? readRuntimeSeconds(entry.item.frontmatter, settings) : null));
        return {
            group: { id: 'chronologue', label: null, items: keyed.map(entry => entry.item) },
            lines: authorSorted ? keyed.map(entry => ({ type: 'row' as const, row: entry.row })) : withDayDividers(keyed),
            gap: new Map(keyed.map((entry, index) => [entry.row.path, gaps[index]])),
            running: new Map(keyed.map((entry, index) => [entry.row.path, totals[index]])),
            profile: state.alt ? getActivePlanetaryProfile(settings) : null,
        };
    }

    /** A When in the table: the shared When format, or the planetary calendar when Alt is on. */
    private formatWhen(when: Date, hasClock: boolean, profile: PlanetaryProfile | null): string {
        const planetary = profile ? convertFromEarth(when, profile) : null;
        return planetary ? planetary.formatted : formatSceneWhen(when, hasClock);
    }

    // ── Lens ────────────────────────────────────────────────────────────

    /** With its lens on, this table's rows light up on the timeline. */
    private syncLens(): void {
        if (this.config.get('lens') !== true) {
            clearTimelineLens(this);
            return;
        }
        const active = currentTimelineLens();
        // Another table's lens stays until this one's toggle is pressed.
        if (active && active.owner !== this && !this.claimLens) return;
        this.claimLens = false;
        const { app, settings } = this.plugin;
        const bookFolders = (settings.books ?? []).map(book => book.sourceFolder);
        const paths = new Set((this.data?.data ?? [])
            .filter(entry => entry.file.extension === 'md')
            .filter(entry => belongsInTimetable(buildTableRow(entry.file.path, entry.file.basename, app.metadataCache.getFileCache(entry.file)?.frontmatter, settings), bookFolders))
            .map(entry => entry.file.path));
        setTimelineLens({ owner: this, paths, label: this.config.name, turnOff: () => this.config.set('lens', false) });
    }

    private toggleLens(): void {
        if (currentTimelineLens()?.owner === this) {
            this.config.set('lens', false);
            clearTimelineLens(this);
        } else {
            this.claimLens = true;
            this.config.set('lens', true);
        }
        this.render();
    }

    /**
     * Right-click a scene's row for the same menu as right-clicking it on the
     * wheel. Other rows get Obsidian's own file menu, which includes Promote
     * for notes that can become scenes.
     */
    /** Esc clears the picked rows while this table's pane is active and no text field has focus. False means handled. */
    private clearSelectionOnEscape(evt: KeyboardEvent): boolean {
        if (this.selected.size === 0) return true;
        if (!this.rootEl.closest('.workspace-leaf')?.hasClass('mod-active')) return true;
        if (evt.target instanceof Element && evt.target.closest('input[type="text"], textarea, select, .cm-editor')) return true;
        this.selected.clear();
        this.render();
        return false;
    }

    private handleContextMenu(evt: MouseEvent): void {
        const header = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__prop-head[data-property]') : null;
        if (header?.dataset.property) {
            evt.preventDefault();
            this.showColumnMenu(evt, header.dataset.property as BasesPropertyId);
            return;
        }
        const row = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__row') : null;
        const file = row?.dataset.path ? this.plugin.app.vault.getFileByPath(row.dataset.path) : null;
        if (!row || !file) return;
        evt.preventDefault();
        if (!row.hasClass('is-scene')) {
            const menu = new Menu();
            this.plugin.app.workspace.trigger('file-menu', menu, file, TIMETABLE_VIEW_TYPE);
            menu.showAtMouseEvent(evt);
            return;
        }
        const rings = (this.rings?.order ?? []).filter(name => name !== 'Backdrop' && name !== 'MicroBackdrop');
        const frontmatter: Record<string, unknown> | undefined = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const subplots = buildTableRow(file.path, file.basename, frontmatter, this.plugin.settings).subplots;
        const primary = subplots[0];
        const colorIndex = primary !== undefined ? this.rings?.colorIndex.get(primary) : undefined;
        showSceneContextMenu({ plugin: this.plugin }, {
            file,
            itemType: 'Scene',
            ringSubplot: null,
            knownSubplots: rings,
            primarySubplot: primary,
            subplotColor: colorIndex !== undefined ? readSubplotColor(this.rootEl.ownerDocument, colorIndex) : undefined,
        }, evt);
    }

    private handleClick(evt: MouseEvent): void {
        const target = evt.target instanceof Element ? evt.target : null;
        if (!target) return;
        const toggle = target.closest<HTMLElement>('.ert-timetable__group-toggle');
        if (toggle) {
            this.toggleGroup(toggle.dataset.groupId ?? '');
            return;
        }
        const switchBook = target.closest<HTMLElement>('.ert-timetable__notice button');
        if (switchBook?.dataset.bookId) {
            void this.plugin.setActiveBookId(switchBook.dataset.bookId);
            return;
        }
        if (target.closest('.ert-timetable__lens-toggle')) {
            this.toggleLens();
            return;
        }
        const modeButton = target.closest<HTMLElement>('.ert-timetable__mode');
        if (modeButton) {
            this.showModeMenu(modeButton);
            return;
        }
        const bulk = target.closest<HTMLElement>('.ert-timetable__bulk [data-bulk]');
        if (bulk?.dataset.bulk) {
            this.handleBulk(bulk.dataset.bulk, bulk);
            return;
        }
        const newSketch = target.closest<HTMLElement>('.ert-timetable__new-sketch');
        if (newSketch) {
            const act = newSketch.dataset.act ? Number(newSketch.dataset.act) : null;
            void this.createSketch(act, newSketch.dataset.bookId);
            return;
        }
        // The drawer handles its own clicks.
        if (target.closest('.ert-timetable__drawer-row')) return;
        const row = target.closest<HTMLElement>('.ert-timetable__row');
        const path = row?.dataset.path;
        const file = path ? this.plugin.app.vault.getFileByPath(path) : null;
        if (!row || !path || !file) return;
        if (target.closest('.ert-timetable__promote')) {
            void runPromotion(this.plugin, [file]);
            return;
        }
        if (target.closest('.ert-timetable__select')) {
            evt.preventDefault();
            this.toggleSelected(path, evt.shiftKey);
            return;
        }
        // A fixed-value cell, or a scene's number cell, opens a quick pick instead of the note.
        const pick = target.closest<HTMLElement>('.ert-timetable__pick');
        if (pick?.dataset.pick) {
            this.showQuickPick(pick, file, pick.dataset.pick, row.hasClass('is-scene'));
            return;
        }
        if (target.closest('.ert-timetable__drawer-toggle')) {
            this.toggleDrawer(path);
            return;
        }
        // Links, buttons and inputs inside a cell keep their own behavior.
        if (target.closest('a, button, input, textarea, select')) return;
        // Shift-click shows the scene on the timeline.
        if (evt.shiftKey && row.hasClass('is-scene')) {
            void this.plugin.revealSceneOnTimeline(path);
            return;
        }
        // A sketch's row opens its drawer; every other row opens the note.
        if (row.hasClass('is-sketch') && !Keymap.isModEvent(evt)) {
            this.toggleDrawer(path);
            return;
        }
        void openFromTimetable(this.plugin.app, file, evt, this.rootEl);
    }

    // ── Bulk edits ──────────────────────────────────────────────────────

    /** Pick or unpick a row; Shift picks every row between it and the last one toggled. */
    private toggleSelected(path: string, range: boolean): void {
        const order = [...this.rowEls.keys()].filter(candidate => this.isSelectable(candidate));
        const from = this.lastToggled ? order.indexOf(this.lastToggled) : -1;
        const to = order.indexOf(path);
        if (range && from >= 0 && to >= 0) {
            const [start, end] = from < to ? [from, to] : [to, from];
            order.slice(start, end + 1).forEach(candidate => this.selected.add(candidate));
        } else if (this.selected.has(path)) {
            this.selected.delete(path);
        } else {
            this.selected.add(path);
        }
        this.lastToggled = path;
        this.render();
    }

    private isSelectable(path: string): boolean {
        const item = this.rowItems.get(path);
        return item !== undefined && SELECTABLE_KINDS.has(item.row.kind);
    }

    private selectedItems(): TableItem[] {
        return [...this.selected].map(path => this.rowItems.get(path)).filter((item): item is TableItem => item !== undefined);
    }

    /** The bar under the table while rows are picked: set Status, Stage, Act or rings on all of them at once. */
    private renderBulkBar(): void {
        const items = this.selectedItems();
        if (items.length === 0) return;
        const scenes = items.filter(item => item.row.kind === 'scene').length;
        const promotable = items.filter(item => item.row.kind !== 'scene').length;
        const bar = this.rootEl.createDiv({ cls: 'ert-timetable__bulk' });
        bar.createSpan({ cls: 'ert-timetable__bulk-count', text: t('ui.timetable.bulkSelected', { notes: tCount('note', items.length) }) });
        const button = (kind: string, label: string, icon: string, menu: boolean): void => {
            const el = bar.createEl('button', { cls: 'ert-timetable__bulk-action' });
            el.dataset.bulk = kind;
            setIcon(el.createSpan({ cls: 'ert-timetable__bulk-icon' }), icon);
            el.createSpan({ text: label });
            if (menu) setIcon(el.createSpan({ cls: 'ert-timetable__bulk-icon' }), 'chevron-down');
        };
        if (scenes > 0) {
            button('status', t('ui.timetable.bulkStatus'), 'circle-dot', true);
            button('stage', t('ui.timetable.bulkStage'), 'layers', true);
        }
        button('act', t('ui.timetable.bulkAct'), 'columns-3', true);
        if (scenes > 0 && this.rings) {
            button('ring-add', t('ui.timetable.bulkAddRing'), 'plus-circle', true);
            button('ring-remove', t('ui.timetable.bulkRemoveRing'), 'minus-circle', true);
        }
        if (promotable > 0) button('promote', t('ui.timetable.bulkPromote', { notes: tCount('note', promotable) }), 'file-up', false);
        const clear = bar.createEl('button', { cls: 'ert-timetable__bulk-clear clickable-icon' });
        clear.dataset.bulk = 'clear';
        clear.setAttr('aria-label', t('ui.timetable.bulkClear'));
        setIcon(clear, 'x');
    }

    private handleBulk(kind: string, anchor: HTMLElement): void {
        const items = this.selectedItems();
        const sceneFiles = items.filter(item => item.row.kind === 'scene').map(item => item.entry.file);
        if (kind === 'clear') {
            this.selected.clear();
            this.render();
            return;
        }
        if (kind === 'promote') {
            void runPromotion(this.plugin, items.filter(item => item.row.kind !== 'scene').map(item => item.entry.file));
            return;
        }
        const host = { plugin: this.plugin };
        const menu = new Menu();
        if (kind === 'status') {
            for (const option of STATUS_OPTIONS) {
                menu.addItem(item => item.setTitle(option.label).setIcon(option.icon).onClick(() => {
                    void this.bulkWrite(sceneFiles, fm => applyStatusToFrontmatter(host, fm, option.value),
                        t('ui.timetable.bulkStatusDone', { value: option.label, scenes: tCount('scene', sceneFiles.length) }));
                }));
            }
        } else if (kind === 'stage') {
            for (const option of PUBLISH_STAGE_OPTIONS) {
                menu.addItem(item => item.setTitle(option.label).setIcon(option.icon).onClick(() => {
                    void this.bulkWrite(sceneFiles, fm => applyStageToFrontmatter(host, fm, option.value),
                        t('ui.timetable.bulkStageDone', { value: option.label, scenes: tCount('scene', sceneFiles.length) }));
                }));
            }
        } else if (kind === 'act') {
            const { settings } = this.plugin;
            const mappings = getActiveFrontmatterMappings(settings);
            const labels = parseActLabels(settings, getConfiguredActCount(settings));
            const writeAct = (files: TFile[], act: number | null, label: string): void => {
                void this.bulkWrite(files, fm => {
                    const key = Object.keys(fm).find(candidate => canonicalizeFrontmatterKey(candidate, mappings) === 'Act') ?? authorKeyFor('Act', settings);
                    if (act === null) delete fm[key];
                    else fm[key] = act;
                }, t('ui.timetable.bulkActDone', { value: label, notes: tCount('note', files.length) }));
            };
            for (let act = 1; act <= getConfiguredActCount(settings); act++) {
                const label = resolveActLabel(act - 1, labels);
                menu.addItem(item => item.setTitle(label).onClick(() => writeAct(items.map(entry => entry.entry.file), act, label)));
            }
            // A scene always sits in an act; No act applies only to the other notes picked.
            const others = items.filter(item => item.row.kind !== 'scene').map(item => item.entry.file);
            if (others.length > 0) {
                menu.addItem(item => item.setTitle(t('ui.timetable.noAct')).onClick(() => writeAct(others, null, t('ui.timetable.noAct'))));
            }
        } else if (kind === 'ring-add' || kind === 'ring-remove') {
            const rings = (this.rings?.order ?? []).filter(name => name !== 'Backdrop' && name !== 'MicroBackdrop');
            const inUse = new Set(items.filter(item => item.row.kind === 'scene').flatMap(item => item.row.subplots));
            const choices = kind === 'ring-add' ? rings : rings.filter(name => inUse.has(name));
            const mappings = getActiveFrontmatterMappings(this.plugin.settings);
            for (const ring of choices) {
                menu.addItem(item => item.setTitle(ring).onClick(() => {
                    const change = kind === 'ring-add' ? { kind: 'add' as const, to: ring } : { kind: 'remove' as const, from: ring };
                    void applySubplotMembershipChangeToMany(this.plugin.app, sceneFiles, change, {
                        mappings,
                        onChanged: () => this.plugin.refreshTimelineIfNeeded(null),
                    });
                }));
            }
        }
        const rect = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.top }, anchor.ownerDocument);
    }

    /** One frontmatter change on every file, then one timeline refresh and one notice. */
    private async bulkWrite(files: TFile[], change: (fm: Record<string, unknown>) => void, done: string): Promise<void> {
        let failed = 0;
        for (const file of files) {
            try {
                await this.plugin.app.fileManager.processFrontMatter(file, change);
            } catch (error) {
                failed += 1;
                console.error(`[Timetable] Bulk edit failed for ${file.path}:`, error);
            }
        }
        this.plugin.refreshTimelineIfNeeded(null);
        new Notice(failed > 0 ? `${done} ${t('ui.timetable.bulkFailed', { notes: tCount('note', failed) })}` : done);
    }

    // ── Coloring the timeline by a column ───────────────────────────────

    /** Right-click a column header: color the timeline's scenes by its values (or stop). */
    private showColumnMenu(evt: MouseEvent, property: BasesPropertyId): void {
        const name = this.config.getDisplayName(property);
        const menu = new Menu();
        const coloring = currentTimelineColoring();
        if (coloring?.owner === this && this.coloringProperty === property) {
            menu.addItem(item => item.setTitle(t('ui.timetable.coloringStop')).setIcon('palette').onClick(() => {
                this.coloringProperty = null;
                clearTimelineColoring(this);
                this.render();
            }));
        } else {
            const plan = this.planColoringFor(property);
            menu.addItem(item => {
                item.setIcon('palette');
                if (plan.kind === 'ok') {
                    item.setTitle(t('ui.timetable.coloringStart', { property: name })).onClick(() => {
                        this.coloringProperty = property;
                        this.claimColoring = true;
                        this.render();
                    });
                } else {
                    item.setTitle(plan.kind === 'tooMany'
                        ? t('ui.timetable.coloringTooMany', { property: name, count: plan.count })
                        : t('ui.timetable.coloringNone', { property: name })).setDisabled(true);
                }
            });
        }
        menu.showAtMouseEvent(evt);
    }

    /** Each scene row's value in a column (only scenes are colored on the timeline). */
    private planColoringFor(property: BasesPropertyId): ReturnType<typeof planColoring> {
        const { type, name } = parsePropertyId(property);
        if (type !== 'note') return { kind: 'none' };
        const { app, settings } = this.plugin;
        const rows = (this.data?.data ?? [])
            .filter(entry => entry.file.extension === 'md')
            .map(entry => {
                const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(entry.file)?.frontmatter;
                return { entry, frontmatter, row: buildTableRow(entry.file.path, entry.file.basename, frontmatter, settings) };
            })
            .filter(item => item.row.kind === 'scene')
            .map(item => ({ path: item.row.path, value: frontmatterKey(item.frontmatter, name) }));
        const palette = Array.from({ length: SUBPLOT_COLOR_SLOTS }, (_, slot) => readSubplotColor(this.rootEl.ownerDocument, slot));
        return planColoring(rows, undefined, distinctColorSlots(palette));
    }

    /** Keep the timeline's coloring in step with this table's values; another table's coloring replaces it. */
    private syncColoring(): void {
        const property = this.coloringProperty;
        if (property === null) return;
        const active = currentTimelineColoring();
        if (active && active.owner !== this && !this.claimColoring) {
            this.coloringProperty = null;
            return;
        }
        this.claimColoring = false;
        const plan = this.planColoringFor(property);
        if (plan.kind !== 'ok') {
            this.coloringProperty = null;
            clearTimelineColoring(this);
            return;
        }
        setTimelineColoring({
            owner: this,
            property: this.config.getDisplayName(property),
            values: plan.values,
            legend: plan.legend,
            turnOff: () => {
                this.coloringProperty = null;
                clearTimelineColoring(this);
                this.render();
            },
        });
    }

    // ── Quick picks ─────────────────────────────────────────────────────

    /**
     * The quick pick for a fixed-value property. Status and Publish Stage use
     * the wheel's own menu items (Complete also sets Due); the number cell
     * offers both. Act offers the book's acts, and No act for a note that
     * isn't a scene yet.
     */
    private showQuickPick(anchor: HTMLElement, file: TFile, property: string, isScene: boolean): void {
        const menu = new Menu();
        const host = { plugin: this.plugin };
        if (property === 'status') {
            addStatusMenuItems(menu, host, file);
            menu.addSeparator();
            addPublishStageMenuItems(menu, host, file);
        } else if (property === 'Status') {
            addStatusMenuItems(menu, host, file);
        } else if (property === 'Publish Stage') {
            addPublishStageMenuItems(menu, host, file);
        } else if (property === 'Act') {
            this.addActItems(menu, file, isScene);
        }
        const rect = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
    }

    private addActItems(menu: Menu, file: TFile, isScene: boolean): void {
        const { settings } = this.plugin;
        const mappings = getActiveFrontmatterMappings(settings);
        const frontmatter: Record<string, unknown> | undefined = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const current = buildTableRow(file.path, file.basename, frontmatter, settings).act;
        const labels = parseActLabels(settings, getConfiguredActCount(settings));
        const write = (act: number | null): void => {
            void this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                const key = Object.keys(fm).find(candidate => canonicalizeFrontmatterKey(candidate, mappings) === 'Act') ?? authorKeyFor('Act', settings);
                if (act === null) delete fm[key];
                else fm[key] = act;
            }).then(() => this.plugin.refreshTimelineIfNeeded(file, 100));
        };
        for (let act = 1; act <= getConfiguredActCount(settings); act++) {
            menu.addItem(item => item
                .setTitle(checkedTitle(resolveActLabel(act - 1, labels), current === act))
                .onClick(() => write(act)));
        }
        // A scene always sits in an act on the wheel; only other notes can have none.
        if (!isScene) {
            menu.addItem(item => item
                .setTitle(checkedTitle(t('ui.timetable.noAct'), current === null))
                .onClick(() => write(null)));
        }
    }

    // ── Sketches ────────────────────────────────────────────────────────

    private drawerIsOpen(path: string): boolean {
        return this.config.get('openAllSketches') === true ? !this.closedDrawers.has(path) : this.openDrawers.has(path);
    }

    private toggleDrawer(path: string): void {
        if (this.drawerIsOpen(path)) {
            this.closeDrawer(path);
            return;
        }
        this.openDrawers.add(path);
        this.closedDrawers.delete(path);
        this.render();
    }

    private closeDrawer(path: string): void {
        this.openDrawers.delete(path);
        if (this.config.get('openAllSketches') === true) this.closedDrawers.add(path);
        const drawer = this.drawers.get(path);
        if (drawer) {
            this.drawers.delete(path);
            this.removeChild(drawer);
        }
        this.render();
    }

    private drawerFor(file: TFile): SketchDrawer {
        const existing = this.drawers.get(file.path);
        if (existing) return existing;
        const drawer = new SketchDrawer(this.plugin, file, this.drawerHost);
        this.drawers.set(file.path, drawer);
        this.addChild(drawer);
        return drawer;
    }

    /** The book a new sketch goes into: the given one, or the one book this table shows. */
    private sketchBook(bookId: string | undefined): BookProfile | null {
        const books = this.plugin.settings.books ?? [];
        if (bookId) return books.find(book => book.id === bookId) ?? null;
        const ids = this.bookIdsInView();
        if (ids.length === 1) return books.find(book => book.id === ids[0]) ?? null;
        // A table with no notes yet is the timeline's book's table, opened from the timeline.
        if (ids.length === 0 && getTimelineScope(this.plugin.settings) === 'book') return getActiveBook(this.plugin.settings);
        return null;
    }

    /**
     * + New sketch: a `Class: Sketch` note in the book's folder (never in
     * Obsidian's new-note location), with the act prefilled from where it was
     * asked for. Its drawer opens with the cursor in it.
     */
    private async createSketch(act: number | null, bookId: string | undefined): Promise<void> {
        const { app, settings } = this.plugin;
        const book = this.sketchBook(bookId);
        if (!book || !book.sourceFolder.trim()) {
            new Notice(t('ui.timetable.newSketchWhichBook'), 6000);
            return;
        }
        const folder = normalizePath(book.sourceFolder);
        const name = t('ui.timetable.newSketchName');
        let path = `${folder}/${name}.md`;
        for (let counter = 2; app.vault.getAbstractFileByPath(path); counter++) path = `${folder}/${name} ${counter}.md`;
        const frontmatter: Record<string, unknown> = { [authorKeyFor('Class', settings)]: 'Sketch' };
        if (act !== null) frontmatter[authorKeyFor('Act', settings)] = act;
        this.openDrawers.add(path);
        this.focusPath = path;
        try {
            await app.vault.create(path, `---\n${stringifyYaml(frontmatter)}---\n\n`);
        } catch (error) {
            this.openDrawers.delete(path);
            this.focusPath = null;
            console.error('[Timetable] Could not create the sketch:', error);
            new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000);
        }
    }

    private toggleGroup(id: string): void {
        if (this.collapsed.has(id)) this.collapsed.delete(id);
        else this.collapsed.add(id);
        this.render();
    }

    onunload(): void {
        clearTimelineLens(this);
        clearTimelineColoring(this);
        if (this.hoveredPath !== null) this.plugin.highlightSceneOnTimeline(null);
        if (this.ringsTimer !== null) window.clearTimeout(this.ringsTimer);
        this.ringsGeneration += 1;
        this.rootEl.remove();
    }

    onDataUpdated(): void {
        this.render();
        this.scheduleRingsRefresh();
    }

    /** Redraw from the current data, and re-read the wheel's ring order. */
    refresh(): void {
        this.render();
        this.scheduleRingsRefresh();
    }

    // ── Data ────────────────────────────────────────────────────────────

    private buildGroups(): TableGroup[] {
        const { app, settings } = this.plugin;
        const authorSorted = this.config.getSort().length > 0;
        const bookFolders = (settings.books ?? []).map(book => book.sourceFolder);
        const toItems = (entries: BasesEntry[]): TableItem[] => {
            const items = entries
                .filter(entry => entry.file.extension === 'md')
                .map(entry => {
                    const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(entry.file)?.frontmatter;
                    return { entry, frontmatter, row: buildTableRow(entry.file.path, entry.file.basename, frontmatter, settings) };
                })
                .filter(item => belongsInTimetable(item.row, bookFolders));
            // A sort the author sets in the Bases toolbar wins; otherwise wheel order.
            return authorSorted ? items : items.sort((a, b) => compareManuscriptRows(a.row, b.row));
        };

        const grouped: BasesEntryGroup[] = this.data.groupedData;
        if (grouped.length === 1 && !grouped[0].hasKey()) {
            return this.splitByBook(toItems(grouped[0].entries));
        }
        return grouped.map((group, index) => {
            const items = toItems(group.entries);
            const act = this.groupAct(group, items);
            const label = act !== undefined ? this.actLabel(act) : (group.hasKey() && group.key ? group.key.toString() : t('ui.timetable.noValue'));
            return { id: `group:${index}:${group.key?.toString() ?? ''}`, label, act, items };
        }).filter(group => group.items.length > 0);
    }

    /** An ungrouped table that spans books (the saga table) groups by book, in saga order. */
    private splitByBook(items: TableItem[]): TableGroup[] {
        const books = this.plugin.settings.books ?? [];
        const bookOf = new Map(items.map(item => [item, getBookIdForPath(books, item.row.path)]));
        const ids = new Set([...bookOf.values()].filter((id): id is string => typeof id === 'string'));
        if (ids.size <= 1) return [{ id: 'all', label: null, items }];
        const order = [...getSagaBooks(this.plugin.settings), ...books];
        const groups: TableGroup[] = [];
        for (const book of order) {
            if (!ids.has(book.id) || groups.some(group => group.id === `book:${book.id}`)) continue;
            groups.push({ id: `book:${book.id}`, label: book.title, items: items.filter(item => bookOf.get(item) === book.id) });
        }
        const outside = items.filter(item => bookOf.get(item) === undefined);
        if (outside.length > 0) groups.push({ id: 'book:none', label: t('ui.timetable.outsideBooks'), items: outside });
        return groups;
    }

    /**
     * The act a group stands for, when it is grouped by Act: every row shares
     * the group's key as its act. Such a group is named the way the timeline
     * names the act. Undefined for any other grouping.
     */
    private groupAct(group: BasesEntryGroup, items: TableItem[]): number | null | undefined {
        if (items.length === 0) return undefined;
        if (!group.hasKey() || !group.key) return items.every(item => item.row.act === null) ? null : undefined;
        const act = Number(group.key.toString());
        return Number.isInteger(act) && items.every(item => item.row.act === act) ? act : undefined;
    }

    private actLabel(act: number | null): string {
        if (act === null) return t('ui.timetable.noAct');
        const labels = parseActLabels(this.plugin.settings, getConfiguredActCount(this.plugin.settings));
        return resolveActLabel(act - 1, labels);
    }

    // ── Wheel ring order ────────────────────────────────────────────────

    private bookIdsInView(): string[] {
        const books = this.plugin.settings.books ?? [];
        const ids = new Set<string>();
        for (const entry of this.data?.data ?? []) {
            const id = getBookIdForPath(books, entry.file.path);
            if (id) ids.add(id);
        }
        return [...ids].sort();
    }

    private scheduleRingsRefresh(): void {
        if (this.ringsTimer !== null) window.clearTimeout(this.ringsTimer);
        const delay = this.rings ? RINGS_REFRESH_DELAY_MS : 0;
        this.ringsTimer = window.setTimeout(() => {
            this.ringsTimer = null;
            void this.loadRings();
        }, delay);
    }

    /** Read the ring order and colors the wheel would draw for the books in this table. */
    private async loadRings(): Promise<void> {
        const generation = ++this.ringsGeneration;
        const ids = this.bookIdsInView();
        const books = (this.plugin.settings.books ?? []).filter(book => ids.includes(book.id));
        const scenes: TimelineItem[] = [];
        for (const [bookIndex, book] of books.entries()) {
            const bookScenes = await this.plugin.getSceneData({ sourcePath: book.sourceFolder });
            scenes.push(...bookScenes.map(scene => ({ ...scene, bookId: book.id, bookIndex })));
        }
        if (generation !== this.ringsGeneration) return;
        const { masterSubplotOrder, colorIndexBySubplot } = computeCacheableValues(this.plugin as unknown as PluginRendererFacade, scenes); // SAFE: the plugin satisfies the renderer facade at runtime; the structural type is narrower than the class
        const next: WheelRings = { key: ids.join('|'), order: masterSubplotOrder, colorIndex: colorIndexBySubplot };
        const changed = !this.rings
            || this.rings.key !== next.key
            || this.rings.order.join('\n') !== next.order.join('\n')
            || [...next.colorIndex].some(([name, index]) => this.rings?.colorIndex.get(name) !== index);
        this.rings = next;
        if (changed) this.render();
    }

    // ── Rendering ───────────────────────────────────────────────────────

    private render(): void {
        if (!this.data) return;
        // Never pull the editor out from under the author mid-sentence.
        if ([...this.drawers.values()].some(drawer => drawer.isEditing())) {
            this.renderDeferred = true;
            return;
        }
        this.renderDeferred = false;
        this.rowEls.clear();
        this.rowItems.clear();
        this.groupHeaderEls.clear();
        this.groupIdForAct.clear();
        this.actDividerEls.clear();
        this.linkedRow = null;
        this.currentRow = null;
        this.synopsisFromBody.clear();
        this.syncLens();
        this.syncColoring();

        const state = this.modeState();
        let groups = this.buildGroups();
        const chronologue = state.mode === 'chronologue' ? this.chronologueContext(groups, state) : null;
        if (chronologue) groups = [chronologue.group];
        const mode: ModeContext = { state, chronologue };

        const scrollParent = this.rootEl.parentElement;
        const scrollTop = scrollParent?.scrollTop ?? 0;
        this.rootEl.empty();
        this.mountPatternDefs();
        this.renderBookNotice(groups);

        const allItems = groups.flatMap(group => group.items);
        if (allItems.length === 0) {
            this.renderNewSketchToolbar();
            this.rootEl.createDiv({ cls: 'ert-timetable__empty', text: t('ui.timetable.empty') });
            this.pruneDrawers(new Set());
            return;
        }

        const showRings = this.config.get('ringsColumn') !== false && this.rings !== null;
        const perLine = Math.min(8, Math.max(3, Math.round(Number(this.config.get('ringsPerLine') ?? RINGS_PER_LINE_DEFAULT)) || RINGS_PER_LINE_DEFAULT));
        const layout = this.rings ? buildRingLayout(this.rings.order, this.rings.colorIndex, allItems.map(item => item.row)) : null;
        const columns = this.columnsFor(mode);
        const columnCount = 1 + (showRings ? 1 : 0) + columns.length;

        const table = this.rootEl.createEl('table', { cls: 'ert-timetable__table' });
        table.toggleClass('is-gossamer', state.mode === 'gossamer');
        // Picked rows that have left the table (filtered out, renamed, deleted) are dropped.
        const present = new Set(allItems.map(item => item.row.path));
        for (const path of [...this.selected]) if (!present.has(path)) this.selected.delete(path);
        table.toggleClass('has-selection', this.selected.size > 0);
        // Fixed widths, like Obsidian's own table: the author's saved sizes, or defaults.
        const sizes = this.columnSizes();
        const colgroup = table.createEl('colgroup');
        let tableWidth = 0;
        const addColumn = (width: number, property?: BasesPropertyId): void => {
            const col = colgroup.createEl('col');
            col.setCssProps({ '--ert-timetable-col-width': `${width}px` });
            if (property) col.dataset.property = property;
            tableWidth += width;
        };
        addColumn(NUMBER_COLUMN_WIDTH);
        if (showRings) addColumn(perLine * 12 + 18);
        for (const column of columns) {
            if (column.kind === 'property') addColumn(sizes[column.property] ?? this.defaultColumnWidth(column.property), column.property);
            else addColumn(MICRO_COLUMN_WIDTH);
        }
        table.setCssProps({ '--ert-timetable-rings-per-line': String(perLine), '--ert-timetable-width': `${tableWidth}px` });

        const headRow = table.createEl('thead').createEl('tr');
        // The corner: + New sketch, the lens, and the mode the table follows. It stays in reach while scrolling.
        this.renderCorner(headRow.createEl('th', { cls: 'ert-timetable__num-head' }), state);
        if (showRings && layout) this.renderRingsHeader(headRow.createEl('th', { cls: 'ert-timetable__rings-head' }), layout);
        for (const column of columns) {
            const header = headRow.createEl('th', { cls: 'ert-timetable__prop-head' });
            if (column.kind === 'property') {
                header.dataset.property = column.property;
                if (this.coloringProperty === column.property) {
                    header.addClass('is-coloring');
                    setIcon(header.createSpan({ cls: 'ert-timetable__coloring-icon' }), 'palette');
                }
                header.createSpan({ cls: 'ert-timetable__prop-label', text: this.config.getDisplayName(column.property) });
                const handle = header.createDiv({ cls: 'ert-timetable__resize' });
                handle.dataset.property = column.property;
            } else {
                header.addClass('is-micro');
                header.setText(column.kind === 'gap' ? t('ui.timetable.colGap') : t('ui.timetable.colRunningTime'));
            }
        }

        const isProgress = state.mode === 'progress';
        const showGroupHeaders = !chronologue && (groups.length > 1 || groups[0].label !== null || isProgress);
        const openDrawers = new Set<string>();
        for (const group of groups) {
            const body = table.createEl('tbody', { cls: 'ert-timetable__group' });
            const collapsed = this.collapsed.has(group.id);
            const groupBook = this.singleBook(group.items);
            if (showGroupHeaders) this.renderGroupHeader(body, group, collapsed, columnCount, groupBook, isProgress);
            if (collapsed) continue;
            const byPath = new Map(group.items.map(item => [item.row.path, item]));
            const lines = chronologue ? chronologue.lines : withActDividers(group.items.map(item => item.row));
            for (const line of lines) {
                if (line.type === 'act') {
                    const divider = body.createEl('tr', { cls: 'ert-timetable__act' });
                    const cell = divider.createEl('td');
                    cell.colSpan = columnCount;
                    cell.createSpan({ text: this.actLabel(line.act) });
                    this.renderNewSketchButton(cell, line.act, groupBook, this.actLabel(line.act));
                    if (line.act !== null) this.actDividerEls.set(line.act, divider);
                    continue;
                }
                if (line.type === 'day') {
                    const cell = body.createEl('tr', { cls: 'ert-timetable__act is-day' }).createEl('td');
                    cell.colSpan = columnCount;
                    cell.setText(line.day ? this.formatWhen(line.day, false, chronologue?.profile ?? null) : t('ui.timetable.noWhen'));
                    continue;
                }
                const item = byPath.get(line.row.path);
                if (!item) continue;
                this.renderRow(body, item, columns, showRings ? layout : null, columnCount, mode);
                if (item.row.kind === 'sketch' && this.drawerIsOpen(item.row.path)) {
                    this.renderDrawer(body, item, layout, columnCount);
                    openDrawers.add(item.row.path);
                }
            }
        }
        this.pruneDrawers(openDrawers);
        this.setCurrentRow(currentNotePath());
        this.markRing(this.ringSpotlight);
        this.renderBulkBar();
        if (scrollParent) scrollParent.scrollTop = scrollTop;
        void this.decorateFromBodies(allItems);
    }

    /** The Base's columns, plus the columns a Chronologue micro-mode adds just after When. */
    private columnsFor(mode: ModeContext): Column[] {
        const columns: Column[] = this.config.getOrder().map(property => ({ kind: 'property', property }));
        if (!mode.chronologue) return columns;
        const added: Column[] = [];
        if (mode.state.shift) added.push({ kind: 'gap' });
        if (mode.state.runtime) added.push({ kind: 'running' });
        if (added.length === 0) return columns;
        const whenIndex = columns.findIndex(column => column.kind === 'property' && this.isWhenColumn(column.property));
        columns.splice(whenIndex + 1, 0, ...added);
        return columns;
    }

    private isWhenColumn(property: BasesPropertyId): boolean {
        const { type, name } = parsePropertyId(property);
        return type === 'note' && this.isWhenProperty(name);
    }

    /** The one book a set of rows belongs to, if there is exactly one. */
    private singleBook(items: TableItem[]): string | undefined {
        const books = this.plugin.settings.books ?? [];
        const ids = new Set(items.map(item => getBookIdForPath(books, item.row.path)));
        if (ids.size !== 1) return undefined;
        const [id] = [...ids];
        return id;
    }

    /** The table's control corner: + New sketch, the lens, and the mode the table follows. */
    private renderCorner(cell: HTMLElement, state: TimelineModeState): void {
        const corner = cell.createDiv({ cls: 'ert-timetable__corner' });
        const add = corner.createEl('button', { cls: 'ert-timetable__new-sketch clickable-icon' });
        add.setAttr('aria-label', t('ui.timetable.newSketch'));
        setIcon(add, 'plus');
        tooltip(add, t('ui.timetable.newSketch'), 'bottom');

        const lensOn = currentTimelineLens()?.owner === this;
        const lens = corner.createEl('button', { cls: 'ert-timetable__lens-toggle clickable-icon' });
        lens.toggleClass('is-active', lensOn);
        lens.setAttr('aria-pressed', String(lensOn));
        lens.setAttr('aria-label', t('ui.timetable.optionLens'));
        setIcon(lens, 'scan-eye');
        tooltip(lens, lensOn ? t('ui.timetable.lensOn') : t('ui.timetable.lensOff'), 'bottom');

        const modeButton = corner.createEl('button', { cls: 'ert-timetable__mode clickable-icon' });
        modeButton.toggleClass('is-pinned', this.modePin !== null);
        modeButton.setAttr('aria-haspopup', 'menu');
        modeButton.setAttr('aria-label', this.modeTooltip(state));
        setIcon(modeButton, modeIcon(state.mode));
        tooltip(modeButton, this.modeTooltip(state), 'bottom');

        if (this.keyButton) corner.appendChild(this.keyButton);
    }

    /**
     * The ✱ key: the table's marks, clicks and corner buttons, as the timeline
     * has its own. The button moves into each redrawn corner; the panel hangs
     * from the window, so a short table pane never clips it.
     */
    private setUpKey(): void {
        const button = this.rootEl.createEl('button', {
            cls: 'ert-timeline-legend__trigger ert-timetable__key clickable-icon',
            // No aria-label: Obsidian would show it as a second tooltip over the key panel,
            // matching the timeline's own ✱ trigger.
            attr: { type: 'button', 'aria-expanded': 'false' },
        });
        button.detach();
        setIcon(button, 'asterisk');
        const panel = this.rootEl.doc.body.createDiv({ cls: 'ert-timeline-legend ert-timeline-legend--compact ert-timetable-key', attr: { role: 'tooltip' } });
        this.register(() => panel.remove());
        wireLegendTrigger(this, button, panel, () => this.fillKey(button, panel));
        this.keyButton = button;
    }

    private fillKey(button: HTMLElement, panel: HTMLElement): void {
        const state = this.modeState();
        renderLegendSurface(panel, { title: t('ui.timetable.keyTitle'), badge: modeName(state.mode), sections: this.keySections(state) });
        // Just below the button, inside the window.
        const box = button.getBoundingClientRect();
        const win = button.win;
        const width = Math.min(360, win.innerWidth - 32);
        const left = Math.max(8, Math.min(box.left, win.innerWidth - width - 8));
        const top = box.bottom + 6;
        panel.setCssProps({
            '--ert-key-top': `${top}px`,
            '--ert-key-left': `${left}px`,
            '--ert-key-max-height': `${Math.max(160, win.innerHeight - top - 12)}px`,
        });
    }

    private keySections(state: TimelineModeState): LegendSection[] {
        const stage = this.plugin.settings.publishStageColors;
        const modeSection = this.keyModeSection(state);
        return [
            ...(modeSection ? [modeSection] : []),
            {
                title: t('ui.timetable.keyRows'),
                rows: [
                    { swatch: { fill: stage.Press, stroke: stage.Press, text: '12', textColor: 'var(--rt-legacy-black)' }, label: t('ui.timetable.keyScene'), detail: t('ui.timetable.keySceneDetail') },
                    { swatch: { fill: 'transparent', stroke: 'var(--text-muted)', text: '–', textColor: 'var(--text-muted)', dashed: true }, label: t('ui.timetable.keySketch'), detail: t('ui.timetable.keySketchDetail') },
                    { swatch: { fill: 'transparent', stroke: 'var(--text-faint)', text: '–', textColor: 'var(--text-faint)' }, label: t('ui.timetable.keyNote'), detail: t('ui.timetable.keyNoteDetail') },
                    { rings: ['var(--rt-subplot-colors-0)', 'var(--rt-subplot-colors-1)', null], label: t('ui.timetable.keyRings'), detail: t('ui.timetable.keyRingsDetail') },
                    { icon: 'message-circle-question', label: t('ui.timetable.keyQueries'), detail: t('ui.timetable.keyQueriesDetail') },
                    { icon: 'file-up', label: t('ui.timetable.keyPromote'), detail: t('ui.timetable.keyPromoteDetail') },
                ],
            },
            {
                title: t('ui.timetable.keyClicks'),
                rows: [
                    { icon: 'mouse-pointer-click', label: t('ui.timetable.keyClick'), detail: t('ui.timetable.keyClickDetail') },
                    { icon: 'command', label: Platform.isMacOS ? t('ui.timetable.keyModClickMac') : t('ui.timetable.keyModClick'), detail: t('ui.timetable.keyModClickDetail') },
                    { icon: 'arrow-big-up', label: t('ui.timetable.keyShiftClick'), detail: t('ui.timetable.keyShiftClickDetail') },
                    { icon: 'mouse', label: t('ui.timetable.keyRightClick'), detail: t('ui.timetable.keyRightClickDetail') },
                    { icon: 'chevron-down', label: t('ui.timetable.keyPick'), detail: t('ui.timetable.keyPickDetail') },
                    { icon: 'square-check', label: t('ui.timetable.keyCheckboxes'), detail: t('ui.timetable.keyCheckboxesDetail') },
                    { icon: 'square-mouse-pointer', label: t('ui.timetable.keyHover'), detail: t('ui.timetable.keyHoverDetail') },
                ],
            },
            {
                title: t('ui.timetable.keyCorner'),
                rows: [
                    { icon: 'plus', label: t('ui.timetable.keyNewSketch'), detail: t('ui.timetable.keyNewSketchDetail') },
                    { icon: 'scan-eye', label: t('ui.timetable.keyLens'), detail: t('ui.timetable.keyLensDetail') },
                    { icon: modeIcon(this.modeState().mode), label: t('ui.timetable.keyMode'), detail: t('ui.timetable.keyModeDetail') },
                ],
            },
        ];
    }

    /** What the mode the table follows changes in it; Narrative changes nothing to explain. */
    private keyModeSection(state: TimelineModeState): LegendSection | null {
        const title = modeName(state.mode);
        if (state.mode === 'chronologue') {
            const rows = [{ icon: 'calendar-days', label: t('ui.timetable.keyDayDividers'), detail: t('ui.timetable.keyDayDividersDetail') }];
            if (state.shift) rows.push({ icon: 'arrow-left-right', label: t('ui.timetable.colGap'), detail: t('ui.timetable.keyGapDetail') });
            if (state.runtime) rows.push({ icon: 'timer', label: t('ui.timetable.colRunningTime'), detail: t('ui.timetable.keyRunningDetail') });
            if (state.alt) rows.push({ icon: 'orbit', label: t('ui.timetable.keyAlt'), detail: t('ui.timetable.keyAltDetail') });
            return { title, rows };
        }
        if (state.mode === 'progress') {
            return {
                title,
                rows: [
                    { icon: 'gauge', label: t('ui.timetable.keyActHeader'), detail: t('ui.timetable.keyActHeaderDetail') },
                    { icon: 'calendar-x', label: t('ui.timetable.keyOverdue'), detail: t('ui.timetable.keyOverdueDetail') },
                ],
            };
        }
        if (state.mode === 'gossamer') {
            return {
                title,
                rows: [
                    { icon: 'activity', label: t('ui.timetable.keyBeatsForward'), detail: t('ui.timetable.keyBeatsForwardDetail') },
                    { swatch: { fill: 'var(--background-modifier-hover)', stroke: 'var(--background-modifier-border)', text: '72', textColor: 'var(--text-normal)' }, label: t('ui.timetable.keyScore'), detail: t('ui.timetable.keyScoreDetail') },
                ],
            };
        }
        return null;
    }

    /** An empty table has no header row, so + New sketch sits above the message. */
    private renderNewSketchToolbar(): void {
        const toolbar = this.rootEl.createDiv({ cls: 'ert-timetable__toolbar' });
        const button = toolbar.createEl('button', { cls: 'ert-timetable__new-sketch' });
        setIcon(button.createSpan({ cls: 'ert-timetable__new-sketch-icon' }), 'plus');
        button.createSpan({ text: t('ui.timetable.newSketch') });
    }

    /** A small + that creates a sketch in this act (and this book). */
    private renderNewSketchButton(container: HTMLElement, act: number | null | undefined, bookId: string | undefined, label: string): void {
        if (!bookId) return;
        const button = container.createEl('button', { cls: 'ert-timetable__new-sketch ert-timetable__new-sketch--inline clickable-icon' });
        if (act !== undefined && act !== null) button.dataset.act = String(act);
        button.dataset.bookId = bookId;
        button.setAttr('aria-label', t('ui.timetable.newSketchIn', { group: label }));
        setIcon(button, 'plus');
        tooltip(button, t('ui.timetable.newSketchIn', { group: label }), 'right');
    }

    private renderDrawer(body: HTMLElement, item: TableItem, layout: RingLayout | null, columnCount: number): void {
        const drawer = this.drawerFor(item.entry.file);
        const cell = body.createEl('tr', { cls: 'ert-timetable__drawer-row' }).createEl('td');
        cell.colSpan = columnCount;
        cell.appendChild(drawer.el);
        drawer.renderBar(item.row, item.frontmatter, layout);
        if (this.focusPath === item.row.path) {
            this.focusPath = null;
            drawer.focusEditor();
        }
    }

    /** Close drawers whose sketch has gone (promoted, deleted, filtered out) or been closed. */
    private pruneDrawers(keep: Set<string>): void {
        for (const [path, drawer] of [...this.drawers]) {
            if (keep.has(path)) continue;
            this.drawers.delete(path);
            this.removeChild(drawer);
        }
    }

    /**
     * Fill in what only the note text knows: each row's open author queries
     * (`%%query: …%%`), and a sketch's first line when its Synopsis is empty.
     */
    private async decorateFromBodies(items: TableItem[]): Promise<void> {
        const generation = ++this.decorateGeneration;
        for (const item of items) {
            if (item.row.kind === 'beat' || item.row.kind === 'otherClass') continue;
            const content = await this.plugin.app.vault.cachedRead(item.entry.file);
            if (generation !== this.decorateGeneration) return;
            const info = getFrontMatterInfo(content);
            const body = content.slice(info.exists ? info.contentStart : 0);
            const queries = listAuthorQueries(body);
            const numberCell = this.rowEls.get(item.row.path)?.querySelector<HTMLElement>('.ert-timetable__num-inner');
            if (queries.length > 0 && numberCell) {
                const badge = numberCell.createSpan({ cls: 'ert-timetable__queries' });
                setIcon(badge.createSpan({ cls: 'ert-timetable__queries-icon' }), 'message-circle-question');
                badge.createSpan({ text: String(queries.length) });
                tooltip(badge, t('ui.timetable.queries', { count: queries.length, list: queries.slice(0, 3).join(' · ') }), 'right');
            }
            const synopsisCell = this.synopsisFromBody.get(item.row.path);
            const firstLine = body.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0);
            if (synopsisCell && firstLine) {
                synopsisCell.addClass('is-from-body');
                synopsisCell.setText(firstLine.replace(/^#+\s*/, ''));
            }
        }
    }

    /** The wheel's Working and Todo patterns, under this table's own ID prefix. */
    private mountPatternDefs(): void {
        const { settings } = this.plugin;
        const defs = renderDefs(settings.publishStageColors, 0.5, false, settings.workingPatternId, settings.customWorkingPatterns, this.patternPrefix);
        const host = this.rootEl.createDiv({ cls: 'ert-timetable__defs' });
        mountSvgMarkup(host, `<svg xmlns="${SVG_NS}" width="0" height="0" aria-hidden="true"><defs>${defs}</defs></svg>`);
    }

    /** When this table shows one book and the timeline another, say so, with a way to line them up. */
    private renderBookNotice(groups: TableGroup[]): void {
        const { settings } = this.plugin;
        if (getTimelineScope(settings) !== 'book') return;
        const active = getActiveBook(settings);
        const ids = this.bookIdsInView();
        const showsOtherBook = active !== null && groups.length > 0 && ids.length === 1 && ids[0] !== active.id;
        if (!showsOtherBook) return;
        const shown = (settings.books ?? []).find(book => book.id === ids[0]);
        if (!shown) return;
        const notice = this.rootEl.createDiv({ cls: 'ert-timetable__notice' });
        notice.createSpan({ text: t('ui.timetable.bookMismatch', { table: shown.title, timeline: active.title }) });
        const button = notice.createEl('button', { text: t('ui.timetable.showOnTimeline', { book: shown.title }) });
        button.dataset.bookId = shown.id;
    }

    private renderGroupHeader(body: HTMLElement, group: TableGroup, collapsed: boolean, columnCount: number, bookId: string | undefined, progress: boolean): void {
        const row = body.createEl('tr', { cls: 'ert-timetable__group-head' });
        this.groupHeaderEls.set(group.id, row);
        if (typeof group.act === 'number') this.groupIdForAct.set(group.act, group.id);
        const cell = row.createEl('td');
        cell.colSpan = columnCount;
        // One flex line, so the label, the progress numbers and + share a center line.
        const line = cell.createDiv({ cls: 'ert-timetable__group-line' });
        const toggle = line.createDiv({ cls: 'ert-timetable__group-toggle' });
        toggle.setAttr('role', 'button');
        toggle.setAttr('tabindex', '0');
        toggle.setAttr('aria-expanded', String(!collapsed));
        setIcon(toggle.createSpan({ cls: 'ert-timetable__group-chevron' }), collapsed ? 'chevron-right' : 'chevron-down');
        toggle.createSpan({ cls: 'ert-timetable__group-label', text: group.label ?? t('ui.timetable.allNotes') });
        toggle.createSpan({ cls: 'ert-timetable__group-count', text: String(group.items.length) });
        toggle.dataset.groupId = group.id;
        // Progress: the numbers the wheel shows only as color.
        if (progress) {
            const stats = groupProgress(group.items, this.plugin.settings);
            if (stats.scenes > 0) {
                const summary = line.createSpan({ cls: 'ert-timetable__progress' });
                summary.createSpan({
                    text: t('ui.timetable.progressStats', {
                        complete: stats.complete,
                        scenes: stats.scenes,
                        words: stats.words.toLocaleString(getFormattingLocale()),
                    }),
                });
                if (stats.overdue > 0) summary.createSpan({ cls: 'ert-timetable__progress-overdue', text: t('ui.timetable.progressOverdue', { count: stats.overdue }) });
            }
        }
        // An act group, or a book group in the saga table, can take a new sketch.
        if (group.act !== undefined || group.id.startsWith('book:')) this.renderNewSketchButton(line, group.act, bookId, group.label ?? '');
    }

    private renderRow(body: HTMLElement, item: TableItem, columns: Column[], layout: RingLayout | null, columnCount: number, mode: ModeContext): void {
        const { row, frontmatter } = item;
        const tr = body.createEl('tr', { cls: ['ert-timetable__row', `is-${row.kind === 'otherClass' ? 'other-class' : row.kind}`] });
        tr.setAttr('data-path', row.path);
        this.rowEls.set(row.path, tr);
        this.rowItems.set(row.path, item);
        // Gossamer: beats come forward, everything else recedes.
        const gossamer = mode.state.mode === 'gossamer';
        if (gossamer && row.kind !== 'beat') tr.addClass('is-receded');
        this.renderNumberCell(tr.createEl('td', { cls: 'ert-timetable__num' }).createDiv({ cls: 'ert-timetable__num-inner' }), item);

        if (row.kind === 'beat') {
            // Beats run across the table as quiet dividers, as on the wheel.
            const cell = tr.createEl('td', { cls: 'ert-timetable__beat' });
            cell.colSpan = columnCount - 1;
            cell.createSpan({ cls: 'ert-timetable__beat-title', text: displayName(row.basename) });
            const model = firstText(frontmatterKey(frontmatter, 'Beat Model'));
            if (model) cell.createSpan({ cls: 'ert-timetable__beat-model', text: model });
            const score = gossamer ? this.renderGossamerScore(cell, frontmatter) : null;
            // In Gossamer, the score's justification says more than the beat's Purpose.
            const purpose = score?.justification ?? readBeatPurpose(frontmatter ?? null);
            if (purpose) cell.createSpan({ cls: 'ert-timetable__beat-purpose', text: purpose });
        } else {
            if (layout) this.renderRingsCell(tr.createEl('td', { cls: 'ert-timetable__rings' }), row, layout);
            for (const column of columns) {
                const cell = tr.createEl('td');
                if (column.kind === 'property') this.renderValueCell(cell, item, column.property, mode);
                else this.renderMicroCell(cell, row, column.kind, mode.chronologue);
            }
        }
    }

    private renderNumberCell(cell: HTMLElement, item: TableItem): void {
        const { row, frontmatter } = item;
        // Pick rows for a bulk edit; other rows keep the space so numbers line up.
        if (SELECTABLE_KINDS.has(row.kind)) {
            const checkbox = cell.createEl('input', { cls: 'ert-timetable__select', type: 'checkbox' });
            checkbox.checked = this.selected.has(row.path);
            tooltip(checkbox, t('ui.timetable.bulkPick', { name: displayName(row.basename) }), 'right');
            cell.closest('tr')?.toggleClass('is-selected', checkbox.checked);
        } else {
            cell.createSpan({ cls: 'ert-timetable__select-spacer' });
        }
        if (row.kind === 'sketch') {
            const open = this.drawerIsOpen(row.path);
            const toggle = cell.createEl('button', { cls: 'ert-timetable__drawer-toggle clickable-icon' });
            toggle.setAttr('aria-expanded', String(open));
            toggle.setAttr('aria-label', t('ui.timetable.toggleSketch'));
            setIcon(toggle, open ? 'chevron-down' : 'chevron-right');
        }
        const chip = cell.createDiv({ cls: 'ert-timetable__chip' });
        const svg = chip.createSvg('svg', { attr: { viewBox: '0 0 40 22', width: '40', height: '22', 'aria-hidden': 'true' } });
        const rect = svg.createSvg('rect', { cls: 'ert-timetable__chip-cell', attr: { x: '1', y: '1', width: '38', height: '20', rx: '3' } });
        if (row.kind === 'scene') rect.setAttribute('fill', sceneNumberFill(frontmatter, this.plugin.settings, this.patternPrefix));
        const label = svg.createSvg('text', {
            cls: 'ert-timetable__chip-text',
            attr: { x: '20', y: '11.5', 'text-anchor': 'middle', 'dominant-baseline': 'central' },
        });
        label.textContent = row.prefix ?? '–';
        tooltip(chip, this.chipTooltip(row, frontmatter), 'right');
        if (row.kind === 'scene') {
            chip.addClass('ert-timetable__pick');
            chip.dataset.pick = 'status';
            chip.setAttr('role', 'button');
            chip.setAttr('aria-haspopup', 'menu');
        }

        if (row.kind === 'sketch' || row.kind === 'unclassed') {
            const promote = cell.createEl('button', { cls: 'ert-timetable__promote clickable-icon' });
            promote.setAttr('aria-label', t('ui.timetable.promote'));
            setIcon(promote, 'file-up');
            tooltip(promote, t('ui.timetable.promote'), 'right');
        }
    }

    private chipTooltip(row: TimetableRow, frontmatter: Record<string, unknown> | undefined): string {
        switch (row.kind) {
            case 'scene': {
                const status = normalizeStatus(frontmatterKey(frontmatter, 'Status'));
                const stage = firstText(frontmatterKey(frontmatter, 'Publish Stage')) || 'Zero';
                const due = frontmatterKey(frontmatter, 'Due');
                const overdue = status !== 'Completed' && typeof due === 'string' && isOverdueDateString(due);
                const label = overdue ? t('ui.timetable.statusOverdue') : (status === 'Completed' ? 'Complete' : (status || 'Todo'));
                return t('ui.timetable.sceneStatus', { status: label, stage });
            }
            case 'beat': return t('ui.timetable.beatRow');
            case 'sketch': return t('ui.timetable.sketchRow');
            case 'unclassed': return t('ui.timetable.unclassedRow');
            case 'otherClass': return t('ui.timetable.otherClassRow', { className: row.className ?? '' });
        }
    }

    private renderRingsHeader(cell: HTMLElement, layout: RingLayout): void {
        const grid = cell.createDiv({ cls: 'ert-timetable__ring-grid' });
        layout.order.forEach(name => {
            const square = grid.createSpan({ cls: 'ert-timetable__ring is-member' });
            square.setCssProps({ '--ert-timetable-ring': `var(--rt-subplot-colors-${layout.colorIndex.get(name) ?? 0})` });
        });
        const names = layout.order.map((name, index) => layout.offWheel.has(name)
            ? t('ui.timetable.ringOffWheel', { number: index + 1, name })
            : `${index + 1}. ${name}`);
        tooltip(grid, t('ui.timetable.ringsHeader', { list: names.join(' · ') }), 'bottom');
    }

    private renderRingsCell(cell: HTMLElement, row: TimetableRow, layout: RingLayout): void {
        const grid = cell.createDiv({ cls: 'ert-timetable__ring-grid' });
        const members = new Set(row.subplots);
        // Scenes are in their rings; sketches and unclassed notes only plan to be.
        const memberClass = row.kind === 'scene' ? 'is-member' : 'is-planned';
        for (const name of layout.order) {
            const square = grid.createSpan({ cls: 'ert-timetable__ring' });
            if (!members.has(name)) continue;
            square.addClass(memberClass);
            square.setCssProps({ '--ert-timetable-ring': `var(--rt-subplot-colors-${layout.colorIndex.get(name) ?? 0})` });
        }
        const list = layout.order.filter(name => members.has(name)).join(', ');
        const text = list.length === 0
            ? t('ui.timetable.ringsNone')
            : (row.kind === 'scene' ? t('ui.timetable.ringsIn', { list }) : t('ui.timetable.ringsPlanned', { list }));
        tooltip(grid, text, 'right');
    }

    /** Shift's gap since the previous dated row, or Runtime's running time. */
    private renderMicroCell(cell: HTMLElement, row: TimetableRow, kind: 'gap' | 'running', chronologue: ChronologueContext | null): void {
        cell.addClass('ert-timetable__micro');
        if (!chronologue) return;
        if (kind === 'gap') {
            const gap = chronologue.gap.get(row.path);
            if (typeof gap !== 'number') return;
            const text = chronologue.profile ? formatElapsedTimePlanetary(gap, chronologue.profile) : formatElapsedTime(gap);
            cell.setText(`+${text}`);
            return;
        }
        const total = chronologue.running.get(row.path);
        if (row.kind === 'scene' && typeof total === 'number' && total > 0) cell.setText(formatRuntimeValue(total));
    }

    /** Gossamer: a beat's latest score for the selected signal, its change, and its expected range. */
    private renderGossamerScore(cell: HTMLElement, frontmatter: Record<string, unknown> | undefined): { justification?: string } | null {
        const badge = cell.createSpan({ cls: 'ert-timetable__gossamer' });
        const latest = latestGossamerScore(frontmatter ?? {}, this.plugin.gossamerSelectedSignal);
        if (!latest) {
            badge.addClass('is-empty');
            badge.setText(t('ui.timetable.gossamerNotScored'));
            return null;
        }
        badge.createSpan({ cls: 'ert-timetable__gossamer-score', text: String(latest.score) });
        if (latest.previous !== undefined && latest.previous !== latest.score) {
            const delta = latest.score - latest.previous;
            badge.createSpan({ cls: ['ert-timetable__gossamer-delta', delta > 0 ? 'is-up' : 'is-down'], text: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` });
        }
        const range = parseRange(firstText(frontmatterKey(frontmatter, 'Range')));
        if (range) {
            badge.createSpan({ cls: 'ert-timetable__gossamer-range', text: t('ui.timetable.gossamerRange', { min: range.min, max: range.max }) });
            badge.toggleClass('is-out-of-range', !isScoreInRange(latest.score, range));
        }
        return latest;
    }

    private renderValueCell(cell: HTMLElement, item: TableItem, property: BasesPropertyId, mode: ModeContext): void {
        const { entry, frontmatter, row } = item;
        const { type, name } = parsePropertyId(property);
        if (type === 'file' && name === 'name') {
            cell.addClass('ert-timetable__name');
            cell.setText(displayName(entry.file.basename));
            return;
        }
        if (type === 'note' && this.isWhenProperty(name)) {
            const raw = frontmatterKey(frontmatter, name);
            const text = typeof raw === 'string' ? raw.trim() : '';
            const when = text ? parseWhenField(text) : null;
            cell.addClass('ert-timetable__when');
            cell.setText(when ? this.formatWhen(when, whenTextHasClock(text), mode.chronologue?.profile ?? null) : text);
            return;
        }
        const value = entry.getValue(property);
        const empty = !value || !value.isTruthy();
        if (!empty) value.renderTo(cell, this.plugin.app.renderContext);
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        const canonical = type === 'note' ? canonicalizeFrontmatterKey(name, mappings) : '';
        // Status, Publish Stage and Act have fixed values: a click offers them. Beats and other classes are left alone.
        if (PICKABLE_PROPERTIES.has(canonical) && row.kind !== 'otherClass' && (canonical === 'Act' || row.kind === 'scene')) {
            cell.addClass('ert-timetable__pick');
            cell.dataset.pick = canonical;
            setIcon(cell.createSpan({ cls: 'ert-timetable__pick-icon' }), 'chevron-down');
        }
        // Progress: an overdue scene's Due stands out.
        if (mode.state.mode === 'progress' && canonical === 'Due' && row.kind === 'scene') {
            const due = frontmatterKey(frontmatter, name);
            const complete = normalizeStatus(frontmatterKey(frontmatter, 'Status')) === 'Completed';
            cell.toggleClass('is-overdue', !complete && typeof due === 'string' && isOverdueDateString(due));
        }
        // A sketch without a Synopsis shows its first line of text instead.
        if (empty && row.kind === 'sketch' && canonical === 'Synopsis') {
            this.synopsisFromBody.set(row.path, cell);
        }
    }

    /** The When column, under the author's own key name when they mapped one. */
    private isWhenProperty(name: string): boolean {
        if (name.toLowerCase() === 'when') return true;
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        return mappings?.[name] === 'When';
    }
}
