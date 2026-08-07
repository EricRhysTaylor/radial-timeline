# Timeline Search Panel — Scope Options + Local LLM Concept Search

## Status

**All seven stages are implemented, shipped, and verified live.**

Concept search completed a full run against a real 30B local model: 96 scenes
read one per request in ~2.5 minutes, **31 scenes matched, 4 model claims
dropped for want of a verbatim quote** — the verification gate working and
reporting itself. Mapped against the codebase as it exists today (every file:line
below was read, not assumed). Each stage ends with `npx tsc --noEmit` +
`npm test` green and is independently shippable.

| Stage | State |
| --- | --- |
| 1 — One search state, transactional | **Done** |
| 1b — Searched fields == rendered fields | **Done** |
| 2 — The panel | **Done** |
| 3 — Scene body search | **Done** |
| 4 — Local LLM availability | **Done** |
| 5 — Concept search | **Done** |
| 6 — Body highlight on scene open | **Done** |

**`eState.match` is confirmed working** — verified in the sample vault: a body
match opens the scene scrolled to the passage with every occurrence
highlighted. The CodeMirror 6 decoration fallback named below is therefore
**not needed** and should not be built.

Stage 6 was taken before 4 and 5 because Stage 3 shipped a panel hint —
"highlighted when you open the scene" — that Stage 6 is what makes true.

The availability probe is verified against a real server: the panel reports
`Connected: qwen/qwen3-30b-a3b-2507`. The **failure** branches (server stopped,
model not loaded) are unit-tested but not yet exercised live, since doing so
means stopping the operator's server.

All four pre-existing defects listed below are fixed, plus three found during
implementation and review:

5. The metadata-block gate in `SynopsisManager` tested only the *scene* hover
   list, so a beat or backdrop whose own fields were enabled had the whole block
   skipped and never rendered them — a third divergent derivation of the fact
   the extraction exists to consolidate.
6. `onClose` reset the state object directly instead of going through the
   service, leaving the run token untouched, so an in-flight search committed
   into a view that had just cleared it. Invalidation now lives in
   `SearchService.reset()`, behind both `clearSearch()` and `abandonSearch()`.
7. Search matched **matter notes**, which the timeline never draws — the
   searchable==visible rule violated at the item level rather than the field
   level.
8. Search state is global, but `onClose` cleared it whenever *any* timeline
   closed. With two timelines open, closing one left the survivor showing
   highlighted squares and a term in its box that the state no longer agreed
   with. Only the last timeline to close clears now, compared by identity
   because the closing leaf is still enumerated at that point.

Renderability is now one shared predicate, `isRenderedOnTimeline`
(`utils/sceneHelpers.ts`), used by both the render pipeline and search — they
previously answered the same question in two places and could have drifted.
The scope-option change signature is exhaustive by construction
(`Record<keyof TimelineSearchOptions, true>`), so adding an option without
adding it to the signature is a compile error rather than a scope change that
silently stops forcing a re-render.

One non-defect correction: the run's settings-derived inputs were split across
the `await` (AI flag and planetary profile at call time, hover fields after),
and a comment claimed a freeze that holding a `plugin.settings` reference does
not provide — the object is mutated in place. All inputs now resolve at one
instant, immediately before the synchronous matching pass.

Revised after a correctness review — see the Decision log for what changed and
why. The review found four real holes in the first draft (async race, dropped
frontmatter when both scopes are on, stale persisted offsets, and a Cancel that
could not actually cancel); all four are closed below.

## Goal

Today the timeline search box is a single blind text field: type a phrase,
press Enter, and scenes whose **timeline fields** contain that literal phrase
get a yellow number square. Authors have no way to (a) see what is being
searched, (b) search the prose itself, or (c) ask a question the manuscript
answers without using those exact words.

Target: clicking the search control still lets the author type immediately, but
also expands a panel that is visually continuous with the input, exposing:

- **Where to look** — Timeline fields (default on) and/or Scene body.
- **How to look** — literal phrase (current behavior) or **Local LLM assist**,
  which finds phrases *and concepts*. Disabled and grayed when no local server
  is connected, with the reason stated in plain words.

### The organizing rule: searchable == visible

Every scope resolves to something the author can actually see. This is the rule
that decides what belongs in each scope, and it is why "search all frontmatter"
is the wrong feature:

| Scope | What it covers | Where the match becomes visible |
| --- | --- | --- |
| Timeline fields | Scene title + the curated fields + **whatever custom fields the author enabled in hover metadata** | On the timeline, and on hover |
| Scene body | Prose only — the YAML block is excluded | On click, highlighted in the editor |
| *(neither)* | Disabled/hidden YAML fields | Nowhere — so nothing searches them |

The rule cuts across *items* as well as fields. Search only considers items the
timeline actually draws (`isRenderedOnTimeline`, `utils/sceneHelpers.ts`).
Scenes, beats/plots, and backdrops all render — backdrops in their own ring.
Front/back matter notes do not: `SceneDataService` puts them in the scenes array
for manuscript export, and `Precompute` skips them. Matching one produces a hit
that lights up nothing, and inflates both the match count and the
change-detection signature with paths that are never in the DOM.

A match the author cannot see is indistinguishable from a bug: the scene lights
up yellow, they hover, and nothing is highlighted. Hidden YAML is searched by
neither scope for exactly that reason. Body scope is not "everything in the
note" — it is the prose, and its matches are visible the moment the scene opens.

Match presentation does not change: matched scenes get the existing yellow
number square, and hovering a match keeps the existing metadata term
highlighting. New capability is added **behind** that same visual contract.
Additionally, clicking a matched scene opens it with the matching body passages
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
against a **curated field set** — title, synopsis, Character, subplot,
Duration, optionally `currentSceneAnalysis`, the planetary line, and two date
renderings ([`buildTimelineSearchTextFields`, :64](../../../src/services/SearchService.ts#L64)).
Matched paths land in `plugin.searchResults: Set<string>`, then every view
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
from four modes: `AllScenesMode.ts:48`, `MainPlotMode.ts:122`,
`GossamerMode.ts:286,302`, `ChronologueMode.ts` — plus two Zero Draft
`onOverrideOpen` paths (`AllScenesMode.ts:40`, `MainPlotMode.ts:115`). No
highlight state is passed anywhere.

**Hover metadata rendering** — [SynopsisManager.ts:1457-1590](../../../src/SynopsisManager.ts#L1457).
The visible custom-field set is `settings.hoverMetadataFields` filtered to
`.enabled`, resolved **per item type**: scenes use `hoverMetadataFields`,
backdrops use `backdropHoverMetadataFields`, and beats/plots use
`getBeatConfigForItem(settings, beatModel).beatHoverMetadataFields`
([:1467-1472](../../../src/SynopsisManager.ts#L1467)). `HoverMetadataField` is
`{ key, label, icon, enabled }` ([types/settings.ts:484](../../../src/types/settings.ts#L484)).
Values are read by a **local closure** `readFrontmatterFieldValue`
([:1365](../../../src/SynopsisManager.ts#L1365)) that falls back to a
punctuation/case-insensitive key match, then formatted by a second local
closure `formatValue` ([:1487](../../../src/SynopsisManager.ts#L1487)) that
joins arrays with `, `, strips `[[wikilinks]]` to their display name, and
formats dates. Neither closure is exported.

**Frontmatter body extraction** — the canonical helper is
`extractBodyAfterFrontmatter()` ([frontmatterDocument.ts:12](../../../src/utils/frontmatterDocument.ts#L12)):
it prefers Obsidian's `position.end.offset` and falls back to stripping the
first YAML fence by regex. Currently used only by `frontmatterWriteSafety.ts`.

**Local LLM** — `src/ai/localLlm/` is complete and reusable:
`transport.ts` does abortable, size-bounded `/models` probes; `backends.ts`
abstracts ollama / lmStudio / openaiCompatible; `structuredJson.ts` runs a
strict-JSON pipeline honoring `jsonMode` + `maxRetries`; `diagnostics.ts`
`runLocalLlmDiagnostics(plugin, overrides?)` returns reachable /
modelAvailable / basicCompletion / structuredJson — note it accepts **unsaved
overrides**, which matters for cache keying. Settings live at
`aiSettings.localLlm` (default `ollama`, `http://localhost:11434/v1`).

### Pre-existing defects found while mapping

All three are fixed in Stage 1, because each would be amplified by the features
that follow.

1. **Saga scope is under-searched.** `performSearch` calls
   `plugin.getSceneData()`, not `plugin.getTimelineSceneData()`
   ([main.ts:775-797](../../../src/main.ts#L775)). In Saga scope the timeline
   renders every book's scenes but search only scans the active book — matches
   in other books are silently invisible.
2. **The async search races itself.** `performSearch` fires
   `void this.plugin.getSceneData().then(...)` with no generation token
   ([SearchService.ts:137](../../../src/services/SearchService.ts#L137)). A slow
   earlier run resolving after a newer search — or after Clear — mutates
   `searchResults` and re-renders with stale hits. Today the window is small
   because matching is synchronous; with body reads and LLM calls it becomes
   seconds wide.
3. **Change detection ignores the term.** [ChangeDetection.ts:313](../../../src/renderer/ChangeDetection.ts#L313)
   keys on `searchActive` plus the result-path set. Two different terms that
   match the same scenes produce an identical signature, so the SVG is not
   rebuilt and the previous term stays highlighted in the hover metadata.
4. **Enabled custom hover fields are visible but not searchable.**
   `buildTimelineSearchTextFields()` ([SearchService.ts:64](../../../src/services/SearchService.ts#L64))
   hardcodes title / synopsis / Character / subplot / Duration. It never
   consults `settings.hoverMetadataFields`. An author who enables a custom
   field — Place, POV, Mood — sees it on hover and reasonably expects to search
   it, and gets silence. This is the searchable==visible rule already being
   violated today, independent of anything in this plan. Fixed in Stage 1b.

## Interaction design

### Anatomy

```
.rt-book-switcher                      (position: relative — existing)
└── .ert-timeline-search               (is-expanded when panel open)
    ├── button.ert-timeline-search__button
    ├── input.ert-timeline-search__input
    └── div.ert-timeline-search-panel   role="group"  ← NEW
        ├── fieldset .ert-timeline-search-panel__scope   "Search in"
        │   ├── checkbox  Timeline fields    (default on)
        │   └── checkbox  Scene body
        ├── div .ert-timeline-search-panel__assist
        │   ├── checkbox  Local LLM assist   (disabled + grayed when offline)
        │   └── span .…__assist-note         model name, or the offline reason
        └── div .ert-timeline-search-panel__status  aria-live="polite"
            └── "14 scenes matched"  |  "Reading 62 scenes…"  |  [Cancel]
```

Two **independent axes**, not three radio modes: scope is *where* to look
(additive checkboxes — an author can want a name in the metadata *and* in the
prose), assist is *how*. LLM assist × Timeline fields is meaningful on its own
(fuzzy synopsis/character matching without the exact words), so the axes stay
orthogonal rather than collapsing into one list.

**Label wording.** The first scope is labeled *Timeline fields*, not
*Frontmatter*. It covers the scene title, the curated fields (synopsis,
Character, subplot, Duration, dates, planetary line, optional scene analysis),
**and every custom field the author enabled in hover metadata** — i.e. exactly
what is rendered on the timeline and in the hover synopsis. "Frontmatter" would
promise that *any* YAML key is searchable, including the ones the author chose
not to display; a match there would light a scene yellow with nothing visible
to explain why. The label names what the scope actually is: the fields the
timeline shows.

The panel is a child of `.ert-timeline-search`, absolutely positioned at
`top: calc(100% - 1px); left: 0` — the same pattern `.ert-timeline-legend`
already uses ([timeline.css:2152](../../../src/styles/timeline.css#L2152)), so
the header's stacking and clipping are already proven for this. Visual
continuity: while expanded the input flattens its bottom corners and the panel
flattens its top, sharing one border line, so input + panel read as a single
control. The panel needs its own width floor independent of the input's
`clamp(112px, 14vw, 180px)`, and must flip to `right: 0` anchoring when it
would overflow a narrow pane.

### Behavior

| Event | Result |
| --- | --- |
| Focus input, or click the search icon in `search` mode | Panel expands. Typing works immediately — expanding never steals focus from the input. |
| Change any option | Options persist; if a search is already active it re-runs with the new options. |
| `Enter` / icon click | Commit search. Panel stays open so the author can retune. |
| `Escape` | Collapse panel, **return focus to the input**, keep the term and results. Second `Escape` clears the search. |
| Click outside / `focusout` of the whole shell | Collapse panel. **Do not** commit on blur in LLM mode — see below. |
| Clear (`search-x`) | Clear term + results, cancel any in-flight run, collapse panel, keep option selections. |

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
  `Escape` returns focus to the input rather than dropping it to `<body>`.

## Architecture

### Stage 1 — One search state, transactional (refactor, no new features)

Three plugin fields (`searchTerm`, `searchActive`, `searchResults`,
[main.ts:156](../../../src/main.ts#L156)) become one object. Adding scope, assist,
async status, and per-scene evidence to three parallel fields would multiply the
drift surface; consolidating first is what makes every later stage a small diff.

```ts
// src/services/searchState.ts
export interface TimelineSearchOptions {
    timelineFields: boolean;  // default true
    body: boolean;            // default false
    llmAssist: boolean;       // default false; forced false when unavailable
}

export type SearchHitSource = 'timelineFields' | 'body' | 'both';

export interface TimelineSearchHit {
    path: string;
    source: SearchHitSource;
    /**
     * Verbatim body passages that justified this hit — NOT offsets.
     * Offsets go stale the moment the author edits the scene; ranges are
     * recomputed against the current file at click time (Stage 6).
     */
    evidence: string[];
    /** LLM assist only: the model's one-line justification. */
    reason?: string;
}

export type TimelineSearchStatus = 'idle' | 'running' | 'ready' | 'error';

export interface TimelineSearchState {
    /** The committed term — the one the results actually correspond to. */
    term: string;
    options: TimelineSearchOptions;
    active: boolean;
    status: TimelineSearchStatus;
    /** Verbatim failure text. Never a generic "search failed". */
    error?: string;
    hits: Map<string, TimelineSearchHit>;
}
```

**Every search runs as a transaction.** `SearchService` holds a monotonic
`runId`. A run freezes its term, options, and scene set at start, accumulates
hits into a **private** map, and commits — atomically replacing
`state.hits`, `state.term`, and `state.status` — only if `runId` is still
current. A superseded or cancelled run discards its work and touches nothing.
This is what makes "Cancel leaves previous results intact" true rather than
aspirational, and it closes pre-existing defect 2.

**Change detection gains the committed term** alongside `active`, `options`,
and the hit-path set, closing pre-existing defect 3.

**No compatibility getters** for the old three fields — per `code-doctrine.md`
("prefer deletion over accommodation"), every reader migrates in the same commit:

| File | What changes |
| --- | --- |
| `src/main.ts:156-157` + `searchResults` decl | Replaced by `searchState` |
| `src/services/SearchService.ts` | Rewritten around the state object + runId; `getSceneData` → `getTimelineSceneData` (Saga fix) |
| `src/view/TimeLineView.ts:2100-2177, 2649, 2676, 2741-2744, 2860-2861` | Read `searchState` |
| `src/view/interactions/SearchInteractions.ts:13-22, 159-173` | `SearchView` interface + `hits` lookup |
| `src/utils/sceneHelpers.ts:202-204, 288` | `isSearchMatch` from `hits` |
| `src/SynopsisManager.ts:1805` | Guard reads `searchState` |
| `src/renderer/ChangeDetection.ts:47, 112, 242, 313` | Track `active`, `options`, committed `term`, hit-path set |
| `src/debug/snapshot.ts:28, 88` | Snapshot the state object |
| `ChangeDetection.test.ts`, `Precompute.test.ts` | Fixture updates |

Ship Stage 1 alone and verify: same matches, same yellow squares, same hover
highlighting — plus Saga scope searching all books, no stale-run clobbering,
and term-change forcing a re-highlight.

### Stage 1b — Searched fields == rendered fields

Small, self-contained, and shippable on its own: it fixes pre-existing defect 4
with no UI change. An author who enabled a custom hover field can search it the
day this lands, panel or no panel.

The problem is that the visible set and the searched set are computed in two
places that do not know about each other. The renderer resolves it from
settings through two **unexported local closures** inside `SynopsisManager`;
search hardcodes a different list. That is two sources of truth for one fact.

Extract into `src/utils/hoverMetadata.ts`:

```ts
/** Resolve the enabled hover-metadata fields for an item, per item type. */
export function resolveHoverMetadataFields(
    settings: RadialTimelineSettings, scene: TimelineItem
): HoverMetadataField[];

/** Punctuation/case-insensitive frontmatter key lookup. */
export function readFrontmatterFieldValue(
    fm: Record<string, unknown> | undefined, key: string
): unknown;

/** Render a frontmatter value exactly as the hover synopsis displays it. */
export function formatHoverMetadataValue(value: unknown): string;
```

Move the bodies verbatim from `SynopsisManager.ts:1365`, `:1467-1472`, and
`:1487`; `SynopsisManager` then imports them instead of defining them. No
behavior change on the render side — this is a pure extraction, verifiable by
the hover synopsis looking identical.

`buildTimelineSearchTextFields()` then appends, for each enabled field,
`formatHoverMetadataValue(readFrontmatterFieldValue(scene.rawFrontmatter, field.key))`.

**Formatting must go through the same function**, not `frontmatterValueToText`.
The author sees `Diego` (wikilink-stripped from `[[Place/Diego]]`); if search
matched the raw value they could match on `Place`, highlight the scene, and
find nothing highlighted on hover — the same invisible-match failure this rule
exists to prevent. Search the string the author is looking at.

Disabled fields are not searched. Toggling a hover field on makes it searchable
in the same action — one control, one consequence.

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
- Options persist in plugin settings as
  `settings.timelineSearch: { schemaVersion: 1, timelineFields, body, llmAssist }`
   — schema-stamped and validated on load, with unknown/malformed values
  replaced by defaults rather than trusted. This is a view preference and never
  touches scene frontmatter; scene YAML belongs to the author.
- At this stage the assist checkbox renders disabled with "Checking…" and the
  scope checkboxes drive nothing but their own persistence. Timeline-field
  search still works exactly as before.

**Metadata highlight gating.** `applySearchTermHighlightsInRoot()` runs only
when `options.timelineFields` is on **and** assist is off. A body-only search
must not paint highlights onto metadata it never searched, and under assist the
author's query words generally do not appear in the text at all.

### Stage 3 — Scene body search (no LLM)

New `src/services/SceneBodyIndex.ts`:

```ts
interface SceneBodyEntry {
    path: string;
    mtime: number;
    /** Body text with frontmatter stripped, via extractBodyAfterFrontmatter. */
    body: string;
}
```

- Reads with `vault.cachedRead`, then `extractBodyAfterFrontmatter(raw, cache)`
  ([frontmatterDocument.ts:12](../../../src/utils/frontmatterDocument.ts#L12)) —
  the canonical helper, which already handles a missing metadata cache by
  stripping the YAML fence rather than falling through to offset `0` and
  treating frontmatter as prose.

**Body scope does not open the door to the whole note.** The YAML block is
excluded by construction — `extractBodyAfterFrontmatter` slices from the
frontmatter's end offset, and on a missing metadata cache strips the leading
`---…---` fence by regex. Body means prose. So the two scopes are disjoint:
timeline fields cover the *visible* metadata, body covers the prose, and a YAML
key the author chose not to display is searched by neither. Enabling Scene body
never silently starts matching hidden metadata.

The one edge: a scene whose frontmatter is *malformed* enough that Obsidian
fails to parse it **and** the fence does not match the strip regex. That file's
YAML text falls through into `body`. This is acceptable and self-explaining —
the author is already seeing that raw YAML as literal text in their editor, so
a match in it is still a visible match. Worth a debug log, not a guard.
- **No offsets are stored.** Hits carry the matched passage text; ranges are
  computed against the current file when the scene is opened (Stage 6). An
  offset captured at search time is wrong the moment the author edits the
  scene, and a highlight landing on the wrong words is worse than none.
- Invalidated on `mtime` change and on vault `modify` / `rename` / `delete`.
- Built lazily on the first body search, over the same scene set the search
  transaction froze. Entry count and total chars logged; if a bound is ever
  applied it is reported in the status line — never a silent cap.

Matching: case-insensitive literal `indexOf` sweep collecting every occurrence
— not a regex, so an author's apostrophes, parentheses, and em dashes need no
escaping and mean exactly themselves. This deliberately matches the existing
`containsWholePhrase` semantics, so switching scope changes *where* the plugin
looks, never *what counts as a match*. Each occurrence is stored as the matched
passage plus a short surrounding window, which is what Stage 6 re-locates.

When both scopes are on, a scene matching either is a hit, and `source` records
which side (or `both`) produced it.

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
calls** — so it stays fast enough for a UI affordance.

**Cache key = `enabled | backend | baseUrl | defaultModelId`**, ~60s TTL.
Keying on settings identity rather than a bare timestamp matters because
`runLocalLlmDiagnostics()` accepts unsaved overrides
([diagnostics.ts:35](../../../src/ai/localLlm/diagnostics.ts#L35)) — a
Settings-side "test this other URL" must never poison the panel's view of the
saved configuration. Write-through from diagnostics happens **only** when that
run used canonical settings with no overrides.

**Single source of truth.** These two checks are exactly the first two checks
of `runLocalLlmDiagnostics()` ([diagnostics.ts:53-60](../../../src/ai/localLlm/diagnostics.ts#L53)).
Rather than duplicate them, `diagnostics.ts` is refactored to call the shared
probe and continue with its deeper completion tests. Settings → AI and the
search panel then cannot report contradictory connection states.

Panel wiring: on expand, `getLocalLlmAvailability()`; available → checkbox
enabled, note reads the model id; unavailable → checkbox disabled + forced off,
note reads the reason.

### Stage 5 — Concept search

New `src/services/ConceptSearchService.ts`.

1. **Gate.** Re-check availability with `force: true` at commit. Unavailable →
   status shows the reason and the run does not start. **No cloud fallback** —
   both because manuscript prose must not silently leave the machine and
   because silent degradation is against `fallback-policy.md`.
2. **Corpus — union, not either/or.** Every selected scope contributes. With
   both boxes checked, each scene's payload is its timeline fields
   (`buildTimelineSearchTextFields()`) **concatenated with** its body text from
   `SceneBodyIndex`, with the two sections labeled so the model's quotes can be
   attributed back to the right `source`. Checking a second box must never
   remove a source of matches.
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
       "required": ["scene_id", "reason", "quotes"],
       "properties": {
         "scene_id": { "type": "string" },
         "reason":   { "type": "string" },
         "quotes":   { "type": "array", "items": { "type": "string" } }
       } } } } }
   ```

   No `confidence` field. Local-model self-scored confidence is uncalibrated —
   it would be a number the UI could not honestly act on. **Verified evidence
   is the gate.** The prompt instructs: return only scenes that genuinely bear
   on the query, and copy each quote **verbatim and short (≤15 words)** from
   the scene text.
5. **Verify every quote exactly** against the indexed text — a plain substring
   test, no whitespace normalization. Normalized matching needs a reliable
   normalized→raw offset map to be usable for highlighting, and that map is a
   bug farm; the ≤15-word instruction is what keeps exact-match recall
   acceptable instead. Unverifiable quote → dropped. Scene with zero verified
   quotes → dropped entirely. A highlight the text cannot support is worse than
   no highlight.
6. **Report the drops.** Status line: `14 scenes · 3 model claims dropped (no
   verbatim match)`. Silent truncation would read as full coverage.
7. **A failed chunk fails the run.** If any chunk errors or fails JSON
   validation after its retries, the whole transaction is abandoned, the status
   shows the verbatim error, and the previously committed results stay on
   screen. Publishing the surviving chunks would present a partial sweep as a
   complete one.
8. **Cancel, defined honestly.** Cancel discards the pending transaction and
   schedules no further chunks; previously committed results remain. It does
   **not** abort the HTTP request already in flight — local completions go
   through `requestUrl` + `withTimeout` with no `AbortSignal`
   ([transport.ts:394](../../../src/ai/localLlm/transport.ts#L394)); the lone
   `AbortController` in that file guards the `/models` probe
   ([:285](../../../src/ai/localLlm/transport.ts#L285)). Adding a real abort
   means moving completions from `requestUrl` to `fetch`, which reintroduces
   the CORS exposure `requestUrl` exists to avoid — a separate, deliberate
   change, not a rider on this feature. The UI says "Finishing current chunk…"
   rather than claiming an instant stop. Progress shows `chunk 3/7`.

Verified hits then flow into `searchState.hits` and render through the
**existing** yellow-number-square path — no new render code.

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

Ranges are **computed at click time**, not carried from the search: read the
file, locate each stored evidence passage in the current content, and build
ranges from what is there now. Evidence that no longer appears (the author
edited it away) is skipped silently — the scene still opens.

Implemented via `leaf.openFile(file, { active: true, eState: { match: highlight } })`
— the same ephemeral state Obsidian core search uses to flash-highlight a
result. `OpenViewState.eState` is typed `Record<string, unknown>` in
`obsidian.d.ts`, so this needs no cast and no `// SAFE:` comment.

**Both branches of `openOrRevealFile` must carry it.** The existing-leaf branch
currently calls `setActiveLeaf()` and returns
([fileUtils.ts:30-33](../../../src/utils/fileUtils.ts#L30)) — it never calls
`openFile`, so a highlight would silently do nothing whenever the scene is
already open, which is the common case. That branch becomes
`existingLeaf.openFile(file, { active: true, eState: { match } })`.

Call sites: the four mode click handlers (`AllScenesMode.ts:48`,
`MainPlotMode.ts:122`, `ChronologueMode.ts`, `GossamerMode.ts:286,302`)
**and** the two Zero Draft `onOverrideOpen` callbacks
(`AllScenesMode.ts:40`, `MainPlotMode.ts:115`) — otherwise the highlight
vanishes for exactly the authors who use Zero Draft mode. Each passes the hit's
evidence when the clicked path is in `searchState.hits`; otherwise nothing, and
behavior is identical to today.

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
- **Transaction:** a stale run resolving after a newer one commits nothing; a
  run resolving after Clear commits nothing; Cancel preserves prior hits.
- Body matcher: multiple hits per scene, regex metacharacters treated
  literally, case-insensitivity, empty body.
- `extractBodyAfterFrontmatter` integration: file with frontmatter, without,
  with an absent metadata cache, CRLF line endings. **Body never contains a
  well-formed YAML block** — assert on a fixture whose frontmatter holds a
  distinctive token that body search must not match.
- `resolveHoverMetadataFields`: scene / beat / backdrop each resolve their own
  list; disabled fields excluded.
- Searched set == rendered set: a scene with a custom `Place` field is
  unsearchable while the field is disabled and searchable once enabled, with no
  other change.
- `formatHoverMetadataValue` parity: searching the displayed string (`Diego`)
  hits; searching a raw-only fragment (`Place/`) does not.
- `SceneBodyIndex` invalidation on mtime change.
- **Scope union:** both boxes checked yields the union of timeline-field and
  body hits, with `source` correctly attributed.
- `availability`: each failure branch yields its own specific reason; an
  overrides-based diagnostics run does not write through to the cache.
- Quote verification: exact matches accepted, near-misses rejected, a scene
  losing all quotes is dropped; one failing chunk abandons the whole run.
- Evidence → range recomputation: passage present, passage edited away,
  passage now appearing twice.
- `ChangeDetection`: option change, term change **with an identical hit set**,
  and hit-set change each force a re-render.

Manual, in the sample vault (`docs/engineering/sample-vaults.md`):
- Timeline-field search matches the pre-change result set exactly (regression).
- Saga scope now matches across all books.
- Panel keyboard path, `Escape` twice, focus returns to the input, outside-click
  collapse.
- Panel in a **narrow split pane** — no clipping, no horizontal overflow,
  right-anchor flip works.
- Assist grayed with server stopped; the note names the actual reason; enables
  within one expand cycle after the server starts.
- Concept query with no literal overlap ("a betrayal the reader sees coming")
  highlights plausible scenes; clicking one highlights the quoted passage —
  including when the scene is **already open in another tab**, and in Zero
  Draft mode.
- Cancel mid-run leaves prior results intact.

## Risks

| Risk | Mitigation |
| --- | --- |
| `eState.match` behaves inconsistently across reading/live-preview/source | Verify in Stage 6 before wiring all six call sites; CM6 extension is the pre-decided branch |
| Stage 1 refactor touches 10 files and could regress search silently | Ship Stage 1 alone with no behavior change; regression check is "identical result set" |
| Local models return confident nonsense | Mandatory exact verbatim quote verification; unverifiable claims dropped and counted in the UI; no confidence field to lend false authority |
| Exact-match verification drops legitimate quotes | ≤15-word verbatim instruction in the prompt; drop count is surfaced, so a high drop rate is visible rather than hidden |
| Cancel cannot stop an in-flight local completion | UI states what it actually does; real abort tracked as separate transport work |
| Body index memory on large manuscripts | Scoped to the frozen scene set, `cachedRead`-backed, mtime-invalidated; size logged |

## Making a long sweep usable (post-Stage 5)

A manuscript-wide concept run takes minutes, and the first build held every
result until the end — so the author watched an unchanged timeline with no way
to tell work from a hang. Two changes, neither of which narrows the sweep:

- **Matches publish as they are found.** Status stays `running` with progress
  and Cancel while the timeline fills in scene by scene, and the running count
  shows in the status line.
- **The likeliest scenes are read first**, ordered by how many of the query's
  content words a scene literally contains. This is **order, not a filter** —
  filtering on keywords would defeat the point, since concept search exists to
  find scenes that never use the author's words. Manuscript order is preserved
  within a score band.
- **Cancelling keeps what was found**, reported as "Stopped early — N found so
  far" so a partial sweep is never mistaken for a complete one. A mid-sweep
  failure likewise keeps what was already verified.

Verified live: 9 found at scene 23, 17 at scene 38, Cancel at scene 48 leaving
19 on the timeline.

**Not built, and probably not needed:** act-based scope restriction. Ordering
plus streaming gives first results in seconds, which was the actual complaint;
a scope control would add UI for a problem that is now largely solved. Revisit
if manuscripts get much larger than ~100 scenes.

## What live testing changed

Three attempts, three distinct failures, each one a design assumption that only
a real server could falsify:

1. **Context length.** Multi-scene batches of ~16k tokens were rejected outright
   ("the number of tokens to keep from the initial prompt is greater than the
   context length"). A local model's window is set when the model is loaded,
   outside Obsidian, and cannot be discovered.
2. **Timeout.** Smaller batches still timed out. Output was unbounded, so a
   reasoning model spent its whole budget thinking before answering. Replies are
   now capped.
3. **Malformed JSON.** Probing the server directly showed the model returning
   structurally broken output — a duplicated, half-closed `quotes` key. The
   cause was `toWireResponseFormat` sending LM Studio a permissive
   `{type:'object'}` placeholder instead of the caller's real schema. Sending
   the actual schema produced valid output on the identical prompt.

The resolution was **one scene per request**, which removes the dependence on an
undiscoverable window entirely, keeps each call ~1.5s, isolates a failure to one
scene, and asks the model an easier question ("does this scene bear on the
query" rather than "which of these six"). Scenes too long to send whole are
split into overlapping windows so nothing is lost at a seam; progress still
counts scenes.

## Open decisions

None. All three prior questions are closed — see the Decision log.

## Decision log

- **2026-08-07** — Scope modeled as two independent axes (where × how), not
  three exclusive modes: LLM assist over timeline fields is independently
  useful, and authors legitimately want metadata *and* body at once.
- **2026-08-07** — No cloud provider path for body/concept search, by design.
- **2026-08-07** — Search state consolidated into one object before any feature
  work, with no compatibility shim for the three old fields.
- **2026-08-07** *(review)* — Every search is a transaction with a run token.
  The pre-existing race is latent today and becomes seconds-wide with async
  scopes; "Cancel preserves prior results" is unimplementable without it.
- **2026-08-07** *(review)* — Hits store verbatim evidence text, not offsets.
  Offsets captured at search time go stale on the next edit; ranges are
  recomputed against the current file at click time.
- **2026-08-07** *(review)* — Concept corpus is the **union** of selected
  scopes. The first draft used body-or-fields, which silently dropped metadata
  matches when the author enabled a second scope.
- **2026-08-07** *(review)* — `confidence` dropped from the schema entirely.
  Uncalibrated self-scoring cannot be acted on honestly; verified evidence is
  the only gate. Quote verification is exact-only for V1 — normalized matching
  needs a normalized→raw offset map that is not worth its bug surface.
- **2026-08-07** *(review)* — Cancel is defined as "discard the transaction,
  schedule no more chunks." Local completions use `requestUrl` with no
  `AbortSignal`, so claiming instant abort would be a lie in the UI. Real
  abort = moving completions to `fetch`, tracked separately.
- **2026-08-07** *(review)* — Saga assist searches the **full visible Saga
  scope**. The earlier active-book-only proposal would have re-created the
  exact scope inconsistency Stage 1 exists to fix; chunking and Cancel are the
  right tools for the workload, and local inference has no per-token cost.
- **2026-08-07** *(review)* — Label is *Timeline fields*, not *Frontmatter* —
  the searched set is curated, and the broader promise would read as a bug to
  any author with custom fields.
- **2026-08-07** *(Eric)* — **Searchable == visible** is the organizing rule,
  and it closes the "widen to all frontmatter?" question with a *no*. The
  searched metadata set is not a hardcoded list; it is *whatever the timeline
  renders* — scene title, curated fields, and the custom fields the author
  enabled in hover metadata. Searching hidden YAML would light a scene yellow
  with nothing visible on hover to explain it.
- **2026-08-07** *(Eric)* — Body scope is **prose only**, not "the whole note".
  `extractBodyAfterFrontmatter` excludes the YAML block by construction, so the
  two scopes are disjoint and enabling Scene body never quietly starts matching
  hidden metadata. Body still satisfies the visibility rule — its matches are
  visible on click, highlighted in the editor.
- **2026-08-07** *(Eric)* — Consequence: the hover-field resolver and value
  formatter move out of `SynopsisManager`'s private closures into a shared
  module (Stage 1b), so the rendered set and the searched set are one fact in
  one place. Search must match the *displayed* string (`[[Place/Diego]]` →
  `Diego`), not the raw value, or it reintroduces invisible matches.
- **2026-08-07** *(review)* — Corrected a bad citation in the first draft:
  `manuscript.ts:754` and `referenceIdBackfill.ts:58` do **not** establish a
  frontmatter-offset precedent (they use `extractCountableBodyText` and
  `prepareFrontmatterRewrite`). The canonical helper is
  `extractBodyAfterFrontmatter`.
