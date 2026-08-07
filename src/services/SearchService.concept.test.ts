import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import type { TimelineItem } from '../types';

const listModels = vi.fn();
const complete = vi.fn();

vi.mock('../ai/localLlm/backends', () => ({
    getLocalLlmBackend: () => ({ id: 'ollama', label: 'Ollama', listModels, complete })
}));
vi.mock('../ai/credentials/credentials', () => ({
    getCredential: () => Promise.resolve(undefined)
}));

const { SearchService } = await import('./SearchService');
const { createSearchState } = await import('./searchState');

const LOCAL = {
    enabled: true, configurationMode: 'manual', backend: 'ollama',
    baseUrl: 'http://localhost:11434/v1', defaultModelId: 'qwen3',
    timeoutMs: 1000, maxRetries: 0, jsonMode: 'response_format', declaredCapabilities: []
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
        settings: { aiSettings: { localLlm: { ...LOCAL } } } as Record<string, unknown>,
        registerEvent: () => { /* no-op */ },
        getTimelineSceneData: () => scenesPromise,
        getTimelineViews: () => [{ refreshTimeline: () => {}, syncTimelineSearchControl: () => {} }],
        bodies
    };

    const service = new SearchService(app as never, plugin as never);
    return { service, plugin, bodies, resolve: (s: TimelineItem[]) => resolveScenes?.(s) };
}

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };

const reply = (matches: unknown) => ({
    success: true, content: JSON.stringify({ matches }), responseData: {}, error: undefined
});

beforeEach(() => {
    listModels.mockReset();
    complete.mockReset();
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
            .mockResolvedValueOnce(reply([{ scene_id: '1', reason: 'arrival', quotes: ['at dawn'] }]))
            .mockResolvedValueOnce(reply([{ scene_id: '1', reason: 'invented', quotes: ['she wept for the city'] }]));

        h.service.performSearch('a homecoming');
        h.resolve([scene('real.md', ''), scene('fake.md', '')]);
        await settle();

        expect([...h.plugin.searchState.hits.keys()]).toEqual(['real.md']);
        expect(h.plugin.searchState.droppedClaims).toBe(1);
        expect(h.plugin.searchState.hits.get('real.md')?.evidence).toEqual(['at dawn']);
        expect(h.plugin.searchState.hits.get('real.md')?.reason).toBe('arrival');
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
        complete.mockResolvedValue(reply([]));

        h.service.performSearch('a question');
        h.resolve([scene('a.md', ''), scene('b.md', ''), scene('c.md', '')]);
        await settle();

        expect(complete).toHaveBeenCalledTimes(3);
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
        complete.mockImplementation(() => {
            // Record how many hits are visible on the timeline at each call.
            seen.push(h.plugin.searchState.hits.size);
            return Promise.resolve(reply([{ scene_id: '1', reason: 'r', quotes: ['prose'] }]));
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

        complete.mockImplementation(() => {
            if (h.plugin.searchState.hits.size >= 1) h.service.cancelSearch();
            return Promise.resolve(reply([{ scene_id: '1', reason: 'r', quotes: ['prose'] }]));
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
            .mockResolvedValueOnce(reply([{ scene_id: '1', reason: 'r', quotes: ['prose'] }]))
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
            .mockResolvedValueOnce(reply([{ scene_id: '1', reason: 'r', quotes: ['prose'] }]))
            .mockResolvedValueOnce({ success: false, content: null, responseData: {}, error: 'Unterminated string' })
            .mockResolvedValueOnce(reply([{ scene_id: '1', reason: 'r', quotes: ['prose'] }]));

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
        complete.mockResolvedValue({ success: false, content: null, responseData: {}, error: 'connection lost' });

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

        complete.mockResolvedValue({ success: false, content: null, responseData: {}, error: 'model exploded' });

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

        complete.mockResolvedValue({ success: false, content: null, responseData: {}, error: 'connection lost' });

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
        complete.mockResolvedValue(reply([]));

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
