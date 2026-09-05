#!/usr/bin/env node
import { execSync } from 'node:child_process';

function run(cmd, options = {}) {
  return execSync(cmd, { stdio: 'inherit', ...options });
}

function safeRun(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

function stashListNonEmpty() {
  try {
    const out = execSync('git stash list', { stdio: 'pipe' }).toString();
    return out.trim().length > 0;
  } catch (_) {
    return false;
  }
}

try {
  // Check if backup is needed (more than 1 hour since last commit)
  let backupNeeded = !safeRun('node check-backup-time.mjs');

  // Auto-backup safety guards. The backup runs `git add -A` and pushes to
  // origin, so it must never fire when the working tree is in a partial
  // state or when an external caller (CI, agent, verification script)
  // explicitly opted out.
  if (backupNeeded && process.env.SKIP_BACKUP) {
    console.log('[build] SKIP_BACKUP set — skipping post-build backup.');
    backupNeeded = false;
  }
  if (backupNeeded && stashListNonEmpty()) {
    console.log('[build] Stash entries exist — skipping post-build backup so partial state is not committed.');
    backupNeeded = false;
  }

  // Run the actual build steps
  console.log('\n[build] Running build steps...\n');
  run('node show-scripts.mjs');
  run('node scripts/check-ert-locks.mjs');
  run('node check-gross-deletions.mjs');
  run('node scripts/bundle-css.mjs'); // Generate CSS before checking it
  run('npx tsc --noEmit');
  run('node code-quality-check.mjs src/main.ts src/styles/settings.css --quiet');
  run('node check-css-duplicates.mjs --quiet');
  run('node esbuild.config.mjs production');
  
  console.log('\n[build] ✅ Build completed successfully\n');
  
  // If backup is needed, run it
  if (backupNeeded) {
    console.log('[build] Running automatic backup...\n');
    run('npm run backup -- "automatic backup after build"');
  }
  
  process.exit(0);
} catch (err) {
  console.error('[build] Build failed:', err?.message || err);
  process.exit(1);
}
