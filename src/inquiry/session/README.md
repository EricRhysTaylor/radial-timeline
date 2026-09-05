# Inquiry Session Controllers

Result of the InquirySessionController extraction campaign (audit:
[`docs/engineering/audits/inquiry-session-controller-map-2026-05-21.md`](../../../docs/engineering/audits/inquiry-session-controller-map-2026-05-21.md)).

`InquiryView` retains responsibility for orchestration, rendering, and event wiring.
State ownership is split across three small controllers that the view composes:

| Field on `InquiryState` | Owner | Slice |
|---|---|---|
| `activeSessionId`, `activeResult`, `activeQuestionId`, `activeZone`, `cacheStatus`, `corpusFingerprint`, `corpusOnlyFingerprint`, `corpusManifestSnapshot`, `lastError` | [`InquiryActiveSessionState`](./inquiryActiveSessionState.ts) | 1 |
| `mode`, `targetSceneIds`, `activeBookId` (+ in-memory `lastTargetSceneIdsByBookId` Map + debounced `inquiryTargetCache` persistence) | [`InquirySelectionState`](./inquirySelectionState.ts) | 2a / 2b / 2c |
| `isRunning`, `scope`, `selectedPromptIds`, `promptFormOverrides`, `reportPreviewOpen` | `InquiryView` (pending future slices) | — |

A read-side facade lives next to the controllers:

| Surface | Owner |
|---|---|
| `plugin.settings.inquiry*` reads | [`InquirySettingsAccessor`](../settings/inquirySettingsAccessor.ts) (Slice 3) |

## Why controllers, not a god-store

Each controller writes through to the shared `state: InquiryState` object on
`InquiryView` via a captured host reference. Existing read sites in the view
(`this.state.mode === 'depth'`, `this.state.targetSceneIds.length`, etc.) are
unchanged — the controllers centralize **writes**, leaving reads orthogonal.

That choice came from the audit's Risk #8: a full Flux/subscriber pattern
introduces ordering complexity for a single-view application that doesn't need
it. The view explicitly calls `refreshUI()` after controller mutations, as it
did before the extraction.

## Disposable contract

`InquirySelectionState` owns the 300ms `inquiryTargetCache` debounce timer, so
it implements [`Disposable`](../../core/disposable.ts). `InquiryView.onClose`
explicitly calls `this.selection?.cleanup()` alongside the other controller
cleanups. `InquiryActiveSessionState` and `InquirySettingsAccessor` hold no
external resources and are not `Disposable`.

## Settings boundary

Neither controller imports `RadialTimelinePlugin`. Settings access flows
through closures supplied by `InquiryView` in its constructor:

```ts
this.settingsAccessor = new InquirySettingsAccessor(() => this.plugin.settings);
this.selection = new InquirySelectionState(
    { state: this.state },
    {
        getPersistedLastMode: () => this.plugin.settings.inquiryLastMode,
        setPersistedLastMode: (mode) => { this.plugin.settings.inquiryLastMode = mode; },
        setTargetCache: (cache) => { this.plugin.settings.inquiryTargetCache = cache; },
        saveSettings: () => this.plugin.saveSettings(),
    }
);
```

This keeps host interfaces small (refactor-playbook §8) and makes the
controllers testable without a fake plugin.

## Doctrine guards

Each controller has unit tests that include reflective ownership-boundary
checks:

- No method name matching `^(compute|estimate|hover|recompute)` —
  [`inquiry-critical-path-rules.md`](../../../docs/engineering/standards/inquiry-critical-path-rules.md)
  §5 (estimate snapshot is single source) and §6 (hover does not recompute).
- The `InquiryActiveSessionState`'s corpus-fingerprint trio is always written
  as a unit (`§5` atomicity).
- The `InquirySelectionState`'s `setActiveBookId` is the **only** mutation
  entry point for `state.activeBookId` — audit Risk #1 convergence.
- The `InquirySettingsAccessor` exposes only read methods (`get*`); the
  presence of any `set*` / `write*` / `clear*` fails its own boundary test.

Cross-controller boundaries are pinned by the campaign's
[characterization tests](./inquirySelectionState.characterization.test.ts):
they read `InquiryView.ts` as a string and assert (a) every controlled field
has zero direct `this.state.<field> =` writes in the view, and (b) every
pending field still has the inline write today. The forcing-function pattern
guarantees that any future slice that absorbs a pending field must update
this list — silent drift fails the test loudly.

## What remains pending

Per the user's batched campaign authorization, the controllers stop here.
The next tier is architectural rather than extractive and requires its own
audit before proceeding:

- `scope` (transient + audit-rule-bound; corpus + saga-availability coupling)
- run orchestration (`isRunning` + AbortController + retry + the runner service)
- corpus orchestration / refresh
- AI execution lifecycle
- subscriber / event-bus pattern

The full session controller (which would absorb `isRunning` and run state)
remains the audit's deferred Slice 4.
