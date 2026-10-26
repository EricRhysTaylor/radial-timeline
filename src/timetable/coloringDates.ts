import { getFormattingLocale, t } from '../i18n';
import { formatLocalDateKey, parseLocalDateKey, parseWhenField } from '../utils/date';

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
    const day = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/);
    if (day && !validColoringDateKey(`${day[1]}-${day[2].padStart(2, '0')}-${day[3].padStart(2, '0')}`)) return null;
    return parseWhenField(value);
}

export function hasColoringDates(rows: Array<{ value: unknown }>): boolean {
    return rows.some(row => dateValue(row.value) !== null);
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
            case 'month': return { path, value: `month:${key.slice(0, 7)}` };
            case 'year': return { path, value: `year:${date.getFullYear()}` };
            case 'range': return { path, value: key < grouping.start ? 'range:before' : key > grouping.end ? 'range:after' : 'range:inside' };
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
    if (value.startsWith('year:')) return value.slice(5);
    const day = value.startsWith('month:') ? `${value.slice(6)}-01` : value.startsWith('day:') ? value.slice(4) : '';
    const date = parseLocalDateKey(day);
    return date ? new Intl.DateTimeFormat(getFormattingLocale(), value.startsWith('month:')
        ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : value;
}

/** Calendar categories stay in time order, with missing/invalid dates last. */
export function compareDateCategories(a: string, b: string): number {
    const fixed = ['range:before', 'range:inside', 'range:after', 'due:overdue', 'due:today', 'due:week', 'due:later', 'due:completed', 'date:unset', 'date:invalid'];
    if (a.startsWith('date:') !== b.startsWith('date:')) return a.startsWith('date:') ? 1 : -1;
    if (fixed.includes(a) && fixed.includes(b)) return fixed.indexOf(a) - fixed.indexOf(b);
    return a.localeCompare(b, undefined, { numeric: true });
}
