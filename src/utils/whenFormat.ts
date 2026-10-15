/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * One When formatter
 * ------------------
 * The scene hover and the Timetable show a scene's When the same way:
 * `Wed Jan 3, 2085 @ 2:20PM`. A date-only When shows no time, because
 * `parseWhenField` reads it as local noon and printing "@ Noon" would invent a
 * clock time the author never wrote. The title bar's scene-time badge keeps its
 * own compact clock format (`sceneTimeLabel`).
 */

import { getFormattingLocale } from '../i18n';

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
