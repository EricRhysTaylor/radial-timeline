# Friday Release Gate

- Version: 8.3.0
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (a34592bb)
- Risk Level: Low

## Files Changed
- manifest.json
- package-lock.json
- package.json
- src/data/releaseNotesBundle.json
- src/manifest.json
- versions.json
- wiki/images/release-8-2-book-from-community-card.webp
- wiki/images/release-8-2-book-from-community-preview.webp
- Major systems touched: root(4), src(2), wiki(2)

## Recent Commits
- 841384aa 2026-11-27 docs: sync release notes for 8.3.0
- 702b31e0 2026-11-27 docs: sync release notes for 8.3.0
- 35574c59 2026-11-27 Release version 8.3.0
- a34592bb 2026-11-27 Wiki for 8.3.0: Writing Studio page, Chapter source, Timetable chapters
- 153037a9 2026-11-27 8.3.0 notes: plain wording, Panels, the turned-over panel picture
- a0132a66 2026-11-27 Writing Studio details close; Timetable Panels are panels
- cb2fb5f0 2026-11-27 Draft release notes for 8.3.0, for approval
- 7752bb01 2026-11-27 Release images for 8.3.0: Writing Studio, Timetable chapters, card reader, Renumber
- 891ed92e 2026-11-27 Renumber copy says what it does; Writing Studio first in the title bar
- 9bef022d 2026-11-27 Renumber the book on demand: Settings, export window and a command
- 506e0b50 2026-11-27 Reorder test: a decimal insert normalized beside a same-title scene
- c545c371 2026-11-27 Beat order notice: wire its link with onClickEvent

## Validation Gates
- API feature audit: Pass (215ms)
- Model coverage: Pass (123ms)
- CSS duplicates: Pass (146ms)
- Shipped assets: Pass (138ms)
- Production build: Pass (15.4s)
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Model Onboarding/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (657ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (794ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (13.4s)
    - obsidianmd/prefer-active-doc: 0 (baseline 0, delta 0)
    - obsidianmd/no-tfile-tfolder-cast: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (30.7s)
  Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: prefer-create-el(2). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (740ms)
  [css-drift] 944 warnings (baseline 1002), 0 failures · full list: .gate-logs/css-drift-report.txt
- Unused CSS ratchet: Pass (25.1s)
      1 src/styles/legacy/rt-ui-legacy.css
      1 src/styles/settings.css
  ✅ Unused CSS ratchet held (240 <= baseline 243).
- Compliance: Pass (1.6s)
  Compliance: 3 below the baseline; lock it in with npm run check-compliance -- --update-baseline.
- Spec coverage: Pass (311ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (20.4s)
        Tests  6836 passed | 2 expected fail | 56 skipped (6894)
     Start at  17:55:52
     Duration  19.80s (transform 15.49s, setup 2.36s, import 109.24s, tests 22.53s, environment 44ms)
- i18n release readiness: Pass (630ms)
  [i18n-release] th: 6678/7397 (90.3%), 719 in English
  [i18n-release] vi: 6678/7397 (90.3%), 719 in English
  [i18n-release] Locale source, stale-key, and release bundle checks passed.

## Changed-Code Scope
- 8 changed file(s) across: root(4), src(2), wiki(2).
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
- Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: prefer-create-el(2). See .gate-logs/eslint-obsidian.json.
- Compliance: 3 below the baseline; lock it in with npm run check-compliance -- --update-baseline.
### Ignore
- None.
