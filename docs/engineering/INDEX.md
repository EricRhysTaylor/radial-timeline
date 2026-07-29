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
  Authoritative contract for projecting writing-session data to private,
  friends, and community audiences. Read before touching any code that
  reads, renders, or transmits `WritingSessionRecord`. Enforced by the
  tracer test in `projections.privacy.test.ts`.

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

---

## Architecture Plans

Location: `docs/engineering/plans/`

Contains architecture proposals and historical planning documents.
These describe design direction but are not always authoritative rules.

- **[v7-removals.md](plans/v7-removals.md)** — Migration shims and deprecated fallbacks to delete when cutting v7. Grep `TODO(v7)` for in-code touch points.
- **[parts-first-class-markers-implementation.md](plans/parts-first-class-markers-implementation.md)** — Decouple publishing Parts from narrative Acts: `Part:` becomes an explicit scene marker like `Chapter`. Executable plan; decisions D1–D4 and the migration-journal contract are settled. Origin: issue #30.

---

## Engineering Audits

Location: `docs/engineering/audits/`

Historical audits and investigations.

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
