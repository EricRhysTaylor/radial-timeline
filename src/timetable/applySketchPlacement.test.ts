import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { applySketchPlacement } from './applySketchPlacement';

function fixture() {
    const notes: Record<string, Record<string, unknown>> = {
        'A.md': { Class: 'Sketch', Act: 1 },
        'B.md': { Class: 'Sketch' },
    };
    const placements = { assertWritable: vi.fn(async () => {}), set: vi.fn(async () => {}) };
    const processFrontMatter = vi.fn(async (file: TFile, change: (fm: Record<string, unknown>) => void) => change(notes[file.path]));
    const plugin = { settings: DEFAULT_SETTINGS, sketchPlacements: placements, app: { vault: { getAbstractFileByPath: (path: string) => notes[path] ? new TFile(path) : null }, fileManager: { processFrontMatter } } } as unknown as RadialTimelinePlugin; // SAFE: scoped vault test double
    const plan = { orderedPaths: ['A.md', 'B.md'], anchorId: 'scene', act: 2 };
    return { notes, placements, processFrontMatter, plugin, plan };
}

describe('sketch move recovery', () => {
    it('blocks before modifying a note when the placement store is unreadable', async () => {
        const f = fixture(); f.placements.assertWritable.mockRejectedValueOnce(new Error('unreadable'));
        await expect(applySketchPlacement(f.plugin, f.plan)).rejects.toThrow('unreadable');
        expect(f.processFrontMatter).not.toHaveBeenCalled();
        expect(f.notes['A.md'].Act).toBe(1);
    });
    it('restores both existing and missing Act fields when the sidecar write fails', async () => {
        const f = fixture(); f.placements.set.mockRejectedValueOnce(new Error('disk full'));
        await expect(applySketchPlacement(f.plugin, f.plan)).rejects.toThrow('disk full');
        expect(f.notes).toEqual({ 'A.md': { Class: 'Sketch', Act: 1 }, 'B.md': { Class: 'Sketch' } });
    });
    it('restores earlier notes when a later note cannot be written', async () => {
        const f = fixture();
        f.processFrontMatter.mockImplementationOnce(async (file, change) => change(f.notes[file.path])).mockRejectedValueOnce(new Error('note write failed'));
        await expect(applySketchPlacement(f.plugin, f.plan)).rejects.toThrow('note write failed');
        expect(f.notes['A.md'].Act).toBe(1);
        expect(f.placements.set).not.toHaveBeenCalled();
    });
    it('does not overwrite an Act edited after the move, and reports incomplete recovery', async () => {
        const f = fixture();
        f.placements.set.mockImplementationOnce(async () => { f.notes['A.md'].Act = 3; throw new Error('disk full'); });
        await expect(applySketchPlacement(f.plugin, f.plan)).rejects.toThrow('could not be restored');
        expect(f.notes['A.md'].Act).toBe(3);
        expect(f.notes['B.md']).toEqual({ Class: 'Sketch' });
    });
    it('writes the placement and keeps the new Acts on success', async () => {
        const f = fixture(); await applySketchPlacement(f.plugin, f.plan);
        expect(f.notes['A.md'].Act).toBe(2); expect(f.notes['B.md'].Act).toBe(2);
        expect(f.placements.set).toHaveBeenCalledWith([['A.md', { after: 'scene', order: 10 }], ['B.md', { after: 'scene', order: 20 }]]);
    });
});
