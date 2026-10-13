import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import type { TimelineItem } from '../types';

const listModels = vi.fn();
const complete = vi.fn();
const verifyComplete = vi.fn();
const seenQuotes = new Set<string>();

vi.mock('../ai/localLlm/backends', () => ({
    getLocalLlmBackend: () => ({ id: 'ollama', label: 'Ollama', listModels, complete: async (request: { responseFormat?: { schemaName?: string } }) => {
        if (request.responseFormat?.schemaName === 'query_match') return verifyComplete(request);
        const result = await complete(request);
        if (result?.content) {
            try {
                const parsed = JSON.parse(result.content) as { evidence?: string[][] };
                for (const quotes of parsed.evidence ?? []) quotes.forEach(quote => seenQuotes.add(quote));
            } catch { /* malformed fixtures remain malformed for the real validator */ }
        }
        return result;
    } })
}));
vi.mock('../ai/credentials/credentials', () => ({
    getCredential: () => Promise.resolve(undefined)
}));

const { SearchService } = await import('./SearchService');
const { createSearchState } = await import('./searchState');

const LOCAL = {
    enabled: true, configurationMode: 'manual', backend: 'ollama',
    baseUrl: 'http://localhost:11434/v1', defaultModelId: 'qwen3',
    timeoutMs: 1000, maxRetries: 0, jsonMode: 'response_format', declaredCapabilities: [], contextWindowByModel: {}, capabilitiesByModel: {}
};

const scene = (path: string, synopsis: string): TimelineItem =>
    ({ path, title: path, synopsis, rawFrontmatter: {} } as TimelineItem);

function makeHarness() {
    const bodies = new Map<string, string>();
    let resolveScenes: ((s: TimelineItem[]) => void) | null = null;
    const scenesPromise = new Promise<TimelineItem[]>(res => { resolveScenes = res; });

    const app = {
        vault: {
            on: () => ({}),
            getAbstractFileByPath: (path: string) => {
                if (!bodies.has(path)) return null;
                const file = new TFile(path);
                (file as unknown as { stat: { mtime: number } }).stat = { mtime: 1 }; // SAFE: mock TFile has no stat
                return file;
            },
            cachedRead: (file: TFile) => Promise.resolve(bodies.get(file.path) ?? '')
        },
        metadataCache: { getFileCache: () => ({}) }
    };

    const plugin = {
        searchState: createSearchState(),
        settings: { enableAiSceneAnalysis: true, aiSettings: { localLlm: { ...LOCAL } } } as Record<string, unknown>,
        registerEvent: () => { /* no-op */ },
        getTimelineSceneData: () => scenesPromise,
        getTimelineViews: () => [{ refreshTimeline: () => {}, syncTimelineSearchControl: () => {} }],
        bodies
    };

    const service = new SearchService(app as never, plugin as never);
    return { service, plugin, bodies, resolve: (s: TimelineItem[]) => resolveScenes?.(s) };
}

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };

/** The one-off decomposition reply that opens every run. */
const elementsReply = (elements: string[]) => ({
    success: true, content: JSON.stringify({ groups: [elements] }), responseData: {}, error: undefined
});

/** A per-scene verdict: one boolean per question, plus supporting quotes. */
const verdict = (answers: boolean[], quotes: string[] = []) => ({
    success: true, content: JSON.stringify({ evidence: answers.map(supported => supported ? quotes : []) }), responseData: {}, error: undefined
});

/** Matches when every element holds and the quote is verbatim. */
const match = (quotes: string[]) => verdict([true], quotes);
const noMatch = () => verdict([false], []);

beforeEach(() => {
    listModels.mockReset();
    complete.mockReset();
    verifyComplete.mockReset();
    seenQuotes.clear();
    verifyComplete.mockImplementation((request: { userPrompt: string }) => ({ success: true,
        content: JSON.stringify({ match: true, quotes: [...seenQuotes].filter(quote => request.userPrompt.includes(quote)).slice(0, 2) }), responseData: {} }));
    listModels.mockResolvedValue([{ id: 'qwen3' }]);
});

describe('concept search through the transaction', () => {
    it('commits only the scenes whose quotes verify', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('real.md', 'She reached the coast at dawn.');
        h.bodies.set('fake.md', 'A wholly unrelated paragraph.');

        // One request per scene now, so each gets its own reply: the first
        // quotes the prose, the second invents.
        complete
            .mockResolvedValueOnce(elementsReply(['Does this scene depict an arrival?']))
            .mockResolvedValueOnce(match(['at dawn']))
            .mockResolvedValueOnce(match(['she wept for the city']));

        h.service.performSearch('a homecoming');
        h.resolve([scene('real.md', ''), scene('fake.md', '')]);
        await settle();

        expect([...h.plugin.searchState.hits.keys()]).toEqual(['real.md']);
        expect(h.plugin.searchState.droppedClaims).toBe(1);
        expect(h.plugin.searchState.hits.get('real.md')?.evidence).toEqual(['at dawn']);
        // The reason is now derived from the verdict, not the model's prose:
        // it says which element held, so a match can be argued with.
        expect(h.plugin.searchState.hits.get('real.md')?.reason).toBe('depict an arrival: yes');
    });

    it('refuses to run when no local model is available', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'prose');
        listModels.mockRejectedValue(new Error('connection refused'));

        h.service.performSearch('a homecoming');
        h.resolve([scene('a.md', '')]);
        await settle();

        expect(h.plugin.searchState.status).toBe('error');
        expect(h.plugin.searchState.error).toContain('connection refused');
        // No cloud fallback: the run simply does not happen.
        expect(complete).not.toHaveBeenCalled();
    });

    it('sends one request per scene, never a batch', async () => {
        // Batching is what broke this live: rejected for exceeding an
        // undiscoverable context length, then timing out when it did fit.
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'first scene prose');
        h.bodies.set('b.md', 'second scene prose');
        h.bodies.set('c.md', 'third scene prose');
        complete
            .mockResolvedValueOnce(elementsReply(['Is anything relevant here?']))
            .mockResolvedValue(noMatch());

        h.service.performSearch('a question');
        h.resolve([scene('a.md', ''), scene('b.md', ''), scene('c.md', '')]);
        await settle();

        // One decomposition call, then one per scene.
        expect(complete).toHaveBeenCalledTimes(4);
    });

    it('publishes matches as they are found, not only at the end', async () => {
        // A manuscript-wide run takes minutes. An author watching an unchanged
        // timeline cannot tell work from a hang, and cannot start reading the
        // matches that already exist.
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'first scene prose');
        h.bodies.set('b.md', 'second scene prose');
        h.bodies.set('c.md', 'third scene prose');

        const seen: number[] = [];
        let first = true;
        complete.mockImplementation(() => {
            if (first) { first = false; return Promise.resolve(elementsReply(['Relevant?'])); }
            // Record how many hits are visible on the timeline at each call.
            seen.push(h.plugin.searchState.hits.size);
            return Promise.resolve(match(['prose']));
        });

        h.service.performSearch('a question');
        h.resolve([scene('a.md', ''), scene('b.md', ''), scene('c.md', '')]);
        await settle();

        // By the third request, earlier matches were already on screen.
        expect(seen).toEqual([0, 1, 2]);
        expect(h.plugin.searchState.hits.size).toBe(3);
    });

    it('keeps what it found when the author cancels', async () => {
        // The author has been watching matches arrive and may already have
        // opened one; discarding them for asking the sweep to stop would be
        // indefensible.
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'first scene prose');
        h.bodies.set('b.md', 'second scene prose');
        h.bodies.set('c.md', 'third scene prose');

        let firstCall = true;
        complete.mockImplementation(() => {
            if (firstCall) { firstCall = false; return Promise.resolve(elementsReply(['Relevant?'])); }
            if (h.plugin.searchState.hits.size >= 1) h.service.cancelSearch();
            return Promise.resolve(match(['prose']));
        });

        h.service.performSearch('a question');
        h.resolve([scene('a.md', ''), scene('b.md', ''), scene('c.md', '')]);
        await settle();

        expect(h.plugin.searchState.hits.size).toBeGreaterThan(0);
        expect(h.plugin.searchState.stoppedEarly).toBe(true);
        expect(h.plugin.searchState.status).toBe('ready');
    });

    it('keeps matches already published when a later scene fails', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'first scene prose');
        h.bodies.set('b.md', 'second scene prose');

        complete
            .mockResolvedValueOnce(elementsReply(['Relevant?']))
            .mockResolvedValueOnce(match(['prose']))
            .mockResolvedValueOnce({ success: false, content: null, responseData: {}, error: 'boom' });

        h.service.performSearch('a question');
        h.resolve([scene('a.md', ''), scene('b.md', '')]);
        await settle();

        // The bad scene no longer kills the sweep, so the run completes and
        // keeps the match found before it — reporting the gap rather than
        // pretending the scene simply had no match.
        expect(h.plugin.searchState.status).toBe('ready');
        expect(h.plugin.searchState.hits.size).toBe(1);
        expect(h.plugin.searchState.unreadableScenes).toBe(1);
    });

    it('skips a scene with an unusable reply and keeps sweeping', async () => {
        // Losing ninety scenes of work to one malformed reply is a bad trade,
        // especially once matches stream in and the author is already reading.
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'first scene prose');
        h.bodies.set('bad.md', 'second scene prose');
        h.bodies.set('c.md', 'third scene prose');

        complete
            .mockResolvedValueOnce(elementsReply(['Relevant?']))
            .mockResolvedValueOnce(match(['prose']))
            .mockResolvedValueOnce({ success: false, content: null, responseData: {}, error: 'Unterminated string' })
            .mockResolvedValueOnce(match(['prose']));

        h.service.performSearch('a question');
        h.resolve([scene('a.md', ''), scene('bad.md', ''), scene('c.md', '')]);
        await settle();

        expect(h.plugin.searchState.status).toBe('ready');
        // The scenes either side of the bad one still matched.
        expect(h.plugin.searchState.hits.size).toBe(2);
        // And the gap is reported, not hidden.
        expect(h.plugin.searchState.unreadableScenes).toBe(1);
    });

    it('gives up when failures run consecutively — a dead server, not a bad reply', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        for (let i = 0; i < 8; i += 1) h.bodies.set(`s${i}.md`, 'prose');
        complete
            .mockResolvedValueOnce(elementsReply(['Relevant?']))
            .mockResolvedValue({ success: false, content: null, responseData: {}, error: 'connection lost' });

        h.service.performSearch('a question');
        h.resolve(Array.from({ length: 8 }, (_, i) => scene(`s${i}.md`, '')));
        await settle();

        expect(h.plugin.searchState.status).toBe('error');
        expect(h.plugin.searchState.error).toContain('in a row');
        // Stopped rather than waiting out a timeout for every remaining scene.
        expect(complete.mock.calls.length).toBeLessThan(8);
    });

    it('reports a gap rather than passing off an unreadable scene as a non-match', async () => {
        // "No match here" and "never found out" are different answers, and the
        // author has to be able to tell them apart.
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'prose');

        complete
            .mockResolvedValueOnce(elementsReply(['Relevant?']))
            .mockResolvedValue({ success: false, content: null, responseData: {}, error: 'model exploded' });

        h.service.performSearch('a homecoming');
        h.resolve([scene('a.md', '')]);
        await settle();

        expect(h.plugin.searchState.status).toBe('ready');
        expect(h.plugin.searchState.hits.size).toBe(0);
        expect(h.plugin.searchState.unreadableScenes).toBe(1);
    });

    it('abandons nothing already committed when the whole run errors', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        for (let i = 0; i < 8; i += 1) h.bodies.set(`s${i}.md`, 'prose');
        h.plugin.searchState.active = true;
        h.plugin.searchState.term = 'earlier';
        h.plugin.searchState.hits.set('kept.md', { path: 'kept.md', source: 'body', evidence: [] });

        complete
            .mockResolvedValueOnce(elementsReply(['Relevant?']))
            .mockResolvedValue({ success: false, content: null, responseData: {}, error: 'connection lost' });

        h.service.performSearch('a homecoming');
        h.resolve(Array.from({ length: 8 }, (_, i) => scene(`s${i}.md`, '')));
        await settle();

        expect(h.plugin.searchState.status).toBe('error');
        // A failed sweep must not publish an empty set over usable results.
        expect(h.plugin.searchState.hits.has('kept.md')).toBe(true);
    });

    it('treats an empty match list as a real, committed answer', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'prose');
        complete
            .mockResolvedValueOnce(elementsReply(['Relevant?']))
            .mockResolvedValue(noMatch());

        h.service.performSearch('a homecoming');
        h.resolve([scene('a.md', '')]);
        await settle();

        expect(h.plugin.searchState.status).toBe('ready');
        expect(h.plugin.searchState.hits.size).toBe(0);
        expect(h.plugin.searchState.droppedClaims).toBe(0);
    });

    it('never sends prose to a completion when assist is off', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: true, body: false, llmAssist: false };

        h.service.performSearch('coast');
        h.resolve([scene('a.md', 'the coast')]);
        await settle();

        expect(complete).not.toHaveBeenCalled();
        expect(listModels).not.toHaveBeenCalled();
    });
});

describe('search hardening regressions', () => {
    it('preserves OR alternatives', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: true, body: false, llmAssist: true };
        complete.mockResolvedValueOnce({ success: true, content: JSON.stringify({ groups: [['Celebration?'], ['Farewell?']] }), responseData: {} })
            .mockResolvedValueOnce(verdict([true, false], ['cheered']))
            .mockResolvedValueOnce(verdict([false, true], ['waved goodbye']));
        h.service.performSearch('celebration or farewell');
        h.resolve([scene('a.md', 'They cheered.'), scene('b.md', 'They waved goodbye.')]);
        await settle();
        expect([...h.plugin.searchState.hits.keys()]).toEqual(['a.md', 'b.md']);
    });

    it('combines grounded facts across windows, then verifies the original request', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'Ada arrived.' + ' padding'.repeat(2500) + 'They ate dinner.');
        complete.mockResolvedValueOnce(elementsReply(['Ada present?', 'Dinner?'])).mockImplementation(request => ({
            success: true, responseData: {}, content: JSON.stringify({ evidence: [
                request.userPrompt.includes('Ada arrived.') ? ['Ada arrived.'] : [],
                request.userPrompt.includes('They ate dinner.') ? ['They ate dinner.'] : []
            ] })
        }));
        h.service.performSearch('dinner with Ada'); h.resolve([scene('a.md', '')]); await settle();
        expect(h.plugin.searchState.hits.size).toBe(1);
        expect(h.plugin.searchState.hits.get('a.md')?.evidence).toEqual(expect.arrayContaining(['Ada arrived.', 'They ate dinner.']));
        expect(verifyComplete).toHaveBeenCalledTimes(1);
        expect(complete.mock.calls.length).toBeGreaterThan(2);
    });

    it('does not accept separate facts when the original relationship is false', async () => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        complete.mockResolvedValueOnce(elementsReply(['Ada present?', 'Dinner?']))
            .mockResolvedValue(verdict([true, true], ['Ada left.', 'Others ate dinner.']));
        verifyComplete.mockResolvedValue({ success: true, content: JSON.stringify({ match: false, quotes: [] }), responseData: {} });
        h.service.performSearch('dinner with Ada'); h.resolve([scene('a.md', 'Ada left. Others ate dinner.')]); await settle();
        expect(h.plugin.searchState.hits.size).toBe(0);
        expect(verifyComplete).toHaveBeenCalledTimes(1);
    });

    it('requires grounded support for every criterion in a matching group', async () => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        complete.mockResolvedValueOnce(elementsReply(['Dinner?', 'Ada present?']))
            .mockResolvedValue({ success: true, responseData: {}, content: JSON.stringify({ evidence: [['Dinner.'], ['invented presence']] }) });
        h.service.performSearch('dinner with Ada'); h.resolve([scene('a.md', 'Dinner.')]); await settle();
        expect(h.plugin.searchState.hits.size).toBe(0); expect(h.plugin.searchState.droppedClaims).toBe(1);
        expect(verifyComplete).not.toHaveBeenCalled();
    });

    it('searches one file once while retaining every subplot representation', async () => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        complete.mockResolvedValueOnce(elementsReply(['Relationship?'])).mockResolvedValue(match(['Relationship']));
        h.service.performSearch('relationship');
        h.resolve([{ ...scene('a.md', 'coast'), subplot: 'Main Plot' }, { ...scene('a.md', 'coast'), subplot: 'Relationship' }]);
        await settle();
        expect(complete).toHaveBeenCalledTimes(2); // Plan plus one evidence pass; verification has its own spy.
        expect(complete.mock.calls[1][0].userPrompt).toContain('Main Plot');
        expect(complete.mock.calls[1][0].userPrompt).toContain('Relationship');
        expect(h.plugin.searchState.hits.size).toBe(1);
    });

    it('aborts a superseded AI run and prevents it scheduling another scene', async () => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        let release!: (value: unknown) => void;
        let signal!: AbortSignal;
        complete.mockResolvedValueOnce(elementsReply(['Relevant?'])).mockImplementationOnce(request => {
            signal = request.signal; return new Promise(resolve => { release = resolve; });
        }).mockResolvedValue(noMatch());
        h.service.performSearch('concept'); h.resolve([scene('a.md', 'coast'), scene('b.md', 'coast')]); await settle();
        h.plugin.searchState.options = { timelineFields: true, body: false, llmAssist: false };
        h.service.performSearch('coast'); await settle();
        expect(signal.aborted).toBe(true);
        release(noMatch()); await settle();
        expect(complete).toHaveBeenCalledTimes(2);
        expect(h.plugin.searchState.term).toBe('coast'); expect(h.plugin.searchState.hits.size).toBe(2);
    });

    it('serializes replacement AI sweeps until the old request settles', async () => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        let release!: (value: unknown) => void;
        complete.mockResolvedValueOnce(elementsReply(['Relevant?'])).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
            .mockResolvedValueOnce(elementsReply(['New relevant?'])).mockResolvedValue(noMatch());
        h.service.performSearch('first'); h.resolve([scene('a.md', 'prose')]); await settle();
        h.service.performSearch('second'); await settle();
        expect(complete).toHaveBeenCalledTimes(2);
        release(noMatch()); await settle();
        expect(complete).toHaveBeenCalledTimes(4); expect(h.plugin.searchState.term).toBe('second');
    });

    it('refuses completion calls when the AI master switch is off', async () => {
        const h = makeHarness(); h.plugin.settings.enableAiSceneAnalysis = false;
        h.plugin.searchState.options.llmAssist = true;
        h.service.performSearch('concept'); h.resolve([scene('a.md', 'prose')]); await settle();
        expect(complete).not.toHaveBeenCalled(); expect(listModels).not.toHaveBeenCalled();
        expect(h.plugin.searchState.status).toBe('error');
    });

    it('stops when permission is withdrawn during decomposition', async () => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        complete.mockImplementation(() => { h.plugin.settings.enableAiSceneAnalysis = false; return elementsReply(['Relevant?']); });
        h.service.performSearch('concept'); h.resolve([scene('a.md', 'prose')]); await settle();
        expect(complete).toHaveBeenCalledTimes(1);
        expect(h.plugin.searchState.stoppedEarly).toBe(true); expect(h.plugin.searchState.hits.size).toBe(0);
    });

    it.each(['decomposition', 'final scene'])('cancels during %s without reporting unreadable scenes', async phase => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        let release!: (value: unknown) => void;
        if (phase === 'final scene') complete.mockResolvedValueOnce(elementsReply(['Relevant?']));
        complete.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        h.service.performSearch('concept'); h.resolve([scene('a.md', 'prose')]); await settle();
        h.service.cancelSearch(); release({ success: false, content: null, responseData: {}, error: 'cancelled' }); await settle();
        expect(h.plugin.searchState.status).toBe('ready'); expect(h.plugin.searchState.stoppedEarly).toBe(true);
        expect(h.plugin.searchState.unreadableScenes).toBe(0);
    });

    it('publishes pending status immediately and can cancel before scene data arrives', async () => {
        const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
        h.service.performSearch('new concept');
        expect(h.plugin.searchState.pendingTerm).toBe('new concept'); expect(h.plugin.searchState.status).toBe('running');
        h.service.cancelSearch(); h.resolve([scene('a.md', 'prose')]); await settle();
        expect(complete).not.toHaveBeenCalled(); expect(h.plugin.searchState.stoppedEarly).toBe(true);
    });

    it('counts an unreadable file while keeping matches in the selected fields', async () => {
        const h = makeHarness(); h.plugin.searchState.options = { timelineFields: true, body: true, llmAssist: false };
        h.service.performSearch('coast'); h.resolve([scene('missing.md', 'coast')]); await settle();
        expect(h.plugin.searchState.hits.size).toBe(1); expect(h.plugin.searchState.unreadableScenes).toBe(1);
    });
});

it('counts failed windows of one note as one unreadable scene', async () => {
    const h = makeHarness(); h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
    h.bodies.set('a.md', 'x'.repeat(20000));
    complete.mockResolvedValueOnce(elementsReply(['Relevant?'])).mockResolvedValue({ success: false, content: null, responseData: {}, error: 'bad reply' });
    h.service.performSearch('concept'); h.resolve([scene('a.md', '')]); await settle();
    expect(complete.mock.calls.length).toBeGreaterThan(2); expect(h.plugin.searchState.unreadableScenes).toBe(1);
});

it('does not silently substitute the query when decomposition has no conditions', async () => {
    const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
    complete.mockResolvedValue({ success: true, content: '{"groups":[]}', responseData: {} });
    h.service.performSearch('concept'); h.resolve([scene('a.md', 'prose')]); await settle();
    expect(h.plugin.searchState.status).toBe('error'); expect(complete).toHaveBeenCalledTimes(1);
});

it('accepts extra verifiable quotes without declaring the scene unreadable', async () => {
    const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
    complete.mockResolvedValueOnce(elementsReply(['Relevant?'])).mockResolvedValue(match(['first', 'second', 'third']));
    h.service.performSearch('concept'); h.resolve([scene('a.md', 'first second third')]); await settle();
    expect(h.plugin.searchState.unreadableScenes).toBe(0); expect(h.plugin.searchState.hits.size).toBe(1);
});

it('treats a blank evidence string as unsupported evidence, not an unreadable scene', async () => {
    const h = makeHarness(); h.plugin.searchState.options.llmAssist = true;
    complete.mockResolvedValueOnce(elementsReply(['Relevant?'])).mockResolvedValue(match(['']));
    h.service.performSearch('concept'); h.resolve([scene('a.md', 'prose')]); await settle();
    expect(h.plugin.searchState.unreadableScenes).toBe(0); expect(h.plugin.searchState.hits.size).toBe(0);
});
