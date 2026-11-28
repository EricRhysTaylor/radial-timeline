import { describe, expect, it } from 'vitest';
import {
    isSafeCssColor,
    safeCssColor,
    sanitizePublishStageColors,
    sanitizeSubplotColors,
} from './cssColorSafety';

describe('isSafeCssColor', () => {
    it.each([
        '#abc', '#abcd', '#a1b2c3', '#A1B2C3D4',
        'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'rgb(10% 20% 30% / 0.4)',
        'hsl(120, 50%, 50%)', 'hsla(120deg, 50%, 50%, .3)',
        'var(--rt-color-working)', 'var(--rt-color-working, #abcdef)',
        'red', 'transparent', 'none', '  #fff  ',
    ])('accepts %s', value => {
        expect(isSafeCssColor(value)).toBe(true);
    });

    it.each([
        '', '   ', '#ab', '#abcde', '#ggg',
        'red" onload="alert(1)', '#fff" onmouseover="x', "red' x='y",
        '<script>', 'url(#x)', 'url(javascript:alert(1))', 'expression(alert(1))',
        'rgb(1, 2)', 'rgb(a, b, c)', 'rgb(1,2,3) " x',
        'var(--x, var(--y))', 'var(--x, red" a="b)', 'var(x)',
        'light-blue', 'red;', `#${'a'.repeat(100)}`,
    ])('rejects %s', value => {
        expect(isSafeCssColor(value)).toBe(false);
    });

    it('rejects values that are not strings', () => {
        expect(isSafeCssColor(undefined)).toBe(false);
        expect(isSafeCssColor(null)).toBe(false);
        expect(isSafeCssColor(12)).toBe(false);
        expect(isSafeCssColor({ toString: () => '#fff' })).toBe(false);
    });
});

describe('safeCssColor', () => {
    it('returns the trimmed value when safe and the fallback otherwise', () => {
        expect(safeCssColor(' #123456 ', '#000000')).toBe('#123456');
        expect(safeCssColor('red" onload="x', '#000000')).toBe('#000000');
        expect(safeCssColor(undefined, '#000000')).toBe('#000000');
    });
});

describe('sanitizePublishStageColors', () => {
    const defaults = { Zero: '#111111', Author: '#222222', House: '#333333', Press: '#444444' };

    it('keeps safe colours, replaces unsafe ones with that stage default, and drops unknown stages', () => {
        const result = sanitizePublishStageColors({
            Zero: '#abcdef',
            Author: '#fff" onload="alert(1)',
            Press: 42,
            'x" onload="y': '#000000',
        }, defaults);
        expect(result).toEqual({ Zero: '#abcdef', Author: '#222222', House: '#333333', Press: '#444444' });
    });

    it('falls back to every default when the stored value is not an object', () => {
        expect(sanitizePublishStageColors('nope', defaults)).toEqual(defaults);
        expect(sanitizePublishStageColors(['#fff'], defaults)).toEqual(defaults);
    });
});

describe('sanitizeSubplotColors', () => {
    const defaults = ['#000001', '#000002', '#000003'];

    it('replaces each unsafe slot with its own default without shifting slots', () => {
        expect(sanitizeSubplotColors(['#ffffff', 'x" onclick="y', '#eeeeee'], defaults))
            .toEqual(['#ffffff', '#000002', '#eeeeee']);
    });

    it('fills missing slots and repeats the palette for extra slots', () => {
        expect(sanitizeSubplotColors(['#ffffff'], defaults)).toEqual(['#ffffff', '#000002', '#000003']);
        expect(sanitizeSubplotColors(['#a', '#b', '#c', '<x>'], defaults))
            .toEqual(['#000001', '#000002', '#000003', '#000001']);
        expect(sanitizeSubplotColors(undefined, defaults)).toEqual(defaults);
    });
});
