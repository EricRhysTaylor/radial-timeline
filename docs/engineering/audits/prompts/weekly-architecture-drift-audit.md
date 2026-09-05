# Prompt: Weekly Architecture Drift Audit

You are running the **Weekly Architecture Drift Audit** for the Radial
Timeline Obsidian plugin. Your job is to detect places where feature
revisions have layered patches instead of clarifying ownership — and to
recommend clarifications, not rewrites. You do **not** modify product code.

## Before you begin

Read:

- `docs/engineering/INDEX.md`
- `docs/engineering/standards/code-doctrine.md`
- `docs/engineering/standards/inquiry-critical-path-rules.md`
- `docs/engineering/standards/refactor-playbook.md`
- `docs/engineering/standards/ui-architecture.md`
- `docs/engineering/standards/fallback-policy.md`
- `docs/engineering/audits/README.md`
- The most recent Codebase Health report under
  `docs/engineering/audits/reports/`, if any — pick up its "Escalations".

Template:
`docs/engineering/audits/templates/architecture-drift-report.md`. Save the
finished report to
`docs/engineering/audits/reports/YYYY-MM-DD-architecture-drift.md`.

## Scope

Focus on architectural seams, not line-level quality:

- View / Modal / Service boundaries (Obsidian `ItemView`, `Modal`, and
  service singletons in `src/`).
- State ownership: where is canonical state stored, who reads, who writes?
- Command registration: where commands are declared, named, and bound.
- Event-bus / pub-sub usage and listener cleanup on `onunload`.
- AI runtime orchestration paths (cache → passes → citations).
- Settings tab structure and how Pro gates are evaluated.
- Export and persistence paths.

## What to look for

For each finding, cite specific files and line ranges. Distinguish
**Confirmed** from **Hypothesis**.

1. **State fragmentation** — the same piece of truth held in multiple
   places (multiple caches, parallel arrays, mirrored flags). Note the
   "source of truth" candidate.
2. **Duplicated controllers** — two classes or modules that orchestrate
   the same flow with slightly different rules (e.g. two render paths,
   two save paths, two command dispatchers).
3. **Renderer / service boundary leaks** — a view reaching into a
   service's internals, or a service depending on DOM nodes / Obsidian
   `App` instances it shouldn't know about.
4. **Modal ownership confusion** — modals that close themselves vs.
   modals closed by callers; modals that mutate parent view state directly
   instead of returning a result.
5. **Command registration drift** — commands defined in more than one
   place, commands with stale `id`s, commands missing from the palette,
   duplicate keybindings, or commands gated by ad-hoc `if` checks instead
   of the Core/Pro gating helper.
6. **Duplicated orchestration paths** — two code paths that do the same
   high-level thing (e.g. two ways to refresh the active view, two ways to
   resolve a scene's chapter, two ways to compute trust levels).
7. **Naming / terminology inconsistencies** — different names for the
   same concept (e.g. "scene" vs "card", "pass" vs "phase", "gossamer"
   vs "echo"). List the variants and recommend a canonical name. Do NOT
   propose mass rename — just flag.
8. **Layered patches** — features whose `if`/branch count has grown each
   release without a corresponding refactor. Use `git log -p --follow` on
   suspect files to confirm.
9. **Fallback creep** — silent defaults, `||`/`??` chains masking missing
   data, try/catch returning empty values. Cross-check against
   `docs/engineering/standards/fallback-policy.md`.
10. **Cleanup / unload gaps** — registered events, intervals, observers,
    or DOM nodes not torn down on view/plugin unload.

## Rules

- Cite file paths with line ranges.
- Tag each finding with one or more **architecture concerns**:
  `state | ownership | boundary | command | orchestration | terminology | fallback | cleanup`.
- Recommend the smallest clarifying change. Examples:
  - "consolidate ownership of X into module Y"
  - "remove fallback Z; let the missing case surface"
  - "rename A→B in this one file to match canonical"
- Do not propose multi-week refactors here — escalate them with severity
  and rationale to the **Monthly Refactor Board**.
- Every finding includes: **risk**, **effort**, **confidence**,
  **suggested next action**, **category**
  (`cleanup | stabilization | modernization | doctrine correction | test hardening | no action`).
- Include a **"Do Nothing / Monitor"** section for confirmed-but-not-yet-
  actionable findings, with the trigger that would escalate them.

## Product Doctrine Check

Re-evaluate suspect areas against:

- Author trust
- Non-destructive workflows
- Core vs Pro gating consistency
- Terminology consistency
- Obsidian-native behavior
- Manuscript safety
- Export safety
- AI analysis vs AI prose rewriting

A doctrine violation auto-promotes the finding to **ORANGE** or **RED**.

## Output

Fill the template. Number findings as `AD-YYYY-MM-DD-#N` so the Refactor
Board can reference them. Under 1000 lines total.

## OUTPUT FORMAT

Primary output must always be valid Markdown suitable for:
- git versioning
- long-term archival
- code review
- diffing

**HTML rendering for this cadence: DISABLED.** Weekly Architecture Drift
is reviewed against the prior week's report — diffability is the point.
Do not emit an HTML version unless this policy is changed in
`docs/engineering/audits/README.md`.
