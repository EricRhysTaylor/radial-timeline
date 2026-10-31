import { App, TFile } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import type RadialTimelinePlugin from '../main';
import { getBookIdForPath } from '../utils/books';
import { isSceneClassFrontmatter, readSceneId } from '../utils/sceneIds';
import { SKETCH_AFTER_SCENE, SKETCH_ORDER, sketchAnchor } from './sketchPlacement';
import { classifyForPromotion } from '../services/PromoteToSceneService';
import { authorKeyFor } from './timetableFiles';

export interface AttachedSketchMove {
    files: TFile[];
    anchorId: string;
    destinationAct: number;
    follow: boolean;
    actKey?: string;
}

/** Ask before a scene changes acts; closing the dialog cancels the scene move. */
export async function askAboutAttachedSketches(plugin: RadialTimelinePlugin, path: string, destinationAct: number): Promise<AttachedSketchMove | null | undefined> {
    const { app, settings } = plugin;
    const scene = app.vault.getAbstractFileByPath(path);
    if (!(scene instanceof TFile)) return undefined;
    const frontmatter = app.metadataCache.getFileCache(scene)?.frontmatter;
    if (!isSceneClassFrontmatter(frontmatter)) return undefined;
    const id = readSceneId(frontmatter);
    const bookId = getBookIdForPath(settings.books, path);
    if (!id || !bookId) return undefined;
    const notes = app.vault.getMarkdownFiles().filter(file => getBookIdForPath(settings.books, file.path) === bookId);
    const duplicates = notes.filter(file => isSceneClassFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter)
        && readSceneId(app.metadataCache.getFileCache(file)?.frontmatter) === id);
    const files = notes.filter(file => {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        const classification = classifyForPromotion(fm);
        return classification.kind === 'eligible' && classification.fromSketch && sketchAnchor(fm) === id;
    });
    if (files.length === 0) return undefined;
    // An ambiguous ID must never cause sketches to be moved with the wrong scene.
    if (duplicates.length !== 1) return undefined;
    const sceneName = scene.basename;
    const follow = await new Promise<boolean | null>(resolve => {
        class Choice extends ErtModal {
            private answered = false;
            onOpen(): void {
                this.titleEl.setText(t('ui.timetable.sketchMoveTitle'));
                this.contentEl.createEl('p', { text: t('ui.timetable.sketchMoveMessage', { count: files.length, scene: sceneName, act: destinationAct }) });
                const actions = this.mountActions();
                const choose = (value: boolean | null) => { this.answered = true; this.close(); resolve(value); };
                actions.createEl('button', { text: t('ui.timetable.sketchMoveCancel') }).addEventListener('click', () => choose(null));
                actions.createEl('button', { text: t('ui.timetable.sketchMoveStay') }).addEventListener('click', () => choose(false));
                actions.createEl('button', { text: t('ui.timetable.sketchMoveFollow'), cls: 'ert-mod-cta' }).addEventListener('click', () => choose(true));
            }
            onClose(): void { if (!this.answered) resolve(null); }
        }
        new Choice(app).open();
    });
    return follow === null ? null : { files, anchorId: id, destinationAct, follow, actKey: authorKeyFor('Act', settings) };
}

export async function applyAttachedSketchMove(app: App, move: AttachedSketchMove | undefined): Promise<void> {
    if (!move) return;
    for (const file of move.files) {
        await app.fileManager.processFrontMatter(file, fm => {
            if (sketchAnchor(fm) !== move.anchorId) throw new Error(`Sketch anchor changed: ${file.path}`);
            const key = (name: string) => Object.keys(fm).find(k => k.toLowerCase() === name.toLowerCase()) ?? name;
            if (move.follow) fm[key(move.actKey ?? 'Act')] = move.destinationAct;
            else { delete fm[key(SKETCH_AFTER_SCENE)]; delete fm[key(SKETCH_ORDER)]; }
        });
    }
}
