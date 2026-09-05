# Compliance Debt

Generated: 2026-04-23T03:48:30.925Z

Snapshot of every compliance **error** at the time of baseline reset. Work through these to ratchet the compliance baseline down. After fixing a batch, run `node scripts/compliance-check.mjs --update-baseline` to lock in the new lower ceiling.

Regenerate this report anytime with: `node scripts/compliance-report.mjs`.

## Totals

- **Total errors:** 93
- `raw-addEventListener`: 79
- `node-core-import`: 6
- `adapter`: 4
- `fetch-vs-requestUrl`: 3
- `node-core-require`: 1

## How to work a rule

1. Open the section for the rule.
2. Fix one file at a time.
3. Re-run `node scripts/compliance-check.mjs` and confirm the count dropped.
4. When a batch is done: `node scripts/compliance-check.mjs --update-baseline`.

### Fix hints

- `raw-addEventListener` — in `Component`/`View` subclasses, replace `el.addEventListener(...)` with `this.registerDomEvent(el, ...)`. Modal classes are exempt (no `registerDomEvent`). Check the class the call lives in before converting.
- `console-log` — remove or guard behind a debug flag. Shipped plugins should not log to console.
- `node-core-import` / `node-core-require` — replace `fs`/`path` with Obsidian Vault API where possible. If the code is build-only (never reached at runtime), move it to `scripts/`.
- `adapter` — prefer `Vault.read/write/...` over `Vault.adapter.*`.
- `fetch-vs-requestUrl` — network calls use `requestUrl` from obsidian, not `fetch`.
- `fetch-abort` — if `fetch` is unavoidable, pass `{ signal: controller.signal }` and register abort.
- `eval` / `new-function` — usually false positives when the string appears inside a regex literal detecting these very patterns. Silence with `// SAFE: describes why` comment on the same line.
- `deprecated-frontmatter` — rename `tag` → `tags`, `alias` → `aliases`, `cssclass` → `cssclasses`.
- `normalizePath` — wrap user-provided paths with `normalizePath()` before storing.
- `observer-disconnect` — `new MutationObserver(...)` must be disconnected on unload via `this.register(() => obs.disconnect())`.
- `raf-cleanup` — `requestAnimationFrame` must register matching `cancelAnimationFrame` cleanup.

## `raw-addEventListener` (79)


### src/settings/sections/BeatPropertiesSection.ts (28)

```
src/settings/sections/BeatPropertiesSection.ts:2268:20 — closeEl.addEventListener('click', (event) => {
src/settings/sections/BeatPropertiesSection.ts:2304:15 — addBtn.addEventListener('click', () => {
src/settings/sections/BeatPropertiesSection.ts:2694:24 — addKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddBeatField(); } });
src/settings/sections/BeatPropertiesSection.ts:2985:25 — confirmInput.addEventListener('input', () => {
src/settings/sections/BeatPropertiesSection.ts:3214:17 — selectEl.addEventListener('change', () => {
src/settings/sections/BeatPropertiesSection.ts:3356:26 — nameInput.addEventListener('keydown', (e) => {
src/settings/sections/BeatPropertiesSection.ts:3663:25 — checkbox.addEventListener('change', () => {
src/settings/sections/BeatPropertiesSection.ts:3688:23 — delBtn.addEventListener('click', () => {
src/settings/sections/BeatPropertiesSection.ts:3697:25 — keyInput.addEventListener('blur', () => {
src/settings/sections/BeatPropertiesSection.ts:3736:25 — valInput.addEventListener('blur', () => {
src/settings/sections/BeatPropertiesSection.ts:3743:27 — dragHandle.addEventListener('dragstart', (e) => {
src/settings/sections/BeatPropertiesSection.ts:3748:20 — row.addEventListener('dragover', (e) => {
src/settings/sections/BeatPropertiesSection.ts:3752:20 — row.addEventListener('drop', (e) => {
src/settings/sections/BeatPropertiesSection.ts:3762:27 — dragHandle.addEventListener('dragend', () => {
src/settings/sections/BeatPropertiesSection.ts:3826:19 — addBtn.addEventListener('click', () => {
src/settings/sections/BeatPropertiesSection.ts:3862:22 — revertBtn.addEventListener('click', async () => {
src/settings/sections/BeatPropertiesSection.ts:4680:27 — pillEl.addEventListener('click', async () => {
src/settings/sections/BeatPropertiesSection.ts:4744:28 — chipBtn.addEventListener('click', () => {
src/settings/sections/BeatPropertiesSection.ts:4824:27 — pillEl.addEventListener('click', async () => {
src/settings/sections/BeatPropertiesSection.ts:4851:28 — prevBtn.addEventListener('click', () => { page--; renderNoteList(); });
src/settings/sections/BeatPropertiesSection.ts:4859:28 — nextBtn.addEventListener('click', () => { page++; renderNoteList(); });
src/settings/sections/BeatPropertiesSection.ts:4867:31 — openAllBtn.addEventListener('click', async () => {
src/settings/sections/BeatPropertiesSection.ts:5448:34 — confirmInput?.addEventListener('input', updateDeleteState);
src/settings/sections/BeatPropertiesSection.ts:5449:38 — acknowledgeInput?.addEventListener('change', updateDeleteState);
src/settings/sections/BeatPropertiesSection.ts:5717:34 — confirmInput?.addEventListener('input', updateDeleteState);
src/settings/sections/BeatPropertiesSection.ts:5718:38 — acknowledgeInput?.addEventListener('change', updateDeleteState);
src/settings/sections/BeatPropertiesSection.ts:5859:29 — confirmInput.addEventListener('input', () => {
src/settings/sections/BeatPropertiesSection.ts:5927:26 — backdropYamlToggleBtn.addEventListener('click', () => { renderBackdropAuditVisibility(); });
```

### src/settings/sections/ProFeaturePanels.ts (14)

```
src/settings/sections/ProFeaturePanels.ts:2068:18 — input.addEventListener('blur', () => { void commit(); });
src/settings/sections/ProFeaturePanels.ts:2069:18 — input.addEventListener('keydown', (e: KeyboardEvent) => {
src/settings/sections/ProFeaturePanels.ts:2087:16 — display.addEventListener('click', swapToEditor);
src/settings/sections/ProFeaturePanels.ts:2088:16 — display.addEventListener('keydown', (e: KeyboardEvent) => {
src/settings/sections/ProFeaturePanels.ts:3099:22 — input.addEventListener('input', () => {
src/settings/sections/ProFeaturePanels.ts:3102:22 — input.addEventListener('keydown', (evt) => {
src/settings/sections/ProFeaturePanels.ts:3114:22 — input.addEventListener('blur', () => {
src/settings/sections/ProFeaturePanels.ts:3138:20 — valueEl.addEventListener('click', (evt) => {
src/settings/sections/ProFeaturePanels.ts:3142:20 — valueEl.addEventListener('keydown', (evt: KeyboardEvent) => {
src/settings/sections/ProFeaturePanels.ts:3210:23 — sourceLink.addEventListener('click', (evt) => {
src/settings/sections/ProFeaturePanels.ts:3258:16 — col.addEventListener('click', onClick);
src/settings/sections/ProFeaturePanels.ts:3259:16 — col.addEventListener('keydown', (evt: KeyboardEvent) => {
src/settings/sections/ProFeaturePanels.ts:3460:30 — titleLink.addEventListener('click', (evt: MouseEvent) => {
src/settings/sections/ProFeaturePanels.ts:3511:17 — advancedLink.addEventListener('click', (evt: MouseEvent) => {
```

### src/settings/sections/scene/SceneNormalizerSection.ts (6)

```
src/settings/sections/scene/SceneNormalizerSection.ts:220:13 — parentEl.addEventListener('ert:scene-advanced-maintenance-changed', refreshMaintenanceCopy as EventListener);
src/settings/sections/scene/SceneNormalizerSection.ts:405:24 — chipBtn.addEventListener('click', () => {
src/settings/sections/scene/SceneNormalizerSection.ts:461:23 — pillEl.addEventListener('click', async () => {
src/settings/sections/scene/SceneNormalizerSection.ts:471:24 — prevBtn.addEventListener('click', () => {
src/settings/sections/scene/SceneNormalizerSection.ts:478:24 — nextBtn.addEventListener('click', () => {
src/settings/sections/scene/SceneNormalizerSection.ts:536:12 — copyBtn.addEventListener('click', () => {
```

### src/settings/sections/scene/ScenePropertiesSection.ts (6)

```
src/settings/sections/scene/ScenePropertiesSection.ts:214:25 — advancedToggleButton.addEventListener('click', async () => {
src/settings/sections/scene/ScenePropertiesSection.ts:470:27 — dragHandle.addEventListener('dragstart', (event) => {
src/settings/sections/scene/ScenePropertiesSection.ts:476:27 — dragHandle.addEventListener('dragend', () => {
src/settings/sections/scene/ScenePropertiesSection.ts:481:20 — row.addEventListener('dragover', (event) => {
src/settings/sections/scene/ScenePropertiesSection.ts:485:20 — row.addEventListener('dragleave', () => {
src/settings/sections/scene/ScenePropertiesSection.ts:488:20 — row.addEventListener('drop', (event) => {
```

### src/settings/sections/AiSection.ts (5)

```
src/settings/sections/AiSection.ts:519:21 — toggleButton.addEventListener('click', (event) => {
src/settings/sections/AiSection.ts:525:18 — detailsEl.addEventListener('toggle', refreshToggle);
src/settings/sections/AiSection.ts:837:15 — detailsBtn.addEventListener('click', () => {
src/settings/sections/AiSection.ts:2591:27 — replaceBtn.addEventListener('click', () => {
src/settings/sections/AiSection.ts:2603:28 — copyBtn.addEventListener('click', () => {
```

### src/settings/sections/AuthorProgressSection.ts (4)

```
src/settings/sections/AuthorProgressSection.ts:1531:12 — btn.addEventListener('click', () => applyPreset(preset.color));
src/settings/sections/AuthorProgressSection.ts:1560:20 — btn.addEventListener('click', () => applyPreset(saved.color));
src/settings/sections/AuthorProgressSection.ts:1563:20 — btn.addEventListener('contextmenu', (e) => {
src/settings/sections/AuthorProgressSection.ts:1571:20 — btn.addEventListener('click', () => openCustomPresetModal(i, null));
```

### src/inquiry/corpus/inquiryCorpusStripRenderer.ts (3)

```
src/inquiry/corpus/inquiryCorpusStripRenderer.ts:526:22 — legendTrigger.addEventListener('mouseenter', () => legendPanel.classList.add('is-legend-visible'));
src/inquiry/corpus/inquiryCorpusStripRenderer.ts:527:22 — legendTrigger.addEventListener('mouseleave', () => {
src/inquiry/corpus/inquiryCorpusStripRenderer.ts:535:20 — legendPanel.addEventListener('mouseleave', () => legendPanel.classList.remove('is-legend-visible'));
```

### src/settings/sections/CampaignManagerSection.ts (3)

```
src/settings/sections/CampaignManagerSection.ts:1036:13 — sliderEl.addEventListener('change', () => {
src/settings/sections/CampaignManagerSection.ts:1047:22 — refreshValueInput.addEventListener('blur', () => {
src/settings/sections/CampaignManagerSection.ts:1054:22 — refreshValueInput.addEventListener('keydown', (evt: KeyboardEvent) => {
```

### src/inquiry/modals/InquiryViewModals.ts (2)

```
src/inquiry/modals/InquiryViewModals.ts:331:17 — bookPill.addEventListener('click', () => updateScopeSelection('book'));
src/inquiry/modals/InquiryViewModals.ts:332:17 — sagaPill.addEventListener('click', () => updateScopeSelection('saga'));
```

### src/settings/sections/PlanetaryTimeSection.ts (2)

```
src/settings/sections/PlanetaryTimeSection.ts:108:16 — inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
src/settings/sections/PlanetaryTimeSection.ts:165:21 — visibilityToggle.addEventListener('click', () => {
```

### src/view/TimeLineView.ts (2)

```
src/view/TimeLineView.ts:164:19 — select.addEventListener('change', () => {
src/view/TimeLineView.ts:174:22 — manageBtn.addEventListener('click', () => {
```

### src/inquiry/InquiryView.ts (1)

```
src/inquiry/InquiryView.ts:582:16 — element.addEventListener(event, listener, options);
```

### src/main.ts (1)

```
src/main.ts:937:22 — this.eventBus.addEventListener(type, wrapped);
```

### src/settings/sections/GeneralSection.ts (1)

```
src/settings/sections/GeneralSection.ts:133:29 — text.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
```

### src/settings/sections/ProgressSection.ts (1)

```
src/settings/sections/ProgressSection.ts:242:21 — toggleButton.addEventListener('click', () => {
```

## `node-core-import` (6)


### src/services/PublishingValidationService.ts (2)

```
src/services/PublishingValidationService.ts:1:16 — import * as fs from 'fs';
src/services/PublishingValidationService.ts:2:18 — import * as path from 'path';
```

### src/utils/pandocBundledLayouts.ts (2)

```
src/utils/pandocBundledLayouts.ts:2:18 — import * as path from 'path';
src/utils/pandocBundledLayouts.ts:3:16 — import * as fs from 'fs';
```

### src/utils/templateImport.ts (2)

```
src/utils/templateImport.ts:2:16 — import * as fs from 'fs';
src/utils/templateImport.ts:3:18 — import * as path from 'path';
```

## `adapter` (4)


### src/ai/cost/outputProfile.ts (2)

```
src/ai/cost/outputProfile.ts:66:41 — const adapter = this.plugin.app.vault.adapter;
src/ai/cost/outputProfile.ts:148:35 — await this.plugin.app.vault.adapter.write(
```

### src/inquiry/modals/InquiryBriefingModal.ts (1)

```
src/inquiry/modals/InquiryBriefingModal.ts:344:34 — const adapter = this.app.vault.adapter as unknown as { getResourcePath?: (path: string) => string };
```

### src/services/authorProgress/AuthorProgressRenderService.ts (1)

```
src/services/authorProgress/AuthorProgressRenderService.ts:91:24 — await this.app.vault.adapter.writeBinary(path, png);
```

## `fetch-vs-requestUrl` (3)


### src/ai/cost/remotePricing.ts (1)

```
src/ai/cost/remotePricing.ts:141:28 — const response = await fetch(url);
```

### src/ai/registry/providerSnapshot.ts (1)

```
src/ai/registry/providerSnapshot.ts:90:28 — const response = await fetch(url);
```

### src/ai/registry/remoteRegistry.ts (1)

```
src/ai/registry/remoteRegistry.ts:62:28 — const response = await fetch(url);
```

## `node-core-require` (1)


### src/settings/sections/ProFeaturePanels.ts (1)

```
src/settings/sections/ProFeaturePanels.ts:62:20 — const fs = require('fs') as typeof import('fs');
```
