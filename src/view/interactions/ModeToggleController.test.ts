import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mode selector acronym typography', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/timeline.css'), 'utf8');

    it('keeps active acronym glyphs the same size and weight as inactive glyphs', () => {
        const activeRule = css.match(/\.rt-mode-option \.rt-active\.rt-mode-acronym-text\s*\{[\s\S]*?\}/)?.[0] ?? '';

        expect(activeRule).toContain('font-size: 12px');
        expect(activeRule).toContain('font-weight: normal');
        expect(activeRule).not.toContain('font-size: 14px');
        expect(activeRule).not.toContain('font-weight: 300');
    });

    it('does not stroke SVG acronym text in the active button state', () => {
        const baseRule = css.match(/\.rt-mode-option \.rt-mode-acronym-text\s*\{[\s\S]*?\}/)?.[0] ?? '';
        const activeRule = css.match(/\.rt-mode-option \.rt-active\.rt-mode-acronym-text\s*\{[\s\S]*?\}/)?.[0] ?? '';

        expect(baseRule).toContain('stroke: none');
        expect(baseRule).toContain('paint-order: fill');
        expect(activeRule).toContain('stroke: none');
    });
});
