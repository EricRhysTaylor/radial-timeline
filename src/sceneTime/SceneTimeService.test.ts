import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
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
    it('validates versioned data and rejects invalid contributions', () => {
        expect(parseTimeStore('{"schemaVersion":1,"scenes":{}}')).toEqual({ schemaVersion: 1, scenes: {} });
        for (const raw of ['{}', '{"schemaVersion":2,"scenes":{}}', '{"schemaVersion":1,"scenes":[]}',
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
