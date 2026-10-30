# Radial Timeline Engineering Index

This directory contains the core engineering doctrine and architecture
guidance for the Radial Timeline codebase.

These documents define how the system must evolve and how refactors
must be performed.

All AI agents performing refactors must read the doctrine documents
listed below before modifying runtime code.

For UI work:

1. Read `docs/engineering/standards/ui-architecture.md` first.
2. Then use `code-standards.md`, `css-guidelines.md`, and `modal-styling.md` as supporting standards and migration context.

---

## Core Doctrine

Location: `docs/engineering/standards/`

- **[ui-architecture.md](standards/ui-architecture.md)**
  Primary source of truth for settings UI, modal UI, and the live ERT architecture. Read this first before touching shared UI shell work.

- **[code-doctrine.md](standards/code-doctrine.md)**
  Core engineering philosophy for the RT codebase.

- **[inquiry-critical-path-rules.md](standards/inquiry-critical-path-rules.md)**
  Rules governing Inquiry, Gossamer, AI Strategy, and AI execution paths.

- **[model-promotion.md](standards/model-promotion.md)**
  Policy for *when* a new AI model is allowed to enter the catalog: replacement over accretion, deliberate quarterly promotions, no reflex additions. Read this before considering any model addition.

- **[ai-model-curation.md](standards/ai-model-curation.md)**
  Required *how* for adding or promoting API models once promotion is approved: request profiles, pricing, registry entry, contract-test verification.

- **[refactor-playbook.md](standards/refactor-playbook.md)**
  Step-by-step rules for performing structural refactors safely.

- **[feature-audit-playbook.md](standards/feature-audit-playbook.md)**
  Mandatory post-feature audit, cleanup, and harden pass for every new
  feature or significant addition before it is release-ready. Invoke via the
  `/feature-audit` slash command.

- **[release-process.md](standards/release-process.md)**
  Authoritative release flow: two-phase `npm run release`, CI-built assets
  with build-provenance attestation, dry-run testing, and failure modes.
  Release assets are never built or uploaded locally.

- **[writing-session-privacy.md](standards/writing-session-privacy.md)**
  Authoritative contract for projecting writing-session data to the private,
  community, and Desk Lamps audiences. Read before touching any code that
  reads, renders, or transmits `WritingSessionRecord` or the active session.
  Enforced by the tracer tests in `src/services/WritingSessionLog.privacy.test.ts`,
  `src/communityShare/communitySharePreview.test.ts` and
  `src/communityShare/deskLamps.privacy.test.ts`.

- **[fallback-policy.md](standards/fallback-policy.md)**
  Authoritative no-fallback policy. Hard-fail at boundaries, surface real errors, never silently substitute. Enforced by `scripts/fallback-gate.mjs` and wired into `npm run gates`.

- **[code-standards.md](standards/code-standards.md)**
  Supporting coding standards. Use after `ui-architecture.md` for UI/settings/modal work.

- **[css-guidelines.md](standards/css-guidelines.md)**
  Supporting CSS guidance and enforcement notes. Use after `ui-architecture.md`.

- **[css-namespace-policy.md](standards/css-namespace-policy.md)**
  ERT vs `rt-*` namespace boundaries, allowlisted legacy islands, and the supporting allowlist file at `scripts/css-namespace-allowlist.json`.

- **[frontend-design.md](standards/frontend-design.md)**
  Frontend design aesthetics, UI/UX direction, and visual quality guide.

- **[provenance-watermarks.md](standards/provenance-watermarks.md)**
  How authorship of copied code is proven. Watermarks identify, never misrepresent — no marker may state a false behavioral fact. Includes the registry of live markers; check it before deleting anything that looks unused.

---

## Architecture Plans

Location: `docs/engineering/plans/`

Contains architecture proposals and historical planning documents.
These describe design direction but are not always authoritative rules.

- **[chronologue-time-references-plan.md](plans/chronologue-time-references-plan.md)** — Manual Chronologue time references: author controls, square markers, interior concentric connectors and off-range seam terminals, inherited subplot occurrences, nested Timetable rows, and isolated native acceptance.

- **[chronologue-detail-lanes-plan.md](plans/chronologue-detail-lanes-plan.md)** — Proposal: up to four character lanes under Chronologue's All Scenes ring, read from Character with POV from `resolveScenePov`, colored by Place; chronology findings (Date Audit results, a character in two places at once) shown on the existing duration arcs rather than a new flag lane, with one all-pairs overlap calculation owned by the Date Audit. Not built.
- **[v7-removals.md](plans/v7-removals.md)** — Migration shims and deprecated fallbacks to delete when cutting v7. Grep `TODO(v7)` for in-code touch points.
- **[parts-first-class-markers-implementation.md](plans/parts-first-class-markers-implementation.md)** — Decouple publishing Parts from narrative Acts: `Part:` becomes an explicit scene marker like `Chapter`. Executable plan; decisions D1–D4 and the migration-journal contract are settled. Origin: issue #30.
- **[desk-lamps-plan.md](plans/desk-lamps-plan.md)** — Desk Lamps: mutual close-friend lists on the Community, and a live "who's at the desk" lamp in the plugin for writing sessions the author chooses to share; a 12-row living list keeps the freshest lamps on top. Approved 2026-10-04; built 2026-10-03/04 (contract amended, backend live, website and plugin shipped).
- **[local-agent-handoff-plan.md](plans/local-agent-handoff-plan.md)** — Let subscription AI clients (Codex, Claude Code) run Summary, Pulse, Gossamer and Inquiry through a job mailbox in the vault, with every prompt compiled from the API run's own request and every reply applied by the API run's own code. Phase 0 (Gossamer Copy/Paste on the shared contract) shipped; Phases 1–4 (all four features, plus one-step "Prepare AI jobs…" and a request link the client can open) built behind the beta gate.
- **[timeline-table-and-sketches-plan.md](plans/timeline-table-and-sketches-plan.md)** — Timeline-first planning: **Promote to scene** brings any note in a book folder onto the timeline with the template it would get from Add scene; the **Timetable** (a Bases view, formerly "Timeline table") mirrors the wheel's order and colors, with status in the scene-number cell and a compact **Rings column** as the vertical linear view; and **sketches** (`Class: Sketch`) are pre-scene notes, written in a drawer, that live only in the table until promoted. One When formatter serves the hover and the table. Phases 1 and 2 built 2026-10-12; the doc lists the differences and what is not built yet.

---

## Engineering Audits

Location: `docs/engineering/audits/`

Historical audits and investigations.

- **[Chronologue annotation readability](audits/2026-10-17-chronologue-annotation-readability.md)** — Inner-band reference labels and overflow counts, full-opacity date squares, and native overflow-menu selection checks.
- **[Chronologue query foreground and source clearance](audits/2026-10-17-chronologue-query-foreground.md)** — Question icons above subplot headlines and separated source/date squares at the seam, checked in Fill and Sequence.
- **[Chronologue foreground layering](audits/2026-10-17-chronologue-foreground-layering.md)** — Date references and scene titles above fixed subplot headlines, with native shared-date owner switching and SVG-instance clipping checks.
- **[Chronologue normal-mode references and documentation](audits/2026-10-17-chronologue-normal-mode-and-docs.md)** — Sub-mode visibility, native Shift/Runtime/planetary checks and author-facing wiki screenshots.
- **[Chronologue reference emphasis and circular labels](audits/2026-10-17-chronologue-reference-emphasis.md)** — Larger selected and source squares, dimmed alternatives, circular labels and tangential marker rotation, with native Fill/Sequence checks.
- **[Chronologue reference ownership and selection](audits/2026-10-16-chronologue-reference-clarity.md)** — One All Scenes reference set, named source circles, one active connection and stable pinning, with native Fill/Sequence verification.
- **[Chronologue reference alignment correction](audits/2026-10-16-chronologue-reference-alignment.md)** — Scene-bottom labels, consistent seam angles, unoutlined solid marks and Lucide Activity, with native count-clipping verification.
- **[Chronologue reference visibility](audits/2026-10-16-chronologue-reference-visibility.md)** — Deeper interior tracks, larger seam notation and square markers, native dominance collision checks and verification.
- **[Chronologue reference seam](audits/2026-10-15-chronologue-reference-seam.md)** — Primary-date-only range, interior connectors, seam discontinuities, square stacks, linked native selection and verification.
- **[Chronologue time references](audits/2026-10-14-chronologue-time-references.md)** — Manual prototype audit, native evidence, verification results, and remaining acceptance coverage.

---

## Refactor Protocol

Before performing any architectural refactor:

1. Read:
   - `docs/engineering/standards/code-doctrine.md`
   - `docs/engineering/standards/inquiry-critical-path-rules.md`
   - `docs/engineering/standards/refactor-playbook.md`

2. Prefer deletion over accommodation.
3. Remove duplicate logic and fallback paths.
4. Maintain deterministic behavior.
5. Ensure the refactor reduces complexity.

---

Engineering doctrine lives in: `docs/engineering/standards/`
Architecture discussions live in: `docs/engineering/plans/`
Audits live in: `docs/engineering/audits/`
