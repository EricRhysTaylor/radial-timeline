import { describe, expect, it } from 'vitest';
import { cardColor, cardColorCounts, cardColorCss, cardColorHex, cardSubplots, planCardColorSubplots, plansWaitOnAuthor, subplotForColor } from './canvasCardSubplots';
import type { CardColorStanding } from './canvasSubplotDirectory';

describe('Canvas card colors', () => {
    it('reads presets and hex values, and treats a missing color as none', () => {
        expect(cardColor({ color: '4' })).toBe('4');
        expect(cardColor({ color: ' #AA00FF ' })).toBe('#aa00ff');
        expect(cardColor({})).toBeNull();
        expect(cardColor({ color: '' })).toBeNull();
    });
    it('counts each color once, in the order the cards show them', () => {
        expect([...cardColorCounts([{ color: '2' }, {}, { color: '#FF0000' }, { color: '2' }, { color: '#ff0000' }])])
            .toEqual([['2', 2], ['#ff0000', 2]]);
    });
    it('draws a preset from the theme and a custom color as it stands', () => {
        expect(cardColorCss('3')).toBe('var(--canvas-color-3)');
        expect(cardColorCss('#aa00ff')).toBe('#aa00ff');
    });
    it('keeps a custom color as the fixed hex a new subplot stores', () => {
        const doc = {} as Document; // SAFE: a custom color never reads the document; only presets do
        expect(cardColorHex(doc, '#aa00ff')).toBe('#aa00ff');
        expect(cardColorHex(doc, '#a0f')).toBe('#aa00ff');
        expect(cardColorHex(doc, 'not a color')).toBeNull();
    });
});

describe('The subplot a card color stands for', () => {
    const rings = [{ name: 'Main Plot', color: '#efbdeb' }, { name: 'Mara', color: '#a35ca7' }];
    it('follows linked cards of that color on the Canvas', () => {
        expect(subplotForColor('1', '#e93147', [{ color: '1', subplots: ['Mara'] }, { color: '2', subplots: ['Main Plot'] }], rings)).toBe('Mara');
    });
    it('takes the one subplot linked cards share', () => {
        expect(subplotForColor('1', '#e93147', [{ color: '1', subplots: ['Mara', 'Main Plot'] }, { color: '1', subplots: ['Mara'] }], rings)).toBe('Mara');
    });
    it('stays unassigned when linked cards disagree or one card sits on two rings', () => {
        expect(subplotForColor('1', '#e93147', [{ color: '1', subplots: ['Mara'] }, { color: '1', subplots: ['Main Plot'] }], rings)).toBeNull();
        expect(subplotForColor('1', '#e93147', [{ color: '1', subplots: ['Mara', 'Main Plot'] }], rings)).toBeNull();
    });
    it('matches a ring painted in exactly that color', () => {
        expect(subplotForColor('#a35ca7', '#a35ca7', [], rings)).toBe('Mara');
    });
    it('matches a preset by the color the theme paints it, so a subplot made from it is found again', () => {
        expect(subplotForColor('2', '#a35ca7', [], rings)).toBe('Mara');
    });
    it('prefers what the Canvas already says over a matching ring', () => {
        expect(subplotForColor('#a35ca7', '#a35ca7', [{ color: '#a35ca7', subplots: ['Main Plot'] }], rings)).toBe('Main Plot');
    });
    it('starts a color on the new subplot waiting on the Canvas that wears it', () => {
        // The directory lists the book's subplots first, then the new ones waiting.
        expect(subplotForColor('#123456', '#123456', [], [...rings, { name: 'Letters', color: '#123456' }])).toBe('Letters');
    });
    it('leaves an unknown color unassigned', () => {
        expect(subplotForColor('3', '#ffff00', [], rings)).toBeNull();
        expect(subplotForColor('3', null, [], rings)).toBeNull();
    });
});

describe('Canvas subplot appearances', () => {
    const card = { x: 50, y: 150, width: 100, height: 100 };
    const groups = [
        { label: 'Main Plot', x: 0, y: 0, width: 300, height: 100 },
        { label: 'Mara', x: 0, y: 120, width: 300, height: 160 },
    ];
    it('uses the containing subplot lane for a repeated scene', () => {
        expect(cardSubplots(card, groups, ['Main Plot', 'Mara'])).toEqual(['Mara']);
    });
    it('keeps all memberships in a combined story or unrelated group', () => {
        expect(cardSubplots(card, [{ ...groups[1], label: 'Story' }], ['Main Plot', 'Mara'])).toEqual(['Main Plot', 'Mara']);
    });
    it('does not infer a lane from incomplete geometry', () => {
        expect(cardSubplots({ x: 1 }, groups, ['Main Plot', 'Mara'])).toEqual(['Main Plot', 'Mara']);
    });
});

describe('Choosing a color once: which subplot each card color makes', () => {
    const book = new Map([['the servant', 'The Servant'], ['main plot', 'Main Plot']]);
    const existing = (name: string) => book.get(name.toLowerCase()) ?? null;
    const waiting = new Map([['letters', { name: 'Letters', hex: '#123456' }]]);
    const pending = (name: string) => waiting.get(name.toLowerCase()) ?? null;
    const palette: CardColorStanding = { kind: 'palette' };
    const outside: CardColorStanding = { kind: 'outside' };
    type Row = { color: string; name: string; hex?: string | null; standing?: CardColorStanding; palette?: string };
    const plan = (...rows: Row[]) => [...planCardColorSubplots(rows.map(row => ({ hex: row.color, standing: palette, ...row })), existing, pending)];

    it('makes a new subplot from a new name on a free palette color, which it wears', () => {
        expect(plan({ color: '#aa00ff', name: ' Romance ' })).toEqual([['#aa00ff', { kind: 'new', subplot: 'Romance', color: '#aa00ff' }]]);
    });
    it('keeps an existing subplot, in the book’s spelling, on the color it already wears', () => {
        expect(plan({ color: '1', name: 'the SERVANT', hex: '#e93147', standing: outside })).toEqual([['1', { kind: 'existing', subplot: 'The Servant' }]]);
        expect(plan({ color: '2', name: 'Main Plot', hex: '#00ff00' })).toEqual([['2', { kind: 'existing', subplot: 'Main Plot' }]]);
    });
    it('sends a timeline color with no name to the main plot', () => {
        expect(plan({ color: '#bbbbbb', name: '  ' })).toEqual([['#bbbbbb', { kind: 'mainPlot' }]]);
        expect(plan({ color: '#a35ca7', name: '', standing: { kind: 'subplot', subplot: 'Mara' } })).toEqual([['#a35ca7', { kind: 'mainPlot' }]]);
    });
    it('holds a color outside the timeline’s colors until it has a subplot', () => {
        expect(plan({ color: '3', name: '', hex: '#ffff00', standing: outside })).toEqual([['3', { kind: 'unassigned' }]]);
        expect(plan({ color: '3', name: 'Romance', hex: '#ffff00', standing: outside })).toEqual([['3', { kind: 'needsColor', subplot: 'Romance' }]]);
        expect(plan({ color: '3', name: 'Romance', hex: null, standing: outside })).toEqual([['3', { kind: 'needsColor', subplot: 'Romance' }]]);
        expect(plan({ color: '3', name: 'Romance', hex: '#ffff00', standing: outside, palette: '#314cb6' }))
            .toEqual([['3', { kind: 'new', subplot: 'Romance', color: '#314cb6' }]]);
        expect(plansWaitOnAuthor(new Map(plan({ color: '3', name: '', hex: '#ffff00', standing: outside })))).toBe(true);
        expect(plansWaitOnAuthor(new Map(plan({ color: '3', name: 'The Servant', hex: '#ffff00', standing: outside })))).toBe(false);
    });
    it('never lets a new name take a color another subplot wears', () => {
        expect(plan({ color: '#a35ca7', name: 'Romance', standing: { kind: 'subplot', subplot: 'Mara' } }))
            .toEqual([['#a35ca7', { kind: 'needsColor', subplot: 'Romance' }]]);
        expect(plan({ color: '#123456', name: 'Romance', standing: { kind: 'pending', subplot: 'Letters' } }))
            .toEqual([['#123456', { kind: 'needsColor', subplot: 'Romance' }]]);
    });
    it('gives a new subplot remembered on the Canvas its own name and color', () => {
        expect(plan({ color: '#123456', name: 'Letters', standing: { kind: 'pending', subplot: 'Letters' } }))
            .toEqual([['#123456', { kind: 'new', subplot: 'Letters', color: '#123456' }]]);
        // Another color named for it joins it, and its cards take its color.
        expect(plan({ color: '7', name: 'LETTERS', hex: '#ffff00', standing: outside }))
            .toEqual([['7', { kind: 'new', subplot: 'Letters', color: '#123456' }]]);
    });
    it('gives a new name two colors share the first color that can give it one, in the first spelling', () => {
        expect(plan({ color: '#aa00ff', name: 'Romance' }, { color: '4', name: 'romance', hex: '#bbbbbb' })).toEqual([
            ['#aa00ff', { kind: 'new', subplot: 'Romance', color: '#aa00ff' }],
            ['4', { kind: 'sharesNew', subplot: 'Romance', color: '#aa00ff' }],
        ]);
        expect(plan({ color: '3', name: 'Romance', hex: '#ffff00', standing: outside }, { color: '#aa00ff', name: 'romance' })).toEqual([
            ['3', { kind: 'sharesNew', subplot: 'Romance', color: '#aa00ff' }],
            ['#aa00ff', { kind: 'new', subplot: 'Romance', color: '#aa00ff' }],
        ]);
    });
});
