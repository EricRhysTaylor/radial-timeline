import { describe, expect, it } from 'vitest';
import { convertFromEarth, formatPlanetaryDateAdaptive, formatPlanetaryPrecisionRange } from './planetaryTime';
import { createMarsPlanetaryProfile } from './planetaryMars';

describe('planetary perimeter labels', () => {
    const conversion = convertFromEarth(new Date(2085, 2, 15, 12), createMarsPlanetaryProfile())!;

    it('uses explicit precision, independent of translated text', () => {
        expect(formatPlanetaryDateAdaptive(conversion, 'time')).toMatch(/^\d{2}:\d{2}$/);
        expect(formatPlanetaryDateAdaptive(conversion, 'day')).not.toMatch(/\d{2}:\d{2}/);
        expect(formatPlanetaryDateAdaptive(conversion, 'year')).toBe(`Yr ${conversion.localYear}`);
        expect(formatPlanetaryDateAdaptive(conversion, 'datetime')).toMatch(/\d{2}:\d{2}/);
    });

    it('identifies planetary year transitions even for time labels', () => {
        expect(formatPlanetaryDateAdaptive(conversion, 'time', true)).toContain(`Yr ${conversion.localYear}`);
    });

    it('represents the full possible planetary range for an imprecise Earth date', () => {
        const rapid = { ...createMarsPlanetaryProfile(), hoursPerDay: 1 };
        const date = new Date(2085, 2, 15, 12);
        expect(formatPlanetaryPrecisionRange(date, rapid, 'day')).toContain('–');
        expect(formatPlanetaryPrecisionRange(date, rapid, 'year')).toMatch(/^Yr .+–.+$/);
    });
});
