import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { CanvasConvertModal, type OpenCanvas } from './CanvasConvertModal';
import type { StoryCanvasData } from './canvasSketches';
import type { TimetableRow } from './timetableModel';
import type { SubplotColor } from '../renderer/utils/subplotColors';
import type { CardColorStanding, DirectoryEntry } from './canvasSubplotDirectory';
import { DEFAULT_SETTINGS } from '../settings/defaults';

/** Palette slot N paints `#0000NN` (1-based), so test colors read at a glance. */
const slotHex = (slot: number): string => `#${String(slot + 1).padStart(6, '0')}`;
const hexOf = (color: SubplotColor): string => color.kind === 'own' ? color.color : slotHex(color.slot);

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
    const modal = new CanvasConvertModal(app, plugin, canvas, 'Ideas.canvas', [book], book, () => true);
    (Reflect.get(modal, 'selected') as Set<string>).add('1');
    Reflect.set(modal, 'mode', 'sketches');
    return { modal, saved, setData, requestSave, app, plugin, activateView, book, getData: () => data };
}

function scenes(selected: string[] = ['1', '2']) {
    const test = setup(false, selected);
    for (const id of selected) (Reflect.get(test.modal, 'selected') as Set<string>).add(id);
    test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
    Reflect.set(test.modal, 'mode', 'scenes');
    // The book's subplots are read, in a palette where slot N paints #0000NN.
    Reflect.set(test.modal, 'ringsBook', 'book');
    Reflect.set(test.modal, 'hexOf', hexOf);
    return test;
}

/** Give the cards these Canvas colors, and say what each color means on the timeline (as loadRings reads it). */
function colorCards(test: ReturnType<typeof scenes>, colors: Array<{ color: string; hex?: string | null; standing?: CardColorStanding }>) {
    const cards = Reflect.get(test.modal, 'cards') as Array<{ id: string; color?: string }>;
    colors.forEach(({ color, hex, standing }, index) => {
        cards[index].color = color;
        test.getData().nodes![index].color = color;
        const key = color.toLowerCase();
        (Reflect.get(test.modal, 'cardHexes') as Map<string, string | null>).set(key, hex === undefined ? key : hex);
        if (standing) (Reflect.get(test.modal, 'standings') as Map<string, CardColorStanding>).set(key, standing);
    });
}

const named = (test: ReturnType<typeof scenes>) => Reflect.get(test.modal, 'subplotByColor') as Map<string, string>;
const convert = (test: ReturnType<typeof scenes>) => Reflect.get(test.modal, 'convert').call(test.modal) as Promise<void>;

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

    it('puts a colored card on the subplot named for its color, in the spelling the book uses, and gives the card that subplot’s color', async () => {
        const test = scenes();
        colorCards(test, [{ color: '#AA00FF' }]);
        Reflect.set(test.modal, 'directory', [{ name: 'The Servant', hex: slotHex(2), pending: false }] satisfies DirectoryEntry[]);
        named(test).set('#aa00ff', ' the servant ');
        await convert(test);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: The Servant');
        // An existing subplot keeps the color it wears; the card color is not stored for it.
        expect(test.book.ownSubplotColors).toBeUndefined();
        expect(test.plugin.saveSettings).not.toHaveBeenCalled();
        // The card takes the ring's color once its scene joins: here the second ring, after Main Plot.
        expect(test.getData().nodes?.[0].color).toBe(slotHex(1));
        expect(test.getData().nodes?.[1].color).toBeUndefined();
    });

    it('gives a new subplot a free palette color its cards wear, as its own when ring order would give it another slot', async () => {
        const test = scenes();
        colorCards(test, [{ color: '#AA00FF', standing: { kind: 'palette' } }, { color: '#aa00ff', standing: { kind: 'palette' } }]);
        named(test).set('#aa00ff', 'Romance');
        await convert(test);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Romance');
        expect(test.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: '#aa00ff' } });
        expect(test.plugin.saveSettings).toHaveBeenCalledOnce();
        expect(test.plugin.setCSSColorVariables).toHaveBeenCalledOnce();
        // The cards already wear their subplot's color.
        expect(test.getData().nodes?.map(node => node.color)).toEqual(['#AA00FF', '#aa00ff']);
    });

    it('stores no own color when the palette color chosen is the slot the new ring takes anyway', async () => {
        const test = scenes();
        // Card 1 is Romance in the second palette color; card 2 has no color and joins Main Plot.
        colorCards(test, [{ color: slotHex(1), standing: { kind: 'palette' } }]);
        named(test).set(slotHex(1), 'Romance');
        await convert(test);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Romance');
        expect(test.book.ownSubplotColors).toBeUndefined();
        expect(test.plugin.saveSettings).not.toHaveBeenCalled();
        expect(test.getData().nodes?.[0].color).toBe(slotHex(1));
    });

    it('lets a second card color join a new subplot an earlier color named, and repaints its cards in that color', async () => {
        const test = scenes();
        colorCards(test, [{ color: '#aa00ff', standing: { kind: 'palette' } }, { color: '#00ff00', standing: { kind: 'palette' } }]);
        named(test).set('#aa00ff', 'Romance').set('#00ff00', 'romance');
        await convert(test);
        expect(test.saved.get('Book/2 Other idea.md')).toContain('Subplot: Romance');
        expect(test.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: '#aa00ff' } });
        expect(test.getData().nodes?.map(node => node.color)).toEqual(['#aa00ff', '#aa00ff']);
    });

    it('waits for a subplot before creating anything from a color outside the timeline’s colors', async () => {
        const test = scenes();
        colorCards(test, [{ color: '#ffff00', standing: { kind: 'outside' } }]);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await convert(test);
        expect(test.saved.size).toBe(0);
        expect(test.setData).not.toHaveBeenCalled();
        // A new name alone is not enough: it needs a palette color.
        named(test).set('#ffff00', 'Romance');
        await convert(test);
        expect(test.saved.size).toBe(0);
        error.mockRestore();
    });

    it('recolors cards outside the timeline’s colors to the subplot chosen for them', async () => {
        const existing = scenes();
        colorCards(existing, [{ color: '6', hex: '#ffff00', standing: { kind: 'outside' } }]);
        Reflect.set(existing.modal, 'directory', [{ name: 'Main Plot', hex: slotHex(0), pending: false }, { name: 'Mara', hex: slotHex(1), pending: false }] satisfies DirectoryEntry[]);
        named(existing).set('6', 'Mara');
        await convert(existing);
        expect(existing.saved.get('Book/1 A scene.md')).toContain('Subplot: Mara');
        expect(existing.getData().nodes?.[0].color).toBe(slotHex(1));

        const created = scenes();
        colorCards(created, [{ color: '6', hex: '#ffff00', standing: { kind: 'outside' } }]);
        named(created).set('6', 'Romance');
        (Reflect.get(created.modal, 'paletteByColor') as Map<string, string>).set('6', slotHex(7));
        await convert(created);
        expect(created.saved.get('Book/1 A scene.md')).toContain('Subplot: Romance');
        expect(created.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: slotHex(7) } });
        expect(created.getData().nodes?.[0].color).toBe(slotHex(7));
    });

    it('creates a new subplot remembered on the Canvas, then stops remembering it', async () => {
        const test = scenes();
        test.plugin.settings.canvasPendingSubplots = { schemaVersion: 1, canvases: {
            'Ideas.canvas': [{ bookId: 'book', name: 'Letters', color: '#abcdef' }, { bookId: 'other', name: 'Letters', color: '#abcdef' }],
        } };
        colorCards(test, [{ color: '#abcdef', standing: { kind: 'pending', subplot: 'Letters' } }]);
        Reflect.set(test.modal, 'directory', [{ name: 'Main Plot', hex: slotHex(0), pending: false }, { name: 'Letters', hex: '#abcdef', pending: true }] satisfies DirectoryEntry[]);
        named(test).set('#abcdef', 'Letters');
        await convert(test);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Letters');
        expect(test.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Letters: '#abcdef' } });
        expect(test.plugin.settings.canvasPendingSubplots).toEqual({ schemaVersion: 1, canvases: {
            'Ideas.canvas': [{ bookId: 'other', name: 'Letters', color: '#abcdef' }],
        } });
        expect(test.plugin.saveSettings).toHaveBeenCalledOnce();
    });

    it('waits for the chosen book’s subplots before Create', async () => {
        const test = scenes();
        Reflect.set(test.modal, 'ringsBook', null);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await convert(test);
        expect(test.saved.size).toBe(0);
        error.mockRestore();
    });

    it('stores no color for a new subplot whose scenes were never written', async () => {
        const test = scenes(['1']);
        colorCards(test, [{ color: '#aa00ff', standing: { kind: 'palette' } }]);
        named(test).set('#aa00ff', 'Romance');
        test.app.vault.create = vi.fn(async () => { throw new Error('Disk full'); });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await convert(test);
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
        expect(() => new CanvasConvertModal(app, plugin, canvas, 'Ideas.canvas', [book], book, () => true)).not.toThrow();
    });
});

describe('Bring ideas into your book starts each card color on its subplot', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads the book’s subplots, then a new subplot waiting on the Canvas, and marks a color outside the timeline’s', async () => {
        // The palette paints slot N as #0000NN; Canvas preset 6 paints a yellow no ring wears.
        const vars: Record<string, string> = { '--canvas-color-6': '#ffff00' };
        for (let slot = 0; slot < 16; slot++) vars[`--rt-subplot-colors-${slot}`] = slotHex(slot);
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => vars[name] ?? '' }));
        let fill = '#000000';
        const context = { get fillStyle() { return fill; }, set fillStyle(value: string) { if (/^#[0-9a-f]{6}$/i.test(value)) fill = value.toLowerCase(); } };
        const doc = { win: { createEl: () => ({ getContext: () => context }) }, documentElement: {}, body: {} } as unknown as Document; // SAFE: the color readers touch only these members

        const data: StoryCanvasData = { nodes: [
            { id: 'mara', type: 'text', text: 'Mara leaves', color: slotHex(1) },
            { id: 'letters', type: 'text', text: 'A letter', color: '#ABCDEF' },
            { id: 'yellow', type: 'text', text: 'Storm', color: '6' },
            { id: 'free', type: 'text', text: 'Market day', color: slotHex(5) },
        ] };
        const app = { workspace: { getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => ({}) }, vault: { getMarkdownFiles: () => [], getFiles: () => [] } } as unknown as App;
        const book = { id: 'book', title: 'Book', sourceFolder: 'Book' } as BookProfile;
        const plugin = { settings: { ...DEFAULT_SETTINGS, books: [book], canvasPendingSubplots: { schemaVersion: 1, canvases: {
            'Ideas.canvas': [{ bookId: 'book', name: 'Letters', color: '#abcdef' }],
        } } } } as unknown as RadialTimelinePlugin;
        const canvas: OpenCanvas = { getData: () => data, setData: vi.fn(), requestSave: vi.fn(), selection: new Set(data.nodes!.map(node => ({ getData: () => ({ id: node.id, type: 'text' }) }))) };
        const modal = new CanvasConvertModal(app, plugin, canvas, 'Ideas.canvas', [book], book, () => true);
        Reflect.set(modal, 'containerEl', { doc });
        Reflect.set(modal, 'bookItems', () => []);
        Reflect.set(modal, 'readWheel', async () => new Map<string, SubplotColor>([['Main Plot', { kind: 'slot', slot: 0 }], ['Mara', { kind: 'slot', slot: 1 }]]));

        await Reflect.get(modal, 'loadRings').call(modal);

        expect(Reflect.get(modal, 'directory')).toEqual([
            { name: 'Main Plot', hex: slotHex(0), pending: false },
            { name: 'Mara', hex: slotHex(1), pending: false },
            { name: 'Letters', hex: '#abcdef', pending: true },
        ]);
        expect([...(Reflect.get(modal, 'subplotByColor') as Map<string, string>)]).toEqual([[slotHex(1), 'Mara'], ['#abcdef', 'Letters']]);
        const plans = Reflect.get(modal, 'colorPlans').call(modal) as Map<string, unknown>;
        expect([...plans]).toEqual([
            [slotHex(1), { kind: 'existing', subplot: 'Mara' }],
            ['#abcdef', { kind: 'new', subplot: 'Letters', color: '#abcdef' }],
            ['6', { kind: 'unassigned' }],
            [slotHex(5), { kind: 'mainPlot' }],
        ]);
        expect(Reflect.get(modal, 'ringsBook')).toBe('book');
    });
});
