# Friday Release Gate

- Version: 8.0.5
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (823ae701)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- 380aca22 2026-11-20 docs: sync release notes for 8.0.5
- 823ae701 2026-11-20 Release version 8.0.5
- 725fe06c 2026-11-20 Private scene release terms: version 2026-11-20
- df3a09de 2026-11-20 Shared timeline text: write the removed-embed placeholder as \uFFFC
- d49d6fd6 2026-11-20 Clear the Obsidian scan's enum comparison and createElement warnings
- e47d13f5 2026-11-20 Merge pull request #80 from EricRhysTaylor/claude/optimistic-mayer-g1s1d0
- adb504cf 2026-11-20 Docs: Time scale in the Chronologue wiki; private scenes in the README
- e2a087a6 2026-11-20 Imported template: show a known font by its proper name
- 3ac94218 2026-11-20 Imported template card: show the template file once
- 5f3d7483 2026-11-20 Add the cancelled template import fix to the 8.0.5 notes
- 5c69f772 2026-11-20 Merge pull request #79 from EricRhysTaylor/harden/2026-11-20
- 0cea850b 2026-11-20 Close the welcome screen even when saving the choice fails

## Validation Gates
- API feature audit: Pass (150ms)
- Model coverage: Pass (89ms)
- CSS duplicates: Pass (98ms)
- Shipped assets: Pass (95ms)
- Production build: Pass (9.8s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Model Onboarding/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (379ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (529ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.9s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (17.7s)
  Obsidian lint (report-only): 48 problems total, 48 from obsidianmd rules — top: prefer-instanceof(44), prefer-active-doc(3), no-tfile-tfolder-cast(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (411ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 510 (baseline 562, delta -52)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (18.0s)
  Unused CSS: 239 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (1.1s)
  Compliance: delta -5. See the compliance log.
- Spec coverage: Pass (210ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (9.1s)
        Tests  6571 passed | 56 skipped (6627)
     Start at  12:20:50
     Duration  8.77s (transform 15.79s, setup 1.83s, import 78.47s, tests 18.67s, environment 32ms)
- i18n release readiness: Pass (409ms)
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
