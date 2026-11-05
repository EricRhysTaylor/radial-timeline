import { describe, expect, it } from 'vitest';
import { formatChronologueGap } from './chronologueGap';
import type { PlanetaryProfile } from '../types';

const day = 24 * 60 * 60 * 1000;

describe('compact Chronologue gaps', () => {
    it('shows zero and common spans without redundant plus signs', () => {
        expect(formatChronologueGap(0, 'en')).toBe('—');
        expect(formatChronologueGap(21 * day, 'en')).toBe('3 wks');
        expect(formatChronologueGap(15 * day, 'en')).toBe('2 wks & 1 day');
        expect(formatChronologueGap(85 * 365.25 * day, 'en')).toBe('85 yrs');
    });
    it('preserves backwards gaps when the author sorts the table', () => {
        expect(formatChronologueGap(-day, 'en')).toBe('−1 day');
    });
    it('uses localized unit names', () => {
        expect(formatChronologueGap(21 * day, 'fr')).toContain('sem.');
    });
    it('uses local day lengths in planetary mode', () => {
        const profile = { hoursPerDay: 30, daysPerWeek: 5, daysPerYear: 300 } as PlanetaryProfile;
        expect(formatChronologueGap(60 * 60 * 60 * 1000, 'en', profile)).toBe('2 days');
        expect(formatChronologueGap(0, 'en', profile)).toBe('—');
    });
});
