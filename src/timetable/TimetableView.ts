import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { readTimeReferences, referenceDateLabel, TIME_REFERENCES_KEY, type TimeReference } from '../chronologue/timeReferences/model';
import { manageTimeReferences, openTimeReference } from '../chronologue/timeReferences/editor';
import { currentReferenceSelection, hoverTimeReference, onReferenceSelection, pinTimeReference } from '../chronologue/timeReferences/selection';
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
    Component,
    Keymap,
    Menu,
    Notice,
    Platform,
    TFile,
    getFrontMatterInfo,
    normalizePath,
    parsePropertyId,
    parseYaml,
    setIcon,
    stringifyYaml,
    type App,
    type BasesAllOptions,
    type BasesEntry,
    type BasesEntryGroup,
    type BasesPropertyId,
    type QueryController,
    type WorkspaceLeaf,
} from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { TimelineItem } from '../types';
import { getFormattingLocale, t, tCount } from '../i18n';
import { getActiveBook, getBookIdForPath, getSagaBooks, getTimelineScope } from '../utils/books';
import { getConfiguredActCount, parseActLabels, resolveActLabel } from '../utils/acts';
import { canonicalizeFrontmatterKey, getActiveFrontmatterMappings, readBeatPurpose } from '../utils/frontmatter';
import { listAuthorQueries } from '../utils/authorQueryComments';
import { formatElapsedTime, parseLocalDateKey, parseWhenField } from '../utils/date';
import { formatCompactDuration, formatDueLabel, formatLongDate, formatSceneWhen, formatTableWhen, whenTextHasClock } from '../utils/whenFormat';
import { normalizeStatus } from '../utils/text';
import { isOverdueDateString } from '../utils/date';
import { safeTitle, splitNumberPrefix } from '../utils/noteTitle';
import { confirmWithErtModal } from '../modals/ErtConfirmModal';
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
    dueStatus,
    dueStepNeedsConfirm,
    elapsedSincePrevious,
    filterSignature,
    groupProgress,
    medianOf,
    narrowColoring,
    planConfiguredColoring,
    MAX_COLOR_VALUES,
    type SavedColoring,
    readRuntimeSeconds,
    readSavedColoring,
    readWhen,
    runningTotals,
    sceneNumberFill,
    sceneVitals,
    steppedDue,
    toggledPicks,
    withActDividers,
    withDayDividers,
    wordBar,
    type DueStatus,
    type RingLayout,
    type TimetableLine,
    type TimetableRow,
} from './timetableModel';
import { authorKeyFor, countColumnFill, tableColumns, TIMETABLE_VIEW_TYPE, withRecommendedColumns } from './timetableFiles';
import { SketchDrawer, type SketchDrawerHost } from './SketchDrawer';
import { synopsisKey, updateSynopsis } from './panelSynopsis';
import { leadPortrait } from './panelPortrait';
import { timetableNarrativeOrder } from './timetablePlacement';
import { OuterRingDragController } from '../view/interactions/OuterRingDragController';
import { ChronologueDragController } from '../view/interactions/ChronologueDragController';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { coloringDateLabel } from './coloringDates';
import { TimetableColoringModal } from './TimetableColoringModal';
import { CellPeek } from './cellPeek';
import { beatNamePeekAction } from '../view/interactions/BeatNameKeyController';
import { isTypingInField } from '../utils/domFocus';
import { basesViewFilters } from '../utils/obsidianInternals';
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

/**
 * Column widths (px). The number column fits what its rows hold (the number,
 * the vitals or a sketch's controls, query counts) once the table is laid out;
 * this is its width until then.
 */
const NUMBER_COLUMN_WIDTH = 150;
const OTHER_COLUMN_WIDTH = 140;
const MIN_COLUMN_WIDTH = 48;
/** A fitted column is never wider than this; the note holds the rest. */
const MAX_FITTED_WIDTH = 300;
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = { When: 220, Duration: 100, Chapter: 150, Synopsis: 360, Act: 56 };
const NAME_COLUMN_WIDTH = 220;
/** Long text keeps its width: fitted, it would only grow to the cap or shrink to ellipses. */
const LONG_TEXT_COLUMNS = new Set(['Synopsis', 'Summary', 'Pending Edits']);

/** Lucide icons for the template's columns (canonical keys). The author's own fields have none. */
const COLUMN_ICONS: Record<string, string> = {
    When: 'calendar-clock',
    Duration: 'hourglass',
    Character: 'users',
    Place: 'map-pin',
    POV: 'eye',
    Due: 'calendar-check',
    Words: 'pilcrow',
    Runtime: 'timer',
    Iteration: 'repeat',
    Chapter: 'book-open',
    Synopsis: 'align-left',
};

function clampFittedWidth(width: number): number {
    return Math.min(MAX_FITTED_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.ceil(width)));
}

/** The width of an element's laid-out contents, clipped or not. 0 when nothing is laid out. */
function contentWidth(element: HTMLElement): number {
    const range = element.doc.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width;
}

function horizontalPadding(element: HTMLElement): number {
    const style = element.win.getComputedStyle(element);
    return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
}

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
    header: HTMLElement;
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

/** A table column: one of the Base's properties, or a column a micro-mode adds. */
type Column =
    | { kind: 'property'; property: BasesPropertyId }
    | { kind: 'gap' }
    | { kind: 'running' };

/** What Chronologue order computes for the rows: story order and gaps (Shift). */
interface ChronologueContext {
    group: TableGroup;
    lines: TimetableLine[];
    gap: Map<string, number | null>;
    /** The planetary calendar, when Alt is on and a profile is active. */
    profile: PlanetaryProfile | null;
}

/** The mode the table is drawn in, and what that mode computed. */
interface ModeContext {
    state: TimelineModeState;
    chronologue: ChronologueContext | null;
    /** Narrative's runtime view: the running time through each row, in the table's order. */
    running: Map<string, number> | null;
}

/** What the cells of one draw share. */
interface CellContext {
    mode: ModeContext;
    /** The year every When shares, shown once in the header; null when they span years, so each cell shows its own. */
    whenYear: number | null;
    /** The When cell shows the Duration while the Duration column is hidden. */
    durationInWhen: boolean;
    /** The median Words of each book's scenes, by book id ('' outside every book). */
    wordMedians: Map<string, number>;
    today: Date;
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
async function openFromTimetable(app: App, file: TFile, evt: MouseEvent | undefined, fromEl: HTMLElement): Promise<void> {
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
    /** A sketch just created or renamed here: open its drawer and put the cursor in its title or its text. */
    private focusPath: string | null = null;
    private focusField: 'title' | 'text' = 'text';
    /** Widths fitted to columns the author hasn't sized. Not saved; while the table is open they only grow, so a column doesn't twitch during an edit. */
    private readonly autoWidths = new Map<BasesPropertyId, number>();
    /** The number column's fitted width, kept across redraws. */
    private numberWidth: number | null = null;
    /** Shift-hover: the full text of a cut-off cell. */
    private peek: CellPeek | null = null;
    /** The row and column under the pointer, so the peek finds its cell again after a redraw. */
    private peekKey: { path: string; column: string } | null = null;
    /** The Synopsis or Pending Edits icon under the pointer, so Shift can switch the Synopsis to the Summary. */
    private peekControl: HTMLElement | null = null;
    /** A redraw that waited for the author to stop typing in a drawer. */
    private renderDeferred = false;
    private panelEditing: { path: string; original: unknown } | null = null;
    private panelEvents: Component | null = null;
    private draggedScene: string | null = null;
    private scenePlacementInProgress = false;
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
    /** The lens toggle was just pressed here (or a filter set), so this table takes the lens from any other. */
    private claimLens = false;
    /** This view's own filter (signature), or null when it has none. Not saved. */
    private viewFilter: string | null = null;
    /** The filter the author turned the lens off for; the automatic lens stays off until the filter changes. */
    private lensDismissedFor: string | null = null;
    /** The column this table is coloring the timeline by right now, if any. The choice is saved with the view. */
    private coloringProperty: BasesPropertyId | null = null;
    private claimColoring = false;
    /** While names are picked in the timeline's color key, the scenes that list them all; null otherwise. */
    private pickedPaths: Set<string> | null = null;
    /** Rows picked for a bulk edit, by path. Not saved. */
    private readonly selected = new Set<string>();
    private lastToggled: string | null = null;
    private readonly rowItems = new Map<string, TableItem>();
    private readonly expandedReferences = new Set<string>();
    private readonly groupHeaderEls = new Map<string, HTMLElement>();
    private readonly groupIdForAct = new Map<number, string>();
    private readonly actDividerEls = new Map<number, HTMLElement>();
    private readonly drawerHost: SketchDrawerHost = {
        promote: file => { void runPromotion(this.plugin, [file]); },
        openNote: (file, evt) => { void openFromTimetable(this.plugin.app, file, evt, this.rootEl); },
        close: path => this.closeDrawer(path),
        rename: (file, title) => { void this.renameSketch(file, title); },
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
        this.register(onReferenceSelection(selection => {
            if (selection?.reveal && this.rowEls.has(selection.path) && !this.expandedReferences.has(selection.path)) {
                this.expandedReferences.add(selection.path); this.render();
            }
            this.markLinkedRow(selection?.path ?? null, null, false);
            this.rootEl.querySelectorAll<HTMLElement>('.ert-time-reference-row').forEach(row =>
                row.toggleClass('is-reference-selected', row.dataset.referenceKey === selection?.key));
        }));
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
        // Double-click a resize handle to fit its column to what it holds.
        this.registerDomEvent(this.rootEl, 'dblclick', (evt: MouseEvent) => {
            const handle = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__resize') : null;
            const property = handle?.dataset.property as BasesPropertyId | undefined;
            if (!property || !this.isFittable(property)) return;
            evt.preventDefault();
            this.fitColumns([property]);
        });
        // A renamed note keeps its open drawer, its pick and its expanded references.
        this.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => this.followRename(file.path, oldPath)));
        // Shift-hover: read a cut-off cell in full.
        this.peek = new CellPeek(this.rootEl.doc);
        this.register(() => this.peek?.destroy());
        this.registerDomEvent(this.rootEl, 'mouseover', (evt: MouseEvent) => this.hoverPeek(evt.target, evt.shiftKey));
        this.registerDomEvent(this.rootEl, 'mouseleave', () => this.hoverPeek(null, false));
        this.registerDomEvent(this.rootEl.win, 'keydown', (evt: KeyboardEvent) => this.peekKeyEvent(evt, 'down'));
        this.registerDomEvent(this.rootEl.win, 'keyup', (evt: KeyboardEvent) => this.peekKeyEvent(evt, 'up'));
        this.registerDomEvent(this.rootEl.win, 'blur', () => this.peek?.shift(false));
        // Scrolling moves the cell out from under the panel.
        this.registerDomEvent(this.rootEl.doc, 'scroll', () => this.peek?.hide(), { capture: true });
        // Hovering a scene's row lights it up on the wheel.
        this.registerDomEvent(this.rootEl, 'mouseover', (evt: MouseEvent) => {
            if (evt.target instanceof Element && evt.target.closest('.ert-time-reference-row')) {
                if (this.hoveredPath !== null) {
                    this.hoveredPath = null;
                    this.plugin.highlightSceneOnTimeline(null);
                    this.markLinkedRow(null, null, false);
                }
                const reference = this.referenceAt(evt.target);
                hoverTimeReference(reference ? { path: reference.path, key: reference.key } : null);
                return;
            }
            const row = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__row.is-scene') : null;
            const path = row?.dataset.path ?? null;
            hoverTimeReference(null);
            if (path === this.hoveredPath && (!row || this.linkedRow === row)) return;
            this.hoveredPath = path;
            const color = this.plugin.highlightSceneOnTimeline(path);
            this.markLinkedRow(color ? path : null, color, false);
        });
        this.registerDomEvent(this.rootEl, 'focusin', evt => {
            const reference = this.referenceAt(evt.target);
            if (reference) hoverTimeReference({ path: reference.path, key: reference.key });
        });
        this.registerDomEvent(this.rootEl, 'focusout', evt => {
            if (this.referenceAt(evt.target)) hoverTimeReference(null);
        });
        this.registerDomEvent(this.rootEl, 'mouseleave', () => {
            hoverTimeReference(null);
            if (this.hoveredPath === null) return;
            this.hoveredPath = null;
            this.plugin.highlightSceneOnTimeline(null);
            this.markLinkedRow(null, null, false);
        });
    }

    // ── Shift-hover ─────────────────────────────────────────────────────

    /**
     * The pointer moved: over a row's Synopsis or Pending Edits icon, the peek
     * shows that text at once (with Shift, the Synopsis icon shows the
     * Summary); elsewhere it follows the cell under the pointer for Shift
     * (number and Rings cells have no text to read).
     */
    private hoverPeek(target: EventTarget | null, shift: boolean): void {
        const held = shift && !isTypingInField(this.rootEl.doc);
        const control = target instanceof Element ? target.closest<HTMLElement>('.ert-timetable__text-control[data-peek]') : null;
        this.peekControl = control;
        this.peek?.showText(control, control ? this.controlText(control, held) : '');
        const cell = target instanceof Element ? target.closest<HTMLElement>('tr.ert-timetable__row > td[data-column]') : null;
        const path = cell?.closest<HTMLElement>('tr')?.dataset.path;
        const column = cell?.dataset.column;
        this.peekKey = cell && path && column ? { path, column } : null;
        this.peek?.hover(cell, held);
    }

    /**
     * A control's text: Pending Edits; the Synopsis, or with Shift the Summary.
     * An empty Synopsis or Summary says so rather than showing nothing.
     */
    private controlText(control: HTMLElement, shift: boolean): string {
        const item = this.rowItems.get(control.closest<HTMLElement>('tr')?.dataset.path ?? '');
        if (!item) return '';
        const vitals = sceneVitals(item.frontmatter, this.plugin.settings, new Date());
        if (control.dataset.peek === 'pending') return vitals.pending ?? '';
        if (shift) return vitals.summary ?? t('ui.timetable.summaryEmpty');
        return vitals.synopsis ?? t('ui.timetable.synopsisEmpty');
    }

    /** Shift alone opens the peek. Shift in a chord (Cmd-Shift-P), or while typing in a field, doesn't. */
    private peekKeyEvent(evt: KeyboardEvent, phase: 'down' | 'up'): void {
        const peek = this.peek;
        const action = beatNamePeekAction(evt, phase);
        if (!peek || action === 'none') return;
        const held = action === 'show';
        if (held && isTypingInField(this.rootEl.doc)) return;
        const control = this.peekControl;
        if (control?.isConnected) {
            peek.showText(control, this.controlText(control, held));
            return;
        }
        if (peek.hoveredCell()) peek.shift(held);
    }

    /** After a redraw, the peek follows its row and column to the new cell (Chronologue's Shift adds a column, for one). */
    private refindPeekCell(): void {
        const peek = this.peek;
        if (!peek) return;
        const key = this.peekKey;
        const cell = key ? this.rowEls.get(key.path)?.querySelector<HTMLElement>(`td[data-column="${CSS.escape(key.column)}"]`) ?? null : null;
        peek.hover(cell, peek.isHeld());
    }

    // ── Column widths ───────────────────────────────────────────────────

    /** Saved widths, under the same `columnSize` key Obsidian's own table uses. */
    private columnSizes(): Record<string, number> {
        const raw: unknown = this.config.get('columnSize');
        const sizes: Record<string, number> = {};
        if (!raw || typeof raw !== 'object') return sizes;
        for (const [key, value] of Object.entries(raw)) {
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
        this.resizing = { property, startX: evt.clientX, startWidth, width: startWidth, tableWidth: table.getBoundingClientRect().width, col, table, header };
    }

    private moveResize(evt: PointerEvent): void {
        const resize = this.resizing;
        if (!resize) return;
        resize.width = Math.max(MIN_COLUMN_WIDTH, Math.round(resize.startWidth + evt.clientX - resize.startX));
        resize.col.setCssProps({ '--ert-timetable-col-width': `${resize.width}px` });
        resize.table.setCssProps({ '--ert-timetable-width': `${Math.round(resize.tableWidth + resize.width - resize.startWidth)}px` });
        this.fitHeaderLabel(resize.header);
    }

    /** Save the new width in the .base file, as Obsidian's table does. */
    private endResize(): void {
        const resize = this.resizing;
        if (!resize) return;
        this.resizing = null;
        if (resize.width === Math.round(resize.startWidth)) return;
        this.config.set('columnSize', { ...this.columnSizes(), [resize.property]: resize.width });
    }

    // ── Fitting columns to their content ────────────────────────────────

    /** Columns that fit to their content: every column but long text. */
    private isFittable(property: BasesPropertyId): boolean {
        const { type, name } = parsePropertyId(property);
        if (type !== 'note') return true;
        return !LONG_TEXT_COLUMNS.has(canonicalizeFrontmatterKey(name, getActiveFrontmatterMappings(this.plugin.settings)));
    }

    /** The width a column's content needs: its header or its widest drawn cell, clamped. 0 while the table isn't laid out. */
    private measureColumn(table: HTMLElement, property: BasesPropertyId): number {
        const header = table.querySelector<HTMLElement>(`th[data-property="${CSS.escape(property)}"]`);
        const inner = header?.querySelector<HTMLElement>('.ert-timetable__prop-head-inner');
        if (!header || !inner || header.clientWidth === 0) return 0;
        let widest = contentWidth(inner) + horizontalPadding(header);
        const cells = table.querySelectorAll<HTMLElement>(`td[data-col="${header.dataset.col ?? ''}"]`);
        const padding = cells.length > 0 ? horizontalPadding(cells[0]) : 0;
        cells.forEach(cell => { widest = Math.max(widest, contentWidth(cell) + padding); });
        return clampFittedWidth(widest + 1);
    }

    /** The number column's width: its corner controls or its widest row. 0 while the table isn't laid out. */
    private measureNumberColumn(table: HTMLElement): number {
        const head = table.querySelector<HTMLElement>('.ert-timetable__num-head');
        const corner = head?.querySelector<HTMLElement>('.ert-timetable__corner');
        if (!head || !corner || head.clientWidth === 0) return 0;
        let widest = contentWidth(corner) + horizontalPadding(head);
        const cells = table.querySelectorAll<HTMLElement>('td.ert-timetable__num');
        const padding = cells.length > 0 ? horizontalPadding(cells[0]) : 0;
        cells.forEach(cell => {
            const inner = cell.querySelector<HTMLElement>('.ert-timetable__num-inner');
            if (inner) widest = Math.max(widest, contentWidth(inner) + padding);
        });
        return Math.ceil(widest + 1);
    }

    /**
     * Once the table is laid out: fit the number column to what its rows hold,
     * and each column the author hasn't sized to its content (long text keeps
     * its width). Neither is saved, and while the table is open neither
     * shrinks, so nothing twitches during an edit. A hidden table is left as is.
     */
    private fitAfterRender(table: HTMLElement, sizes: Record<string, number>): void {
        if (table.clientWidth === 0) return;
        this.showHeaderLabels(table);
        const numberCol = table.querySelector<HTMLElement>('col[data-role="number"]');
        const numberWidth = this.measureNumberColumn(table);
        if (numberCol && numberWidth > 0) {
            this.numberWidth = this.numberWidth === null ? numberWidth : Math.max(this.numberWidth, numberWidth);
            numberCol.setCssProps({ '--ert-timetable-col-width': `${this.numberWidth}px` });
        }
        table.querySelectorAll<HTMLElement>('col[data-property]').forEach(col => {
            const property = col.dataset.property as BasesPropertyId;
            if (sizes[property] !== undefined || !this.isFittable(property)) return;
            const width = this.measureColumn(table, property);
            if (width === 0) return;
            const fitted = Math.max(width, this.autoWidths.get(property) ?? 0);
            this.autoWidths.set(property, fitted);
            col.setCssProps({ '--ert-timetable-col-width': `${fitted}px` });
        });
        this.updateTableWidth(table);
        this.fitHeaderLabels(table);
    }

    /** The header menu's Fit items and a handle's double-click: fit these columns now and save their widths, as a drag would. */
    private fitColumns(properties: BasesPropertyId[]): void {
        const table = this.rootEl.querySelector<HTMLElement>('.ert-timetable__table');
        if (!table) return;
        this.showHeaderLabels(table);
        const sizes = this.columnSizes();
        let changed = false;
        for (const property of properties) {
            const width = this.measureColumn(table, property);
            if (width === 0 || sizes[property] === width) continue;
            sizes[property] = width;
            changed = true;
        }
        if (!changed) {
            this.fitHeaderLabels(table);
            return;
        }
        this.config.set('columnSize', sizes);
        this.render();
    }

    /** The table is as wide as its columns. */
    private updateTableWidth(table: HTMLElement): void {
        let width = 0;
        table.querySelectorAll<HTMLElement>('col').forEach(col => {
            width += parseFloat(col.style.getPropertyValue('--ert-timetable-col-width')) || 0;
        });
        table.setCssProps({ '--ert-timetable-width': `${Math.round(width)}px` });
    }

    /** Measuring needs every header label showing. */
    private showHeaderLabels(table: HTMLElement): void {
        table.querySelectorAll<HTMLElement>('.ert-timetable__prop-head.is-icon-only').forEach(header => header.removeClass('is-icon-only'));
    }

    private fitHeaderLabels(table: HTMLElement): void {
        table.querySelectorAll<HTMLElement>('.ert-timetable__prop-head[data-property]').forEach(header => this.fitHeaderLabel(header));
    }

    /** A header narrower than its label shows only its icon, with the column's name on hover. */
    private fitHeaderLabel(header: HTMLElement): void {
        const label = header.querySelector<HTMLElement>('.ert-timetable__prop-label');
        const icon = header.querySelector<HTMLElement>('.ert-timetable__prop-icon');
        if (!label || !icon) return;
        header.removeClass('is-icon-only');
        const iconOnly = label.scrollWidth > label.clientWidth + 1;
        header.toggleClass('is-icon-only', iconOnly);
        // On the icon: the header's own text still holds the hidden label, which would make the tooltip look redundant.
        setTooltip(icon, iconOnly ? label.getText() : '', { placement: 'bottom' });
    }

    // ── Resetting the columns ───────────────────────────────────────────

    /** The `.base` file this table shows, when it has a tab of its own (not an embed). */
    private tableFile(): TFile | null {
        const file = (this.tableLeaf()?.getViewState().state as { file?: unknown } | undefined)?.file;
        return typeof file === 'string' ? this.plugin.app.vault.getFileByPath(file) : null;
    }

    /** For the command: whether this table can be reset (it has a file of its own). */
    canResetColumns(): boolean {
        return this.tableFile() !== null;
    }

    resetColumns(): void {
        void this.confirmResetColumns();
    }

    /**
     * Give this view the columns a new Timetable would get from this table's
     * scenes now, after a confirm. Its saved widths go too. The file's other
     * views, its filters, sorts and grouping stay as they are.
     *
     * The whole-file YAML round-trip matches Obsidian's own Bases saves, which
     * re-serialize the file on every edit (checked in 1.15.0). The open file
     * view reloads on modify, so a later resize saves the reset columns.
     */
    private async confirmResetColumns(): Promise<void> {
        const file = this.tableFile();
        if (!file) return;
        const { app, settings } = this.plugin;
        const viewName = this.config.name;
        const confirmed = await confirmWithErtModal(app, {
            title: t('ui.timetable.resetColumnsTitle'),
            message: t('ui.timetable.resetColumnsMessage', { view: viewName }),
            confirmText: t('ui.timetable.resetColumnsButton'),
            cancelText: t('common.cancel'),
            badge: { text: t('ui.timetable.viewName'), icon: 'table-2' },
        });
        if (!confirmed) return;
        const frontmatters = (this.data?.data ?? []).map(entry => app.metadataCache.getFileCache(entry.file)?.frontmatter);
        const order = tableColumns(settings, countColumnFill(frontmatters, settings)).timetable;
        let found = false;
        try {
            await app.vault.process(file, content => {
                const parsed: unknown = parseYaml(content);
                const next = parsed && typeof parsed === 'object' ? withRecommendedColumns(parsed as Record<string, unknown>, viewName, order) : null;
                found = next !== null;
                return next ? stringifyYaml(next) : content;
            });
        } catch (error) {
            console.error('[Timetable] Could not reset the columns:', error);
            new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000);
            return;
        }
        if (!found) {
            new Notice(t('ui.timetable.resetColumnsMissing', { view: viewName, file: file.basename }), 8000);
            return;
        }
        this.autoWidths.clear();
    }

    /** The wheel is hovering this scene: light up its row and bring it into view. */
    markLinkedRow(path: string | null, color: string | null, reveal = true): void {
        if (this.linkedRow) {
            this.linkedRow.removeClass('is-linked');
            this.linkedRow.setCssProps({ '--ert-timetable-link-color': '' });
        }
        this.linkedRow = path ? this.rowEls.get(path) ?? null : null;
        if (!this.linkedRow) return;
        this.linkedRow.addClass('is-linked');
        if (color) this.linkedRow.setCssProps({ '--ert-timetable-link-color': color });
        if (reveal) this.linkedRow.scrollIntoView({ block: 'nearest' });
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
        const header = (row.closest('table')?.querySelector('thead')?.getBoundingClientRect().height ?? 0)
            + (this.rootEl.querySelector<HTMLElement>('.ert-timetable-panels__toolbar')?.getBoundingClientRect().height ?? 0);
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
        if (this.modePin === null) return timeline;
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
     * wheel), with a divider for each new day and the gap since the previous
     * dated row (Shift). A sort the author set in the Bases toolbar still wins.
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
        return {
            group: { id: 'chronologue', label: null, items: keyed.map(entry => entry.item) },
            lines: authorSorted ? keyed.map(entry => ({ type: 'row' as const, row: entry.row })) : withDayDividers(keyed),
            gap: new Map(keyed.map((entry, index) => [entry.row.path, gaps[index]])),
            profile: state.alt ? getActivePlanetaryProfile(settings) : null,
        };
    }

    /**
     * Narrative's runtime view: the running time through each scene row in
     * manuscript order — the same totals the wheel shows — however the table is
     * grouped or sorted.
     */
    private narrativeRunning(groups: TableGroup[]): Map<string, number> {
        const { settings } = this.plugin;
        const items = groups.flatMap(group => group.items).sort((a, b) => compareManuscriptRows(a.row, b.row));
        const totals = runningTotals(items.map(item => item.row.kind === 'scene' ? readRuntimeSeconds(item.frontmatter, settings) : null));
        return new Map(items.map((item, index) => [item.row.path, totals[index]]));
    }

    /** A When in the table: the shared When format, or the planetary calendar when Alt is on. */
    private formatWhen(when: Date, hasClock: boolean, profile: PlanetaryProfile | null): string {
        const planetary = profile ? convertFromEarth(when, profile) : null;
        return planetary ? planetary.formatted : formatSceneWhen(when, hasClock);
    }

    // ── Lens ────────────────────────────────────────────────────────────

    /**
     * The lens is on when its toggle is, and on its own while this view has a
     * filter of its own: a filtered table is a question asked of the wheel.
     * Turning it off holds for that filter; a new or changed filter lights it
     * again, and removing the filter leaves the toggle as it was.
     */
    private lensWanted(): boolean {
        return this.config.get('lens') === true || (this.viewFilter !== null && this.viewFilter !== this.lensDismissedFor);
    }

    /** Notice the view's own filter changing. A new filter takes the lens from any other table. */
    private trackViewFilter(): void {
        const filter = filterSignature(basesViewFilters(this.config));
        if (filter === this.viewFilter) return;
        this.viewFilter = filter;
        if (filter === null) this.lensDismissedFor = null;
        else this.claimLens = true;
    }

    /** With its lens on, this table's rows light up on the timeline. */
    private syncLens(): void {
        this.trackViewFilter();
        if (!this.lensWanted()) {
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
        setTimelineLens({ owner: this, paths, label: this.config.name, turnOff: () => this.turnLensOff() });
    }

    private toggleLens(): void {
        if (currentTimelineLens()?.owner === this) {
            this.turnLensOff();
            return;
        }
        this.claimLens = true;
        // A filtered view's lens follows its filter; an unfiltered one keeps the choice in the toggle.
        if (this.viewFilter !== null) this.lensDismissedFor = null;
        else this.config.set('lens', true);
        this.render();
    }

    /** The lens button or the timeline's pill: off, and off for the current filter too. */
    private turnLensOff(): void {
        this.config.set('lens', false);
        if (this.viewFilter !== null) this.lensDismissedFor = this.viewFilter;
        clearTimelineLens(this);
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

    /** The workspace tab this table shows in. */
    private tableLeaf(): WorkspaceLeaf | null {
        return this.plugin.app.workspace.getLeavesOfType('bases').find(leaf => leaf.view.containerEl.contains(this.rootEl)) ?? null;
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
        showSceneContextMenu({ plugin: this.plugin, openNote: created => openFromTimetable(this.plugin.app, created, undefined, this.rootEl) }, {
            file,
            itemType: 'Scene',
            ringSubplot: null,
            knownSubplots: rings,
            primarySubplot: primary,
            subplotColor: colorIndex !== undefined ? readSubplotColor(this.rootEl.ownerDocument, colorIndex) : undefined,
        }, evt);
    }

    private referenceAt(target: EventTarget | null): TimeReference | undefined {
        const row = target instanceof Element ? target.closest<HTMLElement>('.ert-time-reference-row[data-reference-key]') : null;
        const item = this.rowItems.get(row?.dataset.sourcePath ?? '');
        return item ? readTimeReferences(item.frontmatter?.[TIME_REFERENCES_KEY], item.row.path).references.find(ref => ref.key === row?.dataset.referenceKey) : undefined;
    }

    private handleClick(evt: MouseEvent): void {
        const target = evt.target instanceof Element ? evt.target : null;
        if (!target) return;
        const referenceToggle = target.closest<HTMLElement>('.ert-time-reference-toggle');
        if (referenceToggle) {
            evt.stopPropagation();
            const path = referenceToggle.closest<HTMLElement>('[data-path]')?.dataset.path;
            if (path) { if (!this.expandedReferences.delete(path)) this.expandedReferences.add(path); this.render(); }
            return;
        }
        const reference = this.referenceAt(target);
        if (reference && target.closest('.ert-time-reference-open')) {
            evt.stopPropagation(); pinTimeReference({ path: reference.path, key: reference.key });
            void openTimeReference(this.plugin, reference, this.rootEl); return;
        }
        const manage = target.closest<HTMLElement>('[data-time-reference-manage]');
        if (manage) {
            evt.stopPropagation();
            const item = this.rowItems.get(manage.dataset.timeReferenceManage ?? '');
            if (item) manageTimeReferences(this.plugin, item.entry.file);
            return;
        }
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
        const step = target.closest<HTMLElement>('.ert-timetable__due-step');
        if (step?.dataset.days) {
            void this.stepDue(file, Number(step.dataset.days));
            return;
        }
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
            void this.plugin.revealSceneOnTimeline(path, this.tableLeaf() ?? undefined);
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
        setAccessibleLabel(clear, t('ui.timetable.bulkClear'));
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

    /** Right-click a column header: color the timeline by it, fit it or every column, or reset the columns. */
    private showColumnMenu(evt: MouseEvent, property: BasesPropertyId): void {
        const name = this.config.getDisplayName(property);
        const menu = new Menu();
        const coloring = currentTimelineColoring();
        if (coloring?.owner === this && this.coloringProperty === property) {
            menu.addItem(item => item.setTitle(t('ui.timetable.coloringStop')).setIcon('palette').onClick(() => this.stopColoring()));
        } else {
            const initial = this.initialColoring(property);
            const plan = this.planColoringFor(property, initial);
            menu.addItem(item => {
                item.setIcon('palette');
                if (plan.kind === 'ok') {
                    item.setTitle(t('ui.timetable.coloringStart', { property: name })).onClick(() => {
                        if (initial.grouping || plan.categories.length > MAX_COLOR_VALUES) this.configureColoring(initial);
                        else this.saveColoring(initial);
                    });
                } else item.setTitle(t('ui.timetable.coloringNone', { property: name })).setDisabled(true);
            });
        }
        menu.addSeparator();
        if (this.isFittable(property)) {
            menu.addItem(item => item.setTitle(t('ui.timetable.fitColumn')).setIcon('move-horizontal').onClick(() => this.fitColumns([property])));
        }
        menu.addItem(item => item.setTitle(t('ui.timetable.fitAllColumns')).setIcon('unfold-horizontal').onClick(() => {
            this.fitColumns(this.config.getOrder().filter(candidate => this.isFittable(candidate)));
        }));
        if (this.canResetColumns()) {
            menu.addSeparator();
            menu.addItem(item => item.setTitle(t('ui.timetable.resetColumns')).setIcon('list-restart').onClick(() => this.resetColumns()));
        }
        menu.showAtMouseEvent(evt);
    }

    private initialColoring(property: BasesPropertyId): SavedColoring {
        const { name } = parsePropertyId(property);
        const canonical = canonicalizeFrontmatterKey(name, getActiveFrontmatterMappings(this.plugin.settings));
        const config: SavedColoring = { schemaVersion: 2, property, picks: [] };
        if (canonical === 'When') config.grouping = { kind: 'month' };
        if (canonical === 'Due') config.grouping = { kind: 'due' };
        return config;
    }

    /** Read the current view's scene property values once for each plan/editor snapshot. */
    private coloringRows(property: BasesPropertyId): Array<{ path: string; value: unknown; complete: boolean }> {
        const { type, name } = parsePropertyId(property);
        if (type !== 'note') return [];
        const { app, settings } = this.plugin;
        return (this.data?.data ?? []).filter(entry => entry.file.extension === 'md').map(entry => {
            const fm: Record<string, unknown> | undefined = app.metadataCache.getFileCache(entry.file)?.frontmatter;
            const row = buildTableRow(entry.file.path, entry.file.basename, fm, settings);
            return { path: row.path, kind: row.kind, value: frontmatterKey(fm, name), complete: normalizeStatus(frontmatterKey(fm, authorKeyFor('Status', settings))) === 'Completed' };
        }).filter(row => row.kind === 'scene');
    }

    private coloringSlots(): number[] {
        return distinctColorSlots(Array.from({ length: SUBPLOT_COLOR_SLOTS }, (_, slot) => readSubplotColor(this.rootEl.ownerDocument, slot)));
    }

    private planColoringFor(property: BasesPropertyId, config: SavedColoring) {
        return planConfiguredColoring(this.coloringRows(property), config, this.coloringSlots(), new Date());
    }

    private saveColoring(config: SavedColoring): void {
        // Categories keep the eight shown today; date groups stay open (planConfiguredColoring).
        if (!config.palette && !config.grouping) {
            const plan = this.planColoringFor(config.property as BasesPropertyId, config);
            if (plan.kind !== 'ok' || plan.legend.length === 0) return;
            config = { ...config, palette: plan.legend.map(entry => entry.value) };
        }
        this.config.set('coloring', config);
        this.claimColoring = true;
        this.render();
    }

    private configureColoring(config: SavedColoring): void {
        const property = config.property as BasesPropertyId;
        new TimetableColoringModal(this.plugin.app, this.config.getDisplayName(property), this.coloringRows(property), this.coloringSlots(), config,
            next => this.saveColoring(next)).open();
    }

    /** The saved view owns coloring; the timeline key only sends edits back to it. */
    private syncColoring(): void {
        this.coloringProperty = null;
        this.pickedPaths = null;
        const saved = readSavedColoring(this.config.get('coloring'));
        if (!saved) { clearTimelineColoring(this); return; }
        const active = currentTimelineColoring();
        if (active && active.owner !== this && !this.claimColoring) return;
        this.claimColoring = false;
        const property = saved.property as BasesPropertyId;
        const plan = this.planColoringFor(property, saved);
        if (plan.kind !== 'ok' || plan.legend.length === 0) { clearTimelineColoring(this); return; }
        this.coloringProperty = property;
        const picks = saved.picks.filter(pick => plan.legend.some(entry => entry.value === pick));
        const match = saved.grouping ? 'any' : saved.match ?? (plan.multiValue ? 'all' : 'any');
        const values = picks.length > 0 ? narrowColoring(plan.members, picks, match) : plan.values;
        if (picks.length > 0) this.pickedPaths = new Set(values.keys());
        setTimelineColoring({
            owner: this,
            property: this.config.getDisplayName(property),
            values,
            legend: plan.legend.map(entry => ({ ...entry, label: coloringDateLabel(entry.value, saved.grouping) })),
            categoryCount: plan.categories.length,
            match,
            grouping: saved.grouping?.kind ?? 'categories',
            groupingLabel: saved.grouping?.kind === 'range' ? `${saved.grouping.start} – ${saved.grouping.end}` : saved.grouping ? t(`ui.timetable.colorKey.group.${saved.grouping.kind}`) : '',
            picks,
            togglePick: value => this.saveColoring({ ...saved, picks: toggledPicks(picks, value) }),
            clearPicks: () => this.saveColoring({ ...saved, picks: [] }),
            configure: () => this.configureColoring({ ...saved, match }),
            turnOff: () => this.stopColoring(),
        });
    }

    private stopColoring(): void {
        this.config.set('coloring', null);
        clearTimelineColoring(this);
        this.render();
    }

    /** Rows outside the color key's selected values fade, as on the wheel. */
    private markPicks(): void {
        for (const [path, element] of this.rowEls) {
            element.toggleClass('is-out-of-picks', this.pickedPaths !== null && !this.pickedPaths.has(path));
        }
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
     * asked for. Its drawer opens with the cursor in its Title.
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
        this.focusField = 'title';
        try {
            await app.vault.create(path, `---\n${stringifyYaml(frontmatter)}---\n\n`);
        } catch (error) {
            this.openDrawers.delete(path);
            this.focusPath = null;
            console.error('[Timetable] Could not create the sketch:', error);
            new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000);
        }
    }

    /**
     * The drawer's Title: rename the sketch's file through Obsidian, so links
     * to it follow. A number prefix stays; a name already taken gets a counter.
     */
    private async renameSketch(file: TFile, title: string): Promise<void> {
        const stem = safeTitle(title);
        const { lead, title: current } = splitNumberPrefix(file.basename);
        if (!stem || stem === current) return;
        const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : '';
        let path = `${folder}${lead}${stem}.md`;
        for (let counter = 2; this.plugin.app.vault.getAbstractFileByPath(path); counter++) path = `${folder}${lead}${stem} ${counter}.md`;
        try {
            await this.plugin.app.fileManager.renameFile(file, path);
        } catch (error) {
            console.error('[Timetable] Could not rename the sketch:', error);
            new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000);
        }
    }

    /**
     * + and ++: the scene's Due a day or a week later, counting from today when
     * it is late. A late scene moves at once; any other asks first, showing
     * the new date, since its Due may be deliberate.
     */
    private async stepDue(file: TFile, days: number): Promise<void> {
        const { app, settings } = this.plugin;
        const mappings = getActiveFrontmatterMappings(settings);
        const today = new Date();
        const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(file)?.frontmatter;
        const { due } = sceneVitals(frontmatter, settings, today);
        if (dueStepNeedsConfirm(due)) {
            const nextKey = steppedDue(frontmatterKey(frontmatter, authorKeyFor('Due', settings)), days, today);
            const next = formatLongDate(parseLocalDateKey(nextKey) ?? today);
            const scene = displayName(file.basename);
            const confirmed = await confirmWithErtModal(app, {
                title: t('ui.timetable.dueStepConfirmTitle'),
                message: due.kind === 'none'
                    ? t('ui.timetable.dueStepConfirmNone', { scene, next })
                    : t('ui.timetable.dueStepConfirmMessage', { scene, due: formatDueLabel(due, today), next }),
                confirmText: t('ui.timetable.dueStepConfirmButton'),
                cancelText: t('common.cancel'),
                badge: { text: t('ui.timetable.viewName'), icon: 'calendar-plus' },
            });
            if (!confirmed) return;
        }
        try {
            // Read inside the write, so quick clicks each build on the last one.
            await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                const key = Object.keys(fm).find(candidate => canonicalizeFrontmatterKey(candidate, mappings) === 'Due') ?? authorKeyFor('Due', settings);
                fm[key] = steppedDue(fm[key], days, new Date());
            });
        } catch (error) {
            console.error('[Timetable] Could not change Due:', error);
            new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000);
            return;
        }
        this.plugin.refreshTimelineIfNeeded(file, 100);
    }

    /**
     * A note was renamed: its drawer, pick and expanded references move with
     * it. Its row takes the new name at once, even while a redraw waits for
     * the author to finish typing in a drawer.
     */
    private followRename(path: string, oldPath: string): void {
        let moved = false;
        const row = this.rowEls.get(oldPath);
        if (row) {
            this.rowEls.delete(oldPath);
            this.rowEls.set(path, row);
            row.dataset.path = path;
            const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
            row.querySelector('.ert-timetable__name')?.setText(displayName(basename));
        }
        const drawer = this.drawers.get(oldPath);
        if (drawer) {
            this.drawers.delete(oldPath);
            this.drawers.set(path, drawer);
            moved = true;
        }
        for (const paths of [this.openDrawers, this.closedDrawers, this.selected, this.expandedReferences]) {
            if (paths.delete(oldPath)) {
                paths.add(path);
                moved = true;
            }
        }
        if (this.lastToggled === oldPath) this.lastToggled = path;
        if (this.focusPath === oldPath) this.focusPath = path;
        if (moved) this.render();
    }

    private toggleGroup(id: string): void {
        if (this.collapsed.has(id)) this.collapsed.delete(id);
        else this.collapsed.add(id);
        this.render();
    }

    onunload(): void {
        this.panelEvents?.unload();
        this.panelEvents = null;
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
        if (this.panelEditing || [...this.drawers.values()].some(drawer => drawer.isEditing())) {
            this.renderDeferred = true;
            return;
        }
        this.renderDeferred = false;
        this.panelEvents?.unload();
        this.panelEvents = new Component();
        this.panelEvents.load();
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
        const running = state.mode === 'narrative' && state.runtime ? this.narrativeRunning(groups) : null;
        const mode: ModeContext = { state, chronologue, running };

        const scrollParent = this.rootEl.parentElement;
        const scrollTop = scrollParent?.scrollTop ?? 0;
        this.rootEl.empty();
        // The peek's cell is gone; refindPeekCell brings it back once the rows are drawn.
        this.peek?.hide();
        this.mountPatternDefs();
        this.renderBookNotice(groups);

        this.renderLayoutSwitch(state);

        const allItems = groups.flatMap(group => group.items);
        if (allItems.length === 0) {
            this.renderNewSketchToolbar();
            this.rootEl.createDiv({ cls: 'ert-timetable__empty', text: t('ui.timetable.empty') });
            this.pruneDrawers(new Set());
            return;
        }

        if (this.config.get('panels') === true) {
            this.renderPanels(groups, mode, allItems);
            if (scrollParent) scrollParent.scrollTop = scrollTop;
            return;
        }

        const showRings = this.config.get('ringsColumn') !== false && this.rings !== null;
        const perLine = Math.min(8, Math.max(3, Math.round(Number(this.config.get('ringsPerLine') ?? RINGS_PER_LINE_DEFAULT)) || RINGS_PER_LINE_DEFAULT));
        const layout = this.rings ? buildRingLayout(this.rings.order, this.rings.colorIndex, allItems.map(item => item.row)) : null;
        const columns = this.columnsFor(mode);
        const columnCount = 1 + (showRings ? 1 : 0) + columns.length;
        const cells = this.cellContext(mode, allItems, columns);

        const table = this.rootEl.createEl('table', { cls: 'ert-timetable__table' });
        table.toggleClass('is-gossamer', state.mode === 'gossamer');
        // Picked rows that have left the table (filtered out, renamed, deleted) are dropped.
        const present = new Set(allItems.map(item => item.row.path));
        for (const path of [...this.selected]) if (!present.has(path)) this.selected.delete(path);
        table.toggleClass('has-selection', this.selected.size > 0);
        // Fixed widths, like Obsidian's own table: the author's saved sizes, else fitted widths (fitAfterRender), else defaults.
        const sizes = this.columnSizes();
        const colgroup = table.createEl('colgroup');
        let tableWidth = 0;
        const addColumn = (width: number, property?: BasesPropertyId): HTMLElement => {
            const col = colgroup.createEl('col');
            col.setCssProps({ '--ert-timetable-col-width': `${width}px` });
            if (property) col.dataset.property = property;
            tableWidth += width;
            return col;
        };
        addColumn(this.numberWidth ?? NUMBER_COLUMN_WIDTH).dataset.role = 'number';
        if (showRings) addColumn(perLine * 12 + 18);
        for (const column of columns) {
            if (column.kind === 'property') addColumn(sizes[column.property] ?? this.autoWidths.get(column.property) ?? this.defaultColumnWidth(column.property), column.property);
            else addColumn(MICRO_COLUMN_WIDTH);
        }
        table.setCssProps({ '--ert-timetable-rings-per-line': String(perLine), '--ert-timetable-width': `${tableWidth}px` });

        const headRow = table.createEl('thead').createEl('tr');
        // The corner: + New sketch, the lens, and the mode the table follows. It stays in reach while scrolling.
        this.renderCorner(headRow.createEl('th', { cls: 'ert-timetable__num-head' }), state);
        if (showRings && layout) this.renderRingsHeader(headRow.createEl('th', { cls: 'ert-timetable__rings-head' }), layout);
        columns.forEach((column, index) => {
            const header = headRow.createEl('th', { cls: 'ert-timetable__prop-head' });
            header.dataset.col = String(index);
            if (column.kind === 'property') this.renderPropertyHeader(header, column.property, cells);
            else {
                header.addClass('is-micro');
                header.setText(column.kind === 'gap' ? t('ui.timetable.colGap') : t('ui.timetable.colRunningTime'));
            }
        });

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
                this.renderRow(body, item, columns, showRings ? layout : null, columnCount, cells);
                if (item.row.kind === 'scene') this.renderTimeReferences(body, item, columnCount);
                if (item.row.kind === 'sketch' && this.drawerIsOpen(item.row.path)) {
                    this.renderDrawer(body, item, layout, columnCount);
                    openDrawers.add(item.row.path);
                }
            }
        }
        this.pruneDrawers(openDrawers);
        this.setCurrentRow(currentNotePath());
        this.markRing(this.ringSpotlight);
        this.markPicks();
        this.renderBulkBar();
        this.fitAfterRender(table, sizes);
        if (scrollParent) scrollParent.scrollTop = scrollTop;
        this.refindPeekCell();
        void this.decorateFromBodies(allItems).then(done => {
            // Query counts arrive after the first fit; the number column makes room for them.
            if (done && table.isConnected) this.fitAfterRender(table, sizes);
        });
    }

    /** What the cells of this draw share: the When year, whether When shows Duration, each book's median Words. */
    private cellContext(mode: ModeContext, items: TableItem[], columns: Column[]): CellContext {
        const { settings } = this.plugin;
        const mappings = getActiveFrontmatterMappings(settings);
        const shows = (canonical: string): boolean => columns.some(column => {
            if (column.kind !== 'property') return false;
            const { type, name } = parsePropertyId(column.property);
            return type === 'note' && canonicalizeFrontmatterKey(name, mappings) === canonical;
        });
        const years = new Set<number>();
        const words = new Map<string, number[]>();
        const books = settings.books ?? [];
        for (const item of items) {
            const { when } = readWhen(item.frontmatter, settings);
            if (when) years.add(when.getFullYear());
            if (item.row.kind !== 'scene') continue;
            const count = Number(frontmatterKey(item.frontmatter, authorKeyFor('Words', settings)));
            if (!Number.isFinite(count) || count <= 0) continue;
            const book = getBookIdForPath(books, item.row.path) ?? '';
            words.set(book, [...(words.get(book) ?? []), count]);
        }
        const wordMedians = new Map<string, number>();
        for (const [book, counts] of words) {
            const median = medianOf(counts);
            if (median !== null) wordMedians.set(book, median);
        }
        return {
            mode,
            // Alt's planetary calendar has years of its own; each cell keeps them.
            whenYear: years.size === 1 && !mode.chronologue?.profile ? [...years][0] : null,
            durationInWhen: !shows('Duration'),
            wordMedians,
            today: new Date(),
        };
    }

    /** A property's header: its icon (template fields), its name, and the When column's shared year. */
    private renderPropertyHeader(header: HTMLElement, property: BasesPropertyId, cells: CellContext): void {
        header.dataset.property = property;
        const inner = header.createSpan({ cls: 'ert-timetable__prop-head-inner' });
        if (this.coloringProperty === property) {
            header.addClass('is-coloring');
            setIcon(inner.createSpan({ cls: 'ert-timetable__coloring-icon' }), 'palette');
        }
        const { type, name } = parsePropertyId(property);
        const canonical = type === 'note' ? canonicalizeFrontmatterKey(name, getActiveFrontmatterMappings(this.plugin.settings)) : '';
        const icon = COLUMN_ICONS[canonical];
        if (icon) setIcon(inner.createSpan({ cls: 'ert-timetable__prop-icon' }), icon);
        inner.createSpan({ cls: 'ert-timetable__prop-label', text: this.config.getDisplayName(property) });
        if (canonical === 'When' && cells.whenYear !== null) inner.createSpan({ cls: 'ert-timetable__prop-year', text: `· ${cells.whenYear}` });
        const handle = header.createDiv({ cls: 'ert-timetable__resize' });
        handle.dataset.property = property;
    }

    /** The Base's columns, plus the columns a micro-mode adds just after When. */
    private columnsFor(mode: ModeContext): Column[] {
        const columns: Column[] = this.config.getOrder().map(property => ({ kind: 'property', property }));
        const added: Column[] = [];
        if (mode.chronologue && mode.state.shift) added.push({ kind: 'gap' });
        if (mode.running) added.push({ kind: 'running' });
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
        setIcon(add, 'plus');
        setAccessibleLabel(add, t('ui.timetable.newSketch'));
        tooltip(add, t('ui.timetable.newSketch'), 'bottom');

        const lensOn = currentTimelineLens()?.owner === this;
        const lens = corner.createEl('button', { cls: 'ert-timetable__lens-toggle clickable-icon' });
        lens.toggleClass('is-active', lensOn);
        lens.setAttr('aria-pressed', String(lensOn));
        setAccessibleLabel(lens, t('ui.timetable.optionLens'));
        setIcon(lens, 'scan-eye');
        tooltip(lens, lensOn ? t('ui.timetable.lensOn') : t('ui.timetable.lensOff'), 'bottom');

        const modeButton = corner.createEl('button', { cls: 'ert-timetable__mode clickable-icon' });
        modeButton.toggleClass('is-pinned', this.modePin !== null);
        modeButton.setAttr('aria-haspopup', 'menu');
        setAccessibleLabel(modeButton, this.modeTooltip(state));
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
                    // The vitals beside a scene's number.
                    { swatch: { fill: 'transparent', stroke: 'transparent', text: 'A', textColor: stage.Author }, label: t('ui.timetable.keyStage'), detail: t('ui.timetable.keyStageDetail') },
                    { icon: 'pencil-line', label: t('ui.timetable.keyPending'), detail: t('ui.timetable.keyPendingDetail') },
                    { icon: 'align-left', label: t('ui.timetable.keySynopsis'), detail: t('ui.timetable.keySynopsisDetail') },
                    { dot: 'var(--color-red)', label: t('ui.timetable.keyDueDot'), detail: t('ui.timetable.keyDueDotDetail') },
                    { icon: 'calendar-plus', label: t('ui.timetable.keyDueStep'), detail: t('ui.timetable.keyDueStepDetail') },
                    { swatch: { fill: 'transparent', stroke: 'var(--text-muted)', text: '–', textColor: 'var(--text-muted)', dashed: true }, label: t('ui.timetable.keySketch'), detail: t('ui.timetable.keySketchDetail') },
                    { swatch: { fill: 'transparent', stroke: 'var(--text-faint)', text: '–', textColor: 'var(--text-faint)' }, label: t('ui.timetable.keyNote'), detail: t('ui.timetable.keyNoteDetail') },
                    { rings: ['var(--rt-subplot-colors-0)', 'var(--rt-subplot-colors-1)', null], label: t('ui.timetable.keyRings'), detail: t('ui.timetable.keyRingsDetail') },
                    { icon: 'pilcrow', label: t('ui.timetable.keyWordsBar'), detail: t('ui.timetable.keyWordsBarDetail') },
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
                    { icon: 'palette', label: t('ui.timetable.keyColorKey'), detail: t('ui.timetable.keyColorKeyDetail') },
                    { icon: 'chevron-down', label: t('ui.timetable.keyPick'), detail: t('ui.timetable.keyPickDetail') },
                    { icon: 'square-check', label: t('ui.timetable.keyCheckboxes'), detail: t('ui.timetable.keyCheckboxesDetail') },
                    { icon: 'square-mouse-pointer', label: t('ui.timetable.keyHover'), detail: t('ui.timetable.keyHoverDetail') },
                    { icon: 'text-select', label: t('ui.timetable.keyShiftHover'), detail: t('ui.timetable.keyShiftHoverDetail') },
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

    /** What the mode the table follows changes in it; plain Narrative changes nothing to explain. */
    private keyModeSection(state: TimelineModeState): LegendSection | null {
        const title = modeName(state.mode);
        if (state.mode === 'narrative' && state.runtime) {
            return { title, rows: [{ icon: 'timer', label: t('ui.timetable.colRunningTime'), detail: t('ui.timetable.keyRunningDetail') }] };
        }
        if (state.mode === 'chronologue') {
            const rows = [{ icon: 'calendar-days', label: t('ui.timetable.keyDayDividers'), detail: t('ui.timetable.keyDayDividersDetail') }];
            if (state.shift) rows.push({ icon: 'arrow-left-right', label: t('ui.timetable.colGap'), detail: t('ui.timetable.keyGapDetail') });
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

    /** Switch the presentation while retaining the same Bases view and filters. */
    private renderLayoutSwitch(state: TimelineModeState): void {
        const toolbar = this.rootEl.createDiv({ cls: 'ert-timetable-panels__toolbar' });
        for (const [panels, label] of [[false, t('ui.timetable.layoutTable')], [true, t('ui.timetable.layoutPanels')]] as const) {
            const button = toolbar.createEl('button', { text: label });
            button.setAttr('aria-pressed', String((this.config.get('panels') === true) === panels));
            this.panelEvents?.registerDomEvent(button, 'click', () => {
                if (this.panelEditing) return;
                this.config.set('panels', panels); this.render();
            });
        }
        const modeLabel = toolbar.createSpan({ cls: 'ert-timetable-panels__mode-label', text: modeName(state.mode) });
        tooltip(modeLabel, this.modeTooltip(state), 'bottom');
        if (this.config.get('panels') === true) this.renderCorner(toolbar, state);
        const updateHeight = () => this.rootEl.setCssProps({ '--ert-timetable-switch-height': `${toolbar.offsetHeight}px` });
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(toolbar);
        this.panelEvents?.register(() => observer.disconnect());
    }

    private renderPanels(groups: TableGroup[], mode: ModeContext, allItems: TableItem[]): void {
        const layout = this.rings ? buildRingLayout(this.rings.order, this.rings.colorIndex, allItems.map(item => item.row)) : null;
        const keep = new Set<string>();
        const list = this.rootEl.createDiv({ cls: 'ert-timetable-panels' });
        for (const group of groups) {
            if (group.label) {
                const heading = list.createEl('h3', { cls: 'ert-timetable-panels__group', text: group.label });
                if (typeof group.act === 'number') this.actDividerEls.set(group.act, heading);
            }
            const itemsByPath = new Map(group.items.map(item => [item.row.path, item]));
            const lines = mode.state.mode === 'chronologue'
                ? group.items.map(item => ({ type: 'row' as const, row: item.row }))
                : withActDividers(group.items.map(item => item.row));
            for (const line of lines) {
                if (line.type === 'act') {
                    const heading = list.createEl('h3', { cls: 'ert-timetable-panels__group', text: this.actLabel(line.act) });
                    if (line.act !== null) this.actDividerEls.set(line.act, heading);
                    continue;
                }
                if (line.type !== 'row') continue;
                const item = itemsByPath.get(line.row.path);
                if (!item) continue;
                const { row, frontmatter, entry } = item;
                const panel = list.createDiv({ cls: ['ert-timetable__row', 'ert-timetable-panels__panel', `is-${row.kind === 'otherClass' ? 'other-class' : row.kind}`] });
                panel.dataset.path = row.path;
                this.rowEls.set(row.path, panel);
                this.rowItems.set(row.path, item);
                const characters = frontmatterKey(frontmatter, authorKeyFor('Character', this.plugin.settings));
                const names = (Array.isArray(characters) ? characters : [characters]).filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
                const people = this.characterDetails(row.path, names);
                const portrait = leadPortrait(people);
                if (row.kind === 'scene') {
                    const fill = sceneNumberFill(frontmatter, this.plugin.settings, this.patternPrefix);
                    const stage = sceneVitals(frontmatter, this.plugin.settings, new Date()).stage;
                    const stageColors: Record<string, string> = this.plugin.settings.publishStageColors;
                    const color = fill.startsWith('url(') ? stageColors[stage] : fill;
                    if (color) panel.setCssProps({ '--ert-timetable-portrait-color': color });
                }
                const header = panel.createDiv({ cls: 'ert-timetable-panels__header' });
                if (portrait || (row.kind === 'scene' && people.length > 0)) {
                    const handle = row.kind === 'scene' ? this.attachSceneDrag(panel, header, row.path, mode.state) : null;
                    const cover = handle ?? header.createDiv();
                    cover.addClass('ert-timetable-panels__cover');
                    cover.toggleClass('is-missing', !portrait);
                    const placeholder = cover.createSpan({ cls: 'ert-timetable-panels__cover-placeholder', attr: { 'aria-hidden': 'true' } });
                    setIcon(placeholder, 'user-round');
                    if (portrait) {
                        const image = cover.createEl('img', { cls: 'ert-timetable-panels__cover-image', attr: { alt: '', src: portrait, draggable: 'false' } });
                        this.panelEvents?.registerDomEvent(image, 'error', () => cover.addClass('is-missing'));
                    }
                } else if (row.kind === 'scene') this.attachSceneDrag(panel, header, row.path, mode.state);
                const heading = header.createDiv({ cls: 'ert-timetable-panels__heading' });
                const title = heading.createDiv({ cls: 'ert-timetable-panels__title-line' });
                if (row.prefix) title.createSpan({ cls: 'ert-timetable-panels__number', text: row.prefix });
                title.createEl('strong', { cls: 'ert-timetable-panels__title', text: displayName(row.basename) });
                if (row.kind === 'sketch') title.createSpan({ cls: 'ert-timetable-panels__kind', text: t('ui.timetable.panelSketch') });
                const when = readWhen(frontmatter, this.plugin.settings);
                const durationRaw = frontmatterKey(frontmatter, authorKeyFor('Duration', this.plugin.settings));
                const duration = typeof durationRaw === 'string' ? formatCompactDuration(durationRaw) ?? durationRaw : null;
                if (when.when) {
                    const date = this.formatWhen(when.when, when.hasClock, mode.chronologue?.profile ?? null);
                    const dateLine = heading.createDiv({ cls: 'ert-timetable-panels__date' });
                    setIcon(dateLine.createSpan({ cls: 'ert-timetable-panels__date-icon' }), 'calendar-days');
                    dateLine.createSpan({ text: duration ? `${date} · ${duration}` : date });
                }
                const open = panel.createEl('button', { cls: 'ert-timetable-panels__open clickable-icon', attr: { type: 'button' } });
                setIcon(open, 'external-link');
                setAccessibleLabel(open, t('ui.timetable.panelOpen'));
                setTooltip(open, t('ui.timetable.panelOpen'));
                this.panelEvents?.registerDomEvent(open, 'click', (evt: MouseEvent) => { evt.stopPropagation(); void openFromTimetable(this.plugin.app, entry.file, evt, this.rootEl); });
                const meta = panel.createDiv({ cls: 'ert-timetable-panels__meta' });
                for (const name of row.subplots) {
                    const chip = meta.createSpan({ cls: 'ert-timetable-panels__subplot', text: name });
                    const color = layout?.colorIndex.get(name);
                    if (color !== undefined) chip.setCssProps({ '--ert-timetable-panel-color': `var(--rt-subplot-colors-${color})` });
                }
                if (mode.state.mode === 'chronologue' && row.act !== null) meta.createSpan({ cls: 'ert-timetable-panels__act', text: this.actLabel(row.act) });
                if (people.length) {
                    const peopleList = panel.createDiv({ cls: 'ert-timetable-panels__characters' });
                    setTooltip(peopleList, people.map(person => person.name).join(' · '));
                    for (const [index, person] of people.entries()) {
                        const character = peopleList.createSpan({ cls: 'ert-timetable-panels__character' });
                        if (index > 0) character.createSpan({ cls: 'ert-timetable__character-separator', text: '·', attr: { 'aria-hidden': 'true' } });
                        if (person.image && person.image !== portrait) {
                            const image = character.createEl('img', { cls: 'ert-timetable-panels__portrait', attr: { alt: '', src: person.image } });
                            this.panelEvents?.registerDomEvent(image, 'error', () => image.remove());
                        }
                        this.renderCharacterName(character, person, this.shortCharacterName(person.name));
                    }
                }
                if (row.kind === 'beat') {
                    const purpose = readBeatPurpose(frontmatter ?? null);
                    if (purpose) panel.createDiv({ cls: 'ert-timetable-panels__purpose', text: purpose });
                } else if (row.kind === 'scene') {
                    const vitals = sceneVitals(frontmatter, this.plugin.settings, new Date());
                    meta.createSpan({ text: vitals.stage });
                    const synopsis = panel.createEl('button', { cls: 'ert-timetable-panels__synopsis', text: vitals.synopsis ?? t('ui.timetable.panelAddSynopsis') });
                    synopsis.toggleClass('is-empty', vitals.synopsis === null);
                    this.panelEvents?.registerDomEvent(synopsis, 'click', evt => { evt.stopPropagation(); this.editPanelSynopsis(item, synopsis); });
                } else if (row.kind === 'sketch') {
                    const toggle = panel.createEl('button', { cls: 'ert-timetable__drawer-toggle', text: this.drawerIsOpen(row.path) ? t('ui.timetable.panelCloseSketch') : t('ui.timetable.panelExpandSketch') });
                    toggle.setAttr('aria-expanded', String(this.drawerIsOpen(row.path)));
                    if (this.drawerIsOpen(row.path)) {
                        const holder = panel.createDiv({ cls: 'ert-timetable__drawer-row' });
                        const drawer = this.drawerFor(entry.file);
                        holder.appendChild(drawer.el);
                        drawer.renderBar(row, frontmatter, layout);
                        keep.add(row.path);
                        if (this.focusPath === row.path) {
                            this.focusPath = null;
                            if (this.focusField === 'title') drawer.focusTitle(); else drawer.focusEditor();
                            this.focusField = 'text';
                        }
                    } else {
                        const preview = panel.createDiv({ cls: 'ert-timetable-panels__preview' });
                        void this.plugin.app.vault.cachedRead(entry.file).then(content => {
                            if (!preview.isConnected) return;
                            const info = getFrontMatterInfo(content);
                            preview.setText(content.slice(info.exists ? info.contentStart : 0).trim());
                        });
                    }
                }
            }
        }
        this.pruneDrawers(keep);
        this.setCurrentRow(currentNotePath());
        this.markRing(this.ringSpotlight);
        this.markPicks();
    }

    /** Character notes may optionally name a vault image in their Image property. */
    private characterDetails(scenePath: string, names: string[]): Array<{ name: string; image: string | null; file: TFile | null }> {
        return names.map(raw => {
            const link = raw.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '');
            const [path, alias] = link.split('|');
            const character = this.plugin.app.metadataCache.getFirstLinkpathDest(path.trim(), scenePath);
            let imageUrl: string | null = null;
            if (character) {
                const fm = this.plugin.app.metadataCache.getFileCache(character)?.frontmatter;
                const imageValue = frontmatterKey(fm, 'Image');
                if (typeof imageValue === 'string') {
                    const imagePath = imageValue.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
                    const image = this.plugin.app.metadataCache.getFirstLinkpathDest(imagePath, character.path);
                    if (image && /^(png|jpe?g|gif|webp|avif)$/i.test(image.extension)) {
                        imageUrl = this.plugin.app.vault.getResourcePath(image);
                    }
                }
            }
            return { name: (alias ?? path).trim(), image: imageUrl, file: character };
        });
    }

    private renderCharacterName(host: HTMLElement, person: { name: string; file: TFile | null }, label: string): void {
        if (!person.file) {
            host.createSpan({ text: label });
            return;
        }
        const file = person.file;
        const link = host.createEl('a', { cls: 'ert-timetable__character-link', text: label, attr: { href: file.path } });
        this.panelEvents?.registerDomEvent(link, 'click', (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            void openFromTimetable(this.plugin.app, file, evt, this.rootEl);
        });
    }

    private shortCharacterName(name: string): string {
        return Array.from(name).slice(0, 6).join('').trimEnd();
    }

    private editPanelSynopsis(item: TableItem, button: HTMLButtonElement): void {
        if (this.panelEditing) return;
        const fm = item.frontmatter ?? {};
        const original = fm[synopsisKey(fm, this.plugin.settings)];
        if (original !== undefined && typeof original !== 'string') {
            new Notice(t('ui.timetable.panelSynopsisType'));
            return;
        }
        this.panelEditing = { path: item.row.path, original };
        const editor = button.parentElement?.createDiv({ cls: 'ert-timetable-panels__editor' });
        if (!editor) { this.panelEditing = null; return; }
        button.hide();
        const input = editor.createEl('textarea');
        input.value = original ?? '';
        setAccessibleLabel(input, t('ui.timetable.panelSynopsis'));
        const save = editor.createEl('button', { text: t('ui.timetable.panelSave'), cls: 'ert-timetable-panels__save' });
        const cancel = editor.createEl('button', { text: t('ui.timetable.panelCancel') });
        this.panelEvents?.registerDomEvent(cancel, 'click', evt => { evt.stopPropagation(); this.panelEditing = null; this.render(); });
        this.panelEvents?.registerDomEvent(save, 'click', evt => { evt.stopPropagation(); void (async () => {
            save.disabled = true;
            cancel.disabled = true;
            let updated = false;
            try {
                await this.plugin.app.fileManager.processFrontMatter(item.entry.file, fmNow => {
                    updated = updateSynopsis(fmNow, this.plugin.settings, original, input.value);
                });
                if (!updated) { new Notice(t('ui.timetable.panelConflict')); save.disabled = false; cancel.disabled = false; return; }
                this.panelEditing = null;
                this.render();
            } catch (error) {
                console.error('Synopsis save failed', error);
                new Notice(t('ui.timetable.panelSaveFailed'));
                save.disabled = false;
                cancel.disabled = false;
            }
        })(); });
        input.focus();
    }

    /** Drop immediately before a scene using the selected mode's placement operation. */
    private attachSceneDrag(row: HTMLElement, host: HTMLElement, path: string, state: TimelineModeState): HTMLButtonElement | null {
        const activeBook = getActiveBook(this.plugin.settings);
        const unavailable = (state.mode !== 'narrative' && state.mode !== 'chronologue') || state.runtime || state.shift || state.alt
            || this.config.getSort().length > 0 || getTimelineScope(this.plugin.settings) !== 'book'
            || !activeBook || getBookIdForPath(this.plugin.settings.books, path) !== activeBook.id;
        const handle = host.createEl('button', { cls: 'ert-timetable__drag clickable-icon', attr: { draggable: String(!unavailable), type: 'button' } });
        const label = t(unavailable ? 'ui.timetable.panelDragHint' : 'ui.timetable.panelDrag');
        setAccessibleLabel(handle, label);
        setIcon(handle, 'grip-vertical');
        if (unavailable) {
            handle.addClass('is-unavailable');
            handle.setAttr('aria-disabled', 'true');
            setTooltip(handle, label);
            this.panelEvents?.registerDomEvent(handle, 'click', evt => { evt.preventDefault(); evt.stopPropagation(); new Notice(label); });
            return handle;
        }
        this.panelEvents?.registerDomEvent(handle, 'dragstart', (evt: DragEvent) => {
            if (!evt.dataTransfer) return;
            this.draggedScene = path;
            evt.dataTransfer.effectAllowed = 'move';
            evt.dataTransfer.setData('text/plain', path);
        });
        this.panelEvents?.registerDomEvent(handle, 'dragend', () => {
            this.draggedScene = null;
            this.rootEl.querySelectorAll('.ert-timetable__drop-before').forEach(el => el.removeClass('ert-timetable__drop-before'));
        });
        this.panelEvents?.registerDomEvent(row, 'dragover', (evt: DragEvent) => {
            if (!this.draggedScene || this.draggedScene === path) return;
            const books = this.plugin.settings.books ?? [];
            const sourceBook = getBookIdForPath(books, this.draggedScene);
            if (!sourceBook || sourceBook !== getBookIdForPath(books, path)) return;
            evt.preventDefault();
            if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
            row.addClass('ert-timetable__drop-before');
        });
        this.panelEvents?.registerDomEvent(row, 'dragleave', (evt: DragEvent) => {
            if (!(evt.relatedTarget instanceof Node) || !row.contains(evt.relatedTarget)) row.removeClass('ert-timetable__drop-before');
        });
        this.panelEvents?.registerDomEvent(row, 'drop', evt => {
            const source = this.draggedScene;
            if (!source || source === path || !row.hasClass('ert-timetable__drop-before')) return;
            evt.preventDefault();
            evt.stopPropagation();
            row.removeClass('ert-timetable__drop-before');
            this.draggedScene = null;
            void this.placeTimetableScene(state.mode, source, path).then(handled => {
                if (!handled) new Notice(t('ui.timetable.panelDragUnavailable'));
            }).catch(error => { console.error('Timetable scene placement failed', error); new Notice(t('ui.timetable.panelDragUnavailable')); });
        });
        return handle;
    }

    /** Use the same move dialogs and write paths even when no timeline is visible. */
    private async placeTimetableScene(mode: string, source: string, target: string): Promise<boolean> {
        if (this.scenePlacementInProgress || (mode !== 'narrative' && mode !== 'chronologue')) return false;
        const books = this.plugin.settings.books ?? [];
        const bookId = getBookIdForPath(books, source);
        const book = books.find(candidate => candidate.id === bookId);
        if (!book || book.id !== getActiveBook(this.plugin.settings)?.id || bookId !== getBookIdForPath(books, target)) return false;
        this.scenePlacementInProgress = true;
        try {
            const sceneData = await this.plugin.getSceneData({ sourcePath: book.sourceFolder });
            const svg = this.rootEl.doc.win.createSvg('svg');
            const renderScope = new Component();
            const onRefresh = () => { this.plugin.refreshTimelineIfNeeded(null, 100); this.refresh(); };
            if (mode === 'chronologue') {
                const controller = new ChronologueDragController({ plugin: this.plugin, sceneData, renderScope,
                    chronologueState: { shift: false, alien: false } }, svg, { onRefresh });
                return await controller.placeFromTimetable(source, target);
            }
            const controller = new OuterRingDragController({ plugin: this.plugin, renderScope }, svg, { onRefresh, mode });
            const order = timetableNarrativeOrder(sceneData, resolveSelectedBeatModelFromSettings(this.plugin.settings));
            return await controller.placeFromTimetableOrder(source, target, order);
        } finally {
            this.scenePlacementInProgress = false;
        }
    }

    /** A small + that creates a sketch in this act (and this book). */
    private renderNewSketchButton(container: HTMLElement, act: number | null | undefined, bookId: string | undefined, label: string): void {
        if (!bookId) return;
        const button = container.createEl('button', { cls: 'ert-timetable__new-sketch ert-timetable__new-sketch--inline clickable-icon' });
        if (act !== undefined && act !== null) button.dataset.act = String(act);
        button.dataset.bookId = bookId;
        setAccessibleLabel(button, t('ui.timetable.newSketchIn', { group: label }));
        setIcon(button, 'plus');
        setAccessibleLabel(button, t('ui.timetable.newSketchIn', { group: label }));
    }

    private renderDrawer(body: HTMLElement, item: TableItem, layout: RingLayout | null, columnCount: number): void {
        const drawer = this.drawerFor(item.entry.file);
        const cell = body.createEl('tr', { cls: 'ert-timetable__drawer-row' }).createEl('td');
        cell.colSpan = columnCount;
        cell.appendChild(drawer.el);
        drawer.renderBar(item.row, item.frontmatter, layout);
        if (this.focusPath === item.row.path) {
            this.focusPath = null;
            if (this.focusField === 'title') drawer.focusTitle();
            else drawer.focusEditor();
            this.focusField = 'text';
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
     * False when a newer draw took over before this one finished.
     */
    private async decorateFromBodies(items: TableItem[]): Promise<boolean> {
        const generation = ++this.decorateGeneration;
        for (const item of items) {
            if (item.row.kind === 'beat' || item.row.kind === 'otherClass') continue;
            const content = await this.plugin.app.vault.cachedRead(item.entry.file);
            if (generation !== this.decorateGeneration) return false;
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
        return true;
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

    private renderRow(body: HTMLElement, item: TableItem, columns: Column[], layout: RingLayout | null, columnCount: number, cells: CellContext): void {
        const { row, frontmatter } = item;
        const { mode } = cells;
        const tr = body.createEl('tr', { cls: ['ert-timetable__row', `is-${row.kind === 'otherClass' ? 'other-class' : row.kind}`] });
        tr.setAttr('data-path', row.path);
        this.rowEls.set(row.path, tr);
        this.rowItems.set(row.path, item);
        // Gossamer: beats come forward, everything else recedes.
        const gossamer = mode.state.mode === 'gossamer';
        if (gossamer && row.kind !== 'beat') tr.addClass('is-receded');
        this.renderNumberCell(tr.createEl('td', { cls: 'ert-timetable__num' }).createDiv({ cls: 'ert-timetable__num-inner' }), item, cells.today);
        if (row.kind === 'scene') {
            const wrap = tr.querySelector<HTMLElement>('.ert-timetable__chip-wrap');
            const handle = wrap ? this.attachSceneDrag(tr, wrap, row.path, mode.state) : null;
            if (handle && wrap) {
                wrap.addClass('has-drag');
                handle.addClass('ert-timetable__chip-drag');
                const svg = wrap.querySelector<SVGSVGElement>('svg');
                const width = 38 + Math.max(0, (row.prefix?.length ?? 0) - 3) * 7;
                svg?.setAttribute('viewBox', `0 0 ${width} 22`);
                svg?.setAttribute('width', String(width));
                svg?.querySelector('rect')?.setAttribute('width', String(width - 2));
                svg?.querySelector('text')?.setAttribute('x', String((width + 16) / 2));
            }
        }

        if (row.kind === 'beat') {
            // Beats run across the table as quiet dividers, as on the wheel.
            const cell = tr.createEl('td', { cls: 'ert-timetable__beat' });
            cell.colSpan = columnCount - 1;
            cell.dataset.column = 'beat';
            cell.createSpan({ cls: 'ert-timetable__beat-title', text: displayName(row.basename) });
            const model = firstText(frontmatterKey(frontmatter, 'Beat Model'));
            if (model) cell.createSpan({ cls: 'ert-timetable__beat-model', text: model });
            if (gossamer) this.renderGossamerScore(cell, frontmatter);
            const purpose = readBeatPurpose(frontmatter ?? null);
            if (purpose) cell.createSpan({ cls: 'ert-timetable__beat-purpose', text: purpose });
        } else {
            if (layout) this.renderRingsCell(tr.createEl('td', { cls: 'ert-timetable__rings' }), row, layout);
            columns.forEach((column, index) => {
                const cell = tr.createEl('td');
                cell.dataset.col = String(index);
                cell.dataset.column = column.kind === 'property' ? column.property : column.kind;
                if (column.kind === 'property') this.renderValueCell(cell, item, column.property, cells);
                else this.renderMicroCell(cell, row, column.kind, mode);
            });
        }
    }

    private renderTimeReferences(body: HTMLElement, item: TableItem, columnCount: number): void {
        if (!this.expandedReferences.has(item.row.path)) return;
        const snapshot = readTimeReferences(item.frontmatter?.[TIME_REFERENCES_KEY], item.row.path);
        const icons = { enacted: 'clapperboard', recollection: 'history', mention: 'scroll-text', possibility: 'telescope' };
        for (const reference of snapshot.references) {
            const row = body.createEl('tr', { cls: 'ert-time-reference-row' });
            row.dataset.referenceKey = reference.key;
            row.dataset.sourcePath = reference.path;
            row.toggleClass('is-reference-selected', currentReferenceSelection()?.key === reference.key);
            const cell = row.createEl('td'); cell.colSpan = columnCount;
            const button = cell.createEl('button', { cls: 'ert-time-reference-open' });
            setIcon(button.createSpan(), icons[reference.kind]);
            button.createSpan({ text: reference.label });
            button.createSpan({ cls: 'ert-time-reference-date', text: this.modeState().alt ? `${referenceDateLabel(reference)} · ${t('timeReferences.earthCalendar')}` : referenceDateLabel(reference) });
            button.createSpan({ text: t(`timeReferences.kinds.${reference.kind}`) });
            tooltip(button, [reference.passage, displayName(item.row.basename)].filter(Boolean).join(' · '));
        }
        const cell = body.createEl('tr', { cls: 'ert-time-reference-row' }).createEl('td'); cell.colSpan = columnCount;
        if (snapshot.problems.length) cell.createSpan({ text: snapshot.problems[0].index < 0
            ? t('timeReferences.invalidArray') : t('timeReferences.invalidEntry', { number: snapshot.problems[0].index + 1 }) });
        const manage = cell.createEl('button', { text: t('timeReferences.manage') });
        manage.dataset.timeReferenceManage = item.row.path;
    }

    /**
     * The number cell: the number on the scene's status fill, then the row's
     * control panel (see renderControls). Time references and query counts
     * follow on the rows that have them.
     */
    private renderNumberCell(cell: HTMLElement, item: TableItem, today: Date): void {
        const { row, frontmatter } = item;
        const chip = cell.createDiv({ cls: 'ert-timetable__chip-wrap' }).createDiv({ cls: 'ert-timetable__chip' });
        const svg = chip.createSvg('svg', { attr: { viewBox: '0 0 40 22', width: '40', height: '22', 'aria-hidden': 'true' } });
        const rect = svg.createSvg('rect', { cls: 'ert-timetable__chip-cell', attr: { x: '1', y: '1', width: '38', height: '20', rx: '3' } });
        if (row.kind === 'scene') rect.setAttribute('fill', sceneNumberFill(frontmatter, this.plugin.settings, this.patternPrefix));
        const label = svg.createSvg('text', {
            cls: 'ert-timetable__chip-text',
            attr: { x: '20', y: '11.5', 'text-anchor': 'middle', 'dominant-baseline': 'central' },
        });
        label.textContent = row.prefix ?? '–';
        tooltip(chip, this.chipTooltip(row, frontmatter, today), 'right');
        if (row.kind === 'scene') {
            chip.addClass('ert-timetable__pick');
            chip.dataset.pick = 'status';
            chip.setAttr('role', 'button');
            chip.setAttr('aria-haspopup', 'menu');
        }

        if (SELECTABLE_KINDS.has(row.kind)) this.renderControls(cell, item, today);
        if (row.kind === 'scene' && frontmatter?.[TIME_REFERENCES_KEY] !== undefined) {
            const toggle = cell.createEl('button', { cls: 'ert-time-reference-toggle clickable-icon' });
            const count = readTimeReferences(frontmatter[TIME_REFERENCES_KEY], row.path).references.length;
            toggle.setAttr('aria-expanded', String(this.expandedReferences.has(row.path)));
            setAccessibleLabel(toggle, t('timeReferences.references', { count }));
            setIcon(toggle, this.expandedReferences.has(row.path) ? 'chevron-down' : 'history');
        }
    }

    /**
     * A row's control panel beside its number, each control in its own place
     * so they line up down the table:
     * - the stage letter (a sketch's chevron), which the checkbox replaces on
     *   hover and while rows are picked;
     * - a pencil while Pending Edits holds text, and a Synopsis icon: hover
     *   either to read it in full without scrolling to its column;
     * - for a scene, the due dot, which + (a day later) and ++ (a week later)
     *   replace on hover until the scene is complete; for a sketch or an
     *   unclassed note, Promote.
     */
    private renderControls(cell: HTMLElement, item: TableItem, today: Date): void {
        const { row, frontmatter } = item;
        const { settings } = this.plugin;
        const vitals = sceneVitals(frontmatter, settings, today);

        const slot = cell.createSpan({ cls: 'ert-timetable__slot' });
        if (row.kind === 'scene') {
            const letter = slot.createSpan({ cls: 'ert-timetable__stage', text: vitals.stage.charAt(0).toUpperCase() });
            const colors: Record<string, string> = settings.publishStageColors;
            const color = colors[vitals.stage];
            if (color) letter.setCssProps({ '--ert-timetable-stage': color });
        }
        if (row.kind === 'sketch') {
            const open = this.drawerIsOpen(row.path);
            const toggle = slot.createEl('button', { cls: 'ert-timetable__drawer-toggle clickable-icon' });
            toggle.setAttr('aria-expanded', String(open));
            setAccessibleLabel(toggle, t('ui.timetable.toggleSketch'));
            setIcon(toggle, open ? 'chevron-down' : 'chevron-right');
        }
        const checkbox = slot.createEl('input', { cls: 'ert-timetable__select', type: 'checkbox' });
        checkbox.checked = this.selected.has(row.path);
        setAccessibleLabel(checkbox, t('ui.timetable.bulkPick', { name: displayName(row.basename) }));
        cell.closest('tr')?.toggleClass('is-selected', checkbox.checked);

        this.renderTextControl(cell, 'pending', 'pencil-line', vitals.pending === null ? null : t('ui.timetable.vitalsPending', { text: vitals.pending }));
        this.renderTextControl(cell, 'synopsis', 'align-left', t('ui.timetable.synopsisFull', { text: vitals.synopsis ?? t('ui.timetable.synopsisEmpty') }), vitals.synopsis === null);

        const last = cell.createSpan({ cls: 'ert-timetable__due-slot' });
        if (row.kind !== 'scene') {
            const promote = last.createEl('button', { cls: 'ert-timetable__promote clickable-icon' });
            setIcon(promote, 'file-up');
            setAccessibleLabel(promote, t('ui.timetable.promote'));
            return;
        }
        if (vitals.due.kind === 'late' || vitals.due.kind === 'soon') last.createSpan({ cls: ['ert-timetable__due-dot', `is-${vitals.due.kind}`] });
        if (vitals.complete) return;
        const steps = last.createSpan({ cls: 'ert-timetable__due-steps' });
        for (const [text, days, label] of [['+', 1, t('ui.timetable.dueStepDay')], ['++', 7, t('ui.timetable.dueStepWeek')]] as const) {
            const step = steps.createEl('button', { cls: 'ert-timetable__due-step', text });
            step.dataset.days = String(days);
            tooltip(step, label, 'bottom');
        }
    }

    /**
     * The pencil, only while Pending Edits holds text (otherwise its place
     * stays empty, so the icons line up), or the Synopsis icon, on every row
     * and fainter when the Synopsis is empty.
     */
    private renderTextControl(cell: HTMLElement, kind: 'pending' | 'synopsis', icon: string, label: string | null, empty = false): void {
        const control = cell.createSpan({ cls: ['ert-timetable__text-control', `is-${kind}`] });
        if (label === null) return;
        control.dataset.peek = kind;
        control.toggleClass('is-empty', empty);
        setIcon(control, icon);
        setAccessibleLabel(control, label);
    }

    private chipTooltip(row: TimetableRow, frontmatter: Record<string, unknown> | undefined, today: Date): string {
        switch (row.kind) {
            case 'scene': {
                const status = normalizeStatus(frontmatterKey(frontmatter, 'Status'));
                const vitals = sceneVitals(frontmatter, this.plugin.settings, today);
                const overdue = vitals.due.kind === 'late';
                const label = overdue ? t('ui.timetable.statusOverdue') : (status === 'Completed' ? 'Complete' : (status || 'Todo'));
                const parts = [t('ui.timetable.sceneStatus', { status: label, stage: vitals.stage })];
                if (vitals.due.kind === 'late' || vitals.due.kind === 'soon') parts.push(t('ui.timetable.vitalsDue', { when: formatDueLabel(vitals.due, today) }));
                return parts.join(' · ');
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

    /** Shift's gap since the previous dated row, or the runtime view's running time. */
    private renderMicroCell(cell: HTMLElement, row: TimetableRow, kind: 'gap' | 'running', mode: ModeContext): void {
        cell.addClass('ert-timetable__micro');
        const { chronologue } = mode;
        if (kind === 'gap') {
            if (!chronologue) return;
            const gap = chronologue.gap.get(row.path);
            if (typeof gap !== 'number') return;
            const text = chronologue.profile ? formatElapsedTimePlanetary(gap, chronologue.profile) : formatElapsedTime(gap);
            cell.setText(`+${text}`);
            return;
        }
        const total = mode.running?.get(row.path);
        if (row.kind === 'scene' && typeof total === 'number' && total > 0) cell.setText(formatRuntimeValue(total));
    }

    /** Gossamer: a beat's latest score for the selected signal, its change, and its expected range. */
    private renderGossamerScore(cell: HTMLElement, frontmatter: Record<string, unknown> | undefined): void {
        const badge = cell.createSpan({ cls: 'ert-timetable__gossamer' });
        const latest = latestGossamerScore(frontmatter ?? {}, this.plugin.gossamerSelectedSignal);
        if (!latest) {
            badge.addClass('is-empty');
            badge.setText(t('ui.timetable.gossamerNotScored'));
            return;
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
        if (latest.justification) tooltip(badge, t('ui.gossamerScoreModal.latestJustification', { justification: latest.justification }), 'bottom');
    }

    private renderValueCell(cell: HTMLElement, item: TableItem, property: BasesPropertyId, cells: CellContext): void {
        const { entry, frontmatter, row } = item;
        const { mode } = cells;
        const { type, name } = parsePropertyId(property);
        if (type === 'file' && name === 'name') {
            cell.addClass('ert-timetable__name');
            cell.setText(displayName(entry.file.basename));
            return;
        }
        if (type === 'note' && this.isWhenProperty(name)) {
            this.renderWhenCell(cell, item, name, cells);
            return;
        }
        const value = entry.getValue(property);
        const empty = !value || !value.isTruthy();
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        const canonical = type === 'note' ? canonicalizeFrontmatterKey(name, mappings) : '';
        if (!empty && !this.renderReadout(cell, item, canonical, name, cells)) value.renderTo(cell, this.plugin.app.renderContext);
        if (!empty && canonical === 'Character') this.renderCompactCharacters(cell, item, name);
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

    /** Compact character names and open their notes in the timetable reading pane. */
    private renderCompactCharacters(cell: HTMLElement, item: TableItem, property: string): void {
        const raw = frontmatterKey(item.frontmatter, property);
        const values = Array.isArray(raw) ? raw : [raw];
        if (!values.every((value): value is string => typeof value === 'string' && value.trim().length > 0)) return;
        const people = this.characterDetails(item.row.path, values);
        cell.empty();
        cell.addClass('ert-timetable__characters');
        setTooltip(cell, people.map(person => person.name).join(' · '));
        people.forEach((person, index) => {
            const character = cell.createSpan({ cls: 'ert-timetable__character' });
            if (index > 0) character.createSpan({ cls: 'ert-timetable__character-separator', text: '·', attr: { 'aria-hidden': 'true' } });
            if (person.image) {
                const image = character.createEl('img', { cls: 'ert-timetable__character-image', attr: { alt: '', src: person.image } });
                this.panelEvents?.registerDomEvent(image, 'error', () => image.remove());
            }
            const shortName = this.shortCharacterName(person.name);
            this.renderCharacterName(character, person, shortName);
        });
    }

    /**
     * When, short: "Fri Apr 6 · 7PM", the year left to the header when every
     * row shares it, and the Duration beside it while its own column is hidden.
     * Hover shows the long form and the Duration as written.
     */
    private renderWhenCell(cell: HTMLElement, item: TableItem, name: string, cells: CellContext): void {
        const raw = frontmatterKey(item.frontmatter, name);
        const text = typeof raw === 'string' ? raw.trim() : '';
        const when = text ? parseWhenField(text) : null;
        cell.addClass('ert-timetable__when');
        if (!when) {
            cell.setText(text);
            return;
        }
        const hasClock = whenTextHasClock(text);
        const profile = cells.mode.chronologue?.profile ?? null;
        const full = this.formatWhen(when, hasClock, profile);
        cell.createSpan({ text: profile ? full : formatTableWhen(when, hasClock, cells.whenYear === null) });
        const durationRaw = cells.durationInWhen ? frontmatterKey(item.frontmatter, authorKeyFor('Duration', this.plugin.settings)) : undefined;
        const duration = typeof durationRaw === 'string' ? durationRaw.trim() : '';
        const compact = duration ? formatCompactDuration(duration) : null;
        if (compact) cell.createSpan({ cls: 'ert-timetable__duration', text: compact });
        tooltip(cell, compact ? `${full} · ${duration}` : full, 'bottom');
    }

    /**
     * Columns that read better drawn than written: Due as relative time, Words
     * with a bar against the book's median, Runtime and Iteration as badges.
     * False leaves the cell to Obsidian's own rendering.
     */
    private renderReadout(cell: HTMLElement, item: TableItem, canonical: string, name: string, cells: CellContext): boolean {
        const { settings } = this.plugin;
        const { frontmatter, row } = item;
        if (canonical === 'Due') {
            const complete = normalizeStatus(frontmatterKey(frontmatter, authorKeyFor('Status', settings))) === 'Completed';
            const due = dueStatus(frontmatterKey(frontmatter, name), complete, cells.today);
            if (due.kind === 'none') return false;
            this.renderDue(cell, due, cells.today);
            return true;
        }
        if (canonical === 'Words' && row.kind === 'scene') {
            const words = Number(frontmatterKey(frontmatter, name));
            const median = cells.wordMedians.get(getBookIdForPath(settings.books ?? [], row.path) ?? '');
            if (!Number.isFinite(words) || words <= 0 || median === undefined) return false;
            this.renderWords(cell, words, median);
            return true;
        }
        if (canonical === 'Runtime') {
            const seconds = readRuntimeSeconds(frontmatter, settings);
            if (seconds === null || seconds <= 0) return false;
            this.renderBadge(cell, 'timer', formatRuntimeValue(seconds));
            return true;
        }
        if (canonical === 'Iteration') {
            const iteration = Number(firstText(frontmatterKey(frontmatter, name)));
            if (!Number.isFinite(iteration)) return false;
            this.renderBadge(cell, 'repeat', iteration.toLocaleString(getFormattingLocale()));
            return true;
        }
        return false;
    }

    /** Due: "4 days ago" (late), "tomorrow" (within a week), the date further out, a check and the day for a complete scene. */
    private renderDue(cell: HTMLElement, due: Exclude<DueStatus, { kind: 'none' }>, today: Date): void {
        const label = cell.createSpan({ cls: ['ert-timetable__due', `is-${due.kind}`] });
        if (due.kind === 'done') setIcon(label.createSpan({ cls: 'ert-timetable__due-icon' }), 'check');
        label.createSpan({ text: formatDueLabel(due, today) });
        tooltip(label, formatLongDate(due.date), 'bottom');
    }

    /** Words: the count, and a bar whose midpoint is the book's median scene (a full bar is twice it). */
    private renderWords(cell: HTMLElement, words: number, median: number): void {
        const locale = getFormattingLocale();
        const bar = wordBar(words, median);
        const wrap = cell.createSpan({ cls: 'ert-timetable__words' });
        wrap.createSpan({ cls: 'ert-timetable__words-count', text: words.toLocaleString(locale) });
        const track = wrap.createSpan({ cls: 'ert-timetable__words-bar' });
        track.toggleClass('is-over', bar.over);
        track.createSpan({ cls: 'ert-timetable__words-fill' }).setCssProps({ '--ert-timetable-words-fill': `${Math.round(bar.fill * 100)}%` });
        tooltip(wrap, t('ui.timetable.wordsVsMedian', {
            words: words.toLocaleString(locale),
            ratio: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(words / median),
            median: Math.round(median).toLocaleString(locale),
        }), 'bottom');
    }

    private renderBadge(cell: HTMLElement, icon: string, text: string): void {
        const badge = cell.createSpan({ cls: 'ert-timetable__badge' });
        setIcon(badge.createSpan({ cls: 'ert-timetable__badge-icon' }), icon);
        badge.createSpan({ text });
    }

    /** The When column, under the author's own key name when they mapped one. */
    private isWhenProperty(name: string): boolean {
        if (name.toLowerCase() === 'when') return true;
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        return mappings?.[name] === 'When';
    }
}
