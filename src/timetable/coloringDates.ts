import { getFormattingLocale, t } from '../i18n';
import { createLocalDate, formatLocalDateKey, formatStoryDate, formatStoryYear, isCalendarDay, parseLocalDateKey, parseWhenField, splitWhenEra } from '../utils/date';

export type DateGrouping = { kind: 'day' | 'month' | 'year' | 'due' } | { kind: 'range'; start: string; end: string };

/** Reject rollover dates, including invalid saved custom intervals. */
export function validColoringDateKey(value: string): boolean {
    const date = parseLocalDateKey(value);
    return date !== null && formatLocalDateKey(date) === value;
}

export function readDateGrouping(raw: unknown): DateGrouping | null {
    if (!raw || typeof raw !== 'object' || !('kind' in raw)) return null;
    if (raw.kind === 'day' || raw.kind === 'month' || raw.kind === 'year' || raw.kind === 'due') return { kind: raw.kind };
    if (raw.kind !== 'range' || !('start' in raw) || !('end' in raw)
        || typeof raw.start !== 'string' || typeof raw.end !== 'string'
        || !validColoringDateKey(raw.start) || !validColoringDateKey(raw.end) || raw.start > raw.end) return null;
    return { kind: 'range', start: raw.start, end: raw.end };
}

function dateValue(value: unknown): Date | null {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (typeof value !== 'string') return null;
    const { body, era } = splitWhenEra(value);
    const day = body.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/);
    // The day must exist in its own year: 1 BCE (astronomical 0) has a Feb 29.
    if (day && !isCalendarDay(era === 'BCE' ? 1 - Number(day[1]) : Number(day[1]), Number(day[2]), Number(day[3]))) return null;
    return parseWhenField(value);
}

export function hasColoringDates(rows: Array<{ value: unknown }>): boolean {
    return rows.some(row => dateValue(row.value) !== null);
}

/**
 * A date key's numbers: `2024-03-05`, `-1183-06-14` (1184 BCE), `-1183-06`, `-1183`.
 * Day, month and year category IDs carry the astronomical year, so 1184 BCE is
 * `-1183`; a CE key is the same `formatLocalDateKey` text it has always been.
 */
function dateKeyParts(key: string): [number, number, number] | null {
    const match = /^(-?\d+)(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(key);
    if (!match) return null;
    // A month key has no day, a year key no month: each starts on the 1st.
    const [, year, month = '1', day = '1'] = match;
    return [Number(year), Number(month), Number(day)];
}

/** Order two date keys in time; BCE years count down, so a string comparison cannot. */
function compareDateKeys(a: string, b: string): number | null {
    const left = dateKeyParts(a);
    const right = dateKeyParts(b);
    if (!left || !right) return null;
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function dateKeyLocalDate(key: string): Date | null {
    const parts = dateKeyParts(key);
    return parts ? createLocalDate(parts[0], parts[1] - 1, parts[2]) : null;
}

/** Stable, locale-independent category IDs; boundaries are calendar days, never milliseconds across DST. */
export function dateColoringRows(rows: Array<{ path: string; value: unknown; complete?: boolean }>, grouping: DateGrouping, today: Date): Array<{ path: string; value: string }> {
    const todayKey = formatLocalDateKey(today);
    const nextWeek = new Date(today.getTime());
    nextWeek.setDate(nextWeek.getDate() + 7);
    const weekKey = formatLocalDateKey(nextWeek);
    return rows.map(({ path, value, complete }) => {
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return { path, value: 'date:unset' };
        const date = dateValue(value);
        if (!date) return { path, value: 'date:invalid' };
        const key = formatLocalDateKey(date);
        switch (grouping.kind) {
            case 'day': return { path, value: `day:${key}` };
            case 'month': return { path, value: `month:${key.slice(0, key.lastIndexOf('-'))}` };
            case 'year': return { path, value: `year:${date.getFullYear()}` };
            case 'range': {
                const before = compareDateKeys(key, grouping.start);
                const after = compareDateKeys(key, grouping.end);
                if (before === null || after === null) return { path, value: 'date:invalid' };
                return { path, value: before < 0 ? 'range:before' : after > 0 ? 'range:after' : 'range:inside' };
            }
            case 'due': return { path, value: complete ? 'due:completed' : key < todayKey ? 'due:overdue' : key === todayKey ? 'due:today' : key <= weekKey ? 'due:week' : 'due:later' };
        }
    });
}

export function coloringDateLabel(value: string, grouping?: DateGrouping): string {
    if (!grouping) return value;
    const labels: Record<string, string> = {
        'date:unset': t('ui.timetable.colorKey.unset'), 'date:invalid': t('ui.timetable.colorKey.invalidDate'),
        'due:completed': t('ui.timetable.colorKey.completed'), 'due:overdue': t('ui.timetable.colorKey.overdue'), 'due:today': t('ui.timetable.colorKey.today'),
        'due:week': t('ui.timetable.colorKey.nextWeek'), 'due:later': t('ui.timetable.colorKey.later'),
        'range:before': t('ui.timetable.colorKey.beforeRange'), 'range:after': t('ui.timetable.colorKey.afterRange'),
        'range:inside': grouping?.kind === 'range' ? `${grouping.start} – ${grouping.end}` : '',
    };
    if (value in labels) return labels[value];
    const isMonth = value.startsWith('month:');
    const key = value.startsWith('year:') ? value.slice(5) : isMonth ? value.slice(6) : value.startsWith('day:') ? value.slice(4) : '';
    // A BCE group names its era (`1184 BCE`, `Jun 1184 BCE`); CE groups read as they always have.
    const parts = dateKeyParts(key);
    if (parts && parts[0] <= 0) {
        const date = dateKeyLocalDate(key);
        if (!date) return value;
        if (value.startsWith('year:')) return formatStoryYear(date);
        return formatStoryDate(date, isMonth ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
    }
    if (value.startsWith('year:')) return key;
    const day = isMonth ? `${key}-01` : key;
    const date = parseLocalDateKey(day);
    return date ? new Intl.DateTimeFormat(getFormattingLocale(), isMonth
        ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : value;
}

const RANGE_GROUPS = ['range:before', 'range:inside', 'range:after'];
const DUE_GROUPS = ['due:overdue', 'due:today', 'due:week', 'due:later', 'due:completed'];
const DATE_GAPS = ['date:unset', 'date:invalid'];

/** Due and a custom range sort scenes into a known set of groups; day, month and year groups come from the dates themselves. */
export function fixedColoringGroups(grouping?: DateGrouping): string[] | undefined {
    if (grouping?.kind === 'due') return [...DUE_GROUPS, ...DATE_GAPS];
    if (grouping?.kind === 'range') return [...RANGE_GROUPS, ...DATE_GAPS];
    return undefined;
}

const DATE_CATEGORY = /^(day|month|year):(.+)$/;

/** Calendar categories stay in time order, with missing/invalid dates last. */
export function compareDateCategories(a: string, b: string): number {
    const fixed = [...RANGE_GROUPS, ...DUE_GROUPS, ...DATE_GAPS];
    if (a.startsWith('date:') !== b.startsWith('date:')) return a.startsWith('date:') ? 1 : -1;
    if (fixed.includes(a) && fixed.includes(b)) return fixed.indexOf(a) - fixed.indexOf(b);
    const left = DATE_CATEGORY.exec(a);
    const right = DATE_CATEGORY.exec(b);
    const inTime = left && right && left[1] === right[1] ? compareDateKeys(left[2], right[2]) : null;
    return inTime ?? a.localeCompare(b, undefined, { numeric: true });
}
