import { describe, expect, it } from 'vitest';
import { leadPortrait } from './panelPortrait';

describe('panel character portrait', () => {
    it('uses the first character’s portrait', () => {
        expect(leadPortrait([{ image: 'lead.png' }, { image: 'other.png' }])).toBe('lead.png');
    });

    it('does not substitute a later character when the first character portrait is missing', () => {
        expect(leadPortrait([{ image: null }, { image: 'other.png' }])).toBeNull();
    });

    it('has no portrait when no character is listed', () => {
        expect(leadPortrait([])).toBeNull();
    });
});
