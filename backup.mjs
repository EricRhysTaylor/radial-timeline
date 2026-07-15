#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const quiet = process.argv.includes('--quiet');
const PRIMARY_BRANCH = 'main';

// Env-independent verification hold. A bare `.rt-verification-hold` file in
// the repo root makes every auto-backup path a no-op regardless of how the
// build was triggered (covers out-of-band `npm run build` started by Obsidian
// during manual verification, where RT_SKIP_AUTO_BACKUP isn't exported).
// Delete the file to resume normal auto-backup.
if (existsSync('.rt-verification-hold')) {
  console.log('[backup] .rt-verification-hold present — skipping auto add/commit/push (verification hold).');
  process.exit(0);
}

// Opt-out for verification-gated work (e.g. Step-C/D boundaries that require
// manual Obsidian verification BEFORE any commit). Set RT_SKIP_AUTO_BACKUP=1
// in the shell to make every auto-backup path (npm run build /
// build-with-backup-check.mjs / npm run backup) a no-op: no git add, no
// commit, no push. Changes stay in the working tree until you commit
// deliberately. Default (unset) preserves the normal auto-backup behavior.
if (process.env.RT_SKIP_AUTO_BACKUP === '1') {
  console.log('[backup] RT_SKIP_AUTO_BACKUP=1 — skipping auto add/commit/push (verification-gated work).');
  process.exit(0);
}

function run(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim();
}

function safeRun(cmd) {
  try { return run(cmd); } catch (e) { return ''; }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function readCliNote(args) {
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--quiet') continue;
    if (arg === '--note' || arg === '--message') {
      const valueParts = [];
      for (let valueIndex = index + 1; valueIndex < args.length; valueIndex += 1) {
        if (args[valueIndex].startsWith('--')) break;
        valueParts.push(args[valueIndex]);
      }
      return valueParts.join(' ').trim();
    }
    if (arg.startsWith('--note=') || arg.startsWith('--message=')) {
      return arg.slice(arg.indexOf('=') + 1).trim();
    }
    if (!arg.startsWith('--')) positional.push(arg);
  }
  return positional.join(' ').trim();
}

function assertNoGitOperationInProgress() {
  const gitDir = safeRun('git rev-parse --git-dir');
  if (!gitDir) return;

  const absoluteGitDir = path.resolve(gitDir);
  const blockingStates = [
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['MERGE_HEAD', 'merge'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert']
  ];

  const active = blockingStates.find(([file]) => existsSync(path.join(absoluteGitDir, file)));
  if (active) {
    throw new Error(`Git ${active[1]} in progress. Resolve or abort it before running backup.`);
  }
}

function assertRemoteCanFastForward(branch, phase) {
  if (!branch || branch === 'HEAD') {
    throw new Error('Cannot backup from detached HEAD. Check out a branch first.');
  }

  run('git fetch origin');

  const remoteRef = `origin/${branch}`;
  const remoteExists = safeRun(`git rev-parse --verify --quiet ${shellQuote(remoteRef)}`);
  if (!remoteExists) {
    throw new Error(`Remote tracking branch ${remoteRef} not found. Push or set upstream deliberately before backup.`);
  }

  const counts = run(`git rev-list --left-right --count ${shellQuote(`HEAD...${remoteRef}`)}`);
  const [aheadText = '0', behindText = '0'] = counts.split(/\s+/);
  const ahead = Number(aheadText);
  const behind = Number(behindText);

  if (behind > 0) {
    const state = ahead > 0 ? `diverged (${ahead} ahead, ${behind} behind)` : `behind by ${behind}`;
    throw new Error(
      `Refusing backup ${phase}: local ${branch} is ${state} relative to ${remoteRef}. ` +
      `Run "git pull --rebase origin ${branch}" and resolve conflicts before backup.`
    );
  }
}


try {
  // Ensure we are in a git repo
  run('git rev-parse --is-inside-work-tree');

  // Backups are a main-only publishing path. Never silently push a feature or
  // stale legacy branch just because it happens to be checked out.
  const branch = safeRun('git rev-parse --abbrev-ref HEAD');
  if (branch !== PRIMARY_BRANCH) {
    throw new Error(`Backups must run from '${PRIMARY_BRANCH}'. Current branch: '${branch || 'unknown'}'.`);
  }
  if (!quiet) {
    console.log(`[backup] backing up branch: ${branch}`);
  }

  assertNoGitOperationInProgress();
  assertRemoteCanFastForward(branch, 'before commit');

  // Stage all changes (including new/deleted files)
  safeRun('git add -A');

  // Check if there is anything to commit
  const status = run('git status --porcelain');
  if (!status) {
    console.log('[backup] No changes to commit.');
    process.exit(0);
  }

  // Build a more descriptive commit message
  const iso = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${iso.getFullYear()}-${pad(iso.getMonth() + 1)}-${pad(iso.getDate())} ${pad(iso.getHours())}:${pad(iso.getMinutes())}`;

  const files = run('git diff --cached --name-only').split('\n').filter(Boolean);
  if (!quiet && files.length) {
    const previewLimit = 20;
    const preview = files.slice(0, previewLimit).join(', ');
    const extraCount = files.length > previewLimit ? `, … (+${files.length - previewLimit} more)` : '';
    console.log(`[backup] Staged files (${files.length}): ${preview}${extraCount}`);
  }
  // Determine user note from (in order): direct CLI args, BACKUP_NOTE env, npm_config_argv trailing args
  let npmArgvNote = '';
  const npmArgvRaw = process.env.npm_config_argv || '';
  if (npmArgvRaw) {
    try {
      const parsed = JSON.parse(npmArgvRaw);
      const original = Array.isArray(parsed?.original) ? parsed.original : [];
      // Find anything after the first occurrence of 'backup' that is not an option (doesn't start with '-')
      const backupIdx = original.indexOf('backup');
      if (backupIdx !== -1 && backupIdx + 1 < original.length) {
        const tail = original.slice(backupIdx + 1).filter((t) => typeof t === 'string' && !t.startsWith('--'));
        npmArgvNote = tail.join(' ').trim();
      }
    } catch (_) { /* ignore */ }
  }
  const userNote = readCliNote(process.argv.slice(2)) || (process.env.BACKUP_NOTE || '').trim() || npmArgvNote;
  const shortstat = safeRun('git diff --cached --shortstat');
  let insertions = 0, deletions = 0;
  if (shortstat) {
    // Example: " 5 files changed, 42 insertions(+), 7 deletions(-)"
    const ins = shortstat.match(/(\d+) insertions?\(\+\)/);
    const del = shortstat.match(/(\d+) deletions?\(-\)/);
    insertions = ins ? Number(ins[1]) : 0;
    deletions = del ? Number(del[1]) : 0;
  }

  if (!quiet && (insertions || deletions)) {
    console.log(`[backup] Diff summary: +${insertions}/-${deletions}`);
  } else if (!quiet && !files.length) {
    console.log('[backup] Diff summary: no tracked changes (unexpected)');
  } else if (!quiet) {
    console.log('[backup] Diff summary: no line-level changes detected');
  }

  // Summarize changed areas by top-level folder (or 'root')
  const areaCounts = new Map();
  for (const f of files) {
    const top = f.includes('/') ? f.split('/')[0] : 'root';
    areaCounts.set(top, (areaCounts.get(top) || 0) + 1);
  }
  const sortedAreas = Array.from(areaCounts.entries()).sort((a, b) => b[1] - a[1]);
  const topAreas = sortedAreas.slice(0, 3).map(([name, count]) => `${name}(${count})`).join(', ');

  // Heuristic: choose a category label for the title
  const isImage = (f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f);
  const isDoc = (f) => /(README\.md|\.mdx?$|^docs\/|wiki\/)/i.test(f);
  const isStyle = (f) => /\.css$/i.test(f);
  const isRelease = (f) => /^release\//.test(f);
  let category = '';
  if (files.length && files.every(isImage)) category = 'screenshots';
  else if (files.length && files.every(isDoc)) category = 'docs';
  else if (files.length && files.every(isStyle)) category = 'styles';
  else if (files.length && files.every(isRelease)) category = 'release';
  else if (files.some(isImage) && !files.some(f => !isImage(f))) category = 'images';

  const titleParts = [`[backup] ${dateStr}`];
  if (category) titleParts.push(category);
  if (topAreas) titleParts.push(topAreas);
  if (!userNote && files.length === 1) {
    const single = files[0];
    titleParts.push(single);
  }
  if (userNote) titleParts.push(userNote);
  titleParts.push(`${files.length} files`);
  if (insertions || deletions) titleParts.push(`+${insertions}/-${deletions}`);
  const title = titleParts.join(' — ');

  // Show a short file list (up to 12) in the body
  const maxList = 12;
  const fileList = files.slice(0, maxList).join(', ');
  const more = files.length > maxList ? `, … (+${files.length - maxList} more)` : '';
  const bodyLines = [
    topAreas ? `Areas: ${topAreas}` : '',
    fileList ? `Files: ${fileList}${more}` : ''
  ].filter(Boolean);
  const body = bodyLines.join('\n');

  // Commit
  run(`git commit -m ${JSON.stringify(title)} ${body ? '-m ' + JSON.stringify(body) : ''}`);
  console.log(`[backup] Committed changes: ${title}`);

  assertRemoteCanFastForward(branch, 'before push');

  // Push to the current branch
  run(`git push origin ${shellQuote(branch)}`);
  console.log(`[backup] ✅ Pushed to origin/${branch} (safe backup)`);

  // Auto-publish GitHub wiki when wiki/ files changed
  const wikiChanged = files.some(f => f.startsWith('wiki/'));
  if (wikiChanged) {
    const wikiFiles = files.filter(f => f.startsWith('wiki/'));
    console.log(`[backup] Wiki files changed (${wikiFiles.length}): ${wikiFiles.slice(0, 8).join(', ')}${wikiFiles.length > 8 ? ', …' : ''}`);
    try {
      run('node scripts/publish-wiki.mjs');
      console.log('[backup] ✅ GitHub wiki published');
    } catch (wikiErr) {
      // Wiki publish failure must never fail the backup
      console.warn('[backup] ⚠️  Wiki publish failed (backup itself succeeded):', wikiErr?.message || wikiErr);
    }
  }
} catch (err) {
  console.error('[backup] Failed:', err?.message || err);
  process.exit(1);
}
