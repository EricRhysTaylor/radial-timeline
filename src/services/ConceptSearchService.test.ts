import { describe, expect, it } from 'vitest';
import { buildPasses, chunkBudgetFor, parseMatches, verifyMatch, type ConceptSearchScene } from './ConceptSearchService';
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

describe('buildPasses', () => {
    const sized = (path: string, chars: number): ConceptSearchScene =>
        ({ path, bodyText: 'x'.repeat(chars) });

    it('sends exactly one scene per request', () => {
        // Batching several scenes is what broke this against a real server:
        // rejected outright when the batch exceeded an undiscoverable context
        // length, then timing out when it did fit.
        const passes = buildPasses([sized('a.md', 40), sized('b.md', 40)], 1000);
        expect(passes).toHaveLength(2);
        expect(passes.map(p => p.scene.path)).toEqual(['a.md', 'b.md']);
    });

    it('reports scene indices so progress counts scenes', () => {
        const passes = buildPasses([sized('a.md', 40), sized('b.md', 40)], 1000);
        expect(passes.map(p => p.sceneIndex)).toEqual([0, 1]);
    });

    it('windows a scene too long to send whole, rather than truncating it', () => {
        // Silently dropping the tail would report a complete sweep of prose it
        // never read.
        const passes = buildPasses([sized('huge.md', 4_000)], 100);
        expect(passes.length).toBeGreaterThan(1);
        expect(passes.every(p => p.scene.path === 'huge.md')).toBe(true);
        // Every window still belongs to scene 0, so progress does not inflate.
        expect(passes.every(p => p.sceneIndex === 0)).toBe(true);
    });

    it('overlaps windows so a passage is not lost at a seam', () => {
        const body = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
        const passes = buildPasses([{ path: 'a.md', bodyText: body }], 100);
        const covered = passes.map(p => p.text).join('');
        // Every word survives somewhere, including those near the boundaries.
        expect(covered).toContain('w0');
        expect(covered).toContain('w399');
    });

    it('keeps the scene details on every window of a long scene', () => {
        const passes = buildPasses(
            [{ path: 'a.md', fieldsText: 'Arrival · Homecoming', bodyText: 'x'.repeat(4_000) }],
            100
        );
        expect(passes.every(p => p.text.includes('Arrival · Homecoming'))).toBe(true);
    });

    it('returns nothing for an empty corpus', () => {
        expect(buildPasses([], 1000)).toEqual([]);
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
