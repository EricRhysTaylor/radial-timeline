#!/usr/bin/env node
// Release preflight (`npm run release:prep`), run by the release script while
// finishing a draft. One line per check; full output in the log folder named
// on the first line. `--verbose` streams every step's output as well.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { formatCount, isMain, runSteps, summaries } from './lib/step-runner.mjs';

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

// The release script bumps package.json before this runs, so its version is the
// one being released. Point releases may show new strings in English; a major
// release (x.0.0) ships only after the translation pass (docs/engineering/standards/i18n.md).
const releaseVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const isMajor = /^\d+\.0\.0$/.test(releaseVersion);

export const steps = [
  // Cheap and fail-closed: a stranded draft release (tag + assets uploaded,
  // never published) is invisible to Obsidian — 7.1.1 sat that way for 12
  // days while users stayed on 7.1.0.
  {
    id: 'draft-releases',
    label: 'Stranded draft releases',
    command: 'node scripts/check-unpublished-releases.mjs',
    summary: summaries.draftReleases,
  },
  // Fail-closed: this is the only check that hands our generated LaTeX to
  // XeLaTeX and confirms a PDF comes out, using the fonts the plugin actually
  // ships. Everything else in the suite asserts on strings, which is how GH #34
  // reached a user — the emitted .tex looked right and would not compile.
  // Requires Pandoc/XeLaTeX/Poppler; a missing toolchain stops the release
  // rather than skipping.
  {
    id: 'pdf-smoke',
    label: 'Bundled PDF layouts',
    command: 'npm run --silent publish:pdf-smoke',
    summary: summaries.pdfLayouts,
  },
  {
    id: primaryAudit,
    label: isFriday(now) ? 'Friday Release Gate audit' : 'Daily Control Tower audit',
    command: `npm run --silent ${primaryAudit}`,
    summary: output => {
      const report = /\[audit\] Saved report: (\S+)/.exec(output)?.[1];
      const ship = /- Ship Readiness: (.+)/.exec(output)?.[1];
      return [ship, report ? `report: ${report}` : ''].filter(Boolean).join(' · ');
    },
  },
  {
    id: 'i18n',
    label: isMajor ? `Translations (full coverage for ${releaseVersion})` : 'Translations',
    command: isMajor ? 'node scripts/check-i18n-release.mjs --full-coverage' : 'node scripts/check-i18n-release.mjs',
    summary: summaries.i18n,
  },
  {
    id: 'obsidian-review',
    label: 'Obsidian review readiness',
    command: 'node scripts/check-obsidian-review-readiness.mjs',
  },
  {
    id: 'eyeball',
    label: 'Eyeball checklist',
    command: 'node scripts/release-eyeball-check.mjs',
    summary: output => {
      const files = output.split('Touched files:')[1]?.split('\n\n')[0]?.split('\n').filter(line => line.startsWith('- ') && !line.includes('None detected')).length ?? 0;
      return `${formatCount(files)} touched files; checklist in the log`;
    },
  },
];

if (isMain(import.meta.url)) {
  const result = await runSteps('Release preflight', 'release-preflight', steps);
  if (result.ok && isBiweeklyDeepAuditDue(now)) {
    console.log('Biweekly Deep Audit is due or overdue: npm run auditDeep');
  }
  process.exitCode = result.code;
}
