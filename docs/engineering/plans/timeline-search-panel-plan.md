# Timeline Search Panel — Scope Options + Local LLM Concept Search

## Status

Planning. No implementation started. Mapped against the codebase as it exists
today (every file:line below was read, not assumed). Written to be executed in
small verified slices; each stage ends with `npx tsc --noEmit` + `npm test`
green and is independently shippable.

## Goal

Today the timeline search box is a single blind text field: type a phrase,
press Enter, and scenes whose **frontmatter** contains that literal phrase get
a yellow number square. Authors have no way to (a) see what is being searched,
(b) search the prose itself, or (c) ask a question the manuscript answers
without using those exact words.

Target: clicking the search control still lets the author type immediately, but
also expands a panel that is visually continuous with the input, exposing:

- **Where to look** — Frontmatter (default on) and/or Scene body.
- **How to look** — literal phrase (current behavior) or **Local LLM assist**,
  which finds phrases *and concepts*. Disabled and grayed when no local server
  is connected, with the reason stated in plain words.

Match presentation does not change: matched scenes get the existing yellow
number square, and hovering a match keeps the existing metadata term
highlighting. New capability is added **behind** that same visual contract.
Additionally, clicking a matched scene opens it with the matching body ranges
highlighted in the editor.

## Current behavior (verified)

**Control construction** — [TimeLineView.ts:287-535](../../../src/view/TimeLineView.ts#L287)
`ensureBookSwitcher()` builds a `.rt-book-switcher` wrapper inserted before
`.view-actions` in `.view-header`. Inside it, `.ert-timeline-search` holds an
absolutely-positioned icon button and an `input[type="search"]`.

**Commit paths** — button click ([:315](../../../src/view/TimeLineView.ts#L315)),
`Enter` ([:330](../../../src/view/TimeLineView.ts#L330)), and `blur`
([:327](../../../src/view/TimeLineView.ts#L327)) all funnel into
`commitTimelineSearchFromInput()` ([:2147](../../../src/view/TimeLineView.ts#L2147))
→ `plugin.performSearch(term)`. The button icon flips `search` ↔ `search-x`
via `setTimelineSearchButtonMode()` ([:2120](../../../src/view/TimeLineView.ts#L2120)).

**Matching** — [SearchService.ts:127-158](../../../src/services/SearchService.ts#L127).
`performSearch` sets `plugin.searchTerm` / `plugin.searchActive`, walks
`getSceneData()`, and calls `timelineSceneMatchesSearch()`, which tests a
case-insensitive **substring** (`containsWholePhrase`, [:13](../../../src/services/SearchService.ts#L13))
against title, synopsis, Character, subplot, Duration, optionally
`currentSceneAnalysis`, the planetary line, and two date renderings. Matched
paths land in `plugin.searchResults: Set<string>`, then every view
re-renders.

**Rendering** — two independent surfaces:
1. Number squares: [SearchInteractions.ts:158-185](../../../src/view/interactions/SearchInteractions.ts#L158)
   adds `.rt-search-result` to `.rt-number-square` / `.rt-number-text`
   (yellow, `--rt-color-search`, [scenes.css:517](../../../src/styles/scenes.css#L517)).
   `sceneHelpers.ts:288` also derives `isSearchMatch` at render time.
2. Term highlight: `applySearchTermHighlightsInRoot()`
   ([:45](../../../src/view/interactions/SearchInteractions.ts#L45)) wraps literal
   occurrences in `tspan.rt-search-term` across subplot / character / title /
   date / duration / synopsis tspans — this is the hover metadata highlight.
   Re-applied by `SynopsisManager.ts:1805` on each synopsis build.

**Invalidation** — `ChangeDetection.ts` tracks `searchActive` and the
`searchResults` set ([:313](../../../src/renderer/ChangeDetection.ts#L313)).

**Scene click → open** — `openOrRevealFile()` ([fileUtils.ts:22](../../../src/utils/fileUtils.ts#L22))
from four call sites: `AllScenesMode.ts:48`, `MainPlotMode.ts:122`,
`GossamerMode.ts:286,302`, `ChronologueMode.ts`. No highlight state is passed.

**Local LLM** — `src/ai/localLlm/` is complete and reusable:
`transport.ts` does abortable, size-bounded `/models` probes; `backends.ts`
abstracts ollama / lmStudio / openaiCompatible; `structuredJson.ts` runs a
strict-JSON pipeline honoring `jsonMode` + `maxRetries`; `diagnostics.ts`
`runLocalLlmDiagnostics()` returns reachable / modelAvailable /
basicCompletion / structuredJson. Settings live at `aiSettings.localLlm`
(default `ollama`, `http://localhost:11434/v1`).

### Pre-existing defect found while mapping

`performSearch` calls `plugin.getSceneData()`, not `plugin.getTimelineSceneData()`
([main.ts:775-797](../../../src/main.ts#L775)). In **Saga scope** the timeline
renders every book's scenes but search only scans the active book — matches in
other books are silently invisible. Fix in Stage 1 as part of the state
consolidation; it is a one-line change once search has a single entry point.

## Interaction design

### Anatomy

```
.rt-book-switcher                      (position: relative — existing)
└── .ert-timeline-search               (is-expanded when panel open)
    ├── button.ert-timeline-search__button
    ├── input.ert-timeline-search__input
    └── div.ert-timeline-search-panel   role="group"  ← NEW
        ├── fieldset .ert-timeline-search-panel__scope   "Search in"
        │   ├── checkbox  Frontmatter        (default on)
        │   └── checkbox  Scene body
        ├── div .ert-timeline-search-panel__assist
        │   ├── checkbox  Local LLM assist   (disabled + grayed when offline)
        │   └── span .…__assist-note         model name, or the offline reason
        └── div .ert-timeline-search-panel__status  aria-live="polite"
            └── "14 scenes matched"  |  "Reading 62 scenes…"  |  [Cancel]
```

Two **independent axes**, not three radio modes: scope is *where* to look
(additive checkboxes — an author can want a name in frontmatter *and* in the
prose), assist is *how*. LLM assist × Frontmatter is meaningful on its own
(fuzzy synopsis/character matching without the exact words), so the axes stay
orthogonal rather than collapsing into one list.

The panel is a child of `.ert-timeline-search`, absolutely positioned at
`top: calc(100% - 1px); left: 0` — the same pattern `.ert-timeline-legend`
already uses ([timeline.css:2152](../../../src/styles/timeline.css#L2152)), so
the header's stacking and clipping are already proven for this. Visual
continuity: while expanded the input flattens its bottom corners and the panel
flattens its top, sharing one border line, so input + panel read as a single
control.

### Behavior

| Event | Result |
| --- | --- |
| Focus input, or click the search icon in `search` mode | Panel expands. Typing works immediately — expanding never steals focus from the input. |
| Change any option | Options persist; if a search is already active it re-runs with the new options. |
| `Enter` / icon click | Commit search. Panel stays open so the author can retune. |
| `Escape` | Collapse panel, keep the term and results. Second `Escape` clears the search. |
| Click outside / `focusout` of the whole shell | Collapse panel. **Do not** commit on blur in LLM mode — see below. |
| Clear (`search-x`) | Clear term + results, collapse panel, keep option selections. |

**Blur-commit must change.** Today `blur` commits ([:327](../../../src/view/TimeLineView.ts#L327)),
which is harmless for a synchronous substring scan but would fire an LLM run
every time focus leaves the field. New rule: `blur` commits only when assist is
**off**; with assist on, commit requires `Enter` or the icon. Stated as a rule
rather than a debounce so the behavior is deterministic.

### Accessibility (WCAG 2.1 AA)

- Panel is `role="group"` with `aria-label`; the scope group is a real
  `<fieldset>` + `<legend>` (visually hidden legend).
- Input carries `aria-expanded` and `aria-controls` pointing at the panel id.
- The disabled assist checkbox gets `aria-describedby` → the reason note. The
  note itself renders at `--text-muted` (passes AA on both themes); the
  disabled control's own contrast is exempt, but the *reason must always be
  readable* — never a gray control with no explanation.
- Status line is `aria-live="polite"` so match counts and progress are announced.
- Full keyboard path: Tab from input → scope checkboxes → assist → Cancel.

## Architecture

### Stage 1 — One search state (refactor, no new features)

Three plugin fields (`searchTerm`, `searchActive`, `searchResults`,
[main.ts:156](../../../src/main.ts#L156)) become one object. Adding scope, assist,
async status, and per-scene body ranges to three parallel fields would multiply
the drift surface; consolidating first is what makes every later stage a small
diff.

```ts
// src/services/searchState.ts
export interface TimelineSearchOptions {
    frontmatter: boolean;   // default true
    body: boolean;          // default false
    llmAssist: boolean;     // default false; forced false when unavailable
}

export interface TimelineSearchHit {
    path: string;
    /** File-offset ranges to highlight when the scene is opened. Empty for frontmatter-only hits. */
    ranges: Array<[number, number]>;
    /** LLM assist only: the model's one-line justification. */
    reason?: string;
}

export type TimelineSearchStatus = 'idle' | 'running' | 'ready' | 'error';

export interface TimelineSearchState {
    term: string;
    options: TimelineSearchOptions;
    active: boolean;
    status: TimelineSearchStatus;
    /** Verbatim failure text. Never a generic "search failed". */
    error?: string;
    hits: Map<string, TimelineSearchHit>;
}
```

`plugin.searchState` is the single source of truth. **No compatibility
getters** for the old three fields — per `code-doctrine.md` ("prefer deletion
over accommodation"), every reader migrates in the same commit:

| File | What changes |
| --- | --- |
| `src/main.ts:156-157` + `searchResults` decl | Replaced by `searchState` |
| `src/services/SearchService.ts` | Rewritten around the state object; `getSceneData` → `getTimelineSceneData` (Saga fix) |
| `src/view/TimeLineView.ts:2100-2177, 2649, 2676, 2741-2744, 2860-2861` | Read `searchState` |
| `src/view/interactions/SearchInteractions.ts:13-22, 159-173` | `SearchView` interface + `hits` lookup |
| `src/utils/sceneHelpers.ts:202-204, 288` | `isSearchMatch` from `hits` |
| `src/SynopsisManager.ts:1805` | Guard reads `searchState` |
| `src/renderer/ChangeDetection.ts:47, 112, 242, 313` | Track `active`, `options`, and the hit-path set |
| `src/debug/snapshot.ts:28, 88` | Snapshot the state object |
| `ChangeDetection.test.ts`, `Precompute.test.ts` | Fixture updates |

Ship Stage 1 alone and verify no behavior change: same matches, same yellow
squares, same hover highlighting — plus Saga scope now searching all books.

### Stage 2 — The panel (UI only, no new search capability)

- Build the panel in `ensureBookSwitcher()`, extracted into
  `src/view/interactions/SearchPanelController.ts` so `TimeLineView` does not
  grow another inline closure (`ui-architecture.md` — new shell work is
  `ert-` prefixed; `SearchInteractions.ts` keeps the render-side helpers).
- DOM via `createEl`/`setText`/`setIcon` only — no `innerHTML` family.
- All strings into `src/i18n/locales/en.ts` under a new `timeline.search.*`
  block (interface + values, both halves).
- CSS appended to the existing `.ert-timeline-search` block in
  `src/styles/timeline.css`. Theme tokens only, no hardcoded hex.
- Options persist in plugin settings (`settings.timelineSearch`), **not** in
  scene frontmatter — this is a view preference and scene YAML belongs to the
  author.
- At this stage the assist checkbox renders disabled with "Checking…" and the
  scope checkboxes drive nothing but their own persistence. Frontmatter-only
  search still works exactly as before.

### Stage 3 — Scene body search (no LLM)

New `src/services/SceneBodyIndex.ts`:

```ts
interface SceneBodyEntry {
    path: string;
    mtime: number;
    /** Body text with frontmatter stripped. */
    body: string;
    /** Char offset of body[0] within the raw file — needed to map ranges back for highlighting. */
    bodyOffset: number;
}
```

- Reads with `vault.cachedRead`; `bodyOffset` from
  `metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0`
  (the plugin already uses `cachedRead` + frontmatter offsets in
  `utils/manuscript.ts:754` and `utils/referenceIdBackfill.ts:58`).
- Invalidated on `mtime` change and on vault `modify` / `rename` / `delete`.
- Built lazily on the first body search, scoped to the active book (or all
  Saga books when in Saga scope). Entry count and total chars logged; if a
  bound is ever applied it is reported in the status line — never a silent cap.

Matching: case-insensitive literal `indexOf` sweep collecting **all** ranges —
not a regex, so an author's apostrophes, parentheses, and em dashes need no
escaping and mean exactly themselves. This deliberately matches the existing
`containsWholePhrase` semantics, so switching scope changes *where* the plugin
looks, never *what counts as a match*.

Ranges are stored as file offsets (`bodyOffset + bodyRange`) on the hit.

### Stage 4 — Local LLM availability

New `src/ai/localLlm/availability.ts`:

```ts
export interface LocalLlmAvailability {
    available: boolean;
    /** Why not — rendered verbatim in the panel. Never a generic message. */
    reason?: string;
    modelId?: string;
    checkedAt: number;
}

export function getLocalLlmAvailability(
    plugin: RadialTimelinePlugin,
    opts?: { maxAgeMs?: number; force?: boolean }
): Promise<LocalLlmAvailability>;
```

Checks, in order, each producing a specific reason: local LLM disabled in
settings → server unreachable (the transport's own error text) → configured
model absent from `/models` (names the model). Uses only
`backend.listModels()` via the existing `transport.ts` probe — **no completion
calls** — so it stays fast enough for a UI affordance. Cached ~60s in memory,
invalidated whenever `aiSettings.localLlm` is saved.

**Single source of truth.** These two checks are exactly the first two checks
of `runLocalLlmDiagnostics()` ([diagnostics.ts:53-60](../../../src/ai/localLlm/diagnostics.ts#L53)).
Rather than duplicate them, `diagnostics.ts` is refactored to call the shared
probe and continue with its deeper completion tests, and a settings-side
diagnostics run writes through to the same cache. Settings → AI and the search
panel then cannot report contradictory connection states.

Panel wiring: on expand, `getLocalLlmAvailability()`; available → checkbox
enabled, note reads the model id; unavailable → checkbox disabled + forced off,
note reads the reason.

### Stage 5 — Concept search

New `src/services/ConceptSearchService.ts`.

1. **Gate.** Re-check availability with `force: true` at commit. Unavailable →
   status shows the reason and the run does not start. **No cloud fallback** —
   both because manuscript prose must not silently leave the machine and
   because silent degradation is against `fallback-policy.md`.
2. **Corpus.** From `SceneBodyIndex` when body scope is on; from the
   frontmatter fields `buildTimelineSearchTextFields()` already assembles when
   only frontmatter scope is on.
3. **Chunking.** Reuse `src/ai/tokens/inputTokenEstimate.ts` and `computeCaps`
   for the local model's window rather than inventing a second estimator.
   Scenes are numbered per chunk (`scene_id: "7"`), never addressed by path —
   models mangle paths, and a local number maps back deterministically.
4. **Prompt + schema.** One call per chunk through
   `runStructuredJsonPipeline()`, schema:

   ```json
   { "type": "object", "required": ["matches"], "properties": {
     "matches": { "type": "array", "items": {
       "type": "object",
       "required": ["scene_id", "confidence", "reason", "quotes"],
       "properties": {
         "scene_id":   { "type": "string" },
         "confidence": { "type": "number" },
         "reason":     { "type": "string" },
         "quotes":     { "type": "array", "items": { "type": "string" } }
       } } } } }
   ```

   The prompt instructs: return only scenes that genuinely bear on the query;
   every quote must be copied **verbatim** from the scene text.
5. **Verify every quote** against the indexed text — exact match first, then
   whitespace-normalized. This mirrors what Inquiry already does with evidence
   refs (`InquiryRunnerService.verifyFindingRefs`, [:2238](../../../src/inquiry/runner/InquiryRunnerService.ts#L2238)).
   Unverifiable quote → dropped. Scene with zero verified quotes → dropped
   entirely. A highlight the text cannot support is worse than no highlight.
6. **Report the drops.** Status line: `14 scenes · 3 model claims dropped (no
   verbatim match)`. Silent truncation would read as full coverage.
7. **Cancellable** via `AbortController`, with `chunk 3/7` progress. Cancel
   leaves the previous results intact.

Verified hits then flow into `searchState.hits` and render through the
**existing** yellow-number-square path — no new render code.

Term highlighting in the hover synopsis is **skipped** under assist, because
the author's query words usually do not appear in the prose. (Deferred idea:
highlight the verified quote where it appears in the synopsis, and surface
`reason` on hover. Out of scope for V1.)

### Stage 6 — Body highlight on scene open

Extend `fileUtils.ts`:

```ts
export interface OpenMatchHighlight {
    /** Full raw file content — Obsidian indexes ranges against what it is given. */
    content: string;
    matches: Array<[number, number]>;
}

export async function openOrRevealFile(
    app: App, file: TFile, newLeaf?: boolean, highlight?: OpenMatchHighlight
): Promise<void>;
```

Implemented via `leaf.openFile(file, { active: true, eState: { match: highlight } })`
— the same ephemeral state Obsidian core search uses to flash-highlight a
result. `OpenViewState.eState` is typed `Record<string, unknown>` in
`obsidian.d.ts`, so this needs no cast and no `// SAFE:` comment.

The four scene-click call sites (`AllScenesMode.ts:48`, `MainPlotMode.ts:122`,
`ChronologueMode.ts`, `GossamerMode.ts:286,302`) pass the hit's ranges when the
clicked path is in `searchState.hits` and has ranges; otherwise they pass
nothing and behave exactly as today.

**Verify `eState.match` empirically in the sample vault before building on
it.** Decided-in-advance Plan B if it proves unreliable across editing modes: a
CodeMirror 6 decoration extension — the plugin already imports
`@codemirror/view` and calls `registerEditorExtension` ([main.ts:640](../../../src/main.ts#L640)),
so the infrastructure exists. This is a design branch chosen before
implementation, not a runtime fallback.

## Privacy

Scene prose is read locally and, under assist, sent **only** to the operator's
own local server. No cloud provider path exists for body or concept search in
this feature — not as a fallback, not as an option. This is the same posture as
the local-first onboarding work and the standing author-data stance: prose
leaves the machine only when the author explicitly chooses a cloud feature.
The search panel is never that choice.

## Test plan

Unit (vitest, alongside the existing `*.test.ts` neighbors):
- `searchState` reducers: option toggles, clear, status transitions.
- Body matcher: multiple hits per scene, overlapping candidates, regex
  metacharacters treated literally, case-insensitivity, empty body.
- `bodyOffset` arithmetic: with and without frontmatter, CRLF files.
- `SceneBodyIndex` invalidation on mtime change.
- `availability`: each failure branch yields its own specific reason.
- Quote verification: exact, whitespace-normalized, and rejected quotes;
  a scene losing all quotes is dropped.
- `ChangeDetection`: option change and hit-set change each force a re-render.

Manual, in the sample vault (`docs/engineering/sample-vaults.md`):
- Frontmatter-only search matches the pre-change result set exactly (regression).
- Saga scope now matches across all books.
- Panel keyboard path, `Escape` twice, outside-click collapse.
- Assist grayed with server stopped; the note names the actual reason; enables
  within one expand cycle after the server starts.
- Concept query with no literal overlap ("a betrayal the reader sees coming")
  highlights plausible scenes; clicking one highlights the quoted passage.
- Cancel mid-run leaves prior results intact.

## Risks

| Risk | Mitigation |
| --- | --- |
| `eState.match` behaves inconsistently across reading/live-preview/source | Verify in Stage 6 before wiring all four call sites; CM6 extension is the pre-decided branch |
| Stage 1 refactor touches 10 files and could regress search silently | Ship Stage 1 alone with no behavior change; regression check is "identical result set" |
| Local models return confident nonsense | Mandatory verbatim quote verification; unverifiable claims dropped and counted in the UI |
| A 60-scene concept run is slow enough to feel broken | Per-chunk progress + Cancel; assist never commits on blur |
| Body index memory on large manuscripts | Scoped to active book, `cachedRead`-backed, mtime-invalidated; size logged |

## Open decisions

1. **Saga scope under assist** — searching every book's prose multiplies the
   token cost. Proposal: assist runs on the active book only, with the status
   line saying so. Needs a call before Stage 5.
2. **Confidence threshold** — whether to expose a sensitivity control or fix a
   threshold internally. Proposal: fix it internally for V1; a slider is a
   knob that cannot be explained to an author without explaining the model.

## Decision log

- **2026-08-07** — Scope modeled as two independent axes (where × how), not
  three exclusive modes: LLM assist over frontmatter is independently useful,
  and authors legitimately want frontmatter *and* body at once.
- **2026-08-07** — No cloud provider path for body/concept search, by design.
- **2026-08-07** — Search state consolidated into one object before any feature
  work, with no compatibility shim for the three old fields.
