import { AbstractInputSuggest, App, DropdownComponent, Notice, TFile, setIcon, stringifyYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { ErtModal } from '../ui/ErtModal';
import { authorKeyFor } from './timetableFiles';
import { getConfiguredActCount } from '../utils/acts';
import { canvasTextCards, linkSketches, sketchTitle, type StoryCanvasData, type CanvasCard, type CanvasTextCard } from './canvasSketches';
import { hasPortalReferences } from './canvasPortals';
import { t, tCount } from '../i18n';
import { getBookIdForPath } from '../utils/books';
import { readSceneId } from '../utils/sceneIds';
import { findFrontmatterKey } from '../utils/frontmatterKeys';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { buildRingLayout, buildTableRow, type TimetableRow } from './timetableModel';
import { SKETCH_AFTER_SCENE, SKETCH_ORDER, sketchAnchor, type PlacementItem } from './sketchPlacement';
import { actsFromActCards, canvasReadingOrder, planCanvasSketchAppend, spreadAcrossActs } from './canvasSketchOrdering';
import { actCardNumber } from './canvasNavigation';
import { bookRingColors, ringColorsWith } from './canvasBookCards';
import { cardColor, cardColorCounts, cardColorCss, cardColorHex, planCardColorSubplots, subplotForColor, type CardColorSubplot } from './canvasCardSubplots';
import { bookOwnSubplotColors, readSubplotColorValue, subplotColorCss, type SubplotColor } from '../renderer/utils/subplotColors';
import { setOwnSubplotColor } from '../utils/ownSubplotColors';
import { getMainPlotName } from '../utils/mainPlot';
import { planActEndScenePrefixes } from '../services/SceneInsertService';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { addSceneIntakeTemplate } from './sceneIntakeTemplate';

/** Minimal, runtime-checked surface of Obsidian's Canvas view. */
export interface OpenCanvas {
    getData(): StoryCanvasData;
    setData(data: StoryCanvasData): void;
    requestSave(pushHistory?: boolean): void;
    selection?: Set<{ getData?: () => { id?: string; type?: string } }>;
}

/** One of the book's rings, as a card color can be assigned to it. */
interface RingChoice { name: string; color: SubplotColor }

/** An existing sketch given a position during conversion, kept so a failure can restore it. */
interface RankedSketch { file: TFile; key: string; rank: number; existed: boolean; value: unknown; act: number | null; anchor: string | null }

function colorDot(parent: HTMLElement, css: string): HTMLElement {
    const dot = parent.createSpan({ cls: 'ert-canvas-sketch-swatch' });
    dot.setCssProps({ '--ert-canvas-sketch-swatch': css });
    return dot;
}

/** The book's rings beside a subplot name, each with its timeline color. Any other name starts a new subplot. */
class RingSuggest extends AbstractInputSuggest<RingChoice> {
    constructor(app: App, private readonly input: HTMLInputElement, private readonly rings: () => RingChoice[], private readonly onChoose: (name: string) => void) {
        super(app, input);
    }

    protected getSuggestions(query: string): RingChoice[] {
        const typed = query.trim().toLowerCase();
        return this.rings().filter(ring => ring.name.toLowerCase().includes(typed));
    }

    renderSuggestion(ring: RingChoice, el: HTMLElement): void {
        el.addClass('ert-canvas-sketch-ring-option');
        colorDot(el, subplotColorCss(ring.color));
        el.createSpan({ text: ring.name });
    }

    selectSuggestion(ring: RingChoice): void {
        this.input.value = ring.name;
        this.onChoose(ring.name);
        this.close();
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
    private rings: RingChoice[] = [];
    private rows: TimetableRow[] = [];
    /** The book's subplots that already wear their own color. */
    private own = new Map<string, string>();
    /** What the author typed for each card color. */
    private readonly subplotByColor = new Map<string, string>();
    private sceneActs = new Map<string, number>();
    /** Per card color, where its row says which color the subplot will wear. */
    private readonly colorStates = new Map<string, HTMLElement>();

    constructor(app: App, private readonly plugin: RadialTimelinePlugin, private readonly canvas: OpenCanvas, private readonly books: BookProfile[], activeBook: BookProfile, private readonly canvasIsOpen: () => boolean) {
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
        return this.app.vault.getMarkdownFiles().filter(file => getBookIdForPath(this.plugin.settings.books, file.path) === this.book.id)
            .map(file => {
                const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
                return { row: buildTableRow(file.path, file.basename, frontmatter, this.plugin.settings), frontmatter };
            });
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

    /** Read the book's rings, then start each card color on the subplot it already stands for. */
    private async loadRings(): Promise<void> {
        const book = this.book;
        const wheel = await bookRingColors(this.plugin, book);
        if (book !== this.book) return;
        const items = this.bookItems();
        this.rows = items.map(item => item.row);
        this.own = bookOwnSubplotColors(book);
        const layout = buildRingLayout([...wheel.keys()], this.own, this.rows);
        this.rings = [...new Set([getMainPlotName(), ...layout.order])].map(name => ({ name, color: layout.colors.get(name) ?? { kind: 'slot', slot: 0 } })); // SAFE: a book with no scenes has no layout yet, and Main Plot always takes the first slot
        const subplotsByPath = new Map(items.map(item => [item.row.path, item.row.subplots]));
        const linked = (this.canvas.getData().nodes ?? []).flatMap(node => { // SAFE: canvas JSON may omit nodes; none = no linked cards
            const color = cardColor(node);
            const subplots = node.type === 'file' && typeof node.file === 'string' ? subplotsByPath.get(node.file) : undefined;
            return color && subplots?.length ? [{ color, subplots }] : [];
        });
        const doc = this.containerEl.doc;
        const ringColors = this.rings.map(ring => ({ name: ring.name, color: readSubplotColorValue(doc, ring.color).toLowerCase() }));
        this.subplotByColor.clear();
        for (const color of cardColorCounts(this.cards).keys()) {
            const subplot = subplotForColor(color, cardColorHex(doc, color), linked, ringColors);
            if (subplot) this.subplotByColor.set(color, subplot);
        }
    }

    /** A subplot the book already has, in the book's own spelling. */
    private existingRing(typed: string): string | null {
        return this.rings.find(ring => ring.name.toLowerCase() === typed.toLowerCase())?.name ?? null;
    }

    /** For each card color on the selected cards: the subplot its cards join, and whose color that subplot wears. */
    private colorPlans(): Map<string, CardColorSubplot> {
        const colors = [...cardColorCounts(this.cards.filter(card => this.selected.has(card.id))).keys()];
        return planCardColorSubplots(colors.map(color => ({ color, name: this.subplotByColor.get(color) ?? '' })), typed => this.existingRing(typed)); // SAFE: a color with no name typed yet joins the main plot
    }

    /** The subplot a card joins through its color. */
    private subplotFor(card: CanvasTextCard, plans: Map<string, CardColorSubplot>): string | null {
        const color = cardColor(card);
        const plan = color ? plans.get(color) : undefined;
        return plan && plan.kind !== 'mainPlot' ? plan.subplot : null;
    }

    /**
     * Each row says honestly which color its subplot will wear. A new subplot
     * wears the row's own card color, so the row shows that color alone. A
     * subplot the book has keeps its color: the dot shows it as the ring will
     * look, since ring order follows scene counts. A new name an earlier
     * color already gave shows that earlier color.
     */
    private showColorStates(): void {
        const doc = this.containerEl.doc;
        const plans = this.colorPlans();
        const newColors = [...plans].flatMap(([color, plan]) => plan.kind === 'new' ? [[plan.subplot, cardColorCss(color)] as const] : []);
        const additions = this.cards.filter(card => this.selected.has(card.id)).map(card => this.subplotFor(card, plans) ?? getMainPlotName());
        // New subplots will wear their card colors, so they take no palette slot from the rings shown here.
        const after = ringColorsWith(this.rows, additions, new Map([...this.own, ...newColors]));
        const show = (state: HTMLElement, css: string, note: string): void => {
            const dot = colorDot(state, css);
            setAccessibleLabel(dot, note);
            setTooltip(dot, note);
        };
        for (const [color, state] of this.colorStates) {
            state.empty();
            const plan = plans.get(color);
            if (!plan || plan.kind === 'mainPlot' || plan.kind === 'new') continue;
            if (plan.kind === 'sharesNew') {
                show(state, cardColorCss(plan.color), t('ui.canvasSketch.sharesColor', { subplot: plan.subplot }));
                continue;
            }
            const ring = after.get(plan.subplot)!; // SAFE: this color's selected cards join the subplot, so the rings after them hold it
            // A subplot already wearing this card color leaves one color in play.
            if (readSubplotColorValue(doc, ring).toLowerCase() === cardColorHex(doc, color)) continue;
            show(state, subplotColorCss(ring), t('ui.canvasSketch.keepsColor', { subplot: plan.subplot }));
        }
    }

    private renderColors(container: HTMLElement): void {
        container.empty();
        this.colorStates.clear();
        const counts = cardColorCounts(this.cards.filter(card => this.selected.has(card.id)));
        if (!counts.size) return;
        container.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.colorsHint', { mainPlot: getMainPlotName() }) });
        for (const [color, count] of counts) {
            const row = container.createDiv({ cls: 'ert-canvas-sketch-color' });
            row.createSpan({ cls: 'ert-canvas-sketch-swatch' }).setCssProps({ '--ert-canvas-sketch-swatch': cardColorCss(color) });
            row.createSpan({ cls: 'ert-canvas-sketch-color-count', text: tCount('card', count) });
            const input = row.createEl('input', { type: 'text', attr: { placeholder: t('ui.canvasSketch.subplotName') } });
            setAccessibleLabel(input, t('ui.canvasSketch.subplotName'));
            input.value = this.subplotByColor.get(color) ?? ''; // SAFE: a color with no subplot yet starts blank, ready to name
            this.colorStates.set(color, row.createDiv({ cls: 'ert-canvas-sketch-ring' }));
            const remember = (name: string) => { this.subplotByColor.set(color, name); this.showColorStates(); };
            input.addEventListener('input', () => remember(input.value));
            new RingSuggest(this.app, input, () => this.rings, remember);
        }
        this.showColorStates();
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
            updateScenes();
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
        const updateRings = () => {
            this.loadRings().then(() => this.renderColors(colors)).catch((error: unknown) => console.error('[Canvas sketches]', error));
        };
        updateRings();
        if (this.cards.length > 1) this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.orderHint') });
        const list = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-list' });
        const actions = this.mountActions();
        const cancel = actions.createEl('button', { text: t('ui.canvasSketch.cancel') });
        cancel.addEventListener('click', () => this.close());
        const submit = actions.createEl('button', { cls: 'ert-canvas-sketch-submit mod-cta' });
        const updateSubmit = () => {
            submit.disabled = this.selected.size === 0;
            submit.setText(this.mode === 'scenes' ? t('ui.canvasSketch.createScenes', { scenes: tCount('scene', this.selected.size) }) : t('ui.canvasSketch.create'));
        };
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
     * The color each new subplot's ring will wear: its card color, read now,
     * so a theme preset becomes a fixed color. Read before any note is
     * written, so a color that cannot be read stops the conversion cleanly.
     */
    private newSubplotColors(plans: Map<string, CardColorSubplot>): Map<string, string> {
        const colors = new Map<string, string>();
        for (const [color, plan] of plans) {
            if (plan.kind !== 'new') continue;
            const hex = cardColorHex(this.containerEl.doc, color);
            if (!hex) throw new Error(t('ui.canvasSketch.colorUnreadable'));
            colors.set(plan.subplot, hex);
        }
        return colors;
    }

    /** New subplots that now have scenes keep their card color, on the book's profile. */
    private async keepNewSubplotColors(colors: Map<string, string>, cards: CanvasTextCard[], plans: Map<string, CardColorSubplot>, paths: Map<string, string>): Promise<void> {
        const created = new Set(cards.filter(card => paths.has(card.id)).map(card => this.subplotFor(card, plans)));
        const kept = [...colors].filter(([subplot]) => created.has(subplot));
        if (!kept.length) return;
        for (const [subplot, hex] of kept) setOwnSubplotColor(this.book, subplot, hex);
        await this.plugin.saveSettings();
        this.plugin.setCSSColorVariables();
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
            if (this.mode === 'scenes') {
                const plans = this.colorPlans();
                const colors = this.newSubplotColors(plans);
                try {
                    await this.writeScenes(cards, folder, paths, plans);
                } finally {
                    // Subplots whose scenes were written keep their color even if a later scene failed.
                    await this.keepNewSubplotColors(colors, cards, plans, paths);
                }
            } else await this.writeSketches(cards, folder, paths, ranked);
            // Never replace cards if the author (or another plugin) changed the map while files were being created.
            if (!this.canvasIsOpen() || JSON.stringify(initial) !== JSON.stringify(this.canvas.getData())) throw new Error(t('ui.canvasSketch.changed'));
            // Canvas retains the node class for an existing ID. New IDs let
            // the live view replace text cards, and make Canvas undo work.
            const replacements = new Map([...paths].map(([id, path]) => [id, { id: crypto.randomUUID().replace(/-/g, ''), path }]));
            try {
                this.canvas.setData(linkSketches(initial, replacements));
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
