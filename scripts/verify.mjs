#!/usr/bin/env node
// Verify (`npm run verify`), run by the release script while finishing a
// draft: build, standards and tests, one line each. Full output in the log
// folder named on the first line. `--verbose` streams every step's output.
import process from 'node:process';
import { isMain, runSteps, summaries } from './lib/step-runner.mjs';

export const steps = [
  {
    id: 'build',
    label: 'Build',
    command: 'npm run --silent build',
  },
  {
    id: 'css-drift',
    label: 'CSS drift',
    command: 'node scripts/css-drift-check.mjs --maintenance',
    summary: summaries.cssDrift,
  },
  {
    id: 'obsidian-version',
    label: 'Obsidian version',
    command: 'node scripts/check-obsidian-version.mjs',
    summary: summaries.obsidianVersion,
  },
  {
    id: 'compliance',
    label: 'Compliance',
    command: 'node scripts/compliance-check.mjs --maintenance',
    summary: summaries.compliance,
  },
  {
    id: 'code-quality',
    label: 'Code quality',
    command: 'node code-quality-check.mjs --all',
  },
  {
    id: 'css-duplicates',
    label: 'CSS duplicates',
    command: 'node check-css-duplicates.mjs --quiet',
  },
  {
    id: 'tests',
    label: 'Unit tests',
    // `test` (not test:quiet) so npm's pretest hook embeds the plugin assets first.
    command: 'npm run --silent test -- --reporter=dot',
    summary: summaries.vitest,
  },
];

if (isMain(import.meta.url)) {
  const result = await runSteps('Verify', 'verify', steps);
  process.exitCode = result.code;
}
