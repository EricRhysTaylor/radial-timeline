# Friday Release Gate

- Version: 8.1.0
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (9dfbdbd5)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- fece1793 2026-11-20 docs: sync release notes for 8.1.0
- 9dfbdbd5 2026-11-20 Release version 8.1.0
- e07c034d 2026-11-20 8.1.0 notes: show the Share page's Public side
- 43cc2d23 2026-11-20 Release 8.1.0 screenshot: the Share page's Public side
- 6e36af9b 2026-11-20 8.1.0 notes: a post's book can be changed in the feed
- de2e7341 2026-11-20 8.1.0 notes: writing sessions go under their book
- dfddaedf 2026-11-20 Session posts: place each scene by its book's folder, not the active book's scene data
- 07e776bf 2026-11-20 Session posts go to the book the session was written in
- ec974edd 2026-11-20 Scene sharing is private or public: 8.1.0 notes and the wiki
- 3e2c95b0 2026-11-20 Time scale: describe it as the wiki and newsletter do
- eb7b7653 2026-11-20 Release notes draft for 8.1.0, for Eric's approval
- 05668174 2026-11-20 Release 8.1.0 screenshots: Time scale, PDF style designer, Import template

## Validation Gates
- API feature audit: Pass (145ms)
- Model coverage: Pass (86ms)
- CSS duplicates: Pass (97ms)
- Shipped assets: Pass (92ms)
- Production build: Pass (9.7s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Model Onboarding/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (414ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (578ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.7s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (17.2s)
  Obsidian lint (report-only): 48 problems total, 48 from obsidianmd rules — top: prefer-instanceof(44), prefer-active-doc(3), no-tfile-tfolder-cast(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (433ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 510 (baseline 562, delta -52)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (18.0s)
  Unused CSS: 239 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (1.1s)
  Compliance: delta -5. See the compliance log.
- Spec coverage: Pass (206ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (9.3s)
        Tests  6575 passed | 56 skipped (6631)
     Start at  19:14:14
     Duration  8.89s (transform 15.74s, setup 1.87s, import 79.74s, tests 18.68s, environment 31ms)
- i18n release readiness: Pass (447ms)
  [i18n-release] th: 6750/7222 (93.5%), 472 in English
  [i18n-release] vi: 6750/7222 (93.5%), 472 in English
  [i18n-release] Locale source, stale-key, and release bundle checks passed.

## Changed-Code Scope
- 1 changed file(s) across: src(1).
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
- Obsidian lint (report-only): 48 problems total, 48 from obsidianmd rules — top: prefer-instanceof(44), prefer-active-doc(3), no-tfile-tfolder-cast(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 239 producer-less classes remain (ratchet holds them from growing).
- Compliance: delta -5. See the compliance log.
### Ignore
- None.
