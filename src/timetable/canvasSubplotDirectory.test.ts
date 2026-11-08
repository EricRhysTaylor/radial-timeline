import { describe, expect, it } from 'vitest';
import { cardColorStanding, cardMeaning, directoryEntryNamed, paletteChoices, subplotDirectory, subplotMenuModel } from './canvasSubplotDirectory';

const rings = [
    { name: 'Main Plot', hex: '#000001' },
    { name: 'Mara', hex: '#000002' },
    { name: 'Romance', hex: '#e93147' },
];

describe('The subplot directory for Canvas card colors', () => {
    it('lists the book’s subplots in ring order, then its new subplots', () => {
        const waiting = [{ name: 'Letters', color: '#abcdef' }, { name: 'Storm', color: '#123456' }];
        expect(subplotDirectory(rings, waiting)).toEqual([
            { name: 'Main Plot', hex: '#000001', pending: false },
            { name: 'Mara', hex: '#000002', pending: false },
            { name: 'Romance', hex: '#e93147', pending: false },
            { name: 'Letters', hex: '#abcdef', pending: true },
            { name: 'Storm', hex: '#123456', pending: true },
        ]);
    });

    it('lists a new subplot no longer once the book has a subplot of that name', () => {
        expect(subplotDirectory(rings, [{ name: 'mara', color: '#abcdef' }]).map(entry => entry.name)).toEqual(['Main Plot', 'Mara', 'Romance']);
    });

    it('finds a subplot by name in any case, in its own spelling', () => {
        const directory = subplotDirectory(rings, []);
        expect(directoryEntryNamed(directory, ' romance ')?.name).toBe('Romance');
        expect(directoryEntryNamed(directory, 'Letters')).toBeNull();
    });
});

describe('The palette a new subplot chooses from', () => {
    const palette = ['#000001', '#000002', '#000003', '#e93147', '#000005'];
    it('offers the colors no subplot wears first, then the ones in use with the subplots wearing them', () => {
        const directory = [...subplotDirectory(rings, []), { name: 'Letters', hex: '#000005', pending: true }];
        expect(paletteChoices(palette, directory)).toEqual([
            { slot: 2, hex: '#000003', usedBy: [] },
            { slot: 0, hex: '#000001', usedBy: ['Main Plot'] },
            { slot: 1, hex: '#000002', usedBy: ['Mara'] },
            // A subplot with its own color uses the palette color it equals.
            { slot: 3, hex: '#e93147', usedBy: ['Romance'] },
            { slot: 4, hex: '#000005', usedBy: ['Letters'] },
        ]);
    });
    it('marks a color worn by two subplots with both', () => {
        expect(paletteChoices(['#000001'], [{ name: 'A', hex: '#000001' }, { name: 'B', hex: '#000001' }])).toEqual([{ slot: 0, hex: '#000001', usedBy: ['A', 'B'] }]);
    });
});

describe('What a card color means on the timeline', () => {
    const directory = [...subplotDirectory(rings, []), { name: 'Letters', hex: '#abcdef', pending: true }];
    const palette = ['#000001', '#000002', '#000003'];
    it('names the subplot, or the new subplot, that wears exactly that color', () => {
        expect(cardColorStanding('#000002', directory, palette)).toEqual({ kind: 'subplot', subplot: 'Mara' });
        expect(cardColorStanding('#e93147', directory, palette)).toEqual({ kind: 'subplot', subplot: 'Romance' });
        expect(cardColorStanding('#abcdef', directory, palette)).toEqual({ kind: 'pending', subplot: 'Letters' });
    });
    it('knows a free palette color from a color outside the timeline’s colors', () => {
        expect(cardColorStanding('#000003', directory, palette)).toEqual({ kind: 'palette' });
        expect(cardColorStanding('#ffff00', directory, palette)).toEqual({ kind: 'outside' });
        expect(cardColorStanding(null, directory, palette)).toEqual({ kind: 'outside' });
    });
    it('takes the subplot the card menu gave a card over whichever subplot wears its color now', () => {
        expect(cardMeaning('Romance', '#000002', directory)).toBe('Romance');
        expect(cardMeaning(null, '#000002', directory)).toBe('Mara');
        expect(cardMeaning(null, '#000003', directory)).toBeNull();
        expect(cardMeaning(null, null, directory)).toBeNull();
    });
});

describe('The Canvas card menu', () => {
    const directory = subplotDirectory(rings, [{ name: 'Letters', color: '#abcdef' }]);
    it('says it is still reading the book’s subplots rather than guess', () => {
        expect(subplotMenuModel(null, ['Mara'])).toEqual({ kind: 'reading' });
    });
    it('checks the subplot every card stands for, and none when the cards differ', () => {
        const same = subplotMenuModel(directory, ['Mara', 'mara']);
        expect(same.kind === 'ready' && same.entries.filter(entry => entry.checked).map(entry => entry.name)).toEqual(['Mara']);
        const mixed = subplotMenuModel(directory, ['Mara', null]);
        expect(mixed.kind === 'ready' && mixed.entries.some(entry => entry.checked)).toBe(false);
        const ready = subplotMenuModel(directory, []);
        expect(ready.kind === 'ready' && ready.entries.map(entry => [entry.name, entry.pending])).toEqual([
            ['Main Plot', false], ['Mara', false], ['Romance', false], ['Letters', true],
        ]);
    });
});
