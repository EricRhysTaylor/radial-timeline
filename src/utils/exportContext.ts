/*
 * Active Book Export Context
 *
 * Adapter used by the export pipeline.
 * Delegates to the Book Profiles system (source of truth).
 */

import type RadialTimelinePlugin from '../main';
import { TFile, TFolder, type App } from 'obsidian';
import type { ManuscriptSceneSelection } from './manuscript';
import { isPathInFolderScope } from './pathScope';
import { ExportFailure } from './exportErrors';
import type { ManuscriptSource } from '../types';
import { t } from '../i18n';
export type { ManuscriptSource } from '../types';

export function getManuscriptSourceFiles(app: App, kind: 'folder' | 'file', sourcePath: string): TFile[] {
    const entry = app.vault.getAbstractFileByPath(sourcePath);
    if (kind === 'file') {
        if (!(entry instanceof TFile) || entry.extension !== 'md') throw new Error(t('ui.exportContext.chooseMarkdownFile'));
        return [entry];
    }
    if (!(entry instanceof TFolder) || !sourcePath) throw new Error(t('ui.exportContext.chooseExistingFolder'));
    return app.vault.getMarkdownFiles()
        .filter(file => isPathInFolderScope(file.path, sourcePath))
        .sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true, sensitivity: 'variant' }));
}

/** Resolve exactly the reviewed paths, in the author's order; never rescan at export. */
export function getReviewedManuscriptSelection(app: App, source: Exclude<ManuscriptSource, { kind: 'book' }>): ManuscriptSceneSelection {
    if (!source.paths.length) throw new ExportFailure({ category: 'missing_files', message: t('ui.exportContext.includeAtLeastOneNote') });
    if (new Set(source.paths).size !== source.paths.length) throw new ExportFailure({ category: 'missing_files', message: t('ui.exportContext.duplicateNote') });
    const files = source.paths.map(sourcePath => {
        if (source.kind === 'file' ? sourcePath !== source.path : !isPathInFolderScope(sourcePath, source.path)) {
            throw new ExportFailure({ category: 'missing_files', message: t('ui.exportContext.noteOutsideSource', { path: sourcePath }) });
        }
        const file = app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile) || file.extension !== 'md') throw new ExportFailure({ category: 'missing_files', message: t('ui.exportContext.noteMissing', { path: sourcePath }) });
        return file;
    });
    return {
        files, titles: files.map(file => file.basename), sortOrder: 'Author-reviewed note order',
        whenDates: files.map(() => null), acts: files.map(() => null),
        sceneNumbers: files.map((_file, index) => index + 1), subplots: files.map(() => ''),
        synopses: files.map(() => null), runtimes: files.map(() => null), wordCounts: files.map(() => null),
    };
}
import { getActiveBookExportContext as getActiveBookExportContextFromBooks } from './books';

export interface BookExportContext {
    sourceFolder: string;  // e.g. "Book 1 Example Novel"
    title: string;         // display title, e.g. "Book 1 Example Novel"
    fileStem: string;      // safe filename stem, e.g. "Book-1-Example-Novel"
}

/**
 * Return the active book's export identity.
 * Delegates to the Book Profiles system (source of truth).
 */
export function getActiveBookExportContext(plugin: RadialTimelinePlugin): BookExportContext {
    return getActiveBookExportContextFromBooks(plugin.settings);
}
