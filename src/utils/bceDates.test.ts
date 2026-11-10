/*
 * BCE scene dates: parse, compare, format and write across eras.
 * Design: docs/engineering/plans/bce-scene-dates-plan.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';
import {
    calculateTimeSpan,
    datesSpanEras,
    eraYearOf,
    formatStoryDate,
    formatStoryYear,
    formatWhenDate,
    formatWhenForYaml,
    generateChronologicalTicks,
    parseDateRangeInput,
    parseWhenField,
    splitWhenEra,
} from './date';
import { PROSE_ERA_SOURCE, PROSE_YEAR_SOURCE, proseDateWhen } from './date';
import { formatSceneWhen, formatTableWhen, whenTextNamesDay } from './whenFormat';
import { sceneTimeLabel } from './sceneTimeLabel';
import { wallClockWhen } from '../services/export/timelineExportFormat';
import { coloringDateLabel, compareDateCategories, dateColoringRows } from '../timetable/coloringDates';
import { parseReferenceDate } from '../chronologue/timeReferences/model';

afterEach(() => vi.restoreAllMocks());

/** The date a When should read as, built the way the parser builds it. */
function storyDate(astronomicalYear: number, month: number, day: number, hour = 12, minute = 0): Date {
    const date = new Date(2000, 0, 1, hour, minute, 0, 0);
    date.setFullYear(astronomicalYear, month - 1, day);
    return date;
}

const parse = (when: string): Date => {
    const date = parseWhenField(when);
    if (!date) throw new Error(`expected ${when} to parse`);
    return date;
};

describe('splitWhenEra', () => {
    it('reads a trailing era and leaves the rest of the When', () => {
        expect(splitWhenEra('1184-06-14 BCE')).toEqual({ body: '1184-06-14', era: 'BCE' });
        expect(splitWhenEra(' 1184-06-14 20:00 bc ')).toEqual({ body: '1184-06-14 20:00', era: 'BCE' });
        expect(splitWhenEra('33 AD')).toEqual({ body: '33', era: 'CE' });
        expect(splitWhenEra('2024-03-05 2:30 pm')).toEqual({ body: '2024-03-05 2:30 pm', era: null });
    });
});

describe('parseWhenField with an era', () => {
    it('reads 1184-06-14 BCE as astronomical year -1183 at noon', () => {
        const date = parse('1184-06-14 BCE');
        expect(date.getFullYear()).toBe(-1183);
        expect(date.getMonth()).toBe(5);
        expect(date.getDate()).toBe(14);
        expect(date.getHours()).toBe(12);
    });

    it.each(['1184-06-14 BCE', '1184-06-14 BC', '1184-06-14 B.C.', '1184-06-14 B.C.E.', '1184-06-14 bce', '1184/6/14 BCE', 'June 14, 1184 BCE', '14 June 1184 BC', '6/14/1184 BCE'])(
        'reads %s as the same day',
        when => expect(parse(when).getTime()).toBe(storyDate(-1183, 6, 14).getTime())
    );

    it('keeps the clock in every time form', () => {
        expect(parse('1184-06-14 20:00 BCE').getTime()).toBe(storyDate(-1183, 6, 14, 20).getTime());
        expect(parse('1184-06-14T20:30 BCE').getTime()).toBe(storyDate(-1183, 6, 14, 20, 30).getTime());
        expect(parse('1184-06-14 8:30 pm BCE').getTime()).toBe(storyDate(-1183, 6, 14, 20, 30).getTime());
    });

    it('reads a year or a month on its own as the 1st of that period', () => {
        expect(parse('1184 BCE').getTime()).toBe(storyDate(-1183, 1, 1).getTime());
        expect(parse('1184-06 BCE').getTime()).toBe(storyDate(-1183, 6, 1).getTime());
        expect(parse('June 1184 BCE').getTime()).toBe(storyDate(-1183, 6, 1).getTime());
    });

    it('takes a short year when the era is written', () => {
        expect(parse('44 BCE').getFullYear()).toBe(-43);
        expect(parse('March 15, 44 BCE').getTime()).toBe(storyDate(-43, 3, 15).getTime());
        expect(parse('3/15/44 BC').getTime()).toBe(storyDate(-43, 3, 15).getTime());
        expect(parse('0044-03-15 BCE').getTime()).toBe(storyDate(-43, 3, 15).getTime());
        expect(parse('33 CE').getFullYear()).toBe(33);
        expect(parse('April 3, 33 AD').getTime()).toBe(storyDate(33, 4, 3).getTime());
    });

    it('reads a written CE exactly like no era', () => {
        expect(parse('2024-03-15 CE').getTime()).toBe(parse('2024-03-15').getTime());
        expect(parse('1811-10-09 AD').getTime()).toBe(parse('1811-10-09').getTime());
    });

    it('rejects year 0, which neither era has', () => {
        expect(parseWhenField('0 BCE')).toBeNull();
        expect(parseWhenField('0000-01-01 BCE')).toBeNull();
        expect(parseWhenField('0000-01-01')).toBeNull();
    });

    it('still asks four digits of a year with no era', () => {
        expect(parseWhenField('44')).toBeNull();
        expect(parseWhenField('3/15/44')).toBeNull();
        expect(parseWhenField('March 15, 44')).toBeNull();
    });

    it('reads a four-digit year below 100 as that year, not the 1900s', () => {
        expect(parse('0050-06-01').getFullYear()).toBe(50);
        expect(parse('0001-01-01').getFullYear()).toBe(1);
    });

    it('reads a BCE range', () => {
        const range = parseDateRangeInput('1184-06-14 BCE to 1176-11-16 BCE');
        expect(range?.start?.getFullYear()).toBe(-1183);
        expect(range?.end?.getFullYear()).toBe(-1175);
    });
});

describe('order and elapsed time across eras', () => {
    it('sorts BCE before CE and earlier BCE years first', () => {
        const whens = ['2024-01-01', '1 CE', '1176-11-16 BCE', '1 BCE', '1184-06-14 BCE', '44 BCE'];
        const sorted = whens.map(when => ({ when, at: parse(when).getTime() })).sort((a, b) => a.at - b.at).map(entry => entry.when);
        expect(sorted).toEqual(['1184-06-14 BCE', '1176-11-16 BCE', '44 BCE', '1 BCE', '1 CE', '2024-01-01']);
    });

    it('puts one day between Dec 31, 1 BCE and Jan 1, 1 CE', () => {
        const gap = parse('1-1-1 CE').getTime() - parse('12/31/1 BCE').getTime();
        expect(gap).toBe(24 * 60 * 60 * 1000);
    });

    it('measures a homecoming from Troy in years', () => {
        const span = calculateTimeSpan([parse('1184-06-14 BCE'), parse('1176-11-16 BCE')]);
        expect(span.years).toBeCloseTo(8.42, 2);
        expect(span.recommendedUnit).toBe('years');
    });

    it('knows when dates cross eras', () => {
        expect(datesSpanEras([parse('1184 BCE'), parse('1176 BCE')])).toBe(false);
        expect(datesSpanEras([parse('1 BCE'), parse('1 CE')])).toBe(true);
        expect(datesSpanEras([parse('1811-10-09'), parse('1812-01-01')])).toBe(false);
    });
});

describe('writing a When back', () => {
    it('leaves CE frontmatter exactly as before', () => {
        expect(formatWhenForYaml(new Date(2024, 2, 5, 14, 30))).toBe('2024-03-05 14:30');
        expect(formatWhenForYaml(new Date(1811, 9, 9, 12, 0))).toBe('1811-10-09 12:00');
        expect(formatWhenDate(new Date(1811, 9, 9))).toBe('1811-10-09');
    });

    it('writes a BCE When with its era and reads it back', () => {
        const troy = storyDate(-1183, 6, 14, 20);
        expect(formatWhenForYaml(troy)).toBe('1184-06-14 20:00 BCE');
        expect(formatWhenDate(troy)).toBe('1184-06-14 BCE');
        expect(parse(formatWhenForYaml(troy)).getTime()).toBe(troy.getTime());
        expect(formatWhenForYaml(storyDate(0, 12, 31))).toBe('0001-12-31 12:00 BCE');
    });

    it('pads a short CE year so the When reads back', () => {
        const date = storyDate(800, 1, 1);
        expect(formatWhenForYaml(date)).toBe('0800-01-01 12:00');
        expect(parse(formatWhenForYaml(date)).getTime()).toBe(date.getTime());
    });

    it('counts a year within its era', () => {
        expect(eraYearOf(storyDate(0, 1, 1))).toEqual({ year: 1, era: 'BCE' });
        expect(eraYearOf(storyDate(1, 1, 1))).toEqual({ year: 1, era: 'CE' });
        expect(eraYearOf(storyDate(-1183, 1, 1))).toEqual({ year: 1184, era: 'BCE' });
    });
});

describe('labels', () => {
    it('names BCE, and CE only when asked', () => {
        expect(formatStoryYear(storyDate(-1183, 6, 14), 'en')).toBe('1184 BCE');
        expect(formatStoryYear(storyDate(1811, 10, 9), 'en')).toBe('1811');
        expect(formatStoryYear(storyDate(33, 4, 3), 'en', true)).toBe('33 CE');
        expect(formatStoryYear(storyDate(0, 12, 31), 'en')).toBe('1 BCE');
    });

    it('uses the language’s own era names outside English', () => {
        expect(formatStoryYear(storyDate(-1183, 6, 14), 'de')).toBe('1184 v. Chr.');
        expect(formatStoryDate(storyDate(-1183, 6, 14), { month: 'short', day: 'numeric', year: 'numeric' }, 'fr')).toBe('14 juin 1184 av. J.-C.');
    });

    it('leaves a CE date exactly as Intl makes it', () => {
        const date = new Date(2085, 2, 15);
        for (const locale of ['en', 'de', 'ja', 'th']) {
            const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
            expect(formatStoryDate(date, options, locale)).toBe(new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' }).format(date));
        }
    });

    it('shows a BCE scene in the hover and the Timetable', () => {
        const troy = storyDate(-1183, 6, 14, 20);
        expect(formatSceneWhen(troy, false, 'en')).toBe('Wed Jun 14, 1184 BCE');
        expect(formatSceneWhen(troy, true, 'en')).toBe('Wed Jun 14, 1184 BCE @ 8PM');
        expect(formatSceneWhen(troy, false, 'de')).toBe('Mi., 14. Juni 1184 v. Chr.');
        expect(formatTableWhen(troy, true, true, 'en')).toBe('Wed Jun 14, 1184 BCE · 8PM');
        expect(formatTableWhen(troy, true, false, 'en')).toBe('Wed Jun 14 · 8PM');
        expect(formatTableWhen(storyDate(33, 4, 3), false, true, 'en', true)).toBe('Sun Apr 3, 33 CE');
        expect(formatTableWhen(storyDate(33, 4, 3), false, true, 'en')).toBe('Sun Apr 3, 33');
    });

    it('never invents a day for a BCE year or month', () => {
        expect(whenTextNamesDay('1184 BCE')).toBe(false);
        expect(whenTextNamesDay('1184-06 BCE')).toBe(false);
        expect(whenTextNamesDay('June 1184 BCE')).toBe(false);
        expect(whenTextNamesDay('1184-06-14 BCE')).toBe(true);
    });

    it('shows a BCE When in the scene time bar', () => {
        expect(sceneTimeLabel('1184-06-14 BCE', undefined).text).toBe('Wed Jun 14, 1184 BCE');
        expect(sceneTimeLabel('1184 BCE', undefined).text).toBe('1184 BCE');
        expect(sceneTimeLabel('1184-06-14 23:00 BCE', '3 hours').text).toContain('(1184-06-15 BCE)');
    });
});

describe('Chronologue start and end labels', () => {
    it('labels a BCE book with BCE years', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('en');
        const ticks = generateChronologicalTicks([{ when: parse('1184-06-14 BCE') }, { when: parse('1176-11-16 BCE') }]).filter(tick => tick.isMajor);
        expect(ticks[0].name).toBe('1184 BCE\nJun 14');
        expect(ticks[ticks.length - 1].name).toBe('1176 BCE\nNov 16');
    });

    it('names CE on the CE side of a book that crosses eras', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('en');
        const ticks = generateChronologicalTicks([{ when: parse('1 BCE') }, { when: parse('2 CE') }]).filter(tick => tick.isMajor);
        expect(ticks[0].name).toBe('1 BCE\nJan 1');
        expect(ticks[ticks.length - 1].name).toBe('2 CE\nJan 1');
    });

    it('keeps CE books as they were', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('en');
        const ticks = generateChronologicalTicks([{ when: parse('1811-10-09') }, { when: parse('1812-11-27') }]).filter(tick => tick.isMajor);
        expect(ticks[0].name).toBe('1811\nOct 9');
        expect(ticks[ticks.length - 1].name).toBe('1812\nNov 27');
    });

    it('labels a single BCE scene with its era', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('en');
        expect(generateChronologicalTicks([{ when: parse('1184-06-14 BCE') }])[0].name).toBe('Jun 14, 1184 BCE');
    });
});

describe('dates found in scene text', () => {
    const monthDayYear = new RegExp(String.raw`\b(January|June|March)\s+(\d{1,2}),?\s+` + PROSE_YEAR_SOURCE + PROSE_ERA_SOURCE, 'i');
    const cue = (text: string): string | null => {
        const match = monthDayYear.exec(text);
        return match ? proseDateWhen(match[3], match[1].toLowerCase() === 'june' ? '6' : '3', match[2], match[4]) : null;
    };

    it('keeps a written era on the cue', () => {
        expect(cue('On June 14, 1184 BCE the city fell.')).toBe('1184-06-14 BCE');
        expect(cue('On March 15, 44 B.C. Caesar died.')).toBe('0044-03-15 BCE');
        expect(cue('On June 14, 1184 AD the city fell.')).toBe('1184-06-14');
    });

    it('reads CE text exactly as before', () => {
        expect(cue('On June 14, 2085 they met.')).toBe('2085-06-14');
        // A short number with no era was never a year, so the cue moves on to the real date.
        expect(cue('By March 15, 85 people had left. On June 3, 2085 they met.')).toBe('2085-06-03');
        expect(cue('On June 14, 1184 Advent began.')).toBe('1184-06-14');
    });
});

describe('export and share format', () => {
    it('writes a BCE When as its signed ISO year', () => {
        expect(wallClockWhen({ when: parse('1184-06-14 BCE'), rawFrontmatter: { When: '1184-06-14 BCE' } })).toBe('-001183-06-14');
        expect(wallClockWhen({ when: parse('1184-06-14 20:00 BCE'), rawFrontmatter: { When: '1184-06-14 20:00 BCE' } })).toBe('-001183-06-14T20:00:00');
        expect(wallClockWhen({ when: parse('12/31/1 BCE'), rawFrontmatter: { When: '12/31/1 BCE' } })).toBe('0000-12-31T12:00:00');
        expect(new Date('-001183-06-14T20:00:00').getFullYear()).toBe(-1183);
    });

    it('leaves CE exports as they were', () => {
        expect(wallClockWhen({ when: parse('2085-04-13 03:12'), rawFrontmatter: { When: '2085-04-13 03:12' } })).toBe('2085-04-13T03:12:00');
        expect(wallClockWhen({ when: parse('1811-10-09'), rawFrontmatter: { When: '1811-10-09' } })).toBe('1811-10-09');
    });
});

describe('Timetable coloring by date', () => {
    const today = new Date(2026, 9, 26, 14);
    const rows = (values: string[]) => values.map((value, i) => ({ path: String(i), value }));

    it('groups BCE dates under signed keys that sort in time', () => {
        const years = dateColoringRows(rows(['1176-11-16 BCE', '1184-06-14 BCE', '2024-01-01']), { kind: 'year' }, today).map(row => row.value);
        expect(years).toEqual(['year:-1175', 'year:-1183', 'year:2024']);
        expect([...years].sort(compareDateCategories)).toEqual(['year:-1183', 'year:-1175', 'year:2024']);
        expect(dateColoringRows(rows(['1184-06-14 BCE']), { kind: 'month' }, today)[0].value).toBe('month:-1183-06');
        const days = ['day:-1183-06-14', 'day:-1183-06-02', 'day:-1175-01-01'];
        expect([...days].sort(compareDateCategories)).toEqual(['day:-1183-06-02', 'day:-1183-06-14', 'day:-1175-01-01']);
    });

    it('accepts a leap day that exists in its BCE year', () => {
        // 1 BCE is astronomical year 0, a leap year; 2 BCE is not.
        expect(dateColoringRows(rows(['0001-02-29 BCE', '0002-02-29 BCE']), { kind: 'day' }, today).map(row => row.value))
            .toEqual(['day:0-02-29', 'date:invalid']);
    });

    it('labels BCE groups with their era and CE groups as before', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('en');
        expect(coloringDateLabel('year:-1183', { kind: 'year' })).toBe('1184 BCE');
        expect(coloringDateLabel('month:-1183-06', { kind: 'month' })).toBe('Jun 1184 BCE');
        expect(coloringDateLabel('day:-1183-06-14', { kind: 'day' })).toBe('Jun 14, 1184 BCE');
        expect(coloringDateLabel('year:2024', { kind: 'year' })).toBe('2024');
        expect(coloringDateLabel('month:2085-04', { kind: 'month' })).toBe('Apr 2085');
    });

    it('labels a CE year under 1000 written with an era as a date, keeping its key', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('en');
        const [day] = dateColoringRows(rows(['0033-04-03 AD']), { kind: 'day' }, today).map(row => row.value);
        const [month] = dateColoringRows(rows(['0033-04-03 AD']), { kind: 'month' }, today).map(row => row.value);
        expect(day).toBe('day:33-04-03');
        expect(month).toBe('month:33-04');
        expect(coloringDateLabel(day, { kind: 'day' })).toBe('Apr 3, 33');
        expect(coloringDateLabel(month, { kind: 'month' })).toBe('Apr 33');
        expect(coloringDateLabel('day:850-12-25', { kind: 'day' })).toBe('Dec 25, 850');
    });
});

describe('Chronologue time references', () => {
    it('reads a BCE reference date and its precision', () => {
        const reference = parseReferenceDate('1184-06-14 BCE');
        expect(reference?.precision).toBe('day');
        expect(reference?.start).toBe(new Date(storyDate(-1183, 6, 14, 0).getTime()).getTime());
        expect(parseReferenceDate('1184 BCE')?.precision).toBe('year');
        expect(parseReferenceDate('0000-01-01')).toBeNull();
        expect(parseReferenceDate('1811-10-09')?.start).toBe(new Date(1811, 9, 9).getTime());
    });
});
