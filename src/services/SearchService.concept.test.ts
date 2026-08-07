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

        complete.mockResolvedValue(reply([
            { scene_id: '1', reason: 'arrival', quotes: ['at dawn'] },
            { scene_id: '2', reason: 'invented', quotes: ['she wept for the city'] }
        ]));

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

    it('keeps prior results when the model fails a chunk', async () => {
        const h = makeHarness();
        h.plugin.searchState.options = { timelineFields: false, body: true, llmAssist: true };
        h.bodies.set('a.md', 'prose');
        h.plugin.searchState.active = true;
        h.plugin.searchState.term = 'earlier';
        h.plugin.searchState.hits.set('kept.md', { path: 'kept.md', source: 'body', evidence: [] });

        complete.mockResolvedValue({ success: false, content: null, responseData: {}, error: 'model exploded' });

        h.service.performSearch('a homecoming');
        h.resolve([scene('a.md', '')]);
        await settle();

        expect(h.plugin.searchState.status).toBe('error');
        expect(h.plugin.searchState.error).toContain('model exploded');
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
