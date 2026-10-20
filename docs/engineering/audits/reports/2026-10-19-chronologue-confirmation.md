# Chronologue confirmation and saved-result acceptance — 2026-10-19

## Fixed

Chronologue drag retained its gesture state while the placement dialog was open. Its window-level pointer listeners consequently treated clicks inside the dialog as another drop: a custom-date input or Cancel could open a second placement dialog. Pointer movement could also discard the pending drop target.

The controller now ignores pointer movement and releases while placement is pending. The existing dialog owns confirmation, cancellation, writing and dismissal; normal drag behavior resumes after that transaction completes. No placement rules or interface layout changed.

Three controller regressions failed before the fix: repeated releases during cancel and apply, and pointer movement into the dialog. They now pass. The focused controller/placement suite passed 81 tests. All 14 repository gates passed: 427 test files, 4,774 tests; the existing 35 opt-in skips remain. Existing settings-search and DOM-creation lint notices remain deferred.

## Native acceptance

Used a fresh Odyssey test copy with the candidate assets, no configured AI key/provider, and Community disabled. Original demo vaults were not edited.

- Dragged scene 28 before scene 31. The dialog correctly bounded the choice by scenes 30 and 31 and displayed their overlap warnings.
- Invalid date text and a date outside the interval disabled Place and displayed the appropriate explanation. Input and radio changes left exactly one dialog.
- Cancel left the manuscript date unchanged. A subsequent drag opened normally.
- Applying the midpoint saved `1184-07-03 18:00`. Comparing the actual file against its baseline showed exactly one changed line: `When`. Names, order and prose were preserved.
- A subsequent scene-29 placement was cancelled with one click; a settled native read confirmed zero remaining placement dialogs.
- The test scene's original bytes were restored after evidence capture.

## Other saved-result checks

- Gossamer: saved trace, two-reading comparison, Momentum/Tension switching, score-point navigation to its matching beat, visible score-manager footer, cancel without writes, and one manual score with previous readings preserved. Missing-score zero indicators are explicitly intentional in the renderer and were not changed.
- Pulse: stored current/neighbor analysis and grade colors rendered on the populated Odyssey timeline. Hover-only transitions are only partially covered by native automation; this is not an exhaustive hover acceptance claim.
- Inquiry: saved result summary, Flow/Depth scores and cited-scene map opened; saved briefing opened; citation navigation reached the scene-89 card after smooth scrolling settled. Actual Save PDF output was 16 Letter pages. All pages were rendered and visually inspected, including references and source excerpts; no clipping, overlap or missing visible glyphs was found. Some styled link text is drawn in a way that plain PDF text extraction omits, so extraction alone is not the acceptance check.
- Writing session: Begin, Pause, Resume and Cancel returned the panel to Ready. The disposable session was not saved as writing history.
- Chronologue comparison: scenes 1/2 showed 10 hours, matching their stored times; the first/last chronological pair displayed 8 years + 5 months across the multi-year boundary.

Evidence is under `Command Center/Agent Runs/2026-10-19 remaining RT results`, including red/green tests, full gates, native screenshots/AX, PDF renders, saved-note evidence and baseline integrity checks. Neither a public release nor live provider requests were performed.

## Remaining acceptance work

Other subplot/narrative drag variants, Shift/invalid drops, provider cancellation/failure states, Community workflows, broader onboarding/settings and Editorialist query/planning/storage/import recovery remain in the queue. Book Details Escape and Book Pages HTML dragging await owner replay because their automation observations were ambiguous. Native language checks remain last, per owner instruction.
