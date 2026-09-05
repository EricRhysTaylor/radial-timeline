#!/usr/bin/env node
// Dead-export scan (heuristic, regex-based). Lists every `export` symbol in
// src/ (non-test) and classifies it by reference count across src/, tests/,
// and scripts/:
//   ZERO-USE     — no other occurrence of the name anywhere, not even in its own file
//   IN-FILE-ONLY — used only inside the defining file (over-exported, not dead)
//   TEST-ONLY    — referenced only from *.test.ts / tests/
// Name-based, so re-exports and same-named symbols in different files can
// mask each other. Treat output as candidates to verify with `grep -rw`.
//
// Usage: node scripts/audit/dead-exports.mjs [--all]   (default prints ZERO-USE only)
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const showAll = process.argv.includes('--all');
const walk = (dir, exts, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, exts, out); }
        else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
    return out;
};
const srcFiles = walk(path.join(root, 'src'), ['.ts']);
const consumers = [...srcFiles, ...['tests', 'scripts'].flatMap((d) => (fs.existsSync(path.join(root, d)) ? walk(path.join(root, d), ['.ts', '.mjs', '.js']) : []))];
const text = new Map(consumers.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const isTest = (f) => /\.test\.ts$/.test(f) || f.includes(`${path.sep}tests${path.sep}`);

const declRe = /^export\s+(?:async\s+)?(?:default\s+)?(?:abstract\s+)?(function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const listRe = /^export\s*\{([^}]+)\}(?!\s*from)/gm;
const rows = [];
for (const f of srcFiles) {
    if (isTest(f)) continue;
    const t = text.get(f);
    const names = [];
    let m;
    while ((m = declRe.exec(t))) names.push([m[2], m[1]]);
    while ((m = listRe.exec(t))) for (const n of m[1].split(',')) { const nm = n.trim().split(/\s+as\s+/).pop().trim(); if (nm) names.push([nm, 'reexport']); }
    for (const [name, kind] of names) {
        if (name === 'default') continue;
        const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
        let external = 0, nonTest = 0;
        for (const [g, tt] of text) { if (g === f) continue; if (re.test(tt)) { external++; if (!isTest(g)) nonTest++; } re.lastIndex = 0; }
        const inFile = (t.match(re) || []).length;
        let status = null;
        if (external === 0) status = inFile <= 1 ? 'ZERO-USE' : 'IN-FILE-ONLY';
        else if (nonTest === 0) status = 'TEST-ONLY';
        if (status && (showAll || status === 'ZERO-USE')) rows.push(`${status}\t${kind}\t${name}\t${path.relative(root, f)}`);
    }
}
rows.sort();
console.log(rows.join('\n'));
const counts = rows.reduce((a, r) => { const k = r.split('\t')[0]; a[k] = (a[k] || 0) + 1; return a; }, {});
console.error(JSON.stringify(counts));
