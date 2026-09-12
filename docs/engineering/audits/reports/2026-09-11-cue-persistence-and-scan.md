# Cue persistence and Obsidian scan review

## Findings

- Arbitrary paragraphs cannot currently receive a time entry. The modal operates on detected cues only.
- Live sidecar inspection found the original excluded `three days` cue stored against the old paragraph, plus a newer exclusion against the revised paragraph. Running the actual scanner/resolver on the current Scene 61 file confirms that the line-185 cue is currently excluded and unique. No sidecar or prose changes were made during this investigation.
- Decisions are durable across reloads with unchanged content, but identity includes the entire paragraph and relative phrase offset. Ordinary paragraph edits invalidate that identity. This is an unresolved UX/persistence limitation, not disk data loss. A new regression reproduces both successful reload persistence and detachment after a paragraph edit, while proving the old record is preserved.
- SceneID is not currently used. Moving to sceneID alone would not fix changed paragraph identity. Stable cue anchoring and an explicit policy for meaningful text changes require a separate design; no fuzzy exclusion transfer was introduced.

## Scan comparison and targeted fix

Compared the screenshot's paths between the pre-cue-bar commit a8160c97 and scanned commit 7d2d3ffb. Only scene-time-ruler.css changed among the reported files. Thus :has is the new warning attributable to this feature; license, local fetch, settings definitions, type assertions and other CSS compatibility notices predate it.

Removed both CSS :has usage and the related runtime selector. The ruler now sets an explicit empty-state class during its existing measurement pass. It still owns only its sole-child native gutter, and removes the added class on destruction. No geometry, labels, scene-only eligibility, or sidecar schema change.

Local report-only lint continues to be distinct from the remote Obsidian scan. Passing local gates does not mean the remote scanner has no warnings. The local rules intentionally exempt bounded localhost transport from the requestUrl mandate; licensing and broad settings/API adoption were not changed under this scoped fix.

No architectural refactor. Other existing warnings remain visible follow-up work; no claim of a warning-free remote scan is made. New remote review must run on the pushed commit to confirm its updated report.

Verification: all 15 gates passed, including production build, type checks, tests and CSS checks. Local report-only lint remains at four pre-existing warnings and zero errors. Updated plugin reloaded in Obsidian. The remote scan itself was not rerun in this session.
