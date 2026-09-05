import { describe, expect, it } from 'vitest';
import { buildInquiryBookAnchorId, scopeEntriesToActiveInquiryTarget, summarizeScopedInquiryEntries } from './canonicalInquiryCorpus';
import type { CorpusManifestEntry } from '../runner/types';

function makeSceneEntries(bookPath: string, count: number): CorpusManifestEntry[] {
    return Array.from({ length: count }, (_, index) => ({
        path: `${bookPath}/Scene ${index + 1}.md`,
        sceneId: `scn_${bookPath.replace(/\W+/g, '').toLowerCase()}_${index + 1}`,
        mtime: index + 1,
        class: 'scene' as const,
        mode: 'full' as const
    }));
}

describe('scopeEntriesToActiveInquiryTarget', () => {
    it('builds stable book anchors for saga minimap refs', () => {
        expect(buildInquiryBookAnchorId('Books/Book 1')).toMatch(/^book_[a-f0-9]{8}$/);
        expect(buildInquiryBookAnchorId('Books/Book 1')).toBe(buildInquiryBookAnchorId('books/book 1'));
        expect(buildInquiryBookAnchorId('Books/Book 1')).not.toBe(buildInquiryBookAnchorId('Books/Book 2'));
    });

    it('keeps the active book corpus at 53 scenes instead of broadening to 91', () => {
        const entries: CorpusManifestEntry[] = [
            ...makeSceneEntries('Books/Book 1', 53),
            ...makeSceneEntries('Books/Book 2', 38),
            {
                path: 'Books/Book 1/Outline.md',
                mtime: 1,
                class: 'outline',
                scope: 'book',
                mode: 'full'
            },
            {
                path: 'Saga/Outline.md',
                mtime: 1,
                class: 'outline',
                scope: 'saga',
                mode: 'full'
            },
            {
                path: 'Reference/Character A.md',
                mtime: 1,
                class: 'character',
                mode: 'full'
            }
        ];

        const scoped = scopeEntriesToActiveInquiryTarget({
            entries,
            scope: 'book',
            activeBookId: 'Books/Book 1'
        });
        const summary = summarizeScopedInquiryEntries(scoped);

        expect(summary.scenes).toHaveLength(53);
        expect(summary.outlines).toEqual(['Books/Book 1/Outline.md']);
        expect(summary.references).toEqual(['Reference/Character A.md']);
    });

    it('returns no active corpus when book scope has no resolved target', () => {
        const scoped = scopeEntriesToActiveInquiryTarget({
            entries: makeSceneEntries('Books/Book 1', 3),
            scope: 'book',
            activeBookId: undefined
        });

        expect(scoped).toEqual([]);
    });
});
