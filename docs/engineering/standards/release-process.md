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
3. Dispatches `.github/workflows/release-build.yml` and waits for it
   (`gh run watch`, logged; the terminal shows the run link and one line
   when it ends). The workflow:
   - checks out the version tag,
   - `npm ci`, then `RT_RELEASE_BUILD=1 node esbuild.config.mjs production`
     (release builds always output to `./release`, even in CI; embedded
     fonts ship as data URIs in `src/styles/font.css`). The variable picks
     the output folder only: every build compiles the same code, so a plain
     `npm run build` reproduces the released `main.js` byte for byte, which
     is what Obsidian's review checks. Beta features key off the
     `beta-features` marker that local builds write into each development
     vault's plugin folder (`src/settings/featureGate.ts`),
   - signs a build-provenance attestation for `main.js`, `manifest.json`,
     and `styles.css`,
   - runs `scripts/check-shipped-assets.mjs` and spot-checks that the
     embedded asset keys are present in the built `main.js`,
   - uploads the three assets to the release with `--clobber`.
4. Publishes the draft (answering y to "Finish and PUBLISH" in step 1 is
   the decision; there is no later prompt) and checks the three public
   download links.

## What a run prints

Owner's request, 2026-11-23: a release prints one line per step, the step
name, PASS or FAIL and its counts, and nothing else.

```
[4/5] Obsidian lint baseline ... PASS (8.2s) 0 findings (baseline 0)
```

- Every step's full output goes to a gitignored folder under `.gate-logs/`,
  named on the runner's first line. Nested runners (the pre-push gates
  during a push, `release:prep`, `verify`) write into that run's folder.
- A failing step prints its last 40 lines and its log path.
- A question waiting for an answer starts with `▶ YOUR ANSWER NEEDED`;
  the end of phase 1 starts with `▶ ACTION REQUIRED`.
- The compliance and CSS drift ratchets print counts and write their full
  listings to `.gate-logs/compliance-report.txt` and
  `.gate-logs/css-drift-report.txt`. They list offenders in the terminal
  only when a rule's count rises above its baseline, the files changed on
  the branch first. Pass `--verbose` to either check, or to any runner, to
  see everything.
- Vitest hides console output from passing tests (`silent: 'passed-only'`
  in `vitest.config.ts`); a failing test still prints its output.
- One runner for all of this: `scripts/lib/step-runner.mjs`.

## Release notes

Eric's standing rules (2026-11-20). They were added after 8.0.5 shipped the Chronologue Time scale, the PDF style designer and LaTeX template import as a patch release with no screenshots, and was re-released as 8.1.0.

- **The version says what changed.** Choose it from the notes, not from the last tag.
  - A patch release (`x.y.z`) holds fixes and a few small changes.
  - New features or major improvements make a minor release (`x.y.0`).
  - `x.0.0` is a major release.
  - Rule of thumb: if an author would want to hear about it, it isn't a patch.
- **Show the major new features.** A minor or major release carries 1 to 5 screenshots of its biggest changes, so an author can see quickly what changed. A release where nothing important changed needs none.
  - Each screenshot goes right after the item it shows, as `<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/<commit>/wiki/images/<file>.webp" alt="…" width="800">` (600 for a timeline alone). GitHub release bodies don't resolve relative paths, so pin the `src` to the commit that added the image.
  - Images are 2x, sRGB and WebP, with about 12 px rounded corners baked into the file (GitHub strips CSS). They live in `wiki/images/`.
  - Alt text says exactly what the picture shows: the book, the mode and what is lit or open.
  - Capture from a test Obsidian on a copy of a demo vault, never Eric's (`Video/tools/capture/README.md`).
- **Enforced.** `scripts/check-release-notes.mjs` runs in phase 1, before anything is committed, tagged or pushed. It stops:
  - a patch whose draft lists more than 6 items outside its Fixes section (since 8.0, patches held at most 5);
  - a minor or major release with no screenshots;
  - more than 5 screenshots;
  - a Markdown image, an unpinned `src` or missing alt text.
  It reads `docs/releases/draft-for-release-<version>.md`, so write the draft, with its screenshots, before running `npm run release`.
- **Eric approves the version and the notes before Step 1.**
  - Ask with a dedicated question, not inside a report, giving the version and why it is a patch, minor or major release.
  - Include a GitHub link to the pushed draft that he can open on his phone.
  - Run the release only after his yes. Ask again if either changes. See the repo `CLAUDE.md`, "Releases".

## Announce on the Obsidian forum

Eric's standing rule (2026-11-21): every minor (`x.y.0`) and major (`x.0.0`) release gets an update on the Obsidian forum the day it is published. Patches don't.

- **Where:** a reply on the plugin's own showcase thread, [Radial Timeline — see your novel's structure at a glance](https://forum.obsidian.md/t/radial-timeline-see-your-novels-structure-at-a-glance/117880), Eric's account ERTaylor. Reply rather than start a new topic: the forum prefers one thread per plugin, and a reply moves the thread back to the top of Share & showcase.
- **Why:** Obsidian users read the forum. Backlinks, Mike Schmitz's weekly Obsidian roundup, gathers its items with a Claude-built tool, and the forum is probably one of its sources.
- **What, built from the release notes:**
  1. A first line that stands on its own: "**Radial Timeline x.y.0 is out**", then the headline in one clause. Roundup tools read the title and first lines.
  2. Two to four headline features, each a short section with the release notes' own pinned screenshots.
  3. **Videos:** new or relevant tutorials. A YouTube link on a line by itself shows as a player.
  4. A link to the full release notes on GitHub.
  5. Any current call (a beta, a survey) with its own `/go/` link (`forum-…`).
- **How:**
  - The agent writes the reply in Eric's Chrome: the thread's Reply composer, switched to the Markdown editor so images and links come through exactly.
  - It checks that every image loads in the preview.
  - **Eric reads it and clicks Reply himself. Agents never post.**
  - First done for 8.1.0 (post #2 on the thread).

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
- `scripts/release-checks.mjs` — the checks npm runs before every `npm run release` (branch, stranded drafts, Obsidian review, lint baseline, PDF layouts).
- `scripts/check-release-notes.mjs` — version and screenshot gate for the notes draft (phase 1).
- `scripts/release-preflight.mjs` — pre-release audit gates.
- `scripts/verify.mjs` — build, standards and tests (phase 2).
- `scripts/lib/step-runner.mjs` — the one-line-per-step runner and log folders.
- `scripts/release-eyeball-check.mjs` — human review checklist of touched
  surfaces since the last tag.
- `scripts/check-obsidian-review-readiness.mjs` — directory-listing
  compliance (manifests, disclosures, runtime checks).
