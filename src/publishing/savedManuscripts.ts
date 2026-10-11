import type { App } from 'obsidian';
import type { SavedManuscriptSource } from '../types';
import { getManuscriptSourceFiles } from '../utils/exportContext';
import { isPathInFolderScope } from '../utils/pathScope';

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** Validate persisted records without dropping or rewriting an author's saved selections. */
export function readSavedManuscripts(value: unknown): SavedManuscriptSource[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('Saved manuscripts are unavailable: invalid saved data.');
    const ids = new Set<string>();
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') throw new Error('Saved manuscripts are unavailable: invalid saved entry.');
        const record = entry as Partial<SavedManuscriptSource>;
        const source = record.source;
        if (record.schemaVersion !== 1 || typeof record.id !== 'string' || !record.id || ids.has(record.id)
            || typeof record.name !== 'string' || !record.name.trim() || !source
            || !['file', 'folder'].includes(source.kind) || typeof source.path !== 'string' || !source.path
            || typeof source.title !== 'string' || typeof source.author !== 'string'
            || !strings(source.paths) || !source.paths.length || !strings(record.candidatePaths)
            || new Set(record.candidatePaths).size !== record.candidatePaths.length
            || new Set(source.paths).size !== source.paths.length
            || record.candidatePaths.some(path => source.kind === 'file' ? path !== source.path : !isPathInFolderScope(path, source.path))
            || JSON.stringify(record.candidatePaths.filter(path => source.paths.includes(path))) !== JSON.stringify(source.paths)) {
            throw new Error('Saved manuscripts are unavailable: an entry has an unsupported version or invalid selection.');
        }
        ids.add(record.id);
    }
    return value as SavedManuscriptSource[];
}

/** New notes are visible for review, never implicitly included. Missing paths stay visible. */
export function restoreSavedManuscript(app: App, record: SavedManuscriptSource): {
    source: SavedManuscriptSource['source']; candidatePaths: string[]; addedPaths: string[]; missingPaths: string[];
} {
    readSavedManuscripts([record]);
    const livePaths = getManuscriptSourceFiles(app, record.source.kind, record.source.path).map(file => file.path);
    const live = new Set(livePaths);
    const saved = new Set(record.candidatePaths);
    const addedPaths = livePaths.filter(path => !saved.has(path));
    return {
        source: structuredClone(record.source),
        candidatePaths: [...record.candidatePaths, ...addedPaths],
        addedPaths,
        missingPaths: record.candidatePaths.filter(path => !live.has(path)),
    };
}

export function saveManuscriptRecord(records: SavedManuscriptSource[], record: SavedManuscriptSource, update: boolean): SavedManuscriptSource[] {
    readSavedManuscripts([record]);
    if (update && !records.some(item => item.id === record.id)) throw new Error('This saved manuscript no longer exists. Save it as a new manuscript.');
    if (records.some(item => item.id !== record.id && item.name.trim().toLowerCase() === record.name.trim().toLowerCase())) {
        throw new Error('A saved manuscript already uses that name. Choose a different name.');
    }
    const snapshot = structuredClone(record);
    return update ? records.map(item => item.id === record.id ? snapshot : item) : [...records, snapshot];
}
