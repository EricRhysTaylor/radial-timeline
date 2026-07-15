# Release Process

Authoritative description of how a Radial Timeline release is cut. As of
6.2.2, release assets are built on GitHub-hosted runners and carry a signed
build-provenance attestation. Local machines never build or upload release
assets — CI is the only path (per the no-fallback policy).

## Why CI builds

The Obsidian community directory scorecard verifies artifact attestation:
cryptographic proof that the uploaded `main.js` was built from this repo's
source at a specific commit by GitHub's infrastructure, not assembled by
hand. Attestations can only be signed inside GitHub Actions
(`actions/attest-build-provenance`), so the build must happen there.

## The flow

`npm run release` (release-script.mjs) is still the single entry point and
still runs in two phases:

### Phase 1 — draft

1. Prompts for the new version, bumps `package.json`, syncs
   `src/manifest.json` / `manifest.json` / `versions.json`.
2. Generates a changelog (or uses `docs/releases/draft-for-release-<v>.md`
   if present), updates the embedded release-notes bundle.
3. Commits, tags `<version>`, pushes code and tag.
4. Creates a **draft** GitHub release and opens it in the browser.

→ You edit the release notes on GitHub, save the draft (do not publish).

### Phase 2 — finish (run `npm run release` again)

1. Detects the existing draft, syncs the polished notes back into
   `src/data/releaseNotesBundle.json`, commits, and force-moves the tag so
   the tagged commit contains the final notes.
2. Runs `release:prep` (audits + review readiness + eyeball checklist) and
   `verify` locally as gates.
3. Dispatches `.github/workflows/release-build.yml` and watches it live
   (`gh run watch`). The workflow:
   - checks out the version tag,
   - `npm ci`, then `RT_RELEASE_BUILD=1 node esbuild.config.mjs production`
     (release builds always output to `./release`, even in CI),
   - injects embedded fonts (`scripts/inject-embedded-fonts.mjs`),
   - signs a build-provenance attestation for `main.js`, `manifest.json`,
     and `styles.css`,
   - uploads the three assets to the release with `--clobber`.
4. Prompts to publish the draft.

## Verifying an attestation

```
gh attestation verify release/main.js --repo EricRhysTaylor/Radial-Timeline
```

Anyone can run this against a downloaded release asset.

## Testing the workflow without touching a release

Dispatch with `dry_run=true` (skips the upload step; build and attestation
still run):

```
gh workflow run release-build.yml --ref main \
  -f version=<existing-tag> -f ref=main -f dry_run=true
```

`ref` overrides what gets built (defaults to the version tag) — useful for
validating workflow changes on main before a tag exists.

## Failure modes

- **Workflow run fails**: fix the cause, then re-run phase 2. The script
  re-detects the draft and re-dispatches. Asset upload uses `--clobber`, so
  re-runs are idempotent.
- **Tag content wrong** (e.g. notes committed after tagging): phase 2
  force-moves the tag before dispatching, so re-running phase 2 self-heals.
- **Do not** build locally and `gh release upload` by hand — the asset would
  ship without attestation and regress the scorecard.

## Related

- `release-script.mjs` — orchestrator (draft, notes sync, dispatch, publish).
- `.github/workflows/release-build.yml` — build + attest + upload.
- `scripts/release-preflight.mjs` — pre-release audit gates.
- `scripts/release-eyeball-check.mjs` — human review checklist of touched
  surfaces since the last tag.
- `scripts/check-obsidian-review-readiness.mjs` — directory-listing
  compliance (manifests, disclosures, runtime checks).
