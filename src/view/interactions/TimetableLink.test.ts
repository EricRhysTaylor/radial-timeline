import { describe, expect, it } from 'vitest';
import { queryMarkFor } from './TimetableLink';

describe('queryMarkFor', () => {
    it('draws the full-size icon in a roomy cell', () => {
        expect(queryMarkFor(140, 200)).toEqual({ kind: 'icon', size: 28 });
    });

    it('shrinks the icon to fit a thin ring or a narrow cell', () => {
        expect(queryMarkFor(40, 200)).toEqual({ kind: 'icon', size: 18 });
        expect(queryMarkFor(140, 30)).toEqual({ kind: 'icon', size: 18 });
    });

    it('falls back to a dot when the icon would be too small to read', () => {
        const narrow = queryMarkFor(140, 12);
        expect(narrow?.kind).toBe('dot');
        expect(narrow?.kind === 'dot' && narrow.radius).toBeCloseTo(3.6);
        expect(queryMarkFor(20, 200)).toEqual({ kind: 'dot', radius: 5 });
    });

    it('draws nothing in a sliver', () => {
        expect(queryMarkFor(140, 3)).toBeNull();
    });
});
