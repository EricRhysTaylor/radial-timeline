# Scene time review follow-up audit

Scope: scene-time modal and marker styling, editor/Reading lifecycle, scene-only eligibility, and writing-session activity/recovery. Requested fixes implemented before this read-only post-change audit.

## Cleanup and behavior

- Reused Book Designer's manuscript surface, shared modal header, glass subcards, and scrollable card stack. Removed nested generic panels, the separate action setting row, and repeated contribution instructions; counting guidance is expandable. Duration inputs use readable single-unit values accepted by the canonical parser.
- Uncertain/clock markers use a literal question mark, retaining amber color and descriptive tooltips.
- Header eligibility already requires normalized Class Scene. Editor snapshots now refresh on file identity transitions as well as content/cache changes. Reading rails hide immediately on metadata refresh when the note ceases to be a scene. No When-only eligibility was introduced.
- Navigation bypasses the scroll activity throttle, and invalid/non-scene activity no longer consumes it. Window focus provides an activity signal. Automatic stale-session recovery now sets idleAuto, allowing subsequent scene activity to resume it. Explicit manual pause behavior is unchanged.

## Findings and risks

No release-blocking findings in the changed surface. Existing sessions already persisted as paused with idleAuto=false cannot safely be distinguished from an author's manual pause, so there is no heuristic migration. Resume once through the existing control when appropriate. Midnight rollover's existing pause policy is unchanged.

The local session was found in this ambiguous paused state and resumed using its existing UI control. This is distinct from proving the provenance of the old pause: the recovery code demonstrably omitted idleAuto, but the saved record alone cannot establish whether that particular pause was automatic or manual.

## Ownership, architecture, naming, and performance

No architectural refactor, new persistence schema, fallback, AI call, or manuscript mutation. Operational decisions remain in the existing sidecar. Shared style tokens remain under ert-ui. Event registrations retain plugin lifecycle cleanup. Source snapshots remain cached. No unrelated changes staged.

## Verification

All 15 gates passed, including production build, TypeScript, lint baseline, CSS checks, and 3,562 tests (2 opt-in skips). Logs: .gate-logs/2026-09-11T18-46-39-398Z. Added regressions for cached scene eligibility after class changes and automatic recovery/resume without crediting away time. Existing manual-pause tests pass.

Live Obsidian: redesigned modal inspected, compact contribution rows and readable seconds/hours observed; existing session resumed to Active revision session; a non-scene craft note showed no timing header or cue markers. No real prose or cue decisions changed. Popout/mobile combinations remain outside this visual pass.

Inspector validation: contribution row resolves row-gap to 8px and padding-top to 16px inside the shared ERT shell. The uncertain marker contains literal `?`, with computed width 10px, font-size 14px and border width 0. Final build reloaded into Obsidian after the recovery fix.
