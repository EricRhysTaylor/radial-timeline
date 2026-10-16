# Chronologue time references

Status: manual prototype implemented 2026-10-14; interior connectors and
primary-date-only range implemented 2026-10-15. Native acceptance uses isolated
synthetic vaults. Automatic extraction remains subsequent work; no public release
is implied.

## Purpose

A scene has one primary `When`, but its prose can enact, recall, mention, or
imagine events in other periods. Let an author declare those references and
inspect their chronological relationships without splitting the manuscript.

One scene remains one manuscript scene. A reference is an author declaration
attached to that scene, with one or more rendered occurrences.

## Agreed interaction and geometry

- A reference is a small solid square at the clockwise inner corner of its
  date position. It overlays scene geometry and never receives a scene slot.
- From the master scene's clockwise inner corner, a short radial feed reaches
  a concentric track inside the ring. The arc follows that track and ends
  radially at the reference square. It clears the scene center's question icon.
- Connectors never cross the central status grid or travel through another ring.
  A coincident date produces a radial connection rather than an artificial arc.
- Same-date references stack radially at the same angle, with at most three
  visible squares. A selectable `+N` retains overflow. Narrow rings and different
  dates too close together use an explicit selectable count cluster.
- References inherit their parent scene's subplot memberships and appear in
  those rings and All Scenes. Hover/pin shows only the active occurrence's
  connector family; other source/reference copies are highlighted. A Timetable
  selection uses the outermost available occurrence.
- The Timetable has one parent scene row, a reference count/disclosure, and one
  set of nested reference rows. Hover does not force expansion or scroll jumps.
  Activation holds selection, expands references and opens an exact passage.
- Kind and date precision remain explicit in reference details and nested rows.
  Square color follows the existing ring/column-coloring semantics.

The local interactive concept is under `build/concept-previews/` and is ignored
by Git. It demonstrates behavior; its schematic angles and illustrative prose
are not production geometry or manuscript content.

## First usable scope

Manual creation, editing, removal, passage navigation, Chronologue markers and
connectors, inherited subplot occurrences, and nested Timetable rows.

Existing scene numbering, primary-date dragging, counts, author progress,
Duration/Runtime, manuscript export, and other timeline modes retain their
scene-based semantics. A reference cannot be selected as a scene for bulk edits,
promotion, narrative reordering, or manuscript export.

Automatic scanning, AI extraction, reference-specific subplot overrides,
cross-scene event deduplication, alternate-history branches, and standalone
linear timeline development are subsequent work. Do not introduce their
persistence or service scaffolding in the first implementation.

## Author data

An optional advanced author property, `Time References`, contains
declarations such as this synthetic example:

```yaml
When: "2026-10-14"
Time References:
  - Label: The station fire
    When: "1952"
    Kind: recollection
    Passage: "She remembered the fire of 1952."
  - Label: The years of letters
    When: "1986"
    End: "1989"
    Kind: mention
  - Label: The proposed departure
    When: "2040"
    Kind: possibility
```

- Required: human-readable Label, When, and Kind. Kinds: `enacted`,
  `recollection`, `mention`, `possibility`.
- Optional: End for an actual period, Passage for an exact prose excerpt.
- Date strings remain strings, retaining year/month/day/clock precision.
  The absence of End means a date at the stated precision, not an event lasting
  throughout that year/month. An explicit period is a different semantic case.
- Year/month boundary values used for ordering are internal bounds, never
  presented as a known January 1 date or clock time.
- Validate calendar components and range order explicitly. Do not accept a
  rolled-over invalid date merely because JavaScript constructed a Date.
- Unsupported dates and unresolved relative expressions remain visible in the
  editor with an explanation; they receive no invented chronological position.
  A valid, dated reference may be displayed even when its parent is undated.

Field enrollment must follow the advanced YAML manager contract. Do not silently
adopt, normalize, or overwrite a pre-existing custom property with this name.
Make field selection/enrollment explicit in the feature's setup. Do not add an
empty reference property to all scenes or replace user-customized templates.
Preserve unrelated scene fields and unrecognized entry properties on edits.

No operational IDs, confidence, provenance, review flags, or view state in YAML.
The first manual version needs no new persisted operational store. If later
work requires one, use a schema-stamped vault-local sidecar, not duplicate
accepted declarations.

## Identity and ownership

1. Parse the author array once through a shared typed boundary. Wheel, table,
   editor, and navigation consume the same normalized result and diagnostics.
2. Keep a reference separate from `TimelineItem` scene records. Do not create
   fake scene items or rely on their exclusion from every downstream counter.
3. Use the parent scene identity plus a declaration locator for in-session
   reference selection. Rendered occurrence identity additionally includes the
   ring. Labels are not unique identifiers.
4. A locator based on array position is only valid for the captured document
   revision. Revalidate the expected declaration before writing; invalidate
   selection after structural changes instead of editing the wrong reference.
   Reuse existing scene IDs; do not introduce another frontmatter ID scheme.
5. Resolve an optional Passage against current prose. A unique exact match can
   navigate/highlight it. Missing or repeated text is explicitly detached or
   ambiguous; retain the declaration and offer reattachment. No fuzzy relocation.

## Chronological placement

Primary `When` dates alone determine the displayed domain. References do not
expand that domain, shrink scenes, alter numbering, or move perimeter ticks.
The existing primary positions are returned unchanged even for dense references.

- In-range references interpolate between dated scene corners in the current
  scene layout. Sequence inherits outer-ring placement; Fill uses local ring
  positions with the same manuscript-wide domain.
- A wholly earlier date travels backward across the 12 o'clock seam, ending in
  an Earlier terminal just left of the seam. A wholly later date travels forward
  across it to a Later terminal on the right. A real connector gap and two
  slashes mark the discontinuity; terminal labels include the actual date.
  The terminal is categorical and does not encode the omitted time distance.
- Several off-range dates share an explicit date-count cluster at that terminal,
  with all declarations available in its menu and Timetable. They are never
  misrepresented as multiple references at one date.
- Precision bounds classify wholly off-range dates. A year-only reference that
  overlaps a one-week manuscript remains in range with an overlap explanation;
  its year is never presented as a known January 1 date. Periods keep their full
  declared start/end in details; marker width is not duration.
- Without dated primary anchors in a ring, in-range references use their source
  corners and say No dated scenes in this ring. Without any primary dates in
  the manuscript, no earlier/later relation or calendar scale is invented.
- Connectors and their seam marks do not intercept pointer events. Small marker
  targets, labels and normal keyboard button activation support selection.

Primary elapsed gaps, overlap warnings, Duration and Runtime continue to use
primary scenes only. References never enter the primary re-date controller.

Earth dates remain the stored chronology anchor. Preserve the established
planetary-display contract and source precision; do not reinterpret a year-only
Earth reference as an exact planetary date. Runtime view must not assign a
reference its parent's reading time.

## Existing integration points, inspected 2026-10-14

| Responsibility | Existing implementation | Planned change |
| --- | --- | --- |
| Scene metadata | `src/services/SceneDataService.ts`, `src/types/timeline.ts` | Shared typed reference parsing; keep primary scene identity and counts |
| Managed field boundary | `src/sceneProperties/scenePropertyAdapter.ts`, `src/sceneProperties/scenePropertyPolicy.ts`, `src/utils/frontmatter.ts` | Explicit optional field enrollment, safe targeted writes |
| Scene chronological order | `src/utils/sceneHelpers.ts` (`buildChronologueSceneSequence`) | Preserve primary order; overlay references without changing scene/label positions |
| Angular slots | `src/renderer/utils/SceneLayout.ts` | Reference overlays on unchanged primary positions; existing modes keep their contract |
| Ring rendering and metadata | `src/renderer/renderers/RingRenderer.ts`, `src/renderer/components/Scenes.ts`, `src/renderer/components/SceneArcs.ts` | Small square terminals and concentric interior tracks with seam discontinuities |
| Chronologue orchestration and labels | `src/renderer/TimelineRenderer.ts`, `src/renderer/utils/Chronologue.ts` | Consume shared positions; preserve primary-only duration/overlap overlays |
| Wheel/table hover | `src/view/interactions/TimetableLink.ts`, `src/timetable/timetableRegistry.ts` | Extend selection with reference and occurrence identity, retaining scene-path API behavior |
| Parent and child rows | `src/timetable/TimetableView.ts`, `src/timetable/timetableModel.ts` | Dedicated reference subrows outside file-row/bulk-selection maps |
| Passage review/navigation patterns | `src/sceneTime/manualTime.ts`, `src/services/SceneBodyIndex.ts` | Reuse suitable exact-prose primitives, preserving ambiguity checks; keep elapsed-time decisions distinct |
| Date display | `src/utils/date.ts`, `src/utils/whenFormat.ts` | One precision-aware reference boundary and formatter; do not globally change existing When interpretation |

The Timetable currently keys file rows, Gap, and Running time by scene path.
Reference subrows must not overwrite those maps or count as additional Bases
files. A Bases filter excluding a parent also excludes its references. Parent
sorting/grouping continues to determine where the child list is tucked in.

The existing lens, active column coloring, subplot spotlight, and multi-book
scope must apply through the parent scene. Reference hover reuses a computed
snapshot; it does not scan vault text or rebuild the timeline.

## Implementation sequence

1. **Contract and geometry spike.** Typed parser/diagnostics, precision rules,
   revision-safe locators, bounded overlay clustering, and circular connector
   geometry. Synthetic cases cover one scene in two subplots and All Scenes.
   Exit: real scene boundaries and reference positions agree without fabricating
   scenes or dates; density behavior and Fill/Sequence are demonstrated.
2. **Read-only vertical integration.** Manually declared references render in
   Chronologue and nested Timetable rows, with linked hover/selection and exact
   passage navigation. No author-vault fixtures or manuscript edits.
3. **Author controls.** Visible Add time reference action from selected prose,
   optional scene-level reference entry, targeted edit/remove, Undo, ERT/i18n
   controls, and actionable field-enrollment/validation states. Keep established
   keyboard bindings; no new global shortcuts.
4. **Native acceptance and feature audit.** Test the complete flow in a controlled
   test vault, then run the required report-first post-feature audit. Record any
   audit findings in the session and request approval only for cleanup edits
   that the audit playbook explicitly gates. Commit and push verified work per
   repository rules. A public release is separate work.

## Acceptance cases

- One dated scene, three references: a year-only recollection, a stated period,
  and a possible future. One scene belongs to two subplots: three rendered
  occurrences per reference including All Scenes, one Timetable child list.
- Exact dates, day-only/year-only/month-only precision, invalid leap dates,
  reversed periods, unsupported expressions, and equal dates across scenes.
- Missing parent When, rename, deletion, reference reorder/edit, duplicate
  labels, stale dialog writes, deleted/repeated passage text, and scene scope.
- Outer/inner rings, Fill/Sequence, circle seam, small viewport/zoom, dense
  entries, dark/light appearance, CSS token resolution, keyboard focus and touch.
- Wheel-to-table and table-to-wheel hover, persistent selection, collapsed
  reference rows, Bases filters, spotlight, and active column coloring.
- Scene count, word totals, Runtime, elapsed gaps, overlap detection, manuscript
  export and Chronologue drag behave as before with the same primary scenes.
  Existing books without declarations produce unchanged geometry and behavior.

Meaningful tests target these behaviors and shared geometry, not source-shaped
assertions that merely restate implementation. Verification for runtime work:
`npx tsc --noEmit`, relevant Vitest suites, `npm run build-only`, and the native
acceptance flow. `build-only` avoids the auto-backup behavior of `npm run build`.

## Current delivery state

The manual prototype is implemented in `src/chronologue/timeReferences/`.
Right-click a Scene file to manage its references, or select prose and use the
editor menu's Add time reference action. First use explicitly enrolls the field
in the advanced Scene template; it does not populate existing scenes.

Native acceptance in the isolated **Chronologue References QA** vault covered
three primary scenes, three references on one scene across three visible rings,
Fill/Sequence, nested rows, linked selection, exact passage highlighting,
creation, Undo, and a rejected stale write. The status count stayed at three.
Source dates and surrounding prose were preserved. Native inspector checks
confirmed that the reference chrome's CSS tokens resolve to values.

No author manuscript or installed author-vault plugin was changed. Only the QA
vault received the build. Automatic extraction, native large-manuscript density
and performance, mobile/touch, and complete alternate-calendar acceptance remain
outside this prototype's native evidence. See the [feature audit](../audits/2026-10-14-chronologue-time-references.md) for
verification results and remaining concerns.


The 2026-10-15 seam revision is tested in **Chronologue Seam QA**, a disposable
copy under `Demo Vaults/Testing Vaults/2026-10-15 Chronologue reference seam/Working/`.
Its three primary scenes span June 1–7, 2026. Five same-date references to 1952,
one in-range date and one possible future in 2040 exercise seam routing, stacks,
overflow, linked selection and the existing question icon. The preserved Baseline
is outside the active vault. Only this Working copy receives the revision build.
