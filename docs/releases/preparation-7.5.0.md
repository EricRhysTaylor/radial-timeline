# 7.5.0 release preparation

Prepared October 12, 2026. Previous public release: 7.4.0, published October 5 (Pacific). Eric selected 7.5.0 after confirming that 7.4.0 was already public.

**Published October 12, 2026, at 6:45 PM Pacific.** Eric explicitly authorized finishing `npm run release` and answering `y` after the screenshots, notes, and wiki were complete. The completion record below supersedes the earlier preparation boundary; deferred acceptance and audit findings remain recorded here.

## Release material

- Notes: [draft-for-release-7.5.0.md](draft-for-release-7.5.0.md), reviewed against the commits after tag 7.4.0. The old 7.4.1 draft is marked superseded.
- Wiki: added Timetable with the supplied side-by-side screenshot, prerequisites, view behavior, sketch drawers, promotion, and customization. Updated Chronologue placement, subplot drag links, general publishing sources, saved selections, actual PDF proofs, onboarding review/continue behavior, commands, Home, and sidebar.
- Public wiki matched the local source before editing, including the supplied screenshot; published updates as wiki commits f8dbc2f and 93462a9, followed by the illustrated feature updates through b7b16bf. The final fetched wiki clone matches local wiki pages and images.
- Release notes include seven native feature screenshots: TimeTable, Scrivener metadata assignments, live subplot dragging, cloud and local single-file onboarding, general export sources, and a publishing proof. Images are pinned to immutable commits. Capture details and the additional document proof are recorded in [screenshots-7.5.0.md](screenshots-7.5.0.md).
- Framer review branch: [7.5.0 TimeTable (review)](https://framer.com/projects/Radial-Timeline--0SFzcMRikBn70lUmVVbe-5vkpq?node=augiA20Il&branch=xyass140b). Proposed home section with the screenshot and a shared-footer TimeTable link using the existing NEW badge. Desktop, tablet, and phone section screenshots and both footer variants were inspected; the new content fits both. The image opens at full size when clicked, and the footer links to the section’s scroll target. Leave unmerged and unpublished for Eric’s review.

## Automated validation

- Full repository gates: 14/14 passed; production build (including TypeScript and script type checks), shipped assets, Obsidian review/lint baseline, CSS checks, compliance, spec coverage, and tests.
- Final tests after the provider transport fix: 398 files passed, 4 skipped; 4,338 tests passed, 17 skipped. The 24 focused transport/cancellation tests passed, and native local Qwen basic completion and strict JSON diagnostics succeeded.
- Release i18n: all 6,248 English keys covered in German, Japanese, Korean, and Chinese; bundled locale sentinels passed.
- PDF smoke: all four bundled novel layouts compiled with packaged fonts.
- Publishing wizard visual fixtures: all 11 passed (1–6 pages each).
- Changed wiki page links and anchors resolved locally; git diff whitespace checks passed.
- Existing nonblocking gate notices: 17 report-only lint problems (one Obsidian rule); 243 producer-less CSS classes within the existing ratchet.

## Deep Audit finding — unresolved at publication

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

The preparation recommended a final hands-on sweep on the release candidate: dated and undated Chronologue drags with both follower choices; subplot move/add/Undo preserving other memberships; Timetable book/saga following and reload; drawer conflict and promotion; Scrivener Continue anyway/recheck; folder and file exports with saved order; final Word/PDF/Markdown and split delivery files. That entire sweep was not repeated before publication. Screenshot capture did verify the live subplot drag state, onboarding preparation, native local-provider diagnostics, a general folder source, and an actual 141-page Professional PDF proof. The post-feature audit playbook also requires whole-surface review and native CSS-variable checks before claiming complete release acceptance. Green gates are the automated baseline, not that acceptance.

## Publication completion

- Ran the repository's two-phase `npm run release` workflow and answered `y` to finish the prepared 7.5.0 draft. The script completed successfully. Package and shipped manifests are 7.5.0.
- The script synchronized the final illustrated notes into the bundled release notes and tagged commit `8b60ce20ee5777ff94dbe6d73be8ec391dfb6d79`.
- [Release Build run 38333582899](https://github.com/EricRhysTaylor/radial-timeline/actions/runs/38333582899) succeeded, built the tag, verified embedded assets, and attested/uploaded all three assets. No local build was uploaded.
- [7.5.0](https://github.com/EricRhysTaylor/radial-timeline/releases/tag/7.5.0) is public, final, and latest, with seven illustrations. All three public asset URLs returned HTTP 200. The downloaded manifest reports 7.5.0, minimum Obsidian 1.13.0, desktop only. `gh attestation verify` independently verified the downloaded `main.js`, `manifest.json`, and `styles.css`.
- The authenticated Obsidian owner dashboard has an official **7.5.0 / 8b60ce2 / Pending** entry. It reports incomplete checks and verified main.js/styles.css attestations. The earlier main preview for 9e6b726 is Completed; it predates the transport fix and is not approval of the released commit. The directory's Current release still shows 7.4.0 while the new review is pending.
- Preliminary scanner warnings include the unrecognized proprietary license, main.js exceeding 5 MB, filesystem/shell capabilities, partial CSS support, and the `fast-uri` advisory [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx). The lockfile contains fast-uri 3.1.2 through Ajv; patched 3.x is 3.1.4. The documented exploit requires using fast-uri for host policy before another parser sends a request. The inspected RT import uses Ajv for response JSON-schema validation in `src/ai/runtime/jsonValidator.ts`; no direct fast-uri host-policy use was found in RT source. This contextual inspection does not remove the dependency warning or certify the scan complete.

Framer remains an unmerged, unpublished review branch. Publication of that branch is a separate review decision.
