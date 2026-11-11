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
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import type { TimetableRow } from './timetableModel';
import { sketchAnchor, sketchOrder, type PlacementItem, type SketchPlacement } from './sketchPlacement';
import { actsFromActCards, canvasReadingOrder, planCanvasSketchAppend, spreadAcrossActs } from './canvasSketchOrdering';
import { actCardNumber } from './canvasNavigation';
import { bookPlacementItems, bookRingColors, bookSubplotName, ownColorsForNewSubplots, ringColorsWith } from './canvasBookCards';
import { cardColor, cardColorCss, planCardColorSubplots, plansWaitOnAuthor, subplotForColor, type CardColorSubplot } from './canvasCardSubplots';
import { bookOwnSubplotColors, readSubplotColorHex, subplotColorOn, type SubplotColor } from '../renderer/utils/subplotColors';
import { ownSubplotColorsWritable, setOwnSubplotColor } from '../utils/ownSubplotColors';
import { getMainPlotName } from '../utils/mainPlot';
import { planActEndScenePrefixes } from '../services/SceneInsertService';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { addSceneIntakeTemplate } from './sceneIntakeTemplate';
import { cardColorStanding, directoryEntryNamed, paletteChoices, type CardColorStanding, type DirectoryEntry } from './canvasSubplotDirectory';
import { cardHexReader, paletteHexes, readCanvasSubplots } from './CanvasSubplotMenu';
import { CanvasNewSubplotModal } from './CanvasNewSubplotModal';
import { canvasChoicesNow, forgetCards, markSubplotsMade, saveCanvasSubplotMemory, subplotOfCard } from './canvasSubplotMemory';
import { filesIndexed } from '../utils/metadataCacheWait';

/** Minimal, runtime-checked surface of Obsidian's Canvas view. */
export interface OpenCanvas {
    getData(): StoryCanvasData;
    setData(data: StoryCanvasData): void;
    requestSave(pushHistory?: boolean): void;
    selection?: Set<{ getData?: () => { id?: string; type?: string } }>;
}

/** One row of card colors: the selected cards of one color, or of one color the card menu gave one subplot. */
interface ColorRow {
    key: string;
    /** The card color as Canvas stores it. */
    color: string;
    /** The subplot the card menu gave these cards; null when it gave none. */
    given: string | null;
    count: number;
}

/** How long Create waits for Obsidian to index the new scenes before it opens the timeline. */
const INDEX_WAIT_MS = 10000;

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
    /** Counts book reads, so only the latest one is applied. */
    private ringsGeneration = 0;
    /** The book's subplots in ring order, then its new subplots. */
    private directory: DirectoryEntry[] = [];
    /** The palette, slot by slot, lower-case hex. */
    private palette: string[] = [];
    private rows: TimetableRow[] = [];
    /** The book's subplots that already wear their own color. */
    private own = new Map<string, string>();
    /** The subplot the card menu gave each card, for this book, by card id. */
    private readonly given = new Map<string, string>();
    /** What the author typed or chose for each row, by row key. */
    private readonly subplotByRow = new Map<string, string>();
    /** A palette color picked for a row's new subplot, by row key. */
    private readonly paletteByRow = new Map<string, string>();
    /** Each card color as `#rrggbb` (null when the theme cannot show it as one), and what it means on the timeline. */
    private readonly cardHexes = new Map<string, string | null>();
    private readonly standings = new Map<string, CardColorStanding>();
    private sceneActs = new Map<string, number>();
    /** Per row key, its row and where the row says what happens to the cards' color. */
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

    private bookItems(book: BookProfile): PlacementItem[] {
        return bookPlacementItems(this.plugin, book.id);
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

    private cardHexMemo: ((color: string | null) => string | null) | null = null;

    /** A card color as lower-case `#rrggbb`, each distinct color read once from this window's theme. */
    private cardHexOf(color: string | null): string | null {
        this.cardHexMemo ??= cardHexReader(this.containerEl.doc);
        return this.cardHexMemo(color);
    }

    /** True once Obsidian has read the properties of every note at these paths. */
    private indexed(paths: string[]): Promise<boolean> {
        return filesIndexed(this.app, paths, INDEX_WAIT_MS);
    }

    /** A subplot color as lower-case `#rrggbb`, read from this window's palette. */
    private hexOf(color: SubplotColor): string {
        return readSubplotColorHex(this.containerEl.doc, color);
    }

    /**
     * Read the book's subplot directory, then start each row on the subplot
     * its cards already stand for: the one the card menu gave them, else the
     * one their linked cards on this Canvas share, else the subplot, or the
     * book's new subplot, that wears exactly their color. Only the latest
     * read is applied, so switching books and back never loses a name typed
     * since.
     */
    private async loadRings(): Promise<void> {
        const generation = ++this.ringsGeneration;
        const book = this.book;
        this.ringsBook = null;
        const wheel = await this.readWheel(book);
        if (generation !== this.ringsGeneration) return;
        const items = this.bookItems(book);
        const doc = this.containerEl.doc;
        const data = this.canvas.getData();
        const hexOf = (color: string | null): string | null => this.cardHexOf(color);
        this.rows = items.map(item => item.row);
        this.own = bookOwnSubplotColors(book);
        this.palette = paletteHexes(doc);
        const read = readCanvasSubplots(this.plugin.settings, book, this.rows, this.canvasPath, data, doc, hexOf, wheel);
        this.directory = read.directory;
        this.given.clear();
        for (const card of this.cards) {
            const subplot = subplotOfCard(read.choices, card.id, book.id);
            if (subplot !== null) this.given.set(card.id, subplot);
        }
        const subplotsByPath = new Map(items.map(item => [item.row.path, item.row.subplots]));
        const linked = (data.nodes ?? []).flatMap(node => { // SAFE: canvas JSON may omit nodes; none = no linked cards
            const color = cardColor(node);
            const subplots = node.type === 'file' && typeof node.file === 'string' ? subplotsByPath.get(node.file) : undefined;
            return color && subplots?.length ? [{ color, subplots }] : [];
        });
        const colorsNow = this.directory.map(entry => ({ name: entry.name, color: entry.hex }));
        this.subplotByRow.clear();
        this.paletteByRow.clear();
        this.cardHexes.clear();
        this.standings.clear();
        for (const row of this.colorRows(this.cards).values()) {
            if (!this.cardHexes.has(row.color)) {
                const hex = hexOf(row.color);
                this.cardHexes.set(row.color, hex);
                this.standings.set(row.color, cardColorStanding(hex, this.directory, this.palette));
            }
            const subplot = row.given ?? subplotForColor(row.color, this.cardHexes.get(row.color) ?? null, linked, colorsNow); // SAFE: a card the menu gave no subplot is matched by its color
            if (subplot) this.subplotByRow.set(row.key, subplot);
        }
        this.ringsBook = book.id;
    }

    /** A card's row: its color, with the subplot the card menu gave it when it gave one. Null for an uncolored card. */
    private rowOf(card: CanvasCard): { key: string; color: string; given: string | null } | null {
        const color = cardColor(card);
        if (!color) return null;
        const given = this.given.get(card.id) ?? null; // SAFE: null means the menu gave this card no subplot
        return { key: given === null ? color : `${color}\u0000${given.toLowerCase()}`, color, given };
    }

    /** These cards' rows, in the order the cards come, with how many cards each holds. */
    private colorRows(cards: readonly CanvasCard[]): Map<string, ColorRow> {
        const rows = new Map<string, ColorRow>();
        for (const card of cards) {
            const row = this.rowOf(card);
            if (!row) continue;
            const known = rows.get(row.key);
            if (known) known.count++;
            else rows.set(row.key, { ...row, count: 1 });
        }
        return rows;
    }

    private selectedCards(): CanvasTextCard[] {
        return this.cards.filter(card => this.selected.has(card.id));
    }

    /** A subplot the book already has, in the book's own spelling. */
    private existingRing(typed: string): string | null {
        const entry = directoryEntryNamed(this.directory, typed);
        return entry && !entry.pending ? entry.name : null;
    }

    /** A new subplot of the book under this name. */
    private pendingNamed(typed: string): { name: string; hex: string } | null {
        const entry = directoryEntryNamed(this.directory, typed);
        return entry?.pending ? { name: entry.name, hex: entry.hex } : null;
    }

    /** For each row of the selected cards: the subplot its cards join, and the color a new one wears. */
    private colorPlans(): Map<string, CardColorSubplot> {
        const rows = [...this.colorRows(this.selectedCards()).values()];
        return planCardColorSubplots(rows.map(row => ({
            key: row.key,
            name: this.subplotByRow.get(row.key) ?? '', // SAFE: a row with no name yet is blank, which waits for a subplot
            hex: this.cardHexes.get(row.color) ?? null, // SAFE: a color the dialog never read is no timeline color
            standing: this.standings.get(row.color) ?? { kind: 'outside' }, // SAFE: a color the dialog never read is no timeline color
            palette: this.paletteByRow.get(row.key),
        })), typed => this.existingRing(typed), typed => this.pendingNamed(typed),
        hex => this.directory.find(entry => entry.hex === hex)?.name ?? null); // SAFE: null means no subplot wears that color
    }

    /** The subplot a card joins; null for an uncolored card, which joins the main plot. */
    private subplotFor(card: CanvasTextCard, plans: Map<string, CardColorSubplot>): string | null {
        const row = this.rowOf(card);
        const plan = row ? plans.get(row.key) : undefined;
        return plan && (plan.kind === 'existing' || plan.kind === 'new' || plan.kind === 'sharesNew') ? plan.subplot : null;
    }

    /** What the selected cards do to the book's subplots, and every ring's color after: one reading for the dialog and Create. */
    private outcome(): SubplotOutcome {
        const plans = this.colorPlans();
        const additions = this.selectedCards().map(card => this.subplotFor(card, plans) ?? getMainPlotName());
        const chosen = new Map([...plans.values()].flatMap(plan => plan.kind === 'new' ? [[plan.subplot, plan.color] as const] : []));
        const ownNew = ownColorsForNewSubplots(this.rows, additions, this.own, chosen, color => this.hexOf(color));
        return { plans, ownNew, after: ringColorsWith(this.rows, additions, new Map([...this.own, ...ownNew])) };
    }

    /** The color a card's subplot wears once the scenes join the book, lower-case hex. */
    private colorAfter(card: CanvasTextCard, outcome: SubplotOutcome): string {
        return this.hexOf(subplotColorOn(outcome.after, this.subplotFor(card, outcome.plans) ?? undefined));
    }

    /** Name a new subplot for a row and pick its palette color. */
    private chooseNewSubplot(key: string, typed: string, container: HTMLElement): void {
        const others = [...this.colorPlans()].flatMap(([other, plan]) => other !== key && plan.kind === 'new' ? [{ name: plan.subplot, hex: plan.color }] : []);
        new CanvasNewSubplotModal(this.app, {
            bookTitle: this.book.title,
            directory: this.directory,
            palette: paletteChoices(this.palette, [...this.directory, ...others]),
            name: typed,
            confirm: t('ui.canvasSketch.useColor'),
            onChoose: choice => {
                this.subplotByRow.set(key, choice.name);
                this.paletteByRow.set(key, choice.color);
                this.renderColors(container);
            },
        }).open();
    }

    /**
     * Each row says what happens to its cards' color. A row with no subplot
     * waits for one, marked as outside the timeline's colors when it is. A new
     * name with no palette color yet waits for one. A row the card menu gave a
     * subplot whose color has moved since is marked. When the cards' subplot
     * wears another color than the cards, the dot shows that color: the cards
     * take it when the scenes are created.
     */
    private showColorStates(container: HTMLElement): void {
        const outcome = this.outcome();
        const rows = this.colorRows(this.selectedCards());
        const show = (state: HTMLElement, css: string, note: string): void => {
            const dot = colorDot(state, css);
            setAccessibleLabel(dot, note);
            setTooltip(dot, note);
        };
        const mark = (state: HTMLElement, text: string, detail: string): void => {
            setTooltip(state.createSpan({ cls: 'ert-canvas-sketch-outside', text }), detail);
        };
        for (const [key, { row: rowEl, state }] of this.colorStates) {
            state.empty();
            const plan = outcome.plans.get(key);
            const row = rows.get(key);
            if (!plan || !row) continue;
            rowEl.toggleClass('is-blocked', plan.kind === 'unassigned' || plan.kind === 'needsColor');
            if (plan.kind === 'unassigned') {
                // Once the row has a subplot, its cards take that subplot's color and the mark goes.
                const outside = this.standings.get(row.color)?.kind === 'outside';
                mark(state, t(outside ? 'ui.canvasSketch.outsideColor' : 'ui.canvasSketch.needsName'), t('ui.canvasSketch.outsideColorDetail'));
                continue;
            }
            if (plan.kind === 'needsColor') {
                const button = state.createEl('button', { text: t('ui.canvasSketch.chooseColor'), attr: { type: 'button' } });
                setTooltip(button, t('ui.canvasSketch.needsColor', { subplot: plan.subplot }));
                button.addEventListener('click', () => this.chooseNewSubplot(key, plan.subplot, container));
                continue;
            }
            const cardHex = this.cardHexes.get(row.color);
            const wears = directoryEntryNamed(this.directory, plan.subplot)?.hex;
            if (row.given !== null && row.given.toLowerCase() === plan.subplot.toLowerCase() && wears !== undefined && wears !== cardHex) {
                mark(state, t('ui.canvasSketch.colorMoved'), t('ui.canvasSketch.colorMovedDetail', { subplot: plan.subplot }));
            }
            const card = this.selectedCards().find(candidate => this.rowOf(candidate)?.key === key);
            if (!card) continue;
            const target = this.colorAfter(card, outcome);
            if (target === cardHex) continue;
            show(state, target, t('ui.canvasSketch.takesColor', { subplot: plan.subplot }));
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
        const rows = this.colorRows(this.selectedCards());
        if (!rows.size) { this.updateSubmit(); return; }
        container.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.colorsHint', { mainPlot: getMainPlotName() }) });
        for (const { key, color, count } of rows.values()) {
            const row = container.createDiv({ cls: 'ert-canvas-sketch-color' });
            row.createSpan({ cls: 'ert-canvas-sketch-swatch' }).setCssProps({ '--ert-canvas-sketch-swatch': cardColorCss(color) });
            row.createSpan({ cls: 'ert-canvas-sketch-color-count', text: tCount('card', count) });
            const input = row.createEl('input', { type: 'text', attr: { placeholder: t('ui.canvasSketch.subplotName') } });
            setAccessibleLabel(input, t('ui.canvasSketch.subplotName'));
            input.value = this.subplotByRow.get(key) ?? ''; // SAFE: a row with no subplot yet starts blank, ready to name
            this.colorStates.set(key, { row, state: row.createDiv({ cls: 'ert-canvas-sketch-ring' }) });
            input.addEventListener('input', () => this.nameRow(key, input.value, container));
            new SubplotSuggest(this.app, input, () => this.directory, name => this.nameRow(key, name, container), typed => this.chooseNewSubplot(key, typed, container));
        }
        this.showColorStates(container);
    }

    /** A row's name changed: a palette color picked for the old name no longer applies. */
    private nameRow(key: string, name: string, container: HTMLElement): void {
        const before = this.subplotByRow.get(key) ?? ''; // SAFE: a row never named starts blank
        if (before.trim().toLowerCase() !== name.trim().toLowerCase()) this.paletteByRow.delete(key);
        this.subplotByRow.set(key, name);
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
            if (this.busy) return;
            this.book = this.books.find(book => book.id === id) ?? this.book;
            this.anchorPath = null;
            // Create waits for the new book's subplots, so no card joins the previous book's.
            this.ringsBook = null;
            this.directory = [];
            this.subplotByRow.clear();
            this.paletteByRow.clear();
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
            for (const item of this.scenes(this.bookItems(this.book))) anchorSelect.addOption(item.row.path, item.row.basename);
            anchorSelect.setValue(this.anchorPath ?? ''); // SAFE: no anchor selects the '' End of act option added above
        };
        updateScenes();
        anchorSelect.onChange(value => {
            this.anchorPath = value || null;
            const scene = value ? this.scenes(this.bookItems(this.book)).find(item => item.row.path === value) : undefined;
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
            const generation = this.ringsGeneration + 1;
            this.loadRings().then(() => { if (generation === this.ringsGeneration) this.renderColors(colors); }).catch((error: unknown) => {
                console.error('[Canvas sketches]', error);
                if (generation !== this.ringsGeneration) return;
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
            // Nothing in the dialog changes while the cards become notes, and it shows it is at work.
            for (const control of this.contentEl.findAll('button, input, select')) (control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled = true;
            this.modalEl.addClass('is-busy');
            submit.setText(t('ui.canvasSketch.creating'));
            // The timeline waits for the whole batch, then draws once.
            void this.plugin.getTimelineService().holdRefreshes(() => this.convert()).finally(() => { this.busy = false; this.close(); });
        });
    }

    /** Escape and the close button wait while Create runs; the dialog closes itself when it is done. */
    close(): void {
        if (this.busy) return;
        super.close();
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
            // A preset follows the theme, so even one that looks right now is set to the fixed color.
            const target = this.colorAfter(card, outcome);
            if (color !== target) repaints.set(card.id, target);
        }
        return repaints;
    }

    /** The new subplots whose scenes were written. */
    private createdSubplots(cards: CanvasTextCard[], plans: Map<string, CardColorSubplot>, paths: Map<string, string>): Set<string> {
        return new Set(cards.filter(card => paths.has(card.id)).flatMap(card => {
            const row = this.rowOf(card);
            const plan = row ? plans.get(row.key) : undefined;
            return plan && (plan.kind === 'new' || plan.kind === 'sharesNew') ? [plan.subplot] : [];
        }));
    }

    /** New subplots whose scenes were written keep their chosen color as their own when they need one, on the book's profile. */
    private async keepNewSubplotColors(book: BookProfile, ownNew: Map<string, string>, created: Set<string>): Promise<void> {
        const kept = [...ownNew].filter(([subplot]) => created.has(subplot));
        if (!kept.length) return;
        for (const [subplot, hex] of kept) setOwnSubplotColor(book, subplot, hex);
        await this.plugin.saveSettings();
        this.plugin.setCSSColorVariables();
    }

    /**
     * Once the Canvas links the new notes: the card menu forgets the cards,
     * which are cards no longer, and the subplots that now have scenes stop
     * counting as new wherever a choice names them.
     */
    private async forgetConvertedCards(book: BookProfile, initial: StoryCanvasData, converted: string[], made: Set<string>): Promise<void> {
        const record = this.plugin.settings.canvasSubplotMemory;
        const open = canvasChoicesNow(record, this.canvasPath, canvasTextCards(initial).map(card => ({ id: card.id, hex: this.cardHexOf(cardColor(card)) })));
        const remembered = converted.filter(id => open.some(choice => choice.cards?.includes(id)));
        const forgotten = remembered.length ? forgetCards(record, this.canvasPath, open, remembered) : record;
        const next = markSubplotsMade(forgotten, book.id, [...made]);
        if (JSON.stringify(next) === JSON.stringify(record)) return;
        await saveCanvasSubplotMemory(this.plugin, next);
    }

    /** Each card becomes a finished, numbered scene at the end of its act, in one write. */
    private async writeScenes(book: BookProfile, cards: CanvasTextCard[], folder: string, paths: Map<string, string>, plans: Map<string, CardColorSubplot>): Promise<void> {
        const { settings } = this.plugin;
        const actCount = getConfiguredActCount(settings);
        const byAct = new Map<number, string[]>();
        for (const card of cards) {
            const act = this.sceneAct(card);
            if (act > actCount) throw new Error(t('ui.canvasSketch.actTooHigh', { act, acts: actCount }));
            byAct.set(act, [...(byAct.get(act) ?? []), card.id]); // SAFE: the first scene in an act starts its list
        }
        const numbers = planActEndScenePrefixes(await this.plugin.getSceneData({ sourcePath: book.sourceFolder }), byAct, resolveSelectedBeatModelFromSettings(settings));
        if (!numbers) throw new Error(t('ui.promoteToScene.noRoomMany'));
        for (const card of cards) {
            const path = this.freePath(folder, `${numbers.get(card.id)} ${sketchTitle(card.text)}`);
            const frontmatter: Record<string, unknown> = {
                [authorKeyFor('Class', settings)]: 'Scene',
                [authorKeyFor('Act', settings)]: this.sceneAct(card),
            };
            const subplot = this.subplotFor(card, plans);
            if (subplot) frontmatter[authorKeyFor('Subplot', settings)] = bookSubplotName(subplot, book);
            await this.app.vault.create(path, addSceneIntakeTemplate(this.noteBody(frontmatter, card), settings));
            paths.set(card.id, path);
        }
    }

    /**
     * Each card becomes a sketch at the chosen place, after ranking any older
     * sketches that lack a position. Positions go to the placement sidecar in
     * one write once the notes exist, so a failure before the first note leaves
     * every position as it was. `ranked` receives the older sketches ranked.
     */
    private async writeSketches(book: BookProfile, cards: CanvasTextCard[], folder: string, paths: Map<string, string>, ranked: string[]): Promise<void> {
        const items = this.bookItems(book);
        const anchor = this.anchorPath ? this.scenes(items).find(item => item.row.path === this.anchorPath) : undefined;
        if (this.anchorPath && !anchor) throw new Error(t('ui.canvasSketch.anchorChanged'));
        const anchorId = anchor ? readSceneId(anchor.frontmatter) ?? null : null;
        const act = anchor?.row.act ?? this.act;
        const placement = planCanvasSketchAppend(items, act, anchorId, cards.length);
        const store = this.plugin.sketchPlacements;
        await store.assertWritable();
        for (const item of placement.missing) {
            const original = items.find(candidate => candidate.row.path === item.path);
            const now = store.get(item.path);
            if (!original || !(this.app.vault.getAbstractFileByPath(item.path) instanceof TFile)
                || sketchOrder(now) !== null || sketchAnchor(now) !== sketchAnchor(original.placement)) throw new Error(t('ui.canvasSketch.placementChanged'));
        }
        const created: Array<[string, SketchPlacement]> = [];
        try {
            for (const [index, card] of cards.entries()) {
                const path = this.freePath(folder, sketchTitle(card.text));
                const frontmatter: Record<string, unknown> = { [authorKeyFor('Class', this.plugin.settings)]: 'Sketch' };
                if (act !== null) frontmatter[authorKeyFor('Act', this.plugin.settings)] = act;
                await this.app.vault.create(path, this.noteBody(frontmatter, card));
                paths.set(card.id, path);
                created.push([path, { after: anchorId ?? undefined, order: placement.ranks[index] }]);
            }
        } finally {
            if (created.length) {
                const older = placement.missing.map(item => [item.path, { ...store.get(item.path), order: item.rank }] as [string, SketchPlacement]);
                await store.set([...older, ...created]);
                ranked.push(...older.map(([path]) => path));
            }
        }
    }

    private async convert(): Promise<void> {
        // The book and mode as Create was clicked, whatever the dialog shows later.
        const book = this.book;
        const mode = this.mode;
        if (!this.canvasIsOpen()) { new Notice(t('ui.canvasSketch.changed'), 8000); return; }
        const initial = JSON.parse(JSON.stringify(this.canvas.getData())) as StoryCanvasData;
        const live = new Map(canvasTextCards(initial).map(card => [card.id, card]));
        const cards = this.cards.filter(card => this.selected.has(card.id)).flatMap(card => live.get(card.id) ? [live.get(card.id)!] : []);
        // The rows were read from these cards' text and colors.
        const unchanged = (card: CanvasTextCard): boolean => {
            const original = this.cards.find(candidate => candidate.id === card.id);
            return !!original && original.text === card.text && cardColor(original) === cardColor(card);
        };
        if (cards.length !== this.selected.size || !cards.every(unchanged)) {
            new Notice(t('ui.canvasSketch.changed'), 8000);
            return;
        }
        const folder = book.sourceFolder.trim().replace(/\/$/, '');
        if (!folder || !this.app.vault.getFolderByPath(folder)) {
            new Notice(t('ui.canvasSketch.missingFolder'), 8000);
            return;
        }
        const paths = new Map<string, string>();
        const ranked: string[] = [];
        let repaints = new Map<string, string>();
        let created = new Set<string>();
        let linked = false;
        try {
            // Replacing a card changes its ID. Cross-canvas portal edges can
            // refer to that ID in another file, so refuse rather than break them.
            if (await hasPortalReferences(this.app, initial, this.selected)) {
                new Notice(t('ui.canvasSketch.portalBlocked'), 10000);
                return;
            }
            if (!this.canvasIsOpen() || JSON.stringify(initial) !== JSON.stringify(this.canvas.getData())) throw new Error(t('ui.canvasSketch.changed'));
            if (mode === 'scenes') {
                if (this.ringsBook !== book.id) throw new Error(t('ui.canvasSketch.readingSubplots'));
                const outcome = this.outcome();
                if (plansWaitOnAuthor(outcome.plans)) throw new Error(t('ui.canvasSketch.outsideColorDetail'));
                if (outcome.ownNew.size && !ownSubplotColorsWritable(book)) throw new Error(t('ui.canvasSketch.newerColors'));
                repaints = this.cardRepaints(cards, outcome);
                try {
                    await this.writeScenes(book, cards, folder, paths, outcome.plans);
                } finally {
                    // Subplots whose scenes were written keep their color even if a later scene failed.
                    created = this.createdSubplots(cards, outcome.plans, paths);
                    await this.keepNewSubplotColors(book, outcome.ownNew, created);
                }
            } else await this.writeSketches(book, cards, folder, paths, ranked);
            // Never replace cards if the author (or another plugin) changed the map while files were being created.
            if (!this.canvasIsOpen() || JSON.stringify(initial) !== JSON.stringify(this.canvas.getData())) throw new Error(t('ui.canvasSketch.changed'));
            // Canvas retains the node class for an existing ID. New IDs let
            // the live view replace text cards, and make Canvas undo work.
            const replacements = new Map([...paths].map(([id, path]) => [id, { id: crypto.randomUUID().replace(/-/g, ''), path }]));
            // Each new scene's card wears its subplot's timeline color.
            const colors = new Map([...repaints].flatMap(([id, hex]) => replacements.has(id) ? [[replacements.get(id)!.id, hex] as const] : [])); // SAFE: has() checked the replacement just before
            const converted = repaintCards(linkSketches(initial, replacements), colors);
            try {
                this.canvas.setData(converted);
                const actual = this.canvas.getData();
                if ([...replacements.values()].some(({ id, path }) => !actual.nodes?.some(node => node.id === id && node.type === 'file' && node.file === path))) {
                    throw new Error(t('ui.canvasSketch.changed'));
                }
                this.canvas.requestSave(false);
                linked = true;
            } catch (error) {
                if (JSON.stringify(this.canvas.getData()) === JSON.stringify(converted)) {
                    this.canvas.setData(initial);
                    this.canvas.requestSave(false);
                }
                throw error;
            }
            new Notice(mode === 'scenes' ? t('ui.canvasSketch.doneScenes', { scenes: tCount('scene', paths.size) }) : t('ui.canvasSketch.done', { count: paths.size }), 6000);
            // Only now that the Canvas links the new notes does the card menu forget their cards.
            const existing = this.ringsBook === book.id ? this.directory.filter(entry => !entry.pending).map(entry => entry.name) : [];
            try {
                await this.forgetConvertedCards(book, initial, [...paths.keys()], new Set([...created, ...existing]));
            } catch (error) {
                // The scenes exist and the Canvas links them; only the card menu's memory could not be saved.
                console.error('[Canvas subplots] Could not save the Canvas card choices after Create', error);
                new Notice(t('ui.canvasSketch.cardMemoryNotSaved', { message: error instanceof Error ? error.message : String(error) }), 10000);
            }
            // Draw the timeline once, complete: only after Obsidian has read every new note's properties.
            const indexed = await this.indexed([...paths.values()]);
            if (mode === 'scenes') await this.plugin.setActiveBookId(book.id);
            if (!indexed) {
                new Notice(t('ui.canvasSketch.stillIndexing'), 10000);
                return;
            }
            this.plugin.refreshTimelineIfNeeded(null);
            if (mode === 'scenes') await this.plugin.getTimelineService().activateView();
        } catch (error) {
            console.error('[Canvas sketches]', error);
            // Older sketches are ranked only together with a new sketch, so there is nothing to undo.
            const retainedRanks = ranked.length > 0;
            let message = (error instanceof Error ? error.message : String(error)) + (retainedRanks ? ` ${t('ui.canvasSketch.orderRetained')}` : '');
            if (paths.size && !linked && this.canvasIsOpen() && JSON.stringify(initial) === JSON.stringify(this.canvas.getData())) {
                // Preserve completed work on the map. A later conversion then sees only
                // the remaining text cards, rather than creating these notes twice.
                const replacements = new Map([...paths].map(([id, path]) => [id, { id: crypto.randomUUID().replace(/-/g, ''), path }]));
                const colors = new Map([...repaints].flatMap(([id, hex]) => replacements.has(id) ? [[replacements.get(id)!.id, hex] as const] : [])); // SAFE: checked above
                const partial = repaintCards(linkSketches(initial, replacements), colors);
                try {
                    this.canvas.setData(partial);
                    const actual = this.canvas.getData();
                    if ([...replacements.values()].some(({ id, path }) => !actual.nodes?.some(node => node.id === id && node.type === 'file' && node.file === path))) throw new Error(t('ui.canvasSketch.changed'));
                    this.canvas.requestSave(false);
                    linked = true;
                } catch (recoveryError) {
                    console.error('[Canvas sketches] Could not link the notes already created', recoveryError);
                    // Only restore our replacement while the Canvas still matches it;
                    // never discard an intervening change made by the author.
                    const current = this.canvas.getData();
                    if (JSON.stringify(current) === JSON.stringify(partial)) {
                        try { this.canvas.setData(initial); this.canvas.requestSave(false); }
                        catch (restoreError) { console.error('[Canvas sketches] Could not restore the Canvas', restoreError); }
                    }
                }
                if (linked) {
                    const existing = this.ringsBook === book.id ? this.directory.filter(entry => !entry.pending).map(entry => entry.name) : [];
                    try { await this.forgetConvertedCards(book, initial, [...paths.keys()], new Set([...created, ...existing])); }
                    catch (memoryError) {
                        console.error('[Canvas subplots] Could not save partially converted card choices', memoryError);
                        message += ` ${t('ui.canvasSketch.cardMemoryNotSaved', { message: memoryError instanceof Error ? memoryError.message : String(memoryError) })}`;
                    }
                }
            }
            if (paths.size === 0) new Notice(message, 12000);
            else {
                const names = [...paths.values()].join('\n');
                new Notice(t(linked ? 'ui.canvasSketch.partialLinked' : 'ui.canvasSketch.partialUnlinked', { paths: names, message }), 0);
            }
        }
    }
}
