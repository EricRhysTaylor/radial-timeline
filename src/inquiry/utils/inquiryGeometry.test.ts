import { describe, expect, it } from 'vitest';
import { polarToCartesian } from './inquiryGeometry';

describe('polarToCartesian', () => {
    it('maps the cardinal angles for a known radius', () => {
        const r = 100;
        const at = (deg: number) => polarToCartesian(r, deg);

        expect(at(0).x).toBeCloseTo(100, 10);
        expect(at(0).y).toBeCloseTo(0, 10);

        expect(at(90).x).toBeCloseTo(0, 10);
        expect(at(90).y).toBeCloseTo(100, 10);

        expect(at(180).x).toBeCloseTo(-100, 10);
        expect(at(180).y).toBeCloseTo(0, 10);

        expect(at(270).x).toBeCloseTo(0, 10);
        expect(at(270).y).toBeCloseTo(-100, 10);

        expect(at(-90).x).toBeCloseTo(0, 10);
        expect(at(-90).y).toBeCloseTo(-100, 10);
    });

    it('maps a 45-degree diagonal', () => {
        const p = polarToCartesian(100, 45);
        expect(p.x).toBeCloseTo(70.7106781, 6);
        expect(p.y).toBeCloseTo(70.7106781, 6);
    });

    it('scales linearly with radius', () => {
        const p = polarToCartesian(250, 60);
        expect(p.x).toBeCloseTo(125, 9);
        expect(p.y).toBeCloseTo(216.5063509, 6);
    });

    // Locks the exact SVG path-serialization contract InquiryGlyph relies on
    // (toFixed(2) at the rendering boundary). Includes the signed-zero case
    // at 270 deg so path `d` output stays byte-identical.
    it('serializes to the exact fixed-2 strings used in SVG path data', () => {
        const fixed = (deg: number) => {
            const p = polarToCartesian(100, deg);
            return [p.x.toFixed(2), p.y.toFixed(2)];
        };
        expect(fixed(0)).toEqual(['100.00', '0.00']);
        expect(fixed(90)).toEqual(['0.00', '100.00']);
        expect(fixed(180)).toEqual(['-100.00', '0.00']);
        expect(fixed(270)).toEqual(['-0.00', '-100.00']);
        expect(fixed(-90)).toEqual(['0.00', '-100.00']);
        expect(fixed(45)).toEqual(['70.71', '70.71']);
    });
});
