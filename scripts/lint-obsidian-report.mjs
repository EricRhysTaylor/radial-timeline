#!/usr/bin/env node
// Report-only Obsidian guideline lint (eslint-plugin-obsidianmd) — STEP 3.
// Runs ESLint, aggregates findings by rule/file, and ALWAYS exits 0.
// This is deliberately not a blocking gate yet; it feeds the run-gates report
// lane and the eslint-rule-mapping decision (step 4).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const quiet = process.argv.includes('--quiet');
const root = process.cwd();

const result = spawnSync('npx', ['eslint', 'src', '--format', 'json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

let files;
try {
  files = JSON.parse(result.stdout || '');
} catch {
  // ESLint failed before producing JSON (config/parse error). Surface it but
  // do not fail the lane — report-only.
  const stderr = (result.stderr || '').trim().split('\n').slice(-4).join(' ');
  console.log(`[obsidian-lint] ESLint produced no JSON output (report-only). ${stderr}`);
  process.exit(0);
}

let errorCount = 0;
let warningCount = 0;
const byRule = new Map();
const byFile = [];

for (const file of files) {
  errorCount += file.errorCount || 0;
  warningCount += file.warningCount || 0;
  const problems = (file.messages || []).length;
  if (problems > 0) byFile.push({ file: path.relative(root, file.filePath), problems });
  for (const msg of file.messages || []) {
    const rule = msg.ruleId || '(parse/other)';
    byRule.set(rule, (byRule.get(rule) || 0) + 1);
  }
}

const total = errorCount + warningCount;
const rulesSorted = [...byRule.entries()].sort((a, b) => b[1] - a[1]);
const topFiles = byFile.sort((a, b) => b.problems - a.problems).slice(0, 20);

const summary = {
  generatedAt: new Date().toISOString(),
  total,
  errorCount,
  warningCount,
  filesWithProblems: byFile.length,
  byRule: Object.fromEntries(rulesSorted),
  topFiles,
};

const outDir = path.join(root, '.gate-logs');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'eslint-obsidian.json'), JSON.stringify(summary, null, 2), 'utf8');

console.log(`[obsidian-lint] ${total} problems (${errorCount} errors, ${warningCount} warnings) across ${byFile.length} files — report-only`);
if (!quiet && rulesSorted.length) {
  console.log('[obsidian-lint] top rules:');
  rulesSorted.slice(0, 15).forEach(([rule, count]) => console.log(`  ${String(count).padStart(5)}  ${rule}`));
}
process.exit(0);
