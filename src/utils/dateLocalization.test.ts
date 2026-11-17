import { afterEach, describe, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';
import { generateChronologicalTicks, parseWhenField } from './date';

afterEach(() => vi.restoreAllMocks());

describe('localized Chronologue labels', () => {
    it.each(['es', 'fr', 'th', 'vi'])('formats a single date in %s using the manuscript calendar', locale => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue(locale);
        const ticks = generateChronologicalTicks([{ when: new Date(2085, 2, 15) }]);
        expect(ticks).toHaveLength(1);
        expect(ticks[0].name).toBe(new Intl.DateTimeFormat(locale, {
            month: 'short', day: 'numeric', year: 'numeric', calendar: 'gregory',
        }).format(new Date(2085, 2, 15)));
        expect(ticks[0].name).toContain('2085');
    });

    it('uses French date order and a 24-hour clock on a short timeline', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('fr');
        const ticks = generateChronologicalTicks([
            { when: new Date(2085, 2, 15, 14, 20) },
            { when: new Date(2085, 2, 15, 16, 30) },
        ]).filter(tick => tick.isMajor);
        expect(ticks[0].name).toBe('15 mars\n14:20');
        expect(ticks[1].name).toBe('15 mars\n16:30');
    });

    it('preserves scene geometry and Gregorian years when Thai labels span years', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('th');
        const scenes = [{ when: new Date(2085, 2, 15) }, { when: new Date(2086, 2, 15) }];
        const ticks = generateChronologicalTicks(scenes, [-Math.PI / 2, Math.PI / 2]);
        const major = ticks.filter(tick => tick.isMajor);
        expect(major.map(tick => tick.angle)).toEqual([-Math.PI / 2, Math.PI / 2]);
        expect(major[0].name).toContain('2085');
        expect(major[1].name).toContain('2086');
        expect(major.some(tick => /2628|2629/.test(tick.name))).toBe(false);
    });

    it('does not invent times or days for date-only and year-only scenes', () => {
        const day = generateChronologicalTicks(['2085-03-15', '2085-03-15', '2085-03-16'].map(value => ({ when: parseWhenField(value)!, whenPrecision: 'day' as const }))).filter(tick => tick.isMajor);
        expect(day.every(tick => !/noon|midnight|\d:\d/.test(tick.shortName))).toBe(true);
        const years = generateChronologicalTicks(['1985', '2035', '2085'].map(value => ({ when: parseWhenField(value)!, whenPrecision: 'year' as const }))).filter(tick => tick.isMajor);
        expect(years.map(tick => tick.shortName)).toEqual(['1985', '2035', '2085']);
    });

    it('retains years and times across a new year', () => {
        const ticks = generateChronologicalTicks(['2085-12-31 23:00', '2086-01-01 01:00'].map(value => ({ when: parseWhenField(value)!, whenPrecision: 'time' as const }))).filter(tick => tick.isMajor);
        expect(ticks[0].shortName).toContain('2085');
        expect(ticks[1].shortName).toContain('2086');
        expect(ticks.every(tick => /:00/.test(tick.shortName))).toBe(true);
    });

    it('makes a single dated scene available to the planetary view', () => {
        const tick = generateChronologicalTicks([{ when: parseWhenField('2085-03-15')!, whenPrecision: 'day' }])[0];
        expect(tick.earthDate).toBeTruthy();
        expect(tick.labelKind).toBe('day');
    });

    it('limits forty scenes to twenty major ticks', () => {
        const ticks = generateChronologicalTicks(Array.from({ length: 40 }, (_, i) => ({ when: new Date(2085, 0, i + 1) })));
        expect(ticks.filter(tick => tick.isMajor).length).toBeLessThanOrEqual(20);
    });

    it('promotes a year boundary even when it falls between evenly sampled scenes', () => {
        const scenes = Array.from({ length: 40 }, (_, i) => ({ when: new Date(2085, 11, i + 1) }));
        const ticks = generateChronologicalTicks(scenes);
        expect(ticks.find(tick => tick.sceneIndex === 31)?.isMajor).toBe(true);
        expect(ticks.filter(tick => tick.isMajor).length).toBeLessThanOrEqual(20);
    });
});
