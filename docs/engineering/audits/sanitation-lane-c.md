# Sanitation Lane C Hotspots

Source: `docs/audits/sanitation-audit.json` (filtered for AI credentials/providers, export/template pipeline, and Synopsis/Summary drift terms).

## Ranked Hotspots (Top 20)

| File | Token Hits | Suggested Action |
| --- | ---: | --- |
| `src/SynopsisManager.ts` | 201 | Identifier-heavy file: target only misleading comments; avoid renaming runtime keys/functions in this pass. |
| `src/modals/SceneAnalysisProcessingModal.ts` | 123 | Rewrite summary-refresh comments to canonical pointers; keep schema/field compatibility keys unchanged. |
| `src/sceneAnalysis/SynopsisCommands.ts` | 66 | Rewrite drifted comments to Summary-first wording; keep legacy Synopsis fields only where compatibility is required. |
| `src/inquiry/InquiryView.ts` | 64 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/settings/sections/BeatPropertiesSection.ts` | 33 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/view/interactions/SceneInteractionManager.ts` | 19 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/view/modes/ChronologueMode.ts` | 19 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/view/modes/GossamerMode.ts` | 18 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/types/settings.ts` | 17 | Prefer Summary terminology in comments/UI-copy fields while preserving backward-compatible setting keys. |
| `src/utils/yamlTemplateNormalize.ts` | 17 | Keep single-source-of-truth pointer to `getTemplateParts()` and trim legacy merge naming drift. |
| `src/renderer/utils/SynopsisBuilder.ts` | 16 | Identifier-heavy file: target only misleading comments; avoid renaming runtime keys/functions in this pass. |
| `src/utils/yamlAudit.ts` | 16 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/i18n/locales/en.ts` | 15 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/renderer/dom/SynopsisDOMUpdater.ts` | 15 | Identifier-heavy file: target only misleading comments; avoid renaming runtime keys/functions in this pass. |
| `src/settings/sections/InquirySection.ts` | 15 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/ai/prompts/synopsis.ts` | 14 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/modals/ManuscriptOptionsModal.ts` | 14 | Delete stale narration and replace with canonical-pointer comments only where constraints are non-obvious. |
| `src/utils/exportFormats.ts` | 14 | Delete obvious narration; keep focused constraints around path resolution, Pandoc execution, and temp-file cleanup. |
| `src/services/CommandRegistrar.ts` | 13 | Replace export-path narration with canonical pointers to `assembleManuscript`, `getTemplateParts`, and Pandoc helpers. |
| `src/sceneAnalysis/aiProvider.ts` | 12 | Add/keep canonical pointer comments for credential redaction and runtime model routing; avoid changing provider behavior. |

## Representative Drift-Prone Lines

### `src/SynopsisManager.ts` (201 hits)

- L11: `import { getPublishStageStyle, splitSynopsisLines, decodeContentLines, isOverdueAndIncomplete } from './synopsis/SynopsisData';`
- L19: `SYNOPSIS_INSET,`
- L29: `import { getSynopsisHoverLineLimit } from './utils/synopsisLimits';`
- L32: `* Handles generating synopsis SVG/HTML blocks and positioning logic.`
- L35: `export default class SynopsisManager {`

### `src/modals/SceneAnalysisProcessingModal.ts` (123 hits)

- L15: `import { getSynopsisGenerationWordLimit } from '../utils/synopsisLimits';`
- L19: `export type ProcessingMode = 'flagged' \| 'unprocessed' \| 'force-all' \| 'synopsis-flagged' \| 'synopsis-missing-weak' \| 'synopsis-missing' \| 'synopsis-all';`
- L93: `private readonly taskType: 'pulse' \| 'synopsis';`
- L96: `private processedSynopsisResults: Map<string, string> = new Map(); // Store synopsis results for apply phase`
- L103: `// Synopsis-specific controls`

### `src/sceneAnalysis/SynopsisCommands.ts` (66 hits)

- L7: `* Synopsis = concise, skimmable navigation text (strict word-capped) — optional for scene hovers.`
- L14: `import { classifySynopsis } from './synopsisQuality';`
- L21: `import { getSynopsisGenerationWordLimit, truncateToWordLimit } from '../utils/synopsisLimits';`
- L68: `function placeSummaryAfterSynopsis(frontmatter: Record<string, unknown>): void {`
- L71: `const synopsisKey = keys.find(key => key.toLowerCase() === 'synopsis');`

### `src/inquiry/InquiryView.ts` (64 hits)

- L84: `import { classifySynopsis, type SynopsisQuality } from '../sceneAnalysis/synopsisQuality';`
- L100: `const INQUIRY_SYNOPSIS_CAPABLE_CLASSES = new Set(['scene', 'outline']);`
- L739: `sceneSynopsisUsed: number;`
- L803: `synopsisWords: number;`
- L1005: `synopsisWords: number;`

### `src/settings/sections/BeatPropertiesSection.ts` (33 hits)

- L116: `header.createDiv({ cls: 'ert-modal-subtitle', text: 'This name identifies your beat system and appears in each beat note\'s frontmatter.' });`
- L1052: `setTooltip(healthIcon, `${existingBeatMisalignedCount} beat note${existingBeatMisalignedCount !== 1 ? 's' : ''} have wrong Act. Use Repair to update frontmatter.`);`
- L2028: `setTooltip(iconInput, fieldsReadOnly ? 'Requires Pro' : 'Lucide icon name for hover synopsis');`
- L2038: `setTooltip(checkbox, fieldsReadOnly ? 'Requires Pro' : 'Show in beat hover synopsis');`
- L2184: `setTooltip(addIconInput, 'Lucide icon name for beat hover synopsis');`

### `src/view/interactions/SceneInteractionManager.ts` (19 hits)

- L10: `* Manages scene hover interactions, synopsis display, and scene title auto-expansion.`
- L15: `import { updateSynopsisTitleColor } from './SynopsisTitleColorManager';`
- L35: `private currentSynopsis: Element \| null = null;`
- L142: `this.currentSynopsis = this.findSynopsisForScene(sceneId);`
- L147: `// Show synopsis - position it BEFORE making visible to prevent flicker`

### `src/view/modes/ChronologueMode.ts` (19 hits)

- L9: `import type SynopsisManager from '../../SynopsisManager';`
- L14: `import { updateSynopsisTitleColor } from '../interactions/SynopsisTitleColorManager';`
- L29: `synopsisManager: SynopsisManager;`
- L57: `* Setup scene hover interactions for synopsis display`
- L85: `const synopsisBySceneId = new Map<string, Element>();`

### `src/view/modes/GossamerMode.ts` (18 hits)

- L7: `let currentSynopsis: Element \| null = null;`
- L18: `// 1a. Beat Slice Hover (delegated fallback): Show synopsis, sync dot+spoke`
- L35: `currentSynopsis = findSynopsisForScene(sid);`
- L38: `view.plugin.synopsisManager.updatePosition(currentSynopsis, e as unknown as MouseEvent, svg, sid);`
- L103: `if (currentSynopsis) {`

### `src/types/settings.ts` (17 hits)

- L86: `enabled: boolean; // Show in hover synopsis`
- L97: `export type AuthorProgressPublishTarget = 'folder' \| 'github_pages' \| 'note';`
- L104: `customNoteTemplatePath?: string; // Path to custom note template (Pro feature)`
- L398: `synopsisHoverMaxLines?: number; // @deprecated Legacy hover line limit, now derived from Synopsis max words`
- L417: `// Synopsis generation settings (legacy names — now control Summary generation)`

### `src/utils/yamlTemplateNormalize.ts` (17 hits)

- L12: `import { mergeTemplates } from './sceneGenerator';`
- L91: `/** Resolved template strings for a note type. */`
- L97: `/** Fully merged template string (base + advanced, via `mergeTemplates`). */`
- L102: `* Resolve the base, advanced, and merged template strings for a note type.`
- L121: `? mergeTemplates(base, advanced)`

### `src/renderer/utils/SynopsisBuilder.ts` (16 hits)

- L6: `import { getSynopsisGenerationWordLimit, getSynopsisHoverLineLimit, truncateToWordLimit } from '../../utils/synopsisLimits';`
- L22: `export function buildSynopsisElement(`
- L31: `const maxWords = getSynopsisGenerationWordLimit(plugin.settings as any);`
- L37: `const backdropContext = scene.Context ?? scene.synopsis ?? scene.Description;`
- L41: `return plugin.synopsisManager.generateElement(scene, lines, sceneId, subplotIndexResolver);`

### `src/utils/yamlAudit.ts` (16 hits)

- L4: `* Compares note frontmatter against template-defined base + custom keys`
- L74: `const SCENE_SYNOPSIS_SOFT_CHAR_LIMIT = 500;`
- L135: `const synopsis = getStringField(fm, 'Synopsis');`
- L138: `warnings.push(`Scene Synopsis is ${synopsis.length} chars (soft limit ≈${SCENE_SYNOPSIS_SOFT_CHAR_LIMIT}).`);`
- L141: `if (sentenceCount > SCENE_SYNOPSIS_SOFT_SENTENCE_LIMIT) {`

### `src/i18n/locales/en.ts` (15 hits)

- L86: `synopsisMaxLines: {`
- L234: `includeSynopsis: string;`
- L268: `synopsis: { prefix: string; };`
- L341: `synopsisMaxLines: {`
- L353: `desc: 'When hovering over a scene, automatically expand it if the title text is clipped. Disable this if you prefer to quickly slide through scenes and read titles from the synopsis instead.',`

### `src/renderer/dom/SynopsisDOMUpdater.ts` (15 hits)

- L2: `* Radial Timeline Plugin for Obsidian — Synopsis DOM Updater`
- L10: `* Updates synopsis text content in the DOM without regenerating SVG`
- L13: `export function updateSynopsisText(`
- L21: `if (!scene.path \|\| !scene.synopsis) return;`
- L25: `// Find synopsis elements for this scene`

### `src/settings/sections/InquirySection.ts` (15 hits)

- L96: `const SYNOPSIS_CAPABLE_CLASSES = new Set(['scene', 'outline']);`
- L111: `const isSynopsisCapableClass = (className: string): boolean =>`
- L115: `if (mode === 'summary' && !isSynopsisCapableClass(className)) {`
- L122: `isSynopsisCapableClass(className) ? ['none', 'summary', 'full'] : ['none', 'full'];`
- L138: `const isReference = !isSynopsisCapableClass(config.className);`

### `src/ai/prompts/synopsis.ts` (14 hits)

- L2: `* AI Summary & Synopsis Prompt Builders`
- L18: `const SYNOPSIS_JSON_SCHEMA = {`
- L21: `"synopsis": {`
- L26: `required: ["synopsis"]`
- L33: `export function getSynopsisJsonSchema() {`

### `src/modals/ManuscriptOptionsModal.ts` (14 hits)

- L23: `includeSynopsis?: boolean;`
- L51: `private includeSynopsis: boolean = true;`
- L97: `private outlineSynopsisRow?: HTMLElement;`
- L252: `this.outlinePresetDescEl = this.outlineOptionsCard.createDiv({ cls: 'rt-sub-card-note' });`
- L347: `this.outlineSynopsisRow = rulesCard.createDiv({ cls: 'rt-manuscript-toggle-row' });`

### `src/utils/exportFormats.ts` (14 hits)

- L10: `import * as fs from 'fs'; // SAFE: Node fs required for Pandoc temp files`
- L289: `includeSynopsis = false,`
- L331: `const header = includeSynopsis`
- L347: `if (includeSynopsis) {`
- L375: `if (includeSynopsis) {`

### `src/services/CommandRegistrar.ts` (13 hits)

- L126: `id: 'create-frontmatter-note',`
- L134: `id: 'create-backmatter-note',`
- L142: `id: 'create-bookmeta-note',`
- L290: `result.includeSynopsis ?? false,`
- L316: `statusMessages.push('No BookMeta note found. Semantic matter pages may render incomplete.');`

### `src/sceneAnalysis/aiProvider.ts` (12 hits)

- L74: `const logType = payload.commandContext === 'synopsis' ? 'Synopsis' : 'Pulse';`
- L109: `feature: payload.commandContext === 'synopsis' ? 'Synopsis' : 'Pulse',`
- L172: `feature: payload.commandContext === 'synopsis' ? 'Synopsis' : 'Pulse',`
- L220: `if (commandContext === 'synopsis') {`
- L231: `feature: commandContext === 'synopsis' ? 'SummaryRefresh' : 'PulseAnalysis',`

