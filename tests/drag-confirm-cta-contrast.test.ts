import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';

/*
 * Begin / Dismiss in the reorder dialog (and its sibling dialogs) wear the
 * subplot's color. Every default subplot color must give a readable label
 * (4.5:1) and a visible button edge (3:1, WCAG non-text contrast) in
 * Obsidian's default dark and light themes, at rest and on hover.
 */

const css = readFileSync(resolve(process.cwd(), 'src/styles/modal.css'), 'utf8');
const SELECTOR = '.ert-ui.ert-scope--modal .ert-drag-confirm-modal .ert-mod-cta';
const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
};
const percent = (text: string, pattern: RegExp): number => {
    const match = text.match(pattern);
    expect(match, String(pattern)).not.toBeNull();
    return Number(match![1]) / 100;
};

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, share: number): Rgb => a.map((v, i) => v * share + b[i] * (1 - share)) as Rgb;
const luminance = (c: Rgb): number => {
    const [r, g, b] = c.map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

// Obsidian's default theme: --background-primary and --text-normal.
const THEMES = { dark: { background: '#1e1e1e', text: '#dadada' }, light: { background: '#ffffff', text: '#222222' } };

describe('reorder dialog Begin / Dismiss contrast', () => {
    const rest = block(SELECTOR);
    const hover = block(`${SELECTOR}:hover:not(:disabled)`);
    const tint = percent(rest, /background-color: color-mix\(in srgb, var\(--ert-confirm-accent[^)]*\)\) (\d+)%, var\(--background-primary\)\)/);
    const edge = percent(rest, /--ert-confirm-cta-edge: color-mix\(in srgb, var\(--ert-confirm-accent[^)]*\)\) (\d+)%, var\(--text-normal\)\)/);

    it('keeps the resting tint on hover, so hover costs the label no contrast', () => {
        expect(hover).not.toContain('background');
        expect(hover).toContain('box-shadow: inset 0 0 0 1px var(--ert-confirm-cta-edge)');
        expect(rest).toContain('color: var(--text-normal)');
        expect(rest).toContain('border: 1px solid var(--ert-confirm-cta-edge)');
    });

    for (const [theme, colors] of Object.entries(THEMES)) {
        it.each(DEFAULT_SETTINGS.subplotColors)(`reads in the ${theme} theme for %s`, hex => {
            const background = rgb(colors.background);
            const text = rgb(colors.text);
            const accent = rgb(hex);
            expect(contrast(text, mix(accent, background, tint))).toBeGreaterThanOrEqual(4.5);
            expect(contrast(mix(accent, text, edge), background)).toBeGreaterThanOrEqual(3);
        });
    }
});
