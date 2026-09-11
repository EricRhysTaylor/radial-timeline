# Optional scene-time check audit

Scope: compact cue headings, larger backward icons, optional-workflow wording, and batch confirmation.

The modal now explicitly describes its scope: confirmations affect only the scene ruler and elapsed total. Source references confirm that Timeline Audit, Timeline Scaffold, and WritingSessionService do not consume these decisions. Unconfirmed cues are not presented as required work. Unquantified-duration reporting appears only after the author has chosen to confirm contributions.

Confirm all operates only on unique, unconfirmed, quantified advances and checkpoints shown in the current snapshot. Vague cues, clock anchors, uncertain spans and backward references are left untouched. It re-reads current source, rejects stale keys and concurrent existing decisions, and saves a single atomic sidecar update. Regression tests cover checkpoint double-count prevention and stale-batch rejection without partial writes. The existing per-cue control allows corrections and clearing confirmations.

Reused Obsidian's undo-2 icon at 18px in the ruler and 20px in the legend. Cue quote, line and status share a wrapping flex heading. No architectural refactor, schema change, new dependency, AI request, manuscript edit or external integration. All new modal tokens remain scoped under ert-ui; the ruler uses explicit icon dimensions.

Live Obsidian inspection confirmed the optional badge and explanation, top Confirm all control with eligible count, compact headings and larger legend arrow. No real manuscript cue decisions were confirmed during inspection. Post-change review found no blocking issues. Batch confirmation remains an author assertion, not semantic proof of elapsed time.

Verification: all 15 gates passed, including production build/TypeScript, CSS checks, lint baseline and the full unit suite. Two additional batch-confirmation regressions passed. Existing report-only notices remain unchanged. Final build loaded into Obsidian.
