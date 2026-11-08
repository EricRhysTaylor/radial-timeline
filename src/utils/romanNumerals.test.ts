import { describe, expect, it } from 'vitest';
import { toRomanNumeral } from './romanNumerals';

describe('toRomanNumeral', () => {
    it('writes subtractive forms', () => {
        expect(toRomanNumeral(1)).toBe('I');
        expect(toRomanNumeral(4)).toBe('IV');
        expect(toRomanNumeral(9)).toBe('IX');
        expect(toRomanNumeral(14)).toBe('XIV');
        expect(toRomanNumeral(40)).toBe('XL');
        expect(toRomanNumeral(1994)).toBe('MCMXCIV');
    });

    it('uses the whole part of a fraction', () => {
        expect(toRomanNumeral(3.7)).toBe('III');
    });

    it('returns null when there is nothing to write', () => {
        expect(toRomanNumeral(0)).toBeNull();
        expect(toRomanNumeral(0.5)).toBeNull();
        expect(toRomanNumeral(-2)).toBeNull();
        expect(toRomanNumeral(Number.NaN)).toBeNull();
        expect(toRomanNumeral(Number.POSITIVE_INFINITY)).toBeNull();
    });
});
