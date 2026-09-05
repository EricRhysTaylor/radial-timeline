import { describe, expect, it } from 'vitest';
import { orderBeatsByAct, parseBeatRow } from './beatRows';

describe('parseBeatRow', () => {
    it('reads the object form and drops blank optional fields', () => {
        expect(parseBeatRow({ name: ' Catalyst ', act: 2, purpose: '  ', id: 'b1', range: '10-12' })).toEqual({
            name: 'Catalyst', act: 2, purpose: undefined, id: 'b1', range: '10-12'
        });
    });

    it('reads the legacy "Name[act]" string and defaults act 1', () => {
        expect(parseBeatRow('Midpoint[2]')).toEqual({ name: 'Midpoint', act: 2 });
        expect(parseBeatRow('Opening Image')).toEqual({ name: 'Opening Image', act: 1 });
        expect(parseBeatRow(null)).toEqual({ name: '', act: 1 });
    });
});

describe('orderBeatsByAct', () => {
    it('groups by act in the given order and clamps acts to the count', () => {
        const ordered = orderBeatsByAct([
            { name: 'c', act: 3 }, { name: 'a', act: 1 }, { name: 'z', act: 9 }, { name: 'b', act: 2 }
        ], 3);
        expect(ordered.map(b => `${b.name}${b.act}`)).toEqual(['a1', 'b2', 'c3', 'z3']);
    });
});
