# Biweekly Deep Audit

- Version: 6.2.6
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (e7e62419)
- Risk Level: High

## Files Changed
- docs/releases/draft-for-release-7.0.0.md
- scripts/models/feature-audit.json
- scripts/models/latest-aliases.json
- scripts/models/model-drift-report.json
- src/view/WelcomeScreen.ts
- Major systems touched: scripts(3), docs(1), src(1)

## Recent Commits
- 8eaab8a1 2026-07-20 Welcome: Community is live (was 'coming later this year'); wire final 7.0.0 screenshots
- e7e62419 2026-07-20 [backup] 2026-07-20 11:26 — wiki(4), scripts(3), docs(2) — Daily Control Tower — 9 files — +137/-14
- 0b39f295 2026-07-20 style(view): crisp 1px opaque dashed border on Chronologue sub-nav chips
- 3a501031 2026-07-20 feat(view): restyle Chronologue sub-nav as subordinate colored tags
- 44b42c48 2026-07-20 docs(release): 7.0.0 — Locales section, redesigned nav mention + screenshot
- 63c6c68f 2026-07-20 docs(release): add redesigned mode-nav screenshot (ui-nav.webp)
- c966708c 2026-07-20 Fix sentence-case lint: 'Set up local AI' button in onboarding modal
- 880f3b72 2026-07-20 docs(release): wire 7.0.0 screenshots into draft, pinned to 2f6825e8
- 2f6825e8 2026-07-20 docs(release): 7.0.0 screenshots (webp), announce drafts; fix audit image ref
- d4f55c35 2026-07-20 feat(onboarding): resumable sessions; settings-tab fix; Set up Local AI shortcut
- 3676e4e9 2026-07-20 build: P&P demo deploy target is 'Obsidian Vault Pride & Prejudice Demo'
- 0aa80e1d 2026-07-20 build: deploy dev builds to renamed Demo Vaults (P&P, Sherlock, Faerie Queene, Odyssey)
- 9e00d122 2026-07-20 docs(release): draft 7.0.0 release notes; refresh model gate snapshots
- ecd5e3e1 2026-07-20 Fix lint gate: drop unnecessary SVGMetadataElement assertion in timeline export
- db3b5240 2026-07-20 Truthful Level 1 Private copy + shared-data naming
- ab7b6830 2026-07-20 fix(export): de-taint PNG, dedup styles, and stamp SVG provenance
- 68094aec 2026-07-20 fix(view): raise mode-nav numeral 1px (0.1em → calc(0.1em - 1px))
- 2f9f74f0 2026-07-20 Harden Community Share connect/disconnect/pause paths
- 8813b21c 2026-07-20 fix(view): optically level mode-nav numeral and widen its gap to the label
- 8efa7c00 2026-07-20 polish(onboarding): author-friendly Prepare copy, Book Manager button, faster subplot mapping

## Validation Gates
- AI model drift: Pass (34ms)
- API feature audit: Pass (63ms)
- Model coverage: Pass (25ms)
- CSS duplicates: Pass (36ms)
- Production build: Pass (4.0s)
  > node show-scripts.mjs --quiet && node scripts/check-social-ert-lock.mjs --quiet && node scripts/check-inquiry-ert-lock.mjs --quiet && node scripts/check-modal-settings-ert-lock.mjs --quiet && node scripts/check-timeline-chrome-ert-lock.mjs --quiet && npx tsc --noEmit && node code-quality-check.mjs src/main.ts src/styles/settings.css --quiet && node check-css-duplicates.mjs --quiet && node esbuild.config.mjs production && node check-css-duplicates.mjs --quiet
  Build copied to: Author/New/Fresh/Jane Austen/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Scrivener/release
  Production build complete!
- Code quality: Pass (208ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (284ms)
  - README and privacy/security disclosures are present.
  - Runtime network/platform/filesystem checks passed.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (6.9s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (16.3s)
  Obsidian lint (report-only): 342 problems total, 5 from obsidianmd rules — top: prefer-active-doc(4), commands/no-plugin-id-in-command-id(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (445ms)
    - shadow-rgba: 44 (baseline 44, delta +0)
    - rt-legacy: 1122 (baseline 1131, delta -9)
  ✅ CSS drift gate passed.
- Compliance: Pass (645ms)
    - node-core-require: 6 / 6 (+0)
    - raw-addEventListener: 78 / 78 (+0)
  ✅ Compliance maintenance gate passed (no regressions vs baseline).
- Spec coverage: Pass (110ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (3.1s)
        Tests  2801 passed | 2 skipped (2803)
     Start at  11:29:15
     Duration  2.75s (transform 9.92s, setup 1.15s, import 17.81s, tests 2.41s, environment 19ms)
- i18n release readiness: Pass (76ms)
  [i18n-release] ko: 973/1834 (53.1%)
  [i18n-release] de: 973/1834 (53.1%)
  [i18n-release] Locale source, coverage floors, and release bundle checks passed.
- Fallback debt: Fail (111ms)
  - total: 2590
    - silent-catch: 21
    - or-chain-3: 55
    - nullish-literal: 1230
    - or-literal: 1253
    - switch-default-return: 31
  Baseline: /Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline/scripts/fallback-baseline.json (key: maintenance)
  - baseline total: 2497
  - current total:  2590
  - delta: +93
  Fallback gate failed.
    - total: 2590 > baseline 2497 (delta +93)
    - or-chain-3: 55 > baseline 52 (delta +3)
    - nullish-literal: 1230 > baseline 1170 (delta +60)
    - or-literal: 1253 > baseline 1223 (delta +30)
  See docs/engineering/standards/fallback-policy.md for the policy and how to fix.
- Pricing drift: Fail (29ms)
  Pricing drift: [check-pricing-drift] age 32d / 30d (STALE)
- Obsidian version watch: Pass (203ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 5 changed file(s) across: scripts(3), docs(1), src(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- Fallback debt failed.
- Pricing drift failed.

## Notices
- Pricing drift: [check-pricing-drift] age 32d / 30d (STALE)
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Needs Attention
- Ship Readiness: Do Not Ship

## Recommended Actions
### Do Now
- Fix failing gate: Fallback debt.
- Fix failing gate: Pricing drift.
### Schedule Later
- Obsidian lint (report-only): 342 problems total, 5 from obsidianmd rules — top: prefer-active-doc(4), commands/no-plugin-id-in-command-id(1). See .gate-logs/eslint-obsidian.json.
### Ignore
- None.
