# Biweekly Deep Audit

- Version: 6.2.2
- Branch: master
- Upstream: origin/master
- Baseline: HEAD~1 (dbcea6ec)
- Risk Level: Low

## Files Changed
- README.md
- docs/engineering/INDEX.md
- docs/engineering/audits/reports/2026-05-31-daily-control-tower.md
- docs/engineering/audits/reports/2026-06-01-daily-control-tower.md
- docs/engineering/audits/reports/2026-06-01-friday-release-gate.md
- docs/engineering/audits/reports/2026-06-02-biweekly-deep-audit.md
- docs/engineering/audits/reports/2026-06-10-daily-control-tower.md
- docs/privacy-and-security.md
- manifest.json
- package-lock.json
- package.json
- scripts/models/feature-audit.json
- scripts/models/latest-aliases.json
- scripts/models/latest-models.json
- scripts/models/model-drift-report.json
- src/data/releaseNotesBundle.json
- src/manifest.json
- versions.json
- AGENTS.md
- docs/engineering/standards/release-process.md
- docs/releases/draft-for-release-6.2.2.md
- Major systems touched: docs(9), root(6), scripts(4), src(2)

## Recent Commits
- f30c29ba 2026-06-10 docs(readme): tighten formatting for directory page rendering
- dbcea6ec 2026-06-10 feat(security): minimal subprocess env + homedir-based tool discovery
- e680c4de 2026-06-10 feat(release): build releases in CI with build-provenance attestation
- 09ef3ec5 2026-06-10 chore(build): repoint dev vault deploy paths after RT LLC folder reorg
- f0d8d28a 2026-06-10 docs(readme): disclose shell/fs/env access scope (Pandoc export only)
- 63d66d9b 2026-06-10 style: remove duplicate property declarations flagged by Obsidian scorecard
- fecad04e 2026-06-10 chore(deps): drop fs-extra, builtin-modules, lint-staged (scorecard flags)
- 656d49d4 2026-06-10 chore(repo): untrack app.css and vault-restore-point from the repo
- eb3b8ce6 2026-06-10 fix(release): full prod minification + description no longer starts with plugin name
- 506ec712 2026-06-10 [backup] 2026-06-10 09:52 — scripts(3), docs(2) — --quiet automatic backup after build — 5 files — +98/-45
- e89ca4e2 2026-06-10 docs: sync release notes for 6.2.1
- db98e963 2026-06-10 Release version 6.2.1
- 1f1dc728 2026-06-09 fix(inquiry): demo zones are clickable and the dial reads grey
- 3a68bd76 2026-06-09 refactor(inquiry): rename readiness is-demo → is-readonly (keyless read-only)
- 455a02e4 2026-06-09 [backup] 2026-06-09 19:34 — scripts(4), src(3), docs(1) — --quiet Bug - Vault Demo bugs involving rehydration and no api key. — 10 files — +55/-16
- 243fd107 2026-06-09 fix(inquiry): demo zones are clickable + desaturated, not run-locked faint
- 28fc6ce4 2026-06-09 fix(inquiry): readiness strip calm for ANY no-key; pin the no-key invariant
- b872b2d5 2026-06-09 fix(inquiry): keyless briefings read as available results, not foreign-model priors
- 48c7227d 2026-06-09 fix(inquiry): keyless demo vault reads as calm, not a red error
- d82e0cd3 2026-06-09 fix(inquiry): a displayed briefing renders as results, even without a key

## Validation Gates
- AI model drift: Pass (104ms)
- API feature audit: Pass (144ms)
- Pricing registry: Pass (114ms)
  [validate-pricing] OK (16 entries)
- Model coverage: Pass (87ms)
- CSS duplicates: Pass (101ms)
- Production build: Pass (6.5s)
  > node show-scripts.mjs --quiet && node scripts/check-social-ert-lock.mjs --quiet && node scripts/check-inquiry-ert-lock.mjs --quiet && node scripts/check-modal-settings-ert-lock.mjs --quiet && node scripts/check-timeline-chrome-ert-lock.mjs --quiet && npx tsc --noEmit && node code-quality-check.mjs src/main.ts src/styles/settings.css --quiet && node check-css-duplicates.mjs --quiet && node esbuild.config.mjs production && node check-css-duplicates.mjs --quiet
  Build copied to: Author/New/Fresh/Jane Austen/Sherlock Holmes/P&P/Timelapse/release
  Production build complete!
- Code quality: Pass (356ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (492ms)
  - README and privacy/security disclosures are present.
  - Runtime network/platform/filesystem checks passed.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (9.4s)
    - obsidianmd/no-static-styles-assignment: 160 (baseline 160, delta 0)
    - obsidianmd/prefer-window-timers: 24 (baseline 24, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (22.8s)
  Obsidian lint (report-only): 3041 problems total, 752 from obsidianmd rules — top: prefer-active-doc(388), no-static-styles-assignment(160), ui/sentence-case(127). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (2.1s)
    - shadow-rgba: 44 (baseline 44, delta +0)
    - rt-legacy: 1428 (baseline 1430, delta -2)
  ✅ CSS drift gate passed.
- Compliance: Pass (1.1s)
    - node-core-require: 7 / 7 (+0)
    - raw-addEventListener: 78 / 78 (+0)
  ✅ Compliance maintenance gate passed (no regressions vs baseline).
- Spec coverage: Pass (246ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (6.8s)
        Tests  2511 passed | 2 skipped (2513)
     Start at  15:21:34
     Duration  6.19s (transform 8.26s, setup 0ms, import 21.34s, tests 4.32s, environment 42ms)

## Changed-Code Scope
- 21 changed file(s) across: docs(9), root(6), scripts(4), src(2).
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
- Obsidian lint (report-only): 3041 problems total, 752 from obsidianmd rules — top: prefer-active-doc(388), no-static-styles-assignment(160), ui/sentence-case(127). See .gate-logs/eslint-obsidian.json.
### Ignore
- None.
