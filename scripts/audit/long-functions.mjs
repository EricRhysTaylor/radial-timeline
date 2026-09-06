#!/usr/bin/env node
// TypeScript AST scan of production functions, methods, constructors and callbacks.
// Physical line spans include nested closures; overload signatures are excluded.
//
// Usage: node scripts/audit/long-functions.mjs [minLines=80] [top=40]
import fs from 'node:fs';
import path from 'node:path';
import { measureFunctions } from './source-analysis.mjs';

const min = Number(process.argv[2] || 80);
const top = Number(process.argv[3] || 40);
const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.(?:test|d)\.ts$/.test(e.name)) files.push(p);
    }
})('src');
const res = [];
for (const f of files) {
    for (const row of measureFunctions(fs.readFileSync(f, 'utf8'), f)) {
        res.push([row.lines, `${f}:${row.start}-${row.end}`, row.name]);
    }
}
res.sort((a, b) => b[0] - a[0]);
console.log(`>=${min}: ${res.filter((r) => r[0] >= min).length}   >=200: ${res.filter((r) => r[0] >= 200).length}   >=400: ${res.filter((r) => r[0] >= 400).length}   >=1000: ${res.filter((r) => r[0] >= 1000).length}`);
for (const r of res.filter((r) => r[0] >= min).slice(0, top)) console.log(String(r[0]).padStart(5), r[1], r[2]);
