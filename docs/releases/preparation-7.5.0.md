# 7.5.0 release preparation

Prepared October 12, 2026. Previous public release: 7.4.0, published October 5 (Pacific). Eric selected 7.5.0 after confirming that 7.4.0 was already public.

## Release material

- Notes: [draft-for-release-7.5.0.md](draft-for-release-7.5.0.md), reviewed against the commits after tag 7.4.0. The old 7.4.1 draft is marked superseded.
- Wiki: added Timetable with the supplied side-by-side screenshot, prerequisites, view behavior, sketch drawers, promotion, and customization. Updated Chronologue placement, subplot drag links, general publishing sources, saved selections, actual PDF proofs, onboarding review/continue behavior, commands, Home, and sidebar.
- Public wiki matched the local source before editing, including the supplied screenshot; published updates as wiki commits f8dbc2f and 93462a9. The final fetched wiki clone matches local wiki pages and images.
- Framer review branch: [7.5.0 TimeTable (review)](https://framer.com/projects/Radial-Timeline--0SFzcMRikBn70lUmVVbe-5vkpq?node=augiA20Il&branch=xyass140b). Proposed home section with the screenshot and a shared-footer TimeTable link using the existing NEW badge. Desktop, tablet, and phone section screenshots and both footer variants were inspected; the new content fits both. The image opens at full size when clicked, and the footer links to the section’s scroll target. Leave unmerged and unpublished for Eric’s review.

## Automated validation

- Full repository gates: 14/14 passed; production build (including TypeScript and script type checks), shipped assets, Obsidian review/lint baseline, CSS checks, compliance, spec coverage, and tests.
- Tests: 397 files passed, 4 skipped; 4,336 tests passed, 17 skipped.
- Release i18n: all 6,248 English keys covered in German, Japanese, Korean, and Chinese; bundled locale sentinels passed.
- PDF smoke: all four bundled novel layouts compiled with packaged fonts.
- Publishing wizard visual fixtures: all 11 passed (1–6 pages each).
- Changed wiki page links and anchors resolved locally; git diff whitespace checks passed.
- Existing nonblocking gate notices: 17 report-only lint problems (one Obsidian rule); 243 producer-less CSS classes within the existing ratchet.

## Deep Audit finding — resolve before public release

The standard release preflight passed, but the due Deep Audit passed 17 of 18 checks and reported **Do Not Ship** because the fallback-debt gate failed. Its `or-chain-3` heuristic counts every line with at least three `||` operators, including boolean validation and UI guards: 73 current hits versus a maintenance baseline of 52. The same scan of public tag 7.4.0 found 61, so part of the mismatch predates this release. Total fallback-pattern hits decreased from the baseline’s 2,497 to 2,287; the per-rule threshold still fails.

Inspection of the added hits identified boolean source/delivery validation, export/proof availability checks, a Timetable resize guard, and Chronologue overlay/drag exclusions. These hits do not demonstrate silent value fallback behavior. This preparation does not waive the failing gate, raise its baseline, or rewrite functioning feature code. A narrow follow-up should distinguish boolean guards from value fallback chains and rerun the Deep Audit; the repo’s post-feature audit playbook requires approval before cleanup edits.

See [the saved Deep Audit](../engineering/audits/reports/2026-10-12-biweekly-deep-audit.md). Positive count changes against 7.4.0 are:

| File | Additional heuristic hits | Inspected role |
|---|---:|---|
| `src/publishing/exportDelivery.ts` | 7 | Destination, document and receipt validation |
| `src/publishing/savedManuscripts.ts` | 4 | Saved-source schema validation |
| `src/modals/ManuscriptOptionsModal.ts` | 9 | Export/proof/source availability guards and layout classification |
| `src/view/modes/ChronologueMode.ts` | 1 | Disable date-drag behavior in overlays or subplot dragging |
| `src/timetable/TimetableView.ts` | 1 | Require all column-resize elements |

Other files lost hits; the overall change from 7.4.0 is +12. No cleanup refactor, baseline reset, dead-code removal, or feature behavior change was performed in this preparation.

## Native evidence and remaining acceptance

The Timetable implementation plan records October 12 visual QA in a Sherlock demo copy: status fills, beats, act groups, Rings, new sketch, drawer save/conflict behavior, property edits, promotion, Act board, cross-highlighting, and book following. This preparation reviewed that recorded evidence and the screenshot; it did not repeat the full native interaction suite.

The plan explicitly leaves embedded Timetable acceptance untested. It also distinguishes planned work from delivered work: inline property editing is in Obsidian’s Table view; multi-row promotion shared with the wheel and a Book Manager Create book base button are not implemented and are not advertised here.

Before public release, complete the final hands-on sweep on the release candidate: dated and undated Chronologue drags with both follower choices; subplot move/add/Undo preserving other memberships; Timetable book/saga following and reload; drawer conflict and promotion; Scrivener Continue anyway/recheck; folder and file exports with saved order; final Word/PDF/Markdown and split delivery files. The post-feature audit playbook also requires whole-surface review and native CSS-variable checks before claiming complete release acceptance. Green gates are the automated baseline, not that acceptance.

## Publication boundary

Preparation does not publish 7.5.0. Package and manifests deliberately remain 7.4.0, and the existing public tag/assets are unchanged, so Obsidian’s installer continues to resolve the available release. Do not bump main’s manifest and leave a text-only GitHub draft stranded.

When Eric chooses to cut the release, use the repository’s `npm run release` two-phase workflow with 7.5.0 and these notes, finish the draft promptly, and let GitHub Actions build/attest/upload the three release assets. Never upload a local build. Inspect the final public download links and directory scan separately. Framer merge and publication remain a separate review decision.
