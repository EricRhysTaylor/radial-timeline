# Parts as First-Class Markers — Implementation Plan

**Goal:** decouple publishing **Parts** from narrative **Acts**. A Part becomes an explicit
author-placed marker on a scene — like `Chapter` — with its own title and epigraph. `Act` returns
to being purely narrative-analytic. Layout keeps owning appearance.

**Origin:** GitHub issue #30 (reporter `therisingtithes`, 2026-07-21). Decision history and the
rejected alternatives live in Command Center →
`Parts as first-class markers — proposed rearchitecture.md` (Rev 5). **This plan is
self-contained**; it does not need that document to execute.

**Status:** architecture closed, D1–D4 recorded. Not started.

---

## 1. Current behavior (verified @ `889f8ed2`)

| Concept | Source of truth | Author sets it via |
|---|---|---|
| **Chapter** | `Chapter:` scene frontmatter (`src/utils/timelineChapters.ts:4`) | right-click → Set chapter… (`src/view/interactions/SceneContextMenu.ts:364`) |
| **Part** | **derived** — each scene's `Act:` field (`src/utils/manuscript.ts:951`) | nothing; inferred |

`src/utils/manuscript.ts:1313` emits `\rtPart{Roman}{quote}{attr}` **every time the `Act:` value
changes** walking scenes in manuscript order — not once per unique Act. The numeral comes from the
act number, so `1,1,2,2,1,1` emits **Part I, Part II, Part I**.

Only `usesModernClassicStructure` layouts print Parts — today just **Signature**
(`src/utils/pandocBundledLayouts.ts:216-226`, `tier:'pro'`). Epigraph text lives in
`book.layoutOptions[layoutId].actEpigraphs[]` — authorial content keyed by layout id, orphaned on
layout switch.

### Why this is wrong

`Act` serves two different facts. Act = narrative partition (drives ring, beats, Gossamer,
Progress; mandatory; min 3). Part = publishing division (optional; arbitrary count; most books
have none). Forcing them 1:1 makes a 3-act/2-part or 3-act/5-part book **unrepresentable**, and
Parts can never be titled.

---

## 2. Decisions

### D1 — Marker representation: `Part: true | <title>`

One author-facing field. No second sentinel property.

| Frontmatter | Resolves to |
|---|---|
| key absent | no marker |
| `Part:` (empty) | no marker |
| `Part: false` | no marker — treated as absent |
| `Part: true` (bare boolean) | marker, **untitled** — numeral only |
| `Part: "true"` (quoted) | marker, titled `"true"` |
| `Part: The Crossing` | marker, titled |

**Untitled must work**: every existing Signature book has numeral-only parts, so a
"non-empty string = marker" scheme (the `Chapter` pattern) cannot represent them.

The resolver takes an **uncoerced `unknown` scalar** — the value as it arrives, from either
Obsidian's metadata cache (`item.rawFrontmatter`, timeline path) or `parseYaml` (export path). It
must not re-parse YAML per call site and must not stringify before testing; the boolean-vs-string
distinction is the entire mechanism. **Only boolean `true` and non-empty strings create markers**
— numbers, arrays, objects, `false`, empty do not. YAML `yes`/`no` arrive as strings and are
therefore titles.

Return `{ titled: boolean, title?: string }` — never `string | undefined`, which would repeat
`readSharedChapterTitle`'s empty-collapses-to-absent behavior (`src/utils/timelineChapters.ts:21-32`).

Clearing a marker **deletes the key**, never blanks it.

### D2 — Re-entrant Act books are blocked at migration

Repeated act-derived numerals are malformed structure, never auto-preserved. Report, write
nothing, direct the author to Set part….

Repair works **only because any author-owned `Part:` marker disables act derivation for that book
entirely** (§5.2). The author's Acts may stay re-entrant forever — Acts are no longer the part
authority. Without that rule the migration re-blocks on the same act sequence and repair loops.

### D3 — Markers and placards are free/core; printing stays layout/tier-governed

`Part:` field, Set part… modal, resolver, and **P / P-C placards** ship to all users. Signature
remains Pro; its Part typography is unchanged.

### D4 — A central optional-managed scene-property registry

On-demand insertion alone is **not** sufficient. A key in no template is reported as extra:

```ts
// src/utils/yamlAudit.ts:412
const extraKeys = noteKeys.filter(k =>
    !allTemplateKeys.has(k) && !excludeKey(k) && !isToleratedAiKey(k)
);
```

Unregistered Part fields would surface as *"Not managed by Radial Timeline"*
(`BeatPropertiesSection.ts:4544`, `SceneNormalizerSection.ts:455`) and fall outside
`knownKeysForSafety` (`yamlAudit.ts:342`). `insertMissingChapterFrontmatter`
(`SceneContextMenu.ts:158`) works only because `Chapter` is already in the base template
(`src/settings/defaults.ts:146`).

`sceneAiSchemaKeys` (`yamlAudit.ts:334-335`) proves "known but not required" is legitimate, but it
is an **audit-local exception governing nothing else — do not extend it.** Build one registry.

The registry must:
- Declare `Part`, `Part Epigraph`, `Part Epigraph By`.
- Make them known to **audit and safety scanning**.
- Give them **canonical ordering** and insertion positions.
- **Protect them from deletion** as foreign fields.
- **Exclude** them from missing-field checks, backfill, and ordinary scene creation.
- Be **restricted to author-facing fields**. Operational state stays forbidden from scene YAML.

**Doctrine (replaces "templates define managed fields"):**

> Templates define fields seeded into new notes. The optional-managed registry defines
> author-facing fields Radial Timeline may insert through an explicit author action or approved
> migration. Both are RT-owned schema; optional-managed fields are absent by default.

---

## 3. Target data model

```yaml
Class: Scene
Act: 2                        # narrative structure — unchanged, no longer double-booked
Part: The Crossing            # inserted on demand; absent on ordinary scenes
Part Epigraph: "…"            # inserted on demand
Part Epigraph By: T.S. Eliot  # inserted on demand
Chapter: Boy with a Skull     # unchanged
```

**Numbering: sequential by marker order** (I, II, III…), not act-derived. Agrees with current
output for monotonic books; non-monotonic books are blocked rather than silently renumbered.

Scenes before the first marker belong to no part — same shape as `Unchaptered`. A prologue ahead
of Part I is legal.

### Layout spec addition

```ts
parts: {
    mode: 'off' | 'roman' | 'arabic' | 'word';
    title?: boolean;   // NEW — does this layout print the part title?
    pageBreak: boolean;
    epigraph: boolean;
    epigraphPlacement?: 'inline' | 'own-page';
    openAny?: boolean;
}
```

This is a **persisted** shape. Bump `DESIGNED_STYLE_SPEC_VERSION` (currently `2` —
`src/publishing/designedStyle.ts:34`), normalize stored specs with `title: false`, and update the
wizard, spread validation, pictogram previews, and property tests. Signature sets `title: true`.

---

## 4. LaTeX contract

`\rtPart` goes 3 args → 4: `{numeral}{title}{quote}{attr}`
(`src/publishing/designedStyleFragments.ts:350`).

The title block is guarded by `\ifstrempty` like the existing optional args, so **untitled parts
typeset identically to today**.

**Acceptance criterion is visual and semantic equivalence via golden fixtures — NOT
"byte-identical PDF".** Changing arity changes the generated `.tex`, and PDFs carry
nondeterministic metadata regardless.

### Already-installed templates

Import-time validation currently only checks the macro *exists* (`src/utils/templateImport.ts:62`),
which does nothing for templates already in users' vaults. Required:

- **Export-time compatibility validation** — inspect the resolved template's `\rtPart` arity
  before compiling.
- **Blocked state with a repair path** on mismatch ("this template defines a 3-argument
  `\rtPart`; re-import the bundled layout or update the macro"). Fail clearly — no silent
  fallback, no degraded render.
- Tighten import-time validation for new imports.

Bundled templates are generated from specs and update themselves.

---

## 5. Migration

### 5.1 Requirements

1. **Replay the real emission algorithm** — boundary at every act-value *change*, exactly as
   `manuscript.ts:1313` does. Not "first scene of each unique act."
2. **All books**, not only those currently on a Part-capable layout.
3. **Run after vault indexing**; be **idempotent**; **schema-stamp** what it wrote.
4. **Preview + backup before batch mutation.** This writes author files.
5. **Report partial failures per file** — never abort silently or claim success.

### 5.2 Per-book classification

Checked in this order:

| Case | Action |
|---|---|
| **author-owned `Part:` marker present** (per journal, §5.4) | act derivation **never applies**; marker set *is* the structure. Migrate epigraphs (§5.3), stamp. |
| no markers, **monotonic** acts (`1,1,2,3`) | derive markers; sequential numerals match act-derived numerals |
| no markers, **re-entrant** (`1,2,1`) | **block** (D2) — report offending scenes, write nothing |
| no markers, **missing/malformed `Act:`** | block, list offending scenes |

"Author-owned" is decided by the journal, **not by mere presence**.

### 5.3 Epigraph migration is never guessed

Legacy epigraphs are indexed by act index (`src/publishing/spreadValidationContext.ts:167`). For
author-placed markers that index has no reliable correspondence. **Propose** a mapping in the
preview and require acceptance; if no unambiguous proposal exists, block the book on that item
rather than writing partially. Detect the same book carrying conflicting epigraphs under multiple
layout ids and surface both — never pick one.

### 5.4 Recovery — the migration journal

**The hazard:** §5.2's first rule collides with partial failure. If a run writes two of three
planned markers and dies, a naive rerun sees markers, classifies the book as author-resolved,
skips derivation, and **freezes a half-migrated book into a structure that looks deliberate.**
Presence is not provenance.

**Fix:** a **vault-local sidecar migration journal** holding the preflight plan and per-book
progress. **No provenance field goes into scene YAML** — provenance is operational state, and
scene YAML stays author-only.

The preflight plan is written **before any scene mutation**, so every marker the migration later
writes is attributable.

| Journal state | Meaning | Action |
|---|---|---|
| marker recorded as pre-existing at preflight | author-owned | skip derivation (case 1) |
| journal absent for this book | never attempted | classify normally |
| journal present, book incomplete | crashed mid-write | **resume or restore** — never reclassify |
| journal complete + stamped | done | no-op |

Only monotonic books are provably output-neutral. That is the honest scope of the guarantee.

---

## 6. UX

**Right-click scene → Set part…**, mirroring Set chapter…. Content is authored in the modal; the
template is never where you go to write content.

```
┌─ Part · starts at "The Crossing" ─────────────────────┐
│  Set part marker                                      │
│                                                       │
│  ( ) Untitled — numeral only                          │
│  (•) Titled     [ The Crossing              ]         │
│                                                       │
│  Epigraph (optional) [                           ]    │
│  Attribution         [                           ]    │
│  ⚠ Standard won't print epigraphs — saved anyway.     │
│                                                       │
│  ── Current part containers ───────────────────       │
│  ▣ Part I  · The Gathering    Scenes 1–14   (14)      │
│  ▣ Part II · The Crossing     Scenes 15–31  (17)      │
│                                                       │
│  ── How Signature prints parts ────────────────       │
│  Roman numeral — inline epigraph                      │
│                          Edit in layout settings →    │
│                                                       │
│              [Save part]  [Clear part]  [Cancel]      │
└───────────────────────────────────────────────────────┘
```

1. **Untitled is a first-class choice**, not an empty text box.
2. **Epigraph fields are always shown** — never hidden by layout capability. Warn when the active
   layout won't print them; save regardless. Content is layout-independent.
3. **Container list** reused from the chapter modal.
4. **Presentation strip** reuses `describeParts()` — currently **private** and returning
   `"Act opener — Roman numeral — inline epigraph"` (`src/publishing/layoutVisuals.ts:231`). Export
   it, rename to Part terminology, extend for `title`.
5. **"Edit in layout settings →" is a link**, not an inline editor.
6. **Saving is never gated on layout or tier.**

### Timeline

Remove the `layoutSupportsPartMarkers` gate from *rendering*
(`src/renderer/TimelineRenderer.ts:133`); keep it for print decisions only (D3).

`buildNarrativePartMarkers` must be **rebuilt on marker data**, not tweaked. Every input to the
current tooltip is layout-scoped (`TimelineRenderer.ts:193-202`): it opens with `layoutName`,
takes the label from the act segment index, and reads epigraphs from `book.layoutOptions[layoutId]`.
Build from marker data first (`Part II · The Crossing`, epigraph from the scene), then append a
print-status line for **every** layout state:

| Selected layout | Appended status |
|---|---|
| none | *(no status line)* |
| Standard / Classic | "Standard does not print Parts." |
| Signature | the printing treatment that applies |

Limiting status to Part-printing layouts hides the useful truth precisely from the free/Standard
users who need it.

`showChapterMarkers` gates both chapter and part placards (`TimelineRenderer.ts:729`). Renaming it
is a **persisted-settings schema change** — rename the **UI label only**, keep the internal key.

---

## 7. Work sequence

### Phase 0 — user-visible only, independently shippable

- Discoverability line in Set chapter… explaining how Parts work today.
- UI label rename for the chapter-markers setting (label only).

**Phase 0 does not address issue #30.** It improves discoverability; it does not deliver
first-class Parts and does not decouple Parts from Acts.

### Phase 1 — one release, in this order

1. **D1 resolver + D4 registry.** Pure resolver, `{titled, title?}`, uncoerced `unknown` input.
   Registry wired to audit, safety, ordering, insertion, deletion protection, creation/backfill
   exclusion.
2. **Macro compatibility policy** — 4-arg `\rtPart`, export-time arity validation, blocked state.
3. **Designed-spec version bump** — `parts.title`, spec normalization, wizard/validation/preview
   updates.
4. **Migration** — preflight journal, classification, epigraph mapping proposals, preview,
   backup, resume/restore, stamping.
5. **Cut over** export and timeline to explicit markers; **delete** act-derived emission
   (`manuscript.ts:1313-1321`) and `actEpigraphs` storage.
6. **Surfaces** — Set part… modal, layout-independent placards, rebuilt tooltips, onboarding
   Part-identity preservation.

Splitting 1–5 across releases creates a dual path, which repo doctrine forbids.

**Onboarding note:** PART detection already exists — `src/onboarding/adapters/singleFileAdapter.ts:76`
matches `PART` alongside `BOOK`/`CHAPTER`/`CANTO`. The missing work is that a detected PART is
consumed as an ordinary scene division and its identity discarded. Preserving it is only
observable once markers exist, so it belongs here, not in Phase 0. Scrivener folders remain
act-only (`src/onboarding/adapters/scrivenerAdapter.ts:401`, matches `/ACT[ _-](\d{1,2})/`).

---

## 8. Test gates

Baseline: 111 targeted tests across export, layouts, chapters, normalization, and onboarding pass
at `889f8ed2`.

- **Resolver (D1):** bare `true` / quoted `"true"` / `false` / empty / absent / ordinary title /
  number / array / object / `yes` / `no`. Run the whole table against **both** sources — metadata
  cache and `parseYaml` — since only the second is a YAML parse.
- **Schema (D4):** absent Part keys produce no `extraKeys` entry, no "Not managed by Radial
  Timeline" surface, and sit inside `knownKeysForSafety`; present keys get canonical ordering,
  survive foreign-field deletion, and are skipped by backfill and creation.
- **Migration:** author-markers-present (derivation skipped), monotonic derivation, re-entrant
  (blocked, no partial writes), re-block resolution after markers added, missing-Act,
  multi-layout epigraph conflict, mapping proposal + acceptance, idempotency, partial failure.
- **Journal (§5.4):** crash after partial write → rerun **resumes**, never reclassifies as
  author-resolved; pre-existing markers survive as author-owned; complete+stamped is a no-op;
  journal absent classifies from scratch.
- **Golden `.tex` fixtures:** untitled parts before/after the arity change.
- **Export-time template arity validation** and its blocked state.
- **Spec normalization** version 2 → 3.
- **Placards (D3):** render with no layout, a non-Part layout, and Signature; tooltip built from
  marker data in all three.

---

## 9. Traps

Each of these was gotten wrong at least once during design. Do not re-derive them.

1. **"Byte-identical PDF" is not achievable or required.** Arity changes the `.tex`; PDFs carry
   nondeterministic metadata. Use golden fixtures. → §4
2. **Migration is not "first scene of each act."** Export emits on every act *change*. → §5.1
3. **Untitled parts must be representable.** The `Chapter` non-empty-string pattern cannot
   migrate existing Signature books. → D1
4. **On-demand insertion does not exempt a key from `extraKeys`.** `Chapter` escapes only because
   it is already in the base template. → D4
5. **`describeParts()` is private and says "Act opener."** Export, rename, extend. → §6.4
6. **Act labels → part titles is not macro-free.** It needs the title slot. → §4
7. **Do not hide epigraph fields when the layout lacks support.** Contradicts layout-independent
   content. → §6.2
8. **Presence is not provenance.** Without the journal, a crashed migration's own output reads as
   deliberate author structure on rerun. → §5.4
9. **`parts.title` and the `showChapterMarkers` rename are persisted-schema changes**, not
   cosmetic. → §3, §6
10. **Tooltip status must cover non-printing layouts**, or free/Standard users never learn why
    their parts don't print. → §6
