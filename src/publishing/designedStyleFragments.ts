/*
 * LaTeX fragment producers for the Designed Style generator.
 *
 * Each producer is a pure (spec) => string function that returns one named
 * snippet. The main generator (designedStyle.ts) composes these snippets
 * around a Pandoc $body$ skeleton.
 *
 * The output targets XeLaTeX/pdfLaTeX through Pandoc and is meant to compile,
 * not byte-match the bundled templates. Patterns adapted from
 * src/utils/pandocBundledLayouts.ts.
 */
import { applyHeaderPreset } from './designedStyle';
import type { DesignedHeaderField, DesignedStyleSpec } from './designedStyle';
import { buildFontspecBlock } from './fontResolver';

type HeaderCornerKey =
    | 'evenLeft' | 'evenCenter' | 'evenRight'
    | 'oddLeft'  | 'oddCenter'  | 'oddRight';

const HEADER_CORNER_POSITIONS: Array<[fancyhdrPos: string, cornerKey: HeaderCornerKey]> = [
    ['LE', 'evenLeft'], ['CE', 'evenCenter'], ['RE', 'evenRight'],
    ['LO', 'oddLeft'],  ['CO', 'oddCenter'],  ['RO', 'oddRight'],
];

/**
 * Returns the per-corner overrides — corners whose live value diverges from
 * what `applyHeaderPreset` would set for the active mode. Each entry is a
 * tuple of [fancyhdr position code, current field value].
 *
 * The named-mode branches in renderFancyhdr emit baseline content; this
 * function feeds the override-emission loop that runs AFTER, so user-set
 * corners overwrite preset defaults.
 */
function computeCornerOverrides(spec: DesignedStyleSpec): Array<[string, DesignedHeaderField | undefined]> {
    // Clone the spec, apply the preset cleanly, compare each corner.
    const clone = JSON.parse(JSON.stringify(spec)) as DesignedStyleSpec;
    applyHeaderPreset(clone, spec.runningHeader.mode);
    const overrides: Array<[string, DesignedHeaderField | undefined]> = [];
    for (const [pos, key] of HEADER_CORNER_POSITIONS) {
        const liveField   = spec.runningHeader[key];
        // An absent corner is "no user opinion — use the preset", never an
        // override. Bundled specs omit corner keys entirely, and treating
        // absence as an explicit clear emitted `\fancyhead[POS]{}` after the
        // named-mode baseline, wiping running headers on every layout whose
        // preset populates that corner (Standard, Contemporary Literary).
        // A deliberate wizard clear is the distinct value 'empty'.
        if (liveField === undefined) continue;
        const presetField = clone.runningHeader[key];
        const liveJson    = JSON.stringify(liveField);
        const presetJson  = JSON.stringify(presetField ?? null);
        if (liveJson !== presetJson) {
            overrides.push([pos, liveField]);
        }
    }
    return overrides;
}

const DOC_PREAMBLE_LINES = [
    '\\providecommand{\\tightlist}{%',
    '  \\setlength{\\itemsep}{0pt}\\setlength{\\parskip}{0pt}',
    '}',
];

const PACKAGES = [
    '\\usepackage{fontspec}',
    '\\usepackage{fancyhdr}',
    '\\usepackage{titlesec}',
    '\\usepackage{geometry}',
    '\\usepackage{setspace}',
    '\\usepackage{etoolbox}',
    // emptypage suppresses headers/footers on the blank verso pages that
    // \cleardoublepage inserts when a chapter/scene/part forces the next
    // opener to start on a recto. Without this, the running header still
    // renders on the otherwise-empty page (e.g. "x | AUTHOR" floating alone).
    '\\usepackage{emptypage}',
];

function structuralPageBreak(spec: DesignedStyleSpec): string {
    return spec.parts.openAny ? '\\clearpage' : '\\cleardoublepage';
}

function standardPageBreak(): string {
    return '\\clearpage';
}

/**
 * Escape user-supplied text for safe insertion into LaTeX. Covers all 10
 * special characters; output passes the LaTeX text-mode contract.
 *
 * Single-pass replacement so the braces / backslashes we introduce don't
 * get re-escaped by a subsequent pass. Previously braces were silently
 * stripped; now they round-trip as visible glyphs.
 */
export function escapeForLatex(value: string): string {
    return value.replace(/[\\{}#$%&_^~]/g, (m) => {
        switch (m) {
            case '\\': return '\\textbackslash{}';
            case '^':  return '\\textasciicircum{}';
            case '~':  return '\\textasciitilde{}';
            default:   return `\\${m}`;
        }
    });
}

function paperGeometry(spec: DesignedStyleSpec): { width: string; height: string } {
    const paper = spec.paperSize;
    if (typeof paper === 'object') {
        return { width: `${paper.widthIn}in`, height: `${paper.heightIn}in` };
    }
    switch (paper) {
        case 'us-trade-6x9': return { width: '6in', height: '9in' };
        case 'us-letter':    return { width: '8.5in', height: '11in' };
        case 'a4':           return { width: '210mm', height: '297mm' };
        default:             return { width: '6in', height: '9in' };
    }
}

/**
 * `book` only natively supports 10/11/12pt as documentclass options. Pick the
 * closest one; if the spec asks for something else (8/9/13/14), the precise
 * value is enforced via a \fontsize override emitted from renderBodySetup.
 */
function pickDocumentClassSize(sizePt: number): '10pt' | '11pt' | '12pt' {
    if (sizePt <= 10) return '10pt';
    if (sizePt >= 12) return '12pt';
    return '11pt';
}

export function renderDocumentClass(spec: DesignedStyleSpec): string {
    // Use 'book' so chapters/parts are available. Twoside is required whenever
    // mirrored margins are on OR the running header is split (different even/odd
    // content) — `oneside` collapses page-side awareness and would break the
    // even/odd header pair.
    const opts: string[] = [pickDocumentClassSize(spec.body.sizePt)];
    const needsTwoside = spec.margins.mirrored
        || spec.runningHeader.mode === 'split-author-page-title-page'
        || spec.runningHeader.mode === 'left-title-right-context';
    opts.push(needsTwoside ? 'twoside' : 'oneside');
    if (spec.parts.openAny) opts.push('openany');
    return `\\documentclass[${opts.join(',')}]{book}`;
}

export function renderPreamble(spec: DesignedStyleSpec): string {
    const lines: string[] = [];
    lines.push(renderDocumentClass(spec));
    lines.push('');
    lines.push(...PACKAGES);
    lines.push('');
    lines.push(...DOC_PREAMBLE_LINES);
    return lines.join('\n');
}

export function renderGeometry(spec: DesignedStyleSpec): string {
    const { width, height } = paperGeometry(spec);
    const m = spec.margins;
    const innerKey = m.mirrored ? 'inner' : 'left';
    const outerKey = m.mirrored ? 'outer' : 'right';
    return [
        '\\geometry{',
        `  paperwidth=${width},`,
        `  paperheight=${height},`,
        `  top=${m.topIn}in,`,
        `  bottom=${m.bottomIn}in,`,
        `  ${innerKey}=${m.leftIn}in,`,
        `  ${outerKey}=${m.rightIn}in`,
        '}',
    ].join('\n');
}

// Font display names live in the FONT_REGISTRY in fontResolver.ts. The
// resolver is the single source of truth — adding a font means adding one
// row there, no per-font branches anywhere else.

export interface RenderFontspecOptions {
    /**
     * Absolute filesystem path to the vault-local Pandoc font root
     * (`<vault>/Radial Timeline/Pandoc/fonts`). When set and the font's
     * subdirectory contains the required files, the generator emits a
     * `\setmainfont{...}[Path = ...]` block. Otherwise it emits a plain
     * `\setmainfont{Name}` and lets XeLaTeX resolve via the system font
     * cache.
     *
     * This is the only font option. No `latinModernPath`, no
     * `bundledFontPath` — the resolver checks the vault directory directly
     * via `fs.existsSync` and decides which form to emit.
     */
    vaultFontDir?: string;
}

/**
 * Emit the font setup block for a Designed Style spec.
 *
 * Delegates to `fontResolver.buildFontspecBlock` for the actual logic.
 * Adds the standard `\defaultfontfeatures` line that all our templates
 * need (Ligatures=TeX) and threads the spec's running-header letter
 * spacing into the resolver so it can append the `\headerfont` face
 * when needed.
 *
 * No per-font branches. No `\PackageError{rt-font}` blocks. No
 * `\IfFontExistsTF` cascades. The resolver picks one of two paths
 * (vault or system) and that's it.
 */
export function renderFontspec(spec: DesignedStyleSpec, options: RenderFontspecOptions = {}): string {
    return [
        '\\defaultfontfeatures{Ligatures=TeX}',
        buildFontspecBlock({
            fontKey: spec.body.font,
            vaultFontDir: options.vaultFontDir,
            letterSpacing: spec.runningHeader.letterSpacing,
        }),
    ].join('\n');
}

function renderHeaderField(field: DesignedHeaderField | undefined): string {
    if (!field) return '';
    if (typeof field === 'object') {
        if ('literal' in field) return escapeForLatex(field.literal);
        return '';
    }
    switch (field) {
        case 'page':          return '\\thepage';
        case 'author':        return '\\AuthorName';
        case 'title':         return '\\BookTitle';
        case 'scene-context': return '\\rtSceneRunningTitle';
        case 'chapter':       return '\\leftmark';
        case 'empty':         return '';
        default:              return '';
    }
}

export function renderFancyhdr(spec: DesignedStyleSpec): string {
    const rh = spec.runningHeader;
    const lines: string[] = [];
    lines.push('$if(title)$$else$\\errmessage{Radial Timeline export requires Pandoc metadata: title}$endif$');
    lines.push('$if(author)$$else$\\errmessage{Radial Timeline export requires Pandoc metadata: author}$endif$');
    lines.push('\\newcommand{\\BookTitle}{$if(title)$$title$$endif$}');
    lines.push('\\newcommand{\\AuthorName}{$if(author)$$for(author)$$author$$sep$, $endfor$$endif$}');
    lines.push('\\newcommand{\\rtSceneRunningTitle}{}');
    // Modern Classic / Contemporary set the running scene title via \rtSetSceneRunningTitle.
    // Define the setter as a hard contract: if the body or another template
    // fragment defines it first, LaTeX must fail instead of silently compiling
    // with the wrong running-header behavior.
    lines.push('\\newcommand{\\rtSetSceneRunningTitle}[1]{\\gdef\\rtSceneRunningTitle{#1}\\markboth{\\BookTitle}{#1}}');
    // \rtEmpty pagestyle: chrome-suppressed page used by Part / Chapter / Scene
    // opener pages. Emitted unconditionally so it's always defined regardless of
    // which structural levels the spec turns on (chapter pages need it even when
    // parts are off, e.g. Contemporary Literary).
    lines.push('\\fancypagestyle{rtEmpty}{\\fancyhf{}\\renewcommand{\\headrulewidth}{0pt}\\renewcommand{\\footrulewidth}{0pt}}');
    lines.push('\\fancyhf{}');
    lines.push('\\renewcommand{\\headrulewidth}{0pt}');
    lines.push('\\renewcommand{\\footrulewidth}{0pt}');

    // Compute per-corner overrides — corners whose live value differs from
    // what `applyHeaderPreset` would set for the active mode are treated as
    // user overrides and emitted AFTER the named-mode baseline so they win
    // (later \fancyhead[POS] declarations replace earlier ones in fancyhdr).
    const cornerOverrides = computeCornerOverrides(spec);

    if (rh.mode === 'none') {
        // Mode 'none' produces no headers — UNLESS the user has set per-corner
        // content explicitly (which the wizard's Customize-per-corner section
        // allows). Honor those if present; otherwise stay clean.
        if (cornerOverrides.length === 0) {
            lines.push('\\pagestyle{empty}');
            return lines.join('\n');
        }
        // Fall through to the corner-emission block below; skip the named-mode
        // baselines (none doesn't have one).
    }

    // Letter-spacing: use \KernedText{\MakeUppercase{...}} via the \headerfont face.
    const ls = rh.letterSpacing;
    const useKerned = typeof ls === 'number' && ls > 0;
    if (useKerned) {
        lines.push('\\newcommand{\\KernedText}[1]{{\\headerfont\\MakeUppercase{#1}}}');
        lines.push('\\newcommand{\\HeaderSeparator}{\\raisebox{0.2ex}{\\textbar}}');
    }
    const headerPrefix = rh.font === 'sans' ? '\\normalfont\\footnotesize\\nouppercase' : '';
    const wrapText = (inner: string): string => {
        if (useKerned) return `\\KernedText{${inner}}`;
        if (headerPrefix) return `${headerPrefix}{${inner}}`;
        return inner;
    };
    const wrapPage = (): string => useKerned ? '\\raisebox{0.2ex}{\\thepage}' : '\\thepage';
    const sep = useKerned ? '\\hspace{1em}\\HeaderSeparator\\hspace{1em}' : '\\hspace{1em}|\\hspace{1em}';

    if (rh.mode === 'centered-title') {
        lines.push(`\\fancyhead[C]{${wrapText('\\BookTitle')}}`);
    } else if (rh.mode === 'split-author-page-title-page') {
        lines.push(`\\fancyhead[CE]{${wrapPage()}${sep}${wrapText('\\AuthorName')}}`);
        lines.push(`\\fancyhead[CO]{${wrapText('\\BookTitle')}${sep}${wrapPage()}}`);
    } else if (rh.mode === 'left-title-right-context') {
        lines.push(`\\fancyhead[LE]{${wrapText('\\BookTitle')}}`);
        lines.push(`\\fancyhead[RO]{${wrapText('\\rtSceneRunningTitle')}}`);
    }
    // Per-corner overrides — emitted AFTER the named-mode baseline. Later
    // \fancyhead[POS] declarations replace earlier ones, so any corner the
    // user has changed in the wizard's "Customize per corner" panel wins
    // over the preset default. Empty values clear the slot (`{}`).
    for (const [pos, field] of cornerOverrides) {
        const rendered = renderHeaderField(field);
        // Always emit even when rendered is empty — empty content explicitly
        // clears the preset's content for that slot.
        lines.push(`\\fancyhead[${pos}]{${rendered ? wrapText(rendered) : ''}}`);
    }
    lines.push('\\pagestyle{fancy}');
    return lines.join('\n');
}

export function renderFolio(spec: DesignedStyleSpec): string {
    const lines: string[] = [];
    if (spec.folio.position === 'bottom-center') {
        lines.push('\\fancyfoot[C]{\\thepage}');
    } else if (spec.folio.position === 'none') {
        lines.push('\\fancyfoot{}');
    }
    // 'header' position is handled inside renderFancyhdr by including \thepage in headers.
    return lines.join('\n');
}

/**
 * Page numbering hierarchy control.
 *
 * Standard convention: arabic numbering starts at the FIRST opener that exists
 * in the spec hierarchy (Part > Chapter > Scene). Frontmatter doesn't count
 * toward arabic. Whichever opener fires first calls `\rtBeginMainArabic`,
 * which switches to arabic and resets the page counter to 1. Subsequent
 * openers no-op via the `\ifrtMainStarted` flag.
 */
export function renderPageNumberingControl(_spec: DesignedStyleSpec): string {
    return [
        '\\pagenumbering{roman}',
        '\\newif\\ifrtMainStarted',
        '\\rtMainStartedfalse',
        '\\newcommand{\\rtBeginMainArabic}{%',
        `  ${standardPageBreak()}`,
        '  \\pagenumbering{arabic}%',
        '  \\setcounter{page}{1}%',
        '  \\rtMainStartedtrue%',
        '}',
    ].join('\n');
}

export function renderPartTitle(spec: DesignedStyleSpec): string {
    if (spec.parts.mode === 'off') return '';
    const lines: string[] = [];
    const breakCommand = structuralPageBreak(spec);
    // \rtEmpty pagestyle is now defined unconditionally in renderFancyhdr
    // (chapters and scene separators reference it too, regardless of parts mode).
    lines.push('\\newcommand{\\rtPart}[3]{%');
    lines.push('  \\ifrtMainStarted\\else\\rtBeginMainArabic\\fi%');
    if (spec.parts.pageBreak) lines.push(`  ${breakCommand}`);
    // \null primes the freshly cleared page so \thispagestyle and \vspace*
    // bind to it reliably (without \null they can be discarded at the page
    // boundary). Same fix applied in \rtChapter and \rtSceneOpener.
    lines.push('  \\null%');
    lines.push('  \\thispagestyle{rtEmpty}%');
    lines.push('  \\vspace*{1.55in}%');
    lines.push('  \\begin{center}');
    lines.push('    {\\normalfont\\bfseries\\Large #1}\\par');
    lines.push('    \\vspace{0.16in}%');
    lines.push('    \\rule{0.46in}{0.4pt}\\par');

    const wantsEpigraph = spec.parts.epigraph || spec.epigraph.enabled;
    const ownPage = spec.parts.epigraphPlacement === 'own-page';

    if (wantsEpigraph && !ownPage) {
        // Inline placement — quote sits under the rule on the same page.
        lines.push('    \\ifstrempty{#2}{}{%%');
        lines.push('      \\vspace{0.28in}%');
        lines.push('      \\begin{minipage}{\\textwidth}');
        lines.push('        \\centering');
        lines.push(spec.epigraph.italic ? '        {\\itshape #2}\\par' : '        {#2}\\par');
        lines.push('      \\end{minipage}\\par');
        lines.push('    }%');
        lines.push('    \\ifstrempty{#3}{}{%%');
        if (spec.epigraph.attributionStyle === 'em-dash-caps') {
            lines.push('      \\vspace{0.18in}{\\small\\MakeUppercase{---#3}}\\par');
        } else {
            lines.push('      \\vspace{0.18in}{\\small #3}\\par');
        }
        lines.push('    }%');
    }

    lines.push('  \\end{center}');
    lines.push('  \\vspace*{1.2in}%');

    if (wantsEpigraph && ownPage) {
        // Own-page placement — the part heading lives on the recto, then a
        // \cleardoublepage flips to a fresh page where the epigraph stands
        // alone, centered vertically. Headers/folios are suppressed on both.
        lines.push('  \\ifstrempty{#2}{}{%%');
        lines.push('    \\cleardoublepage%');
        lines.push('    \\null%');
        lines.push('    \\thispagestyle{rtEmpty}%');
        lines.push('    \\vspace*{2.5in}%');
        lines.push('    \\begin{center}%');
        lines.push('      \\begin{minipage}{0.7\\textwidth}%');
        lines.push('        \\centering');
        lines.push(spec.epigraph.italic ? '        {\\itshape #2}\\par' : '        {#2}\\par');
        lines.push('        \\ifstrempty{#3}{}{%%');
        if (spec.epigraph.attributionStyle === 'em-dash-caps') {
            lines.push('          \\vspace{0.22in}{\\small\\MakeUppercase{---#3}}\\par');
        } else {
            lines.push('          \\vspace{0.22in}{\\small #3}\\par');
        }
        lines.push('        }%');
        lines.push('      \\end{minipage}%');
        lines.push('    \\end{center}%');
        lines.push('  }%');
    }

    if (spec.parts.pageBreak) lines.push(`  ${breakCommand}`);
    lines.push('}');
    return lines.join('\n');
}

export function renderChapterTitle(spec: DesignedStyleSpec): string {
    if (spec.chapters.mode === 'off') {
        // Chapters off but secnumdepth=1 still needs to apply (Signature numbered scene markers).
        if (spec.chapters.secnumdepth === 1) {
            return '\\setcounter{secnumdepth}{1}';
        }
        return '';
    }
    const lines: string[] = [];
    const breakCommand = standardPageBreak();
    if (typeof spec.chapters.secnumdepth === 'number') {
        lines.push(`\\setcounter{secnumdepth}{${spec.chapters.secnumdepth}}`);
    }
    // Spec-driven vertical spacing: when spec.chapters.spacing is provided, use
    // textheight fractions (e.g. Contemporary's 0.46/0.08 places the chapter
    // ~46% down the page for a centered-feel chapter opener). Otherwise fall
    // back to fixed inches that work for traditional manuscript layouts.
    const sp = spec.chapters.spacing;
    // Default to 0.5\textheight (centered) when undefined — matches the
    // wizard slider's centered default. Bundled templates that want a
    // different position (e.g. Contemporary's deep 0.46) set explicit values.
    const topVspace = sp?.topFraction != null
        ? `${sp.topFraction.toFixed(2)}\\textheight`
        : '0.5\\textheight';
    const bottomVspace = sp?.bottomFraction != null
        ? `${sp.bottomFraction.toFixed(2)}\\textheight`
        : '0.08\\textheight';
    const useModernClassicChapterTreatment =
        spec.archetype === 'structured'
        && spec.chapters.mode === 'numbered-titled'
        && spec.scene.opener === 'roman-with-rule';

    // \rtChapter is the SOLE contract surface for chapter openers. The
    // assembler calls \rtChapter{N}{Title}; this macro owns the full page —
    // pre-clearpage, chrome suppression, vertical spacing, heading typography,
    // bottom-clearpage so the chapter sits alone on its own page (body text
    // begins on the next page). This is a plain page break, not recto-forcing;
    // twoside layouts should not synthesize blank verso pages unless the spec
    // explicitly models that.
    //
    // \null is a load-bearing detail: after \clearpage, the new page
    // hasn't yet been "started" (no content emitted). \thispagestyle{} and
    // \vspace*{} both behave inconsistently at that boundary — \vspace* may
    // get discarded despite the asterisk, and \thispagestyle{} may bind to
    // the wrong page. Emitting \null primes the page so both directives
    // reliably apply to the chapter opener page.
    lines.push('\\newcommand{\\rtChapter}[2]{%');
    lines.push('  \\ifrtMainStarted\\else\\rtBeginMainArabic\\fi%');
    if (spec.chapters.pageBreak) lines.push(`  ${breakCommand}`);
    lines.push('  \\refstepcounter{chapter}%');
    lines.push('  \\null%');
    lines.push('  \\thispagestyle{rtEmpty}%');
    lines.push(`  \\vspace*{${topVspace}}%`);
    lines.push('  \\begin{center}');
    if (spec.chapters.mode === 'numbered' || spec.chapters.mode === 'numbered-titled') {
        lines.push(useModernClassicChapterTreatment
            ? '    {\\normalfont\\bfseries\\small Chapter~#1}\\par'
            : '    {\\normalfont\\bfseries\\large Chapter~#1}\\par');
    }
    if (spec.chapters.mode === 'titled' || spec.chapters.mode === 'numbered-titled') {
        lines.push('    \\vspace{0.35in}%');
        lines.push(useModernClassicChapterTreatment
            ? '    {\\normalfont\\LARGE #2}\\par'
            : '    {\\normalfont\\itshape\\Large #2}\\par');
    }
    lines.push('  \\end{center}');
    lines.push(`  \\vspace*{${bottomVspace}}%`);
    if (spec.chapters.pageBreak) lines.push(`  ${breakCommand}`);
    lines.push('}');
    if (spec.chapters.resetSceneCounter) {
        lines.push('\\newcounter{rtSceneCounter}');
    }
    return lines.join('\n');
}

export function renderSceneOpener(spec: DesignedStyleSpec): string {
    const lines: string[] = [];
    const glyph = spec.scene.separatorGlyph
        ? escapeForLatex(spec.scene.separatorGlyph)
        : '* * *';

    // First-word emphasis helper used by Standard / Contemporary.
    if (spec.scene.firstWordEmphasisOnOpener) {
        lines.push('\\setcounter{secnumdepth}{0}');
        lines.push('\\makeatletter');
        lines.push('\\newcommand{\\rtSceneOpenerTitle}[1]{%');
        lines.push('  \\begingroup');
        lines.push('  \\def\\rt@sceneFirst{}%');
        lines.push('  \\rt@sceneFirstWord#1 \\@nil');
        lines.push('  \\rt@sceneFirst');
        lines.push('  \\endgroup');
        lines.push('}');
        lines.push('\\def\\rt@sceneFirstWord#1 #2\\@nil{\\def\\rt@sceneFirst{#1}}');
        lines.push('\\makeatother');
    }

    if (spec.scene.opener === 'inline-separator') {
        lines.push(`\\newcommand{\\rtSceneSep}{\\par\\vspace{1.2em}\\begin{center}${glyph}\\end{center}\\vspace{1.2em}}`);
    } else if (spec.scene.opener === 'dedicated-page') {
        const breakCommand = standardPageBreak();
        // Inline separator macro for any non-opener scene break.
        lines.push('\\newcommand{\\rtSceneSep}{%');
        lines.push(`  ${breakCommand}`);
        if (spec.scene.suppressHeaderFooterOnOpener) lines.push('  \\thispagestyle{empty}%');
        lines.push('  \\vspace*{2in}%');
        lines.push(`  \\begin{center}{\\Large ${glyph}}\\end{center}`);
        lines.push('  \\vspace*{1in}%');
        lines.push('}');
        // Dedicated scene-opener macro. The assembler emits \rtSceneOpener{HEADING}
        // for each scene; the macro itself owns the page break, chrome suppression,
        // vertical spacing, and centered title typography.
        //
        // openerHeadingModes-bearing specs (Signature Literary) skip this macro
        // path — they render via titleformat/titlespacing on \section{} below
        // because the user-pickable mode is selected at export time by emitting
        // either \section{N} or \section*{Title} which the formatters style.
        const useOpenerMacro = !spec.scene.openerHeadingModes
            || spec.scene.openerHeadingModes.length === 0;
        if (useOpenerMacro) {
            const titleExpr = spec.scene.firstWordEmphasisOnOpener
                ? '\\rtSceneOpenerTitle{#1}'
                : '#1';
            lines.push('\\newcommand{\\rtSceneOpener}[1]{%');
            lines.push('  \\ifrtMainStarted\\else\\rtBeginMainArabic\\fi%');
            lines.push(`  ${breakCommand}`);
            // \null primes the freshly cleared page so \thispagestyle and
            // \vspace* bind to it reliably (without \null they can be
            // discarded at the page boundary).
            lines.push('  \\null%');
            if (spec.scene.suppressHeaderFooterOnOpener) lines.push('  \\thispagestyle{empty}%');
            lines.push('  \\vspace*{0.16\\textheight}%');
            lines.push(`  \\begin{center}{\\normalfont\\bfseries\\Large ${titleExpr}}\\end{center}`);
            lines.push('  \\vspace*{0.12\\textheight}%');
            lines.push('}');
        }
    } else if (spec.scene.opener === 'roman-with-rule') {
        lines.push('\\newcommand{\\rtSceneSep}[1]{%');
        lines.push('  \\ifrtMainStarted\\else\\rtBeginMainArabic\\fi%');
        lines.push('  \\clearpage');
        lines.push('  \\null%');
        lines.push('  \\thispagestyle{rtEmpty}%');
        lines.push('  \\vspace*{0.78in}%');
        lines.push('  \\begin{center}');
        lines.push('    {\\normalfont\\small #1.}\\par');
        lines.push('    \\vspace{0.08in}%');
        lines.push('    \\rule{0.46in}{0.4pt}%');
        lines.push('  \\end{center}');
        lines.push('  \\vspace*{0.82in}%');
        lines.push('}');
    }

    // Signature Literary's three-mode scene opener heading: emit numbered scene
    // sections via titlesec hooks. The macro \rtSceneOpener{#1} expands to
    // \section*{#1} so the titlesec formatters fire — the assembler always
    // emits \rtSceneOpener as the contract surface.
    if (spec.scene.openerHeadingModes && spec.scene.openerHeadingModes.length > 0) {
        const openerTop = spec.scene.openerSpacing?.topFraction ?? 0.2;
        const openerBottom = spec.scene.openerSpacing?.bottomFraction ?? 0.2;
        // \rtSceneOpener{HEADING} → \section*{HEADING}. The numberless titleformat
        // below styles every starred section page. Spacing fractions match the
        // spec's openerSpacing (defaults to 0.2/0.2).
        lines.push('\\newcommand{\\rtSceneOpener}[1]{%');
        lines.push('  \\ifrtMainStarted\\else\\rtBeginMainArabic\\fi%');
        lines.push('  \\section*{#1}%');
        lines.push('}');
        lines.push('\\titleformat{\\section}[display]{\\normalfont\\bfseries\\centering\\fontsize{30}{34}\\selectfont}{\\arabic{section}}{0.2em}{}');
        lines.push('\\titleformat{name=\\section,numberless}[display]{\\normalfont\\bfseries\\centering\\fontsize{30}{34}\\selectfont}{}{0pt}{}');
        lines.push(`\\titlespacing*{\\section}{0pt}{${openerTop}\\textheight}{${openerBottom}\\textheight}`);
        lines.push('\\preto\\section{\\clearpage\\thispagestyle{empty}}');
        lines.push('\\titleformat{\\subsection}[display]{\\normalfont\\bfseries\\centering\\fontsize{30}{34}\\selectfont}{\\arabic{subsection}}{0.2em}{}');
        lines.push('\\titleformat{name=\\subsection,numberless}[display]{\\normalfont\\bfseries\\centering\\fontsize{30}{34}\\selectfont}{}{0pt}{}');
        lines.push(`\\titlespacing*{\\subsection}{0pt}{${openerTop}\\textheight}{${openerBottom}\\textheight}`);
        lines.push('\\preto\\subsection{\\clearpage\\thispagestyle{empty}}');
    }
    return lines.join('\n');
}

export function renderEpigraphMacros(spec: DesignedStyleSpec): string {
    if (!spec.epigraph.enabled) return '';
    // Part-enabled specs carry part epigraph text through \rtPart{n}{quote}{attr}.
    // Emit the standalone epigraph macro only for specs without part openers.
    if (spec.parts.mode !== 'off') return '';
    const lines: string[] = [];
    lines.push('\\newcommand{\\rtEpigraph}[2]{%');
    lines.push('  \\begin{center}');
    lines.push('    \\begin{minipage}{\\textwidth}');
    lines.push('      \\centering');
    lines.push(spec.epigraph.italic ? '      {\\itshape #1}\\par' : '      {#1}\\par');
    lines.push('      \\if\\relax\\detokenize{#2}\\relax\\else');
    if (spec.epigraph.attributionStyle === 'em-dash-caps') {
        lines.push('        \\vspace{0.25in}{\\small\\MakeUppercase{---#2}}\\par');
    } else {
        lines.push('        \\vspace{0.25in}{\\small #2}\\par');
    }
    lines.push('      \\fi');
    lines.push('    \\end{minipage}');
    lines.push('  \\end{center}');
    lines.push('}');
    return lines.join('\n');
}

export function renderBodySetup(spec: DesignedStyleSpec): string {
    const lines: string[] = [];

    // Body font size — when the wizard picks a non-standard size (8/9/13/14),
    // the documentclass option is rounded to the nearest of 10/11/12, so we
    // override \normalsize here to enforce the exact requested size. Skipping
    // when sizePt matches the documentclass keeps the .tex clean for the
    // common case.
    const sizePt = spec.body.sizePt;
    const docClassSize = parseInt(pickDocumentClassSize(sizePt));
    if (sizePt !== docClassSize) {
        // \fontsize{<size>}{<leading>} — leading defaults to 1.2× size, then
        // \linespread (below) further scales it. Applying \normalsize after
        // the redefinition forces the new size to take effect for body text.
        const leading = (sizePt * 1.2).toFixed(1);
        lines.push(`\\renewcommand{\\normalsize}{\\fontsize{${sizePt}pt}{${leading}pt}\\selectfont}`);
        lines.push('\\normalsize');
    }

    const ls = spec.body.lineSpacing;
    if (Math.abs(ls - 1.5) < 0.001) {
        lines.push('\\onehalfspacing');
    } else if (Math.abs(ls - 2.0) < 0.001) {
        lines.push('\\doublespacing');
    } else {
        lines.push(`\\setstretch{${ls}}`);
    }
    // Typography overflow relief floor — emitted unconditionally for every spec.
    // microtype + emergencystretch + relaxed tolerance keep long words / URLs from
    // overflowing the right margin even on plain prose. The legacy `body.microtype`
    // flag is now redundant (always emitted); kept ignored on the spec for
    // back-compat.
    lines.push('\\usepackage{microtype}');
    lines.push('\\setlength{\\emergencystretch}{3em}');
    lines.push('\\tolerance=1000');
    lines.push('\\hyphenpenalty=200');
    // Widow/orphan suppression — emitted unconditionally for every spec. A widow
    // is a paragraph's last line stranded at the top of a page; an orphan is its
    // first line stranded at the bottom. Professional book interiors forbid both.
    // 10000 is LaTeX's "infinitely bad" penalty, so the breaker will reflow rather
    // than leave a widow/orphan. Paired with \raggedbottom so the page can run one
    // line short instead of stretching interline glue to fill the height (fiction
    // convention — a slightly short page reads better than a gappy one).
    lines.push('\\widowpenalty=10000');
    lines.push('\\clubpenalty=10000');
    lines.push('\\displaywidowpenalty=10000');
    lines.push('\\raggedbottom');
    if (spec.body.paragraphIndentEm != null) {
        lines.push(`\\setlength{\\parindent}{${spec.body.paragraphIndentEm}em}`);
    }
    // First-paragraph-after-break indent. LaTeX's default suppresses the
    // first-paragraph indent after sectioning commands (chapter, section,
    // scene break). The `indentfirst` package overrides that and indents
    // every paragraph including the first. So:
    //   firstLineIndentSuppressedAfterBreak === true   → default behavior, no package
    //   firstLineIndentSuppressedAfterBreak === false  → load indentfirst
    //   undefined                                      → default behavior, no package
    if (spec.body.firstLineIndentSuppressedAfterBreak === false) {
        lines.push('\\usepackage{indentfirst}');
    }
    if (spec.folio.format === 'roman-frontmatter') {
        // No-op; pandoc-driven frontmatter not modelled here.
    }
    return lines.join('\n');
}
