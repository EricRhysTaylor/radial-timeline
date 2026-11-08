/*
 * Roman numerals for part labels and manuscript part/scene numbering.
 */

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/**
 * Upper-case Roman numeral for the whole part of `value`, or null when there
 * is none to write (not a finite number, or below 1). Callers pick their own
 * fallback for null.
 */
export function toRomanNumeral(value: number): string | null {
    if (!Number.isFinite(value)) return null;
    let remaining = Math.floor(value);
    if (remaining <= 0) return null;
    let output = '';
    for (const [amount, glyph] of ROMAN_TABLE) {
        while (remaining >= amount) {
            output += glyph;
            remaining -= amount;
        }
    }
    return output;
}
