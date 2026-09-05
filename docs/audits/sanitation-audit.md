# Sanitation Audit

Generated: 2026-04-23T03:08:18.688Z

## Executive summary

This audit pass is report-only and does not change runtime behavior. The scan found 1268 matched lines across 195 files. Weighted score is 1267, prioritizing actionable drift over identifier noise.

## Totals by token (raw counts)

| Token | Token kind | Total hits |
| --- | --- | --- |
| `NOTE` | stale-comment | 542 |
| `Synopsis` | drift-term | 459 |
| `DEPRECATED` | stale-comment | 84 |
| `TODO` | stale-comment | 80 |
| `refreshTimelineIfNeeded` | drift-term | 32 |
| `IMPORTANT` | stale-comment | 18 |
| `Ripple Rename` | drift-term | 18 |
| `TEMP` | stale-comment | 14 |
| `ChangeType.SETTINGS` | drift-term | 6 |
| `legacy key` | drift-term | 5 |
| `getMergedBeatYaml` | drift-term | 4 |
| `plaintext key` | drift-term | 3 |
| `HACK` | stale-comment | 1 |
| `mergeTemplates` | drift-term | 1 |
| `WORKAROUND` | stale-comment | 1 |
| `advanced template cleanup` | drift-term | 0 |
| `api key in settings` | drift-term | 0 |
| `FIXME` | stale-comment | 0 |
| `prefix normalization` | drift-term | 0 |

## Synopsis breakdown

| Category | Hits | Weighted score |
| --- | --- | --- |
| `synopsis_identifier` | 368 | 0 |
| `synopsis_copy` | 86 | 430 |
| `synopsis_yaml` | 5 | 20 |

## Weighted delta vs prior run

No prior weighted baseline found in the previous `sanitation-audit.json`.

## Top 10 files by weighted score

| File | Weighted score | Raw hits |
| --- | --- | --- |
| `src/settings/sections/BeatPropertiesSection.ts` | 103 | 85 |
| `src/modals/SceneAnalysisProcessingModal.ts` | 71 | 53 |
| `src/i18n/locales/en.ts` | 60 | 28 |
| `src/sceneProperties/sceneNormalizer.ts` | 50 | 50 |
| `src/utils/yamlAudit.ts` | 47 | 23 |
| `src/settings/sections/scene/SceneNormalizerSection.ts` | 38 | 38 |
| `src/types/settings.ts` | 38 | 20 |
| `src/modals/ManuscriptOptionsModal.ts` | 33 | 40 |
| `src/utils/yamlTemplateNormalize.ts` | 32 | 16 |
| `src/inquiry/InquiryView.ts` | 22 | 32 |

## Top hotspots by raw hits

| File | Hits |
| --- | --- |
| `src/settings/sections/BeatPropertiesSection.ts` | 85 |
| `src/modals/SceneAnalysisProcessingModal.ts` | 53 |
| `src/sceneProperties/sceneNormalizer.ts` | 50 |
| `src/SynopsisManager.ts` | 50 |
| `src/modals/ManuscriptOptionsModal.ts` | 40 |
| `src/settings/sections/scene/SceneNormalizerSection.ts` | 38 |
| `src/sceneAnalysis/SynopsisCommands.ts` | 37 |
| `src/inquiry/InquiryView.ts` | 32 |
| `src/i18n/locales/en.ts` | 28 |
| `src/utils/yamlAudit.ts` | 23 |
| `src/types/settings.ts` | 20 |
| `src/services/CommandRegistrar.ts` | 18 |
| `src/utils/beatsTemplates.ts` | 17 |
| `src/inquiry/modals/InquiryBriefingModal.ts` | 16 |
| `src/modals/CreateRtNoteModal.ts` | 16 |
| `src/settings/sections/AiSection.ts` | 16 |
| `src/utils/yamlTemplateNormalize.ts` | 16 |
| `src/view/modes/GossamerMode.ts` | 16 |
| `src/renderer/apr/AprRenderer.ts` | 15 |
| `src/main.ts` | 14 |

## Supporting reports

- TypeScript unused symbol report: `docs/audits/tsc-unused.txt`
- ESLint audit output: `docs/audits/eslint.txt`

## Findings by token (top 20 per token)

### `NOTE` (542)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `scripts/check-api-features.mjs` | 136 | `stale-comment` | 1 | `warnings.push(`${cap.id}: missing requiredApiVersion (use null with note if not versioned)`);` |
| `scripts/compliance-check.mjs` | 302 | `stale-comment` | 1 | `return "Replace element.addEventListener('event', handler) with this.registerDomEvent(element, 'event', handler) for automatic cleanup. Note: Modal classes don't have registerDomEvent and must use addEventListener.";` |
| `scripts/css-drift-report.mjs` | 88 | `stale-comment` | 1 | `md += "> **Note on counts:** this report scans only the _source_ CSS files under `src/styles/`. The drift check also scans the bundled `styles.css` output (auto-generated from sources), so its totals are roughly 2× these. Fixing a hit here will remove both copies after the next `npm run build`.\n\n";` |
| `scripts/css-drift-report.mjs` | 104 | `stale-comment` | 1 | `md += "- `rt-legacy` — rename `.rt-*` selector to `.ert-*` (and update TS class usage) or relocate to `src/styles/legacy/rt-ui-legacy.css`. Note: `legacy/rt-ui-legacy.css` is itself scanned, so renaming beats relocating long-term.\n";` |
| `scripts/echo-branch.mjs` | 26 | `stale-comment` | 1 | `console.log(`[note] Backup will commit to 'master'.`);` |
| `scripts/sync-yaml-to-wiki.mjs` | 36 | `stale-comment` | 1 | `> **Note:** This page is auto-generated from [\`docs/reference/yaml-reference.md\`](../reference/yaml-reference.md)` |
| `src/ai/caps/computeCaps.ts` | 76 | `stale-comment` | 1 | `* Note: citations are API-incompatible with Anthropic structured outputs` |
| `src/ai/prompts/gossamer.ts` | 45 | `stale-comment` | 1 | `"note": "Opening establishes world effectively"` |
| `src/ai/prompts/gossamer.ts` | 50 | `stale-comment` | 1 | `"note": "Strong reversal creates new stakes"` |
| `src/ai/prompts/gossamer.ts` | 61 | `stale-comment` | 1 | `- "note": one concise sentence of guidance for this beat` |
| `src/ai/prompts/gossamerAnalysis.ts` | 8 | `stale-comment` | 1 | `* Note: idealRange and isWithinRange are computed in code after AI response,` |
| `src/ai/prompts/gossamerAnalysis.ts` | 22 | `stale-comment` | 1 | `description: "Name of the beat (matches beat note title without number prefix)"` |
| `src/ai/prompts/unifiedBeatAnalysis.ts` | 21 | `stale-comment` | 1 | `placement?: string; // Structural placement token from beat-note title prefix, e.g. "1.01", "4.01"` |
| `src/ai/prompts/unifiedBeatAnalysis.ts` | 23 | `stale-comment` | 1 | `// Note: previousScore, previousJustification, and idealRange are intentionally NOT sent to the AI` |
| `src/ai/runtime/aiClient.ts` | 148 | `stale-comment` | 1 | `? notes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)` |
| `src/authorProgress/authorProgressConfig.ts` | 19 | `stale-comment` | 1 | `const AUTHOR_PROGRESS_PUBLISH_TARGETS = new Set<AuthorProgressPublishTarget>(['folder', 'github_pages', 'note']);` |
| `src/GossamerCommands.ts` | 245 | `stale-comment` | 1 | `// Helper to find Beat note by beat title (prefers Beat over Plot)` |
| `src/GossamerCommands.ts` | 260 | `stale-comment` | 1 | `* Save Gossamer scores to Beat note frontmatter with appending (G1=oldest, newest=highest number)` |
| `src/GossamerCommands.ts` | 298 | `stale-comment` | 1 | `scope: 'beat-note',` |
| `src/GossamerCommands.ts` | 943 | `stale-comment` | 1 | `// Get cache for this beat note to read frontmatter fields` |

### `Synopsis` (459)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/ai/log.ts` | 17 | `synopsis_identifier` | 0 | `export type AiLogFeature = 'Inquiry' \| 'Pulse' \| 'Synopsis' \| 'Gossamer';` |
| `src/ai/prompts/strictSchemas.test.ts` | 4 | `synopsis_identifier` | 0 | `import { getSummaryJsonSchema, getSynopsisJsonSchema } from './synopsis';` |
| `src/ai/prompts/strictSchemas.test.ts` | 38 | `synopsis_identifier` | 0 | `assertOpenAiStrictObjectContracts(getSynopsisJsonSchema() as Record<string, any>);` |
| `src/ai/prompts/synopsis.ts` | 2 | `synopsis_identifier` | 0 | `* AI Summary & Synopsis Prompt Builders` |
| `src/ai/prompts/synopsis.ts` | 4 | `synopsis_identifier` | 0 | `* Synopsis = concise, skimmable navigation text (strict max word cap)` |
| `src/ai/prompts/synopsis.ts` | 35 | `synopsis_identifier` | 0 | `export function getSynopsisJsonSchema() {` |
| `src/ai/prompts/synopsis.ts` | 43 | `synopsis_identifier` | 0 | `export function getSynopsisSystemPrompt(): string {` |
| `src/ai/prompts/synopsis.ts` | 88 | `synopsis_identifier` | 0 | `* Build a prompt for generating a short Synopsis with a strict word cap.` |
| `src/ai/prompts/synopsis.ts` | 89 | `synopsis_identifier` | 0 | `* Synopsis is concise, skimmable navigation text for hovers and outlines.` |
| `src/ai/prompts/synopsis.ts` | 91 | `synopsis_identifier` | 0 | `export function buildSynopsisPrompt(` |
| `src/ai/prompts/unifiedBeatAnalysis.ts` | 22 | `synopsis_copy` | 5 | `description?: string; // Beat Synopsis from frontmatter — tells the AI what this beat is in the story` |
| `src/GossamerCommands.ts` | 953 | `synopsis_copy` | 5 | `const synopsis = typeof fm?.Synopsis === 'string' ? fm.Synopsis.trim() : '';` |
| `src/i18n/locales/en.ts` | 167 | `synopsis_identifier` | 0 | `config: { inquiryTitle: string; citationsName: string; citationsDesc: string; timelineDisplayTitle: string; pulseContextName: string; pulseContextDesc: string; synopsisMaxWordsName: string; synopsisMaxWordsDesc: string; synopsisMaxWordsInvalid: string; summaryRefreshTitle: string; targetSummaryName: string; targetSummaryDesc: string; targetSummaryInvalid: string; weakThresholdName: string; weakThresholdDesc: string; weakThresholdInvalid: string; alsoUpdateSynopsisName: string; alsoUpdateSynopsisDesc: string; };` |
| `src/i18n/locales/en.ts` | 596 | `synopsis_identifier` | 0 | `includeSynopsis: string;` |
| `src/i18n/locales/en.ts` | 597 | `synopsis_identifier` | 0 | `includeSynopsisNote: string;` |
| `src/i18n/locales/en.ts` | 705 | `synopsis_copy` | 5 | `name: 'Synopsis max words',` |
| `src/i18n/locales/en.ts` | 706 | `synopsis_copy` | 5 | `desc: 'Maximum words for generated Synopsis. Hover display is synced automatically from this value.',` |
| `src/i18n/locales/en.ts` | 888 | `synopsis_copy` | 5 | `synopsisMaxWordsName: 'Synopsis max words',` |
| `src/i18n/locales/en.ts` | 889 | `synopsis_copy` | 5 | `synopsisMaxWordsDesc: 'Base cap for generated Synopsis text. Hover can use a little more when space allows, but this remains the stored Synopsis target.',` |
| `src/i18n/locales/en.ts` | 890 | `synopsis_copy` | 5 | `synopsisMaxWordsInvalid: 'Synopsis length must be between 10 and 300 words.',` |

### `DEPRECATED` (84)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `scripts/check-api-features.mjs` | 45 | `stale-comment` | 1 | `const ALLOWED_MATURITY = new Set(['experimental', 'beta', 'preview', 'ga', 'deprecated', 'removed']);` |
| `scripts/compliance-check.mjs` | 234 | `stale-comment` | 1 | `id: 'deprecated-frontmatter-props',` |
| `scripts/compliance-check.mjs` | 235 | `stale-comment` | 1 | `description: 'Use tags/aliases/cssclasses instead of deprecated tag/alias/cssclass (Obsidian 1.9.0+).',` |
| `scripts/compliance-check.mjs` | 247 | `stale-comment` | 1 | `case 'deprecated-frontmatter-props':` |
| `scripts/compliance-report.mjs` | 58 | `stale-comment` | 1 | `if (m.includes("tags/aliases/cssclasses")) return "deprecated-frontmatter";` |
| `scripts/compliance-report.mjs` | 96 | `stale-comment` | 1 | `md += "- `deprecated-frontmatter` — rename `tag` → `tags`, `alias` → `aliases`, `cssclass` → `cssclasses`.\n";` |
| `src/ai/caps/engineCapabilities.test.ts` | 143 | `stale-comment` | 1 | `const google = BUILTIN_MODELS.find(m => m.provider === 'google' && m.status !== 'deprecated');` |
| `src/ai/registry/releaseChannels.ts` | 44 | `stale-comment` | 1 | `.filter(model => model.status !== 'deprecated')` |
| `src/ai/registry/releaseChannels.ts` | 52 | `stale-comment` | 1 | `.filter(model => model.status !== 'deprecated');` |
| `src/ai/router/selectModel.ts` | 11 | `stale-comment` | 1 | `.filter(model => model.status !== 'deprecated')` |
| `src/ai/types.ts` | 19 | `stale-comment` | 1 | `export type ModelStatus = 'stable' \| 'preview' \| 'legacy' \| 'deprecated';` |
| `src/ai/types.ts` | 20 | `stale-comment` | 1 | `export type ModelRolloutStatus = 'stable' \| 'provisional' \| 'deprecated';` |
| `src/ai/types.ts` | 157 | `stale-comment` | 1 | `/** @deprecated Anthropic Inquiry requests use a fixed 1h TTL; persisted values are ignored. */` |
| `src/api/anthropicApi.ts` | 6 | `stale-comment` | 1 | `// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.` |
| `src/api/geminiApi.ts` | 6 | `stale-comment` | 1 | `// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.` |
| `src/api/legacyAccessGuard.ts` | 1 | `stale-comment` | 1 | `// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.` |
| `src/api/legacyAccessGuard.ts` | 7 | `stale-comment` | 1 | ``${LEGACY_WARNING_PREFIX} ${apiName} is deprecated and should only be reached through src/ai/providers adapters.`` |
| `src/api/openaiApi.ts` | 6 | `stale-comment` | 1 | `// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.` |
| `src/api/openaiApi.ts` | 12 | `stale-comment` | 1 | `/** @deprecated Use modelSupportsSystemRole(provider, modelId) from providerCapabilities.` |
| `src/api/providerCapabilities.ts` | 1 | `stale-comment` | 1 | `// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.` |

### `TODO` (80)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `scripts/add-api-feature.mjs` | 82 | `stale-comment` | 1 | `const docUrl = args['doc-url'] \|\| 'TODO';` |
| `scripts/add-api-feature.mjs` | 127 | `stale-comment` | 1 | `availableSince: 'TODO',` |
| `scripts/add-api-feature.mjs` | 128 | `stale-comment` | 1 | `requiredApiVersion: 'TODO',` |
| `scripts/add-api-feature.mjs` | 143 | `stale-comment` | 1 | `implementationNotes: notes \|\| 'TODO: Add implementation details.',` |
| `scripts/add-api-feature.mjs` | 180 | `stale-comment` | 1 | `// Flag TODO fields` |
| `scripts/add-api-feature.mjs` | 182 | `stale-comment` | 1 | `if (capEntry.availableSince === 'TODO') todos.push('availableSince');` |
| `scripts/add-api-feature.mjs` | 183 | `stale-comment` | 1 | `if (capEntry.requiredApiVersion === 'TODO') todos.push('requiredApiVersion');` |
| `scripts/add-api-feature.mjs` | 184 | `stale-comment` | 1 | `if (capEntry.documentationUrl === 'TODO') todos.push('documentationUrl');` |
| `scripts/add-api-feature.mjs` | 186 | `stale-comment` | 1 | `if (intEntry.implementationNotes.includes('TODO')) todos.push('implementationNotes');` |
| `scripts/check-api-features.mjs` | 129 | `stale-comment` | 1 | `if (!cap.availableSince \|\| cap.availableSince === 'TODO') {` |
| `scripts/check-api-features.mjs` | 132 | `stale-comment` | 1 | `if (!cap.documentationUrl \|\| cap.documentationUrl === 'TODO') {` |
| `src/assets/embeddedFonts.ts` | 24 | `stale-comment` | 1 | `normal: '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BQYGBgYGAwMGAwgGBgYGBQYFBgYIBQYGBQMFBgUAAAALCAYABAQDBggHCAgDBAQGBgQGAwgHBAcHBwcHBwcHAwMGBgYHCAcHBwcHBwcHBgcHBwgHBwcHBwcGBwcIBwcHBAgEBgcEBwcGBwcHBwcDAwcDCAcHBwcGBwYHBwgGBwcGAwYHBgAAAAwJBgAFBQMGCQgJCQMFBQYGBQYDCQgFCAgICAgICAgDAwYGBggJCAgICAgICAgGCAgICQgICAgICAYICAkICAgFCQUGCAUICAYICAgICAMDCAMJCAgICAYIBggICQYICAYDBggGAAAADQoHAAUFAwcKCAoKAwUFBwcFBwMKCAUICAgICAgICAMDBwcHCAoICAgICAgICAcICAgKCAgICAgIBwgICggICAUKBQcIBQgIBwgICAgIAwMIAwoICAgIBwgHCAgKBwgIBwMHCAcAAAAOCwcABQUEBwsJCwsEBQUHBwUHBAsJBQkJCQkJCQkJBAQHBwcJCwkJCQkJCQkJBwkJCQsJCQkJCQkHCQkLCQkJBQsFBwkFCQkHCQkJCQkEBAkECwkJCQkHCQcJCQsHCQkHBAcJBwAAAA8LCAAGBgQICwkLCwQGBggIBggECwkGCQkJCQkJCQkEBAgICAkLCQkJCQkJCQkICQkJCwkJCQkJCQgJCQsJCQkGCwYICQYJCQgJCQkJCQQECQQLCQkJCQgJCAkJCwgJCQgECAkIAAAAEAwIAAYGBAgMCgwMBAYGCAgGCAQMCgYKCgoKCgoKCgQECAgICgwKCgoKCgoKCggKCgoMCgoKCgoKCAoKDAoKCgYMBggKBgoKCAoKCgoKBAQKBAwKCgoKCAoICgoMCAoKCAQICggAAAARDQkABgYECQ0LDQ0EBgYJCQYJBA0LBgsLCwsLCwsLBAQJCQkLDQsLCwsLCwsLCQsLCw0LCwsLCwsJCwsNCwsLBg0GCQsGCwsJCwsLCwsEBAsEDQsLCwsJCwkLCw0JCwsJBAkLCQAAABIOCQAHBwUJDgsODgUHBwkJBwkFDgsHCwsLCwsLCwsFBQkJCQsOCwsLCwsLCwsJCwsLDgsLCwsLCwkLCw4LCwsHDgcJCwcLCwkLCwsLCwUFCwUOCwsLCwkLCQsLDgkLCwkFCQsJAAAAEw4KAAcHBQoODA4OBQcHCgoHCgUODAcMDAwMDAwMDAUFCgoKDA4MDAwMDAwMDAoMDAwODAwMDAwMCgwMDgwMDAcOBwoMBwwMCgwMDAwMBQUMBQ4MDAwMCgwKDAwOCgwMCgUKDAoAAAAUDwoACAgFCg8NDw8FCAgKCggKBQ8NCA0NDQ0NDQ0NBQUKCgoNDw0NDQ0NDQ0NCg0NDQ8NDQ0NDQ0KDQ0PDQ0NCA8ICg0IDQ0KDQ0NDQ0FBQ0FDw0NDQ0KDQoNDQ8KDQ0KBQoNCgAAABUQCwAICAULEA0QEAUICAsLCAsFEA0IDQ0NDQ0NDQ0FBQsLCw0QDQ0NDQ0NDQ0LDQ0NEA0NDQ0NDQsNDRANDQ0IEAgLDQgNDQsNDQ0NDQUFDQUQDQ0NDQsNCw0NEAsNDQsFCw0LAAAAFhELAAgIBgsRDhERBggICwsICwYRDggODg4ODg4ODgYGCwsLDhEODg4ODg4ODgsODg4RDg4ODg4OCw4OEQ4ODggRCAsOCA4OCw4ODg4OBgYOBhEODg4OCw4LDg4RCw4OCwYLDgsAAAAXEQwACQkGDBEOEREGCQkMDAkMBhEOCQ4ODg4ODg4OBgYMDAwOEQ4ODg4ODg4ODA4ODhEODg4ODg4MDg4RDg4OCREJDA4JDg4MDg4ODg4GBg4GEQ4ODg4MDgwODhEMDg4MBgwODAAAABgSDAAJCQYMEg8SEgYJCQwMCQwGEg8JDw8PDw8PDw8GBgwMDA8SDw8PDw8PDw8MDw8PEg8PDw8PDwwPDxIPDw8JEgkMDwkPDwwPDw8PDwYGDwYSDw8PDwwPDA8PEgwPDwwGDA8MAAAAAAACEwGQAAUAAQK8AooAAACPArwCigAAAcUAMgEDAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEFsdHMAQAAgIBAC7v8GAAAC7gB9AAAAAQAAAAEAAD/X79hfDzz1AAAD6AAAAAC6pnmDAAAAALqmeYMAAP+DAnEC7gAAAAMAAgABAAAAAAABAAAC7v8GAAAC7gAAAD4CcQABAAAAAAAAAAAAAAAAAAAAYwABAAAAYwAgAAcAAAAAAAIACABAAAoAAABXAKoAAQAB' // TODO: Paste your base64-encoded 04b03b woff2 font here` |
| `src/inquiry/corpus/inquiryCorpusStripRenderer.ts` | 259 | `stale-comment` | 1 | `label: 'Todo — dashed border',` |
| `src/inquiry/corpus/inquiryCorpusStripSlotRenderer.ts` | 83 | `stale-comment` | 1 | `'is-status-todo',` |
| `src/inquiry/corpus/inquiryCorpusStripSlotRenderer.ts` | 160 | `stale-comment` | 1 | `const statusBorderNote = args.sceneStatus === 'todo'` |
| `src/inquiry/services/corpusCellStatus.test.ts` | 7 | `stale-comment` | 1 | `it('returns todo for todo status with future due date', () => {` |
| `src/inquiry/services/corpusCellStatus.test.ts` | 9 | `stale-comment` | 1 | `status: 'Todo',` |
| `src/inquiry/services/corpusCellStatus.test.ts` | 12 | `stale-comment` | 1 | `})).toBe('todo');` |
| `src/inquiry/services/corpusCellStatus.test.ts` | 45 | `stale-comment` | 1 | `it('returns todo when status is missing and due date is missing', () => {` |
| `src/inquiry/services/corpusCellStatus.test.ts` | 50 | `stale-comment` | 1 | `})).toBe('todo');` |

### `refreshTimelineIfNeeded` (32)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/GossamerCommands.ts` | 723 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(undefined);` |
| `src/GossamerCommands.ts` | 795 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(null);` |
| `src/main.ts` | 274 | `drift-term` | 1 | `this.refreshTimelineIfNeeded(null);` |
| `src/main.ts` | 282 | `drift-term` | 1 | `this.refreshTimelineIfNeeded(null);` |
| `src/main.ts` | 425 | `drift-term` | 1 | `this.refreshTimelineIfNeeded(null);` |
| `src/main.ts` | 844 | `drift-term` | 1 | `// Settings UI calls this instead of refreshTimelineIfNeeded(null) so` |
| `src/main.ts` | 862 | `drift-term` | 1 | `this.refreshTimelineIfNeeded(null, 100);` |
| `src/main.ts` | 866 | `drift-term` | 1 | `refreshTimelineIfNeeded(file: TAbstractFile \| null \| undefined, delayMs?: number) {` |
| `src/main.ts` | 870 | `drift-term` | 1 | `this.timelineService.refreshTimelineIfNeeded(file, effectiveDelay);` |
| `src/modes/ModeManager.ts` | 172 | `drift-term` | 1 | `this.plugin.refreshTimelineIfNeeded(null);` |
| `src/sceneAnalysis/Maintenance.ts` | 343 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(null);` |
| `src/sceneAnalysis/Maintenance.ts` | 386 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(null);` |
| `src/sceneAnalysis/Processor.ts` | 331 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(null);` |
| `src/sceneAnalysis/Processor.ts` | 470 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(null);` |
| `src/sceneAnalysis/Processor.ts` | 632 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(null);` |
| `src/sceneAnalysis/Processor.ts` | 785 | `drift-term` | 1 | `plugin.refreshTimelineIfNeeded(null);` |
| `src/services/FileTrackingService.ts` | 67 | `drift-term` | 1 | `this.plugin.refreshTimelineIfNeeded(null);` |
| `src/services/FileTrackingService.ts` | 76 | `drift-term` | 1 | `this.plugin.refreshTimelineIfNeeded(null);` |
| `src/services/FileTrackingService.ts` | 80 | `drift-term` | 1 | `this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => this.plugin.refreshTimelineIfNeeded(file)));` |
| `src/services/FileTrackingService.ts` | 98 | `drift-term` | 1 | `this.plugin.refreshTimelineIfNeeded(null);` |

### `IMPORTANT` (18)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `scripts/css-drift-check.mjs` | 198 | `stale-comment` | 1 | `// 1) !important (fail)` |
| `scripts/css-drift-check.mjs` | 199 | `stale-comment` | 1 | `for (const m of findAll(/!important\b/g, css)) {` |
| `scripts/css-drift-check.mjs` | 202 | `stale-comment` | 1 | `"Found !important (ban).",` |
| `scripts/css-drift-check.mjs` | 203 | `stale-comment` | 1 | `"!important",` |
| `scripts/css-drift-check.mjs` | 204 | `stale-comment` | 1 | `"important",` |
| `src/inquiry/modals/InquiryBriefingModal.ts` | 549 | `stale-comment` | 1 | `child.style.display = 'none'; // SAFE: inline style used for print staging to hide Obsidian chrome without stylesheet !important` |
| `src/inquiry/modals/InquiryBriefingModal.ts` | 552 | `stale-comment` | 1 | `const reset = 'position:static !important;inset:auto !important;transform:none !important;margin:0 !important;';` |
| `src/inquiry/modals/InquiryBriefingModal.ts` | 559 | `stale-comment` | 1 | `modalBg.style.display = 'none'; // SAFE: inline style used for print staging to hide modal backdrop without stylesheet !important` |
| `src/renderer/apr/AprBranding.ts` | 303 | `stale-comment` | 1 | `// Build the SVG text element - IMPORTANT: minimize whitespace since xml:space="preserve"` |
| `src/renderer/components/BackdropRing.ts` | 52 | `stale-comment` | 1 | `// IMPORTANT: We must replicate the EXACT deduplication and sorting logic used by Chronologue.ts` |
| `src/settings/sections/AiSection.ts` | 2533 | `stale-comment` | 1 | `setting.settingEl.style.setProperty('display', 'none', 'important');` |
| `src/settings/sections/ChronologueSection.ts` | 130 | `stale-comment` | 1 | `// Set fixed width for dropdown (override CSS with important)` |
| `src/settings/sections/ChronologueSection.ts` | 131 | `stale-comment` | 1 | `dropdown.selectEl.style.setProperty('width', '250px', 'important');` |
| `src/settings/sections/ChronologueSection.ts` | 132 | `stale-comment` | 1 | `dropdown.selectEl.style.setProperty('min-width', '250px', 'important');` |
| `src/settings/sections/ChronologueSection.ts` | 133 | `stale-comment` | 1 | `dropdown.selectEl.style.setProperty('max-width', '250px', 'important');` |
| `src/SynopsisManager.ts` | 2664 | `stale-comment` | 1 | `// IMPORTANT: If the beat already includes a title/comment separator (" / "),` |
| `src/utils/beatsSystems.ts` | 132 | `stale-comment` | 1 | `description: "The lowest point. The protagonist loses everything or believes they do. The goal seems impossible. This is often the moment of greatest despair, where hope appears lost. Something or someone important may be literally or figuratively lost. The 'whiff of death' moment.",` |
| `src/utils/pathScope.ts` | 35 | `stale-comment` | 1 | `* IMPORTANT: this is now strict. Empty folder path is NOT in scope.` |

### `Ripple Rename` (18)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/i18n/locales/en.ts` | 711 | `drift-term` | 1 | `name: 'Manuscript ripple rename: normalize numeric prefixes after drag reorder.',` |
| `src/i18n/locales/en.ts` | 1655 | `drift-term` | 1 | `rangeDecimalWarning: 'Some scene filenames use decimal prefixes. Canonical scene numbering is integer-only; use drag + Ripple Rename to normalize.',` |
| `src/modals/DragConfirmModal.ts` | 109 | `drift-term` | 1 | `this.createImpactCard(impactGrid, 'Extra effect', 'Ripple rename enabled', ICON_WAVES);` |
| `src/modals/DragConfirmModal.ts` | 130 | `drift-term` | 1 | `if (entry.rippleRename) metaParts.push('Ripple rename');` |
| `src/services/SceneReorderService.ts` | 100 | `drift-term` | 1 | `// Ripple rename passes number-only updates and should not touch file contents.` |
| `src/services/SceneReorderService.ts` | 273 | `drift-term` | 1 | `* Build a targeted manuscript-wide ripple rename plan.` |
| `src/utils/recentStructuralMoveLog.ts` | 54 | `drift-term` | 1 | `lines.push(`- Ripple rename: ${formatBoolean(entry.rippleRename)}`);` |
| `src/view/interactions/OuterRingDragController.ts` | 1194 | `drift-term` | 1 | `if (onStatus) onStatus('Ripple rename: already normalized (filenames only; no content edits).');` |
| `src/view/interactions/OuterRingDragController.ts` | 1195 | `drift-term` | 1 | `else new Notice('Ripple rename: already normalized (filenames only; no content edits).', 2600);` |
| `src/view/interactions/OuterRingDragController.ts` | 1199 | `drift-term` | 1 | `if (onStatus) onStatus(`Ripple rename: ${plan.needRename} file(s) need renaming (${plan.checked} checked, filenames only).`);` |
| `src/view/interactions/OuterRingDragController.ts` | 1200 | `drift-term` | 1 | `else new Notice(`Ripple rename: ${plan.needRename} file(s) need renaming (${plan.checked} checked, filenames only).`, 3200);` |
| `src/view/interactions/OuterRingDragController.ts` | 1205 | `drift-term` | 1 | `onStatus(this.formatRenameProgressLine('Ripple rename', progress));` |
| `src/view/interactions/OuterRingDragController.ts` | 1217 | `drift-term` | 1 | `console.warn('Ripple rename verification warning:', error);` |
| `src/view/interactions/OuterRingDragController.ts` | 1218 | `drift-term` | 1 | `if (onStatus) onStatus('Ripple rename applied, but RT detected a potential issue. Review affected notes.');` |
| `src/view/interactions/OuterRingDragController.ts` | 1219 | `drift-term` | 1 | `else new Notice('Ripple rename applied, but RT detected a potential issue. Review affected notes.', 5000);` |
| `src/view/interactions/OuterRingDragController.ts` | 1221 | `drift-term` | 1 | `console.error('Ripple rename failed:', error);` |
| `src/view/interactions/OuterRingDragController.ts` | 1222 | `drift-term` | 1 | `if (onStatus) onStatus('Ripple rename failed. See console for details.');` |
| `src/view/interactions/OuterRingDragController.ts` | 1223 | `drift-term` | 1 | `else new Notice('Ripple rename failed. See console for details.', 3500);` |

### `TEMP` (14)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `scripts/publish-wiki.mjs` | 23 | `stale-comment` | 1 | `// 1. Clean up previous temp dir` |
| `scripts/publish-wiki.mjs` | 25 | `stale-comment` | 1 | `console.log('Cleaning up previous temp directory...');` |
| `scripts/publish-wiki.mjs` | 33 | `stale-comment` | 1 | `// 3. Copy files from 'wiki/' to temp dir` |
| `src/renderer/components/BackdropMicroRings.ts` | 136 | `stale-comment` | 1 | `const temp = startMs;` |
| `src/renderer/components/BackdropMicroRings.ts` | 138 | `stale-comment` | 1 | `endMs = temp;` |
| `src/renderer/TimelineRenderer.ts` | 360 | `stale-comment` | 1 | `// TEMP TEST: Force full year display to see all colors` |
| `src/renderer/TimelineRenderer.ts` | 361 | `stale-comment` | 1 | `// const yearProgress = 1; // TEMP TEST: Force 100% to display all segments` |
| `src/services/SceneReorderService.ts` | 79 | `stale-comment` | 1 | `* Uses two-phase rename: ALL files go through temp namespace first.` |
| `src/services/SceneReorderService.ts` | 124 | `stale-comment` | 1 | `// Simple temp name: z + final basename (sorts to end, easy to spot)` |
| `src/services/SceneReorderService.ts` | 143 | `stale-comment` | 1 | `// Phase 1: Rename ALL files to temp namespace` |
| `src/services/SceneReorderService.ts` | 155 | `stale-comment` | 1 | `// Phase 2: Rename ALL files from temp to final` |
| `src/utils/exportFormats.ts` | 11 | `stale-comment` | 1 | `import * as fs from 'fs'; // SAFE: Node fs required for Pandoc temp files` |
| `src/utils/exportFormats.ts` | 12 | `stale-comment` | 1 | `import * as os from 'os'; // SAFE: Node os required for temp directory resolution` |
| `src/utils/exportFormats.ts` | 13 | `stale-comment` | 1 | `import * as path from 'path'; // SAFE: Node path required for temp/absolute paths` |

### `ChangeType.SETTINGS` (6)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/renderer/ChangeDetection.ts` | 278 | `drift-term` | 1 | `changeTypes.add(ChangeType.SETTINGS);` |
| `src/renderer/ChangeDetection.ts` | 304 | `drift-term` | 1 | `changeTypes.add(ChangeType.SETTINGS);` |
| `src/renderer/ChangeDetection.ts` | 368 | `drift-term` | 1 | `case ChangeType.SETTINGS: return 'settings';` |
| `src/services/TimelineService.ts` | 74 | `drift-term` | 1 | `changeTypes.includes(ChangeType.SETTINGS)) {` |
| `src/services/TimelineService.ts` | 123 | `drift-term` | 1 | `this.scheduleRender([ChangeType.SETTINGS], effectiveDelay);` |
| `src/settings/SettingImpact.ts` | 33 | `drift-term` | 1 | `changeTypes: [ChangeType.SETTINGS],` |

### `legacy key` (5)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/ai/credentials/credentials.test.ts` | 50 | `drift-term` | 1 | `it('migration moves legacy key values into Secret Storage and clears legacy fields', async () => {` |
| `src/modals/SceneAnalysisProcessingModal.ts` | 98 | `drift-term` | 1 | `private processedSynopsisResults: Map<string, string> = new Map(); // Optional staged Synopsis writes (legacy key).` |
| `src/modals/SceneAnalysisProcessingModal.ts` | 163 | `drift-term` | 1 | `// Summary-refresh settings are persisted on plugin settings (legacy key names retained for compatibility).` |
| `src/services/SceneDataService.ts` | 161 | `drift-term` | 1 | `// Compat: Check for legacy keys (metrics only)` |
| `src/settings/sections/BeatPropertiesSection.ts` | 4259 | `drift-term` | 1 | `// Migrate deprecated fields button (hidden until audit finds legacy keys with safe migration path)` |

### `getMergedBeatYaml` (4)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/utils/beatsTemplates.ts` | 52 | `drift-term` | 1 | `* Used by: settings UI editor, note generation (getMergedBeatYaml).` |
| `src/utils/beatsTemplates.ts` | 160 | `drift-term` | 1 | `export function getMergedBeatYaml(settings: RadialTimelineSettings): string {` |
| `src/utils/beatsTemplates.ts` | 525 | `drift-term` | 1 | `/** @deprecated Use getMergedBeatYaml */` |
| `src/utils/beatsTemplates.ts` | 526 | `drift-term` | 1 | `export const getMergedBeatYamlTemplate = getMergedBeatYaml;` |

### `plaintext key` (3)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/ai/credentials/noPlaintextKeys.test.ts` | 64 | `drift-term` | 1 | `describe('no plaintext key material invariant', () => {` |
| `src/ai/credentials/noPlaintextKeys.test.ts` | 65 | `drift-term` | 1 | `it('settings serialization keeps saved key names without plaintext key values', () => {` |
| `src/settings/sections/AiSection.ts` | 2739 | `drift-term` | 1 | `text: `${options.providerName} requires Obsidian secret storage. Older plaintext key fields are no longer supported.`` |

### `HACK` (1)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/utils/tooltip.ts` | 16 | `stale-comment` | 3 | `* and the previous hack of creating anchor elements caused modal focus issues.` |

### `mergeTemplates` (1)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/utils/sceneGenerator.ts` | 10 | `drift-term` | 5 | `export function mergeTemplates(baseTemplate: string, advancedFields: string): string {` |

### `WORKAROUND` (1)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| `src/modals/BookDesignerModal.ts` | 844 | `stale-comment` | 3 | `// Forward reference workaround: Define lengthSetting first but add it later?` |

### `advanced template cleanup` (0)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| (none) | - | - | - | - |

### `api key in settings` (0)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| (none) | - | - | - | - |

### `FIXME` (0)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| (none) | - | - | - | - |

### `prefix normalization` (0)

| File | Line | Category | Weight | Matched line |
| --- | --- | --- | --- | --- |
| (none) | - | - | - | - |

## Next PR checklist (no edits in this PR)

- [ ] Convert unlabeled TODO/FIXME to `TODO(#issue)` or delete if obsolete.
- [ ] Rewrite comments that reference removed systems to point to canonical helpers.
- [ ] Remove dead wrappers after a dev-guard period.
- [ ] Remove unused exports and legacy adapters.

