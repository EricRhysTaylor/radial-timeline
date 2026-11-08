import { describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { legacyNotePlacement, parsePlacementFile, SKETCH_PLACEMENT_PATH, SketchPlacementStore } from './SketchPlacementStore';

type Handler = (...args: unknown[]) => void;

/** A vault of notes (frontmatter by path), an in-memory disk, and the vault events the store listens to. */
function fixture(notes: Record<string, Record<string, unknown>>, sidecar?: unknown) {
    const disk = new Map<string, string>();
    if (sidecar !== undefined) disk.set(SKETCH_PLACEMENT_PATH, JSON.stringify(sidecar));
    const handlers = new Map<string, Handler>();
    let layoutReady: (() => void) | null = null;
    const adapter = {
        exists: vi.fn(async (path: string) => disk.has(path)),
        read: vi.fn(async (path: string) => disk.get(path)!),
        mkdir: vi.fn(async (path: string) => { disk.set(path, ''); }),
        write: vi.fn(async (path: string, content: string) => { disk.set(path, content); }),
    };
    const processFrontMatter = vi.fn();
    const process = vi.fn();
    const plugin = {
        settings: { ...DEFAULT_SETTINGS, books: [{ id: 'b', title: 'Book', sourceFolder: 'Book' }] },
        app: {
            vault: {
                adapter, process,
                getMarkdownFiles: () => Object.keys(notes).map(path => new TFile(path)),
                on: (name: string, handler: Handler) => { handlers.set(name, handler); return {}; },
            },
            metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: notes[file.path] }) },
            workspace: { onLayoutReady: (callback: () => void) => { layoutReady = callback; } },
            fileManager: { processFrontMatter },
        },
    } as unknown as RadialTimelinePlugin; // SAFE: test double with only what the store reads
    const store = new SketchPlacementStore(plugin);
    const saved = () => JSON.parse(disk.get(SKETCH_PLACEMENT_PATH) ?? 'null') as { sketches: Record<string, unknown> } | null;
    /** Load as the plugin does, then wait for the one-time import. */
    const start = async () => {
        await store.initialize();
        store.load();
        layoutReady?.();
        await store.importFromNotes();
    };
    const fire = (name: string, ...args: unknown[]) => handlers.get(name)?.(...args);
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    return { store, disk, saved, start, fire, settle, processFrontMatter, process, notes };
}

describe('sketch placement sidecar', () => {
    it('writes placements to the sidecar file and never to a note', async () => {
        const f = fixture({ 'Book/Idea.md': { Class: 'Sketch', Act: 1 } });
        await f.start();
        expect(f.saved()).toBeNull();
        await f.store.set([['Book/Idea.md', { after: 'scn_1', order: 10 }]]);
        expect(f.saved()).toEqual({ schemaVersion: 1, sketches: { 'Book/Idea.md': { after: 'scn_1', order: 10 } } });
        expect(f.store.get('Book/Idea.md')).toEqual({ after: 'scn_1', order: 10 });
        expect(f.notes['Book/Idea.md']).toEqual({ Class: 'Sketch', Act: 1 });
        expect(f.processFrontMatter).not.toHaveBeenCalled();
        expect(f.process).not.toHaveBeenCalled();
        // Clearing a placement drops the entry.
        await f.store.set([['Book/Idea.md', null]]);
        expect(f.saved()?.sketches).toEqual({});
    });

    it('copies the old note lines into a new sidecar once, leaving the notes as they are', async () => {
        const notes = {
            'Book/A.md': { Class: 'Sketch', 'Place after scene': 'scn_1', 'Sketch order': 20 },
            'Book/B.md': { class: 'sketch', 'sketch order': 10 },
            'Book/Scene.md': { Class: 'Scene', 'Place after scene': 'scn_1' },
            'Book/Plain.md': { Class: 'Sketch' },
        };
        const before = JSON.stringify(notes);
        const f = fixture(notes);
        await f.start();
        expect(f.saved()?.sketches).toEqual({ 'Book/A.md': { after: 'scn_1', order: 20 }, 'Book/B.md': { order: 10 } });
        expect(JSON.stringify(notes)).toBe(before);
        expect(f.processFrontMatter).not.toHaveBeenCalled();
        expect(f.process).not.toHaveBeenCalled();
    });

    it('never reads the old note lines again once a sidecar exists: the sidecar wins', async () => {
        const f = fixture({ 'Book/A.md': { Class: 'Sketch', 'Place after scene': 'scn_old', 'Sketch order': 99 } }, { schemaVersion: 1, sketches: { 'Book/A.md': { order: 5 } } });
        await f.start();
        expect(f.store.get('Book/A.md')).toEqual({ order: 5 });
        expect(f.saved()?.sketches).toEqual({ 'Book/A.md': { order: 5 } });
    });

    it('makes no file in a vault with nothing to import', async () => {
        const f = fixture({ 'Book/A.md': { Class: 'Sketch' } });
        await f.start();
        expect(f.disk.size).toBe(0);
    });

    it('keeps a sketch’s placement when the note is renamed or its folder is moved', async () => {
        const f = fixture({});
        await f.start();
        await f.store.set([['Book/Idea.md', { after: 'scn_1', order: 10 }], ['Book/Part/Other.md', { order: 20 }]]);
        f.fire('rename', new TFile('Book/Better name.md'), 'Book/Idea.md');
        await f.settle();
        expect(f.store.get('Book/Idea.md')).toBeUndefined();
        expect(f.store.get('Book/Better name.md')).toEqual({ after: 'scn_1', order: 10 });
        f.fire('rename', new TFolder('Book/Section'), 'Book/Part');
        await f.settle();
        expect(f.store.get('Book/Section/Other.md')).toEqual({ order: 20 });
        expect(f.saved()?.sketches).toEqual({ 'Book/Better name.md': { after: 'scn_1', order: 10 }, 'Book/Section/Other.md': { order: 20 } });
    });

    it('drops a deleted sketch’s entry', async () => {
        const f = fixture({});
        await f.start();
        await f.store.set([['Book/Idea.md', { order: 10 }], ['Book/Keep.md', { order: 20 }]]);
        f.fire('delete', new TFile('Book/Idea.md'));
        await f.settle();
        expect(f.saved()?.sketches).toEqual({ 'Book/Keep.md': { order: 20 } });
    });

    it('reads the sidecar again when another device syncs it, and tells listeners', async () => {
        const f = fixture({});
        await f.start();
        const listener = vi.fn();
        f.store.subscribe(listener);
        f.disk.set(SKETCH_PLACEMENT_PATH, JSON.stringify({ schemaVersion: 1, sketches: { 'Book/Synced.md': { after: 'scn_9' } } }));
        f.fire('modify', new TFile(SKETCH_PLACEMENT_PATH));
        await f.settle();
        expect(f.store.get('Book/Synced.md')).toEqual({ after: 'scn_9' });
        expect(listener).toHaveBeenCalled();
    });

    it('refuses to write over a sidecar it could not read', async () => {
        const f = fixture({}, { schemaVersion: 2 });
        await f.start();
        expect(f.store.error).toBeTruthy();
        await expect(f.store.set([['Book/Idea.md', { order: 10 }]])).rejects.toThrow();
        expect(f.saved()).toEqual({ schemaVersion: 2 });
    });
});

describe('placement values', () => {
    it('keeps only a scene ID and a finite order', () => {
        expect(parsePlacementFile(JSON.stringify({ schemaVersion: 1, sketches: { a: { after: ' scn_1 ', order: 'x' }, b: { after: '', order: null } } })))
            .toEqual({ schemaVersion: 1, sketches: { a: { after: 'scn_1' } } });
        expect(legacyNotePlacement({ 'PLACE AFTER SCENE': 'scn_2', 'Sketch order': 30 })).toEqual({ after: 'scn_2', order: 30 });
        expect(legacyNotePlacement({ Class: 'Sketch' })).toBeNull();
    });
});
