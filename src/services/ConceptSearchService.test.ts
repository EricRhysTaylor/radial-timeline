import { describe, expect, it } from 'vitest';
import {
    buildPasses, chunkBudgetFor, extractKeywords, keywordScore, orderByPromise,
    describeVerdict, verifyMatch, type ConceptSearchScene
} from './ConceptSearchService';
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

describe('extractKeywords', () => {
    it('keeps the content words', () => {
        expect(extractKeywords('a character falls into a crevice')).toEqual(['falls', 'crevice']);
    });

    it('drops the framing an author writes around a question', () => {
        expect(extractKeywords('scenes about racing')).toEqual(['racing']);
    });

    it('drops words too short to discriminate', () => {
        expect(extractKeywords('he is at war')).toEqual(['war']);
    });

    it('does not repeat a word', () => {
        expect(extractKeywords('fall and fall again')).toEqual(['fall', 'again']);
    });

    it('returns nothing for a query that is all framing', () => {
        expect(extractKeywords('what about these scenes')).toEqual([]);
    });
});

describe('keywordScore', () => {
    it('counts distinct keywords present', () => {
        expect(keywordScore('she fell into the crevice', ['fell', 'crevice'])).toBe(2);
        expect(keywordScore('she fell on the path', ['fell', 'crevice'])).toBe(1);
        expect(keywordScore('nothing relevant', ['fell', 'crevice'])).toBe(0);
    });

    it('matches inside longer words, so no stemmer is needed', () => {
        expect(keywordScore('she was falling', ['fall'])).toBe(1);
    });
});

describe('orderByPromise', () => {
    const s = (path: string, body: string): ConceptSearchScene => ({ path, bodyText: body });

    it('reads the most keyword-dense scenes first', () => {
        const ordered = orderByPromise(
            [s('none.md', 'unrelated'), s('one.md', 'she fell'), s('both.md', 'fell into a crevice')],
            ['fell', 'crevice']
        );
        expect(ordered.map(x => x.path)).toEqual(['both.md', 'one.md', 'none.md']);
    });

    it('still covers every scene — this is order, not a filter', () => {
        // Filtering on keywords would defeat the point: concept search exists to
        // find scenes that never use the author's words.
        const scenes = [s('a.md', 'x'), s('b.md', 'fell'), s('c.md', 'y')];
        expect(orderByPromise(scenes, ['fell'])).toHaveLength(3);
    });

    it('keeps manuscript order within a score band', () => {
        const scenes = [s('a.md', 'x'), s('b.md', 'y'), s('c.md', 'z')];
        expect(orderByPromise(scenes, ['nothing']).map(x => x.path)).toEqual(['a.md', 'b.md', 'c.md']);
    });

    it('leaves order untouched when the query has no keywords', () => {
        const scenes = [s('a.md', 'x'), s('b.md', 'y')];
        expect(orderByPromise(scenes, [])).toBe(scenes);
    });
});

describe('describeVerdict', () => {
    it('reads as the reason a scene did or did not qualify', () => {
        expect(describeVerdict(
            ['Does this scene depict a dinner?', 'Is Entiat present in this scene?'],
            [false, true]
        )).toBe('depict a dinner: no · Entiat present: yes');
    });

    it('handles an element that is not phrased as a question', () => {
        expect(describeVerdict(['a storm at sea'], [true])).toBe('a storm at sea: yes');
    });
});
