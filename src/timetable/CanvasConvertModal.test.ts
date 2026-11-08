import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { CanvasConvertModal, type OpenCanvas } from './CanvasConvertModal';
import type { StoryCanvasData } from './canvasSketches';
import type { TimetableRow } from './timetableModel';
import { DEFAULT_SETTINGS } from '../settings/defaults';

function setup(changeDuringCreate = false, selectedIds: string[] = ['1']) {
    let data: StoryCanvasData = { nodes: [
        { id: '1', type: 'text', text: 'A scene\n\nSome ideas', x: 1, y: 2 },
        { id: '2', type: 'text', text: 'Other idea' },
    ], edges: [{ id: 'edge', fromNode: '1', toNode: '2' }] };
    const saved = new Map<string, string>();
    const create = vi.fn(async (path: string, text: string) => {
        saved.set(path, text);
        if (changeDuringCreate) data = { ...data, extra: 'edited by author' };
    });
    const app = { workspace: { getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => ({}) }, vault: { getMarkdownFiles: () => [], getFiles: () => [], getFolderByPath: () => ({}), getAbstractFileByPath: (path: string) => path === 'Book/A scene.md' ? {} : null, create } } as unknown as App;
    const activateView = vi.fn(async () => {});
    const plugin = { settings: {}, refreshTimelineIfNeeded: vi.fn(), getSceneData: vi.fn(async () => []), getTimelineService: () => ({ activateView }), setActiveBookId: vi.fn(async () => {}), saveSettings: vi.fn(async () => {}), setCSSColorVariables: vi.fn() } as unknown as RadialTimelinePlugin;
    const setData = vi.fn((next: StoryCanvasData) => { data = next; });
    const requestSave = vi.fn();
    const canvas: OpenCanvas = { getData: () => data, setData, requestSave, selection: new Set(selectedIds.map(id => ({ getData: () => ({ id, type: 'text' }) }))) };
    const book = { id: 'book', title: 'Book', sourceFolder: 'Book' } as BookProfile;
    const modal = new CanvasConvertModal(app, plugin, canvas, [book], book, () => true);
    (Reflect.get(modal, 'selected') as Set<string>).add('1');
    Reflect.set(modal, 'mode', 'sketches');
    return { modal, saved, setData, requestSave, app, plugin, activateView, book, getData: () => data };
}

function scenes(selected: string[] = ['1', '2']) {
    const test = setup(false, selected);
    for (const id of selected) (Reflect.get(test.modal, 'selected') as Set<string>).add(id);
    test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
    Reflect.set(test.modal, 'mode', 'scenes');
    return test;
}

describe('Canvas scene conversion', () => {
    it('writes each card as a finished, numbered scene in its act and opens the timeline', async () => {
        const test = scenes();
        (Reflect.get(test.modal, 'sceneActs') as Map<string, number>).set('1', 1).set('2', 2);
        await Reflect.get(test.modal, 'convert').call(test.modal);
        const first = test.saved.get('Book/1 A scene.md');
        expect(first).toContain('Class: Scene');
        expect(first).toContain('Act: 1');
        expect(first).toMatch(/^ID: /m);
        expect(first).toContain('A scene\n\nSome ideas');
        expect(first).not.toContain('Sketch order');
        expect(test.saved.get('Book/2 Other idea.md')).toContain('Act: 2');
        expect(test.getData().nodes?.map(node => node.file)).toEqual(['Book/1 A scene.md', 'Book/2 Other idea.md']);
        expect(test.activateView).toHaveBeenCalledOnce();
        expect(test.plugin.setActiveBookId).toHaveBeenCalledWith('book');
        expect(vi.mocked(test.plugin.setActiveBookId).mock.invocationCallOrder[0]).toBeLessThan(test.activateView.mock.invocationCallOrder[0]);
    });

    it('puts a colored card on the subplot named for its color, in the spelling the book uses', async () => {
        const test = scenes();
        (Reflect.get(test.modal, 'cards') as Array<{ id: string; color?: string }>)[0].color = '#AA00FF';
        test.getData().nodes![0].color = '#AA00FF';
        Reflect.set(test.modal, 'rings', [{ name: 'The Servant', color: { kind: 'slot', slot: 2 } }]);
        (Reflect.get(test.modal, 'subplotByColor') as Map<string, string>).set('#aa00ff', ' the servant ');
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: The Servant');
        // An existing subplot keeps the color it wears; the card color is not stored for it.
        expect(test.book.ownSubplotColors).toBeUndefined();
        expect(test.plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('gives a new subplot its card color, chosen once, so its ring wears it after Create', async () => {
        const test = scenes();
        const cards = Reflect.get(test.modal, 'cards') as Array<{ id: string; color?: string }>;
        cards[0].color = '#AA00FF';
        cards[1].color = '#aa00ff';
        test.getData().nodes![0].color = '#AA00FF';
        test.getData().nodes![1].color = '#aa00ff';
        (Reflect.get(test.modal, 'subplotByColor') as Map<string, string>).set('#aa00ff', 'Romance');
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Romance');
        expect(test.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: '#aa00ff' } });
        expect(test.plugin.saveSettings).toHaveBeenCalledOnce();
        expect(test.plugin.setCSSColorVariables).toHaveBeenCalledOnce();
    });

    it('lets a second card color join a new subplot an earlier color named, wearing the earlier color', async () => {
        const test = scenes();
        const cards = Reflect.get(test.modal, 'cards') as Array<{ id: string; color?: string }>;
        cards[0].color = '#aa00ff';
        cards[1].color = '#00ff00';
        test.getData().nodes![0].color = '#aa00ff';
        test.getData().nodes![1].color = '#00ff00';
        const named = Reflect.get(test.modal, 'subplotByColor') as Map<string, string>;
        named.set('#aa00ff', 'Romance').set('#00ff00', 'romance');
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.get('Book/2 Other idea.md')).toContain('Subplot: Romance');
        expect(test.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: '#aa00ff' } });
    });

    it('stores no color for a new subplot whose scenes were never written', async () => {
        const test = scenes(['1']);
        (Reflect.get(test.modal, 'cards') as Array<{ id: string; color?: string }>)[0].color = '#aa00ff';
        test.getData().nodes![0].color = '#aa00ff';
        (Reflect.get(test.modal, 'subplotByColor') as Map<string, string>).set('#aa00ff', 'Romance');
        test.app.vault.create = vi.fn(async () => { throw new Error('Disk full'); });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.book.ownSubplotColors).toBeUndefined();
        expect(test.plugin.saveSettings).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('leaves a card the author did not select on the Canvas as it was', async () => {
        const test = scenes(['1']);
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.size).toBe(1);
        expect(test.getData().nodes?.[1]).toMatchObject({ id: '2', type: 'text', text: 'Other idea' });
    });

    it('creates nothing when an Act card names an act the book does not have', async () => {
        const test = scenes();
        (Reflect.get(test.modal, 'sceneActs') as Map<string, number>).set('2', 9);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.size).toBe(0);
        expect(test.setData).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('moves a card across an act break before it changes the order', () => {
        const test = scenes();
        const cards = Reflect.get(test.modal, 'cards') as Array<{ id: string }>;
        const acts = Reflect.get(test.modal, 'sceneActs') as Map<string, number>;
        acts.set('1', 1).set('2', 2);
        const move = Reflect.get(test.modal, 'moveCard') as (index: number, delta: number) => void;
        move.call(test.modal, 1, -1);
        expect(acts.get('2')).toBe(1);
        expect(cards.map(card => card.id)).toEqual(['1', '2']);
        move.call(test.modal, 1, -1);
        expect(cards.map(card => card.id)).toEqual(['2', '1']);
    });
});

describe('Canvas sketch conversion', () => {
    it('preselects all selected text cards for review', () => {
        const test = setup(false, ['1', '2']);
        expect([...Reflect.get(test.modal, 'selected') as Set<string>]).toEqual(['1', '2']);
    });

    it('offers only the selected ideas', () => {
        const test = setup(false, ['2']);
        expect((Reflect.get(test.modal, 'cards') as Array<{ id: string }>).map(card => card.id)).toEqual(['2']);
    });

    it('creates a distinct sketch preserving the card body and replaces only that card', async () => {
        const test = setup();
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.get('Book/A scene 2.md')).toContain('A scene\n\nSome ideas');
        expect(test.saved.get('Book/A scene 2.md')).toContain('Sketch');
        expect(test.getData().nodes?.[0]).toMatchObject({ type: 'file', file: 'Book/A scene 2.md', x: 1, y: 2 });
        expect(test.getData().nodes?.[1]).toMatchObject({ id: '2', type: 'text', text: 'Other idea' });
        expect(test.getData().edges).toEqual([{ id: 'edge', fromNode: test.getData().nodes?.[0].id, toNode: '2' }]);
        expect(test.getData().nodes?.[0].id).not.toBe('1');
        expect(test.requestSave).toHaveBeenCalledOnce();
        expect(test.requestSave).toHaveBeenCalledWith(false);
    });

    it('keeps created notes but refuses to overwrite a Canvas changed during creation', async () => {
        const test = setup(true);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.size).toBe(1);
        expect(test.setData).not.toHaveBeenCalled();
        expect(test.requestSave).not.toHaveBeenCalled();
        expect(test.getData().nodes?.[0]).toMatchObject({ type: 'text', text: 'A scene\n\nSome ideas' });
        error.mockRestore();
    });

    it('writes selected sketches in the reviewed order at the end of the chosen act', async () => {
        const test = setup(false, ['1', '2']);
        (Reflect.get(test.modal, 'selected') as Set<string>).add('2');
        const cards = Reflect.get(test.modal, 'cards') as Array<{ id: string }>;
        cards.reverse();
        Reflect.set(test.modal, 'act', 2);
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.get('Book/Other idea.md')).toContain('Sketch order: 10');
        expect(test.saved.get('Book/A scene 2.md')).toContain('Sketch order: 20');
        expect(test.saved.get('Book/Other idea.md')).toContain('Act: 2');
    });

    it('keeps sketches off subplots whatever color their card has', async () => {
        const test = setup();
        (Reflect.get(test.modal, 'cards') as Array<{ id: string; color?: string }>)[0].color = '1';
        test.getData().nodes![0].color = '1';
        (Reflect.get(test.modal, 'subplotByColor') as Map<string, string>).set('1', 'The Servant');
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.get('Book/A scene 2.md')).not.toContain('Subplot');
    });

    it('places converted sketches after the chosen scene using its ID and act', async () => {
        const test = setup();
        Reflect.set(test.modal, 'anchorPath', 'Book/1 The Letter.md');
        Reflect.set(test.modal, 'bookItems', () => [{
            row: { path: 'Book/1 The Letter.md', basename: '1 The Letter', kind: 'scene', act: 2 } as TimetableRow,
            frontmatter: { ID: 'scene_letter' },
        }]);
        await Reflect.get(test.modal, 'convert').call(test.modal);
        const content = test.saved.get('Book/A scene 2.md');
        expect(content).toContain('Place after scene: scene_letter');
        expect(content).toContain('Act: 2');
        expect(content).toContain('Sketch order: 10');
    });

    it('does not create sketches if the chosen scene has a duplicate ID', async () => {
        const test = setup();
        Reflect.set(test.modal, 'anchorPath', 'Book/1 The Letter.md');
        const scene = (path: string) => ({ row: { path, basename: path, kind: 'scene', act: 1 } as TimetableRow, frontmatter: { ID: 'duplicate' } });
        Reflect.set(test.modal, 'bookItems', () => [scene('Book/1 The Letter.md'), scene('Book/2 Another.md')]);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.size).toBe(0);
        expect(test.setData).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('gives an existing unranked sketch a position before the new cards', async () => {
        const test = setup();
        const file = new TFile('Book/Existing.md');
        const frontmatter: Record<string, unknown> = { Class: 'Sketch', Act: 1 };
        test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
        test.app.vault.getAbstractFileByPath = path => path === file.path ? file : null;
        test.app.fileManager = { processFrontMatter: async (_file: TFile, cb: (fm: Record<string, unknown>) => void) => cb(frontmatter) } as App['fileManager'];
        Reflect.set(test.modal, 'act', 1);
        Reflect.set(test.modal, 'bookItems', () => [{ row: { path: file.path, basename: file.basename, kind: 'sketch', act: 1 } as TimetableRow, frontmatter }]);
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(frontmatter['Sketch order']).toBe(10);
        expect(test.saved.get('Book/A scene.md')).toContain('Sketch order: 20');
    });

    it('restores an existing sketch order when creating the first note fails', async () => {
        const test = setup();
        const file = new TFile('Book/Existing.md');
        const frontmatter: Record<string, unknown> = { Class: 'Sketch', Act: 1, 'Sketch order': 'unset' };
        test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
        test.app.vault.getAbstractFileByPath = path => path === file.path ? file : null;
        test.app.vault.create = vi.fn(async () => { throw new Error('Disk full'); });
        test.app.fileManager = { processFrontMatter: async (_file: TFile, cb: (fm: Record<string, unknown>) => void) => cb(frontmatter) } as App['fileManager'];
        Reflect.set(test.modal, 'act', 1);
        Reflect.set(test.modal, 'bookItems', () => [{ row: { path: file.path, basename: file.basename, kind: 'sketch', act: 1 } as TimetableRow, frontmatter: { ...frontmatter } }]);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(frontmatter['Sketch order']).toBe('unset');
        expect(test.setData).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('does not overwrite another edit when restoring an order after failure', async () => {
        const test = setup();
        const file = new TFile('Book/Existing.md');
        const frontmatter: Record<string, unknown> = { Class: 'Sketch', Act: 1 };
        test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
        test.app.vault.getAbstractFileByPath = path => path === file.path ? file : null;
        test.app.vault.create = vi.fn(async () => { frontmatter['Sketch order'] = 99; throw new Error('Disk full'); });
        test.app.fileManager = { processFrontMatter: async (_file: TFile, cb: (fm: Record<string, unknown>) => void) => cb(frontmatter) } as App['fileManager'];
        Reflect.set(test.modal, 'act', 1);
        Reflect.set(test.modal, 'bookItems', () => [{ row: { path: file.path, basename: file.basename, kind: 'sketch', act: 1 } as TimetableRow, frontmatter: { ...frontmatter } }]);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(frontmatter['Sketch order']).toBe(99);
        error.mockRestore();
    });

    it('keeps existing ranks when some new sketches were created before a failure', async () => {
        const test = setup(false, ['1', '2']);
        const file = new TFile('Book/Existing.md');
        const frontmatter: Record<string, unknown> = { Class: 'Sketch', Act: 1 };
        test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
        test.app.vault.getAbstractFileByPath = path => path === file.path ? file : null;
        let created = 0;
        test.app.vault.create = vi.fn(async () => {
            if (++created === 2) throw new Error('Disk full');
            return new TFile('Book/A scene.md');
        });
        test.app.fileManager = { processFrontMatter: async (_file: TFile, cb: (fm: Record<string, unknown>) => void) => cb(frontmatter) } as App['fileManager'];
        Reflect.set(test.modal, 'act', 1);
        (Reflect.get(test.modal, 'selected') as Set<string>).add('2');
        Reflect.set(test.modal, 'bookItems', () => [{ row: { path: file.path, basename: file.basename, kind: 'sketch', act: 1 } as TimetableRow, frontmatter: { ...frontmatter } }]);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(frontmatter['Sketch order']).toBe(10);
        expect(test.setData).not.toHaveBeenCalled();
        error.mockRestore();
    });
});

describe('Canvas conversion on a damaged map', () => {
    it('opens when a text card on the map holds no text string', () => {
        const data = { nodes: [
            { id: '1', type: 'text', text: 'A scene' },
            { id: 'broken', type: 'text', text: 42 },
            { id: 'empty', type: 'text' },
        ] } as unknown as StoryCanvasData;
        const app = { workspace: { getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => ({}) }, vault: { getMarkdownFiles: () => [], getFiles: () => [] } } as unknown as App;
        const plugin = { settings: { ...DEFAULT_SETTINGS } } as unknown as RadialTimelinePlugin;
        const canvas: OpenCanvas = { getData: () => data, setData: vi.fn(), requestSave: vi.fn(), selection: new Set([{ getData: () => ({ id: '1', type: 'text' }) }]) };
        const book = { id: 'book', title: 'Book', sourceFolder: 'Book' } as BookProfile;
        expect(() => new CanvasConvertModal(app, plugin, canvas, [book], book, () => true)).not.toThrow();
    });
});
