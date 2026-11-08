import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanetaryProfile } from '../src/types/settings';
import { createMarsPlanetaryProfile, DARIAN_MARS_MONTH_NAMES, matchesLegacyMarsMonthNames } from '../src/utils/planetaryMars';
import { convertFromEarth, convertToEarth, formatPlanetaryDateAdaptive, formatPlanetaryDateTime, parseCommaNames } from '../src/utils/planetaryTime';

const TEST_PROFILE: PlanetaryProfile = {
    id: 'test',
    label: 'Test',
    hoursPerDay: 25,
    daysPerWeek: 5,
    daysPerYear: 13,
    epochLabel: 'SOL',
    monthNames: ['Aster', 'Beryl', 'Cinder'],
    weekdayNames: ['One', 'Two', 'Three', 'Four', 'Five'],
};

describe('planetary date in the hover', () => {
    // Archebald, as filmed: a 31-hour day, a 9-day week, 412 days a year.
    const ARCHEBALD: PlanetaryProfile = { id: 'archebald', label: 'Archebald', hoursPerDay: 31, daysPerWeek: 9, daysPerYear: 412, epochLabel: 'AE' };
    const at = (profile: PlanetaryProfile) => formatPlanetaryDateTime({
        profile, localYear: -108, localMonthIndex: 5, localDayOfMonth: 29, localWeekdayIndex: 2, localHours: 3, localMinutes: 52
    });

    it('keeps the month and day numbers when nothing is named, as the Alt rim does', () => {
        expect(at(ARCHEBALD)).toBe('AE Year -108 ☉ 6 29 @ 03:52');
        expect(at(ARCHEBALD)).not.toMatch(/DAY|MON/);
    });

    it('abbreviates named months and keeps the day number', () => {
        const monthNames = ['Frost', 'Thaw', 'Seed', 'Bloom', 'Sun', 'Harvest', 'Ember', 'Gale', 'Mist', 'Rime', 'Dark', 'Turn'];
        expect(at({ ...ARCHEBALD, monthNames })).toBe('AE Year -108 ☉ HAR 29 @ 03:52');
    });

    it('leads with the weekday when the week is named too', () => {
        const monthNames = ['Frost', 'Thaw', 'Seed', 'Bloom', 'Sun', 'Harvest', 'Ember', 'Gale', 'Mist', 'Rime', 'Dark', 'Turn'];
        const weekdayNames = ['Ash', 'Brine', 'Cog', 'Dune', 'Eddy', 'Fen', 'Gust', 'Hail', 'Isle'];
        expect(at({ ...ARCHEBALD, monthNames, weekdayNames })).toBe('AE Year -108 ☉ COG HAR 29 @ 03:52');
        expect(at({ ...ARCHEBALD, weekdayNames })).toBe('AE Year -108 ☉ COG 6 29 @ 03:52');
    });

    it('prints the same month and day as the rim label', () => {
        const conversion = convertFromEarth(new Date(Date.UTC(1811, 10, 26, 21, 0)), ARCHEBALD);
        expect(conversion).not.toBeNull();
        if (!conversion) return;
        const rim = formatPlanetaryDateAdaptive(conversion, 'Nov 26');
        expect(rim).toBe(`${conversion.localMonthIndex + 1} ${conversion.localDayOfMonth}`);
        expect(conversion.formatted).toContain(` ☉ ${rim} @ `);
    });
});

describe('planetary time conversion', () => {
    it('converts Earth time to planetary time and back using the same profile', () => {
        const earthDate = new Date(12 * 25 * 60 * 60 * 1000);
        const fromEarth = convertFromEarth(earthDate, TEST_PROFILE);

        expect(fromEarth?.localYear).toBe(1);
        expect(fromEarth?.localMonthIndex).toBe(2);
        expect(fromEarth?.localDayOfMonth).toBe(5);
        expect(fromEarth?.formatted).toContain('SOL Year 1');

        const toEarth = convertToEarth({
            localYear: 1,
            localMonthIndex: 2,
            localDayOfMonth: 5,
            localHours: 0,
            localMinutes: 0,
        }, TEST_PROFILE);

        expect(toEarth?.earthDate.getTime()).toBe(earthDate.getTime());
        expect(toEarth?.formatted).toBe(fromEarth?.formatted);
    });

    it('accepts local hours above 23 when the planetary day is longer than Earth', () => {
        const valid = convertToEarth({
            localYear: 1,
            localMonthIndex: 0,
            localDayOfMonth: 1,
            localHours: 24,
            localMinutes: 30,
        }, TEST_PROFILE);
        const invalid = convertToEarth({
            localYear: 1,
            localMonthIndex: 0,
            localDayOfMonth: 1,
            localHours: 25,
            localMinutes: 0,
        }, TEST_PROFILE);

        expect(valid?.earthDate.getTime()).toBe((24.5 * 60 * 60 * 1000));
        expect(invalid).toBeNull();
    });

    it('keeps the Mars template named and only migrates the exact legacy numeric month list', () => {
        const mars = createMarsPlanetaryProfile();

        expect(mars.monthNames?.[0]).toBe('Sagittarius');
        expect(mars.monthNames).toEqual(DARIAN_MARS_MONTH_NAMES);
        expect(matchesLegacyMarsMonthNames(Array.from({ length: 24 }, (_, index) => String(index + 1)))).toBe(true);
        expect(matchesLegacyMarsMonthNames(mars.monthNames)).toBe(false);
        expect(matchesLegacyMarsMonthNames(['1', '2', 'Custom'])).toBe(false);
    });

    it('parses planetary name lists from comma-separated or line-separated settings text', () => {
        expect(parseCommaNames('Solis, Lunae\nMartis')).toEqual(['Solis', 'Lunae', 'Martis']);
        expect(parseCommaNames('\n  Sagittarius\nDhanus, Capricornus  ')).toEqual(['Sagittarius', 'Dhanus', 'Capricornus']);
    });

    it('keeps the converter modal bidirectional and labels Chronologue by active profile', () => {
        const modalSource = readFileSync(resolve(process.cwd(), 'src/modals/PlanetaryTimeModal.ts'), 'utf8');
        const chronoSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/ChronologueSection.ts'), 'utf8');
        const defaultsSource = readFileSync(resolve(process.cwd(), 'src/settings/defaults.ts'), 'utf8');
        const settingsTypeSource = readFileSync(resolve(process.cwd(), 'src/types/settings.ts'), 'utf8');

        expect(settingsTypeSource).toContain("export type PlanetaryTimeConversionDirection = 'earth-to-planet' | 'planet-to-earth'");
        expect(modalSource).toContain('convertToEarth');
        expect(modalSource).toContain('renderPlanetToEarthResult');
        expect(modalSource).toContain('addPlanetarySelectField');
        expect(modalSource).toContain('ert-planetary-field-row');
        expect(modalSource).toContain('formatIndexedLabel');
        expect(modalSource).toContain('getWeekdayNameForLocalDay');
        expect(modalSource).toContain('getPlanetaryMonthStartDay');
        expect(modalSource).toContain('planetaryTimeLastDirection');
        expect(defaultsSource).toContain("planetaryTimeLastDirection: 'earth-to-planet'");
        expect(chronoSource).toContain('getActivePlanetaryProfile');
        expect(chronoSource).toContain(".addOption('planetary', activePlanetaryLabel)");
    });
});
