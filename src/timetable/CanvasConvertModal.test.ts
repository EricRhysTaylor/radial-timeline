import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal, TFile, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { CanvasConvertModal, type OpenCanvas } from './CanvasConvertModal';
import type { StoryCanvasData } from './canvasSketches';
import type { TimetableRow } from './timetableModel';
import type { SubplotColor } from '../renderer/utils/subplotColors';
import type { CardColorStanding, DirectoryEntry } from './canvasSubplotDirectory';
import type { CanvasSubplotMemoryRecord } from '../types/settings';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { syncMainPlotName } from '../utils/mainPlot';
import { memoryPlacements } from '../../tests/helpers/sketchPlacements';

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
    const placements = memoryPlacements().store;
    const plugin = { app, settings: {}, sketchPlacements: placements, refreshTimelineIfNeeded: vi.fn(), getSceneData: vi.fn(async () => []), getTimelineService: () => ({ activateView }), setActiveBookId: vi.fn(async () => {}), saveSettings: vi.fn(async () => {}), setCSSColorVariables: vi.fn() } as unknown as RadialTimelinePlugin;
    const setData = vi.fn((next: StoryCanvasData) => { data = next; });
    const requestSave = vi.fn();
    const canvas: OpenCanvas = { getData: () => data, setData, requestSave, selection: new Set(selectedIds.map(id => ({ getData: () => ({ id, type: 'text' }) }))) };
    const book = { id: 'book', title: 'Book', sourceFolder: 'Book' } as BookProfile;
    const modal = new CanvasConvertModal(app, plugin, canvas, 'Ideas.canvas', [book], book, () => true);
    (Reflect.get(modal, 'selected') as Set<string>).add('1');
    Reflect.set(modal, 'mode', 'sketches');
    // Obsidian has read every new note's properties (see the indexing test below).
    const indexed = vi.fn(async () => true);
    Reflect.set(modal, 'indexed', indexed);
    return { modal, saved, setData, requestSave, app, plugin, activateView, book, indexed, placements, getData: () => data };
}

function scenes(selected: string[] = ['1', '2']) {
    const test = setup(false, selected);
    for (const id of selected) (Reflect.get(test.modal, 'selected') as Set<string>).add(id);
    test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
    Reflect.set(test.modal, 'mode', 'scenes');
    // The book's subplots are read, in a palette where slot N paints #0000NN.
    Reflect.set(test.modal, 'ringsBook', 'book');
    Reflect.set(test.modal, 'hexOf', hexOf);
    // Card colors read as loadRings read them (colorCards below); a hex color reads as itself.
    const cardHexes = Reflect.get(test.modal, 'cardHexes') as Map<string, string | null>;
    Reflect.set(test.modal, 'cardHexOf', (color: string | null) => color === null ? null : cardHexes.has(color) ? cardHexes.get(color) : /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null);
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

const named = (test: ReturnType<typeof scenes>) => Reflect.get(test.modal, 'subplotByRow') as Map<string, string>;
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
        (Reflect.get(created.modal, 'paletteByRow') as Map<string, string>).set('6', slotHex(7));
        await convert(created);
        expect(created.saved.get('Book/1 A scene.md')).toContain('Subplot: Romance');
        expect(created.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: slotHex(7) } });
        expect(created.getData().nodes?.[0].color).toBe(slotHex(7));
    });

    /** Card 1 was given the new subplot Letters on this Canvas; another Canvas gave Letters a card too, and another book has a Letters of its own. */
    function rememberLetters(test: ReturnType<typeof scenes>) {
        test.plugin.settings.canvasSubplotMemory = { schemaVersion: 1, canvases: {
            'Ideas.canvas': [
                { bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['1'], created: true },
                { bookId: 'other', subplot: 'Letters', color: '#abcdef', cards: ['2'], created: true },
            ],
            'Other.canvas': [{ bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['o1'], created: true }],
        } };
        colorCards(test, [{ color: '#abcdef', standing: { kind: 'pending', subplot: 'Letters' } }]);
        test.getData().nodes![1].color = '#abcdef';
        (Reflect.get(test.modal, 'given') as Map<string, string>).set('1', 'Letters');
        Reflect.set(test.modal, 'directory', [{ name: 'Main Plot', hex: slotHex(0), pending: false }, { name: 'Letters', hex: '#abcdef', pending: true }] satisfies DirectoryEntry[]);
        named(test).set('#abcdef\u0000letters', 'Letters');
    }

    it('creates a new subplot named from the card menu, forgets the cards that became its scenes, and counts it new nowhere', async () => {
        const test = scenes(['1']);
        rememberLetters(test);
        await convert(test);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Letters');
        expect(test.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Letters: '#abcdef' } });
        expect(test.plugin.settings.canvasSubplotMemory).toEqual({ schemaVersion: 1, canvases: {
            'Ideas.canvas': [{ bookId: 'other', subplot: 'Letters', color: '#abcdef', cards: ['2'], created: true }],
            // Letters has scenes now: renamed later, it never comes back as new.
            'Other.canvas': [{ bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['o1'] }],
        } });
    });

    it('forgets the cards it turned into sketches too', async () => {
        const test = scenes(['1']);
        rememberLetters(test);
        Reflect.set(test.modal, 'mode', 'sketches');
        await convert(test);
        expect(test.saved.size).toBe(1);
        expect((test.plugin.settings.canvasSubplotMemory as CanvasSubplotMemoryRecord).canvases['Ideas.canvas']).toEqual([
            { bookId: 'other', subplot: 'Letters', color: '#abcdef', cards: ['2'], created: true },
        ]);
    });

    it('keeps the cards’ memory when the Canvas cannot take the links, so nothing is forgotten for cards still there', async () => {
        const test = scenes(['1']);
        rememberLetters(test);
        const before = structuredClone(test.plugin.settings.canvasSubplotMemory);
        test.app.vault.create = vi.fn(async (path: string, text: string) => { test.saved.set(path, text); test.getData().extra = 'edited by author'; }) as typeof test.app.vault.create;
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await convert(test);
        expect(test.setData).not.toHaveBeenCalled();
        expect(test.plugin.settings.canvasSubplotMemory).toEqual(before);
        // The scene was written, so its new subplot keeps its color.
        expect(test.book.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Letters: '#abcdef' } });
        error.mockRestore();
    });

    it('counts the scenes created and opens the timeline when only the card memory cannot be saved', async () => {
        const test = scenes(['1']);
        rememberLetters(test);
        // The new subplot's color saves; the card memory after the links does not.
        vi.mocked(test.plugin.saveSettings).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk full'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await convert(test);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Letters');
        expect(test.getData().nodes?.[0]).toMatchObject({ type: 'file', file: 'Book/1 A scene.md' });
        expect(test.plugin.setActiveBookId).toHaveBeenCalledWith('book');
        expect(test.activateView).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('[Canvas subplots]'), expect.objectContaining({ message: 'Disk full' }));
        expect(error).not.toHaveBeenCalledWith('[Canvas sketches]', expect.anything());
        error.mockRestore();
    });

    it('writes the chosen book’s own main plot name, not the active book’s, into a scene of another book', async () => {
        // The active book calls its main plot Shail; the chosen book never renamed its own.
        syncMainPlotName({ books: [{ id: 'active', title: 'Active', sourceFolder: 'Active', mainPlotName: 'Shail' }], activeBookId: 'active', timelineScope: 'book' });
        try {
            const test = scenes(['1']);
            colorCards(test, [{ color: slotHex(0), standing: { kind: 'subplot', subplot: 'Shail' } }]);
            Reflect.set(test.modal, 'directory', [{ name: 'Shail', hex: slotHex(0), pending: false }] satisfies DirectoryEntry[]);
            named(test).set(slotHex(0), 'Shail');
            await convert(test);
            expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Main Plot');
            expect(test.saved.get('Book/1 A scene.md')).not.toContain('Shail');
        } finally {
            syncMainPlotName({ books: [], activeBookId: undefined, timelineScope: 'book' });
        }
    });

    it('puts cards on the subplot the card menu gave them, even when another subplot wears their color now', async () => {
        const test = scenes();
        // Both cards wear the second palette color. The menu gave card 1 Romance; Mara has since taken that color.
        colorCards(test, [{ color: slotHex(1), standing: { kind: 'subplot', subplot: 'Mara' } }, { color: slotHex(1), standing: { kind: 'subplot', subplot: 'Mara' } }]);
        (Reflect.get(test.modal, 'given') as Map<string, string>).set('1', 'Romance');
        Reflect.set(test.modal, 'directory', [
            { name: 'Main Plot', hex: slotHex(0), pending: false }, { name: 'Mara', hex: slotHex(1), pending: false }, { name: 'Romance', hex: slotHex(2), pending: false },
        ] satisfies DirectoryEntry[]);
        named(test).set(`${slotHex(1)}\u0000romance`, 'Romance').set(slotHex(1), 'Mara');
        // The book already has three Main Plot scenes, two of Mara and one of Romance.
        const scene = (subplot: string) => ({ kind: 'scene', subplots: [subplot] }) as unknown as TimetableRow;
        Reflect.set(test.modal, 'rows', [scene('Main Plot'), scene('Main Plot'), scene('Main Plot'), scene('Mara'), scene('Mara'), scene('Romance')]);
        await convert(test);
        expect(test.saved.get('Book/1 A scene.md')).toContain('Subplot: Romance');
        expect(test.saved.get('Book/2 Other idea.md')).toContain('Subplot: Mara');
        // Card 1 takes Romance's ring color; card 2 already wears Mara's.
        expect(test.getData().nodes?.map(node => node.color)).toEqual([slotHex(2), slotHex(1)]);
    });

    it('stays open while Create runs, whether Escape or the close button asks, then closes when done', () => {
        const test = scenes(['1']);
        const close = vi.spyOn(Modal.prototype, 'close');
        Reflect.set(test.modal, 'busy', true);
        test.modal.close();
        expect(close).not.toHaveBeenCalled();
        Reflect.set(test.modal, 'busy', false);
        test.modal.close();
        expect(close).toHaveBeenCalledOnce();
        close.mockRestore();
    });

    it('keeps the book chosen when Create was clicked, whatever the dialog shows after', async () => {
        const test = scenes(['1']);
        const other = { id: 'other', title: 'Other', sourceFolder: 'Other' } as BookProfile;
        const running = convert(test);
        Reflect.set(test.modal, 'book', other);
        await running;
        expect([...test.saved.keys()]).toEqual(['Book/1 A scene.md']);
        expect(test.plugin.setActiveBookId).toHaveBeenCalledWith('book');
    });

    it('stops when a selected card changed color after the dialog opened', async () => {
        const test = scenes(['1']);
        test.getData().nodes![0].color = '4';
        await convert(test);
        expect(test.saved.size).toBe(0);
        expect(test.setData).not.toHaveBeenCalled();
    });

    it('sets a preset card to the fixed color of its subplot even when the theme shows that color now', async () => {
        const test = scenes(['1']);
        // Preset 2 happens to show the main plot's color in this theme.
        colorCards(test, [{ color: '2', hex: slotHex(0), standing: { kind: 'subplot', subplot: 'Main Plot' } }]);
        Reflect.set(test.modal, 'directory', [{ name: 'Main Plot', hex: slotHex(0), pending: false }] satisfies DirectoryEntry[]);
        named(test).set('2', 'Main Plot');
        await convert(test);
        expect(test.getData().nodes?.[0].color).toBe(slotHex(0));
    });

    it('opens the timeline only once Obsidian has read every new scene, so it draws once, complete', async () => {
        const read = scenes();
        await convert(read);
        expect(read.indexed).toHaveBeenCalledWith([...read.saved.keys()]);
        expect(read.saved.size).toBe(2);
        expect(read.indexed.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(read.plugin.refreshTimelineIfNeeded).mock.invocationCallOrder[0]);
        expect(read.activateView).toHaveBeenCalledOnce();

        // Obsidian is slow to read them: the book still becomes the active one, so opening the timeline later shows it.
        const unread = scenes();
        unread.indexed.mockResolvedValue(false);
        await convert(unread);
        expect(unread.saved.size).toBe(2);
        expect(unread.plugin.setActiveBookId).toHaveBeenCalledWith('book');
        expect(unread.plugin.refreshTimelineIfNeeded).not.toHaveBeenCalled();
        expect(unread.activateView).not.toHaveBeenCalled();
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

    it('writes selected sketches in the reviewed order at the end of the chosen act, placement in the sidecar only', async () => {
        const test = setup(false, ['1', '2']);
        (Reflect.get(test.modal, 'selected') as Set<string>).add('2');
        const cards = Reflect.get(test.modal, 'cards') as Array<{ id: string }>;
        cards.reverse();
        Reflect.set(test.modal, 'act', 2);
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.placements.get('Book/Other idea.md')).toEqual({ order: 10 });
        expect(test.placements.get('Book/A scene 2.md')).toEqual({ order: 20 });
        expect(test.saved.get('Book/Other idea.md')).toContain('Act: 2');
        for (const content of test.saved.values()) expect(content).not.toMatch(/Place after scene|Sketch order/i);
    });

    it('keeps sketches off subplots whatever color their card has', async () => {
        const test = setup();
        (Reflect.get(test.modal, 'cards') as Array<{ id: string; color?: string }>)[0].color = '1';
        test.getData().nodes![0].color = '1';
        (Reflect.get(test.modal, 'subplotByRow') as Map<string, string>).set('1', 'The Servant');
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
        expect(content).toContain('Act: 2');
        expect(content).not.toContain('Place after scene');
        expect(test.placements.get('Book/A scene 2.md')).toEqual({ after: 'scene_letter', order: 10 });
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

    function withUnrankedSketch(test: ReturnType<typeof setup>) {
        const file = new TFile('Book/Existing.md');
        const frontmatter: Record<string, unknown> = { Class: 'Sketch', Act: 1 };
        test.plugin.settings = { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] };
        test.app.vault.getAbstractFileByPath = path => path === file.path ? file : null;
        const processFrontMatter = vi.fn();
        test.app.fileManager = { processFrontMatter } as unknown as App['fileManager'];
        Reflect.set(test.modal, 'act', 1);
        Reflect.set(test.modal, 'bookItems', () => [{ row: { path: file.path, basename: file.basename, kind: 'sketch', act: 1 } as TimetableRow, frontmatter, placement: test.placements.get(file.path) }]);
        return { file, frontmatter, processFrontMatter };
    }

    it('gives an existing unranked sketch a position before the new cards, without touching its note', async () => {
        const test = setup();
        const { file, frontmatter, processFrontMatter } = withUnrankedSketch(test);
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.placements.get(file.path)).toEqual({ order: 10 });
        expect(test.placements.get('Book/A scene.md')).toEqual({ order: 20 });
        expect(frontmatter).toEqual({ Class: 'Sketch', Act: 1 });
        expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it('leaves every position as it was when creating the first note fails', async () => {
        const test = setup();
        const { file } = withUnrankedSketch(test);
        test.app.vault.create = vi.fn(async () => { throw new Error('Disk full'); });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.placements.get(file.path)).toBeUndefined();
        expect(test.setData).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('refuses to rank an older sketch that was placed meanwhile', async () => {
        const test = setup();
        const { file, frontmatter } = withUnrankedSketch(test);
        // The dialog read the book before another write placed the sketch.
        Reflect.set(test.modal, 'bookItems', () => [{ row: { path: file.path, basename: file.basename, kind: 'sketch', act: 1 } as TimetableRow, frontmatter }]);
        await test.placements.set([[file.path, { order: 99 }]]);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.placements.get(file.path)).toEqual({ order: 99 });
        expect(test.saved.size).toBe(0);
        error.mockRestore();
    });

    it('keeps existing ranks when some new sketches were created before a failure', async () => {
        const test = setup(false, ['1', '2']);
        const { file } = withUnrankedSketch(test);
        let created = 0;
        test.app.vault.create = vi.fn(async () => {
            if (++created === 2) throw new Error('Disk full');
            return new TFile('Book/A scene.md');
        });
        (Reflect.get(test.modal, 'selected') as Set<string>).add('2');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.placements.get(file.path)).toEqual({ order: 10 });
        expect(test.placements.get('Book/A scene.md')).toEqual({ order: 20 });
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

    const wheel = new Map<string, SubplotColor>([['Main Plot', { kind: 'slot', slot: 0 }], ['Mara', { kind: 'slot', slot: 1 }], ['Romance', { kind: 'slot', slot: 2 }]]);

    /** The dialog over a Canvas, in a window whose palette paints slot N as #0000NN and preset 6 as a yellow no ring wears. */
    function dialog() {
        const vars: Record<string, string> = { '--canvas-color-6': '#ffff00' };
        for (let slot = 0; slot < 16; slot++) vars[`--rt-subplot-colors-${slot}`] = slotHex(slot);
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => vars[name] ?? '' }));
        let fill = '#000000';
        const context = { get fillStyle() { return fill; }, set fillStyle(value: string) { if (/^#[0-9a-f]{6}$/i.test(value)) fill = value.toLowerCase(); } };
        const doc = { win: { createEl: () => ({ getContext: () => context }) }, documentElement: {}, body: {} } as unknown as Document; // SAFE: the color readers touch only these members
        const data: StoryCanvasData = { nodes: [
            { id: 'mara', type: 'text', text: 'Mara leaves', color: slotHex(1) },
            { id: 'romance', type: 'text', text: 'A first dance', color: slotHex(1) },
            { id: 'letters', type: 'text', text: 'A letter', color: '#ABCDEF' },
            { id: 'letters copy', type: 'text', text: 'A second letter', color: '#abcdef' },
            { id: 'courtship', type: 'text', text: 'A walk', color: slotHex(4) },
            { id: 'yellow', type: 'text', text: 'Storm', color: '6' },
            { id: 'free', type: 'text', text: 'Market day', color: slotHex(5) },
        ] };
        const app = { workspace: { getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => ({}) }, vault: { getMarkdownFiles: () => [], getFiles: () => [] } } as unknown as App;
        const book = { id: 'book', title: 'Book', sourceFolder: 'Book' } as BookProfile;
        // The card menu gave "romance" Romance while Romance wore the second palette color, then gave "mara"
        // Mara, which wears it now; it named the new subplot Letters for "letters" ("letters copy" is a copy);
        // and it gave "courtship" Courtship, a subplot since renamed.
        const plugin = { settings: { ...DEFAULT_SETTINGS, books: [book], canvasSubplotMemory: { schemaVersion: 1, canvases: {
            'Ideas.canvas': [
                { bookId: 'book', subplot: 'Romance', color: slotHex(1), cards: ['romance'] },
                { bookId: 'book', subplot: 'Mara', color: slotHex(1), cards: ['mara'] },
                { bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['letters'], created: true },
                { bookId: 'book', subplot: 'Courtship', color: slotHex(4), cards: ['courtship'] },
            ],
        } } } } as unknown as RadialTimelinePlugin;
        const canvas: OpenCanvas = { getData: () => data, setData: vi.fn(), requestSave: vi.fn(), selection: new Set(data.nodes!.map(node => ({ getData: () => ({ id: node.id, type: 'text' }) }))) };
        const modal = new CanvasConvertModal(app, plugin, canvas, 'Ideas.canvas', [book], book, () => true);
        Reflect.set(modal, 'containerEl', { doc });
        Reflect.set(modal, 'bookItems', () => []);
        Reflect.set(modal, 'readWheel', async () => wheel);
        return { modal, book };
    }

    it('starts each row on the subplot the card menu gave its cards, then on the subplot wearing its color; a color with no subplot waits', async () => {
        const { modal } = dialog();
        await Reflect.get(modal, 'loadRings').call(modal);
        expect(Reflect.get(modal, 'directory')).toEqual([
            { name: 'Main Plot', hex: slotHex(0), pending: false },
            { name: 'Mara', hex: slotHex(1), pending: false },
            { name: 'Romance', hex: slotHex(2), pending: false },
            { name: 'Letters', hex: '#abcdef', pending: true },
        ]);
        const maraRow = `${slotHex(1)}\u0000mara`;
        const romanceRow = `${slotHex(1)}\u0000romance`;
        const lettersRow = '#abcdef\u0000letters';
        expect([...(Reflect.get(modal, 'subplotByRow') as Map<string, string>)]).toEqual([[maraRow, 'Mara'], [romanceRow, 'Romance'], [lettersRow, 'Letters']]);
        const plans = Reflect.get(modal, 'colorPlans').call(modal) as Map<string, unknown>;
        expect([...plans]).toEqual([
            [maraRow, { kind: 'existing', subplot: 'Mara' }],
            [romanceRow, { kind: 'existing', subplot: 'Romance' }],
            // The copy joins the card it was copied from.
            [lettersRow, { kind: 'new', subplot: 'Letters', color: '#abcdef' }],
            // Courtship was renamed: its card is matched by color, which names no subplot, so it waits.
            [slotHex(4), { kind: 'unassigned' }],
            // Preset 6 is no timeline color; the sixth palette color is free, but names no subplot either.
            ['6', { kind: 'unassigned' }],
            [slotHex(5), { kind: 'unassigned' }],
        ]);
        const rows = Reflect.get(modal, 'colorRows').call(modal, Reflect.get(modal, 'cards')) as Map<string, { count: number }>;
        expect(rows.get(lettersRow)?.count).toBe(2);
        expect(Reflect.get(modal, 'ringsBook')).toBe('book');
    });

    it('applies only the latest read when the book changes and changes back, keeping names typed since', async () => {
        const { modal, book } = dialog();
        const other = { id: 'other', title: 'Other', sourceFolder: 'Other' } as BookProfile;
        const reads: Array<() => void> = [];
        Reflect.set(modal, 'readWheel', () => new Promise<Map<string, SubplotColor>>(resolve => reads.push(() => resolve(wheel))));
        const load = Reflect.get(modal, 'loadRings') as () => Promise<void>;
        const first = load.call(modal);
        Reflect.set(modal, 'book', other);
        const second = load.call(modal);
        Reflect.set(modal, 'book', book);
        const third = load.call(modal);
        reads[2]();
        await third;
        (Reflect.get(modal, 'subplotByRow') as Map<string, string>).set(slotHex(5), 'Market');
        reads[0]();
        reads[1]();
        await Promise.all([first, second]);
        expect((Reflect.get(modal, 'subplotByRow') as Map<string, string>).get(slotHex(5))).toBe('Market');
        expect(Reflect.get(modal, 'ringsBook')).toBe('book');
    });
});
