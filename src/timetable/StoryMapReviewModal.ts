import { App, Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { getBookIdForPath } from '../utils/books';
import { buildTableRow } from './timetableModel';
import { planSubplotCanvas, storyRangeRows } from './subplotCanvas';
import { SubplotCanvasModal } from './SubplotCanvasModal';
import { canvasChanges, carryCanvasEdits, isStoryMapProvenance, matchingBaseline, type StoryMapProvenance } from './storyMapProvenance';
import { diffStoryMap, type StoryMapScene } from './storyMapDiff';
import { transposeStoryCanvas } from './canvasOrientation';
import type { StoryCanvasData } from './canvasSketches';
import { t } from '../i18n';
import { selectedCanvasContents } from './storyMapLegacyCarry';

type LiveCanvas = { getData?: () => StoryCanvasData; selection?: Set<{ getData?: () => { id?: string } }> };

export function mapScenes(plugin: RadialTimelinePlugin, provenance: StoryMapProvenance): StoryMapScene[] {
    const rows = plugin.app.vault.getMarkdownFiles()
        .filter(file => getBookIdForPath(plugin.settings.books, file.path) === provenance.bookId)
        .map(file => buildTableRow(file.path, file.basename, plugin.app.metadataCache.getFileCache(file)?.frontmatter, plugin.settings));
    return storyRangeRows(rows, provenance.act, 'all').filter(row => provenance.subplot === null || row.subplots.includes(provenance.subplot))
        .map(row => ({ path: row.path, act: row.act, subplots: [...row.subplots] }));
}

export class StoryMapReviewModal extends ErtModal {
    constructor(app: App, private readonly plugin: RadialTimelinePlugin, private readonly file: TFile, private readonly canvas: LiveCanvas) { super(app); }

    onOpen(): void {
        this.applyShell({ size: 'lg' });
        const record = this.plugin.settings.storyMapProvenance?.[this.file.path];
        this.mountHeader({ badge: { text: t('ui.storyMapReview.badge') }, title: t('ui.storyMapReview.title'), subtitle: this.file.basename });
        if (!isStoryMapProvenance(record) || !this.canvas.getData) {
            this.contentEl.createEl('p', { text: t('ui.storyMapReview.legacy') });
            const source = this.canvas.getData?.();
            const ids = [...(this.canvas.selection ?? [])].flatMap(item => {
                const id = item.getData?.()?.id;
                return typeof id === 'string' ? [id] : [];
            });
            let carryCount = 0;
            let invalidSelection = false;
            try { if (source && ids.length) carryCount = selectedCanvasContents(source, ids).nodes.length; } catch { invalidSelection = true; }
            this.contentEl.createEl('p', { text: invalidSelection ? t('ui.storyMapReview.legacyInvalid') : carryCount ? t('ui.storyMapReview.legacySelected', { count: carryCount }) : t('ui.storyMapReview.legacySelect') });
            const actions = this.mountActions();
            actions.createEl('button', { text: t('ui.storyMapReview.close') }).addEventListener('click', () => this.close());
            actions.createEl('button', { text: t('ui.storyMapReview.cleanCopy'), cls: 'ert-story-map-review__create' }).addEventListener('click', () => {
                this.close(); new SubplotCanvasModal(this.app, this.plugin).open();
            });
            const carry = actions.createEl('button', { text: t('ui.storyMapReview.carrySelection'), cls: 'ert-story-map-review__create mod-cta' });
            carry.disabled = !source || !ids.length || !carryCount;
            carry.addEventListener('click', () => {
                if (!source) return;
                const books = new Set((source.nodes ?? []).flatMap(node => typeof node.file === 'string' ? [getBookIdForPath(this.plugin.settings.books, node.file)] : []).filter((id): id is string => !!id));
                const book = books.size === 1 ? [...books][0] : undefined;
                const snapshot = JSON.parse(JSON.stringify(source)) as StoryCanvasData;
                this.close();
                new SubplotCanvasModal(this.app, this.plugin, book, undefined, { source: snapshot, selectedIds: ids, readCurrent: () => this.canvas.getData?.() }).open();
            });
            return;
        }
        const book = this.plugin.settings.books.find(item => item.id === record.bookId);
        const current = this.canvas.getData();
        const baseline = matchingBaseline(record.generated, current);
        const edits = canvasChanges(baseline.data, current);
        const scenes = mapScenes(this.plugin, record);
        const changes = diffStoryMap(record.scenes, scenes);
        const line = (label: string, value: string): void => {
            const row = this.contentEl.createDiv({ cls: 'setting-item' });
            row.createDiv({ cls: 'setting-item-name', text: label });
            row.createDiv({ cls: 'setting-item-control', text: value });
        };
        line(t('ui.storyMapReview.book'), book?.title ?? t('ui.storyMapReview.missingBook'));
        line(t('ui.storyMapReview.scope'), `${record.act === null ? t('ui.subplotCanvas.allActs') : t('ui.subplotCanvas.actNumber', { act: record.act })} · ${record.subplot ?? t('ui.subplotCanvas.allSubplots')}`);
        const flipped = !!record.orientationFlipped !== baseline.transposed;
        const vertical = record.layout === 'vertical' ? !flipped : flipped;
        line(t('ui.storyMapReview.layout'), `${record.layout === 'story' ? `${t('ui.subplotCanvas.layoutStory')} · ` : ''}${t(vertical ? 'ui.storyMapReview.vertical' : 'ui.storyMapReview.horizontal')}`);
        line(t('ui.storyMapReview.focus'), t(`ui.subplotCanvas.${record.initialFocus === 'all' ? 'rangeAll' : record.initialFocus === 'beginning' ? 'rangeBeginning' : record.initialFocus === 'middle' ? 'rangeMiddle' : 'rangeEnd'}`));
        line(t('ui.storyMapReview.generated'), new Date(record.generatedAt).toLocaleDateString());
        const list = this.contentEl.createEl('ul');
        const report = (label: string, paths: string[]): void => { if (paths.length) list.createEl('li', { text: `${label}: ${paths.join(', ')}` }); };
        const title = (path: string): string => path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
        report(t('ui.storyMapReview.added'), changes.added.map(scene => title(scene.path)));
        report(t('ui.storyMapReview.removed'), changes.removed.map(scene => title(scene.path)));
        report(t('ui.storyMapReview.acts'), changes.actChanged.map(change => `${title(change.after.path)} (${change.before.act ?? '—'} → ${change.after.act ?? '—'})`));
        report(t('ui.storyMapReview.subplots'), changes.subplotsChanged.map(change => `${title(change.after.path)} (${change.before.subplots.join(' / ') || '—'} → ${change.after.subplots.join(' / ') || '—'})`));
        if (changes.orderChanged) list.createEl('li', { text: t('ui.storyMapReview.order') });
        if (!list.children.length) list.createEl('li', { text: t('ui.storyMapReview.current') });
        this.contentEl.createEl('p', { text: t('ui.storyMapReview.edits', { added: edits.addedNodes, changed: edits.changedNodes, removed: edits.removedNodes, edges: edits.addedEdges + edits.changedEdges + edits.removedEdges }) });
        this.contentEl.createEl('p', { text: t('ui.storyMapReview.carryHint') });
        const actions = this.mountActions();
        actions.createEl('button', { text: t('ui.storyMapReview.close') }).addEventListener('click', () => this.close());
        const create = actions.createEl('button', { text: t('ui.storyMapReview.updatedCopy'), cls: 'ert-story-map-review__create mod-cta' });
        create.disabled = !book || !scenes.length;
        create.addEventListener('click', () => {
            create.disabled = true;
            void this.makeCopy(record, current, scenes).catch(error => {
                console.error('[Story map] Could not create updated copy', error);
                new Notice(t('ui.storyMapReview.failed'), 8000); create.disabled = false;
            });
        });
    }

    private async makeCopy(record: StoryMapProvenance, reviewed: StoryCanvasData, reviewedScenes: StoryMapScene[]): Promise<void> {
        const live = this.canvas.getData?.();
        if (!live || JSON.stringify(live) !== JSON.stringify(reviewed) || JSON.stringify(mapScenes(this.plugin, record)) !== JSON.stringify(reviewedScenes)) {
            new Notice(t('ui.storyMapReview.changedAgain')); this.close(); return;
        }
        const rows = this.app.vault.getMarkdownFiles().filter(file => getBookIdForPath(this.plugin.settings.books, file.path) === record.bookId)
            .map(file => buildTableRow(file.path, file.basename, this.app.metadataCache.getFileCache(file)?.frontmatter, this.plugin.settings));
        const plan = planSubplotCanvas(rows, { act: record.act, subplot: record.subplot, layout: record.layout }, () => crypto.randomUUID().replace(/-/g, ''));
        const original = matchingBaseline(record.generated, live);
        let generated = JSON.parse(JSON.stringify({ nodes: plan.nodes, edges: plan.edges })) as StoryCanvasData;
        const orientationFlipped = !!record.orientationFlipped !== original.transposed;
        if (orientationFlipped) generated = transposeStoryCanvas(generated) ?? generated;
        const copy = carryCanvasEdits(original.data, live, generated);
        const base = this.file.path.replace(/\.canvas$/i, '');
        let path = `${base} - Updated.canvas`;
        for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} - Updated ${n}.canvas`;
        const file = await this.app.vault.create(path, JSON.stringify(copy.data, null, 2));
        this.plugin.settings.storyMapProvenance = { ...this.plugin.settings.storyMapProvenance, [path]: { ...record, orientationFlipped, generatedAt: new Date().toISOString(), scenes: mapScenes(this.plugin, record), generated } };
        await this.plugin.saveSettings();
        this.close();
        await this.app.workspace.openLinkText(file.path, '', true);
    }
}
