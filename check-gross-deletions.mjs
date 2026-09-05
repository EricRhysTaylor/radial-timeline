#!/usr/bin/env node
import { execSync } from 'node:child_process';

const fileThreshold = Number(process.env.GROSS_DELETION_FILE_THRESHOLD || '100');
const totalThreshold = Number(process.env.GROSS_DELETION_TOTAL_THRESHOLD || '100');

function tryRun(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    return null;
  }
}

const insideRepo = tryRun('git rev-parse --is-inside-work-tree');
if (!insideRepo) {
  process.exit(0); // Not in a git repo; nothing to check
}

const diffOutput = tryRun('git diff --numstat HEAD --');
if (!diffOutput || !diffOutput.trim()) {
  process.exit(0); // No changes to inspect
}

const entries = diffOutput
  .trim()
  .split('\n')
  .map(line => {
    const parts = line.split('\t');
    if (parts.length < 3) return null;

    const [addsRaw, delsRaw, ...rest] = parts;
    const file = rest.join('\t').trim();
    const added = Number.parseInt(addsRaw, 10);
    const deleted = Number.parseInt(delsRaw, 10);

    return {
      file,
      added: Number.isFinite(added) ? added : 0,
      deleted: Number.isFinite(deleted) ? deleted : 0
    };
  })
  .filter(Boolean);

const totalDeleted = entries.reduce((sum, entry) => sum + entry.deleted, 0);
const largeFileDeletions = entries.filter(entry => entry.deleted >= fileThreshold);

if (totalDeleted < totalThreshold && largeFileDeletions.length === 0) {
  process.exit(0); // Nothing suspicious
}

console.log('\n⚠️  Possible accidental gross deletion detected.');
if (totalDeleted >= totalThreshold) {
  console.log(`   Total deleted lines: ${totalDeleted} (threshold ${totalThreshold})`);
}
if (largeFileDeletions.length) {
  console.log('   Files with large deletions:');
  largeFileDeletions.slice(0, 5).forEach(({ file, deleted, added }) => {
    console.log(`     - ${file} (-${deleted} / +${added})`);
  });
  if (largeFileDeletions.length > 5) {
    console.log(`     ...and ${largeFileDeletions.length - 5} more`);
  }
}

process.exit(0);

