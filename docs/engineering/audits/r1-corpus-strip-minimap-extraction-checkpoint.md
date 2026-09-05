# R1 Checkpoint — Corpus-Strip / Minimap Data Model

Status: **SEAM LANDED.** Single-cluster autonomous extraction. No
per-helper gates.

Scope: pure data-shaping that feeds the corpus-strip header rendering
+ the minimap item-path resolution. All DOM construction (the existing
`inquiryCorpusStripRenderer.ts` + `InquiryMinimapRenderer.ts`),
classList toggles, vault/file lookups, and the `corpusService`
boundary all stay where they live today.

## 1. Helpers in `src/inquiry/utils/inquiryCorpusStripMinimap.ts`

5 pure exported functions:

| Function | Surface |
|---|---|
| `getMinimapItemFilePath(item)` | minimap — file-path fallback chain (`filePath` → `rootPath` → `filePaths[0]`) |
| `getCorpusCcModeMeta(mode)` | corpus-strip — `{label, short, icon, isActive}` for a `SceneInclusion` |
| `getCorpusCcHeaderLabel(className, count, overrideLabel?)` | corpus-strip — header pill label (override / SIGMA / shorthand+count) |
| `getCorpusCcHeaderDisplayLabel(className)` | corpus-strip — human display name for tooltip |
| `getCorpusCcHeaderTooltip(className, mode, count, overrideLabel?)` | corpus-strip — composed tooltip text |

No DOM, no timers, no vault I/O, no plugin/state access, no i18n —
all string assembly is locale-neutral (the few literals like `'Summary'`
/ `'Full Scene'` / `'Exclude'` / `'Class'` are preserved verbatim from
the original methods).

## 2. InquiryView wrappers (5)

All five wrappers preserve the original private signatures and delegate
immediately to the pure module. `corpusService` reads, `app.vault`
lookups (used by `getMinimapItemTitle` / `getMinimapItemWordCount`),
and i18n stay in the view.

## 3. Intentionally remains in InquiryView

- **DOM/SVG renderers** — `renderCorpusCcStrip`, `buildMinimapRenderCallbacks`, all `createSvgText` / SVG element work, classList toggles.
- **Existing renderer modules** — `src/inquiry/corpus/inquiryCorpusStripRenderer.ts`, `src/inquiry/minimap/InquiryMinimapRenderer.ts` (unchanged).
- **Vault / file resolution** — `getMinimapItemTitle`, `getMinimapItemWordCount`, `getDocumentTitle`, `isTFile`, `getNormalizedFrontmatter`. These stayed because the impure boundary is the vault; the pure portions (frontmatter number parsing, file-path fallback) already live in `inquiryViewText.ts` / this module.
- **`corpusService` orchestration** — `getCorpusGroupBaseMode/EffectiveMode/ItemEffectiveMode/GlobalMode`, override summary, etc. Existing thin wrappers around the service (and the already-extracted `*Pure` constants module) cover this surface.
- **i18n** — all `t()` calls.
- **Session/run lifecycle/cache semantics** — untouched.

## 4. Test coverage

`inquiryCorpusStripMinimap.test.ts` — 16 `it` cases:
- `getMinimapItemFilePath`: each fallback channel + precedence + undefined.
- `getCorpusCcModeMeta`: summary / full / excluded / unknown.
- `getCorpusCcHeaderLabel`: override-wins after trim; empty/whitespace ignored; saga SIGMA glyph; shorthand+count for other classes.
- `getCorpusCcHeaderDisplayLabel`: all four known classes + unknown → `'Class'`.
- `getCorpusCcHeaderTooltip`: override vs display fallback; count-append rule (active OR count > 0).
- Source-lock: wrappers delegate.

`tsc --noEmit` clean. `src/inquiry`+`src/ai`: **929 passed / 1 skipped**.

## 5. Source-scrape brittleness — none triggered

Zero pre-existing InquiryView source-scrape tests broke this cluster
(first cluster in the entire R1 run with zero brittleness rewrites
required). Helpers were small enough not to be pinned.

## 6. Pre-existing oddities — none new

This seam introduced no new latent oddities and inherited none from
the methods it touched.

## 7. Recommended next R1 candidate

Corpus-strip/minimap pure data-model cluster exhausted. Further pure
extraction in these surfaces would need to either:
- restructure the SVG/DOM render loops (out of scope — DOM stays),
- or extract more of the `corpusService` / vault boundary (impure, not
  pure-extraction territory).

Candidates for the next scope-first pass:
- **Inquiry estimate / token-budget shaping** — flagged earlier as
  cross-cutting; consider only if explicitly needed.
- **Settings preview / cost-breakdown helpers** in `AiSection.ts` —
  separate file, separate cluster; brief/dossier-style pure extractions
  may exist there.
- **Inquiry run trace / log builder helpers** in
  `inquiryLogBuilders.ts` — already substantially pure but may have
  more leaves worth lifting.

A new domain module per cluster. Do not extend
`inquiryCorpusStripMinimap.ts` further.

## Related

- Prior checkpoints: `r1-cache-status-extraction-checkpoint.md`,
  `r1-brief-dossier-extraction-checkpoint.md`,
  `r1-findings-panel-extraction-checkpoint.md`.
- Doctrine: `docs/engineering/standards/code-doctrine.md`,
  `docs/engineering/standards/refactor-playbook.md`.
