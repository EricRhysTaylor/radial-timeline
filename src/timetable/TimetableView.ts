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
    MarkdownView,
    Menu,
    Notice,
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
import { t } from '../i18n';
import { getActiveBook, getBookIdForPath, getSagaBooks, getTimelineScope } from '../utils/books';
import { getConfiguredActCount, parseActLabels, resolveActLabel } from '../utils/acts';
import { canonicalizeFrontmatterKey, getActiveFrontmatterMappings, readBeatPurpose } from '../utils/frontmatter';
import { listAuthorQueries } from '../utils/authorQueryComments';
import { parseWhenField } from '../utils/date';
import { formatSceneWhen, whenTextHasClock } from '../utils/whenFormat';
import { normalizeStatus } from '../utils/text';
import { isOverdueDateString } from '../utils/date';
import { tooltip } from '../utils/tooltip';
import { mountSvgMarkup } from '../utils/svgDom';
import { renderDefs } from '../renderer/components/Defs';
import { computeCacheableValues } from '../renderer/utils/Precompute';
import type { PluginRendererFacade } from '../utils/sceneHelpers';
import { runPromotion } from '../services/PromoteToSceneEntry';
import {
    buildRingLayout,
    buildTableRow,
    compareManuscriptRows,
    displayName,
    sceneNumberFill,
    withActDividers,
    type RingLayout,
    type TimetableRow,
} from './timetableModel';
import { authorKeyFor, TIMETABLE_VIEW_TYPE } from './timetableFiles';
import { SketchDrawer, type SketchDrawerHost } from './SketchDrawer';
import { trackTimetable } from './timetableRegistry';
import { showSceneContextMenu } from '../view/interactions/SceneContextMenu';
import { readSubplotColor } from '../renderer/utils/subplotColors';
import type { BookProfile } from '../types/settings';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RINGS_PER_LINE_DEFAULT = 5;
const RINGS_REFRESH_DELAY_MS = 300;

/** Column widths (px). The number column holds the chevron, number cell, Promote and query count. */
const NUMBER_COLUMN_WIDTH = 132;
const OTHER_COLUMN_WIDTH = 140;
const MIN_COLUMN_WIDTH = 48;
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = { When: 220, Duration: 100, Chapter: 150, Synopsis: 360, Act: 56 };
const NAME_COLUMN_WIDTH = 220;

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
    ];
}

/**
 * Open a note from the table without covering the table: reveal it where it
 * is already open, otherwise use an editor tab or an empty tab in the main
 * area, otherwise split a pane beside the Timetable. Cmd/Ctrl-click always
 * opens a new tab.
 */
async function openFromTimetable(app: App, file: TFile, evt: MouseEvent, fromEl: HTMLElement): Promise<void> {
    if (Keymap.isModEvent(evt)) {
        await app.workspace.openLinkText(file.path, '', 'tab');
        return;
    }
    const markdownLeaves = app.workspace.getLeavesOfType('markdown')
        .filter(leaf => leaf.getRoot() === app.workspace.rootSplit);
    const showing = markdownLeaves.find(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    if (showing) {
        await app.workspace.revealLeaf(showing);
        app.workspace.setActiveLeaf(showing, { focus: true });
        return;
    }
    const emptyLeaves = app.workspace.getLeavesOfType('empty').filter(leaf => leaf.getRoot() === app.workspace.rootSplit);
    const target = markdownLeaves.find(leaf => !leaf.getViewState().pinned) ?? emptyLeaves[0];
    if (target) {
        await target.openFile(file, { active: true }); // SAFE: openFile used for opening in an existing editor or empty tab, so the Timetable tab itself is never replaced
        return;
    }
    const tableLeaf = app.workspace.getLeavesOfType('bases').find(leaf => leaf.view.containerEl.contains(fromEl));
    if (!tableLeaf) {
        await app.workspace.openLinkText(file.path, '', 'tab');
        return;
    }
    await app.workspace.createLeafBySplit(tableLeaf, 'vertical').openFile(file, { active: true }); // SAFE: openFile used for opening beside the Timetable rather than over it
}

function frontmatterKey(frontmatter: Record<string, unknown> | undefined, name: string): unknown {
    if (!frontmatter) return undefined;
    if (Object.prototype.hasOwnProperty.call(frontmatter, name)) return frontmatter[name];
    const lower = name.toLowerCase();
    const key = Object.keys(frontmatter).find(candidate => candidate.toLowerCase() === lower);
    return key === undefined ? undefined : frontmatter[key];
}

function firstText(value: unknown): string {
    const first: unknown = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first.trim() : (typeof first === 'number' ? String(first) : '');
}

export class TimetableView extends BasesView {
    type = TIMETABLE_VIEW_TYPE;
    private readonly rootEl: HTMLElement;
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
        // One set of delegated handlers: rows are redrawn on every data update.
        this.registerDomEvent(this.rootEl, 'click', (evt: MouseEvent) => this.handleClick(evt));
        this.registerDomEvent(this.rootEl, 'keydown', (evt: KeyboardEvent) => {
            if (evt.key !== 'Enter' && evt.key !== ' ') return;
            const toggle = evt.target instanceof Element ? evt.target.closest<HTMLElement>('.ert-timetable__group-toggle') : null;
            if (!toggle) return;
            evt.preventDefault();
            this.toggleGroup(toggle.dataset.groupId ?? '');
        });
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
    markLinkedRow(path: string | null): void {
        this.linkedRow?.removeClass('is-linked');
        this.linkedRow = path ? this.rowEls.get(path) ?? null : null;
        if (!this.linkedRow) return;
        this.linkedRow.addClass('is-linked');
        this.linkedRow.scrollIntoView({ block: 'nearest' });
    }

    /**
     * Right-click a scene's row for the same menu as right-clicking it on the
     * wheel. Other rows get Obsidian's own file menu, which includes Promote
     * for notes that can become scenes.
     */
    private handleContextMenu(evt: MouseEvent): void {
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
        const toItems = (entries: BasesEntry[]): TableItem[] => {
            const items = entries
                .filter(entry => entry.file.extension === 'md')
                .map(entry => {
                    const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(entry.file)?.frontmatter;
                    return { entry, frontmatter, row: buildTableRow(entry.file.path, entry.file.basename, frontmatter, settings) };
                });
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
        });
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
        this.linkedRow = null;
        this.synopsisFromBody.clear();
        const groups = this.buildGroups();
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
        const properties = this.config.getOrder();
        const columnCount = 1 + (showRings ? 1 : 0) + properties.length;

        const table = this.rootEl.createEl('table', { cls: 'ert-timetable__table' });
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
        for (const property of properties) addColumn(sizes[property] ?? this.defaultColumnWidth(property), property);
        table.setCssProps({ '--ert-timetable-rings-per-line': String(perLine), '--ert-timetable-width': `${tableWidth}px` });

        const headRow = table.createEl('thead').createEl('tr');
        // + New sketch lives in the number column's header, so it stays in reach while scrolling.
        this.renderHeaderNewSketch(headRow.createEl('th', { cls: 'ert-timetable__num-head' }));
        if (showRings && layout) this.renderRingsHeader(headRow.createEl('th', { cls: 'ert-timetable__rings-head' }), layout);
        for (const property of properties) {
            const header = headRow.createEl('th', { cls: 'ert-timetable__prop-head' });
            header.createSpan({ cls: 'ert-timetable__prop-label', text: this.config.getDisplayName(property) });
            const handle = header.createDiv({ cls: 'ert-timetable__resize' });
            handle.dataset.property = property;
        }

        const showGroupHeaders = groups.length > 1 || groups[0].label !== null;
        const openDrawers = new Set<string>();
        for (const group of groups) {
            const body = table.createEl('tbody', { cls: 'ert-timetable__group' });
            const collapsed = this.collapsed.has(group.id);
            const groupBook = this.singleBook(group.items);
            if (showGroupHeaders) this.renderGroupHeader(body, group, collapsed, columnCount, groupBook);
            if (collapsed) continue;
            const byPath = new Map(group.items.map(item => [item.row.path, item]));
            for (const line of withActDividers(group.items.map(item => item.row))) {
                if (line.type === 'act') {
                    const cell = body.createEl('tr', { cls: 'ert-timetable__act' }).createEl('td');
                    cell.colSpan = columnCount;
                    cell.createSpan({ text: this.actLabel(line.act) });
                    this.renderNewSketchButton(cell, line.act, groupBook, this.actLabel(line.act));
                    continue;
                }
                const item = byPath.get(line.row.path);
                if (!item) continue;
                this.renderRow(body, item, properties, showRings ? layout : null, columnCount);
                if (item.row.kind === 'sketch' && this.drawerIsOpen(item.row.path)) {
                    this.renderDrawer(body, item, layout, columnCount);
                    openDrawers.add(item.row.path);
                }
            }
        }
        this.pruneDrawers(openDrawers);
        if (scrollParent) scrollParent.scrollTop = scrollTop;
        void this.decorateFromBodies(allItems);
    }

    /** The one book a set of rows belongs to, if there is exactly one. */
    private singleBook(items: TableItem[]): string | undefined {
        const books = this.plugin.settings.books ?? [];
        const ids = new Set(items.map(item => getBookIdForPath(books, item.row.path)));
        if (ids.size !== 1) return undefined;
        const [id] = [...ids];
        return id;
    }

    private renderHeaderNewSketch(cell: HTMLElement): void {
        const button = cell.createEl('button', { cls: 'ert-timetable__new-sketch ert-timetable__new-sketch--header' });
        setIcon(button.createSpan({ cls: 'ert-timetable__new-sketch-icon' }), 'plus');
        button.createSpan({ text: t('ui.timetable.newSketch') });
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

    private renderGroupHeader(body: HTMLElement, group: TableGroup, collapsed: boolean, columnCount: number, bookId: string | undefined): void {
        const row = body.createEl('tr', { cls: 'ert-timetable__group-head' });
        const cell = row.createEl('td');
        cell.colSpan = columnCount;
        const toggle = cell.createDiv({ cls: 'ert-timetable__group-toggle' });
        toggle.setAttr('role', 'button');
        toggle.setAttr('tabindex', '0');
        toggle.setAttr('aria-expanded', String(!collapsed));
        setIcon(toggle.createSpan({ cls: 'ert-timetable__group-chevron' }), collapsed ? 'chevron-right' : 'chevron-down');
        toggle.createSpan({ cls: 'ert-timetable__group-label', text: group.label ?? '' });
        toggle.createSpan({ cls: 'ert-timetable__group-count', text: String(group.items.length) });
        toggle.dataset.groupId = group.id;
        // An act group, or a book group in the saga table, can take a new sketch.
        if (group.act !== undefined || group.id.startsWith('book:')) this.renderNewSketchButton(cell, group.act, bookId, group.label ?? '');
    }

    private renderRow(body: HTMLElement, item: TableItem, properties: BasesPropertyId[], layout: RingLayout | null, columnCount: number): void {
        const { row, frontmatter } = item;
        const tr = body.createEl('tr', { cls: ['ert-timetable__row', `is-${row.kind === 'otherClass' ? 'other-class' : row.kind}`] });
        tr.setAttr('data-path', row.path);
        this.rowEls.set(row.path, tr);
        this.renderNumberCell(tr.createEl('td', { cls: 'ert-timetable__num' }).createDiv({ cls: 'ert-timetable__num-inner' }), item);

        if (row.kind === 'beat') {
            // Beats run across the table as quiet dividers, as on the wheel.
            const cell = tr.createEl('td', { cls: 'ert-timetable__beat' });
            cell.colSpan = columnCount - 1;
            cell.createSpan({ cls: 'ert-timetable__beat-title', text: displayName(row.basename) });
            const model = firstText(frontmatterKey(frontmatter, 'Beat Model'));
            if (model) cell.createSpan({ cls: 'ert-timetable__beat-model', text: model });
            const purpose = readBeatPurpose(frontmatter ?? null);
            if (purpose) cell.createSpan({ cls: 'ert-timetable__beat-purpose', text: purpose });
        } else {
            if (layout) this.renderRingsCell(tr.createEl('td', { cls: 'ert-timetable__rings' }), row, layout);
            for (const property of properties) {
                this.renderValueCell(tr.createEl('td'), item, property);
            }
        }
    }

    private renderNumberCell(cell: HTMLElement, item: TableItem): void {
        const { row, frontmatter } = item;
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

    private renderValueCell(cell: HTMLElement, item: TableItem, property: BasesPropertyId): void {
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
            cell.setText(when ? formatSceneWhen(when, whenTextHasClock(text)) : text);
            return;
        }
        const value = entry.getValue(property);
        const empty = !value || !value.isTruthy();
        if (!empty) value.renderTo(cell, this.plugin.app.renderContext);
        // A sketch without a Synopsis shows its first line of text instead.
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        if (empty && row.kind === 'sketch' && type === 'note' && canonicalizeFrontmatterKey(name, mappings) === 'Synopsis') {
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
