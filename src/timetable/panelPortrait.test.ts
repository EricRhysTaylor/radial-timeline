import { describe, expect, it } from 'vitest';
import { selectedPortrait } from './panelPortrait';

describe('panel character portrait', () => {
    it('uses the first character’s portrait', () => {
        expect(selectedPortrait([{ image: 'lead.png' }, { image: 'other.png' }], -1)).toBe('lead.png');
    });

    it('does not substitute a later character when the first character portrait is missing', () => {
        expect(selectedPortrait([{ image: null }, { image: 'other.png' }], 0)).toBeNull();
    });

    it('has no portrait when no character is listed', () => {
        expect(selectedPortrait([], -1)).toBeNull();
    });

    it('does not show the lead character when the selected character has no portrait', () => {
        expect(selectedPortrait([{ image: 'lead.png' }, { image: null }], 1)).toBeNull();
        expect(selectedPortrait([{ image: 'lead.png' }, { image: 'other.png' }], 1)).toBe('other.png');
    });
});
