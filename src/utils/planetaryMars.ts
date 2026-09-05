import type { PlanetaryProfile } from '../types';

export const MARS_TEMPLATE_ID = 'mars-template';

export const LEGACY_MARS_MONTH_NAMES = Array.from({ length: 24 }, (_, index) => String(index + 1));

export const DARIAN_MARS_MONTH_NAMES = [
    'Sagittarius', 'Dhanus', 'Capricornus', 'Makara', 'Aquarius', 'Kumbha',
    'Pisces', 'Mina', 'Aries', 'Mesha', 'Taurus', 'Rishabha',
    'Gemini', 'Mithuna', 'Cancer', 'Karka', 'Leo', 'Simha',
    'Virgo', 'Kanya', 'Libra', 'Tula', 'Scorpius', 'Vrishika',
];

export const DARIAN_MARS_WEEKDAY_NAMES = ['Solis', 'Lunae', 'Martis', 'Mercurii', 'Jovis', 'Veneris', 'Saturni'];

export function createMarsPlanetaryProfile(): PlanetaryProfile {
    return {
        id: MARS_TEMPLATE_ID,
        label: 'Mars',
        hoursPerDay: 25,
        daysPerWeek: 7,
        daysPerYear: 668,
        epochOffsetDays: 0,
        epochLabel: 'Sol',
        monthNames: [...DARIAN_MARS_MONTH_NAMES],
        weekdayNames: [...DARIAN_MARS_WEEKDAY_NAMES],
    };
}

export function matchesLegacyMarsMonthNames(monthNames: unknown): boolean {
    return Array.isArray(monthNames)
        && monthNames.length === LEGACY_MARS_MONTH_NAMES.length
        && monthNames.every((name, index) => name === LEGACY_MARS_MONTH_NAMES[index]);
}
