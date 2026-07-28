/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
/*
 * Embeds binary plugin assets into a generated TypeScript module so they ship
 * inside `main.js`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Obsidian's plugin installer downloads exactly three files from a GitHub
 * release: `manifest.json`, `main.js`, `styles.css`. Any other file attached
 * to the release — or copied into `./release/` by the build — never reaches a
 * user who installed through the Community Plugins browser.
 *
 * Loose asset files under the plugin folder therefore only ever exist on a dev
 * machine (where esbuild copies them into local test vaults). Runtime code
 * that reads them works locally and fails for every real user. That was the
 * root cause of GH #29 and #34: `assets/fonts` and `assets/pandoc` were copied
 * into `./release/` but never uploaded, so Manuscript Export was broken for
 * everyone who installed the normal way.
 *
 * The fix is the pattern `scripts/bundle-css.mjs` already uses for the UI web
 * fonts: read the binary at build time, base64 it, and inline it into a
 * shipped artifact. `scripts/check-shipped-assets.mjs` enforces that every
 * binary under `src/` is accounted for by one of those two pipelines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const srcDir = path.join(repoRoot, 'src');
const outFile = path.join(srcDir, 'generated', 'embeddedAssets.ts');

/**
 * Every binary asset the plugin needs at runtime, keyed by the stable lookup
 * name used in `src/utils/embeddedAssets.ts`.
 *
 * `src`  — path relative to `src/`.
 * `note` — why it ships; kept next to the entry so the cost is visible.
 *
 * This list is the single source of truth for "what ships inside main.js".
 * `check-shipped-assets.mjs` reads it, so adding a binary to `src/` without
 * adding it here (or to the CSS font inliner) fails the gate.
 */
export const EMBEDDED_ASSET_MANIFEST = [
    {
        key: 'pandoc/reference-manuscript.docx',
        src: 'assets/pandoc/reference-manuscript.docx',
        note: 'Word export --reference-doc (standard manuscript format)',
    },
    {
        key: 'fonts/sorts-mill-goudy/SortsMillGoudy-Regular.ttf',
        src: 'assets/fonts/sorts-mill-goudy/SortsMillGoudy-Regular.ttf',
        note: 'Signature Literary PDF body font',
    },
    {
        key: 'fonts/sorts-mill-goudy/SortsMillGoudy-Italic.ttf',
        src: 'assets/fonts/sorts-mill-goudy/SortsMillGoudy-Italic.ttf',
        note: 'Signature Literary PDF body font (italic)',
    },
    {
        key: 'fonts/source-serif-4/SourceSerif4-Regular.otf',
        src: 'assets/fonts/source-serif-4/SourceSerif4-Regular.otf',
        note: 'Contemporary Literary PDF body font',
    },
    {
        key: 'fonts/source-serif-4/SourceSerif4-It.otf',
        src: 'assets/fonts/source-serif-4/SourceSerif4-It.otf',
        note: 'Contemporary Literary PDF body font (italic)',
    },
    {
        key: 'fonts/source-serif-4/SourceSerif4-Bold.otf',
        src: 'assets/fonts/source-serif-4/SourceSerif4-Bold.otf',
        note: 'Contemporary Literary PDF body font (bold)',
    },
    {
        key: 'fonts/source-serif-4/SourceSerif4-BoldIt.otf',
        src: 'assets/fonts/source-serif-4/SourceSerif4-BoldIt.otf',
        note: 'Contemporary Literary PDF body font (bold italic)',
    },
    {
        // The OFL requires the licence to travel with any redistributed copy
        // of the font, including the copies written into the user's vault.
        key: 'fonts/sorts-mill-goudy/OFL.txt',
        src: 'assets/fonts/sorts-mill-goudy/OFL.txt',
        note: 'SIL Open Font Licence for Sorts Mill Goudy (redistribution requirement)',
    },
    {
        key: 'fonts/source-serif-4/LICENSE.md',
        src: 'assets/fonts/source-serif-4/LICENSE.md',
        note: 'SIL Open Font Licence for Source Serif 4 (redistribution requirement)',
    },
    {
        key: 'images/rt-logo.png',
        src: 'assets/rt-logo.png',
        note: 'Inquiry briefing modal logo',
    },
    {
        key: 'images/radial_texture.png',
        src: 'inquiry/assets/radial_texture.png',
        note: 'Inquiry view background texture',
    },
];

/**
 * Licence/readme files that ship alongside the font binaries in `src/` but are
 * not embedded. They are redistribution paperwork for the font files, not
 * runtime assets — `check-shipped-assets.mjs` allows them explicitly rather
 * than silently ignoring every non-binary.
 */
export const LICENCE_FILE_NAMES = new Set(['OFL.txt', 'LICENSE.txt', 'LICENSE.md', 'README.md']);

/** MIME types for data-URI consumers (images). Fonts/docx are written as bytes. */
const MIME_BY_EXTENSION = {
    '.png': 'image/png',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
};

function mimeFor(file) {
    const ext = path.extname(file).toLowerCase();
    const mime = MIME_BY_EXTENSION[ext];
    if (!mime) throw new Error(`No MIME type registered for ${ext} (${file})`);
    return mime;
}

export function generateEmbeddedAssets({ quiet = false } = {}) {
    const entries = [];
    let totalRaw = 0;
    let totalEncoded = 0;

    for (const asset of EMBEDDED_ASSET_MANIFEST) {
        const absolute = path.join(srcDir, asset.src);
        if (!fs.existsSync(absolute)) {
            throw new Error(
                `Embedded asset missing: ${asset.src}\n` +
                `Listed in scripts/embed-plugin-assets.mjs but not found under src/. ` +
                `Restore the file or remove the manifest entry — a missing asset must ` +
                `fail the build, never ship a plugin that cannot find it at runtime.`
            );
        }
        const bytes = fs.readFileSync(absolute);
        if (bytes.length === 0) {
            throw new Error(`Embedded asset is empty: ${asset.src}`);
        }
        const base64 = bytes.toString('base64');
        totalRaw += bytes.length;
        totalEncoded += base64.length;
        entries.push({ key: asset.key, mime: mimeFor(asset.src), base64, bytes: bytes.length });
    }

    const banner = [
        '/*',
        ' * AUTO-GENERATED by scripts/embed-plugin-assets.mjs — DO NOT EDIT.',
        ' *',
        ' * Binary plugin assets, base64-encoded so they ship inside main.js.',
        ' * Obsidian only installs manifest.json / main.js / styles.css from a',
        ' * release, so loose asset files never reach an end user.',
        ' *',
        ' * Regenerate with: node scripts/embed-plugin-assets.mjs',
        ' */',
        '',
        '/** Stable lookup keys for every embedded binary asset. */',
        'export type EmbeddedAssetKey =',
        ...entries.map((e, i) => `    | '${e.key}'${i === entries.length - 1 ? ';' : ''}`),
        '',
        'export interface EmbeddedAsset {',
        '    /** MIME type, for data-URI consumers. */',
        '    mime: string;',
        '    /** Base64 payload (no `data:` prefix). */',
        '    base64: string;',
        '    /** Decoded byte length, for post-write verification. */',
        '    bytes: number;',
        '}',
        '',
        'export const EMBEDDED_ASSETS: Record<EmbeddedAssetKey, EmbeddedAsset> = {',
    ].join('\n');

    const body = entries
        .map(e => `    '${e.key}': { mime: '${e.mime}', bytes: ${e.bytes}, base64: '${e.base64}' },`)
        .join('\n');

    const output = `${banner}\n${body}\n};\n`;

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    // Only rewrite when the content actually changes: esbuild watch mode and
    // repeated gate runs otherwise churn a 2MB file on every invocation.
    const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
    if (existing !== output) {
        fs.writeFileSync(outFile, output);
    }

    if (!quiet) {
        console.log(
            `Embedded ${entries.length} assets: ` +
            `${(totalRaw / 1024).toFixed(0)}KB raw → ${(totalEncoded / 1024).toFixed(0)}KB base64` +
            `${existing === output ? ' (unchanged)' : ''}`
        );
    }
    return { count: entries.length, totalRaw, totalEncoded };
}

// Direct invocation: `node scripts/embed-plugin-assets.mjs [--quiet]`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        generateEmbeddedAssets({ quiet: process.argv.includes('--quiet') });
    } catch (err) {
        console.error(`\x1b[31m${err.message}\x1b[0m`);
        process.exit(1);
    }
}
