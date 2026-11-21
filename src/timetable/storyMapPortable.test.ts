import { describe, expect, it, vi } from 'vitest';
import { hydrateStoryMap, portableStoryMap, readPortableStoryMap, rebasePortableStoryMap, storyMapSidecarPath, updateStoryMapSidecar } from './storyMapPortable';
import type { StoryMapProvenance } from './storyMapProvenance';

const baseline: StoryMapProvenance = {
    version: 1, bookId: 'old-id', generatedAt: '2026-11-21T00:00:00Z', act: null, subplot: null,
    layout: 'horizontal', initialFocus: 'all', scenes: [{ path: 'Book/1.md', act: 1, subplots: ['Main Plot'] }],
    generated: { nodes: [{ id: 'a', type: 'file', file: 'Book/1.md', x: 0, y: 0, width: 100, height: 100 }], edges: [] }
};

describe('portable story map baseline', () => {
    it('binds to the current book profile without persisting the old device ID', () => {
        const value = portableStoryMap(baseline, 'Book');
        expect(value.provenance).not.toHaveProperty('bookId');
        expect(readPortableStoryMap(value, [{ id: 'new-id', sourceFolder: 'Book' }])).toEqual({ ...baseline, bookId: 'new-id' });
        expect(storyMapSidecarPath('Maps/A.canvas')).toBe('Maps/A.canvas.storymap.json');
    });

    it('rejects future schemas, ambiguous books and references outside the book', () => {
        const value = portableStoryMap(baseline, 'Book');
        expect(readPortableStoryMap({ ...value, schemaVersion: 2 }, [{ id: 'b', sourceFolder: 'Book' }])).toBeNull();
        expect(readPortableStoryMap(value, [{ id: 'b', sourceFolder: 'Book' }, { id: 'c', sourceFolder: 'Book' }])).toBeNull();
        expect(readPortableStoryMap({ ...value, provenance: { ...value.provenance, scenes: [{ path: 'Book/../Secret.md', act: 1, subplots: [] }] } }, [{ id: 'b', sourceFolder: 'Book' }])).toBeNull();
        expect(readPortableStoryMap({ ...value, provenance: { ...value.provenance, generated: { nodes: [{ id: 'a', type: 'file', file: 'Other/private.md' }] } } }, [{ id: 'b', sourceFolder: 'Book' }])).toBeNull();
    });

    it('restores a portable baseline only when local details are missing', async () => {
        const file = { path: 'Maps/A.canvas.storymap.json' };
        const plugin = { settings: { books: [{ id: 'new-id', sourceFolder: 'Book' }], storyMapProvenance: {} as Record<string, StoryMapProvenance> }, app: { vault: {
            getFileByPath: () => file, cachedRead: vi.fn(async () => JSON.stringify(portableStoryMap(baseline, 'Book')))
        } } };
        await hydrateStoryMap(plugin as never, 'Maps/A.canvas');
        expect(plugin.settings.storyMapProvenance['Maps/A.canvas']).toEqual({ ...baseline, bookId: 'new-id' });
        plugin.settings.storyMapProvenance['Maps/A.canvas'] = { ...baseline, bookId: 'existing-local' };
        await hydrateStoryMap(plugin as never, 'Maps/A.canvas');
        expect(plugin.settings.storyMapProvenance['Maps/A.canvas'].bookId).toBe('existing-local');
        expect(plugin.app.vault.cachedRead).toHaveBeenCalledOnce();
    });

    it('refuses to replace a portable baseline changed elsewhere', async () => {
        const changed = { ...baseline, generatedAt: 'different' };
        let text = JSON.stringify(portableStoryMap(changed, 'Book'));
        const plugin = { settings: { books: [{ id: 'old-id', sourceFolder: 'Book' }] }, app: { vault: {
            getFileByPath: () => ({}), process: async (_file: unknown, fn: (value: string) => string) => { text = fn(text); }
        } } };
        await expect(updateStoryMapSidecar(plugin as never, 'Maps/A.canvas', baseline, changed, 'Book')).rejects.toThrow('changed elsewhere');
        expect(JSON.parse(text).provenance.generatedAt).toBe('different');
    });

    it('updates an unchanged sidecar when the generated baseline changes', async () => {
        let text = JSON.stringify(portableStoryMap(baseline, 'Book'));
        const plugin = { settings: { books: [{ id: 'old-id', sourceFolder: 'Book' }] }, app: { vault: {
            getFileByPath: () => ({}), process: async (_file: unknown, fn: (value: string) => string) => { text = fn(text); }
        } } };
        const next = { ...baseline, generatedAt: 'updated' };
        await updateStoryMapSidecar(plugin as never, 'Maps/A.canvas', baseline, next, 'Book');
        expect(JSON.parse(text).provenance.generatedAt).toBe('updated');
    });

    it('rebases manuscript notes and book folders without losing the original baseline', () => {
        const value = portableStoryMap(baseline, 'Book');
        const movedNote = rebasePortableStoryMap(value, 'Book/1.md', 'Book/Renamed.md')!;
        expect(movedNote.provenance.scenes[0].path).toBe('Book/Renamed.md');
        expect(movedNote.provenance.generated.nodes?.[0].file).toBe('Book/Renamed.md');
        const movedBook = rebasePortableStoryMap(value, 'Book', 'New Book')!;
        expect(movedBook.bookFolder).toBe('New Book');
        expect(movedBook.provenance.scenes[0].path).toBe('New Book/1.md');
        expect(readPortableStoryMap(movedBook, [{ id: 'new-id', sourceFolder: 'New Book' }])).not.toBeNull();
        expect(value.provenance.scenes[0].path).toBe('Book/1.md');
    });
});
