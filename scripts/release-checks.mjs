#!/usr/bin/env node
// The checks `npm run release` runs first (npm's `prerelease` hook), one line
// each. Full output: the log folder named on the first line. `--verbose`
// streams every step's output as well.
import process from 'node:process';
import { isMain, runSteps, summaries } from './lib/step-runner.mjs';

export const steps = [
    {
        id: 'branch',
        label: 'Release branch',
        command: 'node scripts/echo-branch.mjs release --quiet',
        summary: output => /\[release\] On (\S+)\./.exec(output)?.[1] ?? '',
    },
    {
        id: 'draft-releases',
        label: 'Stranded draft releases',
        command: 'node scripts/check-unpublished-releases.mjs',
        summary: summaries.draftReleases,
    },
    {
        id: 'obsidian-review',
        label: 'Obsidian review readiness',
        command: 'node scripts/check-obsidian-review-readiness.mjs',
    },
    {
        id: 'obsidian-lint',
        label: 'Obsidian lint baseline',
        command: 'node scripts/lint-obsidian-enforced.mjs --quiet',
        summary: summaries.obsidianLintBaseline,
    },
    {
        id: 'pdf-smoke',
        label: 'Bundled PDF layouts',
        command: 'npm run --silent publish:pdf-smoke',
        summary: summaries.pdfLayouts,
    },
];

if (isMain(import.meta.url)) {
    const result = await runSteps('Release checks', 'release-checks', steps);
    process.exitCode = result.code;
}
