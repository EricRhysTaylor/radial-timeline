import { describe, expect, it, vi, afterEach } from 'vitest';
import * as obsidian from 'obsidian';
import { contextualChronologueLabels } from './chronologueLabelText';
import type { ChronologueLabel } from '../renderer/utils/Chronologue';

afterEach(() => vi.restoreAllMocks());
const label = (date: Date, precision: NonNullable<ChronologueLabel['precision']> = 'time', extra: Partial<ChronologueLabel> = {}): ChronologueLabel => ({
    name: '', shortName: '', angle: 0, isMajor: true, earthDate: date.toISOString(), precision, ...extra,
});

describe('Chronologue visible date context', () => {
    it('shows only changed context, uses day-month order and omits zero minutes', () => {
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('en');
        const labels = [label(new Date(1812, 11, 31, 10), 'time', { isFirst: true }), label(new Date(1812, 11, 31, 11)),
            label(new Date(1813, 0, 1, 11)), label(new Date(1813, 0, 1, 14)), label(new Date(1813, 0, 2, 14, 25))];
        const out = contextualChronologueLabels(labels);
        expect(out[1].name).toBe('11 AM');
        expect(out[2].name).toMatch(/1 Jan 1813/);
        expect(out[2].name).toContain('11 AM');
        expect(out[3].name).toBe('2 PM');
        expect(out[4].name).toContain('2 Jan');
        expect(out[4].name).toContain('2:25 PM');
        expect(out[4].name).not.toContain('1813');
    });
    it('suppresses duplicate instants without removing the scene tick', () => {
        const date = new Date(2085, 3, 1, 11);
        const out = contextualChronologueLabels([label(date, 'time', { isFirst: true }), label(date), label(new Date(2085, 3, 1, 12))]);
        expect(out[1].isMajor).toBe(false);
        expect(out[1].name).toBe('');
        expect(out[2].name.toLowerCase()).toContain('noon');
    });
    it('does not let a hidden label supply year context or invent time for date-only values', () => {
        const out = contextualChronologueLabels([label(new Date(2080, 0, 1), 'day', { isFirst: true }),
            label(new Date(2085, 0, 1), 'day', { isMajor: false }), label(new Date(2085, 0, 2), 'day')]);
        expect(out[2].name).toContain('2085');
        expect(out[2].name).not.toMatch(/AM|PM|:/);
    });
    it('names both eras at a BCE to CE transition', () => {
        const bce = new Date(0); bce.setFullYear(0, 0, 1); bce.setHours(12, 0, 0, 0);
        const ce = new Date(0); ce.setFullYear(1, 0, 1); ce.setHours(12, 0, 0, 0);
        const out = contextualChronologueLabels([label(bce, 'day', { isFirst: true }), label(ce, 'day')]);
        expect(out[0].name).toContain('BCE');
        expect(out[1].name).toContain('CE');
    });
});
