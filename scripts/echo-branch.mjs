#!/usr/bin/env node
import { execSync } from 'node:child_process';

const PRIMARY_BRANCH = 'main';

function getBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' }).toString().trim();
  } catch {
    return '(no git repo)';
  }
}

const mode = (process.argv[2] || '').toLowerCase();
const quiet = process.argv.includes('--quiet');
const branch = getBranch();

if (!quiet) {
  console.log(`[info] Current git branch: ${branch}`);
}

// The release script refuses any branch but main; stop here too, before the
// slower release checks run.
if (mode === 'release' && branch !== PRIMARY_BRANCH) {
  console.log(`[release] Releases must be cut from '${PRIMARY_BRANCH}'; you are on '${branch}'.`);
  console.log(`[hint] Run: git switch ${PRIMARY_BRANCH} && git pull`);
  process.exitCode = 1;
} else if (mode === 'release') {
  console.log(`[release] On ${branch}.`);
}

if (mode === 'backup' && !quiet) {
  console.log(`[note] Backup will commit to '${PRIMARY_BRANCH}'.`);
}
