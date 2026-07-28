/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
/*
 * Packaging gate: every binary asset under src/ must ship inside one of the
 * three files Obsidian actually installs.
 *
 * THE FAILURE THIS PREVENTS
 * -------------------------
 * Obsidian's plugin installer downloads exactly `manifest.json`, `main.js` and
 * `styles.css` from a GitHub release. Files copied into `./release/` but not
 * uploaded, and files uploaded but not among those three, never reach a user
 * who installed through the Community Plugins browser.
 *
 * That gap is invisible during development, because the build copies assets
 * straight into local test vaults — so the feature works on the dev machine
 * and is broken for every real user. It shipped that way for months: bundled
 * Pandoc fonts and the Word reference document (GH #29, #34), the Inquiry
 * logo, and the Inquiry background texture.
 *
 * There are exactly two legitimate ways for a binary to reach a user:
 *   1. `scripts/embed-plugin-assets.mjs` — base64 into main.js
 *   2. `scripts/bundle-css.mjs`          — base64 data URI into styles.css
 *
 * Anything else under src/ is unreachable at runtime. This gate fails the
 * build rather than letting it ship.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_ASSET_MANIFEST, LICENCE_FILE_NAMES } from './embed-plugin-assets.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const srcDir = path.join(repoRoot, 'src');

/** Extensions treated as runtime binaries that must be accounted for. */
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.ttf', '.otf', '.woff', '.woff2',
    '.docx', '.pdf', '.zip',
]);

/** Files the CSS bundler inlines into styles.css as data URIs. */
function readCssInlinedAssets() {
    const bundlerPath = path.join(scriptDir, 'bundle-css.mjs');
    const source = fs.readFileSync(bundlerPath, 'utf8');
    const inlined = new Set();
    // Matches the `fontUrlEmbeds` entries: 'assets/fonts/<...>' paths.
    for (const match of source.matchAll(/'((?:assets|inquiry)\/[^']+\.(?:woff2?|ttf|otf|png|jpe?g|gif|svg))'/g)) {
        inlined.add(match[1]);
    }
    return inlined;
}

function walk(dir, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'generated') continue; // build output, not a source asset
            walk(abs, found);
        } else if (entry.isFile()) {
            found.push(abs);
        }
    }
    return found;
}

function main() {
    const quiet = process.argv.includes('--quiet');
    const embedded = new Set(EMBEDDED_ASSET_MANIFEST.map(a => a.src));
    const cssInlined = readCssInlinedAssets();

    const unaccounted = [];
    for (const abs of walk(srcDir)) {
        const rel = path.relative(srcDir, abs).split(path.sep).join('/');
        const ext = path.extname(rel).toLowerCase();
        if (!BINARY_EXTENSIONS.has(ext)) continue;
        if (embedded.has(rel)) continue;
        if (cssInlined.has(rel)) continue;
        if (LICENCE_FILE_NAMES.has(path.basename(rel))) continue;
        unaccounted.push(rel);
    }

    // The reverse direction: a manifest entry whose file was deleted. The
    // generator throws on this too, but the gate names it earlier and more
    // clearly than a build failure would.
    const missing = EMBEDDED_ASSET_MANIFEST
        .map(a => a.src)
        .filter(rel => !fs.existsSync(path.join(srcDir, rel)));

    // Loose asset copying in the build config is what created the illusion
    // that these files shipped. Fail if it comes back.
    const esbuildConfig = fs.readFileSync(path.join(repoRoot, 'esbuild.config.mjs'), 'utf8');
    const reintroducedCopy = /directoriesToCopy\s*=/.test(esbuildConfig);

    const problems = [];
    if (unaccounted.length > 0) {
        problems.push(
            `${unaccounted.length} binary asset(s) under src/ are not shipped anywhere:\n` +
            unaccounted.map(f => `    src/${f}`).join('\n') +
            `\n  Obsidian installs only manifest.json / main.js / styles.css, so these` +
            `\n  never reach a user who installed from the Community Plugins browser.` +
            `\n  Fix: add to EMBEDDED_ASSET_MANIFEST in scripts/embed-plugin-assets.mjs` +
            `\n  (inlines into main.js), or to fontUrlEmbeds in scripts/bundle-css.mjs` +
            `\n  (inlines into styles.css). Delete it if nothing uses it.`
        );
    }
    if (missing.length > 0) {
        problems.push(
            `${missing.length} manifest entr(ies) point at files that do not exist:\n` +
            missing.map(f => `    src/${f}`).join('\n')
        );
    }
    if (reintroducedCopy) {
        problems.push(
            'esbuild.config.mjs declares `directoriesToCopy` again.\n' +
            '  Copying asset directories into ./release/ does not ship them — Obsidian\n' +
            '  ignores everything except manifest.json / main.js / styles.css.'
        );
    }

    if (problems.length > 0) {
        console.error('\x1b[31mShipped-asset check failed\x1b[0m\n');
        for (const p of problems) console.error(`  ${p}\n`);
        process.exit(1);
    }

    if (!quiet) {
        console.log(
            `Shipped-asset check passed: ${embedded.size} embedded in main.js, ` +
            `${cssInlined.size} inlined into styles.css.`
        );
    }
}

main();
