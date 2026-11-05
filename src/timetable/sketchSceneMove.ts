import { App, TFile } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import type RadialTimelinePlugin from '../main';
import { getBookIdForPath } from '../utils/books';
import { isSceneClassFrontmatter, readSceneId } from '../utils/sceneIds';
import { findFrontmatterKey } from '../utils/frontmatterKeys';
import { SKETCH_AFTER_SCENE, SKETCH_ORDER, sketchAnchor } from './sketchPlacement';
import { classifyForPromotion } from '../services/PromoteToSceneService';
import { authorKeyFor } from './timetableFiles';
import { SceneReorderVerificationError } from '../services/SceneReorderService';

export interface AttachedSketchMove {
    files: TFile[];
    anchorId: string;
    destinationAct: number;
    follow: boolean;
    /** The author's own spelling of the Act property, from authorKeyFor. */
    actKey: string;
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
                this.contentEl.empty();
                this.applyShell({ size: 'md' });
                this.mountHeader({ title: t('ui.timetable.sketchMoveTitle'), subtitle: t('ui.timetable.sketchMoveMessage', { count: files.length, scene: sceneName, act: destinationAct }) });
                const actions = this.mountActions();
                const choose = (value: boolean | null) => { this.answered = true; this.close(); resolve(value); };
                actions.createEl('button', { text: t('ui.timetable.sketchMoveCancel') }).addEventListener('click', () => choose(null));
                actions.createEl('button', { text: t('ui.timetable.sketchMoveStay') }).addEventListener('click', () => choose(false));
                actions.createEl('button', { text: t('ui.timetable.sketchMoveFollow'), cls: 'ert-sketch-move-primary' }).addEventListener('click', () => choose(true));
            }
            onClose(): void { if (!this.answered) resolve(null); }
        }
        new Choice(app).open();
    });
    return follow === null ? null : { files, anchorId: id, destinationAct, follow, actKey: authorKeyFor('Act', settings) };
}

/**
 * Run a scene move, then its attached sketches. A verification warning arrives
 * after every rename and Act write has finished, so the sketches still follow,
 * and the warning is raised again for the caller to report.
 */
export async function runSceneMoveWithSketches(applyMove: () => Promise<void>, moveSketches: () => Promise<void>, onApplied: () => void): Promise<void> {
    let warning: SceneReorderVerificationError | null = null;
    try {
        await applyMove();
    } catch (error) {
        if (!(error instanceof SceneReorderVerificationError)) throw error;
        warning = error;
    }
    onApplied();
    await moveSketches();
    if (warning) throw warning;
}

export async function applyAttachedSketchMove(app: App, move: AttachedSketchMove | undefined): Promise<void> {
    if (!move) return;
    for (const file of move.files) {
        await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            if (sketchAnchor(fm) !== move.anchorId) throw new Error(`Sketch anchor changed: ${file.path}`);
            const key = (name: string) => findFrontmatterKey(fm, name) ?? name;
            if (move.follow) fm[key(move.actKey)] = move.destinationAct;
            else { delete fm[key(SKETCH_AFTER_SCENE)]; delete fm[key(SKETCH_ORDER)]; }
        });
    }
}
