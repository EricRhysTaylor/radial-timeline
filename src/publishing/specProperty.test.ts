/*
 * Property tests for `generateDesignedStyleTex`.
 *
 * Strategy: build a seeded random DesignedStyleSpec generator and assert a set
 * of invariants over the resulting `.tex` output. We sweep N=200 random specs
 * per run; the seed is logged so any failure is reproducible.
 *
 * Invariants are split into:
 *   • universal       — must hold for every spec
 *   • conditional     — hold only when a particular axis is in a given state
 *
 * No fast-check dependency: a 100-line hand-rolled PRNG is sufficient for the
 * shape of this domain (closed enums + bounded numerics) and keeps the test
 * file self-contained.
 *
 * Companion to `scripts/audit-spec-coverage.mjs` (structural) and
 * `contractAlignment.test.ts` (specific bundled-template invariants).
 */
import { describe, it, expect } from 'vitest';
import {
    DESIGNED_STYLE_SPEC_VERSION,
    generateDesignedStyleTex,
    type DesignArchetype,
    type DesignedStyleSpec,
    type DesignedHeaderField,
} from './designedStyle';
import { escapeForLatex } from './designedStyleFragments';
import type { ManuscriptSceneHeadingMode } from '../utils/manuscript';

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return function rng() {
        s = (s + 0x6D2B79F5) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
    return arr[Math.floor(rng() * arr.length)];
}

function maybe<T>(rng: () => number, value: T, p = 0.5): T | undefined {
    return rng() < p ? value : undefined;
}

function range(rng: () => number, min: number, max: number, step = 0.01): number {
    const span = (max - min) / step;
    const n = Math.floor(rng() * (span + 1)) * step;
    return Math.round((min + n) * 1000) / 1000;
}

// ─── Generators ──────────────────────────────────────────────────────────────
const ARCHETYPES: readonly DesignArchetype[] = ['submission', 'reading-draft', 'literary', 'structured'];
const FONTS = ['sorts-mill-goudy', 'latin-modern', 'source-serif', 'eb-garamond', 'crimson', 'system-serif', 'system-sans'] as const;
const HEADER_MODES = ['none', 'centered-title', 'split-author-page-title-page', 'left-title-right-context'] as const;
const HEADER_FIELDS = ['page', 'author', 'title', 'scene-context', 'chapter', 'empty'] as const;
const PARTS_MODES = ['off', 'roman', 'arabic', 'word'] as const;
const CHAPTER_MODES = ['off', 'numbered', 'titled', 'numbered-titled'] as const;
const SCENE_OPENERS = ['inline-separator', 'dedicated-page', 'roman-with-rule'] as const;
const SCENE_HEADINGS: readonly ManuscriptSceneHeadingMode[] = ['scene-number', 'scene-number-title', 'title-only'];
const FOLIO_POSITIONS = ['header', 'bottom-center', 'none'] as const;
const FOLIO_FORMATS = ['arabic', 'roman-frontmatter'] as const;
const ATTR_STYLES = ['em-dash-caps', 'plain'] as const;

function randomHeaderField(rng: () => number): DesignedHeaderField | undefined {
    const r = rng();
    if (r < 0.35) return undefined; // most slots empty
    if (r < 0.92) return pick(rng, HEADER_FIELDS) as DesignedHeaderField;
    return { literal: 'lit-' + Math.floor(rng() * 1000) };
}

function randomSpec(rng: () => number): DesignedStyleSpec {
    const useCustomPaper = rng() < 0.15;
    const paperSize: DesignedStyleSpec['paperSize'] = useCustomPaper
        ? { widthIn: range(rng, 5, 9, 0.25), heightIn: range(rng, 7, 12, 0.25) }
        : pick(rng, ['us-trade-6x9', 'us-letter', 'a4'] as const);
    const mirrored = rng() < 0.4;
    const partsMode = pick(rng, PARTS_MODES);
    const chaptersMode = pick(rng, CHAPTER_MODES);
    const sceneOpener = pick(rng, SCENE_OPENERS);
    const useMultiMode = rng() < 0.2;

    return {
        specVersion: DESIGNED_STYLE_SPEC_VERSION,
        archetype: pick(rng, ARCHETYPES),
        paperSize,
        margins: {
            topIn:    range(rng, 0.5, 1.5, 0.05),
            bottomIn: range(rng, 0.5, 1.5, 0.05),
            leftIn:   range(rng, 0.5, 1.5, 0.05),
            rightIn:  range(rng, 0.5, 1.5, 0.05),
            mirrored,
        },
        body: {
            font: pick(rng, FONTS),
            fontFallbackChain: [],
            sizePt: 8 + Math.floor(rng() * 7), // 8..14
            lineSpacing: range(rng, 1.0, 2.0, 0.05),
            paragraphIndentEm: maybe(rng, range(rng, 0, 2, 0.1), 0.7),
            firstLineIndentSuppressedAfterBreak: maybe(rng, rng() < 0.5, 0.5),
        },
        runningHeader: {
            mode: pick(rng, HEADER_MODES),
            evenLeft:   randomHeaderField(rng),
            evenCenter: randomHeaderField(rng),
            evenRight:  randomHeaderField(rng),
            oddLeft:    randomHeaderField(rng),
            oddCenter:  randomHeaderField(rng),
            oddRight:   randomHeaderField(rng),
            font: rng() < 0.2 ? 'sans' : undefined,
            letterSpacing: rng() < 0.15 ? Math.floor(rng() * 25) : undefined,
        },
        folio: {
            position: pick(rng, FOLIO_POSITIONS),
            format:   pick(rng, FOLIO_FORMATS),
        },
        parts: {
            mode: partsMode,
            pageBreak: rng() < 0.7,
            title: rng() < 0.5,
            epigraph: rng() < 0.5,
            epigraphPlacement: rng() < 0.3 ? 'own-page' : 'inline',
            openAny: rng() < 0.3,
        },
        chapters: {
            mode: chaptersMode,
            pageBreak: rng() < 0.7,
            resetSceneCounter: rng() < 0.5,
            spacing: rng() < 0.4
                ? { topFraction: range(rng, 0, 0.5, 0.02), bottomFraction: range(rng, 0, 0.3, 0.02) }
                : undefined,
            secnumdepth: rng() < 0.2 ? 1 : 0,
        },
        scene: {
            opener: sceneOpener,
            headingMode: pick(rng, SCENE_HEADINGS),
            suppressHeaderFooterOnOpener: rng() < 0.7,
            separatorGlyph: sceneOpener === 'inline-separator' ? '* * *' : undefined,
            firstWordEmphasisOnOpener: rng() < 0.4,
            openerHeadingModes: useMultiMode ? [...SCENE_HEADINGS] : undefined,
            openerSpacing: rng() < 0.3
                ? { topFraction: range(rng, 0, 0.5, 0.02), bottomFraction: range(rng, 0, 0.5, 0.02) }
                : undefined,
        },
        epigraph: {
            enabled: rng() < 0.4,
            italic: rng() < 0.7,
            attributionStyle: pick(rng, ATTR_STYLES),
        },
    };
}

// ─── Invariants ──────────────────────────────────────────────────────────────
type Issue = { rule: string; detail: string };

function checkInvariants(spec: DesignedStyleSpec, tex: string): Issue[] {
    const issues: Issue[] = [];
    const fail = (rule: string, detail: string) => issues.push({ rule, detail });

    // ── Universal invariants ──
    if (typeof tex !== 'string' || tex.length === 0) {
        fail('non-empty', 'tex is empty');
        return issues; // bail — most other checks would cascade
    }
    if (!tex.includes('\\documentclass'))      fail('documentclass', 'missing \\documentclass');
    if (!tex.includes('\\begin{document}'))    fail('begin-document', 'missing \\begin{document}');
    if (!tex.includes('$body$'))               fail('pandoc-body', 'missing $body$ pandoc placeholder');
    if (!tex.includes('\\end{document}'))      fail('end-document', 'missing \\end{document}');
    if (tex.includes('undefined'))             fail('no-undefined', 'tex contains literal `undefined`');
    if (/\$\{[^}]+\}/.test(tex))               fail('no-template-leak', 'unresolved `${...}` template literal in tex');
    if (/NaN\b/.test(tex))                     fail('no-nan',         'tex contains literal `NaN`');

    // ── Geometry ──
    const m = spec.margins;
    if (m.mirrored) {
        if (!tex.includes('inner=')) fail('mirrored-inner', 'mirrored=true but no `inner=` in geometry');
        if (!tex.includes('outer=')) fail('mirrored-outer', 'mirrored=true but no `outer=` in geometry');
    } else {
        if (!tex.includes('left='))  fail('non-mirrored-left',  'mirrored=false but no `left=` in geometry');
        if (!tex.includes('right=')) fail('non-mirrored-right', 'mirrored=false but no `right=` in geometry');
    }

    // ── Body size override ──
    const sp = spec.body.sizePt;
    if (sp < 10 || sp > 12) {
        // documentclass option is rounded to 10/11/12; the precise size must be
        // re-asserted via \fontsize override in renderBodySetup.
        if (!tex.includes(`\\fontsize{${sp}pt}{`)) {
            fail('body-size-override', `sizePt=${sp} (non-default) but no \\fontsize{${sp}pt}{...} override`);
        }
    }

    // ── Indent-first behavior ──
    if (spec.body.firstLineIndentSuppressedAfterBreak === false) {
        if (!tex.includes('\\usepackage{indentfirst}')) {
            fail('indentfirst', 'firstLineIndentSuppressedAfterBreak=false but indentfirst package not loaded');
        }
    } else {
        if (tex.includes('\\usepackage{indentfirst}')) {
            fail('indentfirst-leak', 'firstLineIndentSuppressedAfterBreak !== false but indentfirst package was loaded');
        }
    }

    // ── Open-any (chapters can start on either page side) ──
    if (spec.parts.openAny) {
        if (!tex.includes('openany')) fail('openany', 'parts.openAny=true but `openany` not in documentclass options');
    }

    // ── Parts ──
    if (spec.parts.mode !== 'off') {
        if (!tex.includes('\\newcommand{\\rtPart}')) {
            fail('rtPart-defined', 'parts on but \\rtPart macro not defined');
        }
        // Arity is invariant across every spec: the export always emits four
        // arguments, so a layout that doesn't print titles must still accept one.
        if (!tex.includes('\\newcommand{\\rtPart}[4]')) {
            fail('rtPart-arity', 'parts on but \\rtPart does not take the 4 arguments the export emits');
        }
        // parts.title decides only whether #2 is typeset.
        const typesetsTitle = tex.includes('{\\normalfont\\itshape\\large #2}');
        if (spec.parts.title && !typesetsTitle) {
            fail('rtPart-title', 'parts.title=true but the title argument is never typeset');
        }
        if (!spec.parts.title && typesetsTitle) {
            fail('rtPart-title', 'parts.title=false but the title argument is typeset anyway');
        }
        // own-page epigraph requires an explicit cleardoublepage inside the macro
        if (spec.parts.epigraphPlacement === 'own-page' && (spec.parts.epigraph || spec.epigraph.enabled)) {
            if (!tex.includes('\\cleardoublepage')) {
                fail('part-epigraph-own-page', 'parts.epigraphPlacement=own-page (with epigraph enabled) but no \\cleardoublepage emitted');
            }
        }
    }

    // ── Chapters ──
    if (spec.chapters.mode !== 'off') {
        // The macro emitted may be \rtChapter or \rtChapterTitled; both share the prefix.
        if (!/\\newcommand\{\\rtChapter/.test(tex)) {
            fail('rtChapter-defined', 'chapters on but \\rtChapter* macro not defined');
        }
    }

    // ── Scene opener ──
    if (spec.scene.opener === 'dedicated-page'
        && (!spec.scene.openerHeadingModes || spec.scene.openerHeadingModes.length === 0)) {
        if (!tex.includes('\\newcommand{\\rtSceneOpener}')) {
            fail('rtSceneOpener-defined', 'scene.opener=dedicated-page but \\rtSceneOpener macro not defined');
        }
    }
    if (spec.scene.opener === 'roman-with-rule') {
        if (!tex.includes('\\rtSceneSep')) {
            fail('rtSceneSep-defined', 'scene.opener=roman-with-rule but \\rtSceneSep macro not referenced');
        }
    }

    // ── Folio position ──
    if (spec.folio.position === 'bottom-center') {
        if (!tex.includes('\\rtBottomFolio') && !tex.includes('\\thepage')) {
            fail('folio-bottom', 'folio.position=bottom-center but no folio macro / \\thepage in output');
        }
    }

    return issues;
}

// ─── The test ────────────────────────────────────────────────────────────────
describe('generateDesignedStyleTex — property tests', () => {
    // Seed pinned for reproducibility. Bump or randomize when you want fresh
    // pressure on the generator; failures print the seed for triage.
    const SEED = 0xC0FFEE;
    const N = 200;

    it(`holds invariants over ${N} random specs (seed=0x${SEED.toString(16)})`, () => {
        const rng = makeRng(SEED);
        const failures: Array<{ index: number; spec: DesignedStyleSpec; issues: Issue[] }> = [];

        for (let i = 0; i < N; i++) {
            const spec = randomSpec(rng);
            let tex: string;
            try {
                tex = generateDesignedStyleTex(spec);
            } catch (err) {
                failures.push({
                    index: i,
                    spec,
                    issues: [{ rule: 'no-throw', detail: `generator threw: ${(err as Error).message}` }],
                });
                continue;
            }
            const issues = checkInvariants(spec, tex);
            if (issues.length > 0) failures.push({ index: i, spec, issues });
        }

        if (failures.length > 0) {
            const summary = failures.slice(0, 5).map(f => {
                const summary = f.issues.map(iss => `  • [${iss.rule}] ${iss.detail}`).join('\n');
                const minimalSpec = JSON.stringify(f.spec, null, 2).split('\n').slice(0, 30).join('\n');
                return `Spec #${f.index} failed:\n${summary}\n--- spec head ---\n${minimalSpec}\n`;
            }).join('\n');
            throw new Error(
                `${failures.length}/${N} random specs violated invariants. Showing first ${Math.min(5, failures.length)}:\n\n${summary}`,
            );
        }

        expect(failures.length).toBe(0);
    });

    // ── Fixed regression cases — minimal repros for the bugs the audit caught ──
    it('regression: sizePt=14 emits \\fontsize override', () => {
        const spec: DesignedStyleSpec = baseSpec({ body: { sizePt: 14 } });
        const tex = generateDesignedStyleTex(spec);
        expect(tex).toContain('\\fontsize{14pt}{');
    });

    it('regression: sizePt=10 stays in documentclass option, no override', () => {
        const spec: DesignedStyleSpec = baseSpec({ body: { sizePt: 10 } });
        const tex = generateDesignedStyleTex(spec);
        expect(tex).toContain('[10pt');
        expect(tex).not.toContain('\\fontsize{10pt}{');
    });

    it('regression: firstLineIndentSuppressedAfterBreak=false loads indentfirst', () => {
        const spec = baseSpec({ body: { firstLineIndentSuppressedAfterBreak: false } });
        const tex = generateDesignedStyleTex(spec);
        expect(tex).toContain('\\usepackage{indentfirst}');
    });

    it('regression: firstLineIndentSuppressedAfterBreak=undefined does NOT load indentfirst', () => {
        const spec = baseSpec({});
        const tex = generateDesignedStyleTex(spec);
        expect(tex).not.toContain('\\usepackage{indentfirst}');
    });

    it('regression: parts.epigraphPlacement=own-page emits \\cleardoublepage in \\rtPart', () => {
        const spec = baseSpec({
            parts: { mode: 'roman', pageBreak: true, epigraph: true, epigraphPlacement: 'own-page' },
            epigraph: { enabled: true, italic: true, attributionStyle: 'em-dash-caps' },
        });
        const tex = generateDesignedStyleTex(spec);
        // The whole .tex contains many \cleardoublepage calls (parts/chapters use them),
        // so scope the check to the \rtPart macro definition specifically.
        const partMatch = tex.match(/\\newcommand\{\\rtPart\}\[\d+\]\{[\s\S]+?\n\}/);
        expect(partMatch).toBeTruthy();
        expect(partMatch![0]).toContain('\\cleardoublepage');
    });

    it('escapeForLatex: round-trips every special character without data loss', () => {
        // Each special character becomes a safe text-mode form. Regression:
        // braces used to be silently stripped; now they survive as visible
        // glyphs so user-typed `f(x){y}` doesn't lose information.
        expect(escapeForLatex('a & b')).toBe('a \\& b');
        expect(escapeForLatex('100% off')).toBe('100\\% off');
        expect(escapeForLatex('$cost')).toBe('\\$cost');
        expect(escapeForLatex('snake_case')).toBe('snake\\_case');
        expect(escapeForLatex('#hash')).toBe('\\#hash');
        expect(escapeForLatex('{open}')).toBe('\\{open\\}');
        expect(escapeForLatex('a^b')).toBe('a\\textasciicircum{}b');
        expect(escapeForLatex('a~b')).toBe('a\\textasciitilde{}b');
        expect(escapeForLatex('back\\slash')).toBe('back\\textbackslash{}slash');
        // Combined: every special char survives in one pass.
        expect(escapeForLatex('${&%}_#^~\\'))
            .toBe('\\$\\{\\&\\%\\}\\_\\#\\textasciicircum{}\\textasciitilde{}\\textbackslash{}');
    });

    it('regression: scene separator glyph with special chars escapes through generator', () => {
        const spec = baseSpec({
            scene: {
                opener: 'inline-separator',
                headingMode: 'scene-number',
                suppressHeaderFooterOnOpener: false,
                separatorGlyph: '~ ^ & %',
            },
        });
        const tex = generateDesignedStyleTex(spec);
        expect(tex).toContain('\\textasciitilde{}');
        expect(tex).toContain('\\textasciicircum{}');
        expect(tex).toContain('\\&');
        expect(tex).toContain('\\%');
    });

    it('per-corner override: literal in evenCenter overrides the centered-title preset baseline', () => {
        // mode='centered-title' baseline puts \BookTitle in CE/CO. User
        // overrides evenCenter with a literal — the override emits AFTER
        // the baseline so it wins.
        const spec = baseSpec({
            runningHeader: {
                mode: 'centered-title',
                oddCenter: 'title',
                evenCenter: { literal: 'Author & Co. 100%' },
            },
        });
        const tex = generateDesignedStyleTex(spec);
        // Baseline: \fancyhead[C]{...title...}
        expect(tex).toMatch(/\\fancyhead\[C\]\{[^}]*BookTitle/);
        // Override: \fancyhead[CE]{<escaped literal>}
        expect(tex).toContain('\\fancyhead[CE]{Author \\& Co. 100\\%}');
    });

    it('per-corner override: empty value clears the preset baseline content', () => {
        const spec = baseSpec({
            runningHeader: {
                mode: 'centered-title',
                oddCenter: 'title',
                evenCenter: 'empty',
            },
        });
        const tex = generateDesignedStyleTex(spec);
        // Override emits an empty fancyhead to wipe the preset content.
        expect(tex).toContain('\\fancyhead[CE]{}');
    });

    it('mode=none + per-corner content emits headers (corner content honored)', () => {
        const spec = baseSpec({
            runningHeader: {
                mode: 'none',
                evenCenter: { literal: 'Just my title' },
            },
        });
        const tex = generateDesignedStyleTex(spec);
        // Should NOT bail to \pagestyle{empty} when corner content exists.
        expect(tex).not.toMatch(/\\pagestyle\{empty\}\s*$/);
        expect(tex).toContain('\\fancyhead[CE]{Just my title}');
    });

    it('regression: parts.epigraphPlacement=inline does NOT emit a second \\cleardoublepage block', () => {
        // With pageBreak=true, the part macro has at most 2 cleardoublepage calls
        // (pre + post heading). own-page would add a 3rd inside the macro.
        const inlineSpec = baseSpec({
            parts: { mode: 'roman', pageBreak: true, epigraph: true, epigraphPlacement: 'inline' },
            epigraph: { enabled: true, italic: true, attributionStyle: 'em-dash-caps' },
        });
        const tex = generateDesignedStyleTex(inlineSpec);
        const partMatch = tex.match(/\\newcommand\{\\rtPart\}\[\d+\]\{[\s\S]+?\n\}/);
        const partTex = partMatch![0];
        const count = (partTex.match(/\\cleardoublepage/g) || []).length;
        expect(count).toBeLessThanOrEqual(2);
    });
});

/** Minimal known-good spec, deep-merge a partial override on top. Used for
 *  fixed regression cases above so we don't hand-write ~50 fields each time. */
function baseSpec(overrides: DeepPartial<DesignedStyleSpec>): DesignedStyleSpec {
    const base: DesignedStyleSpec = {
        specVersion: DESIGNED_STYLE_SPEC_VERSION,
        archetype: 'submission',
        paperSize: 'us-trade-6x9',
        margins: { topIn: 1, bottomIn: 1, leftIn: 1, rightIn: 1, mirrored: false },
        body: {
            font: 'system-serif',
            fontFallbackChain: [],
            sizePt: 11,
            lineSpacing: 1.5,
        },
        runningHeader: { mode: 'centered-title' },
        folio: { position: 'bottom-center' },
        parts:    { mode: 'off', pageBreak: false, epigraph: false },
        chapters: { mode: 'off', pageBreak: false, resetSceneCounter: false },
        scene: {
            opener: 'inline-separator',
            headingMode: 'scene-number',
            suppressHeaderFooterOnOpener: false,
            separatorGlyph: '* * *',
        },
        epigraph: { enabled: false, italic: false, attributionStyle: 'plain' },
    };
    return deepMerge(base, overrides);
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge<T>(base: T, overrides: DeepPartial<T>): T {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(overrides ?? {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && k in (base as Record<string, unknown>)) {
            out[k] = deepMerge((base as Record<string, unknown>)[k], v as Record<string, unknown>);
        } else {
            out[k] = v;
        }
    }
    return out as T;
}
