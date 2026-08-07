import { describe, expect, it } from 'vitest';
import { chunkBudgetFor, chunkScenes, parseMatches, verifyMatch, type ConceptSearchScene } from './ConceptSearchService';
import type { LocalLlmSettings } from '../ai/types';

const scene = (overrides: Partial<ConceptSearchScene> = {}): ConceptSearchScene => ({
    path: 'a.md',
    bodyText: 'She reached the coast at dawn and did not look back.',
    ...overrides
});

describe('verifyMatch', () => {
    it('keeps a quote the model copied verbatim', () => {
        const result = verifyMatch(scene(), ['did not look back']);
        expect(result).toEqual({ bodyQuotes: ['did not look back'], source: 'body' });
    });

    it('drops a quote the model invented', () => {
        // The whole point: a local model that is confidently wrong is expected,
        // so nothing reaches the timeline on its say-so alone.
        expect(verifyMatch(scene(), ['she wept for the drowned city'])).toBeNull();
    });

    it('drops a quote that is merely close', () => {
        // Near-misses are the common failure — paraphrase that reads verbatim.
        expect(verifyMatch(scene(), ['She reached the coast at dusk'])).toBeNull();
    });

    it('keeps the verifiable quotes and discards the rest', () => {
        const result = verifyMatch(scene(), ['invented entirely', 'at dawn']);
        expect(result?.bodyQuotes).toEqual(['at dawn']);
    });

    it('attributes a fields-only quote to the timeline-fields scope', () => {
        const result = verifyMatch(
            scene({ bodyText: undefined, fieldsText: 'Arrival · Homecoming · Ada' }),
            ['Homecoming']
        );
        expect(result).toEqual({ bodyQuotes: [], source: 'timelineFields' });
    });

    it('marks a scene quoted from both scopes as both', () => {
        const result = verifyMatch(
            scene({ fieldsText: 'Arrival · Homecoming' }),
            ['Homecoming', 'at dawn']
        );
        expect(result?.source).toBe('both');
        // Only body quotes become highlight evidence — metadata has no prose to
        // point at when the scene opens.
        expect(result?.bodyQuotes).toEqual(['at dawn']);
    });

    it('ignores blank and non-string quotes', () => {
        const result = verifyMatch(scene(), ['', '   ', 'at dawn']);
        expect(result?.bodyQuotes).toEqual(['at dawn']);
    });

    it('does not duplicate a quote the model repeated', () => {
        const result = verifyMatch(scene(), ['at dawn', 'at dawn']);
        expect(result?.bodyQuotes).toEqual(['at dawn']);
    });

    it('returns null when the model named a scene but quoted nothing', () => {
        expect(verifyMatch(scene(), [])).toBeNull();
    });
});

describe('chunkScenes', () => {
    const sized = (path: string, chars: number): ConceptSearchScene =>
        ({ path, bodyText: 'x'.repeat(chars) });

    it('keeps scenes together while they fit', () => {
        const chunks = chunkScenes([sized('a.md', 40), sized('b.md', 40)], 1000);
        expect(chunks).toHaveLength(1);
    });

    it('starts a new chunk when the budget would be exceeded', () => {
        // ~4 chars per token, so 400 chars is ~100 tokens.
        const chunks = chunkScenes([sized('a.md', 400), sized('b.md', 400)], 120);
        expect(chunks).toHaveLength(2);
    });

    it('gives an oversized scene its own chunk rather than skipping it', () => {
        // Refusing to look at a long scene would silently exclude it from the
        // sweep while still reporting a complete pass.
        const chunks = chunkScenes([sized('a.md', 40), sized('huge.md', 40_000)], 120);
        expect(chunks.flat().map(s => s.path)).toContain('huge.md');
    });

    it('returns nothing for an empty corpus', () => {
        expect(chunkScenes([], 1000)).toEqual([]);
    });
});

describe('chunkBudgetFor', () => {
    const local = (caps: string[]): LocalLlmSettings =>
        ({ declaredCapabilities: caps } as unknown as LocalLlmSettings);

    it('stays small unless the operator declares long context', () => {
        // The loaded context length is set outside Obsidian and cannot be
        // discovered; overshooting it makes the server reject the whole
        // request rather than degrade.
        expect(chunkBudgetFor(local([]))).toBeLessThanOrEqual(2_000);
    });

    it('trusts an explicit longContext declaration', () => {
        expect(chunkBudgetFor(local(['longContext']))).toBeGreaterThan(chunkBudgetFor(local([])));
    });

    it('tolerates settings with no declared capabilities at all', () => {
        expect(chunkBudgetFor({} as unknown as LocalLlmSettings)).toBeLessThanOrEqual(2_000);
    });
});

describe('parseMatches', () => {
    it('reads a well-formed reply', () => {
        const matches = parseMatches('{"matches":[{"scene_id":"1","reason":"r","quotes":["q"]}]}');
        expect(matches).toHaveLength(1);
        expect(matches[0].scene_id).toBe('1');
    });

    it('treats an empty match list as a real answer', () => {
        // "Nothing bears on this question" is useful and must not read as a
        // parse failure.
        expect(parseMatches('{"matches":[]}')).toEqual([]);
    });

    it('yields nothing for malformed or unexpected shapes', () => {
        expect(parseMatches('not json')).toEqual([]);
        expect(parseMatches('{"matches":"nope"}')).toEqual([]);
        expect(parseMatches('{}')).toEqual([]);
    });

    it('discards entries without a scene id', () => {
        expect(parseMatches('{"matches":[{"reason":"r","quotes":[]}]}')).toEqual([]);
    });
});
