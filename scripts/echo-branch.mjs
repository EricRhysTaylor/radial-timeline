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

if (mode === 'release' && branch !== PRIMARY_BRANCH) {
  console.log(`[warn] You are about to run a release while on '${branch}'. Releases must be cut from '${PRIMARY_BRANCH}'.`);
  console.log(`[hint] Run: git switch ${PRIMARY_BRANCH} && git pull`);
}

if (mode === 'backup' && !quiet) {
  console.log(`[note] Backup will commit to '${PRIMARY_BRANCH}'.`);
}
