import { afterEach, describe, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';
import { generateChronologicalTicks } from './date';

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
});
