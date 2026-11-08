import { describe, expect, it } from 'vitest';
import { cardColor, cardColorCounts, cardColorCss, cardColorHex, cardSubplots, planCardColorSubplots, subplotForColor } from './canvasCardSubplots';

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
    const plan = (...rows: Array<[string, string]>) => [...planCardColorSubplots(rows.map(([color, name]) => ({ color, name })), existing)];

    it('makes a new subplot from a new name; its ring will wear that card color', () => {
        expect(plan(['#aa00ff', ' Romance '])).toEqual([['#aa00ff', { kind: 'new', subplot: 'Romance' }]]);
    });
    it('keeps an existing subplot, in the book’s spelling, on the color it already wears', () => {
        expect(plan(['1', 'the SERVANT'])).toEqual([['1', { kind: 'existing', subplot: 'The Servant' }]]);
        expect(plan(['2', 'Main Plot'])).toEqual([['2', { kind: 'existing', subplot: 'Main Plot' }]]);
    });
    it('sends a color with no name to the main plot', () => {
        expect(plan(['3', '  '])).toEqual([['3', { kind: 'mainPlot' }]]);
    });
    it('gives a new name two colors share the first color that names it, in that spelling', () => {
        expect(plan(['#aa00ff', 'Romance'], ['4', 'romance'])).toEqual([
            ['#aa00ff', { kind: 'new', subplot: 'Romance' }],
            ['4', { kind: 'sharesNew', subplot: 'Romance', color: '#aa00ff' }],
        ]);
    });
});
