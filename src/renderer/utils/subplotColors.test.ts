import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BookProfile } from '../../types/settings';
import {
    assignSubplotColors,
    bookOwnSubplotColors,
    normalizeSubplotColorIndex,
    readSubplotColor,
    readSubplotColorValue,
    sharedOwnSubplotColors,
    SUBPLOT_COLOR_SLOTS,
    subplotColorCss,
    subplotColorOn,
    subplotsWearingColor,
    syncSubplotPalette,
    timelineOwnSubplotColors,
} from './subplotColors';
import { syncMainPlotName } from '../../utils/mainPlot';

function stubComputedStyle(vars: Record<string, string>): void {
    vi.stubGlobal('getComputedStyle', () => ({
        getPropertyValue: (name: string) => vars[name] ?? ''
    }));
}

const doc = { documentElement: {} } as unknown as Document; // SAFE: readSubplotColor only hands documentElement to getComputedStyle, which is stubbed

describe('normalizeSubplotColorIndex', () => {
    it('wraps onto the slot count in both directions and truncates fractions', () => {
        expect(normalizeSubplotColorIndex(0)).toBe(0);
        expect(normalizeSubplotColorIndex(SUBPLOT_COLOR_SLOTS)).toBe(0);
        expect(normalizeSubplotColorIndex(SUBPLOT_COLOR_SLOTS + 3)).toBe(3);
        expect(normalizeSubplotColorIndex(-1)).toBe(SUBPLOT_COLOR_SLOTS - 1);
        expect(normalizeSubplotColorIndex(5.9)).toBe(5);
    });

    it('lands non-finite input on slot 0', () => {
        expect(normalizeSubplotColorIndex(Number.NaN)).toBe(0);
        expect(normalizeSubplotColorIndex(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('readSubplotColor', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads the slot variable from the document', () => {
        stubComputedStyle({ '--rt-subplot-colors-2': ' #123456 ' });
        expect(readSubplotColor(doc, 2)).toBe('#123456');
        expect(readSubplotColor(doc, 2 + SUBPLOT_COLOR_SLOTS)).toBe('#123456');
    });

    it('throws instead of substituting a colour when the variable is missing', () => {
        stubComputedStyle({});
        expect(() => readSubplotColor(doc, 4)).toThrow(/--rt-subplot-colors-4/);
    });
});

describe('the one subplot color rule', () => {
    afterEach(() => vi.unstubAllGlobals());
    const own = new Map([['Romance', '#e93147']]);

    it('gives a subplot with its own color that color, and the palette slots to the rest in ring order', () => {
        expect([...assignSubplotColors(['Main Plot', 'Romance', 'Family', 'Letters'], own)]).toEqual([
            ['Main Plot', { kind: 'slot', slot: 0 }],
            ['Romance', { kind: 'own', color: '#e93147' }],
            ['Family', { kind: 'slot', slot: 1 }],
            ['Letters', { kind: 'slot', slot: 2 }],
        ]);
    });

    it('never moves another subplot off its slot when a subplot gains its own color', () => {
        const before = assignSubplotColors(['Main Plot', 'Family'], new Map());
        const after = assignSubplotColors(['Main Plot', 'Romance', 'Family'], own);
        expect(after.get('Family')).toEqual(before.get('Family'));
    });

    it('never gives the main plot of the rings drawn now an own color, whatever a book calls its subplots', () => {
        // A saga whose books name their main plots differently draws ring 1 as "Main Plot"; a book's own subplot of that name keeps no color there.
        const sagaBooks = [
            { id: 'a', title: 'A', sourceFolder: 'A', mainPlotName: 'Shail', ownSubplotColors: { schemaVersion: 1 as const, colors: { 'Main Plot': '#123456', Romance: '#e93147' } } },
            { id: 'b', title: 'B', sourceFolder: 'B' },
        ];
        const settings = { books: sagaBooks, activeBookId: 'a', timelineScope: 'saga' as const };
        syncMainPlotName(settings);
        try {
            const colors = assignSubplotColors(['Main Plot', 'Romance', 'Shail'], timelineOwnSubplotColors(settings));
            expect(colors.get('Main Plot')).toEqual({ kind: 'slot', slot: 0 });
            expect(colors.get('Romance')).toEqual({ kind: 'own', color: '#e93147' });
        } finally {
            syncMainPlotName({ books: [], activeBookId: undefined, timelineScope: 'book' });
        }
    });

    describe('with the palette in view', () => {
        // Palette slot N paints #0000NN (1-based).
        const palette = Array.from({ length: SUBPLOT_COLOR_SLOTS }, (_, slot) => `#${String(slot + 1).padStart(6, '0')}`);
        afterEach(() => syncSubplotPalette([]));

        it('never gives a ring a palette color another subplot wears as its own (the live test’s rename)', () => {
            syncSubplotPalette(palette);
            // The Captain wears the fifth palette color as its own. After "The Assassin" became "The Killer"
            // in the scenes, The Killer and The Monk wear slots; The Monk would have landed on the fifth.
            const own = new Map([['The Assassin', '#ff8600'], ['The Captain', '#000005'], ['The Handmaid', '#f9e784'], ['The Prince', '#2ec4b6']]);
            const colors = assignSubplotColors(['Main Plot', 'The Captain', 'The Handmaid', 'The Prince', 'The Queen', 'The Jester', 'The Killer', 'The Monk'], own);
            expect([...colors].filter(([, color]) => color.kind === 'slot')).toEqual([
                ['Main Plot', { kind: 'slot', slot: 0 }],
                ['The Queen', { kind: 'slot', slot: 1 }],
                ['The Jester', { kind: 'slot', slot: 2 }],
                ['The Killer', { kind: 'slot', slot: 3 }],
                // Not slot 4, The Captain's color.
                ['The Monk', { kind: 'slot', slot: 5 }],
            ]);
            const worn = [...colors.values()].map(color => color.kind === 'own' ? color.color : palette[color.slot]);
            expect(new Set(worn).size).toBe(worn.length);
        });

        it('lets an own color kept for a subplot with no scenes hold nothing', () => {
            syncSubplotPalette(palette);
            // "The Assassin" was renamed in its scenes' properties; its color is still stored under the old name.
            const colors = assignSubplotColors(['Main Plot', 'The Killer', 'The Monk'], new Map([['The Assassin', '#000002']]));
            expect(colors.get('The Killer')).toEqual({ kind: 'slot', slot: 1 });
            expect(colors.get('The Monk')).toEqual({ kind: 'slot', slot: 2 });
        });

        it('keeps the first slot for the main plot, and wraps over the free colors past them', () => {
            syncSubplotPalette(palette);
            const own = new Map([['Romance', '#000001'], ['Letters', '#000003']]);
            const order = ['Main Plot', 'Romance', 'Letters', ...Array.from({ length: 15 }, (_, index) => `Ring ${index}`)];
            const colors = assignSubplotColors(order, own);
            expect(colors.get('Main Plot')).toEqual({ kind: 'slot', slot: 0 });
            expect(colors.get('Ring 0')).toEqual({ kind: 'slot', slot: 1 });
            expect(colors.get('Ring 1')).toEqual({ kind: 'slot', slot: 3 });
            // Fourteen free slots (1, 3 to 15): the fifteenth ring wraps, still skipping the worn color.
            expect(colors.get('Ring 14')).toEqual({ kind: 'slot', slot: 1 });
        });

        it('names the subplots an own color matches: another own color, or the main plot’s first palette color', () => {
            syncSubplotPalette(palette);
            // Romance was given the first palette color, and Letters and Storm the same color, in Settings.
            const own = new Map([['Romance', '#000001'], ['Letters', '#abcdef'], ['Storm', '#abcdef']]);
            const colors = assignSubplotColors(['Main Plot', 'Romance', 'Letters', 'Storm', 'Mara'], own);
            expect(subplotsWearingColor(colors, '#000001', 'Romance')).toEqual(['Main Plot']);
            expect(subplotsWearingColor(colors, '#ABCDEF', 'Letters')).toEqual(['Storm']);
            // A ring on a palette slot is matched by its slot's color.
            expect(subplotsWearingColor(colors, '#000002', 'Romance')).toEqual(['Mara']);
            expect(subplotsWearingColor(colors, '#123456', 'Romance')).toEqual([]);
            expect(subplotsWearingColor(colors, 'red', 'Romance')).toEqual([]);
        });
    });

    it('wraps the palette after sixteen slot-colored rings', () => {
        const order = Array.from({ length: 18 }, (_, i) => `Ring ${i}`);
        expect(assignSubplotColors(order, new Map()).get('Ring 17')).toEqual({ kind: 'slot', slot: 1 });
    });

    it('paints an own color as it stands and a slot from its live palette variable', () => {
        expect(subplotColorCss({ kind: 'own', color: '#e93147' })).toBe('#e93147');
        expect(subplotColorCss({ kind: 'slot', slot: 3 })).toBe('var(--rt-subplot-colors-3)');
        stubComputedStyle({ '--rt-subplot-colors-3': '#314cb6' });
        expect(readSubplotColorValue(doc, { kind: 'slot', slot: 3 })).toBe('#314cb6');
        expect(readSubplotColorValue(doc, { kind: 'own', color: '#e93147' })).toBe('#e93147');
    });

    it('paints a scene with no subplot, or a name the rings lack, as the main plot', () => {
        const colors = assignSubplotColors(['Main Plot', 'Romance'], own);
        expect(subplotColorOn(colors, undefined)).toEqual({ kind: 'slot', slot: 0 });
        expect(subplotColorOn(colors, '  ')).toEqual({ kind: 'slot', slot: 0 });
        expect(subplotColorOn(colors, 'Backdrop')).toEqual({ kind: 'slot', slot: 0 });
        expect(subplotColorOn(colors, 'Romance')).toEqual({ kind: 'own', color: '#e93147' });
    });
});

describe('which own colors a set of rings uses', () => {
    const book = (id: string, colors: Record<string, string>, mainPlotName?: string): BookProfile =>
        ({ id, title: id, sourceFolder: id, mainPlotName, ownSubplotColors: { schemaVersion: 1, colors } });

    it('reads a book’s own colors, never one for its main plot', () => {
        expect([...bookOwnSubplotColors(book('a', { Romance: '#e93147', Shail: '#123456' }, 'Shail'))]).toEqual([['Romance', '#e93147']]);
        expect(bookOwnSubplotColors(undefined).size).toBe(0);
    });

    it('keeps a color several books agree on, and leaves a disputed one on its palette slot', () => {
        const shared = sharedOwnSubplotColors([
            book('a', { Romance: '#e93147', Letters: '#00ff00' }),
            book('b', { Romance: '#e93147', Letters: '#0000ff' }),
            book('c', { Letters: '#00ff00' }),
        ]);
        expect([...shared]).toEqual([['Romance', '#e93147']]);
    });

    it('follows the timeline’s scope: the active book, or the saga’s shared colors', () => {
        const books = [book('a', { Romance: '#e93147' }), book('b', { Family: '#00ff00' })];
        expect([...timelineOwnSubplotColors({ books, activeBookId: 'b', timelineScope: 'book' })]).toEqual([['Family', '#00ff00']]);
        expect([...timelineOwnSubplotColors({ books, activeBookId: 'b', timelineScope: 'saga' })]).toEqual([['Romance', '#e93147'], ['Family', '#00ff00']]);
    });
});

describe('subplot color source guard', () => {
    const strip = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const sources = (dir: string): string[] => readdirSync(resolve(process.cwd(), dir), { recursive: true, encoding: 'utf8' })
        .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map(file => `${dir}/${file}`);
    const files = sources('src');

    it('reads palette slots only through the resolver; the rest of the slot users color the category lens, not subplots', () => {
        const lens = ['src/view/TimeLineView.ts', 'src/view/interactions/TimetableLink.ts', 'src/chronologue/timeReferences/interactions.ts', 'src/services/ThemeService.ts'];
        const slotUsers = files.filter(file => strip(file).includes('rt-subplot-colors-${'));
        expect(slotUsers.sort()).toEqual(['src/renderer/utils/subplotColors.ts', ...lens].sort());
        const directReads = files.filter(file => file !== 'src/renderer/utils/subplotColors.ts' && /\breadSubplotColor\(/.test(strip(file)));
        // The Timetable's color lens picks distinct palette colors for categories.
        expect(directReads).toEqual(['src/timetable/TimetableView.ts']);
    });

    it('carries a subplot’s color in the rendered timeline, never a slot index readers would resolve again', () => {
        expect(files.filter(file => /data-subplot-color-index|data-color-index|data-subplot-idx|colorIndexBySubplot/.test(strip(file)))).toEqual([]);
    });
});
