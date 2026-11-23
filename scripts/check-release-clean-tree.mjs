#!/usr/bin/env node
// The release stages everything (`git add .`, and release:prep's audit runs
// `git add -A`), so an uncommitted file that isn't part of the release would be
// committed and shipped with it. Stop before anything happens, and name the files.
// Release-notes drafts are part of the release and may be uncommitted.
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/step-runner.mjs';

const RELEASE_OWN = /^docs\/releases\/draft-for-release-[^/]+\.md$/;

/** Paths from `git status --porcelain=v1 -z`, with renames giving their new path. */
export function changedPaths(porcelainZ) {
    const parts = porcelainZ.split('\0').filter(Boolean);
    const paths = [];
    for (let i = 0; i < parts.length; i += 1) {
        const entry = parts[i];
        const status = entry.slice(0, 2);
        paths.push({ status, path: entry.slice(3) });
        // A rename or copy is followed by its old path as its own entry.
        if (status[0] === 'R' || status[0] === 'C') i += 1;
    }
    return paths;
}

/** The changed paths the release would sweep up that aren't its own. */
export function unrelatedChanges(porcelainZ) {
    return changedPaths(porcelainZ).filter(({ path }) => !RELEASE_OWN.test(path));
}

function main() {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8', cwd: repoRoot });
    const unrelated = unrelatedChanges(status);
    if (unrelated.length === 0) {
        console.log('[clean-tree] Nothing uncommitted besides release notes.');
        return;
    }
    console.error(`[clean-tree] ${unrelated.length} uncommitted file${unrelated.length === 1 ? '' : 's'} the release would commit:`);
    for (const { status: s, path } of unrelated) console.error(`  ${s.trim() || '?'} ${path}`);
    console.error('Commit them, or set them aside with `git stash push -- <files>`, then run the release again.');
    process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
