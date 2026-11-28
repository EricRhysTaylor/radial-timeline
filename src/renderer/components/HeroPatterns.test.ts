import { describe, expect, it } from 'vitest';
import { heroPatternShapesToSvgString, type HeroPattern } from './HeroPatterns';
import { sanitizeStoredHeroPatterns } from './heroPatternValidator';
import { renderDefs } from './Defs';

const validPattern: HeroPattern = {
    id: 'custom-abc123',
    name: 'Dots',
    tileW: 20,
    tileH: 20,
    fillOpacity: 0.4,
    fillRule: 'evenodd',
    shapes: [
        { tag: 'circle', attrs: { cx: '3', cy: '3', r: '3' } },
        { tag: 'path', attrs: { d: 'M0 0h10v10H0z', opacity: '0.5' } },
    ],
};

describe('heroPatternShapesToSvgString', () => {
    it('writes allowed attributes unchanged', () => {
        expect(heroPatternShapesToSvgString(validPattern))
            .toBe('<circle cx="3" cy="3" r="3"/><path d="M0 0h10v10H0z" opacity="0.5"/>');
    });

    it('escapes attribute values and drops attribute names outside the allowlist', () => {
        const tampered = {
            ...validPattern,
            shapes: [{
                tag: 'path',
                attrs: { d: 'M0 0" onload="alert(1)', onmouseover: 'alert(2)', 'x="y" onclick': 'z' },
            }],
        } as HeroPattern;
        const svg = heroPatternShapesToSvgString(tampered);
        expect(svg).toBe('<path d="M0 0&quot; onload=&quot;alert(1)"/>');
        expect(svg).not.toMatch(/onmouseover|onclick/);
    });

    it('emits nothing for a tag outside the allowlist', () => {
        const tampered = { ...validPattern, shapes: [{ tag: 'script', attrs: {} }] } as unknown as HeroPattern; // SAFE: test builds a tampered settings entry on purpose
        expect(heroPatternShapesToSvgString(tampered)).toBe('');
    });
});

describe('sanitizeStoredHeroPatterns', () => {
    it('keeps a pattern that meets the paste rules', () => {
        expect(sanitizeStoredHeroPatterns([validPattern])).toEqual([validPattern]);
    });

    it('drops tampered patterns whole and keeps the valid ones', () => {
        const stored: unknown[] = [
            validPattern,
            { ...validPattern, id: 'custom-a" onload="x' },
            { ...validPattern, tileW: '20" onload="x' },
            { ...validPattern, fillOpacity: 2 },
            { ...validPattern, fillRule: 'evenodd" x="y' },
            { ...validPattern, shapes: [{ tag: 'path', attrs: { d: 'M0 0', onload: 'alert(1)' } }] },
            { ...validPattern, shapes: [{ tag: 'path', attrs: { d: 'M0 0" onload="alert(1)' } }] },
            { ...validPattern, shapes: [{ tag: 'circle', attrs: { cx: '1', cy: '1', r: '1" x="y' } }] },
            { ...validPattern, shapes: [{ tag: 'image', attrs: { href: 'x' } }] },
            { ...validPattern, shapes: [] },
            null,
            'custom-x',
        ];
        expect(sanitizeStoredHeroPatterns(stored)).toEqual([validPattern]);
    });

    it('returns an empty list when the stored value is not an array', () => {
        expect(sanitizeStoredHeroPatterns(undefined)).toEqual([]);
        expect(sanitizeStoredHeroPatterns({})).toEqual([]);
    });
});

describe('renderDefs with tampered settings', () => {
    it('keeps stage names and colours inert in the pattern markup', () => {
        const svg = renderDefs({ 'Zero" onload="a': '#fff" onload="b' }, 1, true);
        expect(svg).not.toContain('onload="');
        expect(svg).toContain('plaidWorkingZero&quot; onload=&quot;a');
    });
});
