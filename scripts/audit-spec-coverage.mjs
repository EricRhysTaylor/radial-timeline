#!/usr/bin/env node
/**
 * Audit DesignedStyleSpec coverage across the three load-bearing files:
 *
 *   1. src/modals/DesignedStyleWizardModal.ts        (UI control mutates the field)
 *   2. src/publishing/layoutVisuals.ts               (pictogram / feature-list reads the field)
 *   3. src/publishing/designedStyleFragments.ts      (.tex generator emits LaTeX from the field)
 *
 * Every leaf in DesignedStyleSpec must be covered by:
 *   • a UI control (or be on KNOWN_UI_HIDDEN)
 *   • a preview helper (or be on KNOWN_PREVIEW_HIDDEN)
 *   • a generator fragment (always required — a field that doesn't reach the
 *     .tex output is dead state)
 *
 * Exit codes:
 *   0  no orphans
 *   1  one or more orphans (full report printed to stdout)
 *
 * Usage:
 *   node scripts/audit-spec-coverage.mjs
 *   npm run audit:spec-coverage
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const FILES = {
    ui:        resolve(repoRoot, 'src/modals/DesignedStyleWizardModal.ts'),
    preview:   resolve(repoRoot, 'src/publishing/layoutVisuals.ts'),
    generator: resolve(repoRoot, 'src/publishing/designedStyleFragments.ts'),
};

// Hand-maintained list of every leaf in DesignedStyleSpec. Update this when
// the spec model in `src/publishing/designedStyle.ts` changes.
//
// Each entry: { path, search }
//   path   — dotted leaf path used for reporting
//   search — array of literal substrings; ANY match in a target file = "covered"
//            (substrings are case-sensitive; pick discriminating tails)
const LEAVES = [
    { path: 'specVersion',                                 search: ['.specVersion'] },
    { path: 'archetype',                                   search: ['.archetype'] },

    { path: 'paperSize',                                   search: ['.paperSize'] },
    { path: 'paperSize.widthIn',                           search: ['.widthIn'] },
    { path: 'paperSize.heightIn',                          search: ['.heightIn'] },

    // Margins use destructured access (`m.topIn`, etc.) in generator/preview,
    // and `s.margins.topIn` in the wizard mutators. Match the bare field name
    // — it's distinct enough across the codebase.
    { path: 'margins.topIn',                               search: ['.topIn'] },
    { path: 'margins.bottomIn',                            search: ['.bottomIn'] },
    { path: 'margins.leftIn',                              search: ['.leftIn'] },
    { path: 'margins.rightIn',                             search: ['.rightIn'] },
    { path: 'margins.mirrored',                            search: ['.mirrored'] },

    { path: 'body.font',                                   search: ['body.font'] },
    { path: 'body.fontFallbackChain',                      search: ['fontFallbackChain'] },
    { path: 'body.sizePt',                                 search: ['body.sizePt', '.sizePt'] },
    { path: 'body.lineSpacing',                            search: ['body.lineSpacing', '.lineSpacing'] },
    { path: 'body.paragraphIndentEm',                      search: ['paragraphIndentEm'] },
    { path: 'body.firstLineIndentSuppressedAfterBreak',    search: ['firstLineIndentSuppressedAfterBreak'] },
    { path: 'body.microtype',                              search: ['body.microtype', '.microtype'] },

    { path: 'runningHeader.mode',                          search: ['runningHeader.mode', 'rh.mode'] },
    // Per-corner overrides live on runningHeader.{slot}; preview reads them
    // via `runningHeader.evenLeft` / `rh.evenLeft` style accesses when active.
    // Surface in the pictogram is via the resolved mode + the strip mock.
    { path: 'runningHeader.evenLeft',                      search: ['evenLeft'] },
    { path: 'runningHeader.evenCenter',                    search: ['evenCenter'] },
    { path: 'runningHeader.evenRight',                     search: ['evenRight'] },
    { path: 'runningHeader.oddLeft',                       search: ['oddLeft'] },
    { path: 'runningHeader.oddCenter',                     search: ['oddCenter'] },
    { path: 'runningHeader.oddRight',                      search: ['oddRight'] },
    { path: 'runningHeader.font',                          search: ['runningHeader.font', 'rh.font'] },
    { path: 'runningHeader.letterSpacing',                 search: ['letterSpacing'] },

    { path: 'folio.position',                              search: ['folio.position'] },
    { path: 'folio.format',                                search: ['folio.format'] },

    { path: 'parts.mode',                                  search: ['parts.mode'] },
    { path: 'parts.pageBreak',                             search: ['parts.pageBreak'] },
    { path: 'parts.epigraph',                              search: ['parts.epigraph'] },
    { path: 'parts.epigraphPlacement',                     search: ['epigraphPlacement'] },
    { path: 'parts.openAny',                               search: ['openAny'] },

    { path: 'chapters.mode',                               search: ['chapters.mode'] },
    { path: 'chapters.pageBreak',                          search: ['chapters.pageBreak'] },
    { path: 'chapters.resetSceneCounter',                  search: ['resetSceneCounter'] },
    { path: 'chapters.spacing.topFraction',                search: ['chapters.spacing', 'topFraction'] },
    { path: 'chapters.spacing.bottomFraction',             search: ['bottomFraction'] },
    { path: 'chapters.secnumdepth',                        search: ['secnumdepth'] },

    { path: 'scene.opener',                                search: ['scene.opener', 'sc.opener'] },
    { path: 'scene.headingMode',                           search: ['scene.headingMode', 'headingMode'] },
    { path: 'scene.suppressHeaderFooterOnOpener',          search: ['suppressHeaderFooterOnOpener'] },
    { path: 'scene.separatorGlyph',                        search: ['separatorGlyph'] },
    { path: 'scene.firstWordEmphasisOnOpener',             search: ['firstWordEmphasisOnOpener'] },
    { path: 'scene.openerHeadingModes',                    search: ['openerHeadingModes'] },
    { path: 'scene.openerSpacing.topFraction',             search: ['openerSpacing'] },
    { path: 'scene.openerSpacing.bottomFraction',          search: ['openerSpacing'] },

    { path: 'epigraph.enabled',                            search: ['epigraph.enabled'] },
    { path: 'epigraph.italic',                             search: ['epigraph.italic'] },
    { path: 'epigraph.attributionStyle',                   search: ['attributionStyle'] },
];

// Allow-list: leaves intentionally absent from a layer.
//
// UI_HIDDEN — no wizard control. Reasons captured inline.
const KNOWN_UI_HIDDEN = new Map([
    ['specVersion',                                'Managed by clone/migrate logic, not user-editable.'],
    ['archetype',                                  'Set once at archetype-pick time; no further control.'],
    ['paperSize.widthIn',                          'Edited via the custom paper size inputs (paperSize union).'],
    ['paperSize.heightIn',                         'Edited via the custom paper size inputs (paperSize union).'],
    ['body.fontFallbackChain',                     'Internal fallback list; not user-facing.'],
    ['body.microtype',                             'Always-on per product decision; toggle removed.'],
    ['chapters.spacing.bottomFraction',            'Removed from UI per product decision; emitted in .tex via spacing.'],
    ['chapters.secnumdepth',                       'Advanced LaTeX setting; only set automatically by Signature template.'],
    ['scene.openerHeadingModes',                   'Removed from v1 UI for simplicity (overlapped with singular Heading mode); bundled Signature still sets it inline. Defer to v2.'],
]);

// PREVIEW_HIDDEN — no pictogram / feature-list representation. Spec values
// reach the .tex but don't change the visible mock. Allow when an explicit
// reason is captured.
const KNOWN_PREVIEW_HIDDEN = new Map([
    ['specVersion',                                'Internal; not a visual axis.'],
    ['archetype',                                  'Drives variant selection but not its own preview row.'],
    ['paperSize.widthIn',                          'Reflected via describePaper(spec.paperSize).'],
    ['paperSize.heightIn',                         'Reflected via describePaper(spec.paperSize).'],
    ['body.fontFallbackChain',                     'Internal; not visualized.'],
    ['body.sizePt',                                'No pictogram axis; preview lines are nominal.'],
    ['body.paragraphIndentEm',                     'Indent not visualized in the mini pictogram.'],
    ['body.firstLineIndentSuppressedAfterBreak',   'Indent suppression not visualized.'],
    ['body.microtype',                             'Subtle typography; not visualized.'],
    ['runningHeader.font',                         'Header font swap not represented in the pictogram.'],
    ['runningHeader.letterSpacing',                'Letter-spacing not visualized in the strip mock.'],
    ['runningHeader.evenLeft',                     'Per-corner content not previewed; the strip shows mode-derived placeholders.'],
    ['runningHeader.evenCenter',                   'Per-corner content not previewed; the strip shows mode-derived placeholders.'],
    ['runningHeader.evenRight',                    'Per-corner content not previewed; the strip shows mode-derived placeholders.'],
    ['runningHeader.oddLeft',                      'Per-corner content not previewed; the strip shows mode-derived placeholders.'],
    ['runningHeader.oddRight',                     'Per-corner content not previewed; the strip shows mode-derived placeholders.'],
    ['folio.format',                               'Arabic vs Roman differs only in glyph; not surfaced in the pictogram.'],
    ['scene.headingMode',                          'Per-scene runtime axis (manuscript assembler decides), not a template-time pictogram axis.'],
    ['parts.pageBreak',                            'Surfaced via describeParts feature-row text.'],
    ['parts.epigraphPlacement',                    'Surfaced via describeParts feature-row text.'],
    ['parts.openAny',                              'Surfaced via describeParts feature-row text.'],
    ['chapters.pageBreak',                         'No visible pictogram axis; affects compile-time only.'],
    ['chapters.resetSceneCounter',                 'No visible pictogram axis; numbering convention only.'],
    ['chapters.spacing.bottomFraction',            'Removed from UI; not previewable.'],
    ['chapters.secnumdepth',                       'Compile-time numbering, not previewable.'],
    ['scene.suppressHeaderFooterOnOpener',         'Visualized via suppressHeader/suppressFooter on the SCENE pictogram.'],
    ['scene.firstWordEmphasisOnOpener',            'Subtle typography; not visualized.'],
    ['epigraph.attributionStyle',                  'Em-dash + caps vs plain — minor styling, not visualized in the small pictogram.'],
]);

// GENERATOR_HIDDEN — extremely rare; a field that consciously has no LaTeX
// output. Most fields MUST reach the generator. Empty by default.
const KNOWN_GENERATOR_HIDDEN = new Map([
    ['specVersion',           'Internal version tag; no LaTeX representation.'],
    ['archetype',             'Drives variant selection, not a direct LaTeX axis.'],
    ['scene.headingMode',     'Decided per-scene by the manuscript assembler at export time; the template just defines the macros to render whatever heading the assembler emits.'],
    ['body.fontFallbackChain', 'Superseded by publishing/fontResolver: vault → system policy, with XeLaTeX emitting its own font-not-found error. No LaTeX-level fallback cascade is generated; the chain is retained in the spec for migration only.'],
]);

function loadFiles() {
    const out = {};
    for (const [key, path] of Object.entries(FILES)) {
        try {
            out[key] = readFileSync(path, 'utf8');
        } catch (err) {
            console.error(`Failed to read ${path}: ${err.message}`);
            process.exit(2);
        }
    }
    return out;
}

function check(text, search) {
    return search.some(needle => text.includes(needle));
}

function main() {
    const sources = loadFiles();
    const rows = [];
    for (const leaf of LEAVES) {
        const ui  = check(sources.ui,  leaf.search);
        const pv  = check(sources.preview, leaf.search);
        const gn  = check(sources.generator, leaf.search);

        const uiAllowed = !ui && KNOWN_UI_HIDDEN.has(leaf.path);
        const pvAllowed = !pv && KNOWN_PREVIEW_HIDDEN.has(leaf.path);
        const gnAllowed = !gn && KNOWN_GENERATOR_HIDDEN.has(leaf.path);

        const issues = [];
        if (!ui && !uiAllowed) issues.push('no UI control');
        if (!pv && !pvAllowed) issues.push('no preview helper');
        if (!gn && !gnAllowed) issues.push('no generator emission');

        rows.push({
            path: leaf.path,
            ui, pv, gn,
            uiAllowed, pvAllowed, gnAllowed,
            issues,
        });
    }

    const fails = rows.filter(r => r.issues.length > 0);
    const allowed = rows.filter(r => r.issues.length === 0 && (r.uiAllowed || r.pvAllowed || r.gnAllowed));
    const fullyCovered = rows.filter(r => r.ui && r.pv && r.gn);

    // Pretty-print report.
    const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
    const yes = '✓';
    const no  = '✗';
    const skip = '·';

    console.log('Spec coverage audit\n');
    console.log(pad('LEAF', 50) + pad('UI', 4) + pad('PRV', 4) + pad('GEN', 4) + 'STATUS');
    console.log('─'.repeat(80));
    for (const r of rows) {
        const ui = r.ui ? yes : (r.uiAllowed ? skip : no);
        const pv = r.pv ? yes : (r.pvAllowed ? skip : no);
        const gn = r.gn ? yes : (r.gnAllowed ? skip : no);
        const status = r.issues.length === 0
            ? (r.ui && r.pv && r.gn ? 'OK' : 'OK (allow-listed)')
            : 'FAIL: ' + r.issues.join(', ');
        console.log(pad(r.path, 50) + pad(ui, 4) + pad(pv, 4) + pad(gn, 4) + status);
    }

    console.log('\nLegend: ✓ found · skip (allow-listed) · ✗ missing');
    console.log(`\nFully covered: ${fullyCovered.length}/${rows.length}`);
    console.log(`Allow-listed:  ${allowed.length}/${rows.length}`);
    console.log(`Failures:      ${fails.length}/${rows.length}`);

    if (fails.length > 0) {
        console.log('\n❌ Audit failed. Failed leaves:');
        for (const r of fails) {
            console.log(`  • ${r.path} — ${r.issues.join(', ')}`);
        }
        console.log('\nFix by either:');
        console.log('  1. adding the missing wiring (control / preview / generator), OR');
        console.log('  2. adding the leaf to the appropriate KNOWN_* map in this script with a reason.');
        process.exit(1);
    }

    console.log('\n✅ Audit passed.');
    process.exit(0);
}

main();
