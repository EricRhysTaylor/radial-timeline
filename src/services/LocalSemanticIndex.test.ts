import { describe, expect, it, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { LocalSemanticIndex } from './LocalSemanticIndex';
import { requestProvider } from '../api/providerTransport';
vi.mock('../api/providerTransport', () => ({ requestProvider: vi.fn() }));

function fixture() {
    const files = new Map<string, string>();
    const existing = new Set(['a.md', 'b.md']);
    const adapter = { exists: async (path: string) => existing.has(path) || files.has(path),
        read: vi.fn(async (path: string) => files.get(path)!), mkdir: async (path: string) => { files.set(path, ''); },
        write: vi.fn(async (path: string, value: string) => { files.set(path, value); }),
        remove: async (path: string) => { files.delete(path); },
        rename: async (from: string, to: string) => { if (files.has(to)) throw new Error('Destination already exists'); files.set(to, files.get(from)!); files.delete(from); } };
    const control = { assertActive: vi.fn(), timeoutMs: 1000, retryPolicy: { maxAttempts: 1, baseDelayMs: 0 } };
    const scenes = [{ path: 'a.md', fieldsText: 'The coast', bodyText: 'An orchard' }, { path: 'b.md', bodyText: 'The coast' }];
    const input = { queries: ['coast'], scenes, control, onProgress: vi.fn() };
    return { files, existing, adapter, input, index: new LocalSemanticIndex(adapter as unknown as DataAdapter, '.obsidian/plugins/radial-timeline/search-index') };
}

describe('plugin-owned text index', () => {
    it('builds, persists and refreshes changed text without any network calls or extra model', async () => {
        const f = fixture(); vi.mocked(requestProvider).mockClear();
        expect((await f.index.query(f.input)).stats.updatedNotes).toBe(2);
        const restarted = new LocalSemanticIndex(f.adapter as unknown as DataAdapter, f.index.directory);
        expect((await restarted.query(f.input)).stats.updatedNotes).toBe(0);
        expect(f.adapter.write).toHaveBeenCalledOnce();
        f.input.scenes[0].bodyText = 'A changed orchard';
        expect((await restarted.query(f.input)).stats.updatedNotes).toBe(1);
        expect(f.adapter.write).toHaveBeenCalledTimes(2);
        expect(requestProvider).not.toHaveBeenCalled();
        const disk = JSON.parse(f.files.get(`${f.index.directory}/index.json`)!);
        expect(disk.schemaVersion).toBe(2); expect(disk.identity).toBeUndefined();
        expect(disk.entries['a.md'].body.passages).toEqual(['A changed orchard']);
    });
    it('keeps fields and prose separate and retains exact selected-scope grounding', async () => {
        const f = fixture(); await f.index.query(f.input);
        const body = await f.index.query({ ...f.input, scenes: f.input.scenes.map(scene => ({ path: scene.path, bodyText: scene.bodyText })) });
        expect(body.scenes.map(scene => scene.path)).toEqual(['b.md']);
        expect(body.scenes[0].fieldsText).toBeUndefined();
        expect(body.scenes[0].grounding?.fieldsText).toBeUndefined();
        const fields = await f.index.query({ ...f.input, scenes: [{ path: 'a.md', fieldsText: 'The coast' }] });
        expect(fields.scenes[0].bodyText).toBeUndefined();
        expect(fields.scenes[0].grounding?.bodyText).toBeUndefined();
    });
    it('updates edits and creates, renames and removes deleted records before retrieval', async () => {
        const f = fixture(); await f.index.query(f.input);
        f.index.invalidate('a.md'); f.input.scenes[0].fieldsText = 'An orchard';
        expect((await f.index.query(f.input)).scenes.map(scene => scene.path)).toEqual(['b.md']);
        f.existing.delete('b.md'); f.existing.add('renamed.md'); f.index.invalidate('b.md');
        const next = [{ path: 'renamed.md', bodyText: 'The coast' }];
        expect((await f.index.query({ ...f.input, scenes: next })).scenes[0].path).toBe('renamed.md');
        const disk = JSON.parse(f.files.get(`${f.index.directory}/index.json`)!);
        expect(disk.entries['b.md']).toBeUndefined(); expect(disk.entries['renamed.md']).toBeDefined();
        f.existing.delete('renamed.md'); f.index.invalidate('renamed.md');
        await f.index.query({ ...f.input, scenes: [] });
        expect(JSON.parse(f.files.get(`${f.index.directory}/index.json`)!).entries['renamed.md']).toBeUndefined();
    });
    it('migrates the removed encoder cache into a model-independent text index', async () => {
        const f = fixture(); f.files.set(`${f.index.directory}/index.json`, JSON.stringify({ schemaVersion: 1, identity: 'old-encoder', entries: {} }));
        const result = await f.index.query(f.input);
        expect(result.scenes).toHaveLength(2);
        const disk = f.files.get(`${f.index.directory}/index.json`)!;
        expect(disk).not.toContain('old-encoder'); expect(JSON.parse(disk).schemaVersion).toBe(2);
    });
    it('surfaces corrupt or unsupported cache data and releases the queue after failure', async () => {
        for (const text of ['{invalid', '{"schemaVersion":99,"entries":{}}', '{"schemaVersion":2,"entries":{"a.md":{"body":{"hash":"bad","passages":[]}}}}']) {
            const f = fixture(); f.files.set(`${f.index.directory}/index.json`, text);
            await expect(f.index.query(f.input)).rejects.toThrow();
            expect(f.adapter.write).not.toHaveBeenCalled();
            f.files.delete(`${f.index.directory}/index.json`);
            expect((await f.index.query(f.input)).scenes.length).toBeGreaterThan(0);
        }
    });
    it('rejects cached excerpts not present in their source', async () => {
        const f = fixture(); await f.index.query(f.input);
        const disk = JSON.parse(f.files.get(`${f.index.directory}/index.json`)!);
        disk.entries['a.md'].fields.passages = ['Invented evidence'];
        f.files.set(`${f.index.directory}/index.json`, JSON.stringify(disk));
        const restarted = new LocalSemanticIndex(f.adapter as unknown as DataAdapter, f.index.directory);
        await expect(restarted.query(f.input)).rejects.toThrow('absent from its selected source');
    });
    it('blocks stale text changed during index persistence', async () => {
        const f = fixture(); const write = f.adapter.write.getMockImplementation()!;
        f.adapter.write.mockImplementationOnce(async (path, text) => { f.index.invalidate('a.md'); await write(path, text); });
        await expect(f.index.query(f.input)).rejects.toThrow('Scene text changed');
        f.input.scenes[0].fieldsText = 'The new coast';
        expect((await f.index.query(f.input)).scenes.length).toBeGreaterThan(0);
    });
    it('honors cancelled and revoked runs before accessing the cache', async () => {
        const f = fixture(); f.input.control.assertActive.mockImplementation(() => { throw new Error('AI disabled'); });
        await expect(f.index.query(f.input)).rejects.toThrow('AI disabled');
        expect(f.adapter.read).not.toHaveBeenCalled(); expect(f.adapter.write).not.toHaveBeenCalled();
        f.input.control.assertActive.mockReset();
        const controller = new AbortController(); controller.abort();
        await expect(f.index.query({ ...f.input, signal: controller.signal })).rejects.toThrow('cancelled');
    });
    it('uses expanded concept terms to retrieve concrete source text from beyond the shortlist', async () => {
        const f = fixture();
        const scenes = Array.from({ length: 25 }, (_, index) => ({ path: `${index}.md`, bodyText: 'A clerk sorted invoices.' }));
        scenes.push({ path: 'target.md', bodyText: 'She gave her coat and blanket to the freezing child.' });
        scenes.forEach(scene => f.existing.add(scene.path));
        const result = await f.index.query({ ...f.input, scenes, queries: ['sacrificing comfort to protect a child', 'coat', 'blanket', 'freezing'] });
        expect(result.scenes.map(scene => scene.path)).toContain('target.md');
        expect(result.scenes.length).toBeLessThanOrEqual(12);
    });
    it('finds both OR alternatives and distant supporting passages in a long scene', async () => {
        const f = fixture();
        const scenes = [{ path: 'a.md', bodyText: 'There was a celebration.' }, { path: 'b.md', bodyText: 'They said farewell.' }];
        expect((await f.index.query({ ...f.input, scenes, queries: ['celebration OR farewell', 'celebration', 'farewell'] })).scenes).toHaveLength(2);
        const text = 'Ada arrived for dinner. ' + 'The clock ticked. '.repeat(800) + 'Ada raised a glass at the dinner table.';
        const result = await f.index.query({ ...f.input, scenes: [{ path: 'a.md', bodyText: text }], queries: ['dinner with Ada', 'Ada', 'dinner'] });
        const excerpts = result.scenes[0].indexedPassages!.map(item => item.text);
        expect(excerpts.some(text => text.includes('Ada arrived'))).toBe(true);
        expect(excerpts.some(text => text.includes('Ada raised'))).toBe(true);
        expect(excerpts.every(passage => text.includes(passage))).toBe(true);
    });
    it('retrieves prose word forms using the same substring matching as concept keyword ordering', async () => {
        const f = fixture();
        const result = await f.index.query({ ...f.input,
            scenes: [{ path: 'a.md', bodyText: 'They celebrated late into the night.' }], queries: ['a celebration', 'celebrate'] });
        expect(result.scenes.map(scene => scene.path)).toEqual(['a.md']);
    });
    it('preserves long Unicode source without broken surrogate pairs', async () => {
        const f = fixture(); const text = 'The coast 🌊 has cliffs. '.repeat(500);
        const result = await f.index.query({ ...f.input, scenes: [{ path: 'a.md', bodyText: text }] });
        expect(result.scenes[0].indexedPassages!.every(item => text.includes(item.text))).toBe(true);
        const disk = JSON.parse(f.files.get(`${f.index.directory}/index.json`)!);
        expect(disk.entries['a.md'].body.passages.every((passage: string) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(passage))).toBe(true);
    });
});
