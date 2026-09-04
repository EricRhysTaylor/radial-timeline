# Codebase Health Report — 2026-09-04

**Cadence:** Weekly (first full run of this track)
**Audited by:** Claude Code (Fable 5.1) — one coordinator + seven scoped read-only auditors
**Branch / commit:** `main` @ `7d91b4c7`
**Build status at audit time:** `pass` — `npx tsc --noEmit` clean; `vitest` 287 files / 3,267 tests pass (2 files opt-in skipped); `check-css-duplicates`, `code-quality-check --all`, `fallback-gate` (2,429 vs baseline 2,497), `lint:obsidian` all pass
**Previous report:** none (daily control tower and biweekly deep audit exist; no prior codebase-health report)

---

## Executive summary

The gates are green and the test suite is fast, but the gates measure a narrow band. Underneath, the codebase carries **121 runtime exports with zero uses anywhere (plus 681 over-exported in-file-only symbols), 10 whole files nobody imports, ~470 CSS classes with no producer, ~160 unused locale keys, and 133 unused locals** that no gate catches. Structural debt is concentrated in a handful of giant render functions (six above 1,000 lines; `renderPublishSection` alone is 2,843) and in settings sections that host publishing, AI-forecast, and vault-mutation logic that services then import *back* from the settings layer.

Two findings escalate beyond cleanup. First, the Community project sync sends each book's **private working title** to the server whenever no public label is set. The canonical product contract requires exactly that (every Book Manager book syncs as a private shell), but the in-repo privacy doctrine still describes a device-side per-book opt-in, and the projection layer its tracer test protects has zero production callers. This is doctrine and disclosure drift, not a demonstrated leak. Second, the timeline view **re-registers DOM listeners and cleanups on every render** without unloading the previous set, so long sessions accumulate closures that pin old SVG trees.

Trend: cannot be computed (no prior report). The v7 removal plan is still `status: pending` at version 7.2.0.

Revision note (2026-09-04, same day): findings #1, #4, #5, #6, #9, #10, #11, #13, #14, #15 were corrected after independent review. The scan numbers below now come from three committed scripts under `scripts/audit/` so they reproduce.

---

## Top metrics

| Metric | This cycle | Prev cycle | Δ |
|---|---|---|---|
| TS source lines (non-test) | 204,208 across 580 files | — | — |
| Largest TS file (lines) | `src/inquiry/InquiryView.ts` 12,188 | — | — |
| Largest CSS file (lines) | `src/styles/rt-ui.css` 10,720 (36,688 total) | — | — |
| Files > 600 lines | 89 | — | — |
| Functions ≥ 80 lines (`scripts/audit/long-functions.mjs`, heuristic) | 188 (67 ≥ 200, 20 ≥ 400, 4 ≥ 1,000) | — | — |
| Exports with zero uses anywhere (`scripts/audit/dead-exports.mjs`) | 136 (121 function/const/class; 15 types) | — | — |
| Exports used only inside their own file (over-exported, not dead) | 681 | — | — |
| Files with zero importers | 10 real + 2 intentional | — | — |
| Unused locals/params (`tsc -p tsconfig.audit.json`) | 133 (132 TS6133 + 1 TS6138) | — | — |
| Producer-less CSS classes (`scripts/audit/unused-css.mjs`, heuristic ±5%) | 473 | — | — |
| Unused `en.ts` i18n keys | ~160 of 1,921 | — | — |
| ESLint (`eslint src`, full config) | 328 problems, 314 of them type-unsafe (`no-unsafe-*` incl. enum comparison) | — | — |
| `// TODO(v7)` | 3 (all overdue) | — | — |
| `console.*` in shipped src | 189 sites, 105 of them catch-only | — | — |
| Tests | 289 files, 3,267 tests, 0 `.skip/.only`, 0 snapshots | — | — |
| Tests that assert on source text (`readFileSync` of `.ts/.css`) | 35 files, 254 direct reads (reviewer AST count; grep gave 31/245) | — | — |
| `main.js` (build/) | 5.9 MB (Pandoc assets embedded) | — | — |
| `styles.css` (build/) | 1.34 MB | — | — |
| `.gate-logs/` (ignored, never pruned) | 254 MB, 1,644 runs | — | — |

---

## Findings

Ordered by severity, then by leverage. IDs are `CH-2026-09-04-#N`.

### CH-2026-09-04-#1 — Community project sync transmits private book titles per the product contract; the in-repo privacy doctrine and its tracer test describe a different model

- **Status:** Confirmed (transmission and doctrine mismatch); **not** a demonstrated leak
- **Category:** doctrine correction
- **Severity:** ORANGE (doctrine mismatch on an author-trust surface; downgrade to YELLOW once the doctrine is reconciled)
- **Confidence:** High
- **Risk:** Disclosure accuracy. `Platform/COMMUNITY-SHARE-PRODUCT-CONTRACT.md` (Amendment 2026-07-04, "Projects" surface) specifies that *every* Book Manager book syncs to the website as a project shell with `visibility='private'`, and that only an explicit website action makes it public. The wire path implements that. But the in-repo doctrine `docs/engineering/standards/writing-session-privacy.md:65` says `bookTitle` is opt-in per book and `:141` says never substitute "Untitled", and its `:9` claim that only the `private` audience ships is stale (daily sync has shipped since 2026-07-16). Two authoritative documents disagree about where the privacy boundary sits, and the plugin-side privacy disclosure should say plainly that working titles are stored server-side in a private state.
- **Effort:** 2 h to reconcile the doctrine and disclosure; 1 day to re-point the tracer test at the real path
- **Evidence:**
  - `src/communityShare/communityShareClient.ts:554` — `book.publicLabel || book.title || 'Untitled book'` is sent on every project sync. Gate at `:590` checks only `enabled/connected/!paused`, not tier (consistent with the contract's "every book" rule). Fires from `src/main.ts:720` at startup and from `src/settings/sections/ProgressSection.ts:847,889,940` on every target-date edit. `stageTargetDates` and `enableZeroDraftMode` also ship and appear in no plugin-side field policy or manifest.
  - `src/communityShare/communityShareClient.test.ts:579` asserts the private title is sent (`expect(body.projects[1].title).toBe('Second Book')`), so the behaviour is intentional and tested.
  - The preview path uses `publicLabel` only (`src/communityShare/communitySharePreview.ts:110-112`), so what the author previews and what is sent differ by design; the preview should say so.
  - The doc comment at `communityShareClient.ts:523-527` and `:538-540` matches the contract ("arrive PRIVATE" server-side). The repo doctrine describes a device-side model. One of them has to change.
  - `projectCommunityDaily`, `buildCommunityDailyLog`, `projectFriends`, `filterRecordsForWindow`, `redactTime` in `src/services/WritingSessionLog.ts` have **zero production callers**. The shipped `days` payload comes from `buildCommunityDailyEntries` → `buildDailyWritingStats` (`communitySharePreview.ts:203-224` → `WritingSessionService.ts:513-552`), a parallel aggregator. `WritingSessionLog.privacy.test.ts` therefore protects dead code.
  - `communitySharePreview.ts:246` — `books.find(activeBookId) ?? plugin.settings.books[0]` silently shares the wrong book when `activeBookId` is stale; no `SAFE:`.
- **Suggested next action:** Reconcile the two documents. The contract is newer and explicit, so the likely fix is to amend `writing-session-privacy.md` (drop the stale `:9` claim; state that book titles, loglines, and target dates are stored server-side as private shells; record `book.title` and target dates in the field manifest) and make the plugin-side disclosure and the share preview say the same. If instead the owner wants the device-side model, send `publicLabel` only and flip the test at `:579`. Either way, point the tracer test (all five TRACER strings) at `buildCommunityDailyEntries` + `buildCommunitySharePreview`, and delete or adopt the unused projection functions.

### CH-2026-09-04-#2 — Timeline view accumulates listeners and cleanups on every render

- **Status:** Confirmed (accumulation); Hypothesis (memory cost magnitude)
- **Category:** stabilization
- **Severity:** ORANGE
- **Confidence:** High
- **Risk:** Long sessions with frequent YAML edits grow memory linearly; each registered closure pins the previous SVG tree. Timers fire on closed views / unloaded plugin.
- **Effort:** 4–8 h
- **Evidence:**
  - `src/view/TimeLineView.ts:2939-3251` `renderTimeline` calls `this.register(...)` at `:2981, 3144, 3238` and `this.registerDomEvent(...)` at `:3050, 3067, 3174, 3181` on **every** render; `refreshTimeline` → `renderTimeline` at `:2766`. Obsidian's `Component` holds all of them until `onClose`.
  - Same pattern in `src/view/interactions/OuterRingDragController.ts:207-224` (`attach()` per render) and `ChronologueShiftController.ts:684-703, 800-805, 872-993`.
  - `src/main.ts:601-604` — 20 s `window.setTimeout` for community sync is not registered; fires against an unloaded plugin on quick reload. `communityShareClient.ts:606-619` `pendingProjectSync` is a module-level timeout never cleared on unload.
  - `src/view/TimeLineView.ts:2854-2855` `timelineRefreshTimeout` is set in `onOpen` and never cleared in `onClose` (`:2892-2933`). Ad-hoc unregistered timers at `:1485-1487, 2227, 3475, 3548`; `GossamerCommands.ts:652, 687`; `OuterRingDragController.ts:171, 1227` (`holdTimer`); `renderer/dom/BeatLabelAdjuster.ts:73, 123`.
  - `src/view/TimeLineView.ts:3703` `_tabHighlightTimeout` declared, never used.
- **Suggested next action:** Give `renderTimeline` a per-render child `Component` that is `unload()`ed at the top of the next render; register the `main.ts:601` timer; clear `timelineRefreshTimeout` in `onClose`.
- **Status (2026-09-04):** Actioned. `RadialTimelineView.renderScope` is a child `Component` created lazily per render and removed (unloaded) at the top of the next `renderTimeline` and with the view. All 61 render-time registrations in the view, the mode setups (`AllScenesMode`, `MainPlotMode`, `ChronologueMode`, `GossamerMode`), and the interaction controllers (`OuterRingDragController`, `ChronologueDragController`, `ChronologueShiftController`, `ModeToggleController`, `RotationController`, `HelpIconController`, `VersionIndicatorController`, `SceneContextMenu`, `SearchInteractions`) now go through it; the narrow view interfaces expose `renderScope` instead of `registerDomEvent`. The drag hold timer and both Gossamer-panel refresh timers are scoped the same way. `onClose` clears `timelineRefreshTimeout` and the two session-pulse timers; the dead `_tabHighlightTimeout` field is gone. `main.ts` registers the 20 s community kickoff timer for cleanup, and `cancelPendingCommunityProjectSync()` runs on plugin unload. The Obsidian test mock's `Component` now models load/unload/addChild/removeChild so `TimeLineView.renderScope.test.ts` proves cleanups run on the next render and on view unload. Still open: ad-hoc timers in `GossamerCommands.ts:652,687` and `BeatLabelAdjuster.ts:73,123` (short, cosmetic).

### CH-2026-09-04-#3 — Community share: stale-snapshot writes and no in-flight guard

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** ORANGE
- **Confidence:** High
- **Risk:** A Pause clicked during a publish is silently reverted (`sharingPaused` back to `false`, pause history entry dropped). Concurrent publishes from the 20 s timer, 6 h interval, resume, and settings preview can double-post.
- **Effort:** 2–3 h
- **Evidence:** `src/communityShare/communityShareClient.ts:258` captures `current`, awaits at `:281` and `:286`, then writes `{...current, …}` at `:318-344`. Same shape at `:800` (after await `:797`), `:876`, `:934`, and `src/settings/sections/CommunityShareSection.ts:644, 667` (after await `:639`). The catch paths at `:761` and `:821` correctly re-read, showing the rule is known. `syncCommunityShareIfDue` has no in-flight promise guard (`websiteContextInflight` at `:600` exists only for context fetch). Five different "is sharing active" predicates: `:266-269, 412, 590, 718-720, 789-794, 980-985` plus `src/types/settings.ts:106-113`.
- **Suggested next action:** Re-read `normalizeCommunityShareSettings(plugin.settings.communityShare)` after every await before writing; one in-flight promise for `syncCommunityShareIfDue`; one `resolveShareCapability(settings)` consumed by all seven gate sites.
- **Status (2026-09-04):** Stale-snapshot writes and the in-flight guard are actioned. `commitCommunityShare(plugin, live => …)` in `communityShareClient.ts` re-reads the live settings at write time and is now the only way publish, scheduled sync (success and failure paths), daily-sync stop, revoke, disconnect, and the settings-section preview builder write settings; each layers only its own change onto the live state. `syncCommunityShareIfDue` shares a single in-flight promise across the startup timer, 6 h interval, Resume, and the preview builder. Both sync paths re-check `sharingPaused` after their preview/aggregate awaits and skip cleanly instead of publishing or logging a failed sync. Three tests in `communityShareClient.test.ts` reproduce the race (Pause mid-request, Pause mid-preview, overlapping syncs) and fail on the pre-fix code. **Still open:** the five "is sharing active" predicates are not unified; that changes gating semantics (e.g. whether project sync respects tier) and depends on the CH-#1 contract decision.

### CH-2026-09-04-#4 — Settings sections host service logic that services import back

- **Status:** Confirmed
- **Category:** cleanup (escalate architecture to Drift audit)
- **Severity:** ORANGE
- **Confidence:** High
- **Risk:** Not behaviourally tested (the functions are testable, but the only tests on these files assert source text); inverted dependency `services/* → settings/sections/*`; the same logic cannot be reached from commands without a settings tab.
- **Effort:** 2–3 days for PublishSection alone
- **Evidence:**
  - `src/settings/sections/PublishSection.ts:75-1650` (~1,575 lines): `scanSystemPaths` `:253-305` (`child_process.execFile`), `ensurePublishingEnvironment` `:414-478`, `buildMatterRepairPlan`/`applyMatterRepairPlan` `:698-818`, `parseBookMetaFromFrontmatter` `:819-865`, `generateSampleTemplates` `:1200-1646`. Imported *from a settings section* by `src/services/PublishingValidationService.ts`, `src/services/CommandRegistrar.ts`, `src/utils/bookPagesResolver.ts`. `renderPublishSection` is then `:1660-4502` (2,843 lines) with 16 `getAbstractFileByPath`, 3 `vault.create`, 38 `new Notice`.
  - `src/settings/sections/AiSection.ts:1818-2390` cost comparison + vault forecasts (`computeCostComparisonRows` `:2059-2191`, `computeVaultForecasts` `:2230-2368`); `:3266-4034` local-LLM detection with network probes (`detectLocalLlmServers` `:3324-3422`) — no counterpart under `src/ai/localLlm/`. Key validation split between `SettingsTab.scheduleKeyValidation` `:267-347` and `AiSection.runProviderKeyStateCheck` `:2980-3012`.
  - `src/settings/sections/BeatPropertiesSection.ts:128-5788` is one 5,660-line closure with module-level mutable singletons at `:117-126`; `renderAuditPanel` `:3721-5268` (1,548 lines) does `trashFile`, `renameFile`, `processFrontMatter`, a deletion snapshot writer, and a hand-rolled migration planner `:3854-3890, 4828-4905` that duplicates `utils/yamlBackfill|yamlManager|referenceIdBackfill`.
  - `src/settings/sections/AuthorProgressSection.ts:2125-2229` declares `CustomBgPresetModal` inside a section file.
- **Suggested next action:** Smallest unit: move `PublishSection.ts:75-1650` into `src/publishing/` modules, flip the three inverted imports, and add behavioural tests for `buildMatterRepairPlan` and `scanSystemPaths` there. Escalate the pattern to Architecture Drift.

### CH-2026-09-04-#5 — Dead files, dead exports, stray duplicates

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Parallel implementations that can drift unnoticed (`requestPayload.ts` is a second request builder; `aiDefaults.ts` is a second model-selection source); `ai/index.ts` barrel masks dead-export detection; `tsc` still type-checks the stale ` 2.ts` test copies (tsconfig `exclude` pattern does not match them).
- **Effort:** 1 day, pure deletion, ~2,000 lines
- **Evidence:**
  - Whole files with zero importers (grep across src/tests/scripts/esbuild): `src/api/requestPayload.ts` (239, header says DEPRECATED), `src/renderer/DynamicLayerUpdater.ts` (215), `src/renderer/components/AprOverlay.ts` (93), `src/ui/validator.ts` (76), `src/timelineRepair/index.ts` (71), `src/utils/matterSummaries.ts` (64), `src/renderer/utils/AuthorProgressUtils.ts` (59, Kickstarter/Patreon embeds), `src/ai/index.ts` (34, barrel of 33 `export *`), `src/renderer/apr/index.ts` (29), `src/renderer/components/BeatSlices.ts` (27). Intentional and documented: `src/ui/reference/ProPill.reference.ts`, `src/types/obsidian-augment.ts`.
  - Committed macOS duplicates: `src/inquiry/state.test 2.ts` (byte-identical to `state.test.ts`) and `src/inquiry/runner/InquiryRunnerService.verifyFindingRefs.test 2.ts` (an older revision, 215 diff lines). Not run by vitest, but compiled by tsc.
  - 136 exports with **zero uses anywhere** (not even inside their own file beyond the declaration): 121 functions/consts/classes + 15 types. Run `node scripts/audit/dead-exports.mjs`. By dir (runtime kinds): renderer 34, utils 25, inquiry 18, settings 8, ai 7. A further 681 exports are used only inside their defining file — over-exported, not dead; un-export opportunistically. (The first revision of this report said "299 dead exports"; that number mixed the two categories.) Named zero-use examples: `constants/inquiryUi.ts:56-63` all eight `getInquiryHelp*Tooltip`; `utils/manuscript.ts:530` `estimateTokens` (words-based, a second token heuristic); `providers/provider.ts:11` `defaultCapabilitiesForProvider`; `constants/aiDefaults.ts:5-6` `DEFAULT_OPENAI_MODEL_ID`/`DEFAULT_ANTHROPIC_MODEL_ID`; `utils/exportFormats.ts:53,1515,1543,1600`; `utils/logVaultOps.ts:136 trashFiles`; `SettingsTab.showPathSuggestions:348-388`, `renderProHero:751-769`; `PublishSection.ts:1676` `addProRow = (s) => s` identity wrapper applied 13×.
  - 133 unused locals/params from `tsc -p tsconfig.audit.json` (InquiryView 38, ManuscriptOptionsModal 12, AuthorProgressModal 8, TimeLineView 7). `src/services/authorProgress/AuthorProgressCampaignService.ts:14` `app` declared never read.
  - 8 settings fields never read anywhere: `src/types/settings.ts:117` `TemplateAsset.checksum`, `:1021` `validProjectPaths`, `:1043` `briefingTheme` (+ type `:779`), `:1090` `completionEstimateWindowDays`, `:1130` `shouldRestoreTimelineOnLoad`, `:1139` `_resumingMode`, `:1154` `enablePlanetaryTime`, `:1335` `PlanetaryProfile.customFormat`.
  - Always-off flags: `inquiry/components/InquiryGlyph.ts:77` `DEBUG_INQUIRY_ZONES=false` (guards 14 lines incl. hex `#ffb400`); `inquiry/constants/inquiryLayout.ts:10-12` `svgOverlay=false` → `InquiryView.buildDebugOverlay` `:3498-3551`; `PublishSection.ts:1651-1652` `SHOW_SCREENPLAY_LAYOUT_CATEGORY`/`SHOW_PODCAST_LAYOUT_CATEGORY=false`. Commented-out block `modals/GossamerScoreModal.ts:399-439`.
  - `src/services/AuthorProgressService.ts:1-89` — 14 public methods, every one a one-line delegation to four other services; an abstraction layer with no behaviour.
- **Suggested next action:** One commit: `git rm` the two ` 2.ts` files and the 10 dead files, delete the 121 zero-use runtime exports (verify each with `grep -rw` first; the scan is name-based) and the 8 settings fields, run `tsc` + `vitest`. Then re-run `scripts/audit/dead-exports.mjs` (the `ai/index.ts` barrel currently hides drift). Add `npm run audit:tsc-unused` to `gates` as a ratchet.
- **Status (2026-09-04):** Actioned in the deletion commit that follows this report: 12 files removed (10 dead + 2 stray tests), 136 zero-use exports + 30 cascade exports + their orphaned imports/locals removed; `scripts/audit/dead-exports.mjs` now reports 0 zero-use outside the documented `ProPill.reference.ts`. Two `plugin-feature-integration.json` evidence rules were repointed from the deleted `requestPayload.ts` shim to the live sanitizer and Gemini split in `providerCapabilities.ts`/`aiClient.ts`. Still open from this finding: the 8 never-read settings fields, the 3 always-off flags, the `AuthorProgressService` façade, and the ~681 over-exported in-file-only symbols.

### CH-2026-09-04-#6 — Duplicated helpers with no canonical (or a canonical nobody uses)

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Behavioural drift is already present: two `normalizeAngle` contracts, two `parseLocalDate` failure modes, three frontmatter-strip regexes with different CRLF handling, three XML escapers with different char sets, three different stage-colour fallback hexes.
- **Effort:** 2–3 days across all families; each family is a 1–2 h unit
- **Evidence (family → copies):**
  - Local date key `YYYY-MM-DD`: 6 byte-identical copies (`modals/WritingSessionCompletionModal.ts:48`, `view/interactions/SceneContextMenu.ts:57`, `communityShare/communitySharePreview.ts:68`, `services/SceneInsertService.ts:46`, `services/WritingSessionService.ts:204`, `settings/sections/GoalsSessionsSection.ts:131`) + UTC variants at `modals/TimelineAuditModal.ts:1120`, `modals/BookDesignerModal.ts:1639`. `utils/date.ts` (1,311 lines) has none. `parseLocalDate` ×3: `GoalsSessionsSection.ts:120` and `WritingSessionService.ts:211` **return `new Date()` on malformed input**; `renderer/components/ProgressRing.ts:113` returns `null`.
  - FNV-1a hash: 7 copies, 2 variants (`inquiry/runner/InquiryRunnerService.ts:1337, 2707`, `inquiry/render/inquiryLogBuilders.ts:78`, `inquiry/services/inquiryEstimateTrace.ts:5`, `inquiry/services/canonicalInquiryCorpus.ts:6`, `ai/runtime/aiClient.ts:85`, `api/anthropicApi.ts:252`) + djb2 at `inquiry/services/InquiryCorpusService.ts:99`. Scene-id fingerprints agree today by coincidence.
  - `countWords`: canonical `utils/manuscript.ts:521`; copies `utils/runtimeEstimator.ts:92`, `utils/yamlAudit.ts:108`, `renderer/utils/SynopsisBuilder.ts:8`, `gossamer/evidence/buildGossamerEvidence.ts:19`; divergent `inquiry/utils/inquiryViewText.ts:436`.
  - `resolveAccessTier`: canonical `ai/runtime/runtimeSelection.ts:23` is live (called by `resolveConfiguredSelection` at `:54`), but five private re-implementations exist instead of importing it: `aiClient.ts:60`, `registry/recommendations.ts:32`, `inquiry/services/inquiryModelResolver.ts:105`, `InquiryView.ts:1505`, `AiSection.ts:916`. (The first revision wrongly called the canonical one unused.)
  - Subplot colour resolution: `renderer/TimelineRenderer.ts:302`, `renderer/renderers/RingRenderer.ts:92`, `renderer/dom/SceneDOMUpdater.ts:206`, `view/interactions/ChronologueShiftController.ts:120`, `SynopsisManager.ts:1005` (+ `resolveSubplotColorFromGroup` twice: `dragGeometry.ts:98`, `SceneContextMenu.ts:343`), all with fallback `'#EFBDEB'`.
  - `svgToPngBuffer`: near-identical (14 differing lines after whitespace normalisation, chiefly a `scale` parameter and `createEl` vs `activeWindow.createEl`) in `services/export/TimelineExportService.ts:771-812` and `services/authorProgress/AuthorProgressRenderService.ts:495-535`. The Timeline copy's own docstring says it "mirrors the APR export pattern".
  - `normalizeAngle` ×4 with two contracts: `ChronologueShiftController.ts:1749` [0,2π) vs `:1795`, `renderer/utils/MonthSpokes.ts:3`, `dragGeometry.ts:266` (−π,π].
  - `escapeRegExp`: canonical `utils/regex.ts:6`; copies `utils/manuscript.ts:228`, `services/SceneInsertService.ts:186`, `inquiry/utils/scanRoots.ts:10`, inline ×3. `escapeXml`: canonical `utils/svg.ts:16`; narrower copies `renderer/components/BackdropRing.ts:37`, `renderer/gossamerLayer.ts:634` (no `'`), `renderer/apr/AprRenderer.ts:117`, `AprBranding.ts:26,33`.
  - Frontmatter strip: canonical `utils/frontmatterDocument.ts:12`; `utils/manuscript.ts:149`, `timelineRepair/RepairPipeline.ts:135` (no CRLF), `sceneAnalysis/data.ts:207`, `sceneAnalysis/Maintenance.ts:177`, `RuntimeCommands.ts:150`.
  - `basename` ×8 (`services/SceneInsertService.ts:53` == `SceneReorderService.ts:195`; `utils/templateImport.ts:82` == `utils/pandocBundledLayouts.ts:70`; `onboarding/paths.ts:9` exports the best one). `slugify` ×6 in 2 families (`utils/exportFormats.ts:37` == `utils/books.ts:220` and `exportFormats` already imports `books`). `cssEscape` ×2, `clamp` ×2 + 116 inline `Math.min(Math.max(`. `sleep`: no export, 15 inline. Obsidian `debounce` imported 0×; `modals/TimelineRepairModal.ts:216,319,1447` hand-rolls one.
  - `RuntimeRateProfile` builder ×3 identical: `RuntimeSection.ts:31-38`, `GoalsSessionsSection.ts:23-30`, `utils/runtimeEstimator.ts:59-66`. Stage-colour fallback ×7 with three hexes (`#808080` ×5, `#9E70CF` `ProgressSection.ts:114`, `#6FB971` `AuthorProgressSection.ts:738`).
  - Community client: the "non-2xx → `CommunityShareError` → shape guard" block hand-copied 7× (`communityShareClient.ts:197, 306, 474, 509, 570, 746, 1014`) while `callReportAction` `:840-864` already abstracts it. `deriveCacheResult` ×3 with three signatures across provider adapters.
  - Name-prompt modal ×4 (~290 lines): `CampaignManagerSection.ts:55-123`, `GeneralSection.ts:21-76`, `PlanetaryTimeSection.ts:33-108`, `AiContextModal.ts:12-99`; none extend `ui/ErtModal.ts`.
- **Suggested next action:** Start with the ones that have a behavioural bug: add `formatLocalDateKey`/`parseLocalDateKey` (null on bad input) to `utils/date.ts`; pick one `normalizeAngle` contract; move `svgToPngBuffer` to `services/export/` with `scale` as a parameter; import `runtimeSelection.resolveAccessTier` at the five copy sites. Each is an independent commit with `tsc` + `vitest`.

### CH-2026-09-04-#7 — Cost/estimate fallbacks that can show a wrong number

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** YELLOW (touches "Do not lie to the author")
- **Confidence:** High
- **Risk:** An actual-cost figure can be silently 1.6× off; a missing output rate prices output at $0; an unknown corpus size passes every model's context filter.
- **Effort:** 1 day; the omnibus cost path is on the protected Inquiry critical path, so tests first
- **Evidence:**
  - `src/ai/cost/estimateCorpusCost.ts:79-88` `resolveCacheWriteRatePer1M` — comment: "better an off-by-1.6× estimate than no estimate at all"; cross-TTL substitution also at `:244-246`.
  - `src/inquiry/runner/omnibusCacheHealth.ts:181-220` is a second cost engine with its own `perMillion` (returns 0 for undefined rate `:203-204`) and `cacheWriteRate ?? inputRate` `:211`.
  - `src/ai/router/selectModel.ts:13-14` `contextTokensNeeded ?? 0`; `:63-80` pinned-alias-missing falls back to latest stable with only a `warnings[]` entry that Pulse/Gossamer/Onboarding callers do not obviously render (Hypothesis).
  - Two token heuristics for the same request: `aiClient.ts:610-614` (per-part ceil) vs `ai/tokens/inputTokenEstimate.ts:135-146` (sum then round once).
  - `inquiry/constants.ts:8` `INQUIRY_MAX_OUTPUT_TOKENS = 16000 // Fallback only` used as `?? 16000` at 4 sites where rule 4 says `unknown`. Anthropic `'1h'` TTL literal at `ai/log.ts:225`, `InquiryView.ts:11343`, `AiSection.ts:2161` while `ANTHROPIC_REQUESTED_CACHE_TTL` exists.
  - `InquiryRunnerService.ts:2289` and `inquiry/utils/inquiryViewText.ts:181` render a finding with no headline as literally "Finding". `inquiry/state.ts:171` `result.findings || []` on a non-optional field, no `SAFE:`.
  - `sceneAnalysis/aiProvider.ts:341-343` logs provider `none` as `openai`.
- **Suggested next action:** Fold `estimateOmnibusCostRange` into `estimateCorpusCost`; replace cross-TTL and `?? inputRate` substitutions with `undefined` → "Estimate unavailable"; make `aiClient.ts:610` call the canonical chars/4 helper.

### CH-2026-09-04-#8 — Filters on the scene hover path

- **Status:** Confirmed (presence); Hypothesis (perceptible cost)
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** Contradicts the owner rule the recent `:has()` commits enforced (`memory: no-blur-animation-near-scene-hover`); drop-shadow/blur filters inside the SVG on hover are exactly what that note forbids.
- **Effort:** 1–2 h once decided
- **Evidence:** `src/styles/scenes.css:305-307` `.rt-scene-title.rt-selected { filter: url(#sceneTitleHalo) }` — `rt-selected` is applied on **hover** by `SceneInteractionManager.ts:312-325` (`applySelection` from `doSceneHover`); halo is `feFlood`+blur in `renderer/components/Defs.ts:118`. `timeline.css` ~459/701/939 `[data-shift-mode] .rt-scene-group:hover { filter: brightness()/drop-shadow() }`. `indicators.css` 12× `:hover { filter: drop-shadow(...) }` inside `.radial-timeline-container`. `base.css` `.rt-scene-path.rt-selected { filter: saturate() brightness() }`. `scenes.css:652` `filter: saturate(1.5)`. 45 rules with `scene|hover` in the selector declare `transition`/`animation`/`filter`. `:has()` = 0, `!important` = 0.
- **Suggested next action:** Owner decision. If the rule holds, replace the halo with a stroke/opacity change and drop the shift-mode hover filters.

### CH-2026-09-04-#9 — Six render functions above 1,000 lines; view at 12K

- **Status:** Confirmed
- **Category:** cleanup (extractions), escalate splitting strategy to Refactor Board
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Untestable, unreviewable; the two biggest contain the vault-mutation paths in #4.
- **Effort:** per extraction 2–4 h; the named pure extractions are safe
- **Evidence:** From `node scripts/audit/long-functions.mjs` (indentation-based, nested closures count toward the parent): four top-level functions ≥ 1,000 lines — `PublishSection.renderPublishSection` 2,843 (`:1660-4502`); `AuthorProgressSection.renderAuthorProgressSection` 1,892 (`:59-1950`); `InquirySection.renderInquirySection` 1,675 (`:160-1834`); `ChronologueShiftController.setupChronologueShiftController` 1,028 (`:85-1112`, 23 nested closures). Not matched by the scanner's single-line signature rule but confirmed by reading: `BeatPropertiesSection.renderBeatPropertiesSection` 5,660 (`:128-5788`, one closure) containing `renderAuditPanel` 1,548 (`:3721-5268`). Then `InquirySection.renderPromptConfiguration` 828; `GossamerCommands.runGossamerAiAnalysis` 707 (`:751-1457`); `PublishSection.renderBookMetaPreview` 693; `SynopsisManager.generateElement` 673; `CommandRegistrar.handleManuscriptExport` 642 (`:329-970`, 27 Notices, 0 early returns); `CommunityShareSection.renderCommunityShareSection` 635; `InquiryView.buildZoneGradients` 486 (`:2368-2853`, 333 numeric literals, no `this` state beyond `rootSvg`); `aiClient.run` 483; `TimeLineView.ensureBookSwitcher` 412; `main.loadSettings` 386 (a migration pipeline with no section structure); `InquiryView.runInquiry` 333.
  - `InquiryView.ts` (12,188 lines, 555 methods, 164 fields) has ~30 three-line `*Pure` forwarders (`:8664-8714`, `:11438-11456`, `:4524-4614`) and 67 `X as XPure` import aliases — pure ceremony. `runOmnibusCombined` `:6850-7035` and `runOmnibusSequential` `:7037-7260` share 77 identical lines of persist/progress tail.
  - `TimeLineView.ts:939-2101` is ~1,160 lines of writing-session UI (a third of the file).
- **Suggested next action:** Smallest safe units: extract `buildZoneGradients` + icon symbols (`InquiryView.ts:2330-2975`) into a pure `render/inquirySvgDefs.ts`; delete the `*Pure` forwarders; fold the omnibus tail into one `finalizeOmnibusQuestion()`. Escalate the section-file splitting strategy to the Refactor Board.

### CH-2026-09-04-#10 — Overdue v7 removals and unfinished deprecations

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Each shim is a second code path; one (`sceneAnalysis` migration) runs an ungated `getMarkdownFiles()` sweep on every load.
- **Effort:** 1 day
- **Evidence:** `docs/engineering/plans/v7-removals.md` is `status: pending`, target 7.0.0; package is 7.2.0. `TODO(v7)` ×3 at `src/authorProgress/authorProgressConfig.ts:67, 84, 309`. `src/migrations/beatSettings.ts` (436 lines) scheduled for deletion, still called from `main.ts:1139, 1361`. `src/migrations/sceneAnalysis.ts` (v5-era) runs at `main.ts:582` on every load. 44 `@deprecated` markers remain across non-test `src/` (`grep -rn '@deprecated' src --include='*.ts' | grep -v test`). Half-finished deprecations: `targetCompletionDate` (`settings.ts:1076`) still read as a runtime fallback in `renderer/components/ProgressTicks.ts:150`, `renderer/ChangeDetection.ts:259`, `utils/sceneHelpers.ts:193`, `services/export/TimelineExportService.ts:104,257`; `synopsisHoverMaxLines` (`:1113` deprecated) still **written** by `AiSection.ts:4163` and read by `SceneAnalysisProcessingModal.ts:621`; `outlineOutputFolder` re-synced by `ConfigurationSection.ts:92`; `aiOutputFolder` ("no longer user-configurable") still has a settings row `ConfigurationSection.ts:65-66` + 5 locale strings. `main.ts:1265, 1274` reads `stageTargetDates` flagged `@deprecated` by eslint. `InquiryArtifactStore.ts:104-138` `migrateInquirySidecarToVisible` (copy-then-delete of user data) has **zero tests**. `InquiryRunnerService.ts:115-121, 2072-2077` accepts a legacy nested `verdict` wire shape alongside the flat one.
- **Suggested next action:** Work `v7-removals.md` sections 1–3 to completion in one PR; finish `synopsisHoverMaxLines` end-to-end as the pattern; add a characterization test for `migrateInquirySidecarToVisible` before touching the store.

### CH-2026-09-04-#11 — Renderer is string-SVG through DOMParser, and reads view-layer globals

- **Status:** Confirmed
- **Category:** doctrine correction (escalate to Architecture Drift)
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Three XML escapers with different character sets is an inconsistency, not a demonstrated hole: the inspected scene-title and attribute paths use context-appropriate escaping. The exposure is that any *future* interpolation site must remember to escape, which DOM building would make structural. Separately, the "pure" renderer reads mutable view state, so it is non-deterministic for identical inputs.
- **Effort:** Not a weekly-cleanup unit; escalate
- **Evidence:** `src/renderer/TimelineRenderer.ts:246-250, 846` returns `{ svgString }`; mounted via `new DOMParser().parseFromString` in `src/utils/svgDom.ts:24-60` from `TimeLineView.ts:2981`; six more round-trips in `services/RendererService.ts:179, 425, 507`. 80+ template-literal SVG sites in `src/renderer/**`. `SynopsisManager.ts:796, 844, 2470` parse author text through `<div>${html}</div>`. `renderer/TimelineRenderer.ts:30` and `renderer/ChangeDetection.ts:10` import `isRuntimeModeActive` from `view/interactions/ChronologueShiftController.ts` whose state is module-level `let`s at `:54, 60, 66`. `services/SceneDataService.ts:514-523` `isSceneFile` (metadata-cache based) has zero callers; the live `plugin.isSceneFile` (`main.ts:764`) scans open views' private `sceneData` and then the rendered SVG DOM, returning `false` when no timeline is open. `TimeLineView.ts:250-255` wraps `createModeManager` in a swallowing try/catch, and dead `if (modeManager) … else` fallbacks exist at `GossamerCommands.ts:557-575, 644-689`, `TimeLineView.ts:928`, `ModeToggleController.ts:192`.
- **Suggested next action:** This week: unify the three escapers on `utils/svg.ts:16`, delete the unused `SceneDataService.isSceneFile` or switch callers to it, remove the no-ModeManager fallback branches. Escalate string-SVG and the layering inversion.

### CH-2026-09-04-#12 — CSS: ~470 producer-less classes, `rt-ui.css` as feature accretion, raw colour not shrinking

- **Status:** Confirmed (counts, heuristic ±5%); Hypothesis (deletable share)
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** 1.34 MB shipped stylesheet; existing scanners are narrower than they report (`scan-ert-classes.mjs` checks constants → CSS, not CSS → producers; `check-css-duplicates.mjs` reads only top-level `src/styles/*.css`, skipping `features/` and `legacy/`).
- **Effort:** 1 day for deletion + a ratchet; splitting `rt-ui.css` is a Refactor Board item
- **Evidence:** `node scripts/audit/unused-css.mjs`: 3,594 classes defined; 729 with no exact TS producer; 244 of those have a template-prefix producer and 12 look like Obsidian core, leaving 473 (by file: `rt-ui.css` 126, `modal.css` 99, `inquiry.css` 65, `features/beat-system.css` 34, `features/ai-settings.css` 32, `pulse.css` 31). Spot-check of 10: 8 have zero producers anywhere (`ert-pulse-modal`, `ert-inquiry-header`, `rt-scene-title-small`, `ert-ai-key-status`, `ert-search-hidden`, `ert-completion-quote-text`, `ert-timeline-repair-status-pill`, `ert-beat-tier-line`). `rt-ui.css` (10,720) holds 169 `.ert-ai*` rules while `features/ai-settings.css` exists, plus `import` 161, `bookmeta` 107, `apr` 76, `campaign` 54, `audit` 47, with feature banners at `:2235, 6381, 6636, 9950, 4410-4540, 10001-10263`. `pulse.css` (4,016) is a Book Designer/manuscript/gossamer/tooltip grab-bag with 65 hex + 143 `rgba()` literals. `css-drift-check` raw-hex WARN is 186, delta 0 — ratcheted but not shrinking. Hex token definitions live in five files (`variables.css` 48, `briefing.css` 38, `rt-ui.css` 29, `inquiry.css` 9, `modal.css` 6). In TS: 40 hex in `utils/aprPaletteGenerator.ts`, 25 in `AuthorProgressSection.ts`, 21 in `settings/defaults.ts`, 19 in `InquiryView.ts`; `utils/constants.ts:10-13` `STATUS_HEX` documented as "keep in lockstep" with `variables.css` with no check.
- **Suggested next action:** Delete the verified producer-less classes starting with `modal.css`'s dead `ert-pulse-modal*`/`ert-subplot-picker*`/`ert-text-input-modal*` block; add the CSS→producer scan to `css-drift-check.mjs` as a ratchet; fold `check-css-duplicates.mjs`'s `!important` rule into it and retire the root script.

### CH-2026-09-04-#13 — Tests that lint source text instead of behaviour; no tests on the vault-mutation paths

- **Status:** Confirmed
- **Category:** test hardening
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Refactors break tests that assert nothing about behaviour; the code that actually rewrites author YAML has no direct coverage.
- **Effort:** ongoing; 2–4 h per file for the pure-utility wins
- **Evidence:** 35 test files do `readFileSync` of `src/**/*.ts` or `.css` (254 direct reads by the reviewer's AST pass; a grep pass gave 31/245; targets: `settings/sections` 64, `InquiryView.ts` 54, `inquiry/runner` 13). `AiSection.test.ts` has 41 `it` / 53 source reads / 0 behavioural cases; `InquiryView.test.ts` is 86 source-string assertions. Zero behavioural coverage of `runInquiry`, omnibus, pending-edits writeback, `buildCorpusEntryList`. No test file at all: `BeatPropertiesSection.ts` (5,788), `AuthorProgressSection.ts`, `ProgressSection.ts`, `CommunityShareSection.ts`, `OnboardingModal.ts` (1,453), `OnboardingService.ts` (934), `WelcomeScreen.ts`, `ChronologueShiftController.ts` (1,882), `TimelineRenderer.ts`, `gossamerLayer.ts`, `SceneInteractionManager.ts`, `RendererService.ts`, `main.ts`, `SynopsisManager.ts`; `src/modes` 8 files / 0 tests; `src/ui` 5 / 0; `src/sceneAnalysis` 12 / 2 (the `FileUpdater` YAML-write path has none). Pure and untested (cheapest wins): `utils/text.ts` (289, scene-title/number canonical), `utils/beatsSystems.ts` (571), `utils/runtimeEstimator.ts`. Partially covered: `utils/sceneHelpers.ts` (427, 21 exports; `sceneHelpers.sort.test.ts` covers the sorters only) and `utils/planetaryTime.ts` (`tests/planetary-time-conversion.test.ts`). (The first revision listed both as untested; corrected.) Untested community-client exits: `syncCommunityShareIfDue`, `beginCommunitySharing`, `pauseCommunitySharing`, `resumeCommunitySharing`, `postSessionToCommunityFeed`. Test helpers copied: `function makeFile` ×14 files, `createPlugin` ×8, `makePlugin` ×5. `vitest.config.ts` has no `restoreMocks`/`clearMocks`. 20 test files use real `Date.now()`/`new Date()` without fake timers (mostly relative fixtures; flakiness Hypothesis). Certification: `anthropicCertification.test.ts:213` is `skipIf`; last report `docs/audits/anthropic-certification.json` is 2026-04-15 against `claude-sonnet-4-6`, no longer in the registry.
- **Suggested next action:** Add vitest for `text.ts`, `beatsSystems.ts`, and the non-sort half of `sceneHelpers.ts` before #6 touches them; hoist `makeFile`/`createPlugin` into `tests/helpers/`; re-run `npm run certify:anthropic`.

### CH-2026-09-04-#14 — Lint posture: 328 `eslint src` problems outside the enforced ratchet; `@ts-ignore` and inline styles without `SAFE:`

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** The enforced lane tracks five rules at zero; the full config reports 314 type-unsafe hits (`no-unsafe-assignment` 135, `-member-access` 103, `-call` 56, `-argument` 10, `-return` 9, `-enum-comparison` 1) concentrated in two files. The report-only Obsidian lane read 573 on 2026-09-01 (`prefer-create-el` 236) but 328 with 2 obsidianmd hits at this audit's gate run, so that spike was transient; the 328 are the same `no-unsafe-*` set as `eslint src`.
- **Effort:** 1 day for the two hot files
- **Evidence:** `src/SceneAnalysisCommands.ts` 62, `src/inquiry/InquiryView.ts` 58, `settings/sections/beats/dirtyState.ts` 17, `services/SubplotManagementService.ts` 15. `@ts-ignore` ×7 with no `SAFE:` (`modals/RuntimeProcessingModal.ts:326,328`, `ManuscriptOptionsModal.ts:497,499,1069,1071`, `SceneAnalysisProcessingModal.ts:1614`); 7 `as unknown as` casts and 25 `.style.` lines without `SAFE:` (`ManuscriptOptionsModal.ts:3152-3154`, `RuntimeProcessingModal.ts:169` `style.cssText =`, `AuthorProgressSection.ts:384-385, 591, 596-597`). `no-base-to-string` ×8 at `modals/OnboardingModal.ts:1076-1131` (frontmatter values stringified — real bug class). `modes/ModeDefinition.ts:226` enum comparison. `ai/localLlm/transport.ts:310, 417` `fetch` (intentional for abort; `requestUrl` fallback exists). `settings/SettingsTab.ts:48` no `getSettingDefinitions()` (settings invisible to Obsidian 1.13 search). `services/CommandRegistrar.ts:94` plugin-id in command id. `.eslintignore` deprecated warning on every run; `.eslintrc` (legacy) coexists with `eslint.config.mjs`; `.lintstagedrc` references a tool not installed.
- **Suggested next action:** Fix the 8 `no-base-to-string` sites (real); type the frontmatter access in `SceneAnalysisCommands.ts`; annotate or remove the 7 `@ts-ignore`; delete `.eslintignore`/`.eslintrc`/`.lintstagedrc`.

### CH-2026-09-04-#15 — Scripts and repo hygiene

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low; friction and disk.
- **Effort:** 2–4 h
- **Evidence:** Six scripts have no reference in package.json, husky, workflows, or other scripts. Three are documented as deliberate on-demand tools and must **not** be deleted: `scripts/compliance-report.mjs` and `scripts/css-drift-report.mjs` (debt dumpers, headers say so; `docs/engineering/audits/eslint-rule-mapping.md:82` marks css-drift-report **KEEP**) and `scripts/check-translations.mjs` (`eslint-rule-mapping.md:87` marks it **KEEP** for i18n coverage; it reports per-key missing translations, which `check-i18n-release.mjs` does not). Undocumented and likely dead: `scripts/add-api-feature.mjs` (195 lines, 2026-03), `scripts/generate-wiki-sidebar.mjs` (72), `scripts/audit-important.py` (286). (The first revision called all six dead; corrected.) Four `check-*-ert-lock.mjs` (81–93 lines each, 15 shared lines) run serially on every `dev`/`build-only`. `gates:legacy` diverges from `gates` (includes `validate-pricing` deliberately removed from `gates`; lacks 8 newer steps); sole consumer `backup:verbose`. `.gate-logs/` 254 MB / 1,644 runs, never pruned. `.claude/worktrees/epic-rhodes-e170ef` (82 MB, gitignored) inside the repo despite the no-worktrees rule. Root: `test_apr_rendering.html` (tracked, unreferenced), `tmp/` (empty, untracked, unignored), `AGENT_RULES.md` (subset of CLAUDE.md), stale `main.js` from 2026-02-09 at root (ignored; build now writes `build/`), `docs/audits/` 1.2 MB of generated output, `wiki/images` 52 MB tracked. `esbuild.config.mjs:73-83` hardcodes 11 absolute `/Users/` vault paths (dev-only; CI skips missing). `scripts/local-llm-server.mjs:21-22` hardcodes port 8080 while the plugin default is Ollama's 11434 (dev helper, not referenced from src). i18n: en 1,921 leaf keys; de/ja/ko/zh 1,008 each (identical key set); ~160 en keys unused (`settings.authorProgress` 27, `inquiry.runner` 12); `src/i18n/index.ts:151` JSDoc cites a key that does not exist.
- **Suggested next action:** One hygiene commit: confirm and delete the three undocumented scripts, `.lintstagedrc`, `.eslintrc`, `.eslintignore`, `AGENT_RULES.md`, `test_apr_rendering.html`, root `main.js`; wire `check-translations.mjs` (or its missing-key logic) into `check-i18n-release.mjs` rather than deleting it; add `.gate-logs` pruning to `run-gates.mjs`; `git worktree remove` the stray worktree; collapse the four ert-lock scripts into one table-driven script.

---

## Historical Context

| Finding / Theme | Classification |
|---|---|
| CH-#1 privacy path | New (community daily sync shipped 2026-07-16; doctrine not updated) |
| CH-#2 render-time registration | Chronic hotspot — `TimeLineView.ts` is the most-churned file (50 commits / 90 d) |
| CH-#3 stale-snapshot writes | New — catch paths show the rule was known when written |
| CH-#4 service logic in sections | Chronic hotspot — `AiSection.ts` 40 commits / 90 d, `PublishSection.ts` 31 |
| CH-#5 dead code | New to this track; `audit:tsc-unused` exists in package.json but is not in `gates` |
| CH-#6 duplicate helpers | Chronic — no `utils/date` key formatter despite six copies |
| CH-#7 cost fallbacks | Regressed against `fallback-policy.md` (gate total fell 2,497 → 2,429 but these sites are literal-annotated as intentional) |
| CH-#8 hover filters | Previously resolved, resurfaced — `:has()` retired 2026-09-03; `filter:` survived |
| CH-#9 giant functions | Chronic hotspot |
| CH-#10 v7 removals | Intentional debt, now overdue (plan targeted 7.0.0; at 7.2.0) |
| CH-#11 string-SVG renderer | Intentional debt (design choice) — layering inversion is new |
| CH-#12 CSS accretion | Chronic — drift-check ratchet flat at 186 raw-hex |
| CH-#13 source-text tests | Chronic — pattern predates this audit |
| CH-#14 lint | Stable on the enforced lane; report-only lane back to 328 after a transient 573 on 2026-09-01 |
| CH-#15 hygiene | New |

---

## Do Nothing / Monitor

- **`src/ui/reference/ProPill.reference.ts`** — unimported by design (documented visual spec). Leave. Would change if the live PRO pill diverges from it.
- **`transport.ts` `fetch` usage** — needed for `AbortController`; `requestUrl` fallback exists. Leave. Would change if Obsidian adds abort to `requestUrl`.
- **`?? 0` on provider usage counters** — a missing counter is a true zero; most sites carry `SAFE:`. Leave.
- **20 test files using real clocks** — inspected as relative-timestamp fixtures. Monitor for flakes in CI; act on the first one.
- **`main.js` 5.9 MB** — Pandoc assets embedded by decision (#34, #29). Monitor Obsidian load time complaints.
- **`INQUIRY_MAX_OUTPUT_TOKENS = 16000` fallback** — on the protected Inquiry critical path (rule 4). Do not touch without the chunk-budget tests; revisit when #7 lands.
- **Over-exported in-file-only symbols (~518 types/interfaces + ~218 runtime)** — harmless; un-export opportunistically when touching the file.
- **`scripts/local-llm-server.mjs` port mismatch** — dev helper for the MLX worker, not the shipped default. Leave; document in the script header.

---

## Product Doctrine Check

- **Author trust:** Concern — CH-#1 (private titles stored server-side per contract while the repo doctrine and plugin disclosure describe a device-side opt-in) and CH-#7 (cost numbers that can be silently wrong).
- **Non-destructive workflows:** Concern — `InquiryArtifactStore.migrateInquirySidecarToVisible` is copy-then-delete of user data with zero tests (CH-#10); `BeatPropertiesSection.renderAuditPanel` does `trashFile`/`renameFile` from a settings closure with no tests (CH-#4).
- **Core vs Pro gating consistency:** OK — `proEntitlement`/`featureGate` tested; `addProRow` is an identity wrapper (cosmetic, CH-#5).
- **Terminology consistency:** OK — no drift found in the 14-day diff.
- **Obsidian-native behavior:** Concern — `SettingsTab` lacks `getSettingDefinitions()` (CH-#14); string-SVG via `DOMParser` satisfies the `innerHTML` rule by the letter only (CH-#11).
- **Manuscript safety:** Concern — `modals/BookDesignerModal.ts:1811` writes scene `when` as a UTC date (local evenings land on the next day); same bug class the 2026-08 export fix removed. `sceneAnalysis/FileUpdater` YAML-write path untested.
- **Export safety:** OK — `wallClockWhen` is the single scene-time serializer in export; destination folders resolve through one `systemFolderPath`.
- **AI analysis vs AI prose rewriting:** OK — no prose-rewrite paths found. Note (Hypothesis, CH-#1 E): `onboarding/promptSync.ts:69-79` adopts server-supplied prompt text gated only by `schema_version`, then feeds it to the model alongside manuscript text; no signature/pin.

---

## Escalations to other audits

- → **Architecture Drift:** CH-#4 (settings sections as service hosts, inverted `services → settings` imports), CH-#11 (string-SVG renderer; renderer importing view-layer globals; two `isSceneFile`), CH-#9 (12K-line `InquiryView`, 1,160-line writing-session block in `TimeLineView`; three homes for command registration: `CommandRegistrar`, `SceneAnalysisService.ts:25-57`, `RuntimeCommands.ts`).
- → **Obsidian Ecosystem:** CH-#14 (`getSettingDefinitions()`, `prefer-create-el` 236 in the report-only lane, plugin-id in command id), CH-#2 (`Component` registration lifetime).
- → **Refactor Board (next monthly):** CH-#6 (helper consolidation order), CH-#12 (`rt-ui.css` / `pulse.css` split plan), CH-#13 (source-text test replacement strategy), CH-#10 (v7 removal PR).
- → **Owner decision (not an audit):** CH-#1 which document is authoritative (the product contract's server-side private shells, or the repo doctrine's device-side opt-in) and how the plugin discloses it; CH-#8 hover filters.

---

## Next cycle

- **Run on:** 2026-09-11
- **Specific things to re-check:** whether `audit:tsc-unused` was added to `gates`; zero-use export count (`scripts/audit/dead-exports.mjs`) after the `ai/index.ts` barrel is removed (it currently hides drift); producer-less CSS count (`scripts/audit/unused-css.mjs`) after the `modal.css` block deletion; `.gate-logs` size; whether `v7-removals.md` status changed; whether `writing-session-privacy.md` was reconciled with the product contract; `TimeLineView.renderTimeline` registration count per render.
- **If skipping this cadence, why:** —

---

## Appendix — mechanical baseline commands

```bash
npx tsc --noEmit                                    # clean
npx tsc -p tsconfig.audit.json --noEmit             # 132 TS6133 + 1 TS6138
npx eslint src                                       # 328 problems (313 no-unsafe-*)
npx vitest run --reporter=dot                        # 3267 pass / 2 skipped
node check-css-duplicates.mjs                        # pass
node code-quality-check.mjs --all                    # pass
node scripts/fallback-gate.mjs                       # 2429 (baseline 2497)
node scripts/lint-obsidian-enforced.mjs              # 0 on all five ratcheted rules
node scripts/scan-ert-classes.mjs                    # 0 unused (constants→CSS only)
node scripts/audit/dead-exports.mjs                  # 136 ZERO-USE (--all adds IN-FILE-ONLY 681, TEST-ONLY 240)
node scripts/audit/unused-css.mjs                    # 473 hard-unused of 3,594
node scripts/audit/long-functions.mjs 80             # 188 ≥80, 67 ≥200, 20 ≥400, 4 ≥1000
```

The three `scripts/audit/*.mjs` scanners were added with this report so the counts reproduce; they are regex/indentation heuristics, not AST passes, and their output is a candidate list to verify with `grep -rw` before acting. The i18n unused-key list (~160) was produced by an ad-hoc scratchpad script and is the one number here without a committed reproducer; `check-i18n-release.mjs` should grow that check (CH-#15).
