#!/usr/bin/env node
import { execSync } from 'node:child_process';

function run(command, description) {
  console.log(`\n[release-preflight] ${description}...`);
  execSync(command, { cwd: process.cwd(), stdio: 'inherit' });
}

function isFriday(date = new Date()) {
  return date.getDay() === 5;
}

function isBiweeklyDeepAuditDue(reference = new Date()) {
  const anchor = new Date(2026, 4, 27, 12, 0, 0, 0);
  if (reference < anchor) return false;
  const intervalMs = 14 * 24 * 60 * 60 * 1000;
  const elapsedIntervals = Math.floor((reference.getTime() - anchor.getTime()) / intervalMs);
  const dueAt = new Date(anchor.getTime() + elapsedIntervals * intervalMs);
  return reference >= dueAt;
}

const now = new Date();
const primaryAudit = isFriday(now) ? 'auditFriday' : 'auditDaily';

// First, and fail-closed: this is the only check that hands our generated
// LaTeX to XeLaTeX and confirms a PDF comes out, using the fonts the plugin
// actually ships. Everything else in the suite asserts on strings, which is
// how GH #34 reached a user — the emitted .tex looked right and would not
// compile. Requires Pandoc/XeLaTeX/Poppler; a missing toolchain stops the
// release rather than skipping.
// Cheap and fail-closed: a stranded draft release (tag + assets uploaded,
// never published) is invisible to Obsidian — 7.1.1 sat that way for 12
// days while users stayed on 7.1.0.
run('node scripts/check-unpublished-releases.mjs', 'Checking for stranded draft releases');

run('npm run publish:pdf-smoke', 'Compiling bundled PDF layouts against packaged fonts');

run(`npm run ${primaryAudit}`, `Running ${primaryAudit}`);
run('npm run release:i18n', 'Checking i18n release alignment');
run('npm run review:obsidian', 'Running Obsidian review readiness');
run('npm run release:eyeball', 'Printing eyeball checklist');

if (isBiweeklyDeepAuditDue(now)) {
  console.log('\n[release-preflight] Biweekly Deep Audit is due or overdue.');
  console.log('[release-preflight] Optional follow-up: npm run auditDeep');
}

console.log('\n[release-preflight] Complete.');
