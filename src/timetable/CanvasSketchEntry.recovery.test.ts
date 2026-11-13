import { describe, expect, it, vi } from 'vitest';
import { registerCanvasSketches } from './CanvasSketchEntry';

vi.mock('./CanvasCardPresentation', () => ({ registerCanvasCardPresentation: vi.fn() }));
vi.mock('./CanvasSubplotMemoryUpkeep', () => ({ registerCanvasSubplotMemoryUpkeep: vi.fn() }));

function setup() {
    const events = new Map<string, (...args: never[]) => void>();
    const layout: Array<() => void> = [];
    const plugin = {
        settings: { storyMapProvenance: { 'Maps/A.canvas': { marker: 'saved A' }, 'Maps/B.canvas': { marker: 'saved B' } } },
        app: { vault: { on: (event: string, fn: (...args: never[]) => void) => { events.set(event, fn); return {}; }, getAbstractFileByPath: () => null },
            workspace: { on: () => ({}), onLayoutReady: (fn: () => void) => layout.push(fn), iterateAllLeaves: () => {} } },
        registerEvent: vi.fn(), register: vi.fn(), addCommand: vi.fn(), saveSettings: vi.fn(async () => {}),
    };
    registerCanvasSketches(plugin as never);
    return { plugin, layout, deleted: (path: string) => events.get('delete')?.({ path } as never) };
}

describe('story map recovery while files sync', () => {
    it('keeps records for maps that are absent when the vault starts', () => {
        const { plugin, layout } = setup();
        layout.forEach(fn => fn());
        expect(Object.keys(plugin.settings.storyMapProvenance)).toEqual(['Maps/A.canvas', 'Maps/B.canvas']);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('deletes only the record named by a delete event, not other unsynced maps', () => {
        const { plugin, deleted } = setup();
        deleted('Maps/A.canvas');
        expect(Object.keys(plugin.settings.storyMapProvenance)).toEqual(['Maps/B.canvas']);
        expect(plugin.saveSettings).toHaveBeenCalledOnce();
    });

    it('removes records under a deleted folder', () => {
        const { plugin, deleted } = setup();
        deleted('Maps');
        expect(plugin.settings.storyMapProvenance).toEqual({});
    });
});
