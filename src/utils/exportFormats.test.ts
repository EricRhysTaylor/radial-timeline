import { describe, expect, it, beforeEach, afterEach } from 'vitest';
// SAFE: test-only temp fixture setup for bundled font diagnostics.
import * as fs from 'fs';
// SAFE: test-only temp fixture setup for bundled font diagnostics.
import * as os from 'os';
// SAFE: test-only temp fixture setup for bundled font diagnostics.
import * as path from 'path';
import {
    buildCtanHint,
    buildExportFilename,
    buildGoogleFontsHint,
    getFontDiagnosticForFontKey,
    getStructuredFontDiagnostic,
    getTemplateFontDiagnostics,
    renderFontDiagnosticLine,
} from './exportFormats';
import { setVaultFontDir } from './pandocBundledLayouts';
import { DESIGNED_STYLE_SPEC_VERSION, type DesignedStyleSpec } from '../publishing/designedStyle';
import type { PandocLayoutTemplate } from '../types';

describe('buildExportFilename — manuscript PDF', () => {
    it('appends the layout abbreviation in square brackets before the extension', () => {
        const filename = buildExportFilename({
            exportType: 'manuscript',
            order: 'narrative',
            extension: 'pdf',
            fileStem: 'shail-and-trisan',
            layoutAbbreviation: 'CL',
        });
        // shape: "shail and trisan PDF <timestamp> [CL].pdf"
        // (stemToReadable preserves stem casing — title-casing is intentional book-stem behavior elsewhere.)
        expect(filename).toMatch(/^shail and trisan PDF .+ \[CL\]\.pdf$/);
    });

    it('omits the abbreviation when none is provided', () => {
        const filename = buildExportFilename({
            exportType: 'manuscript',
            order: 'narrative',
            extension: 'pdf',
            fileStem: 'Manuscript',
        });
        expect(filename).toMatch(/^Manuscript PDF .+\.pdf$/);
        expect(filename).not.toMatch(/\[/);
    });

    it('rejects malformed abbreviations rather than embedding garbage in the filename', () => {
        const filename = buildExportFilename({
            exportType: 'manuscript',
            order: 'narrative',
            extension: 'pdf',
            fileStem: 'manuscript',
            // Lowercase or non-2-letter codes are ignored — the helper guards
            // against future callers passing through malformed values that
            // would corrupt the on-disk filename.
            layoutAbbreviation: 'sm',
        });
        expect(filename).not.toMatch(/\[/);
    });

    it('does not apply abbreviation to non-PDF manuscript exports', () => {
        const filename = buildExportFilename({
            exportType: 'manuscript',
            order: 'narrative',
            manuscriptPreset: 'novel',
            extension: 'md',
            layoutAbbreviation: 'CL',
        });
        // markdown branch never reads layoutAbbreviation.
        expect(filename).not.toMatch(/\[CL\]/);
        expect(filename).toMatch(/\.md$/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// Structured font diagnostic
// ════════════════════════════════════════════════════════════════════════════

const baseSpec: DesignedStyleSpec = {
    specVersion: DESIGNED_STYLE_SPEC_VERSION,
    archetype: 'submission',
    paperSize: 'us-trade-6x9',
    margins: { topIn: 1, bottomIn: 1, leftIn: 1, rightIn: 1 },
    body: { font: 'sorts-mill-goudy', fontFallbackChain: ['TeX Gyre Pagella'], sizePt: 11, lineSpacing: 1.5 },
    runningHeader: { mode: 'centered-title' },
    folio: { position: 'bottom-center' },
    parts: { mode: 'off', pageBreak: false, epigraph: false },
    chapters: { mode: 'off', pageBreak: false, resetSceneCounter: false },
    scene: { opener: 'inline-separator', headingMode: 'scene-number', suppressHeaderFooterOnOpener: true },
    epigraph: { enabled: false, italic: false, attributionStyle: 'plain' },
};

function makeLayout(spec: DesignedStyleSpec): PandocLayoutTemplate {
    return {
        id: 'test-designed-layout',
        name: 'Test Designed Layout',
        preset: 'novel',
        path: 'test.tex',
        origin: 'designed',
        designedSpec: spec,
    };
}

describe('getStructuredFontDiagnostic — Latin Modern', () => {
    afterEach(() => {
        setVaultFontDir(undefined);
    });

    it('falls through to system check when no vault Latin Modern path is registered', () => {
        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'latin-modern' } });
        const diag = getStructuredFontDiagnostic(layout);
        expect(['ok', 'missing-bundled']).toContain(diag.state);
        expect(diag.primaryFontName).toBe('Latin Modern Roman');
        expect(diag.resolvedFontName).toBe('Latin Modern Roman');
        if (diag.state === 'missing-bundled') {
            expect(diag.installHint?.source).toBe('bundled');
        }
    });

    it('returns ok only when all required Latin Modern OTF faces exist', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-lm-ok-'));
        // Resolver looks for files under <vaultFontDir>/<slug>/, so the files
        // must live under .../latin-modern/, not at the vault root.
        const lmDir = path.join(tempRoot, 'latin-modern');
        fs.mkdirSync(lmDir, { recursive: true });
        for (const file of [
            'lmroman10-regular.otf',
            'lmroman10-italic.otf',
            'lmroman10-bold.otf',
            'lmroman10-bolditalic.otf',
        ]) {
            fs.writeFileSync(path.join(lmDir, file), '');
        }
        setVaultFontDir(tempRoot);

        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'latin-modern' } });
        const diag = getStructuredFontDiagnostic(layout);
        expect(diag.state).toBe('ok');
        expect(diag.installHint).toBeUndefined();

        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('raw template diagnostics flag a missing explicit Latin Modern Path', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-lm-missing-'));
        const templatePath = path.join(tempRoot, 'rt_modern_classic.tex');
        fs.writeFileSync(templatePath, [
            '\\usepackage{fontspec}',
            '\\setmainfont{Latin Modern Roman}[',
            `  Path = ${path.join(tempRoot, 'assets/fonts/latin-modern')} ,`,
            '  UprightFont = lmroman10-regular.otf ,',
            '  ItalicFont = lmroman10-italic.otf ,',
            '  BoldFont = lmroman10-bold.otf ,',
            '  BoldItalicFont = lmroman10-bolditalic.otf',
            ']',
        ].join('\n'));

        const diag = getTemplateFontDiagnostics(templatePath);
        expect(diag.canVerifySystemFonts).toBe(true);
        expect(diag.requiredFonts).toContain('Latin Modern Roman');
        expect(diag.missingRequiredFonts).toContain('Latin Modern Roman');

        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    /**
     * A `\setmainfont{...}` argument that is a font FILE name is resolved by
     * kpathsea from the texmf tree, never by the OS font catalog. Checking it
     * against installed system fonts always fails, producing a "Missing
     * required system font(s): lmroman10-regular.otf" Notice on an export that
     * then succeeds — observed live after Latin Modern moved to TeX-tree
     * resolution.
     */
    it('never reports a bare TeX font FILE name as a missing system font', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-texfile-'));
        const templatePath = path.join(tempRoot, 'rt_tex_tree_font.tex');
        fs.writeFileSync(templatePath, [
            '\\usepackage{fontspec}',
            // No Path= — kpathsea resolves these from the TeX distribution.
            '\\setmainfont{lmroman10-regular.otf}[',
            '  ItalicFont = lmroman10-italic.otf ,',
            '  BoldFont = lmroman10-bold.otf ,',
            '  BoldItalicFont = lmroman10-bolditalic.otf',
            ']',
        ].join('\n'));

        try {
            const diag = getTemplateFontDiagnostics(templatePath);
            expect(diag.missingRequiredFonts).toEqual([]);
            expect(diag.missingOptionalFonts).toEqual([]);
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    /**
     * A font whose `Path =` files are all present is loaded straight off disk
     * by fontspec, with no reference to the OS font catalog. Reporting it as a
     * missing *system* font produced "Missing required system font(s): Source
     * Serif 4" at export time — immediately after that font had been installed
     * successfully into the vault Pandoc folder, on an export that succeeded.
     */
    it('never reports a font as missing when its Path= files are all present', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-pathok-'));
        const fontDir = path.join(tempRoot, 'source-serif-4');
        fs.mkdirSync(fontDir, { recursive: true });
        for (const f of ['SourceSerif4-Regular.otf', 'SourceSerif4-It.otf', 'SourceSerif4-Bold.otf', 'SourceSerif4-BoldIt.otf']) {
            fs.writeFileSync(path.join(fontDir, f), 'x');
        }
        const templatePath = path.join(tempRoot, 'rt_contemporary_literary.tex');
        fs.writeFileSync(templatePath, [
            '\\usepackage{fontspec}',
            '\\setmainfont{Source Serif 4}[',
            `  Path = ${fontDir}/ ,`,
            '  UprightFont = SourceSerif4-Regular.otf ,',
            '  ItalicFont = SourceSerif4-It.otf ,',
            '  BoldFont = SourceSerif4-Bold.otf ,',
            '  BoldItalicFont = SourceSerif4-BoldIt.otf',
            ']',
        ].join('\n'));

        try {
            const diag = getTemplateFontDiagnostics(templatePath);
            expect(diag.requiredFonts).toContain('Source Serif 4');
            expect(diag.missingRequiredFonts).toEqual([]);
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('raw template diagnostics treat IfFontExistsTF plus errmessage as a required exact font', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-font-required-'));
        const templatePath = path.join(tempRoot, 'rt_exact_font.tex');
        fs.writeFileSync(templatePath, [
            '\\usepackage{fontspec}',
            '\\IfFontExistsTF{Source Serif 4}{',
            '  \\setmainfont{Source Serif 4}',
            '}{',
            '  \\errmessage{Radial Timeline PDF style requires Source Serif 4; install Source Serif 4 or choose another PDF style}',
            '}',
        ].join('\n'));

        const diag = getTemplateFontDiagnostics(templatePath);
        expect(diag.requiredFonts).toContain('Source Serif 4');
        expect(diag.optionalFonts).not.toContain('Source Serif 4');

        fs.rmSync(tempRoot, { recursive: true, force: true });
    });
});

describe('getStructuredFontDiagnostic — Sorts Mill Goudy (bundled)', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-fontdiag-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch { /* noop */ }
        // Reset module-level path so other tests aren't affected.
        setVaultFontDir(undefined);
    });

    it('returns state: ok when bundled .ttf files are present on disk', () => {
        // Mirror the real layout: <root>/sorts-mill-goudy/SortsMillGoudy-{Regular,Italic}.ttf
        const fontDir = path.join(tempRoot, 'sorts-mill-goudy');
        fs.mkdirSync(fontDir, { recursive: true });
        fs.writeFileSync(path.join(fontDir, 'SortsMillGoudy-Regular.ttf'), 'FAKE');
        fs.writeFileSync(path.join(fontDir, 'SortsMillGoudy-Italic.ttf'), 'FAKE');
        setVaultFontDir(tempRoot);

        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'sorts-mill-goudy' } });
        const diag = getStructuredFontDiagnostic(layout);
        expect(diag.state).toBe('ok');
        expect(diag.primaryFontName).toBe('Sorts Mill Goudy');
        expect(diag.resolvedFontName).toBe('Sorts Mill Goudy');
        expect(diag.installHint).toBeUndefined();
    });

    it('falls through to system check when vault assets are absent (returns ok if system has it, missing-bundled otherwise)', () => {
        // The new resolver chain: vault → system → fail. When the vault dir
        // is empty, we don't immediately report missing — we let the system
        // catalog have a turn. Either outcome ('ok' on dev machines that
        // have Sorts Mill Goudy installed, 'missing-bundled' on cleanroom
        // CI) is valid; what we pin is that the helper never crashes and
        // never reports missing-system for a font with bundled-file entries.
        setVaultFontDir(tempRoot);

        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'sorts-mill-goudy' } });
        const diag = getStructuredFontDiagnostic(layout);
        expect(['ok', 'missing-bundled']).toContain(diag.state);
        if (diag.state === 'missing-bundled') {
            expect(diag.installHint?.source).toBe('bundled');
            expect(diag.installHint?.message).toMatch(/Install fonts/i);
        }
    });

    it('returns state: ok for bundled Source Serif 4 when required OTF files are present', () => {
        const fontDir = path.join(tempRoot, 'source-serif-4');
        fs.mkdirSync(fontDir, { recursive: true });
        for (const file of [
            'SourceSerif4-Regular.otf',
            'SourceSerif4-It.otf',
            'SourceSerif4-Bold.otf',
            'SourceSerif4-BoldIt.otf',
        ]) {
            fs.writeFileSync(path.join(fontDir, file), 'FAKE');
        }
        setVaultFontDir(tempRoot);

        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'source-serif' } });
        const diag = getStructuredFontDiagnostic(layout);
        expect(diag.state).toBe('ok');
        expect(diag.primaryFontName).toBe('Source Serif 4');
        expect(diag.resolvedFontName).toBe('Source Serif 4');
        expect(diag.installHint).toBeUndefined();
    });

    it('falls through to system check for Source Serif 4 when bundled files are absent', () => {
        setVaultFontDir(tempRoot);

        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'source-serif' } });
        const diag = getStructuredFontDiagnostic(layout);
        expect(['ok', 'missing-bundled']).toContain(diag.state);
        if (diag.state === 'missing-bundled') {
            expect(diag.installHint?.source).toBe('bundled');
            expect(diag.installHint?.message).toMatch(/source-serif-4/);
        }
    });
});

describe('getStructuredFontDiagnostic — structured shape', () => {
    it('has the expected shape: state + primaryFontName + resolvedFontName (+ optional installHint)', () => {
        // EB Garamond is non-bundled, non-system-special. On a CI runner
        // without a font catalog (or without EB Garamond installed) we expect
        // either 'ok' (catalog miss → assume installed) or 'missing-system'
        // with a Google Fonts hint. Either shape is valid; the test pins the
        // type-shape so future refactors can't accidentally drop fields.
        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'eb-garamond' } });
        const diag = getStructuredFontDiagnostic(layout);

        expect(['ok', 'missing-system', 'missing-bundled']).toContain(diag.state);
        expect(typeof diag.primaryFontName).toBe('string');
        expect(diag.primaryFontName.length).toBeGreaterThan(0);
        expect(typeof diag.resolvedFontName).toBe('string');
        expect(diag.resolvedFontName.length).toBeGreaterThan(0);

        if (diag.state === 'missing-system') {
            expect(diag.installHint).toBeDefined();
            expect(['google-fonts', 'ctan']).toContain(diag.installHint!.source);
            if (diag.installHint!.source === 'google-fonts') {
                expect(diag.installHint!.url).toMatch(/^https:\/\/fonts\.google\.com\//);
            }
            expect(typeof diag.installHint!.message).toBe('string');
        }
    });

    it('returns a generic ok diagnostic for layouts without a spec', () => {
        const layoutNoSpec: PandocLayoutTemplate = {
            id: 'custom-no-spec',
            name: 'Custom',
            preset: 'novel',
            path: 'custom.tex',
        };
        const diag = getStructuredFontDiagnostic(layoutNoSpec);
        expect(diag.state).toBe('ok');
        expect(diag.installHint).toBeUndefined();
    });
});

describe('renderFontDiagnosticLine', () => {
    it('returns null for ok state (no line to render)', () => {
        expect(renderFontDiagnosticLine({
            state: 'ok',
            primaryFontName: 'Latin Modern Roman',
            resolvedFontName: 'Latin Modern Roman',
        })).toBeNull();
    });

    it('renders the install hint for missing system fonts', () => {
        const line = renderFontDiagnosticLine({
            state: 'missing-system',
            primaryFontName: 'EB Garamond',
            resolvedFontName: 'EB Garamond',
            installHint: {
                source: 'google-fonts',
                url: 'https://fonts.google.com/specimen/EB+Garamond',
                message: 'Install EB Garamond from Google Fonts.',
            },
        });
        expect(line).toMatch(/Install EB Garamond/);
        expect(line).not.toMatch(/Using TeX Gyre Pagella/);
    });

    it('renders the bundled-asset install message for missing-bundled', () => {
        const line = renderFontDiagnosticLine({
            state: 'missing-bundled',
            primaryFontName: 'Sorts Mill Goudy',
            resolvedFontName: 'Sorts Mill Goudy',
            installHint: {
                source: 'bundled',
                message: 'Signature Literary requires bundled Sorts Mill Goudy files in Radial Timeline/Pandoc/fonts/sorts-mill-goudy. Click Install fonts in Settings > Publish.',
            },
        });
        expect(line).toMatch(/Install fonts/i);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// OS-aware install hints (Google Fonts source)
// ════════════════════════════════════════════════════════════════════════════

const GOOGLE_FONTS_URL = 'https://fonts.google.com/specimen/EB+Garamond';

describe('buildGoogleFontsHint — platform routing', () => {
    it('mac: routes through Font Book with macOS-specific steps', () => {
        const hint = buildGoogleFontsHint('EB Garamond', GOOGLE_FONTS_URL, 'mac');
        expect(hint.source).toBe('google-fonts');
        expect(hint.url).toBe(GOOGLE_FONTS_URL);
        expect(hint.message).toMatch(/Font Book/);
        expect(hint.steps).toBeDefined();
        expect(hint.steps!.length).toBeGreaterThanOrEqual(3);
        expect(hint.steps!.some(step => /Font Book/.test(step))).toBe(true);
        expect(hint.steps!.some(step => /Re-export/.test(step))).toBe(true);
    });

    it('win: routes through right-click → Install for all users', () => {
        const hint = buildGoogleFontsHint('EB Garamond', GOOGLE_FONTS_URL, 'win');
        expect(hint.source).toBe('google-fonts');
        expect(hint.url).toBe(GOOGLE_FONTS_URL);
        expect(hint.message).toMatch(/Google Fonts/);
        expect(hint.steps).toBeDefined();
        expect(hint.steps!.some(step => /Right-click/.test(step))).toBe(true);
        expect(hint.steps!.some(step => /Install for all users/.test(step))).toBe(true);
        expect(hint.steps!.some(step => /Font Book/.test(step))).toBe(false);
    });

    it('linux: routes through ~/.fonts and fc-cache', () => {
        const hint = buildGoogleFontsHint('EB Garamond', GOOGLE_FONTS_URL, 'linux');
        expect(hint.source).toBe('google-fonts');
        expect(hint.url).toBe(GOOGLE_FONTS_URL);
        expect(hint.message).toMatch(/Google Fonts/);
        expect(hint.steps).toBeDefined();
        expect(hint.steps!.some(step => /\.fonts/.test(step))).toBe(true);
        expect(hint.steps!.some(step => /fc-cache/.test(step))).toBe(true);
        expect(hint.steps!.some(step => /Font Book/.test(step))).toBe(false);
    });

    it('uses the same Google Fonts URL across all platforms', () => {
        const macHint = buildGoogleFontsHint('EB Garamond', GOOGLE_FONTS_URL, 'mac');
        const winHint = buildGoogleFontsHint('EB Garamond', GOOGLE_FONTS_URL, 'win');
        const linuxHint = buildGoogleFontsHint('EB Garamond', GOOGLE_FONTS_URL, 'linux');
        expect(macHint.url).toBe(GOOGLE_FONTS_URL);
        expect(winHint.url).toBe(GOOGLE_FONTS_URL);
        expect(linuxHint.url).toBe(GOOGLE_FONTS_URL);
    });

    it('embeds the requested font name in every platform message', () => {
        for (const platform of ['mac', 'win', 'linux'] as const) {
            const hint = buildGoogleFontsHint('Crimson Text', GOOGLE_FONTS_URL, platform);
            expect(hint.message).toMatch(/Crimson Text/);
        }
    });
});

describe('buildCtanHint — generic (no platform branching for unknown fonts)', () => {
    it('returns a generic message without steps for fonts not on Google Fonts', () => {
        const hint = buildCtanHint('TeX Gyre Pagella');
        expect(hint.source).toBe('ctan');
        expect(hint.message).toMatch(/TeX Gyre Pagella/);
        expect(hint.url).toBeUndefined();
        // No fabricated platform-specific steps for fonts whose download path
        // varies too much across distributions to give actionable guidance.
        expect(hint.steps).toBeUndefined();
    });
});

describe('getStructuredFontDiagnostic — overridePlatform threading', () => {
    it('passes overridePlatform through to the install hint when a system font is missing', () => {
        // Bundled fonts that are fully present always resolve to 'ok', and
        // Latin Modern always resolves to 'ok'. Non-bundled fonts hit the
        // system-catalog probe — depending on the test runner's environment
        // we may land in 'ok' (catalog miss → assume installed) or 'missing-system'
        // (catalog hit + font not installed). When we DO land in 'missing-system',
        // the hint MUST reflect the override platform.
        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'eb-garamond' } });
        const diag = getStructuredFontDiagnostic(layout, 'mac');
        if (diag.state === 'missing-system' && diag.installHint?.source === 'google-fonts') {
            expect(diag.installHint.steps).toBeDefined();
            expect(diag.installHint.message).toMatch(/Font Book/);
        }
        // The signature accepts overridePlatform without throwing — that's
        // the load-bearing assertion regardless of which branch fired.
        expect(['ok', 'missing-system', 'missing-bundled']).toContain(diag.state);
    });

    it('returns ok (no install hint) for a bundled font with assets present, regardless of platform', () => {
        // Sorts Mill Goudy is bundled. With files on disk we must always
        // return 'ok' — no platform-specific install steps should ever be
        // emitted, because system install isn't required.
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-fontdiag-platform-'));
        try {
            const fontDir = path.join(tempRoot, 'sorts-mill-goudy');
            fs.mkdirSync(fontDir, { recursive: true });
            fs.writeFileSync(path.join(fontDir, 'SortsMillGoudy-Regular.ttf'), 'FAKE');
            fs.writeFileSync(path.join(fontDir, 'SortsMillGoudy-Italic.ttf'), 'FAKE');
            setVaultFontDir(tempRoot);

            const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'sorts-mill-goudy' } });
            for (const platform of ['mac', 'win', 'linux'] as const) {
                const diag = getStructuredFontDiagnostic(layout, platform);
                expect(diag.state).toBe('ok');
                expect(diag.installHint).toBeUndefined();
            }
        } finally {
            try {
                fs.rmSync(tempRoot, { recursive: true, force: true });
            } catch { /* noop */ }
            setVaultFontDir(undefined);
        }
    });

    it('returns a stable diagnostic for Latin Modern across all platforms', () => {
        // Vault has no LM files → resolver falls through to system. State
        // depends on whether the dev/CI environment has Latin Modern installed
        // (TeX install ships it). Either is valid; we pin the platform
        // threading by checking the helper accepts the override without crashing.
        const layout = makeLayout({ ...baseSpec, body: { ...baseSpec.body, font: 'latin-modern' } });
        for (const platform of ['mac', 'win', 'linux'] as const) {
            const diag = getStructuredFontDiagnostic(layout, platform);
            expect(['ok', 'missing-bundled']).toContain(diag.state);
        }
    });
});

// ════════════════════════════════════════════════════════════════════════════
// Strict Font Policy (Phase 1) — getFontDiagnosticForFontKey
// ════════════════════════════════════════════════════════════════════════════
//
// These cover the spec-key-driven helper used by the Designed Style wizard's
// live preview. The wizard works on a working spec with no persisted layout,
// so it cannot use `getStructuredFontDiagnostic(layout)` directly.

describe('getFontDiagnosticForFontKey — vault-then-system resolver', () => {
    afterEach(() => {
        setVaultFontDir(undefined);
    });

    it('returns ok with the default-serif placeholder when no font key is provided', () => {
        const diag = getFontDiagnosticForFontKey(undefined);
        expect(diag.state).toBe('ok');
        expect(diag.primaryFontName).toBe('Default serif');
        expect(diag.installHint).toBeUndefined();
    });

    // Latin Modern comes from the TeX distribution, resolved by kpathsea from
    // the texmf tree. It is never bundled and never registered with the OS
    // font catalog, so it must read as resolvable unconditionally — otherwise
    // export is hard-blocked behind an "Install fonts" prompt that can never
    // satisfy it (GH #34).
    it('always reports Latin Modern as resolvable — it comes from the TeX tree', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-lm-'));
        setVaultFontDir(tempRoot);
        try {
            const diag = getFontDiagnosticForFontKey('latin-modern');
            expect(diag.state).toBe('ok');
            expect(diag.primaryFontName).toBe('Latin Modern Roman');
            expect(diag.installHint).toBeUndefined();
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    /**
     * `state: 'ok'` is ambiguous on its own — it also means "no spec, nothing
     * checked". Callers use `specDriven` to decide whether the legacy
     * template-scan probe may speak. That probe only asks whether a font is
     * installed system-wide, so for a vault-installed bundled font it says
     * "not installed" and contradicts this verdict in the same panel.
     */
    it('marks verdicts from a real font key as specDriven, and the no-key placeholder as not', () => {
        expect(getFontDiagnosticForFontKey(undefined).specDriven).toBe(false);
        for (const key of ['latin-modern', 'source-serif', 'sorts-mill-goudy', 'eb-garamond'] as const) {
            expect(getFontDiagnosticForFontKey(key).specDriven).toBe(true);
        }
    });

    it('handles sorts-mill-goudy when bundled assets are absent: falls through to system', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-strictsmg-'));
        setVaultFontDir(tempRoot);
        try {
            const diag = getFontDiagnosticForFontKey('sorts-mill-goudy');
            expect(['ok', 'missing-bundled']).toContain(diag.state);
            expect(diag.primaryFontName).toBe('Sorts Mill Goudy');
            if (diag.state === 'missing-bundled') {
                expect(diag.installHint?.source).toBe('bundled');
                expect(diag.installHint?.message).toMatch(/sorts-mill-goudy/);
            }
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('returns ok for sorts-mill-goudy when bundled .ttf files exist on disk', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-strictsmg-ok-'));
        const fontDir = path.join(tempRoot, 'sorts-mill-goudy');
        fs.mkdirSync(fontDir, { recursive: true });
        fs.writeFileSync(path.join(fontDir, 'SortsMillGoudy-Regular.ttf'), 'FAKE');
        fs.writeFileSync(path.join(fontDir, 'SortsMillGoudy-Italic.ttf'), 'FAKE');
        setVaultFontDir(tempRoot);
        try {
            const diag = getFontDiagnosticForFontKey('sorts-mill-goudy');
            expect(diag.state).toBe('ok');
            expect(diag.installHint).toBeUndefined();
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('classifies system fonts (eb-garamond) as ok or missing-system based on the system catalog', () => {
        const diag = getFontDiagnosticForFontKey('eb-garamond');
        expect(['ok', 'missing-system']).toContain(diag.state);
        expect(diag.primaryFontName).toBe('EB Garamond');
        if (diag.state === 'missing-system') {
            expect(diag.installHint?.source).toBe('google-fonts');
            expect(diag.installHint?.url).toMatch(/^https:\/\/fonts\.google\.com\//);
        }
    });

    it('requires exact Arial for system-sans', () => {
        const priorFontCatalog = process.env.RT_FONT_CATALOG;
        try {
            process.env.RT_FONT_CATALOG = 'Arial Black';
            const missingDiag = getFontDiagnosticForFontKey('system-sans', 'linux');
            expect(missingDiag.state).toBe('missing-system');
            expect(missingDiag.primaryFontName).toBe('Arial');

            process.env.RT_FONT_CATALOG = 'Arial';
            const okDiag = getFontDiagnosticForFontKey('system-sans', 'linux');
            expect(okDiag.state).toBe('ok');
            expect(okDiag.primaryFontName).toBe('Arial');
            expect(okDiag.resolvedFontName).toBe('Arial');
        } finally {
            if (priorFontCatalog === undefined) delete process.env.RT_FONT_CATALOG;
            else process.env.RT_FONT_CATALOG = priorFontCatalog;
        }
    });
});
