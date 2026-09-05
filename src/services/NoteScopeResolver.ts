import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type { RadialTimelineSettings } from '../types/settings';
import { getActiveBook, DEFAULT_BOOK_TITLE } from '../utils/books';
import { isPathInExplicitFolderScope } from '../utils/pathScope';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';

export type ScopedNoteType = 'Scene' | 'Beat' | 'Backdrop' | 'Outline';

export interface ActiveBookScopeResult {
    sourcePath: string;
    bookTitle: string;
    reason?: string;
}

export interface ScopedFilesResult extends ActiveBookScopeResult {
    files: TFile[];
    scopeSummary: string;
}

function toBookTitle(raw: string | undefined): string {
    const trimmed = (raw || '').trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_BOOK_TITLE;
}

function resolveSourcePath(settings: RadialTimelineSettings): ActiveBookScopeResult {
    const activeBook = getActiveBook(settings);
    const bookTitle = toBookTitle(activeBook?.title);
    const activeSource = normalizePath((activeBook?.sourceFolder || '').trim());
    if (activeSource.length > 0 && activeSource !== '/' && activeSource !== '.') {
        return { sourcePath: activeSource, bookTitle };
    }

    const legacySource = normalizePath((settings.sourcePath || '').trim());
    if (legacySource.length > 0 && legacySource !== '/' && legacySource !== '.') {
        return { sourcePath: legacySource, bookTitle };
    }

    return {
        sourcePath: '',
        bookTitle,
        reason: 'No active book scope configured. Set a source folder for the active book.'
    };
}

function getNoteLabel(noteType: ScopedNoteType | undefined, count: number): string {
    const plural = count === 1 ? '' : 's';
    switch (noteType) {
        case 'Scene':
            return `scene${plural}`;
        case 'Beat':
            return `beat${plural}`;
        case 'Backdrop':
            return `backdrop${plural}`;
        case 'Outline':
            return `outline${plural}`;
        default:
            return `note${plural}`;
    }
}

function isMatchForNoteType(
    noteType: ScopedNoteType,
    frontmatter: Record<string, unknown>
): boolean {
    const rawClass = frontmatter.Class;
    const classValue = typeof rawClass === 'string' ? rawClass.trim().toLowerCase() : '';
    if (noteType === 'Scene') return classValue === 'scene';
    if (noteType === 'Beat') return classValue === 'beat' || classValue === 'plot';
    if (noteType === 'Backdrop') return classValue === 'backdrop';
    if (noteType === 'Outline') return classValue === 'outline';
    return false;
}

export function explainScope(
    files: TFile[],
    options: { noteType?: ScopedNoteType; bookTitle?: string } = {}
): string {
    const bookTitle = toBookTitle(options.bookTitle);
    return `${files.length} ${getNoteLabel(options.noteType, files.length)} in ${bookTitle}`;
}

export function resolveActiveBookSourcePath(
    app: App,
    settings: RadialTimelineSettings
): ActiveBookScopeResult {
    const base = resolveSourcePath(settings);
    if (!base.sourcePath) return base;

    const folder = app.vault.getAbstractFileByPath(base.sourcePath);
    if (!(folder instanceof TFolder)) {
        return {
            sourcePath: '',
            bookTitle: base.bookTitle,
            reason: `Active book source folder is missing: ${base.sourcePath}`
        };
    }

    return base;
}

export function resolveBookScopedMarkdownFiles(
    app: App,
    settings: RadialTimelineSettings
): ScopedFilesResult {
    const scope = resolveActiveBookSourcePath(app, settings);
    if (!scope.sourcePath) {
        return {
            ...scope,
            files: [],
            scopeSummary: explainScope([], { bookTitle: scope.bookTitle })
        };
    }

    const files = app.vault.getMarkdownFiles()
        .filter(file => isPathInExplicitFolderScope(file.path, scope.sourcePath));

    return {
        ...scope,
        files,
        scopeSummary: explainScope(files, { bookTitle: scope.bookTitle })
    };
}

export function resolveBookScopedFiles(options: {
    app: App;
    settings: RadialTimelineSettings;
    noteType: ScopedNoteType;
}): ScopedFilesResult {
    const { app, settings, noteType } = options;
    const markdownScope = resolveBookScopedMarkdownFiles(app, settings);
    if (!markdownScope.sourcePath) {
        return {
            ...markdownScope,
            scopeSummary: explainScope([], { noteType, bookTitle: markdownScope.bookTitle })
        };
    }

    const mappings = getActiveFrontmatterMappings(settings);
    const files = markdownScope.files.filter(file => {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) return false;
        const fm = mappings
            ? normalizeFrontmatterKeys(cache.frontmatter, mappings)
            : (cache.frontmatter as Record<string, unknown>);
        return isMatchForNoteType(noteType, fm);
    });

    return {
        sourcePath: markdownScope.sourcePath,
        bookTitle: markdownScope.bookTitle,
        files,
        scopeSummary: explainScope(files, { noteType, bookTitle: markdownScope.bookTitle })
    };
}
