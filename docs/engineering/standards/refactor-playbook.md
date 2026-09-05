# RT Refactor Playbook

This document defines how large refactors must be performed in the Radial Timeline codebase.

The goal is to make structural changes **safely, incrementally, and with less code**, not more.

This playbook is especially important for large files such as:

- `InquiryView.ts`
- `AiSection.ts`
- `InquiryRunnerService.ts`
- renderer / visualization subsystems
- provider adapter layers

---

## 1. Refactor by Subtraction First

A refactor should begin with this question:

> What can be removed?

Not:

> What new abstraction can be added?

The default strategy is:

1. identify duplicate logic
2. identify fallback logic
3. identify dead/legacy branches
4. delete or merge
5. only then extract or reorganize

---

## 2. Do Not Move Complexity Without Reducing It

Moving code into a new file is **not** a successful refactor by itself.

A refactor only counts as successful if at least one of these becomes true:

- fewer branches
- fewer fallback paths
- fewer duplicate helpers
- fewer hidden dependencies
- clearer ownership
- smaller public surface
- easier tests

Bad refactor:

- same complexity
- more files
- more interfaces
- more indirection

Good refactor:

- less code
- fewer paths
- simpler reasoning

---

## 3. Extract Pure Logic First

When splitting a large file, the safest order is:

### Step A: Shared types

Move shared interfaces/types first.

### Step B: Pure helpers

Extract functions with:

- explicit inputs
- explicit outputs
- no DOM
- no plugin access
- no `this.*`

### Step C: Services

Extract stateful or dependency-owning services only after pure logic is isolated.

### Step D: Rendering

Move rendering subsystems after logic boundaries are stable.

This order minimizes breakage.

---

## 4. One New Boundary at a Time

Do not create multiple new abstractions in one pass unless they are tightly coupled.

Preferred pattern:

- one new file
- one clean responsibility
- one integration step
- tests
- then next extraction

Avoid "mega-refactors" unless absolutely necessary.

---

## 5. Every New Module Must Have a Clear Job

A new file/module must be describable in one sentence.

Examples:

- `InquiryEstimateService` — builds and caches Inquiry estimate snapshots
- `InquiryCorpusService` — resolves corpus entries, overrides, and payload stats
- `InquiryMinimapRenderer` — owns minimap SVG rendering and state

If the module cannot be described simply, the boundary is probably wrong.

---

## 6. Prefer Orchestrators Over God Objects

Large view/controller files should orchestrate, not implement.

A view file may:

- gather state
- call services
- render results
- handle events

A view file should not also:

- calculate multiple estimates
- own corpus resolution
- own provider routing
- contain fallback and recovery layers
- own unrelated rendering subsystems

---

## 7. Avoid Shadow View-Models

When extracting services, do not create a second hidden controller.

A service may own:

- computation
- internal cache
- override maps
- normalized data

A service must not quietly absorb:

- UI flags
- DOM state
- tooltip state
- visual selection state
- display-only presentation decisions

Those stay in the view/orchestrator unless explicitly moved to a renderer.

---

## 8. Keep Host Interfaces Small

When a renderer or submodule needs data from a host, define a small interface.

Good host methods:

- query-oriented
- event-oriented
- minimal

Examples:

- `getScope()`
- `getMinimapItems()`
- `onTickClick()`

Bad host methods:

- broad access to internal state
- random plumbing methods
- convenience methods that leak whole subsystems

If a host interface starts growing quickly, stop and rethink the boundary.

---

## 9. Prefer Explicit Parameters Over Hidden Reads

If a function/service needs data, pass it in.

Prefer:

```ts
renderTicks(items, scope, callbacks)
```

---

## 10. Refactors Must Reduce Code

A refactor that increases total code size without removing functionality is usually a failed refactor.

Preferred outcome:

- fewer lines
- fewer branches
- fewer files
- fewer concepts

Large files may temporarily grow during refactor steps, but the final result must be smaller and simpler.
