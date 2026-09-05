# Daily Control Tower

- Version: 6.2.2
- Branch: master
- Upstream: origin/master
- Baseline: HEAD~1 (dbcea6ec)
- Risk Level: Low

## Files Changed
- README.md
- docs/engineering/audits/reports/2026-05-31-daily-control-tower.md
- docs/engineering/audits/reports/2026-06-01-daily-control-tower.md
- docs/engineering/audits/reports/2026-06-01-friday-release-gate.md
- docs/engineering/audits/reports/2026-06-02-biweekly-deep-audit.md
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
- docs/releases/draft-for-release-6.2.2.md
- Major systems touched: root(6), docs(5), scripts(4), src(2)

## Recent Commits
- f30c29ba 2026-06-10 docs(readme): tighten formatting for directory page rendering
- dbcea6ec 2026-06-10 feat(security): minimal subprocess env + homedir-based tool discovery
- e680c4de 2026-06-10 feat(release): build releases in CI with build-provenance attestation
- 09ef3ec5 2026-06-10 chore(build): repoint dev vault deploy paths after RT LLC folder reorg
- f0d8d28a 2026-06-10 docs(readme): disclose shell/fs/env access scope (Pandoc export only)
- 63d66d9b 2026-06-10 style: remove duplicate property declarations flagged by Obsidian scorecard
- fecad04e 2026-06-10 chore(deps): drop fs-extra, builtin-modules, lint-staged (scorecard flags)
- 656d49d4 2026-06-10 chore(repo): untrack app.css and vault-restore-point from the repo

## Validation Gates
- CSS duplicates: Pass (114ms)
- Production build: Pass (6.9s)
  > node show-scripts.mjs --quiet && node scripts/check-social-ert-lock.mjs --quiet && node scripts/check-inquiry-ert-lock.mjs --quiet && node scripts/check-modal-settings-ert-lock.mjs --quiet && node scripts/check-timeline-chrome-ert-lock.mjs --quiet && npx tsc --noEmit && node code-quality-check.mjs src/main.ts src/styles/settings.css --quiet && node check-css-duplicates.mjs --quiet && node esbuild.config.mjs production && node check-css-duplicates.mjs --quiet
  Build copied to: Author/New/Fresh/Jane Austen/Sherlock Holmes/P&P/Timelapse/release
  Production build complete!
- Code quality: Pass (382ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (478ms)
  - README and privacy/security disclosures are present.
  - Runtime network/platform/filesystem checks passed.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (9.6s)
    - obsidianmd/no-static-styles-assignment: 160 (baseline 160, delta 0)
    - obsidianmd/prefer-window-timers: 24 (baseline 24, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (23.3s)
  Obsidian lint (report-only): 3041 problems total, 752 from obsidianmd rules — top: prefer-active-doc(388), no-static-styles-assignment(160), ui/sentence-case(127). See .gate-logs/eslint-obsidian.json.
- Unit tests: Pass (5.9s)
        Tests  2511 passed | 2 skipped (2513)
     Start at  15:20:38
     Duration  5.29s (transform 8.03s, setup 0ms, import 18.93s, tests 4.17s, environment 28ms)

## Changed-Code Scope
- 17 changed file(s) across: root(6), docs(5), scripts(4), src(2).
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
