import type { PlanetaryProfile } from '../types';

type Unit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';
const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;

/** Compact presentation for the Timetable only; the wheel retains its full labels. */
export function formatChronologueGap(ms: number, locale: string, profile: PlanetaryProfile | null = null): string {
    if (!Number.isFinite(ms) || ms === 0) return '—';
    const magnitude = Math.abs(ms);
    const sign = ms < 0 ? '−' : '';
    const unit = (value: number, name: Unit, decimals = 0) => new Intl.NumberFormat(locale, {
        style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: decimals,
    }).format(value);
    if (profile) {
        const localDay = profile.hoursPerDay * hour;
        const units: Array<[Unit, number]> = [
            ['year', localDay * profile.daysPerYear], ['month', localDay * profile.daysPerYear / 12],
            ['week', localDay * profile.daysPerWeek], ['day', localDay], ['hour', hour], ['minute', minute],
        ];
        const [name, size] = units.find(([, size]) => magnitude >= size * 2) ?? units[units.length - 1];
        return sign + unit(magnitude / size, name, name === 'minute' ? 0 : 1);
    }
    const week = 7 * day;
    const month = 30.44 * day;
    const year = 365.25 * day;
    const units: Array<[Unit, number]> = magnitude < minute ? [['second', second]]
        : magnitude < hour ? [['minute', minute], ['second', second]]
        : magnitude < day ? [['hour', hour], ['minute', minute], ['second', second]]
        : magnitude < week ? [['day', day], ['hour', hour], ['minute', minute], ['second', second]]
        : magnitude < 8 * week ? [['week', week], ['day', day], ['hour', hour], ['minute', minute], ['second', second]]
        : magnitude < 24 * month ? [['month', month], ['day', day], ['hour', hour], ['minute', minute], ['second', second]]
        : [['year', year], ['month', month], ['day', day], ['hour', hour], ['minute', minute], ['second', second]];
    let remainder = magnitude;
    const parts: string[] = [];
    for (const [name, size] of units) {
        const count = Math.floor(remainder / size);
        if (count > 0) { parts.push(unit(count, name)); remainder -= count * size; }
        if (parts.length === 2) break;
    }
    if (!parts.length) parts.push(unit(1, 'second'));
    const ListFormat = (Intl as typeof Intl & { ListFormat: new (locale: string, options: { style: 'short'; type: 'conjunction' }) => { format(items: string[]): string } }).ListFormat;
    return sign + new ListFormat(locale, { style: 'short', type: 'conjunction' }).format(parts);
}
