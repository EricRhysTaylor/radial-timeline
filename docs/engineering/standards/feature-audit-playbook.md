# Feature Audit & Stabilization Playbook

Authoritative procedure for the **post-feature audit, cleanup, and harden
pass**. Run this after any new feature or significant addition is implemented
and functioning, before it is considered release-ready.

This pass exists because iterative revisions reliably introduce: duplicated
logic, naming drift, bloated modal/controller code, temporary compatibility
hacks, scattered state ownership, persistence risks, architectural leakage,
and UI inconsistency.

**Goal: simplify, normalize, and stabilize the feature without changing
intended behavior.** It is NOT a feature-adding pass.

---

## Operating rules (RT-specific)

- **Report first.** Default mode is read-only: produce the audit report with
  prioritized findings and get approval before editing. Apply fixes only when
  the user opts in (low-risk-only / non-architectural / full).
- **Verification uses `build-only` or `npx tsc --noEmit` + `npx vitest run`.**
  Never run `npm run build` for agent verification — it auto-commits and
  pushes via the backup script.
- **Obey the doctrine.** This pass is subordinate to
  `code-doctrine.md`, `fallback-policy.md`, and `refactor-playbook.md`.
  Prefer deletion over accommodation. Never add fallback logic to "stabilize."
- **No speculative abstractions.** Do not future-proof. Reduce complexity;
  do not add layers.
- **Preserve behavior, settings compatibility, and migrations** unless a
  change is explicitly approved.
- **ERT classes only** for new chrome; never introduce new `rt-*` classes.
- **Extraction order when refactoring:** types → pure helpers → services →
  renderers (per `refactor-playbook.md`).

---

## Scoping the pass

1. Identify the feature surface from git: `git diff --stat <last-release>..HEAD`
   plus uncommitted changes. List every touched service, view, settings
   section, type, style file, command, i18n block, and test.
2. Read the whole surface — do not sample. Oversized files are read in ranges.
3. Establish a clean baseline: `npx tsc --noEmit` and `npx vitest run` before
   proposing any change.

---

## Audit dimensions

For each, identify issues and (on approval) refactor toward the stated target.

1. **Architecture** — business logic in UI, rendering in services, duplicated
   derivation, scattered state ownership, hidden coupling, oversized
   modal/controller logic, unnecessary abstraction. Target: clear ownership,
   simple data flow, centralized derivation, isolated responsibilities.

2. **Naming** — normalize across settings, types, services, commands, UI
   labels, helpers, notices/tooltips, schema fields. Remove legacy
   terminology, partially renamed systems, misleading identifiers. Match
   current RT branding and feature language.

3. **Dead code** — unused helpers, abandoned migration logic, obsolete
   comments, unreachable branches, temporary compatibility code, resolved
   TODOs, unused settings paths, duplicate utilities, orphan i18n keys, and
   commands that exist for trivial/redundant actions.

4. **Type safety** — eliminate `any`, unsafe casts, nullable drift,
   duplicated type definitions, weakly typed state. Prefer centralized types,
   discriminated unions, normalized interfaces, safe persistence boundaries.

5. **State & persistence** — single source of truth; settings normalization
   run once (not on every read); migration safety; safe hydration and
   defaults; no duplicated/stale derived state; no mutation leaks. Look
   specifically for race conditions, stale references, and hidden persistence
   assumptions. **Schema-stamp persisted data shapes** (`schemaVersion`) so
   future releases and external consumers can migrate deterministically.

6. **UX consistency** — spacing, hierarchy, headers, button patterns, card
   layouts, notices, empty states, tooltip tone, modal structure,
   terminology. Remove drift introduced during iteration.

   **CSS variable scope check (mandatory for any new chrome).** For every
   element introduced by the feature: open it in the inspector and verify
   that its CSS custom properties (`var(...)` references) resolve to real
   values. `--ert-gap-*` and `--ert-pad-*` are scoped to `.ert-ui` only —
   any element appended to `document.body` (popovers, tooltips, portals)
   cannot read them, and properties using them silently fall back to `0`.
   For those surfaces, use Obsidian's global `--size-4-*` tokens. See
   `css-guidelines.md` → Token scope.

7. **Performance** — repeated vault scans, unnecessary recomputation, repeated
   markdown parsing, avoidable async churn, excessive renders, duplicated
   selectors, unnecessary timeline rebuilds. Prefer cached derivations and
   centralized computation. Watch interval/tick loops doing work while idle.

8. **File structure** — oversized files, god objects, bloated modals, mixed
   responsibilities, scattered feature logic. Move toward cohesive, smaller,
   locally-owned modules — without fragmenting into micro-files. Defer large
   extractions unless they clearly reduce complexity now.

9. **Release safety** — fragile assumptions, migration risks, persistence
   edge cases, unsafe mutations, stale UI state, hidden coupling, feature
   interactions, schema drift, partial normalization. Verify backward
   compatibility and a clean `tsc` + test baseline.

### Data ownership note

User-generated data (sessions, logs, history) must remain the author's:
prefer a portable, human-readable, vault-local artifact that survives
in-settings caps and plugin uninstall. Keep it local unless upload is
explicitly approved. Stamp it with `schemaVersion`.

---

## Required output

1. Cleanup summary
2. Risks/issues found (prioritized: release-blocking → high → medium → low)
3. Refactors performed
4. Dead code removed
5. Naming normalizations
6. Deferred concerns
7. Recommended follow-up work
8. Confirmation that feature behavior remains intact
9. Confirmation that release/build safety was verified (`tsc` + tests)

---

## Constraints

- Do NOT add features, redesign working UX, or introduce speculative
  abstractions.
- Do NOT rewrite stable systems without clear benefit.
- Preserve backward compatibility, intended UX behavior, and settings
  migrations unless explicitly approved.
- Prefer simplification over cleverness.
