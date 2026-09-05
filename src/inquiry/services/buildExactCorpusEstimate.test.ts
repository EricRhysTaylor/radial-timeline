import { describe, expect, it } from 'vitest';
import {
    buildExactCorpusEstimateFromManifestEntries,
    buildPendingCorpusEstimateFromManifestEntries
} from './buildExactCorpusEstimate';
import type { CorpusManifestEntry } from '../runner/types';
import { TFile } from 'obsidian';

function makeEntry(overrides: Partial<CorpusManifestEntry>): CorpusManifestEntry {
    return {
        path: 'Book/Scene.md',
        mtime: 1,
        class: 'scene',
        mode: 'full',
        ...overrides
    };
}

describe('buildExactCorpusEstimateFromManifestEntries', () => {
    it('counts cleaned full bodies and exact summaries from the selected corpus', async () => {
        const entries: CorpusManifestEntry[] = [
            makeEntry({ path: 'Book/Scene 1.md', class: 'scene', mode: 'full' }),
            makeEntry({ path: 'Book/Outline.md', class: 'outline', mode: 'summary' }),
            makeEntry({ path: 'Refs/Character.md', class: 'character', mode: 'full' }),
            makeEntry({ path: 'Ignored.md', class: 'scene', mode: 'excluded' })
        ];
        const files = new Map<string, TFile>([
            ['Book/Scene 1.md', new TFile('Book/Scene 1.md')],
            ['Book/Outline.md', new TFile('Book/Outline.md')],
            ['Refs/Character.md', new TFile('Refs/Character.md')]
        ]);
        const contents = new Map<string, string>([
            ['Book/Scene 1.md', '---\nTitle: Scene 1\n---\nBody text\n<!-- remove -->\n%% secret %%'],
            ['Refs/Character.md', 'Reference text']
        ]);
        const frontmatter = new Map<string, Record<string, unknown>>([
            ['Book/Outline.md', { Summary: 'Outline summary' }]
        ]);

        const estimate = await buildExactCorpusEstimateFromManifestEntries({
            entries,
            vault: {
                getAbstractFileByPath: (path: string) => files.get(path) ?? null,
                cachedRead: async (file: { path: string }) => contents.get(file.path) ?? ''
            } as never,
            metadataCache: {
                getFileCache: (file: { path: string }) => ({
                    frontmatter: frontmatter.get(file.path)
                })
            } as never,
            frontmatterMappings: undefined
        });

        expect(estimate.sceneCount).toBe(1);
        expect(estimate.outlineCount).toBe(1);
        expect(estimate.referenceCount).toBe(1);
        expect(estimate.evidenceChars).toBe('Body text'.length + 'Outline summary'.length + 'Reference text'.length);
        expect(estimate.breakdown.scenesTokens).toBe(Math.ceil('Body text'.length / 4));
        expect(estimate.breakdown.outlineTokens).toBe(Math.ceil('Outline summary'.length / 4));
        expect(estimate.breakdown.referenceTokens).toBe(Math.ceil('Reference text'.length / 4));
        expect(estimate.method).toBe('rt_cleaned_corpus_exact');
    });

    it('builds a pending estimate without surfacing partial token totals', () => {
        const estimate = buildPendingCorpusEstimateFromManifestEntries([
            makeEntry({ class: 'scene', mode: 'full' }),
            makeEntry({ path: 'Outline.md', class: 'outline', mode: 'summary' }),
            makeEntry({ path: 'Reference.md', class: 'character', mode: 'full' })
        ]);

        expect(estimate.sceneCount).toBe(1);
        expect(estimate.outlineCount).toBe(1);
        expect(estimate.referenceCount).toBe(1);
        expect(estimate.estimatedTokens).toBe(0);
        expect(estimate.method).toBe('rt_pending');
    });
});
