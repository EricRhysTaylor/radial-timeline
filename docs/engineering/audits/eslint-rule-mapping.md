# Quality-Gate → Official ESLint Rule Mapping

Decision artifact for the gate-tooling overhaul. Built **before** any deletion so
project doctrine is not mistaken for generic Obsidian guidance that
`eslint-plugin-obsidianmd` now owns.

Status: **step 4 / selective ratchet enforcement**. The full Obsidian preset is
still report-only. Two confirmed replacement rules are now enforced through a
committed baseline in `scripts/eslint-obsidian-enforced-baseline.json`:
`obsidianmd/no-static-styles-assignment` and `obsidianmd/prefer-window-timers`.
No custom checks have been deleted yet.

## Preconditions discovered

- `eslint@^8.57.1` and `@typescript-eslint/*@^6.21.0` are in `devDependencies`,
  but **no ESLint config file exists** (`.eslintrc*` / `eslint.config.*` absent)
  and **`eslint-plugin-obsidianmd` is not installed**. `npm run audit:eslint`
  therefore lints against no rules and is non-blocking (`|| true`).
- The official plugin targets **flat config / ESLint 9**. Adopting it implies an
  **ESLint 8→9 and typescript-eslint 6→8 upgrade** — fold that into step 3's scope.
- Existing CI: `.github/workflows/pricing-check.yml` (blocking, pricing only) and
  `.github/workflows/sanitation-audit.yml` (non-blocking). No blocking
  lint/typecheck/build/test workflow on push/PR yet (step 5).

## Legend

- **REPLACE** — official AST rule supersedes our regex; delete ours once ESLint gate is blocking.
- **CORE** — covered by an ESLint core or `@typescript-eslint` rule (not the Obsidian plugin); enable that rule, delete ours.
- **KEEP** — project doctrine or security check the official plugin does **not** cover. Stays.
- **GAIN** — official rule with **no** current equivalent; new coverage we pick up for free.

---

## code-quality-check.mjs

| Custom check (line) | Official rule | Verdict | Notes |
|---|---|---|---|
| `innerHTML` / `outerHTML` assignment (16–17) | bundled `@microsoft/sdl/no-inner-html`, `no-unsanitized/property` | **KEEP for now** | Security/XSS. Bundled coverage exists, but not yet promoted; dedupe with compliance-check later. |
| inline `style=` / `.style.prop=` (18–21) | `no-static-styles-assignment` | **REPLACE confirmed / ratcheted** | Direct match. Promoted in step 4 via selected-rule baseline; do not delete custom check until the ratchet proves stable. |
| `document.createElement(...).style=` (21) | `no-static-styles-assignment` | **REPLACE confirmed / ratcheted** | Same rule. |
| `getLeaf().openFile()` (22) | *(none exact)* | **KEEP** | Our workspace.openLinkText preference; not generic. |
| `: any` type (48) | `@typescript-eslint/no-explicit-any` | **CORE** | Type-checked rule catches `as any`, `any[]`, generics our regex misses. |
| CSS class must be `ert-`/`is-`/`has-` prefixed (72–125) | *(none)* | **KEEP** | **ERT design-system doctrine. Do not delete.** |
| `settings.css` scoped under `.rt-settings-root` (207–231) | *(none)* | **KEEP** | Project scoping doctrine. |

## compliance-check.mjs — source-scan rules

| Rule id | Official rule | Verdict | Notes |
|---|---|---|---|
| `innerHTML`, `outerHTML`, `svg-innerHTML-reassignment` | *(none)* | **KEEP** | Security; consolidate with code-quality-check. |
| `eval` | core `no-eval` | **CORE** | |
| `new-function` | core `no-new-func` | **CORE** | |
| `node-core-import`, `node-core-require` | `no-nodejs-modules` | **REPLACE** | |
| `console-log` | core `no-console` | **CORE** | |
| `nodejs-timeout-type`, `bare-timeout-call` | `prefer-window-timers` | **REPLACE confirmed / ratcheted** | Auto-fixable upstream. Promoted in step 4 via selected-rule baseline. |
| `var-declaration` | core `no-var` | **CORE** | |
| `platform-import-check` | `platform` | **REPLACE** | |
| `detach-leaves-in-onunload` | `detach-leaves` | **REPLACE** | Direct match, **auto-fixable** upstream. |
| `persistent-view-reference` | `no-view-references-in-plugin` | **REPLACE** | Direct match; retires our look-ahead heuristic. |
| `markdown-render-source` | `no-plugin-as-component` | **REPLACE** | Overlapping intent; confirm coverage before deleting. |
| `raw-addEventListener` | *(none)* | **KEEP** | registerDomEvent guidance; our heuristic is fragile but unique. |
| `observer-without-cleanup`, `animation-frame-without-cleanup`, `interval-without-register` | *(none)* | **KEEP** | Lifecycle-leak heuristics; fragile, but no upstream equivalent. |
| `fetch`, `xhr`, `fetch-without-signal` | *(none)* | **KEEP** | requestUrl preference + abort-signal; project. |
| `adapter` (vault.adapter) | *(partial: `vault/iterate`, trash rules)* | **KEEP** | Not equivalent; keep. |
| `normalize-path-missing` | *(none)* | **KEEP** | Project. |
| `requestUrl-import` | *(none)* | **KEEP** | Project. |
| `secret-openai`, `secret-anthropic`, `secret-google` | *(none)* | **KEEP** | Secret scanning; security. |
| `deprecated-frontmatter-props` | *(none)* | **KEEP** | Project. |

## compliance-check.mjs — manifest / release rules

| Rule id | Official rule | Verdict | Notes |
|---|---|---|---|
| `manifest-required`, `manifest-id-kebab`, `manifest-minApp`, `manifest-id-match` | `validate-manifest` | **REPLACE** | Confirm the plugin checks each field we do before deleting. |
| `release-version-match`, `pkg-version-match`, `release-artifacts`, `release-ignored` | *(none)* | **KEEP** | Our release/vault-copy process; not generic. |

## Whole-script verdicts (other gates)

| Script | Verdict | Notes |
|---|---|---|
| `scripts/fallback-gate.mjs` | **KEEP** | No-fallback doctrine. Core to RT engineering standards. |
| `scripts/css-drift-check.mjs` / `css-drift-report.mjs` | **KEEP** | CSS budget; ESLint does not lint CSS. (stylelint is a separate future option.) |
| `scripts/scan-ert-classes.mjs` | **KEEP** | ERT class-usage audit; project. |
| `scripts/audit-spec-coverage.mjs` | **KEEP** | DesignedStyleSpec coverage; project. |
| `scripts/check-*-ert-lock.mjs` (×4) | **KEEP → consolidate** | Project namespace locks. Merge 4 near-identical copies into 1 parameterized script (separate cleanup, not a delete). |
| `scripts/check-model-*`, `validate-pricing.mjs`, `check-model-coverage.mjs` | **KEEP** | Model/pricing consistency; project. |
| `scripts/check-translations.mjs` | **KEEP** | i18n coverage. (Replace internal `eval()` fallback during lib cleanup.) |
| `scripts/check-obsidian-review-readiness.mjs` | **KEEP (partial overlap)** | `validate-manifest` + `no-unsupported-api` overlap some fields; keep release-readiness shell. |
| `scripts/check-obsidian-version.mjs` | **KEEP** | minAppVersion freshness; informational. |

## New coverage GAINED by adopting the plugin

These have no current equivalent — pure upside:

- `ui/sentence-case`, `ui/sentence-case-json`, `ui/sentence-case-locale-module`
- `settings-tab/no-manual-html-headings`, `settings-tab/no-problematic-settings-headings`
- `no-unsupported-api` (APIs below `minAppVersion`)
- `commands/*` (command id/name hygiene), `no-default-hotkeys`
- `prefer-instanceof`, `no-tfile-tfolder-cast`, `prefer-active-doc`, `no-global-this`
- `validate-license`, `regex-lookbehind` (iOS), `editor-drop-paste`

## Net result

- **REPLACE/CORE (retire after ESLint is blocking):** ~13 checks — inline styles,
  `any`, node imports, console, timers, var, platform, detach-leaves, view refs,
  markdown-render, manifest validation.
- **KEEP (project doctrine / security):** ERT prefixes + settings scope, innerHTML
  family, fallback gate, css-drift, ERT locks, model/pricing/spec/i18n, secrets,
  lifecycle-leak heuristics, release/version checks.
- **GAIN:** ~15 new Obsidian-guideline rules currently unchecked.

Deletion happens **only** after step 3 has run ESLint report-only and the
REPLACE rows are confirmed to fire on the same violations ours catch.

---

## Step 3 report-only run — actual output (2026-06-02)

First real run via `npm run lint:obsidian:report` (ESLint 9 + typescript-eslint 8
+ eslint-plugin-obsidianmd 0.3.0, flat config, scoped to `src/**/*.ts`,
non-test). **3,032 problems total.** Breakdown and where it contradicts the
assumptions above:

### Headline correction: the `recommended` preset is mostly NOT Obsidian rules

- **2,211 of 3,032 (73%)** come from `@typescript-eslint/*` **type-checked**
  rules bundled by the preset — generic TS strictness (`no-unsafe-*`,
  `no-unused-vars` 388, `no-explicit-any` 286, `no-unnecessary-type-assertion`
  339, `no-deprecated` 76, `no-floating-promises` 64, …). These are unrelated to
  Obsidian guidance.
- **749** come from actual `obsidianmd/*` rules.
- **72** from other bundled plugins (security/correctness).
- **Implication for step 4:** do NOT promote the whole preset to blocking.
  Scope promotion to `obsidianmd/*` first; treat the typescript-eslint
  type-checked suite as a separate, much larger decision (likely its own
  ratcheted baseline, not a wholesale flip).

### `obsidianmd/*` findings (749)

| Rule | Count | Mapping impact |
|---|---:|---|
| `prefer-active-doc` | 385 | **GAIN confirmed** — large, previously unchecked. |
| `no-static-styles-assignment` | 160 | **REPLACE confirmed** — inline-style rule is live and fires more than our regex. |
| `ui/sentence-case` | 127 | **GAIN confirmed.** |
| `prefer-window-timers` | 24 | **REPLACE confirmed** (timers). |
| `no-global-this` | 12 | GAIN. |
| `rule-custom-message` | 12 | meta — ignore. |
| `no-unsupported-api` | 9 | GAIN (partial overlap w/ review-readiness). |
| `prefer-instanceof` | 8 | GAIN. |
| `hardcoded-config-path` / `no-tfile-tfolder-cast` | 3 / 3 | GAIN. |
| `settings-tab/no-manual-html-headings` | 2 | GAIN. |
| `prefer-file-manager-trash-file` | 2 | GAIN. |
| `commands/no-plugin-id-in-command-id` / `object-assign` | 1 / 1 | GAIN. |

### Corrections to earlier assumptions

- **innerHTML is NOT uncovered.** The preset bundles `@microsoft/sdl/no-inner-html`
  (6) and `no-unsanitized/property` (8). The "KEEP — no official innerHTML rule"
  rows are **partially wrong**: there is bundled coverage (not an `obsidianmd/`
  rule). Keep our checks for now, but revisit during promotion.
- **REPLACE rows with 0 findings = UNCONFIRMED, not validated:** `detach-leaves`
  (0), `no-view-references-in-plugin` (0), `no-nodejs-modules` (0),
  `no-plugin-as-component` (0). Either we have no current violations or the rule
  didn't fire — we cannot claim supersession without a shared violation. Do not
  delete these custom checks on the strength of this run.
- **Manifest/license rules untested here:** the lane is scoped to `src/`, so
  `validate-manifest` / `validate-license` cannot fire on `manifest.json`. The
  `validate-manifest` REPLACE row is **out of scope for this run**; test
  separately before retiring the compliance-check manifest rules.
- **`no-explicit-any` = 286** via typescript-eslint (not obsidianmd). Our custom
  `: any` check uses a `// SAFE:` allowlist; ESLint counts all. Confirms AST
  catches far more, but promoting this to error is a large standalone effort.

### Net for step 4

Promote `obsidianmd/*` selectively (start with the high-signal REPLACE-confirmed
rules: `no-static-styles-assignment`, `prefer-window-timers`). Keep everything
marked UNCONFIRMED/out-of-scope. The typescript-eslint type-checked suite is a
separate track. No custom checks deleted in step 3.

---

## Step 4 selective promotion (2026-06-02)

Step 4 promoted only the two confirmed, high-signal replacement rules:

| Rule | Baseline | Enforcement |
|---|---:|---|
| `obsidianmd/no-static-styles-assignment` | 160 | Blocking ratchet: fails on increase. |
| `obsidianmd/prefer-window-timers` | 24 | Blocking ratchet: fails on increase. |

Implementation:

- `eslint.config.mjs` remains the **full recommended preset report-only** lane.
- `eslint.obsidian.enforced.config.mjs` contains only the selected enforced rule subset.
- `scripts/lint-obsidian-enforced.mjs` compares current selected-rule counts to
  `scripts/eslint-obsidian-enforced-baseline.json` and fails only when counts increase.
- `npm run lint:obsidian` now runs the ratcheted selected-rule gate.
- `npm run lint:obsidian:report` still runs the full preset and always exits 0.
- `run-gates.mjs` now includes both lanes: the blocking selected-rule baseline,
  then the full report-only summary.

Retirement decision:

- **No custom regex checks removed in step 4.** The selected ESLint gate is now
  real, but because it is ratcheted against existing findings, removing custom
  checks should wait until normal daily/release runs prove the ratchet is stable.
- The next safe retirement target is the duplicate inline-style/timer regex
  coverage, not project doctrine checks.
