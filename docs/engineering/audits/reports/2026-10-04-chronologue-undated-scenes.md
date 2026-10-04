# Chronologue undated-scene stabilization audit

Date: 2026-10-04

## Outcome and scope

The approved chronology change is ready for local acceptance. No blocking findings remain in the changed surface: canonical chronology ordering, subplot and outer-ring rendering, synopsis hover explanations, Timeline Date Scaffold and Timeline Date Audit, accepted date precision, localization, and the corresponding wiki pages.

Undated scenes follow their own book's preceding dated scene in narrative order. Leading undated scenes precede the first narrative anchor; completely undated books retain narrative order. These are display relationships only. No derived calendar date is persisted or used for elapsed-time arithmetic.

## Cleanup and ownership

- The shared chronology placement map owns anchor relationships. Subplot rendering receives the full manuscript context, and the outer-ring sequence uses the same relationships.
- Removed redundant per-ring sorting, obsolete neighbor-date suggestion helpers, an unused audit date formatter, and unused imports. No compatibility fallback or new service layer was introduced.
- Blank dates now have the `undated` audit status and calm presentation. Invalid values and actual contradictions retain warning behavior. Date Scaffold remains an optional, explicitly applied operation.
- Accepted audit suggestions carry date-only precision to the existing frontmatter writer. This precision is transient application state, not an additional author YAML field. Existing clock times remain preserved when appropriate.
- Audit prompts and evidence use authored date text, so parser defaults are not presented as an authored noon. Relative-time checks do not skip intervening undated scenes.

## Risks, persistence, and deferred concerns

No release-blocking, high, or medium findings remain from this bounded pass. Existing settings and storage formats are unchanged. Sorting does not mutate scenes or their frontmatter. Book anchors remain isolated in Saga scope; subplot filtering cannot select a different anchor.

An undated return from a flashback necessarily stays with its preceding narrative anchor. An author can supply a date where that provisional placement is misleading. This limitation is documented rather than handled with guessed timestamps.

No new UI containers, portal chrome, or CSS custom properties were introduced. The existing status badge gains the muted undated presentation. Native Obsidian visual acceptance still requires a plugin reload and an inspection of the timeline and both modals; automated checks do not establish that visual result.

## Verification

- TypeScript check passed.
- 140 targeted tests across 15 files passed, covering book isolation, shared subplot context, leading and all-undated scenes, dated beats, hover explanations, audit adjacency, invalid versus unset dates, authored-time precision, and explicit date-only writes.
- All 15 repository gates passed. The existing three lint notices and 242 producer-less CSS class baseline remain unchanged.
- Final `npm run build-only` passed and installed the build in the configured local vaults. The Sherlock demo's installed bundle matches `release/main.js` by SHA-256.
- `git diff --check` passed.

The intended behavior is preserved: dated scenes retain chronological sorting, red number indicators remain for undated Working/Complete scenes, and author dates change only through accepted and applied tool suggestions. The next acceptance step is local visual inspection after reloading the plugin. No public plugin release is part of this change.
