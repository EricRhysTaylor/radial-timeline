import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * SVG accessibility/tooltip guard (added 2026-06-05, updated 2026-06-09).
 *
 * InquiryGlyph renders only SVG (createElementNS). Setting `aria-label` on an
 * SVG element triggers Obsidian's global tooltip handler, which on its
 * hover-delay timer calls `HTMLElement.isShown()` — a method Obsidian adds to
 * `HTMLElement.prototype` (its `enhance.js`) that `SVGElement` does not inherit.
 * The result is the recurring `e.isShown is not a function` crash on the
 * Inquiry question markers ("buttons of inquiry").
 *
 * SVG `<title>` is also banned: it renders the plain native OS tooltip instead
 * of the styled rt-tooltip. Marker labels must go through `addTooltipData`
 * (`data-rt-tip`), handled by the delegated rt-tooltip listener that
 * InquiryView registers on its root SVG.
 */
describe('InquiryGlyph SVG accessibility discipline', () => {
    const raw = readFileSync(resolve(process.cwd(), 'src/inquiry/components/InquiryGlyph.ts'), 'utf8');
    const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
        .replace(/(^|[^:])\/\/.*$/gm, '$1');       // line comments (preserves http://)

    it('never references aria-label (crashes Obsidian tooltip handler on SVG)', () => {
        expect(code).not.toMatch(/aria-label/);
    });

    it('never creates SVG <title> (yields the plain native OS tooltip)', () => {
        expect(code).not.toMatch(/setSvgAccessibleName/);
        expect(code).not.toMatch(/createElementNS\([^)]*['"]title['"]/);
    });

    it('labels its SVG markers via addTooltipData (styled rt-tooltip)', () => {
        expect(code).toContain('addTooltipData');
    });
});
