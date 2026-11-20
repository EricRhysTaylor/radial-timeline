#!/usr/bin/env node
/*
 * Release notes gate, run by release-script.mjs before anything is committed,
 * tagged or pushed. Two rules from Eric (2026-11-20), after 8.0.5 shipped a
 * new Chronologue Time scale, the PDF style designer and LaTeX template
 * import as a patch release with no screenshots:
 *
 * 1. The version says what changed. A patch (x.y.z) carries fixes and a few
 *    small changes. New features or major improvements make a minor release
 *    (x.y.0); x.0.0 is a major release. A patch draft with more than
 *    MAX_PATCH_ITEMS items outside its Fixes section stops here. Since 8.0
 *    the patches held at most 5; 8.0.5 held 24.
 * 2. A minor or major release shows its major new features: 1 to 5
 *    screenshots, each an <img> with alt text and an https src pinned to a
 *    commit (GitHub release bodies don't resolve relative paths). A patch may
 *    carry up to 5 too.
 *
 * Full rule: docs/engineering/standards/release-process.md, "Release notes".
 *
 * Usage: node scripts/check-release-notes.mjs <version>
 */
import { existsSync, readFileSync } from 'node:fs';

const MAX_PATCH_ITEMS = 6;
const MAX_SCREENSHOTS = 5;

const version = process.argv[2] ?? '';
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!parts) {
    console.error(`[release-notes] Usage: node scripts/check-release-notes.mjs <x.y.z> (got "${version}")`);
    process.exit(2);
}
const isPatch = parts[3] !== '0';
const kind = !isPatch ? (parts[2] === '0' ? 'major' : 'minor') : 'patch';

const draftPath = `docs/releases/draft-for-release-${version}.md`;
const body = existsSync(draftPath) ? readFileSync(draftPath, 'utf8') : '';
const problems = [];

if (!body.trim()) {
    if (!isPatch) problems.push(`A ${kind} release needs a notes draft with screenshots: ${draftPath} is missing or empty.`);
} else {
    let section = '';
    let itemsOutsideFixes = 0;
    for (const line of body.split('\n')) {
        const heading = /^###\s+(.*)/.exec(line);
        if (heading) { section = heading[1].trim(); continue; }
        if (/^- /.test(line) && !/^fix/i.test(section)) itemsOutsideFixes++;
    }

    const images = [...body.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
    const markdownImages = body.match(/!\[[^\]]*\]\([^)]*\)/g) ?? [];

    if (isPatch && itemsOutsideFixes > MAX_PATCH_ITEMS) {
        problems.push(
            `${version} is a patch, but its notes list ${itemsOutsideFixes} items outside Fixes (a patch holds at most ${MAX_PATCH_ITEMS}). `
            + `New features or major improvements make this a minor release: ${parts[1]}.${Number(parts[2]) + 1}.0.`
        );
    }
    if (markdownImages.length > 0) {
        problems.push(`Write screenshots as <img src="https://…" alt="…" width="800">, not Markdown images: ${markdownImages.join(', ')}`);
    }
    if (!isPatch && images.length === 0) {
        problems.push(`A ${kind} release shows its major new features: add 1 to ${MAX_SCREENSHOTS} screenshots to ${draftPath}.`);
    }
    if (images.length > MAX_SCREENSHOTS) {
        problems.push(`${images.length} screenshots; keep the ${MAX_SCREENSHOTS} that show the biggest changes.`);
    }
    for (const img of images) {
        const src = /\bsrc="([^"]*)"/.exec(img)?.[1] ?? '';
        const alt = /\balt="([^"]*)"/.exec(img)?.[1] ?? '';
        if (!/^https:\/\/raw\.githubusercontent\.com\/EricRhysTaylor\/radial-timeline\/[0-9a-f]{7,40}\//.test(src)) {
            problems.push(`Screenshot src must be a raw.githubusercontent.com URL pinned to a commit: ${src || img}`);
        }
        if (alt.trim().length < 20) {
            problems.push(`Screenshot needs alt text that says what it shows: ${src || img}`);
        }
    }
}

if (problems.length > 0) {
    console.error(`[release-notes] ${version} (${kind}) is not ready:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}
console.log(`[release-notes] ${version} (${kind}): notes pass.`);
