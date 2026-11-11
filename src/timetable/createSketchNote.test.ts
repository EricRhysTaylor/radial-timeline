import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import { createSketchNote } from './createSketchNote';

function fixture() {
    const notes = new Map<string, string>();
    const store = { assertWritable: vi.fn(async () => {}), set: vi.fn(async () => {}) };
    const create = vi.fn(async (path: string, text: string) => { notes.set(path, text); });
    const plugin = { sketchPlacements: store, app: { vault: { create } } } as unknown as RadialTimelinePlugin; // SAFE: minimal vault and sidecar double
    return { notes, store, create, plugin };
}

describe('create a placed sketch', () => {
    it('does not create a note when the sidecar is known to be unreadable', async () => {
        const f = fixture(); f.store.assertWritable.mockRejectedValueOnce(new Error('unreadable'));
        await expect(createSketchNote(f.plugin, 'Book/Idea.md', 'original text', { order: 10 })).rejects.toThrow('unreadable');
        expect(f.notes.size).toBe(0);
    });
    it('keeps the note and reports partial success if placement later fails', async () => {
        const f = fixture(); f.store.set.mockRejectedValueOnce(new Error('write failed'));
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(await createSketchNote(f.plugin, 'Book/Idea.md', 'original text', { order: 10 })).toBe(false);
            expect(f.notes.get('Book/Idea.md')).toBe('original text');
        } finally { log.mockRestore(); }
    });
    it('saves the placement on success and does not require it for an unplaced sketch', async () => {
        const f = fixture();
        expect(await createSketchNote(f.plugin, 'A.md', 'a', { order: 10 })).toBe(true);
        expect(f.store.set).toHaveBeenCalledWith([['A.md', { order: 10 }]]);
        expect(await createSketchNote(f.plugin, 'B.md', 'b', null)).toBe(true);
        expect(f.store.assertWritable).toHaveBeenCalledTimes(1);
    });
});
