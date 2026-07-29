/*
 * Font resolver for the publishing pipeline.
 *
 * One job: take a font name and return the LaTeX `\setmainfont{...}` block
 * to inject into the template's preamble.
 *
 * Resolution order:
 *   1. Vault: if `<vaultFontDir>/<slug>/` exists with the required files,
 *      emit `\setmainfont{Name}[Path = ..., UprightFont = ..., ...]`. Self-
 *      contained — no system font dependency.
 *   2. System: emit `\setmainfont{Name}`. XeLaTeX resolves it via the OS
 *      font cache. If the user doesn't have it installed, XeLaTeX emits its
 *      own clear "font not found" error at compile time.
 *
 * That's the whole policy. No `\PackageError{rt-font}` blocks, no
 * `\IfFontExistsTF` cascades, no fallback chains. Self-contained, pure,
 * easy to reason about.
 */
import fs from 'node:fs'; // SAFE: absolute filesystem checks for vault-local font files; Obsidian Vault API only handles vault-relative paths.
import path from 'node:path'; // SAFE: absolute path joining for fontspec Path= directives.

/**
 * Per-font metadata: the LaTeX-side family name, the on-disk slug used
 * inside the vault font folder, and the file names XeLaTeX needs to load.
 *
 * Adding a new font means adding one entry here. No per-font branches in
 * the renderer, no special-case logic.
 */
export interface FontFiles {
    /** Subdirectory under the vault font root, e.g. `sorts-mill-goudy`. */
    slug: string;
    /** Required file in `slug/`, used as `UprightFont=`. */
    upright: string;
    /** Optional companion files, all under the same `slug/` directory. */
    italic?: string;
    bold?: string;
    boldItalic?: string;
    /** Synthetic-bold/slant tweaks (Sorts Mill Goudy ships regular+italic only). */
    autoFakeBold?: number;
    autoFakeSlant?: number;
    /**
     * Font file names as installed by a TeX distribution, resolved by
     * kpathsea rather than by family name.
     *
     * Some fonts live in the texmf tree and are invisible to the OS font
     * catalog, so `\setmainfont{Family Name}` fails even on a complete TeX
     * install. Verified on macOS + TeX Live 2026: `\setmainfont{Latin Modern
     * Roman}` errors with "the font cannot be found", while
     * `\setmainfont{lmroman10-regular.otf}` compiles. When these are set the
     * resolver emits the filename form, which needs neither a bundled copy
     * nor an OS-registered font.
     */
    texUpright?: string;
    texItalic?: string;
    texBold?: string;
    texBoldItalic?: string;
}

/** Spec font key → display name + file metadata. One row per supported font. */
export const FONT_REGISTRY: Record<string, { displayName: string; files: FontFiles }> = {
    'sorts-mill-goudy': {
        displayName: 'Sorts Mill Goudy',
        files: {
            slug: 'sorts-mill-goudy',
            upright: 'SortsMillGoudy-Regular.ttf',
            italic: 'SortsMillGoudy-Italic.ttf',
            autoFakeBold: 2.5,
            autoFakeSlant: 0.2,
        },
    },
    'latin-modern': {
        displayName: 'Latin Modern Roman',
        files: {
            // Not bundled: Latin Modern ships with every TeX distribution, and
            // a working TeX install is already a hard prerequisite for PDF
            // export. Resolved from the texmf tree by filename.
            slug: 'latin-modern',
            upright: '',
            texUpright: 'lmroman10-regular.otf',
            texItalic: 'lmroman10-italic.otf',
            texBold: 'lmroman10-bold.otf',
            texBoldItalic: 'lmroman10-bolditalic.otf',
        },
    },
    'source-serif': {
        displayName: 'Source Serif 4',
        files: {
            slug: 'source-serif-4',
            upright: 'SourceSerif4-Regular.otf',
            italic: 'SourceSerif4-It.otf',
            bold: 'SourceSerif4-Bold.otf',
            boldItalic: 'SourceSerif4-BoldIt.otf',
        },
    },
    'eb-garamond': {
        displayName: 'EB Garamond',
        files: { slug: 'eb-garamond', upright: '' }, // system-only, no bundled files
    },
    'crimson': {
        displayName: 'Crimson Text',
        files: { slug: 'crimson', upright: '' },
    },
    'system-serif': {
        displayName: 'TeX Gyre Pagella',
        files: {
            // Same situation as Latin Modern: TeX Gyre Pagella ships with every
            // TeX distribution and lives in the texmf tree, so it is never
            // registered with the OS font catalog. Verified on macOS + TeX Live
            // 2026 — `\setmainfont{TeX Gyre Pagella}` fails with "cannot be
            // found" while the file-name form compiles.
            slug: 'tex-gyre-pagella',
            upright: '',
            texUpright: 'texgyrepagella-regular.otf',
            texItalic: 'texgyrepagella-italic.otf',
            texBold: 'texgyrepagella-bold.otf',
            texBoldItalic: 'texgyrepagella-bolditalic.otf',
        },
    },
    'system-sans': {
        displayName: 'Arial',
        files: { slug: 'arial', upright: '' },
    },
};

export interface BuildFontspecOptions {
    /** Spec font key (e.g. `'sorts-mill-goudy'`). Looked up in FONT_REGISTRY. */
    fontKey: string;
    /**
     * Absolute filesystem path to the vault's Pandoc font root
     * (`<vault>/Radial Timeline/Pandoc/fonts`). When omitted, the resolver
     * skips the vault check and goes straight to the system path.
     */
    vaultFontDir?: string;
    /**
     * Letter spacing for the optional `\headerfont` companion face used by
     * letter-spaced running headers (Signature Literary). When > 0, a second
     * `\newfontface\headerfont` block is appended.
     */
    letterSpacing?: number;
}

/**
 * Build the LaTeX font setup block for a given font.
 *
 * Pure function — caller supplies `vaultFontDir`, resolver checks the
 * filesystem with `fs.existsSync`. No module state, no caching beyond the
 * caller's discretion.
 */
export function buildFontspecBlock(opts: BuildFontspecOptions): string {
    const entry = FONT_REGISTRY[opts.fontKey];
    if (!entry) {
        throw new Error(`Unknown font key: ${opts.fontKey}`);
    }
    const { displayName, files } = entry;

    // 1. Vault: if all required files exist under <vaultFontDir>/<slug>/,
    //    emit a Path-based block. Independent of system fonts.
    if (opts.vaultFontDir && files.upright && vaultDirHasFont(opts.vaultFontDir, files)) {
        return renderPathBlock(displayName, opts.vaultFontDir, files, opts.letterSpacing);
    }

    // 2. TeX distribution: emit the filename form so kpathsea resolves the
    //    font from the texmf tree. Required for fonts that a TeX install
    //    provides but never registers with the OS font catalog.
    if (files.texUpright) {
        return renderTexBlock(files, opts.letterSpacing);
    }

    // 3. System: emit a plain \setmainfont. XeLaTeX resolves via OS fonts.
    //    If missing, XeLaTeX fails at compile time with its own clear error.
    return renderSystemBlock(displayName, opts.letterSpacing);
}

/**
 * Check whether the vault font directory contains every required file for
 * the given font. Used by `buildFontspecBlock` to gate the Path-based emit.
 *
 * Pure / synchronous. Exposed so the export pipeline can pre-flight font
 * availability before invoking pandoc and surface a clearer notice.
 */
export function vaultDirHasFont(vaultFontDir: string, files: FontFiles): boolean {
    if (!files.upright) return false;
    const dir = path.join(vaultFontDir, files.slug);
    if (!fs.existsSync(dir)) return false;
    const required = [files.upright, files.italic, files.bold, files.boldItalic]
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
    return required.every(name => fs.existsSync(path.join(dir, name)));
}

function renderPathBlock(
    displayName: string,
    vaultFontDir: string,
    files: FontFiles,
    letterSpacing?: number,
): string {
    const root = vaultFontDir.endsWith('/') ? vaultFontDir : `${vaultFontDir}/`;
    const dir = `${root}${files.slug}/`;
    const lines: string[] = [];
    lines.push(`\\setmainfont{${displayName}}[`);
    lines.push(`  Path = ${dir} ,`);
    lines.push(`  UprightFont = ${files.upright}${needsTrailingComma(files) ? ' ,' : ''}`);
    if (files.italic) {
        const isLast = !files.bold && !files.boldItalic && files.autoFakeBold == null && files.autoFakeSlant == null;
        lines.push(`  ItalicFont = ${files.italic}${isLast ? '' : ' ,'}`);
    }
    if (files.bold) {
        const isLast = !files.boldItalic && files.autoFakeBold == null && files.autoFakeSlant == null;
        lines.push(`  BoldFont = ${files.bold}${isLast ? '' : ' ,'}`);
    }
    if (files.boldItalic) {
        const isLast = files.autoFakeBold == null && files.autoFakeSlant == null;
        lines.push(`  BoldItalicFont = ${files.boldItalic}${isLast ? '' : ' ,'}`);
    }
    if (typeof files.autoFakeBold === 'number') {
        const isLast = files.autoFakeSlant == null;
        lines.push(`  AutoFakeBold = ${files.autoFakeBold}${isLast ? '' : ' ,'}`);
    }
    if (typeof files.autoFakeSlant === 'number') {
        lines.push(`  AutoFakeSlant = ${files.autoFakeSlant}`);
    }
    lines.push(']');

    if (typeof letterSpacing === 'number' && letterSpacing > 0) {
        lines.push(`\\newfontface\\headerfont{${displayName}}[`);
        lines.push(`  Path = ${dir} ,`);
        lines.push(`  UprightFont = ${files.upright} ,`);
        lines.push(`  LetterSpace = ${letterSpacing.toFixed(1)}`);
        lines.push(']');
    }
    return lines.join('\n');
}

function needsTrailingComma(files: FontFiles): boolean {
    return Boolean(
        files.italic
            || files.bold
            || files.boldItalic
            || files.autoFakeBold != null
            || files.autoFakeSlant != null,
    );
}

/**
 * Emit the filename form for a TeX-distribution font: no `Path =`, so
 * fontspec hands the name to kpathsea, which finds it in the texmf tree.
 */
function renderTexBlock(files: FontFiles, letterSpacing?: number): string {
    const upright = files.texUpright;
    if (!upright) {
        throw new Error('renderTexBlock called without texUpright');
    }
    const companions = [
        files.texItalic ? `  ItalicFont = ${files.texItalic}` : null,
        files.texBold ? `  BoldFont = ${files.texBold}` : null,
        files.texBoldItalic ? `  BoldItalicFont = ${files.texBoldItalic}` : null,
    ].filter((line): line is string => line !== null);

    const lines: string[] = [];
    if (companions.length === 0) {
        lines.push(`\\setmainfont{${upright}}`);
    } else {
        lines.push(`\\setmainfont{${upright}}[`);
        lines.push(companions.join(' ,\n'));
        lines.push(']');
    }

    if (typeof letterSpacing === 'number' && letterSpacing > 0) {
        lines.push(`\\newfontface\\headerfont{${upright}}[LetterSpace=${letterSpacing.toFixed(1)}]`);
    }
    return lines.join('\n');
}

function renderSystemBlock(displayName: string, letterSpacing?: number): string {
    const lines: string[] = [];
    lines.push(`\\setmainfont{${displayName}}`);
    if (typeof letterSpacing === 'number' && letterSpacing > 0) {
        lines.push(`\\newfontface\\headerfont{${displayName}}[LetterSpace=${letterSpacing.toFixed(1)}]`);
    }
    return lines.join('\n');
}
