import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeSubplotColorIndex, readSubplotColor, SUBPLOT_COLOR_SLOTS } from './subplotColors';

function stubComputedStyle(vars: Record<string, string>): void {
    vi.stubGlobal('getComputedStyle', () => ({
        getPropertyValue: (name: string) => vars[name] ?? ''
    }));
}

const doc = { documentElement: {} } as unknown as Document; // SAFE: readSubplotColor only hands documentElement to getComputedStyle, which is stubbed

describe('normalizeSubplotColorIndex', () => {
    it('wraps onto the slot count in both directions and truncates fractions', () => {
        expect(normalizeSubplotColorIndex(0)).toBe(0);
        expect(normalizeSubplotColorIndex(SUBPLOT_COLOR_SLOTS)).toBe(0);
        expect(normalizeSubplotColorIndex(SUBPLOT_COLOR_SLOTS + 3)).toBe(3);
        expect(normalizeSubplotColorIndex(-1)).toBe(SUBPLOT_COLOR_SLOTS - 1);
        expect(normalizeSubplotColorIndex(5.9)).toBe(5);
    });

    it('lands non-finite input on slot 0', () => {
        expect(normalizeSubplotColorIndex(Number.NaN)).toBe(0);
        expect(normalizeSubplotColorIndex(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('readSubplotColor', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads the slot variable from the document', () => {
        stubComputedStyle({ '--rt-subplot-colors-2': ' #123456 ' });
        expect(readSubplotColor(doc, 2)).toBe('#123456');
        expect(readSubplotColor(doc, 2 + SUBPLOT_COLOR_SLOTS)).toBe('#123456');
    });

    it('throws instead of substituting a colour when the variable is missing', () => {
        stubComputedStyle({});
        expect(() => readSubplotColor(doc, 4)).toThrow(/--rt-subplot-colors-4/);
    });
});
