# Scene time ruler: feature audit

## Scope and result

Reviewed the complete `src/sceneTime` surface, scene header integration, plugin registration, CSS bundle entry, and direct CodeMirror state dependency. Unrelated pre-existing working-tree changes are excluded. No blocking findings remain in the reviewed feature. No post-audit refactors or speculative additions are proposed.

## Behavior and author control

- Common English time cues are detected locally at every supported occurrence. Prose positions determine tick placement; the rail is not a uniformly scaled timeline.
- Explicit advances and cumulative checkpoints remain candidates until confirmed. Plans, backward references, clock anchors, and approximate language never automatically increase elapsed time.
- Advances add; checkpoints set cumulative elapsed. A backward checkpoint is flagged without silently subtracting time. Excluded cues remain visible. Confirmed totals above declared Duration produce a review warning.
- Exact paragraph context, relative position, and quote identify a saved decision. Changed paragraphs require fresh review; duplicated identical paragraphs cannot share one confirmation. Saving rechecks current note content, including open editor content.
- Versioned decisions are stored locally in `Radial Timeline/Scene Time/decisions.json`. Writes are serialized and become visible only after successful persistence. Corrupt/unsupported data blocks writes and surfaces a Notice. No scene frontmatter or manuscript prose is written by the feature.

## Architecture, cleanup, and naming

One pure scanner/resolver supplies the header, review modal, editor gutter, and Reading renderer. Existing manuscript-placement heuristics are not used as elapsed-time measurements. Editor positions use CodeMirror measurement scheduling; Reading positions use rendered text ranges and ResizeObserver. Components release subscriptions, observers, timers, and owned markup. The transient source cache is bounded; saved author decisions are not capped or silently pruned.

All new UI classes use `ert-`. The modal uses the existing ERT shell. The ruler scopes native gutter styling to its owned container and uses global Obsidian color/spacing tokens. A direct `@codemirror/state` development dependency matches Obsidian's peer version; the lockfile removes a redundant nested state version, eliminating the initial type bridge. No unrelated dead code or naming migrations were included.

## Live verification

Used a temporary QA scene in the author vault, then removed that note and only its saved decisions. Returned to Scene 61 and reloaded the plugin after cleanup.

- Declared duration: 30 hours. Confirmed a two-hour advance and a six-hour sleep. Header and modal showed eight confirmed hours and 22 hours not quantified by confirmed cues.
- Confirmed an eight-hour checkpoint: total remained eight hours, demonstrating no double counting.
- Reloaded the plugin: decisions and totals persisted.
- Verified green confirmed ticks, amber uncertain/clock ticks, and a distinct purple backward marker in Reading mode. Verified equivalent editor markers and the rail extending only from first to last prose, below properties and above backlinks.
- Verified marker descriptions expose quotes, interpretation, and cumulative confirmed time. Header opens the same review controls through an accessible button.
- Inspector confirmed a 3px dotted rail, resolved theme border color, and 8px gutter margin. Native gutter border removal keeps unrelated note panes clean.
- Restored Scene 61 in editing mode with its detected cues awaiting author review; no manuscript cues were confirmed as part of QA.

## Remaining limits and follow-up

Detection is a bounded English phrase scan, not semantic proof of elapsed time. Authors must resolve dialogue, plans, nested flashbacks, parallel action, and ambiguous clock relationships. Unsupported phrasing can be missed. Partial dates do not acquire invented clock times. Remaining duration is described as not quantified, not missing.

Separate popout windows, mobile, third-party themes, and another plugin's competing right-hand gutter were not visually certified. The implementation uses native CodeMirror gutter and measurement APIs plus Obsidian's section metadata; theme/layout compatibility remains a follow-up check. No AI calls or automatic prose repairs are part of this feature.

## Build safety

Targeted scanner/accounting/persistence tests cover repeated cues, ignored metadata/comments/code, fractional durations, cumulative checkpoints, exclusions, changed and duplicated anchors, concurrent writes, corrupt sidecars, failed writes, and stale modal saves. All 15 gates passed, including the production build and TypeScript checks. The full suite passed 3,560 tests in 327 files; two opt-in tests were skipped. Report-only lint remains at the four pre-existing warnings in unrelated files. Feature behavior remains intact after cleanup.
