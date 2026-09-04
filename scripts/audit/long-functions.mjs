#!/usr/bin/env node
// Long-function scan (heuristic, brace-matching by indentation). Finds
// method/function/arrow declarations in non-test src/**/*.ts and measures
// lines to the closing brace at the same indentation. Nested closures count
// toward their parent. Not an AST pass; treat counts as approximate.
//
// Usage: node scripts/audit/long-functions.mjs [minLines=80] [top=40]
import fs from 'node:fs';
import path from 'node:path';

const min = Number(process.argv[2] || 80);
const top = Number(process.argv[3] || 40);
const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
    }
})('src');
const head = /^\s*(?:(?:private|public|protected|static|async|export|readonly)\s+)*(?:function\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*?\)\s*(?::\s*[^{;]+)?\s*\{\s*$|^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>\s*\{\s*$/;
const skip = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor']);
const res = [];
for (const f of files) {
    const L = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < L.length; i++) {
        const m = L[i].match(head);
        if (!m) continue;
        const name = m[1] || m[2];
        if (m[1] && skip.has(name)) continue;
        const indent = L[i].match(/^\s*/)[0].length;
        let j = i + 1;
        for (; j < L.length; j++) {
            const t = L[j].trim();
            if (t.startsWith('}') && L[j].match(/^\s*/)[0].length === indent) break;
        }
        const len = j - i + 1;
        if (len >= min) res.push([len, `${f}:${i + 1}-${j + 1}`, name]);
    }
}
res.sort((a, b) => b[0] - a[0]);
console.log(`>=${min}: ${res.length}   >=200: ${res.filter((r) => r[0] >= 200).length}   >=400: ${res.filter((r) => r[0] >= 400).length}   >=1000: ${res.filter((r) => r[0] >= 1000).length}`);
for (const r of res.slice(0, top)) console.log(String(r[0]).padStart(5), r[1], r[2]);
