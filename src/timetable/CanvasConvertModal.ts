import { AbstractInputSuggest, App, DropdownComponent, Notice, TFile, setIcon, stringifyYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { ErtModal } from '../ui/ErtModal';
import { authorKeyFor } from './timetableFiles';
import { getConfiguredActCount } from '../utils/acts';
import { canvasTextCards, linkSketches, repaintCards, sketchTitle, type StoryCanvasData, type CanvasCard, type CanvasTextCard } from './canvasSketches';
import { hasPortalReferences } from './canvasPortals';
import { t, tCount } from '../i18n';
import { readSceneId } from '../utils/sceneIds';
import { findFrontmatterKey } from '../utils/frontmatterKeys';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { buildTableRow, type TimetableRow } from './timetableModel';
import { SKETCH_AFTER_SCENE, SKETCH_ORDER, sketchAnchor, type PlacementItem } from './sketchPlacement';
import { actsFromActCards, canvasReadingOrder, planCanvasSketchAppend, spreadAcrossActs } from './canvasSketchOrdering';
import { actCardNumber } from './canvasNavigation';
import { bookPlacementItems, bookRingColors, ownColorsForNewSubplots, ringColorsWith } from './canvasBookCards';
import { cardColor, cardColorCounts, cardColorCss, cardColorHex, planCardColorSubplots, plansWaitOnAuthor, subplotForColor, type CardColorSubplot } from './canvasCardSubplots';
import { bookOwnSubplotColors, readSubplotColorHex, subplotColorOn, type SubplotColor } from '../renderer/utils/subplotColors';
import { ownSubplotColorsWritable, setOwnSubplotColor } from '../utils/ownSubplotColors';
import { getMainPlotName } from '../utils/mainPlot';
import { planActEndScenePrefixes } from '../services/SceneInsertService';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { addSceneIntakeTemplate } from './sceneIntakeTemplate';
import { cardColorStanding, directoryEntryNamed, paletteChoices, type CardColorStanding, type DirectoryEntry } from './canvasSubplotDirectory';
import { paletteHexes, readCanvasSubplotDirectory } from './CanvasSubplotMenu';
import { CanvasNewSubplotModal } from './CanvasNewSubplotModal';
import { forgetPendingSubplots, pendingSubplotsOn } from './canvasPendingSubplots';

/** Minimal, runtime-checked surface of Obsidian's Canvas view. */
export interface OpenCanvas {
    getData(): StoryCanvasData;
    setData(data: StoryCanvasData): void;
    requestSave(pushHistory?: boolean): void;
    selection?: Set<{ getData?: () => { id?: string; type?: string } }>;
}

/** An existing sketch given a position during conversion, kept so a failure can restore it. */
interface RankedSketch { file: TFile; key: string; rank: number; existed: boolean; value: unknown; act: number | null; anchor: string | null }

/** What the scenes will do to the book's subplots, as the dialog shows it and Create carries it out. */
interface SubplotOutcome {
    plans: Map<string, CardColorSubplot>;
    /** New subplots that keep their chosen color as their own, lower-case hex. */
    ownNew: Map<string, string>;
    /** Every ring's color once the scenes join the book. */
    after: Map<string, SubplotColor>;
}

function colorDot(parent: HTMLElement, css: string): HTMLElement {
    const dot = parent.createSpan({ cls: 'ert-canvas-sketch-swatch' });
    dot.setCssProps({ '--ert-canvas-sketch-swatch': css });
    return dot;
}

type SubplotSuggestion = { kind: 'entry'; entry: DirectoryEntry } | { kind: 'new' };

/**
 * The subplot directory beside a subplot name: the book's subplots and the
 * new ones waiting on this Canvas, each in its color, then New subplot…
 */
class SubplotSuggest extends AbstractInputSuggest<SubplotSuggestion> {
    constructor(app: App, private readonly input: HTMLInputElement, private readonly entries: () => DirectoryEntry[],
        private readonly onChoose: (name: string) => void, private readonly onNew: (typed: string) => void) {
        super(app, input);
    }

    protected getSuggestions(query: string): SubplotSuggestion[] {
        const typed = query.trim().toLowerCase();
        return [...this.entries().filter(entry => entry.name.toLowerCase().includes(typed)).map(entry => ({ kind: 'entry' as const, entry })), { kind: 'new' }];
    }

    renderSuggestion(suggestion: SubplotSuggestion, el: HTMLElement): void {
        el.addClass('ert-canvas-sketch-ring-option');
        if (suggestion.kind === 'new') { el.createSpan({ text: t('ui.canvasSketch.newSubplot') }); return; }
        colorDot(el, suggestion.entry.hex);
        el.createSpan({ text: suggestion.entry.name });
        if (suggestion.entry.pending) el.createSpan({ cls: 'ert-canvas-subplot-menu__note', text: t('ui.canvasSketch.pendingNote') });
    }

    selectSuggestion(suggestion: SubplotSuggestion): void {
        this.close();
        if (suggestion.kind === 'new') { this.onNew(this.input.value); return; }
        this.input.value = suggestion.entry.name;
        this.onChoose(suggestion.entry.name);
    }
}

/** Turn selected Canvas cards into scenes, which go straight onto the timeline, or into sketches. */
export class CanvasConvertModal extends ErtModal {
    private readonly cards: CanvasTextCard[];
    private readonly selected = new Set<string>();
    private book: BookProfile;
    private busy = false;
    private mode: 'scenes' | 'sketches' = 'scenes';
    /** A chosen act. Null means unassigned for sketches, and the Act cards or an even spread for scenes. */
    private act: number | null = null;
    private anchorPath: string | null = null;
    /** The book whose subplots below are read; Create waits until it is the chosen book. */
    private ringsBook: string | null = null;
    /** The book's subplots in ring order, then new subplots waiting on this Canvas. */
    private directory: DirectoryEntry[] = [];
    /** The palette, slot by slot, lower-case hex. */
    private palette: string[] = [];
    private rows: TimetableRow[] = [];
    /** The book's subplots that already wear their own color. */
    private own = new Map<string, string>();
    /** What the author typed or chose for each card color. */
    private readonly subplotByColor = new Map<string, string>();
    /** A palette color picked for a card color's new subplot. */
    private readonly paletteByColor = new Map<string, string>();
    /** Each card color as `#rrggbb` (null when the theme cannot show it as one), and what it means on the timeline. */
    private readonly cardHexes = new Map<string, string | null>();
    private readonly standings = new Map<string, CardColorStanding>();
    private sceneActs = new Map<string, number>();
    /** Per card color, its row and where the row says what happens to the cards' color. */
    private readonly colorStates = new Map<string, { row: HTMLElement; state: HTMLElement }>();
    private updateSubmit = (): void => {};

    constructor(app: App, private readonly plugin: RadialTimelinePlugin, private readonly canvas: OpenCanvas, private readonly canvasPath: string, private readonly books: BookProfile[], activeBook: BookProfile, private readonly canvasIsOpen: () => boolean) {
        super(app);
        this.book = activeBook;
        const selected = canvas.selection instanceof Set ? [...canvas.selection] : [];
        const selectedIds = new Set(selected.map(node => node.getData?.()?.id).filter((id): id is string => !!id));
        this.cards = canvasReadingOrder(canvasTextCards(JSON.parse(JSON.stringify(canvas.getData())) as StoryCanvasData).filter(card => selectedIds.has(card.id)));
        for (const node of selected) {
            const data = node.getData?.();
            if (data?.type === 'text' && data.id && this.cards.some(card => card.id === data.id)) this.selected.add(data.id);
        }
        this.placeInActs();
    }

    private actCards(): CanvasCard[] {
        return (this.canvas.getData().nodes ?? []).filter(node => node.type === 'text' && typeof node.text === 'string' && actCardNumber(node.text) !== null); // SAFE: canvas JSON may omit nodes; none = no Act cards
    }

    /** Each scene's act from the map's Act cards, or an even spread when it has none. */
    private placeInActs(): void {
        const actCards = this.actCards();
        this.sceneActs = actCards.length
            ? actsFromActCards(this.cards, actCards)
            : spreadAcrossActs(this.cards.map(card => card.id), getConfiguredActCount(this.plugin.settings));
        this.cards.sort((a, b) => this.sceneAct(a) - this.sceneAct(b));
    }

    private sceneAct(card: CanvasCard): number {
        return this.act ?? this.sceneActs.get(card.id) ?? 1; // SAFE: every listed card is placed above; a card that joined the Canvas later starts the book
    }

    private bookItems(): PlacementItem[] {
        return bookPlacementItems(this.app, this.plugin.settings, this.book);
    }

    private scenes(items: PlacementItem[]): PlacementItem[] {
        const ids = new Map<string, number>();
        for (const item of items) {
            const id = item.row.kind === 'scene' ? readSceneId(item.frontmatter) : undefined;
            if (id) ids.set(id, (ids.get(id) ?? 0) + 1); // SAFE: the first sighting of a scene id counts from zero
        }
        return items.filter((item): item is PlacementItem & { row: { act: number } } => {
            const id = item.row.kind === 'scene' ? readSceneId(item.frontmatter) : undefined;
            return !!id && ids.get(id) === 1 && item.row.act !== null && (this.act === null || item.row.act === this.act);
        }).sort((a, b) => a.row.act - b.row.act || a.row.basename.localeCompare(b.row.basename, undefined, { numeric: true }));
    }

    /** The book's timeline rings with their colors, as the timeline draws them now. */
    private readWheel(book: BookProfile): Promise<Map<string, SubplotColor>> {
        return bookRingColors(this.plugin, book);
    }

    /** A subplot color as lower-case `#rrggbb`, read from this window's palette. */
    private hexOf(color: SubplotColor): string {
        return readSubplotColorHex(this.containerEl.doc, color);
    }

    /**
     * Read the book's subplot directory, then start each card color on the
     * subplot it already stands for: the one its linked cards on this Canvas
     * share, else the subplot, or the new subplot waiting here, that wears
     * exactly that color.
     */
    private async loadRings(): Promise<void> {
        const book = this.book;
        this.ringsBook = null;
        const wheel = await this.readWheel(book);
        if (book !== this.book) return;
        const items = this.bookItems();
        const doc = this.containerEl.doc;
        const data = this.canvas.getData();
        this.rows = items.map(item => item.row);
        this.own = bookOwnSubplotColors(book);
        this.palette = paletteHexes(doc);
        this.directory = readCanvasSubplotDirectory(this.plugin.settings, book, this.rows, this.canvasPath, data, doc, wheel);
        const subplotsByPath = new Map(items.map(item => [item.row.path, item.row.subplots]));
        const linked = (data.nodes ?? []).flatMap(node => { // SAFE: canvas JSON may omit nodes; none = no linked cards
            const color = cardColor(node);
            const subplots = node.type === 'file' && typeof node.file === 'string' ? subplotsByPath.get(node.file) : undefined;
            return color && subplots?.length ? [{ color, subplots }] : [];
        });
        const colorsNow = this.directory.map(entry => ({ name: entry.name, color: entry.hex }));
        this.subplotByColor.clear();
        this.paletteByColor.clear();
        this.cardHexes.clear();
        this.standings.clear();
        for (const color of cardColorCounts(this.cards).keys()) {
            const hex = cardColorHex(doc, color);
            this.cardHexes.set(color, hex);
            this.standings.set(color, cardColorStanding(hex, this.directory, this.palette));
            const subplot = subplotForColor(color, hex, linked, colorsNow);
            if (subplot) this.subplotByColor.set(color, subplot);
        }
        this.ringsBook = book.id;
    }

    /** A subplot the book already has, in the book's own spelling. */
    private existingRing(typed: string): string | null {
        const entry = directoryEntryNamed(this.directory, typed);
        return entry && !entry.pending ? entry.name : null;
    }

    /** A new subplot waiting on this Canvas under this name. */
    private pendingNamed(typed: string): { name: string; hex: string } | null {
        const entry = directoryEntryNamed(this.directory, typed);
        return entry?.pending ? { name: entry.name, hex: entry.hex } : null;
    }

    /** For each card color on the selected cards: the subplot its cards join, and the color a new one wears. */
    private colorPlans(): Map<string, CardColorSubplot> {
        const colors = [...cardColorCounts(this.cards.filter(card => this.selected.has(card.id))).keys()];
        return planCardColorSubplots(colors.map(color => ({
            color,
            name: this.subplotByColor.get(color) ?? '', // SAFE: a color with no name yet is blank: the main plot, or waiting when it is no timeline color
            hex: this.cardHexes.get(color) ?? null, // SAFE: a color the dialog never read is no timeline color
            standing: this.standings.get(color) ?? { kind: 'outside' }, // SAFE: a color the dialog never read is no timeline color, so it waits for a subplot
            palette: this.paletteByColor.get(color),
        })), typed => this.existingRing(typed), typed => this.pendingNamed(typed));
    }

    /** The subplot a card joins through its color; null for the main plot. */
    private subplotFor(card: CanvasTextCard, plans: Map<string, CardColorSubplot>): string | null {
        const color = cardColor(card);
        const plan = color ? plans.get(color) : undefined;
        return plan && (plan.kind === 'existing' || plan.kind === 'new' || plan.kind === 'sharesNew') ? plan.subplot : null;
    }

    /** What the selected cards do to the book's subplots, and every ring's color after: one reading for the dialog and Create. */
    private outcome(): SubplotOutcome {
        const plans = this.colorPlans();
        const additions = this.cards.filter(card => this.selected.has(card.id)).map(card => this.subplotFor(card, plans) ?? getMainPlotName());
        const chosen = new Map([...plans.values()].flatMap(plan => plan.kind === 'new' ? [[plan.subplot, plan.color] as const] : []));
        const ownNew = ownColorsForNewSubplots(this.rows, additions, this.own, chosen, color => this.hexOf(color));
        return { plans, ownNew, after: ringColorsWith(this.rows, additions, new Map([...this.own, ...ownNew])) };
    }

    /** The color a card's subplot wears once the scenes join the book, lower-case hex. */
    private colorAfter(card: CanvasTextCard, outcome: SubplotOutcome): string {
        return this.hexOf(subplotColorOn(outcome.after, this.subplotFor(card, outcome.plans) ?? undefined));
    }

    /** Name a new subplot for a card color and pick its palette color. */
    private chooseNewSubplot(color: string, typed: string, container: HTMLElement): void {
        const others = [...this.colorPlans()].flatMap(([other, plan]) => other !== color && plan.kind === 'new' ? [{ name: plan.subplot, hex: plan.color }] : []);
        new CanvasNewSubplotModal(this.app, {
            bookTitle: this.book.title,
            directory: this.directory,
            palette: paletteChoices(this.palette, [...this.directory, ...others]),
            name: typed,
            confirm: t('ui.canvasSketch.useColor'),
            onChoose: choice => {
                this.subplotByColor.set(color, choice.name);
                this.paletteByColor.set(color, choice.color);
                this.renderColors(container);
            },
        }).open();
    }

    /**
     * Each row says what happens to its cards' color. A color outside the
     * timeline's colors is marked, and waits for a subplot. A new name with no
     * palette color yet waits for one. When the cards' subplot wears another
     * color than the cards (the ring order can move a palette color), the dot
     * shows that color: the cards take it when the scenes are created.
     */
    private showColorStates(container: HTMLElement): void {
        const outcome = this.outcome();
        const show = (state: HTMLElement, css: string, note: string): void => {
            const dot = colorDot(state, css);
            setAccessibleLabel(dot, note);
            setTooltip(dot, note);
        };
        for (const [color, { row, state }] of this.colorStates) {
            state.empty();
            const plan = outcome.plans.get(color);
            row.toggleClass('is-blocked', plan?.kind === 'unassigned' || plan?.kind === 'needsColor');
            if (this.standings.get(color)?.kind === 'outside') {
                const mark = state.createSpan({ cls: 'ert-canvas-sketch-outside', text: t('ui.canvasSketch.outsideColor') });
                setTooltip(mark, t('ui.canvasSketch.outsideColorDetail'));
            }
            if (!plan || plan.kind === 'unassigned') continue;
            if (plan.kind === 'needsColor') {
                const button = state.createEl('button', { text: t('ui.canvasSketch.chooseColor'), attr: { type: 'button' } });
                setTooltip(button, t('ui.canvasSketch.needsColor', { subplot: plan.subplot }));
                button.addEventListener('click', () => this.chooseNewSubplot(color, plan.subplot, container));
                continue;
            }
            const card = this.cards.find(candidate => this.selected.has(candidate.id) && cardColor(candidate) === color);
            if (!card) continue;
            const target = this.colorAfter(card, outcome);
            if (target === this.cardHexes.get(color)) continue;
            const subplot = plan.kind === 'mainPlot' ? getMainPlotName() : plan.subplot;
            show(state, target, t('ui.canvasSketch.takesColor', { subplot }));
        }
        this.updateSubmit();
    }

    private renderColors(container: HTMLElement): void {
        container.empty();
        this.colorStates.clear();
        if (this.ringsBook !== this.book.id) {
            container.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.readingSubplots') });
            this.updateSubmit();
            return;
        }
        const counts = cardColorCounts(this.cards.filter(card => this.selected.has(card.id)));
        if (!counts.size) { this.updateSubmit(); return; }
        container.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.colorsHint', { mainPlot: getMainPlotName() }) });
        for (const [color, count] of counts) {
            const row = container.createDiv({ cls: 'ert-canvas-sketch-color' });
            row.createSpan({ cls: 'ert-canvas-sketch-swatch' }).setCssProps({ '--ert-canvas-sketch-swatch': cardColorCss(color) });
            row.createSpan({ cls: 'ert-canvas-sketch-color-count', text: tCount('card', count) });
            const input = row.createEl('input', { type: 'text', attr: { placeholder: t('ui.canvasSketch.subplotName') } });
            setAccessibleLabel(input, t('ui.canvasSketch.subplotName'));
            input.value = this.subplotByColor.get(color) ?? ''; // SAFE: a color with no subplot yet starts blank, ready to name
            this.colorStates.set(color, { row, state: row.createDiv({ cls: 'ert-canvas-sketch-ring' }) });
            const remember = (name: string) => { this.subplotByColor.set(color, name); this.showColorStates(container); };
            input.addEventListener('input', () => remember(input.value));
            new SubplotSuggest(this.app, input, () => this.directory, remember, typed => this.chooseNewSubplot(color, typed, container));
        }
        this.showColorStates(container);
    }

    /** Moving past an act break changes the act first; the next move changes the order. */
    private moveCard(index: number, delta: number): void {
        const card = this.cards[index];
        const neighbour = this.cards[index + delta];
        if (this.mode === 'scenes' && this.act === null && this.sceneAct(card) !== this.sceneAct(neighbour)) {
            this.sceneActs.set(card.id, this.sceneAct(neighbour));
            return;
        }
        this.cards.splice(index, 1);
        this.cards.splice(index + delta, 0, card);
    }

    onOpen(): void {
        this.applyShell({ size: 'lg' });
        this.modalEl.addClass('ert-canvas-convert');
        this.mountHeader({ badge: { text: t('ui.canvasSketch.badge') }, title: t('ui.canvasSketch.title'), subtitle: t('ui.canvasSketch.subtitle') });
        const destination = this.contentEl.createDiv({ cls: 'setting-item' });
        destination.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.book') });
        const dropdown = new DropdownComponent(destination.createDiv({ cls: 'setting-item-control' }));
        for (const book of this.books) dropdown.addOption(book.id, book.title);
        dropdown.setValue(this.book.id).onChange(id => {
            this.book = this.books.find(book => book.id === id) ?? this.book;
            this.anchorPath = null;
            // Create waits for the new book's subplots, so no card joins the previous book's.
            this.ringsBook = null;
            this.directory = [];
            this.subplotByColor.clear();
            this.paletteByColor.clear();
            updateScenes();
            this.renderColors(colors);
            updateRings();
        });
        const modeRow = this.contentEl.createDiv({ cls: 'setting-item' });
        modeRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.createAs') });
        const modeSelect = new DropdownComponent(modeRow.createDiv({ cls: 'setting-item-control' }));
        modeSelect.addOption('scenes', t('ui.canvasSketch.modeScenes'));
        modeSelect.addOption('sketches', t('ui.canvasSketch.modeSketches'));
        const actRow = this.contentEl.createDiv({ cls: 'setting-item' });
        actRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.act') });
        const actSelect = new DropdownComponent(actRow.createDiv({ cls: 'setting-item-control' }));
        const fillActs = () => {
            actSelect.selectEl.empty();
            const auto = this.mode === 'sketches' ? t('ui.canvasSketch.noAct') : t(this.actCards().length ? 'ui.canvasSketch.followActCards' : 'ui.canvasSketch.spreadActs');
            actSelect.addOption('', auto);
            for (let act = 1; act <= getConfiguredActCount(this.plugin.settings); act++) actSelect.addOption(String(act), t('ui.canvasSketch.actNumber', { act }));
            actSelect.setValue(this.act === null ? '' : String(this.act));
        };
        actSelect.onChange(value => {
            this.act = value ? Number(value) : null;
            this.anchorPath = null;
            updateScenes();
            renderCards();
        });
        const anchorRow = this.contentEl.createDiv({ cls: 'setting-item' });
        anchorRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.afterScene') });
        const anchorSelect = new DropdownComponent(anchorRow.createDiv({ cls: 'setting-item-control' }));
        const updateScenes = () => {
            anchorSelect.selectEl.empty();
            anchorSelect.addOption('', t('ui.canvasSketch.endOfAct'));
            for (const item of this.scenes(this.bookItems())) anchorSelect.addOption(item.row.path, item.row.basename);
            anchorSelect.setValue(this.anchorPath ?? ''); // SAFE: no anchor selects the '' End of act option added above
        };
        updateScenes();
        anchorSelect.onChange(value => {
            this.anchorPath = value || null;
            const scene = value ? this.scenes(this.bookItems()).find(item => item.row.path === value) : undefined;
            if (scene?.row.act !== null && scene?.row.act !== undefined) {
                this.act = scene.row.act;
                actSelect.setValue(String(this.act));
                updateScenes();
            }
        });
        const colors = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-colors' });
        if (this.cards.length > 1) this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.orderHint') });
        const list = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-list' });
        const actions = this.mountActions();
        const cancel = actions.createEl('button', { text: t('ui.canvasSketch.cancel') });
        cancel.addEventListener('click', () => this.close());
        const submit = actions.createEl('button', { cls: 'ert-canvas-sketch-submit mod-cta' });
        const updateSubmit = () => {
            const waiting = this.mode === 'scenes' && (this.ringsBook !== this.book.id || plansWaitOnAuthor(this.colorPlans()));
            submit.disabled = this.selected.size === 0 || waiting;
            submit.setText(this.mode === 'scenes' ? t('ui.canvasSketch.createScenes', { scenes: tCount('scene', this.selected.size) }) : t('ui.canvasSketch.create'));
        };
        this.updateSubmit = updateSubmit;
        const updateRings = () => {
            const book = this.book;
            this.loadRings().then(() => this.renderColors(colors)).catch((error: unknown) => {
                console.error('[Canvas sketches]', error);
                if (book !== this.book) return;
                colors.empty();
                colors.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.subplotsUnreadable', { message: error instanceof Error ? error.message : String(error) }) });
            });
        };
        this.renderColors(colors);
        updateRings();
        const renderCards = () => {
            list.empty();
            if (!this.cards.length) list.createDiv({ text: t('ui.canvasSketch.empty') });
            let shownAct: number | null = null;
            this.cards.forEach((card, index) => {
                if (this.mode === 'scenes' && this.act === null && this.sceneAct(card) !== shownAct) {
                    shownAct = this.sceneAct(card);
                    list.createDiv({ cls: 'ert-canvas-sketch-act', text: t('ui.canvasSketch.actNumber', { act: shownAct }) });
                }
                const row = list.createDiv({ cls: 'ert-canvas-sketch-card' });
                row.createSpan({ cls: 'ert-canvas-sketch-number', text: String(index + 1) });
                const color = cardColor(card);
                if (color) row.createSpan({ cls: 'ert-canvas-sketch-swatch' }).setCssProps({ '--ert-canvas-sketch-swatch': cardColorCss(color) });
                const label = row.createEl('label', { cls: 'ert-canvas-sketch-choice' });
                const check = label.createEl('input', { type: 'checkbox' });
                check.checked = this.selected.has(card.id);
                const details = label.createDiv();
                details.createDiv({ cls: 'ert-canvas-sketch-title', text: sketchTitle(card.text) });
                const preview = card.text.split(/\r?\n/).slice(1).join(' ').trim();
                if (preview) details.createDiv({ cls: 'ert-canvas-sketch-preview', text: preview.slice(0, 160) });
                check.addEventListener('change', () => {
                    if (check.checked) this.selected.add(card.id); else this.selected.delete(card.id);
                    updateSubmit();
                    this.renderColors(colors);
                });
                if (this.cards.length < 2) return;
                const controls = row.createDiv({ cls: 'ert-canvas-sketch-order' });
                for (const [delta, icon, hint] of [[-1, 'chevron-up', t('ui.canvasSketch.moveUp')], [1, 'chevron-down', t('ui.canvasSketch.moveDown')]] as const) {
                    const button = controls.createEl('button', { cls: 'ert-canvas-sketch-move clickable-icon', attr: { type: 'button' } });
                    setIcon(button, icon);
                    setAccessibleLabel(button, `${hint}: ${sketchTitle(card.text)}`);
                    setTooltip(button, hint);
                    button.disabled = index + delta < 0 || index + delta >= this.cards.length;
                    button.addEventListener('click', () => {
                        this.moveCard(index, delta);
                        renderCards();
                    });
                }
            });
        };
        const applyMode = () => {
            anchorRow.toggle(this.mode === 'sketches');
            colors.toggle(this.mode === 'scenes');
            fillActs();
            updateSubmit();
            renderCards();
        };
        modeSelect.setValue(this.mode).onChange(value => {
            this.mode = value === 'sketches' ? 'sketches' : 'scenes';
            this.act = null;
            this.anchorPath = null;
            updateScenes();
            applyMode();
        });
        applyMode();
        submit.addEventListener('click', () => {
            if (this.busy || !this.selected.size) return;
            this.busy = true;
            submit.disabled = true;
            cancel.disabled = true;
            void this.convert().finally(() => { this.busy = false; this.close(); });
        });
    }

    private noteBody(frontmatter: Record<string, unknown>, card: CanvasTextCard): string {
        return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${card.text}`;
    }

    private freePath(folder: string, name: string): string {
        let path = `${folder}/${name}.md`;
        for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${name} ${n}.md`;
        return path;
    }

    /**
     * The colors the converted cards take: every card whose subplot will wear
     * another color than the card, by the new card id it gets. Read before any
     * note is written, so a color that cannot be read stops the conversion.
     */
    private cardRepaints(cards: CanvasTextCard[], outcome: SubplotOutcome): Map<string, string> {
        const repaints = new Map<string, string>();
        for (const card of cards) {
            const color = cardColor(card);
            if (!color) continue;
            const target = this.colorAfter(card, outcome);
            if (target !== this.cardHexes.get(color)) repaints.set(card.id, target);
        }
        return repaints;
    }

    /**
     * New subplots that now have scenes: each keeps its chosen color as its
     * own when it needs one (on the book's profile), and stops waiting on
     * this Canvas.
     */
    private async settleNewSubplots(ownNew: Map<string, string>, cards: CanvasTextCard[], plans: Map<string, CardColorSubplot>, paths: Map<string, string>): Promise<void> {
        const created = [...new Set(cards.filter(card => paths.has(card.id)).flatMap(card => {
            const color = cardColor(card);
            const plan = color ? plans.get(color) : undefined;
            return plan && (plan.kind === 'new' || plan.kind === 'sharesNew') ? [plan.subplot] : [];
        }))];
        const kept = [...ownNew].filter(([subplot]) => created.includes(subplot));
        const record = this.plugin.settings.canvasPendingSubplots;
        const waiting = pendingSubplotsOn(record, this.canvasPath, this.book.id).some(entry => created.some(name => name.toLowerCase() === entry.name.toLowerCase()));
        if (!kept.length && !waiting) return;
        for (const [subplot, hex] of kept) setOwnSubplotColor(this.book, subplot, hex);
        if (waiting) {
            const next = forgetPendingSubplots(record, this.canvasPath, this.book.id, created, () => true);
            if (next) this.plugin.settings.canvasPendingSubplots = next;
            else delete this.plugin.settings.canvasPendingSubplots;
        }
        await this.plugin.saveSettings();
        if (kept.length) this.plugin.setCSSColorVariables();
    }

    /** Each card becomes a finished, numbered scene at the end of its act, in one write. */
    private async writeScenes(cards: CanvasTextCard[], folder: string, paths: Map<string, string>, plans: Map<string, CardColorSubplot>): Promise<void> {
        const { settings } = this.plugin;
        const actCount = getConfiguredActCount(settings);
        const byAct = new Map<number, string[]>();
        for (const card of cards) {
            const act = this.sceneAct(card);
            if (act > actCount) throw new Error(t('ui.canvasSketch.actTooHigh', { act, acts: actCount }));
            byAct.set(act, [...(byAct.get(act) ?? []), card.id]); // SAFE: the first scene in an act starts its list
        }
        const numbers = planActEndScenePrefixes(await this.plugin.getSceneData({ sourcePath: this.book.sourceFolder }), byAct, resolveSelectedBeatModelFromSettings(settings));
        if (!numbers) throw new Error(t('ui.promoteToScene.noRoomMany'));
        for (const card of cards) {
            const path = this.freePath(folder, `${numbers.get(card.id)} ${sketchTitle(card.text)}`);
            const frontmatter: Record<string, unknown> = {
                [authorKeyFor('Class', settings)]: 'Scene',
                [authorKeyFor('Act', settings)]: this.sceneAct(card),
            };
            const subplot = this.subplotFor(card, plans);
            if (subplot) frontmatter[authorKeyFor('Subplot', settings)] = subplot;
            await this.app.vault.create(path, addSceneIntakeTemplate(this.noteBody(frontmatter, card), settings));
            paths.set(card.id, path);
        }
    }

    /** Each card becomes a sketch at the chosen place, after ranking any older sketches that lack a position. */
    private async writeSketches(cards: CanvasTextCard[], folder: string, paths: Map<string, string>, ranked: RankedSketch[]): Promise<void> {
        const items = this.bookItems();
        const anchor = this.anchorPath ? this.scenes(items).find(item => item.row.path === this.anchorPath) : undefined;
        if (this.anchorPath && !anchor) throw new Error(t('ui.canvasSketch.anchorChanged'));
        const anchorId = anchor ? readSceneId(anchor.frontmatter) ?? null : null;
        const act = anchor?.row.act ?? this.act;
        const placement = planCanvasSketchAppend(items, act, anchorId, cards.length);
        for (const item of placement.missing) {
            const file = this.app.vault.getAbstractFileByPath(item.path);
            if (!(file instanceof TFile)) throw new Error(t('ui.canvasSketch.placementChanged'));
            const original = items.find(candidate => candidate.row.path === item.path);
            if (!original) throw new Error(t('ui.canvasSketch.placementChanged'));
            let previous: { key: string; existed: boolean; value: unknown } | undefined;
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                const key = findFrontmatterKey(fm, SKETCH_ORDER) ?? SKETCH_ORDER;
                const row = buildTableRow(file.path, file.basename, fm, this.plugin.settings);
                if (row.kind !== 'sketch' || row.act !== original.row.act || sketchAnchor(fm) !== sketchAnchor(original.frontmatter)
                    || (typeof fm[key] === 'number' && Number.isFinite(fm[key]))) throw new Error(t('ui.canvasSketch.placementChanged'));
                previous = { key, existed: Object.prototype.hasOwnProperty.call(fm, key), value: fm[key] };
                fm[key] = item.rank;
            });
            if (previous) ranked.push({ file, ...previous, rank: item.rank, act: original.row.act, anchor: sketchAnchor(original.frontmatter) });
        }
        for (const [index, card] of cards.entries()) {
            const path = this.freePath(folder, sketchTitle(card.text));
            const frontmatter: Record<string, unknown> = { [authorKeyFor('Class', this.plugin.settings)]: 'Sketch' };
            if (act !== null) frontmatter[authorKeyFor('Act', this.plugin.settings)] = act;
            if (anchorId) frontmatter[SKETCH_AFTER_SCENE] = anchorId;
            frontmatter[SKETCH_ORDER] = placement.ranks[index];
            await this.app.vault.create(path, this.noteBody(frontmatter, card));
            paths.set(card.id, path);
        }
    }

    private async convert(): Promise<void> {
        if (!this.canvasIsOpen()) { new Notice(t('ui.canvasSketch.changed'), 8000); return; }
        const initial = JSON.parse(JSON.stringify(this.canvas.getData())) as StoryCanvasData;
        const live = new Map(canvasTextCards(initial).map(card => [card.id, card]));
        const cards = this.cards.filter(card => this.selected.has(card.id)).flatMap(card => live.get(card.id) ? [live.get(card.id)!] : []);
        if (cards.length !== this.selected.size || cards.some(card => this.cards.find(original => original.id === card.id)?.text !== card.text)) {
            new Notice(t('ui.canvasSketch.changed'), 8000);
            return;
        }
        const folder = this.book.sourceFolder.trim().replace(/\/$/, '');
        if (!folder || !this.app.vault.getFolderByPath(folder)) {
            new Notice(t('ui.canvasSketch.missingFolder'), 8000);
            return;
        }
        const paths = new Map<string, string>();
        const ranked: RankedSketch[] = [];
        try {
            // Replacing a card changes its ID. Cross-canvas portal edges can
            // refer to that ID in another file, so refuse rather than break them.
            if (await hasPortalReferences(this.app, initial, this.selected)) {
                new Notice(t('ui.canvasSketch.portalBlocked'), 10000);
                return;
            }
            if (!this.canvasIsOpen() || JSON.stringify(initial) !== JSON.stringify(this.canvas.getData())) throw new Error(t('ui.canvasSketch.changed'));
            let repaints = new Map<string, string>();
            if (this.mode === 'scenes') {
                if (this.ringsBook !== this.book.id) throw new Error(t('ui.canvasSketch.readingSubplots'));
                const outcome = this.outcome();
                if (plansWaitOnAuthor(outcome.plans)) throw new Error(t('ui.canvasSketch.outsideColorDetail'));
                if (outcome.ownNew.size && !ownSubplotColorsWritable(this.book)) throw new Error(t('ui.canvasSketch.newerColors'));
                repaints = this.cardRepaints(cards, outcome);
                try {
                    await this.writeScenes(cards, folder, paths, outcome.plans);
                } finally {
                    // Subplots whose scenes were written keep their color even if a later scene failed.
                    await this.settleNewSubplots(outcome.ownNew, cards, outcome.plans, paths);
                }
            } else await this.writeSketches(cards, folder, paths, ranked);
            // Never replace cards if the author (or another plugin) changed the map while files were being created.
            if (!this.canvasIsOpen() || JSON.stringify(initial) !== JSON.stringify(this.canvas.getData())) throw new Error(t('ui.canvasSketch.changed'));
            // Canvas retains the node class for an existing ID. New IDs let
            // the live view replace text cards, and make Canvas undo work.
            const replacements = new Map([...paths].map(([id, path]) => [id, { id: crypto.randomUUID().replace(/-/g, ''), path }]));
            // Each new scene's card wears its subplot's timeline color.
            const colors = new Map([...repaints].flatMap(([id, hex]) => replacements.has(id) ? [[replacements.get(id)!.id, hex] as const] : [])); // SAFE: has() checked the replacement just before
            try {
                this.canvas.setData(repaintCards(linkSketches(initial, replacements), colors));
                const actual = this.canvas.getData();
                if ([...replacements.values()].some(({ id, path }) => !actual.nodes?.some(node => node.id === id && node.type === 'file' && node.file === path))) {
                    throw new Error(t('ui.canvasSketch.changed'));
                }
                this.canvas.requestSave(false);
            } catch (error) {
                this.canvas.setData(initial);
                this.canvas.requestSave(false);
                throw error;
            }
            new Notice(this.mode === 'scenes' ? t('ui.canvasSketch.doneScenes', { scenes: tCount('scene', paths.size) }) : t('ui.canvasSketch.done', { count: paths.size }), 6000);
            this.plugin.refreshTimelineIfNeeded(null);
            if (this.mode === 'scenes') {
                await this.plugin.setActiveBookId(this.book.id);
                await this.plugin.getTimelineService().activateView();
            }
        } catch (error) {
            console.error('[Canvas sketches]', error);
            let retainedRanks = paths.size > 0 && ranked.length > 0;
            if (paths.size === 0) {
                for (const item of ranked.reverse()) {
                    try {
                        await this.app.fileManager.processFrontMatter(item.file, (fm: Record<string, unknown>) => {
                            const row = buildTableRow(item.file.path, item.file.basename, fm, this.plugin.settings);
                            if (fm[item.key] !== item.rank || row.kind !== 'sketch' || row.act !== item.act || sketchAnchor(fm) !== item.anchor) {
                                retainedRanks = true;
                                return;
                            }
                            if (item.existed) fm[item.key] = item.value;
                            else delete fm[item.key];
                        });
                    } catch (rollbackError) {
                        retainedRanks = true;
                        console.error('[Canvas sketches] Could not restore sketch ordering', rollbackError);
                    }
                }
            }
            const message = (error instanceof Error ? error.message : String(error)) + (retainedRanks ? ` ${t('ui.canvasSketch.orderRetained')}` : '');
            if (paths.size === 0) new Notice(message, 12000);
            else if (this.mode === 'scenes') new Notice(t('ui.canvasSketch.failedScenes', { scenes: tCount('scene', paths.size), message }), 12000);
            else new Notice(t('ui.canvasSketch.failed', { count: paths.size, message }), 12000);
        }
    }
}
