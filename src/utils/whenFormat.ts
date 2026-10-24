/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * One When formatter
 * ------------------
 * The scene hover and the Timetable's hover show a scene's When the same way:
 * `Wed Jan 3, 2085 @ 2:20PM`. A date-only When shows no time, because
 * `parseWhenField` reads it as local noon and printing "@ Noon" would invent a
 * clock time the author never wrote. The title bar's scene-time badge keeps its
 * own compact clock format (`sceneTimeLabel`). The Timetable's cells use the
 * short forms at the end of this file: When, Duration and Due.
 */

import { getFormattingLocale } from '../i18n';
import { parseDurationDetail, type DurationUnitKey } from './date';

const ENGLISH_LOCALE = /^en(?:-|$)/i;
const ENGLISH_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ENGLISH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True when the author's When text names a clock time. A date-only When never does. */
export function whenTextHasClock(raw: string): boolean {
    return /\d{1,2}:\d{2}|\d\s*(?:am|pm)\b/i.test(raw);
}

function englishClock(when: Date): string {
    const hours = when.getHours();
    const minutes = when.getMinutes();
    if (hours === 0 && minutes === 0) return 'Midnight';
    if (hours === 12 && minutes === 0) return 'Noon';
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return minutes === 0 ? `${displayHours}${period}` : `${displayHours}:${String(minutes).padStart(2, '0')}${period}`;
}

/**
 * Format a scene's When for display. `hasClock` says whether the author's YAML
 * names a time; without one, only the date shows. Month and weekday names
 * follow Obsidian's language; English keeps RT's long-standing hover format.
 */
export function formatSceneWhen(when: Date, hasClock: boolean, locale: string = getFormattingLocale()): string {
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) {
        throw new Error('formatSceneWhen requires a valid Date object');
    }
    if (ENGLISH_LOCALE.test(locale)) {
        const date = `${ENGLISH_WEEKDAYS[when.getDay()]} ${ENGLISH_MONTHS[when.getMonth()]} ${when.getDate()}, ${when.getFullYear()}`;
        return hasClock ? `${date} @ ${englishClock(when)}` : date;
    }
    const date = new Intl.DateTimeFormat(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory' }).format(when);
    if (!hasClock) return date;
    const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(when);
    return `${date} @ ${clock}`;
}

/**
 * The Timetable's short When: `Fri Apr 6 · 7PM`, with the year only when the
 * table's rows span more than one (otherwise its header shows it once).
 */
export function formatTableWhen(when: Date, hasClock: boolean, withYear: boolean, locale: string = getFormattingLocale()): string {
    if (ENGLISH_LOCALE.test(locale)) {
        const date = `${ENGLISH_WEEKDAYS[when.getDay()]} ${ENGLISH_MONTHS[when.getMonth()]} ${when.getDate()}${withYear ? `, ${when.getFullYear()}` : ''}`;
        return hasClock ? `${date} · ${englishClock(when)}` : date;
    }
    const date = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, calendar: 'gregory' }).format(when);
    if (!hasClock) return date;
    return `${date} · ${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(when)}`;
}

/** Intl's unit for each Duration unit. Months and years spell a short unit: a narrow `m` would read as minutes. */
const DURATION_UNITS: Record<DurationUnitKey, { unit: string; display: 'narrow' | 'short' }> = {
    seconds: { unit: 'second', display: 'narrow' },
    minutes: { unit: 'minute', display: 'narrow' },
    hours: { unit: 'hour', display: 'narrow' },
    days: { unit: 'day', display: 'narrow' },
    weeks: { unit: 'week', display: 'narrow' },
    months: { unit: 'month', display: 'short' },
    years: { unit: 'year', display: 'short' },
};

/** A Duration as written (`2 hours`, `45 min`) in its compact form (`2h`, `45m`); null when it doesn't parse. */
export function formatCompactDuration(duration: string, locale: string = getFormattingLocale()): string | null {
    const detail = parseDurationDetail(duration);
    if (!detail) return null;
    const { unit, display } = DURATION_UNITS[detail.unitKey];
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: display, maximumFractionDigits: 2 }).format(detail.value);
}

/** Within this many days, a Due date reads as relative time ("in 3 days"); beyond it, as a date. */
const RELATIVE_DUE_DAYS = 30;

/** A Due date for a table cell: relative time near today, the short date further off or once the scene is complete. */
export function formatDueLabel(
    due: { kind: 'done'; date: Date } | { kind: 'late' | 'soon' | 'later'; date: Date; days: number },
    today: Date,
    locale: string = getFormattingLocale()
): string {
    if (due.kind !== 'done' && Math.abs(due.days) <= RELATIVE_DUE_DAYS) {
        return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(due.days, 'day');
    }
    const year = due.date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined;
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year, calendar: 'gregory' }).format(due.date);
}

/** A calendar date in full, for hover: `Tue, Oct 20, 2026`. */
export function formatLongDate(date: Date, locale: string = getFormattingLocale()): string {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory' }).format(date);
}
