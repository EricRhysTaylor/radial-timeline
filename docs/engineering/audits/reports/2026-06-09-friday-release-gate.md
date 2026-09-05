# Friday Release Gate

- Version: 6.2.0
- Branch: master
- Upstream: origin/master
- Baseline: HEAD~1 (5d8dd391)
- Risk Level: Low

## Files Changed
- src/inquiry/InquiryView.ts
- scripts/models/feature-audit.json
- scripts/models/latest-aliases.json
- scripts/models/model-drift-report.json
- Major systems touched: scripts(3), src(1)

## Recent Commits
- 704aa112 2026-06-09 feat(inquiry): engine button opens the popover instead of jumping to Settings
- 5d8dd391 2026-06-09 [backup] 2026-06-09 07:48 — scripts(3), src(2) — --quiet automatic backup after build — 5 files — +56/-47
- 569622bb 2026-06-08 feat(inquiry): no-API-key read-only Demo Mode (never red)
- 54c6abb6 2026-06-08 feat(inquiry): seed Inquiry sources when activating a sample vault
- 75857217 2026-06-08 fix(inquiry): reword test comment to clear compliance adapter false-positive
- 853ff563 2026-06-08 fix(inquiry): hydrate session store from sidecar before arming writes
- 3cfe811b 2026-06-08 [backup] 2026-06-08 18:42 — scripts(3), src(2) — --quiet automatic backup after build — 5 files — +168/-16
- ff60bd59 2026-06-08 [backup] 2026-06-08 16:46 — src(14), scripts(3), root(1) — --quiet automatic backup after build — 18 files — +515/-417
- 851a36c3 2026-06-08 Use --shadow-l token for Welcome card hover (fix CSS drift gate)
- c4f4e61d 2026-06-08 Redesign Welcome screen as 3 hero cards with state-aware Sample Vault
- 75c2db7b 2026-06-08 [backup] 2026-06-08 14:41 — scripts(4), docs(2), src(2) — --quiet automatic backup after build — 9 files — +88/-20
- 50b2d96b 2026-06-08 Keep Inquiry AI engine button clickable during corpus setup

## Validation Gates
- AI model drift: Pass (103ms)
- API feature audit: Pass (298ms)
- Pricing registry: Pass (104ms)
  [validate-pricing] OK (16 entries)
- Model coverage: Pass (87ms)
- CSS duplicates: Pass (111ms)
- Production build: Pass (6.8s)
  > node show-scripts.mjs --quiet && node scripts/check-social-ert-lock.mjs --quiet && node scripts/check-inquiry-ert-lock.mjs --quiet && node scripts/check-modal-settings-ert-lock.mjs --quiet && node scripts/check-timeline-chrome-ert-lock.mjs --quiet && npx tsc --noEmit && node code-quality-check.mjs src/main.ts src/styles/settings.css --quiet && node check-css-duplicates.mjs --quiet && node esbuild.config.mjs production && node check-css-duplicates.mjs --quiet
  Build copied to: Author/New/Fresh/Jane Austen/Sherlock Holmes/P&P/Timelapse/release
  Production build complete!
- Code quality: Pass (335ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (478ms)
  - README and privacy/security disclosures are present.
  - Runtime network/platform/filesystem checks passed.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (10.5s)
    - obsidianmd/no-static-styles-assignment: 160 (baseline 160, delta 0)
    - obsidianmd/prefer-window-timers: 24 (baseline 24, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (22.1s)
  Obsidian lint (report-only): 3038 problems total, 751 from obsidianmd rules — top: prefer-active-doc(387), no-static-styles-assignment(160), ui/sentence-case(127). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (2.9s)
    - shadow-rgba: 44 (baseline 44, delta +0)
    - rt-legacy: 1428 (baseline 1430, delta -2)
  ✅ CSS drift gate passed.
- Compliance: Pass (3.1s)
    - node-core-require: 7 / 7 (+0)
    - raw-addEventListener: 78 / 78 (+0)
  ✅ Compliance maintenance gate passed (no regressions vs baseline).
- Spec coverage: Pass (245ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (7.3s)
        Tests  2501 passed | 2 skipped (2503)
     Start at  08:05:55
     Duration  6.83s (transform 9.06s, setup 0ms, import 23.91s, tests 5.14s, environment 42ms)

## Changed-Code Scope
- 4 changed file(s) across: scripts(3), src(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- None.

## Notices
- None.

- Overall Repository Health: Excellent
- Ship Readiness: Ship

## Recommended Actions
### Do Now
- None.
### Schedule Later
- Obsidian lint (report-only): 3038 problems total, 751 from obsidianmd rules — top: prefer-active-doc(387), no-static-styles-assignment(160), ui/sentence-case(127). See .gate-logs/eslint-obsidian.json.
### Ignore
- None.
