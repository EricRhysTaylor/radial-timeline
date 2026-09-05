import type { InquiryScope } from '../state';
import type { CorpusManifestEntry } from '../runner/types';
import { fnv1a32Hex } from '../../utils/hash';

const isInFocusedBook = (path: string, activeBookId: string): boolean =>
    path === activeBookId || path.startsWith(`${activeBookId}/`);

export function buildInquiryBookAnchorId(rootPath: string): string {
    const normalized = (rootPath || '').trim().toLowerCase();
    return `book_${fnv1a32Hex(normalized)}`;
}

const dedupeEntries = (entries: CorpusManifestEntry[]): CorpusManifestEntry[] => {
    const seen = new Set<string>();
    const deduped: CorpusManifestEntry[] = [];
    entries.forEach(entry => {
        const key = [
            entry.class,
            entry.scope ?? '',
            entry.path,
            entry.sceneId ?? '',
            entry.mode
        ].join('\u0000');
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(entry);
    });
    return deduped;
};

export function scopeEntriesToActiveInquiryTarget(params: {
    entries: CorpusManifestEntry[];
    scope: InquiryScope;
    activeBookId?: string;
}): CorpusManifestEntry[] {
    const deduped = dedupeEntries(params.entries);
    if (params.scope !== 'book') return deduped;
    if (!params.activeBookId) return [];

    return deduped.filter(entry => {
        if (entry.class === 'scene') {
            return isInFocusedBook(entry.path, params.activeBookId || '');
        }
        if (entry.class === 'outline') {
            return entry.scope !== 'saga' && isInFocusedBook(entry.path, params.activeBookId || '');
        }
        return true;
    });
}

export function summarizeScopedInquiryEntries(entries: CorpusManifestEntry[]): {
    scenes: string[];
    outlines: string[];
    references: string[];
} {
    const scenes: string[] = [];
    const outlines: string[] = [];
    const references: string[] = [];

    entries.forEach(entry => {
        if (entry.class === 'scene') {
            scenes.push(entry.path);
            return;
        }
        if (entry.class === 'outline') {
            outlines.push(entry.path);
            return;
        }
        references.push(entry.path);
    });

    return { scenes, outlines, references };
}
