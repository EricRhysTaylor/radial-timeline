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
- **Status (2026-09-04):** Reconciled to the contract. `writing-session-privacy.md` is rewritten: two audiences (private, community), the private-shell model stated as server-side and named as the exit that carries the working title, every exit point listed with its gate, and the contract named as the document that wins on conflict. The never-shipped `friends` projection and the parallel `projectCommunityDaily`/`buildCommunityDailyLog`/`redactTime` (zero production callers, no contract surface) are deleted rather than adopted; the shipped aggregator (`buildDailyWritingStats`) is the one the plugin's own Progress view uses, so it stays canonical. The tracer contract now runs against the real wire path: `communitySharePreview.test.ts` feeds traced records, traced scene data, and a traced working title with no public label through `buildCommunityDailyEntries`, `buildCommunityHourModeMixEntries`, and `buildCommunitySharePreview` (every field enabled) and asserts no tracer and no title field. Disclosure copy now says connecting lists Book Manager books privately on My Share: privacy doc, wiki, README, the Connect and Linked rows in the Community settings tab. The `:579` test keeps asserting the working title is sent, with a comment citing the contract. Not done: the field manifest still does not list the shell fields (the manifest describes the report payload, which is a different message; adding shell fields to it would misdescribe the report).

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
- **Status (2026-09-04):** Actioned. `RadialTimelineView.renderScope` is a child `Component` created lazily per render and removed (unloaded) at the top of the next `renderTimeline` and with the view. All 61 render-time registrations in the view, the mode setups (`AllScenesMode`, `MainPlotMode`, `ChronologueMode`, `GossamerMode`), and the interaction controllers (`OuterRingDragController`, `ChronologueDragController`, `ChronologueShiftController`, `ModeToggleController`, `RotationController`, `HelpIconController`, `VersionIndicatorController`, `SceneContextMenu`, `SearchInteractions`) now go through it; the narrow view interfaces expose `renderScope` instead of `registerDomEvent`. The drag hold timer and both Gossamer-panel refresh timers are scoped the same way. `onClose` clears `timelineRefreshTimeout` and the two session-pulse timers; the dead `_tabHighlightTimeout` field is gone. `main.ts` registers the 20 s community kickoff timer for cleanup, and `cancelPendingCommunityProjectSync()` runs on plugin unload. The Obsidian test mock's `Component` now models load/unload/addChild/removeChild so `TimeLineView.renderScope.test.ts` proves cleanups run on the next render and on view unload. **Follow-up (same day, after review):** two per-render surfaces were missed. The Gossamer-runs panel and its toggle rows (21 registrations) are rebuilt every render and now use `renderScope`; the writing-session panel is emptied and rebuilt on every state change and now has its own `sessionPanelScope`, reset in `renderWritingSessionPanel`, so its controls' listeners live as long as one build rather than the view. Inquiry's tooltip listeners were checked and are correct as they are: `InquiryView.rootSvg` is created once per view, so view-lifetime registration matches the element's lifetime. Still open: ad-hoc timers in `GossamerCommands.ts:652,687` and `BeatLabelAdjuster.ts:73,123` (short, cosmetic).

### CH-2026-09-04-#3 — Community share: stale-snapshot writes and no in-flight guard

- **Status:** Confirmed
- **Category:** stabilization
- **Severity:** ORANGE
- **Confidence:** High
- **Risk:** A Pause clicked during a publish is silently reverted (`sharingPaused` back to `false`, pause history entry dropped). Concurrent publishes from the 20 s timer, 6 h interval, resume, and settings preview can double-post.
- **Effort:** 2–3 h
- **Evidence:** `src/communityShare/communityShareClient.ts:258` captures `current`, awaits at `:281` and `:286`, then writes `{...current, …}` at `:318-344`. Same shape at `:800` (after await `:797`), `:876`, `:934`, and `src/settings/sections/CommunityShareSection.ts:644, 667` (after await `:639`). The catch paths at `:761` and `:821` correctly re-read, showing the rule is known. `syncCommunityShareIfDue` has no in-flight promise guard (`websiteContextInflight` at `:600` exists only for context fetch). Five different "is sharing active" predicates: `:266-269, 412, 590, 718-720, 789-794, 980-985` plus `src/types/settings.ts:106-113`.
- **Suggested next action:** Re-read `normalizeCommunityShareSettings(plugin.settings.communityShare)` after every await before writing; one in-flight promise for `syncCommunityShareIfDue`; one `resolveShareCapability(settings)` consumed by all seven gate sites.
- **Status (2026-09-04):** Stale-snapshot writes and the in-flight guard are actioned. `commitCommunityShare(plugin, live => …)` in `communityShareClient.ts` re-reads the live settings at write time and is now the only way publish, scheduled sync (success and failure paths), daily-sync stop, revoke, disconnect, and the settings-section preview builder write settings; each layers only its own change onto the live state. `syncCommunityShareIfDue` shares a single in-flight promise across the startup timer, 6 h interval, Resume, and the preview builder. Both sync paths re-check `sharingPaused` after their preview/aggregate awaits and skip cleanly instead of publishing or logging a failed sync. Three tests in `communityShareClient.test.ts` reproduce the race (Pause mid-request, Pause mid-preview, overlapping syncs) and fail on the pre-fix code. **Follow-up (same day, after review):** the first pass fixed the *write* side only; consent was still evaluated on the pre-await snapshot, so a Pause during the preview build or a Disconnect during the secret read could still be crossed by the send, and a disconnect that failed server-side left an already-read secret usable. `assertStillSendable` / `isStillSendable` now re-read live settings immediately before every `requestUrl` (publish, APR upload, project sync, session post, website context and revoke with pause allowed, daily sync silently). Three more tests cover Pause-during-preview, Disconnect-during-aggregate-build, and Disconnect-during-secret-read; all three fail on the previous client. **Still open:** the five "is sharing active" predicates are not unified; that changes gating semantics (e.g. whether project sync respects tier) and depends on the CH-#1 contract decision.

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
- **Correction (2026-09-04):** The "inverted import" claim was wrong. Nothing outside `SettingsTab.ts` imported from `PublishSection.ts`; `PublishingValidationService.ts` carried its own private copy of `parseBookMetaFromFrontmatter` and `bookPagesResolver.ts` only mentioned the section in a comment. The real defect was the 1,575-line service body living in the section plus two duplicated helpers, not a dependency inversion.
- **Status (2026-09-04):** `PublishSection.ts` actioned; `AiSection.ts` and `BeatPropertiesSection.ts` remain open. The section went from 4,503 to 3,063 lines and now holds only UI. The moved logic lives in five `src/publishing/` modules with one job each: `toolchainScan.ts` (find Pandoc/LaTeX; `isPandocPathValid` is now a pure string check), `matterRepair.ts` (`planMatterRepairForNote` is a pure frontmatter → repair decision; the vault walk and `processFrontMatter` write are separate), `activeBookNotes.ts` (reads of the active book's Book Details and matter notes), `readinessSummary.ts` (the settings card's status), and `starterSetup.ts` (auto-configure writes, template-path helpers, starter notes). Subtraction first: the section's duplicate `parseBookMetaFromFrontmatter` is deleted in favour of the service's, now exported; its duplicate `compactTemplatePathForStorage` is deleted in favour of `templateImport.ts`, which itself now uses `getPandocFolder` instead of a third pandoc-folder resolver; three in-file ensure-folder loops collapse to one `ensureVaultFolderPath`; the starter Book Details body is built once (`buildBookMetaSampleContent`) instead of twice; the `getConfiguredPandocFolder` alias is gone. Starter sample bodies were checked byte-for-byte against the pre-refactor arrays. 26 behavioural tests were added across `matterRepair`, `starterSetup`, and `toolchainScan`. Net −1,413 lines.
- **Status (2026-09-04, second pass):** `AiSection.ts` and `BeatPropertiesSection.ts` actioned; the finding is closed. AiSection (4,282 → 3,765 lines) keeps only UI; its service bodies now live under `src/ai/` with one job each: `cost/costComparison.ts` (the priced-model list and the per-model fresh/cached row computation, session lookups injected), `localLlm/detection.ts` (server candidates, the parallel probe, auto mode's server and model choice; the `no counterpart under localLlm/` gap is closed), `credentials/keyValidation.ts` (the one quick cloud-key check; `SettingsTab.scheduleKeyValidation` now uses it instead of its own fetch-and-regex copy, so the two surfaces cannot disagree), `forecast/vaultForecast.ts` and `forecast/manifestCorpusEstimate.ts` (the capacity forecast and the manifest corpus estimate, which now runs on `buildRTCorpusEstimateFromChars` instead of a second copy of the chars-to-tokens arithmetic). BeatPropertiesSection (5,789 → 5,400 lines): the audit panel's two planners are `planFillEmptyValues` and `planDeprecatedFieldMigration` in `utils/yamlBackfill.ts`, beside the runners they feed; the delete confirmation's count-and-sample block is `summarizeDeletePreview` in `utils/yamlManager.ts`; the structure lines and the preview-issue readers are in `storyBeats/beatSystemStatus.ts` (`describeStructuralStatus`, `getPreviewIssueEntries`), whose `normalizeBeatTitle`/`clampBeatAct` are now exported instead of copied; `storyBeats/beatRows.ts` (`parseBeatRow`, `orderBeatsByAct`), `storyBeats/mergeBeatNotes.ts` (`planBeatNoteMerge` / `applyBeatNoteMerge`), `utils/metadataCacheWait.ts` (the two cache waits), and `beatsTemplates.buildPlotSystemFromLoadedTab` hold the rest. Subtraction found on the way: the merge's temp-rename dance and its `conflicts` list were dead (every update targeted its own path, and nothing ever pushed a conflict), so both are gone. The deletion snapshot writer was already a service (`logVaultOps.writeDeletionSnapshot`); the finding overstated that one. `CustomBgPresetModal` moved to `src/modals/` on `ErtModal` and no longer takes an unused plugin argument. Tests: 11 files, 62 behavioural cases on the moved logic; five source-text pins that pointed at moved code were replaced. **Still in the sections by design:** the renderers, the modal confirmations, and the state machines that own in-flight promises (local LLM detect/load/validate) — those are the UI. Net −607 lines across the two commits.

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
- **Status (2026-09-04):** Ten families consolidated, 53 files, net −316 lines. Local date key: `formatLocalDateKey`/`parseLocalDateKey` in `utils/date.ts`, seven formatter copies and three parsers gone; the two parsers that returned `new Date()` on bad input now fail with a clear error (`WritingSessionService.dateRangeSet`, `GoalsSessionsSection.daysInCurrentYearToDate`). Angles: `renderer/utils/angles.ts` with `normalizeAngleSigned` ((−π, π]) and `normalizeAngleUnsigned` ([0, 2π)); the four copies now name which contract they want. Escapes: `utils/svg.escapeXml` replaces five narrower copies; `utils/regex.escapeRegExp` replaces three copies and three inline sites; `cssEscape` and `clamp` (new `utils/math.ts`) deduplicated. `slugifyToFileStem` lives once in `utils/books.ts`. `countWords` moved to `utils/text.ts` as the one definition (four copies gone). `resolveAccessTier` is imported at all five former copy sites. `services/export/svgToPng.ts` holds the one rasteriser; APR applies its density on top. `runtimeRatesFromSettings` in `runtimeEstimator.ts` replaces three copies of the rate defaults. `utils/paths.ts` (`basename`, `fileStem`) replaces six copies; `onboarding/paths.basename` delegates after `normalizePath`. FNV-1a: **correction to the finding** — the "shift-add" and multiply forms are the same arithmetic (the shift sum is the FNV prime), so the seven copies were one algorithm with two output paddings; `utils/hash.ts` has one core and two formatters (`fnv1a32Hex` padded for ids and fingerprints, `fnv1a32HexUnpadded` for persisted cache keys and log fingerprints) with reference-vector tests proving both outputs are unchanged. **Second pass (same day):** the remaining families, 47 files, net −399 lines. Frontmatter: `stripFrontmatter` in `frontmatterDocument.ts` is the one body-strip (CRLF tolerant, closing fence must end a line or the document, consumes the fence's line break); `extractBodyAfterFrontmatter` shares its regex source; the five private regexes (`manuscript`, `RepairPipeline`, `sceneAnalysis/data`, `sceneAnalysis/Maintenance`, `RuntimeCommands`) and `evidenceCleaning`'s copy are gone, and the two scene-analysis sites now use the offset-aware canonical instead of a regex that accepted `---foo` as a fence. Slugs: `utils/slug.ts` holds the two contracts, `kebabSlug(value, fallback)` (lowercase, ids and generated file names; replaces `aprPaths.slugify`, `AprStyleService.sanitizeName`, `TimelineExportService.slugify`, the `localLlm` alias inline, `bookPagesResolver.normalizeForRoleMatch`, and `secretStorage.normalizeSecretId`, which was the same arithmetic written differently) and `slugifyToFileStem(title, fallback)` (case-preserving; moved from `books.ts`, `templateImport`'s lowercase copy deleted). Sleep: `utils/sleep.ts`; 14 inline `new Promise(setTimeout)` sites and `openaiApi`'s private copy replaced. Debounce: `TimelineRepairModal` uses Obsidian's `debounce` (with `cancel()` on close and rebuild) instead of a timer field and three clear blocks. Community client: `postCommunityFunction(endpoint, body, guard, failure, unexpectedMessage)` is the one request path; the seven hand-copied non-2xx blocks, `callReportAction`'s body, and the session-post variant are gone (the client now has one `requestUrl` call plus the fire-and-forget cleanup). One semantic change: a 2xx session-post body without `ok:true` is now `invalid_response` rather than the body's own code. Name prompts: `ui/NamePromptModal.ts` on `ErtModal` replaces `CampaignNameModal`, `BookRenameModal`, `PlanetaryProfileNameModal`, and `AiContextModal`'s `TextInputModal` (−230 lines); the planetary prompt gains the standard `.ert-modal-header` wrapper. Stage colours: `publishStageColors` is a required settings record, so the seven `?? '#808080' / '#9E70CF' / '#6FB971'` fallbacks were dead and are deleted along with `SynopsisManager`'s fifth colour set (`#9370DB`…); the estimate-tick icon in Progress settings now takes the actual Press colour instead of a hardcoded one; `getPublishStageStyle` maps a stage string the settings do not know to `var(--text-muted)` rather than a hex. Subplot colours (not listed in the original evidence but the same disease): `renderer/utils/subplotColors.ts` (`readSubplotColor(doc, index)`, `normalizeSubplotColorIndex`) replaces five readers with `'#EFBDEB'` fallbacks and `SynopsisManager`'s throwing one, which used `% 15` instead of 16 and so mis-coloured the sixteenth subplot on hover; `ThemeService` sets the variables on every RT document, so a missing variable now throws as a setup fault. `dragGeometry.resolveSubplotColorFromGroup(group)` is the one group-based resolver (`SceneContextMenu`'s copy deleted, the settings-array fallback dropped). **Left as is, with a reason:** `deriveCacheResult` ×3 is three provider semantics (Google trusts the client-side cache status, OpenAI infers from usage plus whether a cache key was sent, Anthropic from usage alone) sharing only two return literals; a shared abstraction would hide the difference that matters. Tests: `slug.test.ts`, `subplotColors.test.ts`, and five `stripFrontmatter` cases; suite at 3,316.

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
- **Status (2026-09-04):** Actioned, with one refinement to the finding. `estimateCorpusCost.ts` is now the only cost engine: `estimateOmnibusCostRange` lives there and shares its rate helpers; `omnibusCacheHealth.ts` no longer prices anything. A cache-write rate is taken only for the TTL the run requested; a model that prices writes explicitly but lacks that TTL's rate yields "unavailable" (`estimateCorpusCost` throws, the omnibus band omits `cachedUSD`) instead of the other TTL's number. The `?? inputRate` substitution turned out to be two cases: for providers with no explicit write price (OpenAI, Gemini) the priming pass genuinely bills at the input rate, and that stays; for Anthropic it was a substitution and is gone. `toUsd` no longer returns $0 for an unknown rate; callers check the rate first. Actual-usage pricing takes the run's requested TTL (`ANTHROPIC_REQUESTED_CACHE_TTL`) so creation tokens reported without a per-TTL split are priced at the TTL actually asked for, and left unpriced when none is known; the three `'1h'` literals now reference that constant. `estimateHeuristicInputTokens` in `inputTokenEstimate.ts` is the one chars/4 request heuristic; `aiClient` model selection and the displayed estimate use it. `selectModel` states that an omitted `contextTokensNeeded` means "resolving a policy with no request in hand, no context filter" rather than defaulting to 0. The Pulse error log no longer labels a run with no configured provider as OpenAI. 9 cost tests added (strict TTL, unattributed creation tokens, omnibus band rules incl. an exact-arithmetic anchor). **Left as is:** `INQUIRY_MAX_OUTPUT_TOKENS` fallback (protected by critical-path rule 4 and the chunk-budget tests) and the `'Finding'` headline substitute (rendering change on the protected path; needs its own decision).

### CH-2026-09-04-#8 — Filters on the scene hover path

- **Status:** Confirmed (presence); Hypothesis (perceptible cost)
- **Category:** stabilization
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** Contradicts the owner rule the recent `:has()` commits enforced (`memory: no-blur-animation-near-scene-hover`); drop-shadow/blur filters inside the SVG on hover are exactly what that note forbids.
- **Effort:** 1–2 h once decided
- **Evidence:** `src/styles/scenes.css:305-307` `.rt-scene-title.rt-selected { filter: url(#sceneTitleHalo) }` — `rt-selected` is applied on **hover** by `SceneInteractionManager.ts:312-325` (`applySelection` from `doSceneHover`); halo is `feFlood`+blur in `renderer/components/Defs.ts:118`. `timeline.css` ~459/701/939 `[data-shift-mode] .rt-scene-group:hover { filter: brightness()/drop-shadow() }`. `indicators.css` 12× `:hover { filter: drop-shadow(...) }` inside `.radial-timeline-container`. `base.css` `.rt-scene-path.rt-selected { filter: saturate() brightness() }`. `scenes.css:652` `filter: saturate(1.5)`. 45 rules with `scene|hover` in the selector declare `transition`/`animation`/`filter`. `:has()` = 0, `!important` = 0.
- **Suggested next action:** Owner decision. If the rule holds, replace the halo with a stroke/opacity change and drop the shift-mode hover filters.
- **Status (2026-09-04):** Actioned; the owner rule holds. Every `filter` on a hover or `rt-selected` rule inside the timeline is gone (22 declarations across `scenes.css`, `base.css`, `timeline.css`, `indicators.css`) and the two SVG filter defs they referenced (`beatTextBg`, `sceneTitleHalo`) are deleted from `Defs.ts`. Same visual cue, different mechanism: the scene-title and storybeat halos are now `paint-order: stroke fill` with a black stroke under the glyphs (2.4px at 0.85 opacity for scene titles, 3.6px for beat titles, matching the old dilate radii); `.rt-scene-path.rt-selected` and the shift/alien/runtime hover states use a stroke instead of `brightness`/`drop-shadow`; the subplot dominance flag deepens its colour mix instead of `saturate`; the version, help, target-tick, milestone, estimate-tick, and APR indicators use an opacity or stroke-width step instead of `drop-shadow`, and their `transition: filter` entries are removed; the session-panel primary button uses a background tint. `scripts/css-drift-check.mjs` gains a hard-fail `hover-filter` rule scoped to timeline chrome selectors (`.radial-timeline-container`, `.rt-`, `.ert-timeline-`) so the filters cannot return; modal/settings hovers outside the timeline are not in scope. `filter: none` and `backdrop-filter` on non-hover rules are unaffected. Verification: tsc, 3,302 tests, css-drift maintenance, css-duplicates, code-quality, compliance, fallback all green.

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
- **Status (2026-09-04):** The three named units are done; the section-file splitting stays escalated. `inquiry/render/inquirySvgDefs.ts` holds `buildIconSymbols`, `buildZoneGradients` (486 lines, pure over the defs element plus the style source and minimap it reads), and `buildSceneDossierResources`. Of the 40 `*Pure` forwarders, 25 were exact pass-throughs and are deleted (callers use the pure helper directly; the `x as xPure` aliases are plain imports); the 15 that inject view state are adapters and stay. `finishOmnibusRun` is the one ending for both omnibus runners. `InquiryView.ts` 12,173 → 11,510 lines. **Correction to the finding:** the two omnibus tails shared 22 contiguous lines plus four smaller blocks, not 77 contiguous lines; the 22 are what moved. **Not done:** the four render functions ≥1,000 lines are unchanged (`renderPublishSection` 2,843, `renderAuthorProgressSection` 1,892, `renderInquirySection` 1,672, `setupChronologueShiftController` 1,026), the 1,160-line writing-session block in `TimeLineView`, `handleManuscriptExport`, and `loadSettings` sectioning. Those are the Refactor Board items.

### CH-2026-09-04-#10 — Overdue v7 removals and unfinished deprecations

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Each shim is a second code path; one (`sceneAnalysis` migration) runs an ungated `getMarkdownFiles()` sweep on every load.
- **Effort:** 1 day
- **Evidence:** `docs/engineering/plans/v7-removals.md` is `status: pending`, target 7.0.0; package is 7.2.0. `TODO(v7)` ×3 at `src/authorProgress/authorProgressConfig.ts:67, 84, 309`. `src/migrations/beatSettings.ts` (436 lines) scheduled for deletion, still called from `main.ts:1139, 1361`. `src/migrations/sceneAnalysis.ts` (v5-era) runs at `main.ts:582` on every load. 44 `@deprecated` markers remain across non-test `src/` (`grep -rn '@deprecated' src --include='*.ts' | grep -v test`). Half-finished deprecations: `targetCompletionDate` (`settings.ts:1076`) still read as a runtime fallback in `renderer/components/ProgressTicks.ts:150`, `renderer/ChangeDetection.ts:259`, `utils/sceneHelpers.ts:193`, `services/export/TimelineExportService.ts:104,257`; `synopsisHoverMaxLines` (`:1113` deprecated) still **written** by `AiSection.ts:4163` and read by `SceneAnalysisProcessingModal.ts:621`; `outlineOutputFolder` re-synced by `ConfigurationSection.ts:92`; `aiOutputFolder` ("no longer user-configurable") still has a settings row `ConfigurationSection.ts:65-66` + 5 locale strings. `main.ts:1265, 1274` reads `stageTargetDates` flagged `@deprecated` by eslint. `InquiryArtifactStore.ts:104-138` `migrateInquirySidecarToVisible` (copy-then-delete of user data) has **zero tests**. `InquiryRunnerService.ts:115-121, 2072-2077` accepts a legacy nested `verdict` wire shape alongside the flat one.
- **Suggested next action:** Work `v7-removals.md` sections 1–3 to completion in one PR; finish `synopsisHoverMaxLines` end-to-end as the pattern; add a characterization test for `migrateInquirySidecarToVisible` before touching the store.
- **Status (2026-09-04):** Sections 1–2 done, section 3 partly; the plan doc records the rest with dates. Removed: the `'bar'`/`'thumb'` shims (zero `TODO(v7)` left); `migrations/sceneAnalysis.ts` (v4-era, the ungated every-load vault sweep) and `migrations/beatSettings.ts` (v5-era, 436 lines) with their call sites and the deprecated `beatSystem`/`activeCustomBeatSystemId` fields. Finished end to end: `targetCompletionDate` (absorbed into the active book's Press target on load when the book had no stage targets, the only case the legacy tick rendered; tick, change-detection key, export field gone), `synopsisHoverMaxLines`, `aiOutputFolder`, `outlineOutputFolder`. `loadSettings` sweeps the six finished keys out of `data.json`. `migrateInquirySidecarToVisible` has a five-branch characterisation test. `@deprecated` markers 38 → 30. **Kept on purpose:** the plaintext-key migration and strip (a privacy scrub), the nested-`verdict` tolerance (a model-behaviour guard). **Verified 5.x-era and left for a deliberate cut with release notes:** `migrateAiSettings`, the pandoc/backdrop/export-folder/layout-id moves, book seeding from `sourcePath` (all first shipped under manifest 5.0.2; dates in the plan doc).

### CH-2026-09-04-#11 — Renderer is string-SVG through DOMParser, and reads view-layer globals

- **Status:** Confirmed
- **Category:** doctrine correction (escalate to Architecture Drift)
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Three XML escapers with different character sets is an inconsistency, not a demonstrated hole: the inspected scene-title and attribute paths use context-appropriate escaping. The exposure is that any *future* interpolation site must remember to escape, which DOM building would make structural. Separately, the "pure" renderer reads mutable view state, so it is non-deterministic for identical inputs.
- **Effort:** Not a weekly-cleanup unit; escalate
- **Evidence:** `src/renderer/TimelineRenderer.ts:246-250, 846` returns `{ svgString }`; mounted via `new DOMParser().parseFromString` in `src/utils/svgDom.ts:24-60` from `TimeLineView.ts:2981`; six more round-trips in `services/RendererService.ts:179, 425, 507`. 80+ template-literal SVG sites in `src/renderer/**`. `SynopsisManager.ts:796, 844, 2470` parse author text through `<div>${html}</div>`. `renderer/TimelineRenderer.ts:30` and `renderer/ChangeDetection.ts:10` import `isRuntimeModeActive` from `view/interactions/ChronologueShiftController.ts` whose state is module-level `let`s at `:54, 60, 66`. `services/SceneDataService.ts:514-523` `isSceneFile` (metadata-cache based) has zero callers; the live `plugin.isSceneFile` (`main.ts:764`) scans open views' private `sceneData` and then the rendered SVG DOM, returning `false` when no timeline is open. `TimeLineView.ts:250-255` wraps `createModeManager` in a swallowing try/catch, and dead `if (modeManager) … else` fallbacks exist at `GossamerCommands.ts:557-575, 644-689`, `TimeLineView.ts:928`, `ModeToggleController.ts:192`.
- **Suggested next action:** This week: unify the three escapers on `utils/svg.ts:16`, delete the unused `SceneDataService.isSceneFile` or switch callers to it, remove the no-ModeManager fallback branches. Escalate string-SVG and the layering inversion.
- **Status (2026-09-04):** The week's items are done; string-SVG stays escalated. The escapers were unified under CH-#6 (`utils/svg.escapeXml`). `plugin.isSceneFile` now delegates to `SceneDataService.isSceneFile` (Class: Scene from the metadata cache), so a scene is a scene whether or not a timeline is open; the highlighter's view-and-DOM scan that returned false with no view is deleted. `RadialTimelineView` constructs its `ModeManager` and `ModeInteractionController` unconditionally (both constructors only assign fields) and exposes them non-optionally, so the four no-manager fallback branches (`TimeLineView.switchTimelineModeFromNav`, `ModeToggleController.switchToMode`, and both halves of `GossamerCommands` enter/exit, together ~90 lines that duplicated the manager's job) are gone with the swallowing `try/catch` around construction. **Layering:** `src/renderer` no longer imports anything from `src/view`: `createTimelineSVG` takes `runtimeModeActive` in its options and `createSnapshot` takes it as a parameter; `RendererService` (a service, which already depended on `view/interactions`) and the view read the controller's module state and pass it in, so the renderer is deterministic for identical inputs. **Still escalated:** the string-SVG renderer through `DOMParser` and the three `SynopsisManager` author-text parses through `<div>${html}</div>` (`:799, :846, :2464`) are the Architecture Drift items; not touched here.

### CH-2026-09-04-#12 — CSS: ~470 producer-less classes, `rt-ui.css` as feature accretion, raw colour not shrinking

- **Status:** Confirmed (counts, heuristic ±5%); Hypothesis (deletable share)
- **Category:** cleanup
- **Severity:** YELLOW
- **Confidence:** Medium
- **Risk:** 1.34 MB shipped stylesheet; existing scanners are narrower than they report (`scan-ert-classes.mjs` checks constants → CSS, not CSS → producers; `check-css-duplicates.mjs` reads only top-level `src/styles/*.css`, skipping `features/` and `legacy/`).
- **Effort:** 1 day for deletion + a ratchet; splitting `rt-ui.css` is a Refactor Board item
- **Evidence:** `node scripts/audit/unused-css.mjs`: 3,594 classes defined; 729 with no exact TS producer; 244 of those have a template-prefix producer and 12 look like Obsidian core, leaving 473 (by file: `rt-ui.css` 126, `modal.css` 99, `inquiry.css` 65, `features/beat-system.css` 34, `features/ai-settings.css` 32, `pulse.css` 31). Spot-check of 10: 8 have zero producers anywhere (`ert-pulse-modal`, `ert-inquiry-header`, `rt-scene-title-small`, `ert-ai-key-status`, `ert-search-hidden`, `ert-completion-quote-text`, `ert-timeline-repair-status-pill`, `ert-beat-tier-line`). `rt-ui.css` (10,720) holds 169 `.ert-ai*` rules while `features/ai-settings.css` exists, plus `import` 161, `bookmeta` 107, `apr` 76, `campaign` 54, `audit` 47, with feature banners at `:2235, 6381, 6636, 9950, 4410-4540, 10001-10263`. `pulse.css` (4,016) is a Book Designer/manuscript/gossamer/tooltip grab-bag with 65 hex + 143 `rgba()` literals. `css-drift-check` raw-hex WARN is 186, delta 0 — ratcheted but not shrinking. Hex token definitions live in five files (`variables.css` 48, `briefing.css` 38, `rt-ui.css` 29, `inquiry.css` 9, `modal.css` 6). In TS: 40 hex in `utils/aprPaletteGenerator.ts`, 25 in `AuthorProgressSection.ts`, 21 in `settings/defaults.ts`, 19 in `InquiryView.ts`; `utils/constants.ts:10-13` `STATUS_HEX` documented as "keep in lockstep" with `variables.css` with no check.
- **Suggested next action:** Delete the verified producer-less classes starting with `modal.css`'s dead `ert-pulse-modal*`/`ert-subplot-picker*`/`ert-text-input-modal*` block; add the CSS→producer scan to `css-drift-check.mjs` as a ratchet; fold `check-css-duplicates.mjs`'s `!important` rule into it and retire the root script.
- **Status (2026-09-04):** Deleted 254 rules whose every selector named only producer-less classes (modal.css 103, inquiry.css 71, pulse.css 41, base.css 15, six smaller files); hard-unused classes 473 → 297. The rule was conservative: a selector that mixes an unused class with a live one was left alone, which is where the remaining 297 mostly sit. The scanner gained `--check` against `scripts/unused-css-baseline.json` and runs as the `unused-css` gate step, so the count can only fall. `STATUS_HEX` has the lockstep test its comment promised: the four status colours with a `--rt-color-*` variable are asserted against `variables.css` (`Complete` has no variable; its hex is used directly by the completion glyph). **Not done:** the `rt-ui.css` split (Refactor Board), the `check-css-duplicates.mjs` fold (it is wired into `build-only` and works; retiring it was not worth the risk today), and the TS-side hex literals.

### CH-2026-09-04-#13 — Tests that lint source text instead of behaviour; no tests on the vault-mutation paths

- **Status:** Confirmed
- **Category:** test hardening
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** Refactors break tests that assert nothing about behaviour; the code that actually rewrites author YAML has no direct coverage.
- **Effort:** ongoing; 2–4 h per file for the pure-utility wins
- **Evidence:** 35 test files do `readFileSync` of `src/**/*.ts` or `.css` (254 direct reads by the reviewer's AST pass; a grep pass gave 31/245; targets: `settings/sections` 64, `InquiryView.ts` 54, `inquiry/runner` 13). `AiSection.test.ts` has 41 `it` / 53 source reads / 0 behavioural cases; `InquiryView.test.ts` is 86 source-string assertions. Zero behavioural coverage of `runInquiry`, omnibus, pending-edits writeback, `buildCorpusEntryList`. No test file at all: `BeatPropertiesSection.ts` (5,788), `AuthorProgressSection.ts`, `ProgressSection.ts`, `CommunityShareSection.ts`, `OnboardingModal.ts` (1,453), `OnboardingService.ts` (934), `WelcomeScreen.ts`, `ChronologueShiftController.ts` (1,882), `TimelineRenderer.ts`, `gossamerLayer.ts`, `SceneInteractionManager.ts`, `RendererService.ts`, `main.ts`, `SynopsisManager.ts`; `src/modes` 8 files / 0 tests; `src/ui` 5 / 0; `src/sceneAnalysis` 12 / 2 (the `FileUpdater` YAML-write path has none). Pure and untested (cheapest wins): `utils/text.ts` (289, scene-title/number canonical), `utils/beatsSystems.ts` (571), `utils/runtimeEstimator.ts`. Partially covered: `utils/sceneHelpers.ts` (427, 21 exports; `sceneHelpers.sort.test.ts` covers the sorters only) and `utils/planetaryTime.ts` (`tests/planetary-time-conversion.test.ts`). (The first revision listed both as untested; corrected.) Untested community-client exits: `syncCommunityShareIfDue`, `beginCommunitySharing`, `pauseCommunitySharing`, `resumeCommunitySharing`, `postSessionToCommunityFeed`. Test helpers copied: `function makeFile` ×14 files, `createPlugin` ×8, `makePlugin` ×5. `vitest.config.ts` has no `restoreMocks`/`clearMocks`. 20 test files use real `Date.now()`/`new Date()` without fake timers (mostly relative fixtures; flakiness Hypothesis). Certification: `anthropicCertification.test.ts:213` is `skipIf`; last report `docs/audits/anthropic-certification.json` is 2026-04-15 against `claude-sonnet-4-6`, no longer in the registry.
- **Suggested next action:** Add vitest for `text.ts`, `beatsSystems.ts`, and the non-sort half of `sceneHelpers.ts` before #6 touches them; hoist `makeFile`/`createPlugin` into `tests/helpers/`; re-run `npm run certify:anthropic`.
- **Status (2026-09-04):** `tests/helpers/obsidianFixtures.makeFile` replaces thirteen of the fourteen copies (the timeline-repair one builds a real mock `TFile` and stays). New behavioural tests: `utils/text` (11 cases), `utils/sceneHelpers` (predicates, keys, manuscript and chronological order), `utils/runtimeEstimator` (field parsing, formatting, prose estimate), `utils/beatsSystems` (preset self-consistency, starter-set resolution). The four untested community exits (`begin`, `pause`, `resume`, `postSessionToCommunityFeed`) are covered, including the exact wire body of a session post and both error paths. Across today's work the suite went 3,302 → 3,388 tests, and every `readFileSync` pin that pointed at moved code was replaced by a behavioural test or retargeted; the forwarder-ceremony pins in four pure-module tests now assert the direct calls. **Tried and rejected:** `restoreMocks: true` in `vitest.config.ts` breaks suites that set spies in `beforeAll` (the Anthropic API tests among them); left off. **Not done:** the `createPlugin` harnesses (fourteen, each shaped for its file; hoisting is not mechanical), the 86 source-string assertions in `InquiryView.test.ts` beyond those retargeted, `npm run certify:anthropic` (needs a live key), and coverage for `runInquiry`/omnibus/pending-edits writeback.

### CH-2026-09-04-#14 — Lint posture: 328 `eslint src` problems outside the enforced ratchet; `@ts-ignore` and inline styles without `SAFE:`

- **Status:** Confirmed
- **Category:** doctrine correction
- **Severity:** YELLOW
- **Confidence:** High
- **Risk:** The enforced lane tracks five rules at zero; the full config reports 314 type-unsafe hits (`no-unsafe-assignment` 135, `-member-access` 103, `-call` 56, `-argument` 10, `-return` 9, `-enum-comparison` 1) concentrated in two files. The report-only Obsidian lane read 573 on 2026-09-01 (`prefer-create-el` 236) but 328 with 2 obsidianmd hits at this audit's gate run, so that spike was transient; the 328 are the same `no-unsafe-*` set as `eslint src`.
- **Effort:** 1 day for the two hot files
- **Evidence:** `src/SceneAnalysisCommands.ts` 62, `src/inquiry/InquiryView.ts` 58, `settings/sections/beats/dirtyState.ts` 17, `services/SubplotManagementService.ts` 15. `@ts-ignore` ×7 with no `SAFE:` (`modals/RuntimeProcessingModal.ts:326,328`, `ManuscriptOptionsModal.ts:497,499,1069,1071`, `SceneAnalysisProcessingModal.ts:1614`); 7 `as unknown as` casts and 25 `.style.` lines without `SAFE:` (`ManuscriptOptionsModal.ts:3152-3154`, `RuntimeProcessingModal.ts:169` `style.cssText =`, `AuthorProgressSection.ts:384-385, 591, 596-597`). `no-base-to-string` ×8 at `modals/OnboardingModal.ts:1076-1131` (frontmatter values stringified — real bug class). `modes/ModeDefinition.ts:226` enum comparison. `ai/localLlm/transport.ts:310, 417` `fetch` (intentional for abort; `requestUrl` fallback exists). `settings/SettingsTab.ts:48` no `getSettingDefinitions()` (settings invisible to Obsidian 1.13 search). `services/CommandRegistrar.ts:94` plugin-id in command id. `.eslintignore` deprecated warning on every run; `.eslintrc` (legacy) coexists with `eslint.config.mjs`; `.lintstagedrc` references a tool not installed.
- **Suggested next action:** Fix the 8 `no-base-to-string` sites (real); type the frontmatter access in `SceneAnalysisCommands.ts`; annotate or remove the 7 `@ts-ignore`; delete `.eslintignore`/`.eslintrc`/`.lintstagedrc`.
- **Status (2026-09-04):** Actioned. `eslint src` 317 → 120. `utils/obsidianInternals.ts` holds the only two casts to Obsidian's private settings pane and command manager; the 17 call sites, including the seven `@ts-ignore`, go through `openSettingsTab` / `executeCommandById`. `SceneAnalysisProcessingModal.openAndRun()` replaces the two `modal.onOpen = function () { this… }` overrides in `SceneAnalysisCommands.ts` (the 62-hit file, now 0). `dirtyState` is a class. The eight `no-base-to-string` sites render frontmatter through `frontmatterValueToText`. **Hardening:** `tsconfig` gains `strictBindCallApply` and `useUnknownInCatchVariables`; they surfaced six `(error)?.message` reads on unknowns, all fixed. The audit-named inline styles carry `SAFE` reasons; `RuntimeProcessingModal`'s `cssText` block is deleted because `modal.css` already styled the badge icon. **Left by design:** the two local-LLM `fetch` calls (abortable transport), the command id carrying the plugin id (changing it breaks users' hotkeys), `getSettingDefinitions()` (feature work). The remaining 120 are `no-unsafe-*` in nine files at 7–9 each, mostly `getFileCache().frontmatter` reads.

### CH-2026-09-04-#15 — Scripts and repo hygiene

- **Status:** Confirmed
- **Category:** cleanup
- **Severity:** GREEN
- **Confidence:** High
- **Risk:** Low; friction and disk.
- **Effort:** 2–4 h
- **Evidence:** Six scripts have no reference in package.json, husky, workflows, or other scripts. Three are documented as deliberate on-demand tools and must **not** be deleted: `scripts/compliance-report.mjs` and `scripts/css-drift-report.mjs` (debt dumpers, headers say so; `docs/engineering/audits/eslint-rule-mapping.md:82` marks css-drift-report **KEEP**) and `scripts/check-translations.mjs` (`eslint-rule-mapping.md:87` marks it **KEEP** for i18n coverage; it reports per-key missing translations, which `check-i18n-release.mjs` does not). Undocumented and likely dead: `scripts/add-api-feature.mjs` (195 lines, 2026-03), `scripts/generate-wiki-sidebar.mjs` (72), `scripts/audit-important.py` (286). (The first revision called all six dead; corrected.) Four `check-*-ert-lock.mjs` (81–93 lines each, 15 shared lines) run serially on every `dev`/`build-only`. `gates:legacy` diverges from `gates` (includes `validate-pricing` deliberately removed from `gates`; lacks 8 newer steps); sole consumer `backup:verbose`. `.gate-logs/` 254 MB / 1,644 runs, never pruned. `.claude/worktrees/epic-rhodes-e170ef` (82 MB, gitignored) inside the repo despite the no-worktrees rule. Root: `test_apr_rendering.html` (tracked, unreferenced), `tmp/` (empty, untracked, unignored), `AGENT_RULES.md` (subset of CLAUDE.md), stale `main.js` from 2026-02-09 at root (ignored; build now writes `build/`), `docs/audits/` 1.2 MB of generated output, `wiki/images` 52 MB tracked. `esbuild.config.mjs:73-83` hardcodes 11 absolute `/Users/` vault paths (dev-only; CI skips missing). `scripts/local-llm-server.mjs:21-22` hardcodes port 8080 while the plugin default is Ollama's 11434 (dev helper, not referenced from src). i18n: en 1,921 leaf keys; de/ja/ko/zh 1,008 each (identical key set); ~160 en keys unused (`settings.authorProgress` 27, `inquiry.runner` 12); `src/i18n/index.ts:151` JSDoc cites a key that does not exist.
- **Suggested next action:** One hygiene commit: confirm and delete the three undocumented scripts, `.lintstagedrc`, `.eslintrc`, `.eslintignore`, `AGENT_RULES.md`, `test_apr_rendering.html`, root `main.js`; wire `check-translations.mjs` (or its missing-key logic) into `check-i18n-release.mjs` rather than deleting it; add `.gate-logs` pruning to `run-gates.mjs`; `git worktree remove` the stray worktree; collapse the four ert-lock scripts into one table-driven script.
- **Status (2026-09-04):** Actioned in one commit. The four `check-*-ert-lock` scripts are one table-driven `scripts/check-ert-locks.mjs` (proved equivalent: all four pass on the current tree, and a planted `rt-brand-new-chrome` in `TimeLineView.ts` fails it); `dev`, `build-only`, and `build-with-backup-check` use it. `run-gates` prunes `.gate-logs` to the newest 40 runs (it was 261 MB across 1,677 runs). `gates:legacy` is deleted and `backup:verbose` runs the same gates as pre-push. `check-translations.mjs` is `npm run i18n:coverage`. Deleted: the three undocumented scripts, `.eslintrc`, `.eslintignore`, `.lintstagedrc`, `AGENT_RULES.md`, `test_apr_rendering.html`, the stale root `main.js`, the empty `tmp/`, and the stray worktree with its merged branch (its only diff was regenerated model JSON). The `t()` doc example now cites a real key. **Left:** `docs/audits/` and `wiki/images` (owner content), the `esbuild` vault paths (dev-only), the ~160 unused locale keys (needs its own scanner; not done).

---

## Historical Context

| Finding / Theme | Classification |
|---|---|
| CH-#1 privacy path | New (community daily sync shipped 2026-07-16; doctrine not updated) |
| CH-#2 render-time registration | Chronic hotspot — `TimeLineView.ts` is the most-churned file (50 commits / 90 d) |
| CH-#3 stale-snapshot writes | New — catch paths show the rule was known when written |
| CH-#4 service logic in sections | Chronic hotspot — `AiSection.ts` 40 commits / 90 d, `PublishSection.ts` 31; all three sections reduced to UI 2026-09-04 (logic under `src/publishing`, `src/ai`, `src/storyBeats`, `src/utils`) |
| CH-#5 dead code | New to this track; `audit:tsc-unused` exists in package.json but is not in `gates` |
| CH-#6 duplicate helpers | Chronic — no `utils/date` key formatter despite six copies; all listed families consolidated 2026-09-04 (two passes), `deriveCacheResult` kept by design |
| CH-#7 cost fallbacks | Regressed against `fallback-policy.md` (gate total fell 2,497 → 2,429 but these sites are literal-annotated as intentional) |
| CH-#8 hover filters | Previously resolved, resurfaced — `:has()` retired 2026-09-03; `filter:` survived; `filter:` retired 2026-09-04 with a drift-check rule to hold it |
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

---

## Re-audit (2026-09-04, end of day)

Every finding in this report has a status line above. This section re-runs the committed scanners so the closing numbers are measured, not remembered, and records where the day's own claims needed correcting.

| Measure (committed script) | Audit morning | End of day |
|---|---|---|
| `eslint src` problems | 317 | 117 |
| Unused-symbol audit (`tsc -p tsconfig.audit.json`) | 133 | 122 |
| Zero-use exports (`scripts/audit/dead-exports.mjs`) | 136 | 1 (the documented `ProPill.reference.ts`) |
| Producer-less CSS classes (`scripts/audit/unused-css.mjs`) | 473 | 297, ratcheted |
| Functions ≥ 1,000 lines (`scripts/audit/long-functions.mjs`) | 4 (+ the 5,660-line beat closure the scanner misses) | 4; the beat closure is 5,399 |
| `@deprecated` markers in `src/` | 44 | 30 |
| `TODO(v7)` | 3 | 0 |
| `InquiryView.ts` lines | 12,188 | 11,510 |
| Settings sections, lines (Publish / AI / Beat) | 4,503 / 4,282 / 5,789 | 3,064 / 3,760 / 5,399 |
| Production `src/` lines (ts + css, non-test) | 237,683 (first measure, includes bundled css) | see note |
| Test files / tests passing | 274 / 3,302 | 305 files / 3,385 |
| Pre-push gate steps | 14 | 15 (`unused-css` added) |
| `.gate-logs` | 261 MB, 1,677 runs | 8.5 MB, pruned to 40 |
| Commits on `main` from the audit | — | 19 (+ the deletion commit before it) |

Note on the line count: the morning figure was taken with a command that counted every tracked `src` file including the bundled stylesheet; the like-for-like production count is 48,308 lines at end of day, and the two figures are not comparable. The per-file numbers above are the honest size measure.

### Corrections to this report made during the day

- CH-#4: the "three inverted imports" claim was wrong (only `SettingsTab` imported from the section); the real defect was the service body living in the section.
- CH-#6: the seven FNV-1a copies were one algorithm with two output paddings, not two variants.
- CH-#9: the omnibus runners shared 22 contiguous lines plus four smaller blocks, not 77 contiguous lines.
- CH-#10: the "deletion snapshot writer" was already a service (`logVaultOps.writeDeletionSnapshot`); the finding overstated that one.
- CH-#12: the deletion rule was conservative by design; the remaining 297 mostly sit in selectors that mix a dead class with a live one.
- CH-#13: `restoreMocks` was tried and rejected because suites set spies in `beforeAll`.

### Behaviour changes that deserve a look in Obsidian

These were deliberate, verified by tests and gates, but they change what the plugin does rather than how it is written:

1. **`isSceneFile` is metadata-based.** A note with `Class: Scene` is a scene whether or not a timeline is open and whichever book it belongs to. Before, the answer came from the open view's data (false with no view). Open-scene tracking, session scene attribution, and the explorer hover highlight now see scenes in every book, not only the active one.
2. **The mode manager always exists.** Four fallback branches that re-did its job when it was absent are gone. If mode switching ever misbehaves, the manager is the only path to look at.
3. **`targetCompletionDate` became the active book's Press target** on first load after this build, when the book had no stage targets. The legacy single tick is gone.
4. **Two v5-era migrations are gone** (`sceneAnalysis` field rename, `beatSettings`). A vault that skipped every 6.x build would arrive without those conversions; the plan doc says v7 requires a 6.x intermediate.
5. **254 CSS rules deleted.** The scanner cannot see a class assembled by concatenation that does not match its prefix heuristic. Modals, Inquiry, and the Pulse surfaces are the places to glance at.
6. **Subplot colours throw** instead of painting pink when the theme variables are missing from a document.

### One incident, and its cause

`.git/index` vanished twice during the day. `~/Documents` on this Mac is iCloud Drive, and iCloud evicts files it decides are cold; the index (138 KB, rewritten constantly) was evicted, HEAD and the working tree were never touched. The first loss was noticed and the index rebuilt with `git reset --mixed HEAD`. The second happened between that rebuild and the next commit, so four commits (`a9dca86f`, `5a2ed914`, `8e24400e`, `3f689450`) were built from a near-empty index and carry trees of 8, 47, 66, and 67 files; the Obsidian community review of `main` at that point reported no manifest, README, or LICENSE. `0ebee7f3` restores the full tree from the last complete commit without rewriting history (1,350 files; a 45-file diff that matches the four commits' intent, verified both ways). Two guards now refuse a commit whose index holds fewer than 80% of HEAD's files and a push whose HEAD tree is under 80% of `origin/main`'s. The durable fix is the owner's: move the repository out of iCloud Drive, or at minimum pin the folder as "Keep Downloaded". Those four commits remain in history with broken trees; rewriting them is a force-push and was left as the owner's decision.

### Still open, by home

- **Refactor Board:** the four ≥1,000-line render functions and the 5,399-line beat closure; the 1,160-line writing-session block in `TimeLineView`; `rt-ui.css` / `pulse.css` split; the `createPlugin` test harnesses; the 86 `InquiryView.test.ts` source pins.
- **Architecture Drift:** string-SVG through `DOMParser`; the three `SynopsisManager` author-text parses; the `services → view/interactions` read of module state (now the only such read).
- **Owner decisions:** the remaining verified 5.x-era migrations (dated in `docs/engineering/plans/v7-removals.md`); `getSettingDefinitions()`; the command id that carries the plugin id.
