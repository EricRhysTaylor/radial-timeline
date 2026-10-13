import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SceneBodyIndex, findBodyMatches, locateBodyEvidenceRanges } from './SceneBodyIndex';
import { extractBodyAfterFrontmatter } from '../utils/frontmatterDocument';

describe('findBodyMatches', () => {
    it('finds a match regardless of case', () => {
        expect(findBodyMatches('She reached the coast.', 'COAST')).toEqual(['coast']);
    });

    it('returns the text as the author wrote it, not as it was typed', () => {
        // Stage 6 re-locates these strings in the file, so they must be the
        // prose's own casing.
        expect(findBodyMatches('The Coast was cold.', 'coast')).toEqual(['Coast']);
    });

    it('collects distinct case variants once each', () => {
        const body = 'coast, Coast, COAST, coast again';
        expect(findBodyMatches(body, 'coast')).toEqual(['coast', 'Coast', 'COAST']);
    });

    it('treats regex metacharacters literally', () => {
        // An author's punctuation means itself; nothing needs escaping.
        expect(findBodyMatches('He paused (briefly) there.', '(briefly)')).toEqual(['(briefly)']);
        expect(findBodyMatches('a.b and axb', 'a.b')).toEqual(['a.b']);
        expect(findBodyMatches("Don't stop.", "Don't")).toEqual(["Don't"]);
    });

    it('matches across an em dash and other typography', () => {
        expect(findBodyMatches('the light — brief — faded', '— brief —')).toEqual(['— brief —']);
    });

    it('finds overlapping-adjacent occurrences without looping forever', () => {
        expect(findBodyMatches('aaaa', 'aa')).toEqual(['aa']);
    });

    it('returns nothing for an absent phrase', () => {
        expect(findBodyMatches('She reached the coast.', 'mountain')).toEqual([]);
    });

    it('returns nothing for an empty body or empty phrase', () => {
        expect(findBodyMatches('', 'coast')).toEqual([]);
        expect(findBodyMatches('the coast', '')).toEqual([]);
    });

    it('matches a multi-word phrase as a phrase', () => {
        // Same semantics as timeline-field search: the phrase means itself, not
        // its words in any order.
        expect(findBodyMatches('she reached the coast at dawn', 'the coast')).toEqual(['the coast']);
        expect(findBodyMatches('the dawn reached her coast', 'the coast')).toEqual([]);
    });
});

describe('extractBodyAfterFrontmatter suffix invariant', () => {
    // locateBodyEvidenceRanges derives the body's start offset as
    // content.length - body.length. That is only valid because the helper
    // always returns a SUFFIX of the content. If it ever returned a rewritten
    // string, every highlight would land at the wrong offset.
    const cases: Array<[string, string]> = [
        ['with frontmatter', '---\nClass: Scene\n---\nShe reached the coast.'],
        ['without frontmatter', 'She reached the coast.'],
        ['CRLF frontmatter', '---\r\nClass: Scene\r\n---\r\nShe reached the coast.'],
        ['empty body', '---\nClass: Scene\n---\n'],
        ['fence-like text in body', 'Prose.\n\n---\n\nMore prose.']
    ];

    for (const [name, content] of cases) {
        it(`returns a suffix — ${name}`, () => {
            const body = extractBodyAfterFrontmatter(content, {});
            expect(content.endsWith(body)).toBe(true);
        });
    }
});

describe('locateBodyEvidenceRanges', () => {
    const content = '---\nClass: Scene\n---\nShe reached the Coast at dawn.';
    const body = extractBodyAfterFrontmatter(content, {});

    it('maps a body match to its offset in the whole file', () => {
        const [range] = locateBodyEvidenceRanges(content, body, ['Coast']);
        expect(content.slice(range[0], range[1])).toBe('Coast');
    });

    it('finds every occurrence', () => {
        const many = '---\nA: b\n---\ncoast and coast and coast';
        const manyBody = extractBodyAfterFrontmatter(many, {});
        const ranges = locateBodyEvidenceRanges(many, manyBody, ['coast']);
        expect(ranges).toHaveLength(3);
        ranges.forEach(([from, to]) => expect(many.slice(from, to)).toBe('coast'));
    });

    it('never marks text inside the frontmatter', () => {
        // Body scope searched prose only; a stray occurrence in the YAML must
        // not light up, or the highlight would contradict the scope.
        const withYaml = '---\nPlace: Coast\n---\nShe reached the Coast.';
        const yamlBody = extractBodyAfterFrontmatter(withYaml, {});
        const ranges = locateBodyEvidenceRanges(withYaml, yamlBody, ['Coast']);
        expect(ranges).toHaveLength(1);
        expect(ranges[0][0]).toBeGreaterThan(withYaml.indexOf('Place: Coast'));
    });

    it('skips evidence the author has since edited away', () => {
        expect(locateBodyEvidenceRanges(content, body, ['mountain'])).toEqual([]);
    });

    it('keeps the surviving evidence when only some of it is gone', () => {
        const ranges = locateBodyEvidenceRanges(content, body, ['mountain', 'Coast']);
        expect(ranges).toHaveLength(1);
        expect(content.slice(ranges[0][0], ranges[0][1])).toBe('Coast');
    });

    it('merges overlapping ranges so text is not double-marked', () => {
        const overlap = 'the coastline';
        const ranges = locateBodyEvidenceRanges(overlap, overlap, ['coast', 'coastline']);
        expect(ranges).toEqual([[4, 13]]);
    });

    it('returns ranges in ascending order', () => {
        const many = 'coast, then Coast, then COAST';
        const ranges = locateBodyEvidenceRanges(many, many, ['COAST', 'coast', 'Coast']);
        const starts = ranges.map(r => r[0]);
        expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    });

    it('returns nothing for empty inputs', () => {
        expect(locateBodyEvidenceRanges('', '', ['coast'])).toEqual([]);
        expect(locateBodyEvidenceRanges(content, body, [])).toEqual([]);
        expect(locateBodyEvidenceRanges(content, body, [''])).toEqual([]);
    });
});

describe('body index read ownership', () => {
    function harness() {
        const file = Object.assign(new TFile('a.md'), { stat: { mtime: 1, ctime: 1, size: 20 } });
        let text = '---\nPlace: Secret\n---\nOld body.';
        const read = vi.fn(async () => text);
        const app = { vault: { getAbstractFileByPath: (path: string) => path === file.path ? file : null, cachedRead: read },
            metadataCache: { getFileCache: () => ({}) } };
        return { file, read, setText: (value: string) => { text = value; }, index: new SceneBodyIndex(app as never) };
    }
    it('reuses unchanged text, reads edited text, and excludes YAML', async () => {
        const h = harness(), scenes = [{ path: 'a.md' }] as never;
        expect((await h.index.load(scenes)).bodies.get('a.md')?.trim()).toBe('Old body.');
        await h.index.load(scenes); expect(h.read).toHaveBeenCalledTimes(1);
        h.file.stat.mtime = 2; h.setText('New body.');
        expect((await h.index.load(scenes)).bodies.get('a.md')).toBe('New body.'); expect(h.read).toHaveBeenCalledTimes(2);
    });
    it('never stamps a stale read with an edit that occurred while awaiting it', async () => {
        const h = harness(); let release!: (value: string) => void;
        h.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const pending = h.index.load([{ path: 'a.md' }] as never);
        h.file.stat.mtime = 2; h.setText('New body.'); release('Old body.');
        const first = await pending;
        expect(first.bodies.size).toBe(0); expect(first.unreadableNotes.map(note => note.path)).toEqual(['a.md']);
        expect((await h.index.load([{ path: 'a.md' }] as never)).bodies.get('a.md')).toBe('New body.');
        expect(h.read).toHaveBeenCalledTimes(2);
    });
    it('reads duplicate subplot representations once and counts missing files once', async () => {
        const h = harness();
        const result = await h.index.load([{ path: 'a.md' }, { path: 'a.md' }, { path: 'missing.md' }, { path: 'missing.md' }] as never);
        expect(h.read).toHaveBeenCalledTimes(1); expect(result.unreadableNotes.map(note => note.path)).toEqual(['missing.md']);
    });
    it('reports read failures to the caller', async () => {
        const h = harness(); h.read.mockRejectedValue(new Error('unreadable'));
        expect((await h.index.load([{ path: 'a.md' }] as never)).unreadableNotes.map(note => note.path)).toEqual(['a.md']);
    });
    it('invalidates renamed or deleted paths', async () => {
        const h = harness(); await h.index.load([{ path: 'a.md' }] as never); h.index.invalidate('a.md');
        await h.index.load([{ path: 'a.md' }] as never); expect(h.read).toHaveBeenCalledTimes(2);
    });
    it('stops reading as soon as the run is superseded', async () => {
        const h = harness(); let current = true;
        h.read.mockImplementationOnce(async () => { current = false; return 'Old body.'; });
        const result = await h.index.load([{ path: 'a.md' }, { path: 'missing.md' }] as never, () => current);
        expect(result.bodies.size).toBe(0); expect(result.unreadableNotes.map(note => note.path)).toEqual([]); expect(h.read).toHaveBeenCalledTimes(1);
    });
});

it('invalidates an in-flight read even when an edit keeps the same size and timestamp', async () => {
    const file = Object.assign(new TFile('a.md'), { stat: { mtime: 1, ctime: 1, size: 4 } });
    let release!: (body: string) => void;
    const read = vi.fn<() => Promise<string>>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue('new!');
    const index = new SceneBodyIndex({ vault: { getAbstractFileByPath: () => file, cachedRead: read }, metadataCache: { getFileCache: () => ({}) } } as never);
    const pending = index.load([{ path: 'a.md' }] as never); index.invalidate('a.md'); release('old!');
    expect((await pending).unreadableNotes.map(note => note.path)).toEqual(['a.md']);
    expect((await index.load([{ path: 'a.md' }] as never)).bodies.get('a.md')).toBe('new!');
});

it('keeps literal match evidence after a Unicode character whose lowercase expands', () => {
    const body = 'İstanbul coast';
    const evidence = findBodyMatches(body, 'COAST');
    expect(evidence).toEqual(['coast']);
    expect(locateBodyEvidenceRanges(body, body, evidence)).toEqual([[9, 14]]);
});
