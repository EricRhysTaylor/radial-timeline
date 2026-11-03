import { App, DropdownComponent, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { getActiveBook, getBookIdForPath } from '../utils/books';
import { safeTitle } from '../utils/noteTitle';
import { t } from '../i18n';
import { buildTableRow, type TimetableRow } from './timetableModel';
import { planSubplotCanvas, storyRangeBounds, storyRangeRows, type StoryRange } from './subplotCanvas';
import { preferTitleForCanvas } from './CanvasCardPresentation';

export class SubplotCanvasModal extends ErtModal {
    private bookId: string;
    private act: number | null = null;
    private subplot: string | null = null;
    private range: StoryRange = 'all';
    private layout: 'horizontal' | 'vertical' | 'story' = 'horizontal';
    private busy = false;

    constructor(app: App, private readonly plugin: RadialTimelinePlugin, initialBookId?: string) {
        super(app);
        this.bookId = initialBookId ?? getActiveBook(plugin.settings)?.id ?? plugin.settings.books?.[0]?.id ?? '';
    }

    private rows(): TimetableRow[] {
        return this.app.vault.getMarkdownFiles()
            .filter(file => getBookIdForPath(this.plugin.settings.books, file.path) === this.bookId)
            .map(file => buildTableRow(file.path, file.basename, this.app.metadataCache.getFileCache(file)?.frontmatter, this.plugin.settings))
            .filter(row => row.kind === 'scene');
    }

    onOpen(): void {
        this.applyShell({ size: 'lg' });
        this.mountHeader({ badge: { text: t('ui.subplotCanvas.badge') }, title: t('ui.subplotCanvas.title'), subtitle: t('ui.subplotCanvas.subtitle') });
        const books = (this.plugin.settings.books ?? []).filter(book => book.sourceFolder.trim());
        if (!books.some(book => book.id === this.bookId)) this.bookId = books[0]?.id ?? '';
        const bookRow = this.contentEl.createDiv({ cls: 'setting-item' });
        bookRow.createDiv({ cls: 'setting-item-name', text: t('ui.subplotCanvas.book') });
        const bookSelect = new DropdownComponent(bookRow.createDiv({ cls: 'setting-item-control' }));
        books.forEach(book => { bookSelect.addOption(book.id, book.title); });
        bookSelect.setValue(this.bookId);
        const actRow = this.contentEl.createDiv({ cls: 'setting-item' });
        actRow.createDiv({ cls: 'setting-item-name', text: t('ui.subplotCanvas.act') });
        const actSelect = new DropdownComponent(actRow.createDiv({ cls: 'setting-item-control' }));
        const layoutRow = this.contentEl.createDiv({ cls: 'setting-item' });
        layoutRow.createDiv({ cls: 'setting-item-name', text: t('ui.subplotCanvas.layout') });
        const layoutSelect = new DropdownComponent(layoutRow.createDiv({ cls: 'setting-item-control' }));
        layoutSelect.addOption('horizontal', t('ui.subplotCanvas.layoutHorizontal'));
        layoutSelect.addOption('vertical', t('ui.subplotCanvas.layoutVertical'));
        layoutSelect.addOption('story', t('ui.subplotCanvas.layoutStory'));
        layoutSelect.setValue(this.layout);
        const rangeRow = this.contentEl.createDiv({ cls: 'setting-item' });
        rangeRow.createDiv({ cls: 'setting-item-name', text: t('ui.subplotCanvas.range') });
        const rangeSelect = new DropdownComponent(rangeRow.createDiv({ cls: 'setting-item-control' }));
        rangeSelect.addOption('all', t('ui.subplotCanvas.rangeAll'));
        rangeSelect.addOption('beginning', t('ui.subplotCanvas.rangeBeginning'));
        rangeSelect.addOption('middle', t('ui.subplotCanvas.rangeMiddle'));
        rangeSelect.addOption('end', t('ui.subplotCanvas.rangeEnd'));
        this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.subplotCanvas.rangeHint') });
        const laneRow = this.contentEl.createDiv({ cls: 'setting-item' });
        laneRow.createDiv({ cls: 'setting-item-name', text: t('ui.subplotCanvas.subplot') });
        const laneSelect = new DropdownComponent(laneRow.createDiv({ cls: 'setting-item-control' }));
        const count = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint' });
        const actions = this.mountActions();
        const cancel = actions.createEl('button', { text: t('ui.subplotCanvas.cancel') });
        cancel.addEventListener('click', () => this.close());
        const create = actions.createEl('button', { text: t('ui.subplotCanvas.create'), cls: 'ert-subplot-canvas-create mod-cta' });
        const update = (): void => {
            const rows = this.rows();
            actSelect.selectEl.empty(); actSelect.addOption('', t('ui.subplotCanvas.allActs'));
            [...new Set(rows.flatMap(row => row.act === null ? [] : [row.act]))].sort((a, b) => a - b)
                .forEach(act => { actSelect.addOption(String(act), t('ui.subplotCanvas.actNumber', { act })); });
            actSelect.setValue(this.act === null ? '' : String(this.act));
            laneSelect.selectEl.empty(); laneSelect.addOption('', t('ui.subplotCanvas.allSubplots'));
            [...new Set(rows.filter(row => this.act === null || row.act === this.act).flatMap(row => row.subplots))]
                .forEach(lane => { laneSelect.addOption(lane, lane); });
            if (this.subplot && !Array.from(laneSelect.selectEl.options).some(option => option.value === this.subplot)) this.subplot = null;
            laneSelect.setValue(this.subplot ?? '');
            let serial = 0;
            rangeSelect.setValue(this.range);
            const plan = planSubplotCanvas(rows, { act: this.act, subplot: this.subplot, layout: this.layout }, () => String(++serial));
            count.setText(t('ui.subplotCanvas.count', { scenes: plan.sceneCount, cards: plan.appearanceCount }));
            create.disabled = !this.bookId || plan.sceneCount === 0 || this.busy;
        };
        const defaultRange = (): void => { this.range = storyRangeRows(this.rows(), this.act, 'all').length > 24 ? 'beginning' : 'all'; };
        bookSelect.onChange(value => { this.bookId = value; this.act = null; this.subplot = null; defaultRange(); update(); });
        actSelect.onChange(value => { this.act = value ? Number(value) : null; defaultRange(); update(); });
        layoutSelect.onChange(value => { this.layout = value as typeof this.layout; update(); });
        rangeSelect.onChange(value => { this.range = value as StoryRange; update(); });
        laneSelect.onChange(value => { this.subplot = value || null; update(); });
        create.addEventListener('click', () => {
            if (this.busy) return;
            this.busy = true; create.disabled = true;
            void this.createCanvas().finally(() => { this.busy = false; });
        });
        defaultRange();
        update();
    }

    private async createCanvas(): Promise<void> {
        const book = (this.plugin.settings.books ?? []).find(item => item.id === this.bookId);
        if (!book) return;
        const rows = this.rows();
        const plan = planSubplotCanvas(rows, { act: this.act, subplot: this.subplot, layout: this.layout }, () => crypto.randomUUID().replace(/-/g, ''));
        const bounds = storyRangeBounds(plan.nodes, rows, this.act, this.subplot, this.range);
        if (!plan.sceneCount) { new Notice(t('ui.subplotCanvas.empty')); return; }
        try {
            const folder = 'Radial Timeline/Story Maps';
            if (!this.app.vault.getFolderByPath('Radial Timeline')) await this.app.vault.createFolder('Radial Timeline');
            if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
            const stem = safeTitle(book.title) || 'Book';
            let path = `${folder}/${stem} - Subplot Map.canvas`;
            for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${stem} - Subplot Map ${n}.canvas`;
            const file = await this.app.vault.create(path, JSON.stringify({ nodes: plan.nodes, edges: plan.edges }, null, 2));
            preferTitleForCanvas(file.path);
            await this.app.workspace.openLinkText(file.path, '', true);
            this.close();
            if (bounds) {
                // Canvas viewport methods are not part of Obsidian's public API. If
                // unavailable, keep the complete map and leave its default view intact.
                for (let attempt = 0; attempt < 20; attempt++) {
                    const leaf = this.app.workspace.getLeavesOfType('canvas').find(item => (item.view as { file?: { path: string } }).file?.path === file.path);
                    const canvas = (leaf?.view as unknown as { canvas?: { nodes?: Map<string, unknown>; zoomToBbox?: (box: typeof bounds) => void } })?.canvas;
                    if (canvas?.nodes?.size && typeof canvas.zoomToBbox === 'function') { canvas.zoomToBbox(bounds); break; }
                    await new Promise(resolve => window.setTimeout(resolve, 100));
                }
            }
        } catch (error) {
            console.error('[Subplot Canvas]', error);
            new Notice(t('ui.subplotCanvas.failed'), 8000);
        }
    }
}
