import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';

/*
 * The reorder dialog (and its sibling dialogs: Add scene, Promote, the
 * timeline note drop) wear the subplot's color. Every default subplot color
 * must give readable text (4.5:1: badge, title, button label) and visible
 * marks (3:1, WCAG non-text contrast: icons, button edge) in Obsidian's
 * default dark and light themes, at rest and on hover.
 */

const css = readFileSync(resolve(process.cwd(), 'src/styles/modal.css'), 'utf8');
const SCOPE = '.ert-ui.ert-scope--modal .ert-drag-confirm-modal';
const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
};
const share = (text: string, pattern: RegExp): number => {
    const match = text.match(pattern);
    expect(match, String(pattern)).not.toBeNull();
    return Number(match![1]) / 100;
};

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, part: number): Rgb => a.map((v, i) => v * part + b[i] * (1 - part)) as Rgb;
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

// Obsidian's default theme: --background-primary, --background-secondary and --text-normal.
const THEMES = {
    dark: { primary: '#1e1e1e', secondary: '#262626', text: '#dadada' },
    light: { primary: '#ffffff', secondary: '#f6f6f6', text: '#222222' },
};

describe('confirm dialog contrast in the subplot color', () => {
    const scope = block(SCOPE);
    const badge = block(`${SCOPE} .ert-modal-badge`);
    const title = block(`${SCOPE} .ert-modal-title`);
    const cta = block(`${SCOPE} .ert-mod-cta`);
    const hover = block(`${SCOPE} .ert-mod-cta:hover:not(:disabled)`);
    const ink = share(scope, /--ert-confirm-ink: color-mix\(in srgb, var\(--ert-confirm-accent[^)]*\)\) (\d+)%, var\(--text-normal\)\)/);
    const edge = share(scope, /--ert-confirm-edge: color-mix\(in srgb, var\(--ert-confirm-accent[^)]*\)\) (\d+)%, var\(--text-normal\)\)/);
    const tint = share(cta, /background-color: color-mix\(in srgb, var\(--ert-confirm-accent[^)]*\)\) (\d+)%, var\(--background-primary\)\)/);
    const badgeTint = share(badge, /background: color-mix\(in srgb, var\(--ert-confirm-accent[^)]*\)\) (\d+)%, var\(--background-secondary\)\)/);
    const titleEnd = share(title, /color-mix\(in srgb, var\(--ert-confirm-ink\) (\d+)%, var\(--text-normal\)\)/);

    it('draws text in the ink, marks in the edge, and keeps the button tint on hover', () => {
        expect(badge).toContain('color: var(--ert-confirm-ink)');
        expect(title).toContain('var(--ert-confirm-ink),');
        expect(cta).toContain('color: var(--text-normal)');
        expect(cta).toContain('border: 1px solid var(--ert-confirm-edge)');
        expect(hover).not.toContain('background');
        expect(hover).toContain('box-shadow: inset 0 0 0 1px var(--ert-confirm-edge)');
        expect(block('.ert-drag-confirm-row-icon')).toContain('color: var(--ert-confirm-edge, var(--text-normal))');
        expect(block('.ert-drag-confirm-row-text .ert-drag-confirm-inline-icon')).toContain('color: var(--ert-confirm-edge, var(--text-muted))');
        // No text or mark wears the raw subplot color any more.
        expect(css).not.toMatch(/(?<![-\w])color: var\(--ert-confirm-accent/);
    });

    for (const [theme, colors] of Object.entries(THEMES)) {
        it.each(DEFAULT_SETTINGS.subplotColors)(`reads in the ${theme} theme for %s`, hex => {
            const primary = rgb(colors.primary);
            const text = rgb(colors.text);
            const accent = rgb(hex);
            const inkColor = mix(accent, text, ink);
            // Button label on its tint; button edge and icons on the dialog.
            expect(contrast(text, mix(accent, primary, tint))).toBeGreaterThanOrEqual(4.5);
            expect(contrast(mix(accent, text, edge), primary)).toBeGreaterThanOrEqual(3);
            // Title, both gradient stops, on the dialog; badge on its own tint.
            expect(contrast(inkColor, primary)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(mix(inkColor, text, titleEnd), primary)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(inkColor, mix(accent, rgb(colors.secondary), badgeTint))).toBeGreaterThanOrEqual(4.5);
        });
    }
});
