#!/usr/bin/env node
// Producer-less CSS class scan (heuristic). Extracts every `.class` selector
// under src/styles/ and looks for the bare class name in non-test src/**/*.ts.
// A class whose prefix (up to the last `-`, `--`, or `__`) appears as a
// template producer (`prefix${`) is reported separately as "dynamic". Names
// matching common Obsidian core classes are excluded. Verify samples with
// `grep -rn` before deleting; ±5% is expected.
//
// Usage: node scripts/audit/unused-css.mjs [--json out.json]
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsonIdx = process.argv.indexOf('--json');
const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null;
// --check: fail when the hard-unused count exceeds scripts/unused-css-baseline.json
// (a ratchet; --write-baseline records the current count).
const checkMode = process.argv.includes('--check');
const writeBaseline = process.argv.includes('--write-baseline');
const baselinePath = path.join(root, 'scripts/unused-css-baseline.json');
const walk = (d, ext, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p, ext, out); }
        else if (p.endsWith(ext)) out.push(p);
    }
    return out;
};
const cssFiles = walk(path.join(root, 'src/styles'), '.css');
const tsBlob = walk(path.join(root, 'src'), '.ts').filter((f) => !f.endsWith('.test.ts')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const classDef = new Map();
for (const f of cssFiles) {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0, buf = '';
    const selectors = [];
    for (const ch of css) {
        if (ch === '{') { if (depth === 0) selectors.push(buf); buf = ''; depth++; }
        else if (ch === '}') { depth--; buf = ''; }
        else if (depth === 0) buf += ch;
    }
    for (const s of selectors) {
        if (s.trim().startsWith('@')) continue;
        for (const m of s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
            if (!classDef.has(m[1])) classDef.set(m[1], new Set());
            classDef.get(m[1]).add(path.relative(root, f));
        }
    }
}
const obsidianCore = /^(mod-|setting-|is-|nav-|view-|workspace|clickable-icon|checkbox-container|suggestion-|side-dock|extra-setting|menu|modal|prompt|search-|theme-|markdown|cm-|internal-link|tree-item|dropdown|slider|has-|status-bar|vertical-tab|horizontal|titlebar|tag|collapse-icon|svg-icon|metadata|multi-select|pill|external-link|callout|table-|image|empty-state|tooltip|community|hidden|toggle|u-)/;
const unused = [], dyn = [];
for (const [c, files] of classDef) {
    const re = new RegExp(`(^|[^\\w-])${c.replace(/-/g, '\\-')}([^\\w-]|$)`);
    if (re.test(tsBlob)) continue;
    let partial = false;
    for (const sep of ['--', '__', '-']) {
        const i = c.lastIndexOf(sep);
        if (i > 0 && tsBlob.includes(`${c.slice(0, i + sep.length)}\${`)) { partial = true; break; }
    }
    (partial ? dyn : unused).push({ c, files: [...files], core: obsidianCore.test(c) });
}
const real = unused.filter((u) => !u.core);
console.log(`distinct classes: ${classDef.size} | no exact TS producer: ${unused.length + dyn.length} | dynamic-prefix producer: ${dyn.length} | obsidian-core-looking: ${unused.length - real.length} | HARD UNUSED (non-core): ${real.length}`);
const byFile = {};
for (const u of real) for (const f of u.files) (byFile[f] = byFile[f] || []).push(u.c);
console.log('\nhard-unused by file:');
for (const [f, cs] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) console.log(String(cs.length).padStart(5), f);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ real, dyn }, null, 1));
if (writeBaseline) {
    fs.writeFileSync(baselinePath, JSON.stringify({ hardUnused: real.length, updatedAt: new Date().toISOString() }, null, 2) + '\n');
    console.log(`Baseline written: ${real.length} hard-unused classes.`);
}
if (checkMode) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    if (real.length > baseline.hardUnused) {
        console.error(`\n❌ Unused CSS ratchet: ${real.length} producer-less classes > baseline ${baseline.hardUnused}. Delete the rule or add the producer.`);
        process.exit(1);
    }
    console.log(`\n✅ Unused CSS ratchet held (${real.length} <= baseline ${baseline.hardUnused}).`);
}
