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
     (release builds always output to `./release`, even in CI; embedded
     fonts ship as data URIs in `src/styles/font.css`),
   - signs a build-provenance attestation for `main.js`, `manifest.json`,
     and `styles.css`,
   - runs `scripts/check-shipped-assets.mjs` and spot-checks that the
     embedded asset keys are present in the built `main.js`,
   - uploads the three assets to the release with `--clobber`.
4. Prompts to publish the draft.

## Three files ship. Nothing else.

Obsidian's plugin installer downloads exactly `manifest.json`, `main.js` and
`styles.css` from a release. Extra files attached to the release are ignored,
and files the build copies into `./release/` are not uploaded at all.

This is easy to get wrong, because the dev build also copies into local test
vaults — so a feature that reads a loose file from the plugin folder works on
this machine and is broken for every user who installed through the Community
Plugins browser. That shipped for months: bundled Pandoc fonts and the Word
reference document (GH #29, #34), plus the Inquiry logo and background
texture.

A binary that a feature needs at runtime has exactly two routes:

| Route | Script | Lands in |
|---|---|---|
| Base64 into the JS bundle | `scripts/embed-plugin-assets.mjs` | `main.js` |
| Base64 data URI into the stylesheet | `scripts/bundle-css.mjs` | `styles.css` |

`scripts/check-shipped-assets.mjs` (gate: **Shipped assets**, and inside
`build-only`) fails the build if any binary under `src/` is in neither route,
if a manifest entry points at a deleted file, or if `directoriesToCopy`
reappears in `esbuild.config.mjs`.

Fonts that a TeX distribution already provides (Latin Modern) are deliberately
**not** bundled — `fontResolver.ts` emits the TeX filename form so kpathsea
resolves them from the texmf tree. Note that the family-name form
(`\setmainfont{Latin Modern Roman}`) does *not* resolve on a stock TeX
install; only the filename form does.

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
