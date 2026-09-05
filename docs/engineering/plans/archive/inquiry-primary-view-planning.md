# Inquiry Primary View Planning Document (Planning Stage)

## Status: Shipped — Archived

Inquiry view shipped. Live in `src/inquiry/InquiryView.ts`. This document is preserved for the design rationale and the spec-derived non-negotiables; the executed UI may differ in detail. Do not treat as current spec.

## Overview
This document defines the planning-stage blueprint for the Inquiry Primary View in Radial Timeline. It translates the v1 Inquiry spec into UI structure, data flow, and implementation steps without changing any story files. Inquiry ships as a new view type, desktop-only for v1, and remains code-isolated from core timeline logic. Inquiry uses only book and saga scopes; scenes are focus targets within book scope, not a standalone scope.

**Inquiry enforces scope-locked evidence participation: saga outlines act only at saga scope, book outlines only at their own book scope, and lower-scope material may be consulted at higher scope solely to detect conflicts, never to compute diagnostic metrics or ring values.**

## Scope
In scope for this planning stage:
- Primary view layout, interactions, and visual bindings for Inquiry.
- State model, caching, and artifact generation flow for Inquiry sessions.
- Corpus boundary enforcement and evidence weighting integration.
- Error and empty-state handling aligned with the Inquiry output contract.
- New view type wiring (command palette + ribbon) and desktop-only gating.
- Inquiry-specific code structure and CSS separation.

Out of scope for this planning stage:
No prose rewriting, no background scanning, no auto-fix workflows, no updates to scene notes or scene YAML.

## Non-Negotiables (From Spec)
- The author writes all prose; AI never rewrites story text.
- Inquiry never modifies scene notes or scene YAML.
- Inquiry operates only on configured sources, not the full vault.
- All AI outputs are ephemeral unless saved as an Artifact.
- Canon precedence: scene, book outline, saga outline, references.
- Evidence participation is scope-locked; lower-scope material never influences higher-scope diagnostics.
- Cross-scope references are allowed only for explicit conflict detection.
- Inquiry evaluates collections (book or saga); scenes are focus only.

## Architecture and Code Boundaries
- Inquiry ships as a new view type inside the existing plugin.
- Inquiry code lives under `src/inquiry/*` with a dedicated `inquiry.css`.
- Shared utilities are limited to vault discovery, settings, billing/Pro gates, and common ERT UI tokens.
- Inquiry view logic, store, and helpers remain isolated from timeline modes.

## Platform Support
- Desktop-only for v1.
- Mobile shows a “Desktop required” message with actions:
  - Open Artifacts folder
  - View most recent Artifact (if present)
- Artifacts remain readable on mobile.

## Scope and Focus Model
- Scope options: book or saga.
- Focus target: scene (book scope) or book (saga scope).
- Center glyph always shows focus, not scope.
- Minimap always shows context (children of the current scope).
- Context badge near the minimap indicates scope:
  - Sigma badge for saga context (books in minimap).
  - Book badge for book context (scenes in minimap).

## Primary View Layout (High-Level)
The Inquiry Primary View is a focused inspector with a central glyph, dual rings, and three question zones. It replaces scrolling with navigation controls and a minimap.

```
| [Scope: Book | Saga]  [Mode: Flow | Depth]  [Artifact] |
|                                                                |
|  [Minimap strip / ticks + Context Badge]       [Findings]      |
|                                                                |
|                 Setup   Pressure   Payoff      [Panel]         |
|                     \     |     /                               |
|                    [Center Glyph + Rings]                      |
|                                                                |
| [Prev/Next or Up/Down]  [Session Status]  [Confidence]         |
```

Key elements:
- Center glyph shows focus label (S# for scene focus, B# for book focus).
- Two rings render at all times: outer ring is Flow, inner ring is Depth.
- Three inquiry zones surround the glyph: Setup, Pressure, Payoff.
- Findings panel shows result summary, verdict, and structured findings list.
- Findings panel is right-hand split on desktop and collapses into a bottom drawer on narrow widths.
- Minimap always shows context and never disappears.
- Glyph typography: Inter Black, ~40pt, tight tracking, numeric focus capped at three digits.

**The outer ring represents narrative flow (surface / river) and is thinner and wider; the inner ring represents narrative depth (subsurface / integrity) and is thicker and heavier.**

## Interaction Model
Primary interactions must be explicit, reversible, and non-destructive.

Mode and scope:
- Mode switch swaps available questions, orientation, and ring emphasis.
- Scope selector changes scope without auto-running Inquiry.
- Navigation arrows are scope-based, not mode-based.
- Minimap ticks allow drill-down and quick navigation.
- View is launched via command palette and ribbon.

Inquiry triggers:
- Hover a zone to reveal up to 10 question icons.
- Click an icon to run Inquiry or load a saved session.
- Changing mode clears active Inquiry visuals but preserves session history.
- Artifact generation captures the active session and resets state.
- Question icons use Lucide and are semantic, not decorative.

## Navigation and Zoom Rules
- Clicking the center glyph:
  - Saga scope: drill into book scope focused on the selected book.
  - Book scope: toggles focus expansion (no scope change).
- Clicking a minimap tick changes focus only; it never auto-runs Inquiry.
- Focus selection when drilling into a book:
  1. Last focused scene for that book (sticky).
  2. Highest-severity implicated scene from the last Inquiry.
  3. Scene 1 fallback.

## Inquiry Run Pipeline (UI Perspective)
The Primary View only orchestrates input, execution, and visualization.

Inputs:
- Scope, focus target, mode, selected question id, corpus fingerprint.
- Configured sources, weighting rules, and canon precedence.
- Custom question registry stored in plugin data.

Outputs:
- Strict JSON result contract with verdict and findings.
- At least one finding, even on errors or ambiguity.
- Evidence type, confidence, and severity used for UI binding.
- Each question resolves into two compressed answers (flow and depth) and implicated targets.
- The dual-answer model is documented in code comments to avoid regression.

## Hover vs Click Contract
Hover (preview only):
- Hover glyph shows contextual summary of current focus.
- Hover rings show a 2 to 3 sentence micro-verdict for flow or depth.
- Hover minimap ticks show a per-target finding summary.

Click (commit or navigate):
- Click minimap tick changes focus.
- Click center glyph drills down or expands focus.
- Click ring opens a report preview (unsaved, read-only).
- Click the Artifact icon saves the current session to disk.

## Artifact Generation Refinement
- Ring click opens a report preview rendered from the current session (unsaved).
- Artifact icon explicitly persists the session to the configured folder.
- Embedded JSON is written only when the setting is enabled.

## Evidence Participation Locking (Scope Rules)
Evidence participates only at the scope where it is authoritative. Lower-scope material never silently influences higher-scope diagnostics. Cross-scope access is permitted only to surface conflicts.

### Saga Outline (class: outline, scope: saga)
- Authoritative only at saga scope.
- Disallowed at book scope for ring computation or verdicts.
- At book scope, may be consulted only to emit conflict findings.

### Book Outline (class: outline, scope: book)
- Authoritative only at its own book scope.
- Disallowed at saga scope for ring computation or verdicts.
- At saga scope, contributes only as child aggregates; misalignment with saga outline emits conflict findings.

### Scenes (class: scene)
- Book scope: primary evidence for rings and findings across multiple scenes.
- Saga scope: default is aggregate-only via books; scene-level inputs do not directly drive saga rings.
- Optional future mode may allow sampled scene summaries for saga diagnostics.

### Characters, Places, Powers (class: character | place | power)
- Reference-only at all scopes.
- Allowed for constraint validation and context.
- Disallowed from directly influencing ring metrics or verdicts.

## Ring Computation Rules (Clarified)
Book scope rings:
- Scenes in the book are primary evidence.
- Book outline is secondary; absence lowers confidence.
- Saga outline never participates in ring computation.

Saga scope rings:
- Computed from book-level aggregate results and saga outline intent.
- Scenes only contribute via book aggregation unless explicitly enabled.

## Conflict Detection (Only Cross-Scope Exception)
- Lower-scope material may be consulted at higher scope solely to detect contradictions.
- Conflict emits a `kind=conflict` finding and references both sources.
- Conflicts never adjust ring values and are never averaged away.

## Corpus Fingerprint
- Computed as a hash of evidence file paths, modified timestamps, question id, and schema version.
- Stored in session history and Artifact frontmatter.
- Not shown in the default UI; surfaced via a Details expander in the Findings panel.
- History entries are marked stale when the fingerprint changes and never auto-rerun.

## Visual Binding Rules
UI binds to Inquiry results without altering the underlying corpus.

Rings:
- Always render with neutral baseline when no active session.
- Fill uses metric value (0 to 1), color uses severity.
- Confidence shows via subtle styling (dashed ring or small badge).
- Palette is neutral, green, amber, red; no gradients for v1.
- Inquiry overrides ring context while active session is visible.

Findings:
- Group by zone or kind for scanability.
- Show evidence type and confidence per finding.
- Conflicts are visible, visually distinct, and never silently overridden.

Status and errors:
- Soft failure renders low confidence and kind=unclear.
- Hard failure renders pulsing error state and kind=error.
- All failures still emit a valid result payload.

## State Model (Planning-Level)
The view owns display state and relies on services for execution.

Suggested state fields:
- scope (book or saga), focusSceneId, focusBookId, mode, activeQuestionId, activeSessionId.
- activeResult, activeZone, isRunning, lastError.
- sessionStatus, corpusFingerprint, settingsSnapshot, isNarrowLayout.

Session history:
- LRU, max 100 sessions.
- Keyed by question id, scope, focus target, mode, corpus fingerprint.
- Never auto-rerun; mark stale if question or corpus changes.
- Sessions live in plugin data; report previews render from sessions, not files.

## Settings and Persistence
Inquiry relies on plugin settings and plugin data only.

Settings required:
- Inquiry sources configuration, session history, max sessions.
- Artifact folder path (default `Radial Timeline/Inquiry/Artifacts/`).
- Embed JSON payload in Artifacts toggle.
- Optional source folders for character, place, power references.

Persistence rules:
- Sessions and custom questions stored in plugin data.
- Artifacts written to vault only on explicit generate/save.
- Artifact folder auto-created if missing.
- Scene notes and YAML are never modified.

## Implementation Plan (Phased)
Phase 1: Structure and state
- Add new Inquiry view type with command palette and ribbon entry points.
- Create `src/inquiry/*` scaffolding and `inquiry.css`.
- Add Inquiry Primary View container and layout scaffolding.
- Implement view state model and service interfaces.
- Wire scope, mode, and navigation controls without Inquiry execution.
- Add minimap rendering and drill-down behavior.
- Add desktop-only gating with mobile message and artifact links.
- Implement focus vs context separation and context badge.

Phase 2: Inquiry execution and rendering
- Integrate Inquiry runner and strict output parsing.
- Add zone hover and question icon interactions.
- Render summary, verdict, findings, and evidence metadata.
- Bind ring visuals to result severity and confidence.
- Add Details expander for corpus fingerprint and session metadata.
- Enforce scope-locked evidence participation and conflict-only cross-scope checks.
- Add hover previews and click interactions for glyph, rings, and minimap.
- Add in-memory Artifact view on ring click.

Phase 3: Session history, artifacts, and settings
- Implement LRU session history and staleness rules.
- Add artifact generation workflow and file output.
- Expose settings for sources, session history, artifact folder, and JSON embedding.
- Add error handling, fallback payloads, and UI states.

## Acceptance Criteria (Planning Stage)
- Inquiry launches as a new view type from command palette and ribbon.
- The Primary View can render at book and saga scope with navigation.
- Center glyph reflects focus, while minimap shows context with a scope badge.
- Desktop renders a right-hand findings panel that collapses into a drawer when narrow.
- Mobile shows a desktop-only message with artifact links.
- Inquiry can be triggered and returns a strict result payload.
- Findings and verdict visualize severity and confidence consistently.
- Artifacts can be generated without modifying any story files and are stored in the configured folder.
- Session history is predictable, capped, and visibly stale when needed.

## Implementation Anchor
Inquiry always evaluates collections (book or saga); the center glyph shows focus, the minimap shows context, and each question resolves into two diagnostic answers (flow and depth), captured visually in the rings and durably in Artifacts only by explicit user action.
