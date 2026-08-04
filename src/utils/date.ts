/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Time span information for determining appropriate time labels
 */
export interface TimeSpanInfo {
    /** Total time span in milliseconds */
    totalMs: number;
    /** Time span in minutes */
    minutes: number;
    /** Time span in hours */
    hours: number;
    /** Time span in days */
    days: number;
    /** Time span in weeks */
    weeks: number;
    /** Time span in months (approximate) */
    months: number;
    /** Time span in years */
    years: number;
    /** Recommended time unit for labels */
    recommendedUnit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
}

/**
 * Time label information for rendering around the timeline arc
 */
export interface TimeLabelInfo {
    /** Label text (e.g., "Day 1", "Week 2") */
    text: string;
    /** Angular position in radians */
    angle: number;
    /** Time value in milliseconds */
    timeMs: number;
}

/**
 * Parse a When field string into a Date object
 * Supports ISO formats: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS, YYYY-MM-DD HH:MM
 */
/**
 * Parse When field from scene metadata
 * SINGLE SOURCE OF TRUTH for date parsing
 * Always interprets dates as LOCAL TIME (not UTC) to avoid timezone shifts
 * 
 * Supported formats (month and day can be single or double digit):
 * - YYYY-MM-DD or YYYY-M-D (date only, time defaults to 12:00:00 noon local)
 * - YYYY-MM-DD HH:MM or YYYY-M-D H:MM (date + time in local timezone)
 * - YYYY-MM-DD HH:MM:SS or YYYY-M-D H:MM:SS (date + time with seconds in local timezone)
 * - YYYY-MM-DDTHH:MM:SS or YYYY-M-DTHH:MM:SS (ISO 8601 format with T separator)
 * - YYYY-MM-DDTHH:MM or YYYY-M-DTHH:MM (ISO 8601 format with T separator, no seconds)
 * - YYYY-MM-DD h:mm am/pm or YYYY-M-D h:mm am/pm (12-hour clock with AM/PM)
 * 
 * Examples:
 * - 1812-9-17 → September 17, 1812 at noon
 * - 1812-09-17 → September 17, 1812 at noon
 * - 2024-3-5 14:30 → March 5, 2024 at 2:30 PM
 * - 2024-03-05T14:30:00 → March 5, 2024 at 2:30 PM
 * 
 * @param when - Date string from scene metadata
 * @returns Date object in local time, or null if invalid
 */
const MONTH_NAME_MAP: Record<string, number> = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sept: 8, sep: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
};

function parseMonthName(value: string): number | null {
    if (!value) return null;
    const key = value.toLowerCase().replace('.', '');
    return key in MONTH_NAME_MAP ? MONTH_NAME_MAP[key] : null;
}

function createLocalDate(year: number, monthIndex: number, day: number, hour = 12, minute = 0, second = 0): Date | null {
    const date = new Date(year, monthIndex, day, hour, minute, second, 0);
    return isNaN(date.getTime()) ? null : date;
}

export function parseWhenField(when: string): Date | null {
    if (!when || typeof when !== 'string') return null;

    // Standardize separators (support both dashes and slashes)
    const standardized = when.trim().replace(/\//g, '-');
    const trimmed = standardized;

    // Try ISO date format: YYYY-MM-DD or YYYY-M-D (flexible month/day digits)
    // Parse as local time by extracting components
    const dateOnlyMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
    if (dateOnlyMatch) {
        const year = parseInt(dateOnlyMatch[1], 10);
        const month = parseInt(dateOnlyMatch[2], 10) - 1; // JS months are 0-indexed
        const day = parseInt(dateOnlyMatch[3], 10);
        const date = new Date(year, month, day, 12, 0, 0, 0); // Local time at noon (12:00 PM)
        return isNaN(date.getTime()) ? null : date;
    }

    // Try ISO 8601 format with T separator and seconds: YYYY-MM-DDTHH:MM:SS (flexible month/day digits)
    const iso8601SecondsMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(trimmed);
    if (iso8601SecondsMatch) {
        const year = parseInt(iso8601SecondsMatch[1], 10);
        const month = parseInt(iso8601SecondsMatch[2], 10) - 1;
        const day = parseInt(iso8601SecondsMatch[3], 10);
        const hour = parseInt(iso8601SecondsMatch[4], 10);
        const minute = parseInt(iso8601SecondsMatch[5], 10);
        const second = parseInt(iso8601SecondsMatch[6], 10);
        const date = new Date(year, month, day, hour, minute, second, 0); // Local time
        return isNaN(date.getTime()) ? null : date;
    }

    // Try ISO 8601 format with T separator, no seconds: YYYY-MM-DDTHH:MM (flexible month/day digits)
    const iso8601Match = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2})$/.exec(trimmed);
    if (iso8601Match) {
        const year = parseInt(iso8601Match[1], 10);
        const month = parseInt(iso8601Match[2], 10) - 1;
        const day = parseInt(iso8601Match[3], 10);
        const hour = parseInt(iso8601Match[4], 10);
        const minute = parseInt(iso8601Match[5], 10);
        const date = new Date(year, month, day, hour, minute, 0, 0); // Local time
        return isNaN(date.getTime()) ? null : date;
    }

    // Try date + time with seconds and space separator: YYYY-MM-DD HH:MM:SS (flexible month/day digits)
    const dateTimeSecondsMatch = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(trimmed);
    if (dateTimeSecondsMatch) {
        const year = parseInt(dateTimeSecondsMatch[1], 10);
        const month = parseInt(dateTimeSecondsMatch[2], 10) - 1;
        const day = parseInt(dateTimeSecondsMatch[3], 10);
        const hour = parseInt(dateTimeSecondsMatch[4], 10);
        const minute = parseInt(dateTimeSecondsMatch[5], 10);
        const second = parseInt(dateTimeSecondsMatch[6], 10);
        const date = new Date(year, month, day, hour, minute, second, 0); // Local time
        return isNaN(date.getTime()) ? null : date;
    }

    // Try date + time with space separator: YYYY-MM-DD HH:MM (flexible month/day digits)
    const dateTimeMatch = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})$/.exec(trimmed);
    if (dateTimeMatch) {
        const year = parseInt(dateTimeMatch[1], 10);
        const month = parseInt(dateTimeMatch[2], 10) - 1;
        const day = parseInt(dateTimeMatch[3], 10);
        const hour = parseInt(dateTimeMatch[4], 10);
        const minute = parseInt(dateTimeMatch[5], 10);
        const date = new Date(year, month, day, hour, minute, 0, 0); // Local time
        return isNaN(date.getTime()) ? null : date;
    }

    // Try date + 12-hour time with am/pm: YYYY-MM-DD h:mm am/pm (flexible month/day digits)
    const ampmMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(trimmed);
    if (ampmMatch) {
        const year = parseInt(ampmMatch[1], 10);
        const month = parseInt(ampmMatch[2], 10) - 1;
        const day = parseInt(ampmMatch[3], 10);
        let hour = parseInt(ampmMatch[4], 10);
        const minute = ampmMatch[5] ? parseInt(ampmMatch[5], 10) : 0;
        const ampm = ampmMatch[6].toLowerCase();

        if (ampm === 'pm' && hour < 12) {
            hour += 12;
        } else if (ampm === 'am' && hour === 12) { // Midnight case
            hour = 0;
        }

        const date = new Date(year, month, day, hour, minute, 0, 0); // Local time
        return isNaN(date.getTime()) ? null : date;
    }

    // Try month/day/year with optional time (supports M/D/YYYY and MM/DD/YYYY)
    const monthDayYearTimeMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?\s*(am|pm)?$/i.exec(trimmed);
    if (monthDayYearTimeMatch) {
        const month = parseInt(monthDayYearTimeMatch[1], 10) - 1;
        const day = parseInt(monthDayYearTimeMatch[2], 10);
        const year = parseInt(monthDayYearTimeMatch[3], 10);
        let hour = monthDayYearTimeMatch[4] ? parseInt(monthDayYearTimeMatch[4], 10) : 12;
        const minute = monthDayYearTimeMatch[5] ? parseInt(monthDayYearTimeMatch[5], 10) : 0;
        const second = monthDayYearTimeMatch[6] ? parseInt(monthDayYearTimeMatch[6], 10) : 0;
        const ampm = monthDayYearTimeMatch[7]?.toLowerCase();

        if (ampm) {
            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
        }

        return createLocalDate(year, month, day, hour, minute, second);
    }
    const yearMonthMatch = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
    if (yearMonthMatch) {
        const year = parseInt(yearMonthMatch[1], 10);
        const month = parseInt(yearMonthMatch[2], 10) - 1;
        return createLocalDate(year, month, 1);
    }

    const yearOnlyMatch = /^(\d{4})$/.exec(trimmed);
    if (yearOnlyMatch) {
        const year = parseInt(yearOnlyMatch[1], 10);
        return createLocalDate(year, 0, 1);
    }

    const monthYearMatch = /^([A-Za-z]+)\s*,?\s*(\d{4})$/.exec(trimmed);
    if (monthYearMatch) {
        const month = parseMonthName(monthYearMatch[1]);
        const year = parseInt(monthYearMatch[2], 10);
        if (month !== null) {
            return createLocalDate(year, month, 1);
        }
    }

    const monthDayYearMatch = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})$/.exec(trimmed);
    if (monthDayYearMatch) {
        const month = parseMonthName(monthDayYearMatch[1]);
        const day = parseInt(monthDayYearMatch[2], 10);
        const year = parseInt(monthDayYearMatch[3], 10);
        if (month !== null) {
            return createLocalDate(year, month, day);
        }
    }

    const dayMonthYearMatch = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:,)?\s+(\d{4})$/.exec(trimmed);
    if (dayMonthYearMatch) {
        const day = parseInt(dayMonthYearMatch[1], 10);
        const month = parseMonthName(dayMonthYearMatch[2]);
        const year = parseInt(dayMonthYearMatch[3], 10);
        if (month !== null) {
            return createLocalDate(year, month, day);
        }
    }

    return null;
}

/**
 * Format a Date into the canonical `When` frontmatter form.
 * SINGLE SOURCE OF TRUTH for When serialization — the inverse of parseWhenField.
 *
 * Precision is MINUTES: seconds and milliseconds are discarded. Callers that
 * compare a candidate date against ordering bounds must compare the round-tripped
 * value (`parseWhenField(formatWhenForYaml(d))`), not the input Date — a value
 * 30 seconds inside a bound formats to a value exactly ON it.
 */
export function formatWhenForYaml(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function parseDateRangeInput(value: string): { start: Date | null; end: Date | null } | null {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    let parts: string[] | null = null;
    if (/\s+to\s+/i.test(trimmed)) {
        parts = trimmed.split(/\s+to\s+/i);
    } else if (/\s[-–—]\s/.test(trimmed)) {
        parts = trimmed.split(/\s[-–—]\s/);
    } else {
        const slashRangeMatch = /^(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?)\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?)$/i.exec(trimmed);
        if (slashRangeMatch) {
            parts = [slashRangeMatch[1], slashRangeMatch[2]];
        }
    }

    if (!parts || parts.length < 2) return null;
    const start = parseWhenField(parts[0].trim());
    const end = parseWhenField(parts[1].trim());
    return { start, end };
}

/**
 * Calculate time span information from an array of dates
 */
export function calculateTimeSpan(dates: Date[]): TimeSpanInfo {
    if (dates.length === 0) {
        return {
            totalMs: 0,
            minutes: 0,
            hours: 0,
            days: 0,
            weeks: 0,
            months: 0,
            years: 0,
            recommendedUnit: 'days'
        };
    }

    const sortedDates = dates.slice().sort((a, b) => a.getTime() - b.getTime());
    const earliest = sortedDates[0];
    const latest = sortedDates[sortedDates.length - 1];
    const totalMs = latest.getTime() - earliest.getTime();

    const minutes = totalMs / (1000 * 60);
    const hours = minutes / 60;
    const days = hours / 24;
    const weeks = days / 7;
    const months = days / 30.44; // Average days per month
    const years = days / 365.25; // Account for leap years

    // Determine recommended unit based on span
    let recommendedUnit: TimeSpanInfo['recommendedUnit'];
    if (hours <= 3) {
        // Less than or equal to 3 hours - use minutes (good for heists, action sequences, etc.)
        recommendedUnit = 'minutes';
    } else if (hours <= 48) {
        // 3-48 hours - use hours
        recommendedUnit = 'hours';
    } else if (days <= 14) {
        // 2-14 days - use days
        recommendedUnit = 'days';
    } else if (weeks <= 8) {
        // 2-8 weeks - use weeks
        recommendedUnit = 'weeks';
    } else if (months <= 24) {
        // 2-24 months - use months
        recommendedUnit = 'months';
    } else {
        // 24+ months - use years, starting at 2 years and up
        recommendedUnit = 'years';
    }

    return {
        totalMs,
        minutes,
        hours,
        days,
        weeks,
        months,
        years,
        recommendedUnit
    };
}

/**
 * Generate time labels for the timeline arc based on time span
 */
export function generateTimeLabels(span: TimeSpanInfo, earliestDate: Date): TimeLabelInfo[] {
    const labels: TimeLabelInfo[] = [];

    switch (span.recommendedUnit) {
        case 'minutes': {
            // Generate minute labels (max 90 labels for up to 90 minutes)
            const maxMinutes = Math.min(90, Math.ceil(span.minutes));
            const minuteStep = maxMinutes > 30 ? 5 : (maxMinutes > 15 ? 2 : 1); // 1min, 2min, or 5min intervals
            for (let i = 0; i <= maxMinutes; i += minuteStep) {
                const timeMs = earliestDate.getTime() + (i * 60 * 1000);
                const angle = mapTimeToAngle(timeMs, earliestDate.getTime(), earliestDate.getTime() + span.totalMs);
                labels.push({
                    text: `${i}m`,
                    angle,
                    timeMs
                });
            }
            break;
        }

        case 'hours': {
            // Generate hourly labels (max 24 labels)
            const maxHours = Math.min(24, Math.ceil(span.hours));
            for (let i = 0; i <= maxHours; i++) {
                const timeMs = earliestDate.getTime() + (i * 60 * 60 * 1000);
                const angle = mapTimeToAngle(timeMs, earliestDate.getTime(), earliestDate.getTime() + span.totalMs);
                labels.push({
                    text: `${i}h`,
                    angle,
                    timeMs
                });
            }
            break;
        }

        case 'days': {
            // Generate daily labels (max 7 labels)
            const maxDays = Math.min(7, Math.ceil(span.days));
            for (let i = 0; i <= maxDays; i++) {
                const timeMs = earliestDate.getTime() + (i * 24 * 60 * 60 * 1000);
                const angle = mapTimeToAngle(timeMs, earliestDate.getTime(), earliestDate.getTime() + span.totalMs);
                labels.push({
                    text: `Day ${i + 1}`,
                    angle,
                    timeMs
                });
            }
            break;
        }

        case 'weeks': {
            // Generate weekly labels (max 8 labels)
            const maxWeeks = Math.min(8, Math.ceil(span.weeks));
            for (let i = 0; i <= maxWeeks; i++) {
                const timeMs = earliestDate.getTime() + (i * 7 * 24 * 60 * 60 * 1000);
                const angle = mapTimeToAngle(timeMs, earliestDate.getTime(), earliestDate.getTime() + span.totalMs);
                labels.push({
                    text: `Week ${i + 1}`,
                    angle,
                    timeMs
                });
            }
            break;
        }

        case 'months': {
            // Generate monthly labels (max 12 labels)
            const maxMonths = Math.min(12, Math.ceil(span.months));
            for (let i = 0; i <= maxMonths; i++) {
                const timeMs = earliestDate.getTime() + (i * 30.44 * 24 * 60 * 60 * 1000);
                const angle = mapTimeToAngle(timeMs, earliestDate.getTime(), earliestDate.getTime() + span.totalMs);
                labels.push({
                    text: `Month ${i + 1}`,
                    angle,
                    timeMs
                });
            }
            break;
        }

        case 'years': {
            // Generate yearly labels (max 10 labels)
            const maxYears = Math.min(10, Math.ceil(span.years));
            for (let i = 0; i <= maxYears; i++) {
                const timeMs = earliestDate.getTime() + (i * 365.25 * 24 * 60 * 60 * 1000);
                const angle = mapTimeToAngle(timeMs, earliestDate.getTime(), earliestDate.getTime() + span.totalMs);
                labels.push({
                    text: `Year ${i + 1}`,
                    angle,
                    timeMs
                });
            }
            break;
        }
    }

    return labels;
}

/**
 * Map a time value to an angular position on the timeline arc
 */
function mapTimeToAngle(timeMs: number, startMs: number, endMs: number): number {
    const progress = (timeMs - startMs) / (endMs - startMs);
    return progress * 2 * Math.PI - Math.PI / 2; // Start at top (12 o'clock)
}

/**
 * Format elapsed time with click-to-cycle units
 * Intelligently degrades fractional spans into smaller units (e.g., 4 months + 3 days)
 */
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MONTH = 30.44 * MS_PER_DAY; // Average month
const MS_PER_YEAR = 365.25 * MS_PER_DAY; // Average year

const ELAPSED_TIME_UNIT_LABELS: Record<string, { singular: string; plural: string }> = {
    second: { singular: 'second', plural: 'seconds' },
    minute: { singular: 'minute', plural: 'minutes' },
    hour: { singular: 'hour', plural: 'hours' },
    day: { singular: 'day', plural: 'days' },
    week: { singular: 'week', plural: 'weeks' },
    month: { singular: 'month', plural: 'months' },
    year: { singular: 'year', plural: 'years' },
};

type ElapsedDisplayUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const ELAPSED_UNIT_SEQUENCE: Record<ElapsedDisplayUnit, { ms: number; next?: ElapsedDisplayUnit }> = {
    year: { ms: MS_PER_YEAR, next: 'month' },
    month: { ms: MS_PER_MONTH, next: 'day' },
    week: { ms: MS_PER_WEEK, next: 'day' },
    day: { ms: MS_PER_DAY, next: 'hour' },
    hour: { ms: MS_PER_HOUR, next: 'minute' },
    minute: { ms: MS_PER_MINUTE, next: 'second' },
    second: { ms: MS_PER_SECOND },
};

function formatUnitLabel(value: number, unitKey: ElapsedDisplayUnit): string {
    const unit = ELAPSED_TIME_UNIT_LABELS[unitKey] ?? {
        singular: unitKey,
        plural: `${unitKey}s`
    };
    const isSingular = Math.abs(Math.abs(value) - 1) < 1e-9;
    return isSingular ? unit.singular : unit.plural;
}

interface ElapsedPrimaryPart {
    text: string;
    remainderMs: number;
    usedUnit: ElapsedDisplayUnit;
}

function buildPrimaryComponent(ms: number, requestedUnit: ElapsedDisplayUnit): ElapsedPrimaryPart {
    const unitDef = ELAPSED_UNIT_SEQUENCE[requestedUnit];
    if (!unitDef || ms <= 0) {
        return {
            text: `0 ${formatUnitLabel(0, requestedUnit)}`,
            remainderMs: 0,
            usedUnit: requestedUnit
        };
    }

    const wholeValue = Math.floor(ms / unitDef.ms);
    if (wholeValue <= 0) {
        if (unitDef.next) {
            return buildPrimaryComponent(ms, unitDef.next);
        }
        const secondsValue = Math.max(1, Math.round(ms / MS_PER_SECOND));
        return {
            text: `${secondsValue} ${formatUnitLabel(secondsValue, 'second')}`,
            remainderMs: 0,
            usedUnit: 'second'
        };
    }

    const consumed = wholeValue * unitDef.ms;
    return {
        text: `${wholeValue} ${formatUnitLabel(wholeValue, requestedUnit)}`,
        remainderMs: Math.max(0, ms - consumed),
        usedUnit: requestedUnit
    };
}

function buildSecondaryComponent(remainderMs: number, startUnit?: ElapsedDisplayUnit): { text: string; usedUnit: ElapsedDisplayUnit } | null {
    if (!startUnit || remainderMs <= 0) return null;
    const unitDef = ELAPSED_UNIT_SEQUENCE[startUnit];
    if (!unitDef) return null;

    const wholeValue = Math.floor(remainderMs / unitDef.ms);
    if (wholeValue > 0) {
        return {
            text: `${wholeValue} ${formatUnitLabel(wholeValue, startUnit)}`,
            usedUnit: startUnit
        };
    }
    if (unitDef.next) {
        return buildSecondaryComponent(remainderMs, unitDef.next);
    }

    const secondsValue = Math.round(remainderMs / MS_PER_SECOND);
    if (secondsValue > 0) {
        return {
            text: `${secondsValue} ${formatUnitLabel(secondsValue, 'second')}`,
            usedUnit: 'second'
        };
    }
    return null;
}

function formatCompositeDuration(ms: number, primaryUnit: ElapsedDisplayUnit): string {
    const positiveMs = Math.max(0, ms);
    const primary = buildPrimaryComponent(positiveMs, primaryUnit);
    const parts = [primary.text];

    const nextUnit = ELAPSED_UNIT_SEQUENCE[primary.usedUnit]?.next;
    const secondary = buildSecondaryComponent(primary.remainderMs, nextUnit);
    if (secondary) {
        parts.push(secondary.text);
    }

    return parts.join(' + ');
}

function pickAutoElapsedUnit(ms: number): ElapsedDisplayUnit {
    if (ms < MS_PER_MINUTE) {
        return 'second';
    }
    if (ms < MS_PER_HOUR) {
        return 'minute';
    }
    if (ms < MS_PER_DAY) {
        return 'hour';
    }
    if (ms < MS_PER_WEEK) {
        return 'day';
    }
    if (ms < MS_PER_WEEK * 8) {
        return 'week';
    }
    if (ms < MS_PER_MONTH * 24) {
        return 'month';
    }
    return 'year';
}

export function formatElapsedTime(ms: number, clickCount: number = 0): string {
    if (!Number.isFinite(ms)) {
        return '0 minutes';
    }

    const safeMs = Math.max(0, Math.abs(ms));
    if (safeMs === 0) {
        return '0 minutes';
    }

    const unitIndex = ((clickCount % 5) + 5) % 5;
    let unit: ElapsedDisplayUnit;

    switch (unitIndex) {
        case 0:
            unit = pickAutoElapsedUnit(safeMs);
            break;
        case 1:
            unit = 'hour';
            break;
        case 2:
            unit = 'day';
            break;
        case 3:
            unit = 'week';
            break;
        case 4:
        default:
            unit = 'month';
            break;
    }

    return formatCompositeDuration(safeMs, unit);
}

export function dateToAngle(date: Date): number {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const dayOfYear = (date.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24);
    const daysInYear =
        (new Date(date.getFullYear(), 11, 31).getTime() - startOfYear.getTime()) /
        (1000 * 60 * 60 * 24) +
        1;
    const progress = dayOfYear / daysInYear;
    return progress * 2 * Math.PI - Math.PI / 2;
}

// Parses YYYY-MM-DD and checks if strictly before today (local date)
export function isOverdueDateString(dueString?: string, today: Date = new Date()): boolean {
    if (!dueString || typeof dueString !== 'string') return false;
    const parts = dueString.split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => isNaN(n))) return false;
    const [dueYear, dueMonth1, dueDay] = parts;
    const dueMonth = dueMonth1 - 1;
    const todayY = today.getFullYear();
    const todayM = today.getMonth();
    const todayD = today.getDate();
    if (dueYear < todayY) return true;
    if (dueYear > todayY) return false;
    if (dueMonth < todayM) return true;
    if (dueMonth > todayM) return false;
    return dueDay < todayD; // strictly before today
}

interface DurationUnitDefinition {
    key: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
    aliases: string[];
    multiplier: number;
    singular: string;
    plural: string;
}

const DURATION_UNIT_DEFINITIONS: DurationUnitDefinition[] = [
    { key: 'seconds', aliases: ['s', 'sec', 'secs', 'second', 'seconds'], multiplier: MS_PER_SECOND, singular: 'second', plural: 'seconds' },
    { key: 'minutes', aliases: ['m', 'min', 'mins', 'minute', 'minutes'], multiplier: MS_PER_MINUTE, singular: 'minute', plural: 'minutes' },
    { key: 'hours', aliases: ['h', 'hr', 'hrs', 'hour', 'hours'], multiplier: MS_PER_HOUR, singular: 'hour', plural: 'hours' },
    { key: 'days', aliases: ['d', 'day', 'days'], multiplier: MS_PER_DAY, singular: 'day', plural: 'days' },
    { key: 'weeks', aliases: ['w', 'wk', 'wks', 'week', 'weeks'], multiplier: MS_PER_WEEK, singular: 'week', plural: 'weeks' },
    { key: 'months', aliases: ['mo', 'mon', 'mos', 'month', 'months'], multiplier: MS_PER_MONTH, singular: 'month', plural: 'months' },
    { key: 'years', aliases: ['y', 'yr', 'yrs', 'year', 'years'], multiplier: MS_PER_YEAR, singular: 'year', plural: 'years' },
];

const DURATION_UNIT_ALIAS_MAP: Map<string, DurationUnitDefinition> = new Map();
DURATION_UNIT_DEFINITIONS.forEach(def => {
    def.aliases.forEach(alias => DURATION_UNIT_ALIAS_MAP.set(alias, def));
});

function formatDurationValue(value: number): string {
    if (Number.isNaN(value)) return '';
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2).replace(/\.?0+$/, '');
}

interface InternalDurationMatch {
    value: number;
    valueText: string;
    unit: DurationUnitDefinition;
}

function matchDurationDetail(duration: string | undefined): InternalDurationMatch | null {
    if (!duration || typeof duration !== 'string') return null;
    const trimmed = duration.trim().toLowerCase();
    if (!trimmed) return null;
    const match = trimmed.match(/^([\d.]+)\s*([a-z]+)$/);
    if (!match) return null;
    const numeric = parseFloat(match[1]);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    const unitAlias = match[2];
    const unitDef = DURATION_UNIT_ALIAS_MAP.get(unitAlias);
    if (!unitDef) return null;
    return { value: numeric, valueText: match[1], unit: unitDef };
}

/**
 * Parse a Duration field into milliseconds
 * Supports flexible formats:
 * - "2 hours", "2h", "2 hr", "2.5 hours"
 * - "3 days", "3d", "3 day"
 * - "1 week", "1w", "1.5 weeks"
 * - "2 months", "2mo", "2 month"
 * - "1 year", "1y", "1 yr"
 * - "30 minutes", "30m", "30min"
 * - "45 seconds", "45s", "45sec"
 */
export function parseDuration(duration: string | undefined): number | null {
    if (!duration || typeof duration !== 'string') return null;

    const trimmed = duration.trim().toLowerCase();
    if (trimmed === '' || trimmed === '0') return 0;

    const match = matchDurationDetail(duration);
    if (!match) return null;
    if (match.value === 0) return 0;
    return match.value * match.unit.multiplier;
}

export type DurationUnitKey = DurationUnitDefinition['key'];

export interface ParsedDurationDetail {
    value: number;
    valueText: string;
    unitKey: DurationUnitKey;
    unitSingular: string;
    unitPlural: string;
    ms: number;
}

export function parseDurationDetail(duration: string | undefined): ParsedDurationDetail | null {
    const match = matchDurationDetail(duration);
    if (!match) return null;
    if (match.value <= 0) return null;
    return {
        value: match.value,
        valueText: formatDurationValue(match.value),
        unitKey: match.unit.key,
        unitSingular: match.unit.singular,
        unitPlural: match.unit.plural,
        ms: match.value * match.unit.multiplier,
    };
}

export function durationSelectionToMs(selection: string | undefined): number | null {
    if (!selection || selection === 'auto') return null;
    const [valuePart, unitKey] = selection.split('|');
    if (!valuePart || !unitKey) return null;
    const value = parseFloat(valuePart);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unitDef = DURATION_UNIT_DEFINITIONS.find(def => def.key === unitKey);
    if (!unitDef) return null;
    return value * unitDef.multiplier;
}

export function formatDurationSelectionLabel(selection: string | undefined): string | null {
    if (!selection || selection === 'auto') return null;
    const [valuePart, unitKey] = selection.split('|');
    if (!valuePart || !unitKey) return null;
    const value = parseFloat(valuePart);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unitDef = DURATION_UNIT_DEFINITIONS.find(def => def.key === unitKey);
    if (!unitDef) return null;
    const formattedValue = formatDurationValue(value);
    const unitLabel = value === 1 ? unitDef.singular : unitDef.plural;
    return `${formattedValue} ${unitLabel}`;
}

/**
 * Filter and deduplicate scenes for discontinuity detection
 * SINGLE SOURCE OF TRUTH for scene filtering logic used in both settings display and rendering
 * 
 * This ensures the discontinuity threshold shown in settings matches the actual calculation.
 * 
 * Rules:
 * 1. Only include Scene items (exclude Plot/Beat)
 * 2. Deduplicate by path/title (same scene appearing multiple times)
 * 3. Only include scenes with valid When dates
 * 4. Return sorted chronologically
 * 
 * @param scenes - Raw scene array from timeline data
 * @returns Filtered, deduplicated, sorted array of scenes with when dates
 */
export function prepareScenesForDiscontinuityDetection(
    scenes: { when?: Date; itemType?: string; path?: string; title?: string }[]
): { when: Date }[] {
    // Filter to only Scene items (not Plot/Beat) with valid dates
    const uniqueScenesMap = new Map<string, { when: Date }>();
    scenes.forEach(scene => {
        if (scene.itemType !== 'Scene') return;
        if (!(scene.when instanceof Date)) return;
        const key = scene.path || `title:${scene.title || ''}`;
        if (!uniqueScenesMap.has(key)) {
            uniqueScenesMap.set(key, { when: scene.when });
        }
    });

    // Sort chronologically
    const uniqueScenes = Array.from(uniqueScenesMap.values());
    return uniqueScenes.sort((a, b) => a.when.getTime() - b.when.getTime());
}

/**
 * Calculate auto discontinuity threshold (3× median gap between scenes)
 * SINGLE SOURCE OF TRUTH for auto-threshold calculation
 * 
 * @param scenes - Raw scene array (will be filtered/deduplicated internally)
 * @returns Threshold in milliseconds, or null if cannot be calculated
 */
export function calculateAutoDiscontinuityThreshold(
    scenes: { when?: Date; itemType?: string; path?: string; title?: string }[]
): number | null {
    const preparedScenes = prepareScenesForDiscontinuityDetection(scenes);

    if (preparedScenes.length < 3) {
        return null;
    }

    // Calculate gaps between consecutive scenes
    const gaps: number[] = [];
    for (let i = 1; i < preparedScenes.length; i++) {
        const gap = preparedScenes[i].when.getTime() - preparedScenes[i - 1].when.getTime();
        if (gap >= 0) {
            gaps.push(gap);
        }
    }

    if (gaps.length === 0) {
        return null;
    }

    // Calculate median gap
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianIndex = Math.floor(sortedGaps.length / 2);
    const medianGap = sortedGaps[medianIndex];

    // If median gap is 0 or very small, many scenes have identical/close timestamps
    // In this case, use the median of NON-ZERO gaps to find the typical meaningful gap
    if (medianGap === 0) {
        const nonZeroGaps = sortedGaps.filter(g => g > 0);
        if (nonZeroGaps.length === 0) {
            // All gaps are 0 - all scenes have the same timestamp
            return null;
        }
        // Use the median of non-zero gaps instead of the overall median
        const nonZeroMedianIndex = Math.floor(nonZeroGaps.length / 2);
        const nonZeroMedian = nonZeroGaps[nonZeroMedianIndex];
        return nonZeroMedian * 3;
    }

    // Return 3× median
    return medianGap * 3;
}

/**
 * Detect discontinuities in scene timeline
 * Returns indices of scenes that have unusually large time gaps before them
 * 
 * @param scenes - Array of scenes with When dates (sorted chronologically)
 * @param thresholdMs - Absolute threshold in milliseconds. Gaps larger than this are considered discontinuities.
 * @returns Array of scene indices with large gaps before them
 */
export function detectDiscontinuities(
    scenes: { when?: Date }[],
    thresholdMs: number
): number[] {
    if (scenes.length < 3) {
        return [];
    }

    if (!thresholdMs || thresholdMs <= 0) {
        return [];
    }

    // Find scenes with gaps >= threshold
    const discontinuityIndices: number[] = [];

    for (let i = 1; i < scenes.length; i++) {
        const prev = scenes[i - 1].when;
        const curr = scenes[i].when;

        if (prev && curr) {
            const gap = curr.getTime() - prev.getTime();
            if (gap >= 0 && gap >= thresholdMs) {
                discontinuityIndices.push(i);
            }
        }
    }

    return discontinuityIndices;
}

/**
 * Detect scene overlaps in timeline
 * Returns indices of scenes that temporally overlap with the next scene
 * (scene.When + scene.Duration > nextScene.When)
 * 
 * @param scenes - Array of scenes with When dates and Duration fields (sorted chronologically)
 * @returns Set of scene indices that have temporal overlaps
 */
export function detectSceneOverlaps(scenes: { when?: Date; Duration?: string }[]): Set<number> {
    const overlaps = new Set<number>();

    for (let i = 0; i < scenes.length - 1; i++) {
        const current = scenes[i];
        const next = scenes[i + 1];

        if (!current.when || !next.when) continue;

        const durationMs = parseDuration(current.Duration);
        if (durationMs === null || durationMs === 0) continue;

        const currentEnd = current.when.getTime() + durationMs;
        const nextStart = next.when.getTime();

        if (currentEnd > nextStart) {
            overlaps.add(i); // Mark current scene as overlapping
        }
    }

    return overlaps;
}

/**
 * Tick information for rendering timeline marks
 * Compatible with existing month rendering infrastructure
 */
export interface ChronologicalTickInfo {
    angle: number;      // Radians (0 = top, clockwise)
    name: string;       // Full label: "Day 1", "Week 2", "January", "Year 1"
    shortName: string;  // Short label: "D1", "W2", "Jan", "Y1"
    isMajor?: boolean;  // Optional: true for solid lines, false/undefined for dotted
    isFirst?: boolean;  // Optional: true for first scene label (beginning date)
    isLast?: boolean;   // Optional: true for last scene label (ending date)
    sceneIndex?: number; // Optional: sorted scene index for matching with elapsed markers
    earthDate?: string; // Optional: ISO date string for alien mode conversion
}

/**
 * Generate chronological ticks based on actual scene time distribution
 * Returns ticks in same format as calendar months for compatibility
 * 
 * @param scenes - Array of scenes with When dates
 * @returns Array of tick info matching month format { angle, name, shortName }
 */
/**
 * Generate chronological ticks aligned to actual scene positions
 * Returns ticks in same format as calendar months for compatibility
 * 
 * @param scenes - Array of scenes with When dates (already sorted chronologically)
 * @param sceneStartAngles - Optional array of scene start angles (beginning of each scene's angular slice)
 * @param sceneAngularSize - Optional angular size of each scene (for calculating end angles when needed)
 * @returns Array of tick info matching month format { angle, name, shortName }
 */
export function generateChronologicalTicks(
    scenes: { when?: Date }[],
    sceneStartAngles?: number[],
    sceneAngularSize?: number,
    timeSpan?: TimeSpanInfo
): ChronologicalTickInfo[] {
    // Filter scenes with valid dates, preserving chronological order
    const validScenes: Array<{ date: Date; sortedIndex: number }> = [];
    scenes.forEach((s, idx) => {
        if (s.when && !isNaN(s.when.getTime())) {
            validScenes.push({ date: s.when, sortedIndex: idx });
        }
    });

    if (validScenes.length === 0) {
        // No valid dates - return empty
        return [];
    }

    // Calculate time span if not provided (for intelligent labeling)
    const validDates = validScenes.map(s => s.date);
    const span = timeSpan || calculateTimeSpan(validDates);

    // Special case: Only one scene - just show that date at the top
    if (validScenes.length === 1) {
        const singleDate = validScenes[0].date;
        // Use local time methods to ensure consistency with parsing
        const month = singleDate.toLocaleString('en-US', { month: 'short' });
        const day = singleDate.getDate();
        const year = singleDate.getFullYear();
        const dateLabel = `${month} ${day}, ${year}`;

        return [{
            angle: -Math.PI / 2, // Top of circle
            name: dateLabel,
            shortName: dateLabel,
            isMajor: true
        }];
    }

    const ticks: ChronologicalTickInfo[] = [];
    const numScenes = validScenes.length;

    // Get scene start angle - use provided start angles (aligned to scene beginnings)
    const getSceneStartAngle = (sortedIndex: number): number => {
        if (sceneStartAngles && sceneStartAngles[sortedIndex] !== undefined) {
            return sceneStartAngles[sortedIndex];
        }
        // Fallback: equal spacing around circle (0 = top, clockwise)
        const anglePerScene = (2 * Math.PI) / numScenes;
        return -Math.PI / 2 + (sortedIndex * anglePerScene);
    };

    // Since scenes are already sorted chronologically, first and last are at indices 0 and numScenes - 1
    const firstScene = validScenes[0];
    const lastScene = validScenes[numScenes - 1];
    const firstAngle = getSceneStartAngle(firstScene.sortedIndex);
    const lastAngle = getSceneStartAngle(lastScene.sortedIndex);

    // Decide which scenes to promote to major/labeled ticks
    // Use balanced distribution across the timeline
    // Ensure step evenly divides the scene count for balanced distribution
    const MAX_MAJOR_TICKS = 20;
    let step = 1;

    if (numScenes > MAX_MAJOR_TICKS) {
        // Calculate step that gives us approximately MAX_MAJOR_TICKS major ticks
        // But ensure it divides evenly into numScenes for balanced distribution
        step = Math.ceil(numScenes / MAX_MAJOR_TICKS);

        // Find a step that evenly divides numScenes (or gets close)
        // Try to find the largest divisor <= step that gives us <= MAX_MAJOR_TICKS
        let bestStep = step;

        // Try divisors near our target step
        for (let testStep = step; testStep >= 1; testStep--) {
            const testMajorCount = Math.ceil((numScenes - 1) / testStep) + 1;
            if (testMajorCount <= MAX_MAJOR_TICKS && (numScenes - 1) % testStep === 0) {
                // Found a step that evenly divides!
                bestStep = testStep;
                break;
            }
        }

        step = bestStep;
    }

    // Build promote set using sorted indices (chronological order)
    const promoteSet = new Set<number>();
    promoteSet.add(0); // Always promote first scene
    promoteSet.add(numScenes - 1); // Always promote last scene

    // Promote every Nth scene (except first/last) for balanced distribution
    for (let i = step; i < numScenes - 1; i += step) {
        promoteSet.add(i);
    }

    // Check if first and last would overlap (they're at the same or very close angles)
    // This happens when timeline wraps around a full circle
    const angleDiff = Math.abs(lastAngle - firstAngle);
    const normalizedDiff = Math.min(angleDiff, Math.abs(angleDiff - 2 * Math.PI));
    const wouldOverlap = normalizedDiff < 0.01 || normalizedDiff > (2 * Math.PI - 0.01);

    // Calculate gaps between consecutive scenes for per-scene label adaptation
    const sceneGaps: number[] = []; // Gap in milliseconds before each scene
    for (let i = 0; i < validScenes.length; i++) {
        if (i === 0) {
            sceneGaps.push(0); // First scene has no gap
        } else {
            const gapMs = validScenes[i].date.getTime() - validScenes[i - 1].date.getTime();
            sceneGaps.push(gapMs);
        }
    }

    // Helper function to generate intelligent labels based on gap size
    const generateLabel = (sceneDate: Date, sceneIndex: number, isFirst: boolean, isLast: boolean): { name: string; shortName: string } => {
        // Helper to format time in 12-hour format with AM/PM
        const formatTime12Hour = (date: Date): string => {
            const hour = date.getHours();
            const minute = date.getMinutes();

            // Special cases for noon and midnight (elegant, matches synopsis treatment)
            if (hour === 12 && minute === 0) {
                return 'noon';
            } else if (hour === 0 && minute === 0) {
                return 'midnight';
            }

            // Regular time formatting
            const ampm = hour >= 12 ? 'pm' : 'am';
            const displayHour = hour % 12 || 12; // Convert 0 to 12
            const minuteStr = minute.toString().padStart(2, '0');
            return `${displayHour}:${minuteStr}${ampm}`;
        };

        const month = sceneDate.toLocaleString('en-US', { month: 'short' });
        const day = sceneDate.getDate();
        const year = sceneDate.getFullYear();
        const timeStr = formatTime12Hour(sceneDate);

        // Analyze gap before this scene to determine label type
        const gapMs = sceneGaps[sceneIndex];
        const gapHours = gapMs / (1000 * 60 * 60);

        // First scene: Always anchor with full context
        if (isFirst) {
            // Check if overall timeline is short (time-based) or long (date-based)
            const totalSpanHours = span.hours;
            if (totalSpanHours < 48) {
                // Short timeline: show date + time
                return { name: `${month} ${day}\n${timeStr}`, shortName: `${month} ${day}\n${timeStr}` };
            } else {
                // Long timeline: show year + date
                return { name: `${year}\n${month} ${day}`, shortName: `${year}\n${month} ${day}` };
            }
        }

        // Last scene: Match the format of the first scene for consistency
        if (isLast) {
            const totalSpanHours = span.hours;
            if (totalSpanHours < 48) {
                // Short timeline: show date + time (matching first scene)
                return { name: `${month} ${day}\n${timeStr}`, shortName: `${month} ${day}\n${timeStr}` };
            } else {
                // Long timeline: show year + date (matching first scene)
                return { name: `${year}\n${month} ${day}`, shortName: `${year}\n${month} ${day}` };
            }
        }

        // Intermediate scenes: Adaptive labels based on gap before this scene
        if (gapHours < 6) {
            // Gap < 6 hours: Show TIME only
            return { name: timeStr, shortName: timeStr };
        } else if (gapHours < 48) {
            // Gap 6-48 hours: Show DATE + TIME
            return { name: `${month} ${day}\n${timeStr}`, shortName: `${month} ${day}\n${timeStr}` };
        } else {
            // Gap > 48 hours: Show DATE only
            return { name: `${month} ${day}`, shortName: `${month} ${day}` };
        }
    };

    // Generate ticks aligned to scene starts (not centers)
    let lastLabeledSceneDate: Date | null = null; // Track the last scene that got a label

    for (let i = 0; i < numScenes; i++) {
        const scene = validScenes[i];
        const sceneStartAngle = getSceneStartAngle(scene.sortedIndex);

        // Calculate gap from the last LABELED scene, not just the previous scene
        let gapFromLastLabel = 0;
        if (lastLabeledSceneDate !== null) {
            gapFromLastLabel = scene.date.getTime() - lastLabeledSceneDate.getTime();
        }

        // Store the gap in sceneGaps for generateLabel to use
        if (i === 0) {
            sceneGaps[i] = 0; // First scene has no gap
        } else if (lastLabeledSceneDate === null) {
            sceneGaps[i] = 0; // No previous label yet
        } else {
            sceneGaps[i] = gapFromLastLabel; // Gap from last labeled scene
        }

        if (i === 0) {
            // First scene: intelligent label with context
            const labels = generateLabel(scene.date, i, true, false);
            ticks.push({
                angle: sceneStartAngle,
                name: labels.name,
                shortName: labels.shortName,
                isMajor: true,
                isFirst: true,
                sceneIndex: scene.sortedIndex,
                earthDate: scene.date.toISOString()
            });
            lastLabeledSceneDate = scene.date; // Update last labeled scene
        } else if (i === numScenes - 1) {
            // Last scene: intelligent label with context
            let tickAngle = sceneStartAngle;
            if (wouldOverlap && sceneAngularSize !== undefined) {
                // Offset last scene tick slightly to avoid overlap
                // Move it to the end of the last scene (start + angular size)
                tickAngle = sceneStartAngle + sceneAngularSize;
                // Normalize to [-π, π] range for display
                if (tickAngle > Math.PI) tickAngle -= 2 * Math.PI;
            }
            const labels = generateLabel(scene.date, i, false, true);
            ticks.push({
                angle: tickAngle,
                name: labels.name,
                shortName: labels.shortName,
                isMajor: true,
                isLast: true,
                sceneIndex: scene.sortedIndex,
                earthDate: scene.date.toISOString()
            });
            lastLabeledSceneDate = scene.date; // Update last labeled scene
        } else if (promoteSet.has(i)) {
            // Promoted scenes: intelligent abbreviated label
            const labels = generateLabel(scene.date, i, false, false);
            ticks.push({
                angle: sceneStartAngle,
                name: labels.name,
                shortName: labels.shortName,
                isMajor: true,
                sceneIndex: scene.sortedIndex,
                earthDate: scene.date.toISOString()
            });
            lastLabeledSceneDate = scene.date; // Update last labeled scene
        } else {
            // Minor scenes: tick mark without label (don't update lastLabeledSceneDate)
            ticks.push({
                angle: sceneStartAngle,
                name: '',
                shortName: '',
                isMajor: false,
                sceneIndex: scene.sortedIndex
            });
        }
    }
    // If every scene was promoted (no small ticks), synthesize minor ticks to maintain visual rhythm
    const hasMinorTicks = ticks.some(tick => tick.isMajor === false);
    if (!hasMinorTicks && ticks.length > 1) {
        const SYNTHETIC_INTERVAL = Math.PI / 24; // ~7.5° between minor ticks
        const MAX_SYNTHETIC_PER_GAP = 12;
        const majorTicks = ticks
            .filter(tick => tick.isMajor !== false)
            .map(tick => ({
                tick,
                positiveAngle: normalizeAnglePositive(tick.angle)
            }))
            .sort((a, b) => a.positiveAngle - b.positiveAngle);

        const syntheticTicks: ChronologicalTickInfo[] = [];
        for (let i = 0; i < majorTicks.length; i++) {
            const current = majorTicks[i];
            const next = majorTicks[(i + 1) % majorTicks.length];

            let start = current.positiveAngle;
            let end = next.positiveAngle;

            if (i === majorTicks.length - 1 || end <= start) {
                end += Math.PI * 2; // wrap around for final segment or unordered angles
            }

            const gap = end - start;
            const subdivisions = Math.min(MAX_SYNTHETIC_PER_GAP + 1, Math.floor(gap / SYNTHETIC_INTERVAL));

            for (let step = 1; step < subdivisions; step++) {
                const anglePositive = start + (gap * step) / subdivisions;
                let angle = normalizeAngleCanonical(anglePositive);

                // Skip if this synthetic tick would overlap a major tick
                if (Math.abs(angle - current.tick.angle) < 1e-3 || Math.abs(angle - next.tick.angle) < 1e-3) {
                    continue;
                }

                syntheticTicks.push({
                    angle,
                    name: '',
                    shortName: '',
                    isMajor: false
                });
            }
        }

        if (syntheticTicks.length > 0) {
            ticks.push(...syntheticTicks);
            ticks.sort((a, b) => normalizeAngleCanonical(a.angle) - normalizeAngleCanonical(b.angle));
        }
    }

    return ticks;
}

/**
 * Normalize angle to the range [-π, π]
 */
function normalizeAngleCanonical(angle: number): number {
    const twoPi = Math.PI * 2;
    let normalized = angle % twoPi;
    if (normalized <= -Math.PI) {
        normalized += twoPi;
    } else if (normalized > Math.PI) {
        normalized -= twoPi;
    }
    return normalized;
}

/**
 * Normalize angle to the range [0, 2π)
 */
function normalizeAnglePositive(angle: number): number {
    const twoPi = Math.PI * 2;
    let normalized = angle % twoPi;
    if (normalized < 0) {
        normalized += twoPi;
    }
    return normalized;
}
