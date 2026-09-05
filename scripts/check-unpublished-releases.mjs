#!/usr/bin/env node
// Guard against stranded draft releases.
//
// The 7.1.1 release sat in GitHub draft state for 12 days: tag pushed,
// manifest bumped, assets uploaded — but "Publish it now?" was never
// answered, so Obsidian saw a manifest version with no published release
// and refused to scan or distribute it. Users silently stayed on 7.1.0.
//
// Rule: a draft whose tag matches the CURRENT package.json version is fine
// (that's the release script's own resume path, mid-flow). A draft for any
// OTHER version is a stranded release from a previous run — fail with the
// one-line fix. Fail-closed on a missing/failing gh, matching the
// preflight doctrine: a check that cannot run must stop the release, not
// skip.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const currentVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;

let releases;
try {
  const json = execSync('gh release list --limit 20 --json tagName,isDraft', { encoding: 'utf8' });
  releases = JSON.parse(json);
} catch (err) {
  console.error('[draft-release-check] FAIL: could not list GitHub releases via gh.');
  console.error(`[draft-release-check] ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  console.error('[draft-release-check] Releases must be verifiable before shipping — fix gh auth/network and rerun.');
  process.exit(1);
}

const drafts = releases.filter((release) => release.isDraft);
const stranded = drafts.filter((release) => release.tagName !== currentVersion);
const inFlight = drafts.filter((release) => release.tagName === currentVersion);

if (stranded.length > 0) {
  console.error('[draft-release-check] FAIL: stranded draft release(s) found — these were never published and are invisible to Obsidian:');
  for (const release of stranded) {
    console.error(`  - ${release.tagName}  (publish with: gh release edit ${release.tagName} --draft=false)`);
  }
  process.exit(1);
}

if (inFlight.length > 0) {
  console.log(`[draft-release-check] NOTE: draft for current version ${currentVersion} exists — finish it via npm run release (or gh release edit ${currentVersion} --draft=false).`);
} else {
  console.log('[draft-release-check] PASS: no draft releases.');
}
