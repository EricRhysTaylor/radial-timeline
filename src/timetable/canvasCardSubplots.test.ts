import { describe, expect, it } from 'vitest';
import { cardSubplots } from './canvasCardSubplots';

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
