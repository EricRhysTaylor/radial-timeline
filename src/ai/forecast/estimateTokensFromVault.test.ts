import { describe, expect, it } from 'vitest';
import type { MetadataCache, Vault } from 'obsidian';
import { TFile } from 'obsidian';
import { cleanEvidenceBody } from '../../inquiry/utils/evidenceCleaning';
import {
    FORECAST_CHARS_PER_TOKEN,
    estimateInquiryTokens
} from './estimateTokensFromVault';

describe('estimateInquiryTokens', () => {
    const file = new TFile('Book 1/01 Scene.md');
    const bookProfiles = [{ id: 'book-1', title: 'Book 1', sourceFolder: 'Book 1' }];

    const makeVault = (rawByPath: Record<string, string>): Vault => ({
        getMarkdownFiles: () => [file],
        read: async (target: TFile) => rawByPath[target.path] || '',
    } as unknown as Vault);

    const makeMetadataCache = (frontmatterByPath: Record<string, Record<string, unknown>>): MetadataCache => ({
        getFileCache: (target: TFile) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
    } as unknown as MetadataCache);

    it('applies cleanEvidenceBody before counting body evidence', async () => {
        const raw = `---
Class: Scene
Summary: A short summary
---
Before.
<!-- hidden -->
%% remove %%
After.`;
        const cleaned = cleanEvidenceBody(raw);
        const label = `scene: ${file.path}`;
        const expectedChars = label.length + cleaned.length + 6;
        const expectedTokens = Math.ceil(expectedChars / FORECAST_CHARS_PER_TOKEN);

        const result = await estimateInquiryTokens({
            vault: makeVault({ [file.path]: raw }),
            metadataCache: makeMetadataCache({
                [file.path]: { Class: 'scene', Summary: 'A short summary' }
            }),
            bookProfiles,
            inquirySources: {
                scanRoots: ['/Book 1/'],
                resolvedScanRoots: ['/Book 1/'],
                classScope: ['/'],
                classes: [{
                    className: 'scene',
                    enabled: true,
                    bookScope: 'full',
                    sagaScope: 'none',
                    referenceScope: 'none'
                }]
            }
        });

        expect(result.evidenceLabel).toBe('Bodies');
        expect(result.corpus.evidenceChars).toBe(expectedChars);
        expect(result.corpus.estimatedTokens).toBe(expectedTokens);
        expect(result.corpus.sceneCount).toBe(1);
        expect(result.corpus.outlineCount).toBe(0);
        expect(result.corpus.method).toBe('rt_chars_heuristic');
    });

    it('counts only Summary field content when summaries mode is active', async () => {
        const raw = `---
Class: Scene
Summary: Summary only evidence.
---
This very long body should not be counted when summary mode is selected.`;
        const summary = 'Summary only evidence.';
        const label = `scene: ${file.path}`;
        const expectedChars = label.length + summary.length + 6;
        const expectedTokens = Math.ceil(expectedChars / FORECAST_CHARS_PER_TOKEN);

        const result = await estimateInquiryTokens({
            vault: makeVault({ [file.path]: raw }),
            metadataCache: makeMetadataCache({
                [file.path]: { Class: 'scene', Summary: summary }
            }),
            bookProfiles,
            inquirySources: {
                scanRoots: ['/Book 1/'],
                resolvedScanRoots: ['/Book 1/'],
                classScope: ['/'],
                classes: [{
                    className: 'scene',
                    enabled: true,
                    bookScope: 'summary',
                    sagaScope: 'none',
                    referenceScope: 'none'
                }]
            }
        });

        expect(result.evidenceLabel).toBe('Summaries');
        expect(result.corpus.evidenceChars).toBe(expectedChars);
        expect(result.corpus.estimatedTokens).toBe(expectedTokens);
        expect(result.corpus.sceneCount).toBe(1);
        expect(result.corpus.outlineCount).toBe(0);
        expect(result.corpus.method).toBe('rt_chars_heuristic');
    });
});
