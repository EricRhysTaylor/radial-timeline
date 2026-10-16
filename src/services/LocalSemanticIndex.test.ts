import { describe, expect, it, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { LocalSemanticIndex, getLocalSemanticIndexAvailability } from './LocalSemanticIndex';
import { requestProvider } from '../api/providerTransport';
vi.mock('../api/providerTransport', () => ({ requestProvider: vi.fn() }));
const transport = vi.mocked(requestProvider);
const identity = 'fixture-model:revision-one:pooling-one';
const vector = (text: string) => text.includes('coast') ? [1, 0] : [0, 1];

describe('semantic-index availability', () => {
    it('checks only local metadata and rejects incompatible or failed responses', async () => {
        fixture(); transport.mockClear();
        expect(await getLocalSemanticIndexAvailability()).toEqual({ available: true });
        expect(transport).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: 'http://127.0.0.1:8081/v1/index-model' }),
            undefined, expect.objectContaining({ allowHttp: true, maxResponseBytes: 16384 }));
        for (const json of [null, {}, { schemaVersion: 1, identity: 'x', dimensions: 384, language: 'fr' }]) {
            transport.mockResolvedValueOnce({ status: 200, headers: {}, text: '', json, retryCount: 0 });
            expect(await getLocalSemanticIndexAvailability()).toEqual({ available: false, reason: expect.stringContaining('incompatible') });
        }
        transport.mockRejectedValueOnce(new Error('connection refused'));
        expect(await getLocalSemanticIndexAvailability()).toEqual({ available: false, reason: expect.stringContaining('not detected') });
    });
    it('aborts a hung health check after two seconds', async () => {
        vi.useFakeTimers();
        try {
            transport.mockImplementationOnce((_options, _control, config) => new Promise((_resolve, reject) => {
                config?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); // SAFE: one-shot AbortSignal listener in a transport timeout test
            }));
            const pending = getLocalSemanticIndexAvailability();
            await vi.advanceTimersByTimeAsync(2000);
            expect((await pending).available).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });
});
function fixture() {
    const files = new Map<string, string>();
    let modelIdentity = identity;
    const adapter = { exists: async (path: string) => path.endsWith('.md') || files.has(path),
        read: async (path: string) => files.get(path)!, mkdir: async (path: string) => { files.set(path, ''); },
        write: vi.fn(async (path: string, value: string) => { files.set(path, value); }),
        remove: async (path: string) => { files.delete(path); },
        rename: async (from: string, to: string) => { if (files.has(to)) throw new Error('Destination file already exists!'); files.set(to, files.get(from)!); files.delete(from); } };
    const calls: Array<{ kind: string; texts: string[] }> = [];
    transport.mockImplementation(async options => {
        let json: unknown;
        if (options.method === 'GET') json = { schemaVersion: 1, identity: modelIdentity, dimensions: 2, language: 'en' };
        else {
            const body = JSON.parse(String(options.body)) as { kind: string; texts: string[] };
            calls.push(body);
            json = { schemaVersion: 1, identity: modelIdentity,
                documents: body.texts.map(text => [{ text, vector: vector(text) }]) };
        }
        return { status: 200, headers: {}, text: '', json, retryCount: 0 };
    });
    const control = { assertActive: vi.fn(), timeoutMs: 1000, retryPolicy: { maxAttempts: 1, baseDelayMs: 0 } };
    const scenes = [{ path: 'a.md', fieldsText: 'The coast', bodyText: 'An orchard' }, { path: 'b.md', bodyText: 'The coast' }];
    const input = { queries: ['coast'], scenes, control, onProgress: vi.fn() };
    return { files, adapter, calls, input, index: new LocalSemanticIndex(adapter as unknown as DataAdapter, '.obsidian/plugins/radial-timeline/search-index'),
        setIdentity(value: string) { modelIdentity = value; } };
}

describe('local semantic cache lifecycle and scopes', () => {
    it('persists, reuses after restart, and refreshes only changed fields/body', async () => {
        const f = fixture();
        const first = await f.index.query(f.input);
        expect(first.stats.updatedNotes).toBe(2);
        expect(f.calls.filter(call => call.kind === 'document').flatMap(call => call.texts)).toEqual(['The coast', 'An orchard', 'The coast']);
        f.calls.length = 0;
        const restarted = new LocalSemanticIndex(f.adapter as unknown as DataAdapter, f.index.directory);
        expect((await restarted.query(f.input)).stats.updatedNotes).toBe(0);
        expect(f.calls.map(call => call.kind)).toEqual(['query']);
        f.input.scenes[0].bodyText = 'A changed orchard'; f.calls.length = 0;
        expect((await restarted.query(f.input)).stats.updatedNotes).toBe(1);
        expect(f.calls.filter(call => call.kind === 'document').flatMap(call => call.texts)).toEqual(['A changed orchard']);
    });
    it('never retrieves cached unselected fields or bodies', async () => {
        const f = fixture(); await f.index.query(f.input); f.calls.length = 0;
        const bodyOnly = await f.index.query({ ...f.input, scenes: f.input.scenes.map(scene => ({ path: scene.path, bodyText: scene.bodyText })) });
        expect(bodyOnly.scenes.every(scene => scene.fieldsText === undefined)).toBe(true);
        expect(bodyOnly.scenes.find(scene => scene.path === 'a.md')?.bodyText).toBe('An orchard');
        const fieldsOnly = await f.index.query({ ...f.input, scenes: [{ path: 'a.md', fieldsText: 'The coast' }] });
        expect(fieldsOnly.scenes[0].bodyText).toBeUndefined();
        expect(fieldsOnly.scenes[0].grounding?.bodyText).toBeUndefined();
        expect(f.calls.every(call => call.kind === 'query')).toBe(true);
    });
    it('invalidates on edits and removes deleted or renamed paths from disk', async () => {
        const f = fixture(); await f.index.query(f.input); f.calls.length = 0;
        f.index.invalidate('a.md');
        expect((await f.index.query(f.input)).stats.updatedNotes).toBe(1);
        f.adapter.exists = async path => path !== 'a.md' && (path.endsWith('.md') || f.files.has(path));
        await f.index.query({ ...f.input, scenes: [{ path: 'renamed.md', bodyText: 'The coast' }] });
        const saved = JSON.parse(f.files.get(`${f.index.directory}/index.json`)!);
        expect(saved.entries['a.md']).toBeUndefined(); expect(saved.entries['renamed.md']).toBeDefined();
    });
    it('rebuilds vectors when the encoder identity changes', async () => {
        const f = fixture(); await f.index.query(f.input); f.setIdentity('fixture-model:revision-two'); f.calls.length = 0;
        expect((await f.index.query(f.input)).stats.updatedNotes).toBe(2);
        expect(f.calls.some(call => call.kind === 'document')).toBe(true);
    });
    it('refuses corrupt persisted vectors without substituting a different search', async () => {
        const f = fixture(); f.files.set(`${f.index.directory}/index.json`, '{invalid');
        await expect(f.index.query(f.input)).rejects.toThrow('index is unreadable');
        expect(f.calls).toEqual([]);
    });
    it('rejects non-finite, wrong-sized and ungrounded embedding responses', async () => {
        for (const passage of [{ text: 'The coast', vector: [NaN, 0] }, { text: 'The coast', vector: [1] }, { text: 'Invented passage', vector: [1, 0] }]) {
            const f = fixture();
            transport.mockImplementation(async options => ({ status: 200, headers: {}, text: '', retryCount: 0,
                json: options.method === 'GET' ? { schemaVersion: 1, identity, dimensions: 2, language: 'en' }
                    : { schemaVersion: 1, identity, documents: JSON.parse(String(options.body)).texts.map(() => [passage]) } }));
            await expect(f.index.query(f.input)).rejects.toThrow();
            expect(f.adapter.write).not.toHaveBeenCalled();
        }
    });
    it('does not publish or save an old body when it changes during indexing', async () => {
        const f = fixture(); const original = transport.getMockImplementation()!;
        transport.mockImplementation(async (...args) => {
            const reply = await original(...args);
            if (args[0].method === 'POST') f.index.invalidate('a.md');
            return reply;
        });
        await expect(f.index.query(f.input)).rejects.toThrow('Scene text changed');
        expect(f.adapter.write).not.toHaveBeenCalled();
    });
    it('ignores unrelated note changes and preserves the active corpus transaction', async () => {
        const f = fixture(); const original = transport.getMockImplementation()!;
        transport.mockImplementation(async (...args) => {
            const reply = await original(...args); f.index.invalidate('unrelated.md'); return reply;
        });
        await expect(f.index.query(f.input)).resolves.toMatchObject({ stats: { updatedNotes: 2 } });
    });
    it('stops before requests when permission is withdrawn', async () => {
        const f = fixture(); f.input.control.assertActive.mockImplementation(() => { throw new Error('AI disabled'); });
        transport.mockClear();
        await expect(f.index.query(f.input)).rejects.toThrow('AI disabled');
        expect(transport).not.toHaveBeenCalled(); expect(f.adapter.write).not.toHaveBeenCalled();
    });
    it('bounds the shortlist while keeping independent OR questions represented', async () => {
        const f = fixture();
        const scenes = Array.from({ length: 20 }, (_, index) => ({ path: `${index}.md`, bodyText: index < 10 ? 'The coast' : 'An orchard' }));
        const result = await f.index.query({ ...f.input, scenes, queries: ['coast', 'orchard'] });
        expect(result.stats.candidates).toBe(12); expect(result.stats.total).toBe(20);
        expect(result.scenes.some(scene => scene.bodyText === 'The coast')).toBe(true);
        expect(result.scenes.some(scene => scene.bodyText === 'An orchard')).toBe(true);
    });
});


it('persists deletion on the next search even when no remaining note needs re-embedding', async () => {
    const f = fixture(); await f.index.query(f.input); f.calls.length = 0;
    f.index.invalidate('a.md');
    await f.index.query({ ...f.input, scenes: [{ path: 'b.md', bodyText: 'The coast' }] });
    const saved = JSON.parse(f.files.get(`${f.index.directory}/index.json`)!);
    expect(saved.entries['a.md']).toBeUndefined();
    expect(f.calls.map(call => call.kind)).toEqual(['query']);
});

it('keeps a literal selected-scope phrase in the shortlist even when its vector ranks last', async () => {
    const f = fixture();
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
        const response = await original(...args);
        if (args[0].method === 'POST') {
            const body = JSON.parse(String(args[0].body));
            if (body.kind === 'document') {
                response.json = { schemaVersion: 1, identity, documents: body.texts.map((text: string) => [{ text, vector: text === 'The coast of home' ? [0, 1] : [1, 0] }]) };
            }
        }
        return response;
    });
    const scenes = [{ path: 'exact.md', bodyText: 'The coast of home' }, ...Array.from({ length: 20 }, (_, index) => ({ path: `${index}.md`, bodyText: 'An arrival' }))];
    const result = await f.index.query({ ...f.input, scenes, queries: ['coast of home'] });
    expect(result.scenes.some(scene => scene.path === 'exact.md')).toBe(true);
});

it('gives a concrete startup action when the companion encoder is offline', async () => {
    const f = fixture(); transport.mockRejectedValue(new Error('connection refused'));
    await expect(f.index.query(f.input)).rejects.toThrow('desktop Local AI launcher');
    expect(f.adapter.write).not.toHaveBeenCalled();
});

it('reports the actual input error rather than recommending a server restart', async () => {
    const f = fixture(); const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => args[0].method === 'GET' ? original(...args)
        : { status: 400, headers: {}, text: '', json: { error: 'Embedding input exceeds 512 tokens; no input was truncated.' }, retryCount: 0 });
    await expect(f.index.query(f.input)).rejects.toThrow('Embedding input exceeds 512 tokens');
    expect(f.adapter.write).not.toHaveBeenCalled();
});
