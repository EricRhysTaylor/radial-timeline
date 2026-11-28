import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { cueMarkerLabel, cueState } from './model';
import { SceneTimeService, parseTimeStore } from './SceneTimeService';

function fixture(initial?: string) {
    const files = new Map<string, string>();
    if (initial !== undefined) files.set('Radial Timeline/Scene Time/decisions.json', initial);
    let source = 'Two hours later, she arrives.\nShe sleeps for six hours.';
    const adapter = { exists: vi.fn(async (path: string) => files.has(path)),
        read: vi.fn(async (path: string) => files.get(path)!),
        mkdir: vi.fn(async (path: string) => { files.set(path, ''); }),
        write: vi.fn(async (path: string, content: string) => { files.set(path, content); }) };
    const plugin = { settings: {}, app: { vault: { adapter, cachedRead: vi.fn(async () => source) },
        metadataCache: { getFileCache: () => ({ frontmatter: { Class: 'Scene' } }) },
        workspace: { iterateAllLeaves: () => {} } } } as unknown as RadialTimelinePlugin;
    const file = Object.assign(Object.create(TFile.prototype), { path: 'Scenes/Test.md' }) as TFile;
    return { service: new SceneTimeService(plugin), plugin, file, adapter, files, source: () => source, setSource: (value: string) => { source = value; } };
}

describe('scene time decision persistence', () => {
    it('drops a cached scene snapshot when its class changes, regardless of timing fields', () => {
        const f = fixture();
        expect(f.service.snapshot(f.file, f.source())).not.toBeNull();
        for (const Class of ['Beat', 'Character', '', undefined]) {
            f.plugin.app.metadataCache.getFileCache = () => ({ frontmatter: { Class, When: '2085-04-21T17:00:00', Duration: '2 hours' } });
            expect(f.service.metadata(f.file)).toBeNull();
            expect(f.service.snapshot(f.file, f.source())).toBeNull();
        }
    });
    it('refreshes the duration line when only the declared Duration changes', () => {
        const f = fixture();
        f.plugin.app.metadataCache.getFileCache = () => ({ frontmatter: { Class: 'Scene', Duration: '1 hour' } });
        expect(f.service.snapshot(f.file, f.source())!.duration?.status).toBe('over');
        f.plugin.app.metadataCache.getFileCache = () => ({ frontmatter: { Class: 'Scene', Duration: '1 day' } });
        expect(f.service.snapshot(f.file, f.source())!.duration?.status).toBe('short');
    });
    it('confirms quantified forward cues in one write and preserves checkpoint accounting', async () => {
        const f = fixture(); await f.service.initialize();
        f.setSource('Two hours later, she arrives.\nShe sleeps for six hours.\nEight hours had passed since departure.\nA few minutes later, she leaves.');
        const cues = f.service.snapshot(f.file, f.source())!.cues;
        await f.service.confirmAll(f.file, cues.filter(cue => cue.kind === 'advance' || cue.kind === 'checkpoint').map(cue => cue.key));
        expect(f.adapter.write).toHaveBeenCalledTimes(1);
        const result = f.service.snapshot(f.file, f.source())!;
        expect(result.elapsed).toBe(480);
        expect(result.pending).toBe(1);
    });
    it('rejects a stale bulk confirmation without saving a partial batch', async () => {
        const f = fixture(); await f.service.initialize();
        const keys = f.service.snapshot(f.file, f.source())!.cues.map(cue => cue.key);
        f.setSource('Three hours later, she arrives.\nShe sleeps for six hours.');
        await expect(f.service.confirmAll(f.file, keys)).rejects.toThrow('changed');
        expect(f.adapter.write).not.toHaveBeenCalled();
    });
    it('retains an exclusion on reload but does not attach it to an edited paragraph', async () => {
        const f = fixture(); await f.service.initialize();
        f.setSource('Her ears hurt, the price of three days underwater.');
        const key = f.service.snapshot(f.file, f.source())!.cues[0].key;
        await f.service.decide(f.file, key, { action: 'exclude', minutes: 0 });
        const reloaded = new SceneTimeService(f.plugin); await reloaded.initialize();
        expect(reloaded.snapshot(f.file, f.source())!.cues[0].decision?.action).toBe('exclude');
        f.setSource('Her ears still hurt, the price of three days underwater and a climb.');
        expect(reloaded.snapshot(f.file, f.source())!.cues[0].decision).toBeUndefined();
        const stored = parseTimeStore(f.files.get('Radial Timeline/Scene Time/decisions.json')!);
        expect(stored.scenes[f.file.path][key].action).toBe('exclude');
    });
    it('keeps a decision while the writer types on another line of the same block (Devin, 8.3.0)', async () => {
        const f = fixture(); await f.service.initialize();
        const cues = f.service.snapshot(f.file, f.source())!.cues;
        await f.service.decide(f.file, cues[0].key, { action: 'add', minutes: 120 });
        await f.service.decide(f.file, cues[1].key, { action: 'exclude', minutes: 0 });
        // A single Enter starts the next paragraph: no blank line, so the block grows.
        f.setSource(`${f.source()}\nShe writes on, a new paragraph.`);
        const after = f.service.snapshot(f.file, f.source())!;
        expect(after.cues[0].decision).toEqual({ action: 'add', minutes: 120 });
        expect(after.cues[1].decision?.action).toBe('exclude');
        expect(after.elapsed).toBe(120);
    });
    it('moves schema-1 decisions to line keys once, when the store loads', async () => {
        const source = 'Two hours later, she arrives.\nShe sleeps for six hours.';
        const oldKey = (quote: string) => JSON.stringify([source, source.indexOf(quote), quote]);
        const manual = 'manual-selection-v1:"She arrives."';
        const f = fixture(JSON.stringify({ schemaVersion: 1, scenes: {
            'Scenes/Test.md': { [oldKey('Two hours later')]: { action: 'add', minutes: 120 }, [manual]: { action: 'add', minutes: 5 } },
            'Scenes/Gone.md': { [oldKey('six hours')]: { action: 'exclude', minutes: 0 } },
        } }));
        f.files.set('Scenes/Test.md', source);
        await f.service.initialize();
        const stored = parseTimeStore(f.files.get('Radial Timeline/Scene Time/decisions.json')!);
        expect(stored.schemaVersion).toBe(2);
        expect(stored.scenes['Scenes/Test.md'][JSON.stringify(['Two hours later, she arrives.', 0, 'Two hours later'])]).toEqual({ action: 'add', minutes: 120 });
        expect(stored.scenes['Scenes/Test.md'][manual]).toEqual({ action: 'add', minutes: 5 });
        // A scene that is no longer there keeps its decisions as they were.
        expect(stored.scenes['Scenes/Gone.md']).toEqual({ [oldKey('six hours')]: { action: 'exclude', minutes: 0 } });
        expect(f.service.snapshot(f.file, source)!.cues[0].decision).toEqual({ action: 'add', minutes: 120 });
        // The second load finds schema 2 and writes nothing.
        f.adapter.write.mockClear();
        await new SceneTimeService(f.plugin).initialize();
        expect(f.adapter.write).not.toHaveBeenCalled();
    });
    it('validates versioned data and rejects invalid contributions', () => {
        expect(parseTimeStore('{"schemaVersion":1,"scenes":{}}')).toEqual({ schemaVersion: 1, scenes: {} });
        expect(parseTimeStore('{"schemaVersion":2,"scenes":{}}')).toEqual({ schemaVersion: 2, scenes: {} });
        for (const raw of ['{}', '{"schemaVersion":3,"scenes":{}}', '{"schemaVersion":1,"scenes":[]}',
            '{"schemaVersion":1,"scenes":{"a":{"b":{"action":"add","minutes":-1}}}}',
            '{"schemaVersion":1,"scenes":{"a":{"b":{"action":"guess","minutes":3}}}}']) {
            expect(() => parseTimeStore(raw)).toThrow();
        }
    });
    it('serializes simultaneous decisions without dropping either and restores on reload', async () => {
        const f = fixture(); await f.service.initialize();
        const cues = f.service.snapshot(f.file, f.source())!.cues;
        await Promise.all([
            f.service.decide(f.file, cues[0].key, { action: 'add', minutes: 120 }),
            f.service.decide(f.file, cues[1].key, { action: 'add', minutes: 360 })
        ]);
        const reloaded = new SceneTimeService(f.plugin); await reloaded.initialize();
        expect(reloaded.snapshot(f.file, f.source())!.elapsed).toBe(480);
        expect(f.adapter.write).toHaveBeenCalledTimes(2);
        expect(f.source()).toBe('Two hours later, she arrives.\nShe sleeps for six hours.');
    });
    it('does not overwrite corrupt sidecar data', async () => {
        const f = fixture('not JSON'); await f.service.initialize();
        const cue = f.service.snapshot(f.file, f.source())!.cues[0];
        await expect(f.service.decide(f.file, cue.key, { action: 'add', minutes: 120 })).rejects.toThrow('could not be loaded');
        expect(f.adapter.write).not.toHaveBeenCalled();
        expect(f.files.get('Radial Timeline/Scene Time/decisions.json')).toBe('not JSON');
    });
    it('surfaces failed writes and does not show unsaved confirmation', async () => {
        const f = fixture(); await f.service.initialize();
        const cue = f.service.snapshot(f.file, f.source())!.cues[0];
        f.adapter.write.mockRejectedValueOnce(new Error('Disk full'));
        await expect(f.service.decide(f.file, cue.key, { action: 'add', minutes: 120 })).rejects.toThrow('Disk full');
        expect(f.service.snapshot(f.file, f.source())!.elapsed).toBe(0);
        await f.service.decide(f.file, cue.key, { action: 'add', minutes: 120 });
        expect(f.service.snapshot(f.file, f.source())!.elapsed).toBe(120);
    });
    it('checks the latest prose at save time and rejects a stale modal decision', async () => {
        const f = fixture(); await f.service.initialize();
        const cue = f.service.snapshot(f.file, f.source())!.cues[0];
        f.setSource('Three hours later, she arrives.');
        await expect(f.service.decide(f.file, cue.key, { action: 'add', minutes: 120 })).rejects.toThrow('changed');
        expect(f.adapter.write).not.toHaveBeenCalled();
    });
});

describe('manual selected prose time', () => {
    it('counts a selection, survives reload and surrounding edits, and can be removed', async () => {
        const f = fixture(); await f.service.initialize();
        f.setSource('She crosses the country. She arrives exhausted.');
        await f.service.assignSelection(f.file, f.source(), 'She crosses the country.', 600);
        const reloaded = new SceneTimeService(f.plugin); await reloaded.initialize();
        f.setSource('At last, She crosses the country. She arrives happy.');
        const result = reloaded.snapshot(f.file, f.source())!;
        expect(result.elapsed).toBe(600);
        expect(result.cues[0].kind).toBe('manual');
        expect(cueMarkerLabel(result.cues[0])).toBe('[10h]');
        expect(cueState(result.cues[0])).toBe('manual');
        await reloaded.removeManualTime(f.file, result.cues[0].key);
        expect(reloaded.snapshot(f.file, f.source())!.elapsed).toBe(0);
    });
    it('retains but stops counting deleted or ambiguous selections', async () => {
        const f = fixture(); await f.service.initialize(); f.setSource('She travels.');
        await f.service.assignSelection(f.file, f.source(), 'She travels.', 600);
        for (const source of ['She rests.', 'She travels. She travels.']) {
            f.setSource(source);
            expect(f.service.snapshot(f.file, source)!.elapsed).toBe(0);
            expect(f.service.detachedManualTimes(f.file, source)).toHaveLength(1);
        }
    });
    it('rejects detected cue overlap, metadata, stale source and multi-line selections', async () => {
        const f = fixture(); await f.service.initialize();
        await expect(f.service.assignSelection(f.file, f.source(), 'Two hours later', 600)).rejects.toThrow('overlapping');
        await expect(f.service.assignSelection(f.file, 'old source', 'She travels.', 600)).rejects.toThrow('changed');
        f.setSource('---\nClass: Scene\n---\nShe travels.');
        await expect(f.service.assignSelection(f.file, f.source(), 'Class: Scene', 600)).rejects.toThrow('unique');
        await expect(f.service.assignSelection(f.file, f.source(), 'She\ntravels.', 600)).rejects.toThrow('one line');
        expect(f.adapter.write).not.toHaveBeenCalled();
    });
});
