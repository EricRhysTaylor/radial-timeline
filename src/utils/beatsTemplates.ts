/*
 * Beat Set Note Creation
 *
 * Compatibility aliases here are limited to the export/template boundary.
 */
import type { LoadedBeatTab } from '../types/settings';
import { Vault, TFile, normalizePath } from 'obsidian';
import { PLOT_SYSTEM_NAMES, STARTER_BEAT_SETS, PlotSystemPreset, PlotBeatInfo, getPlotSystem } from './beatsSystems';
import type { BeatSystemConfig, RadialTimelineSettings } from '../types/settings';
import { normalizeBeatSetNameInput, sanitizeBeatFilenameSegment, toBeatModelMatchKey } from './beatsInputNormalize';
import { mergeTemplateParts } from './templateMerge';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { generateSceneId } from './sceneIds';
import { formatBeatDecimalPrefix } from './prefixOrder';
import {
  getActiveBeatWorkspaceConfigKey,
  getActiveLoadedBeatTab,
} from '../storyBeats/workspaceState';
import { resolveSelectedBeatModelFromSettings } from './beatSystemState';

// ─── Per-system Beat Config Resolvers ────────────────────────────────

/** Empty config used as safe default when no config exists for a system. */
const EMPTY_BEAT_CONFIG: BeatSystemConfig = { beatYamlAdvanced: '', beatHoverMetadataFields: [] };
const DISALLOWED_BEAT_WRITE_FIELDS = new Set(['Description']);
let warnedMissingBeatModelResolution = false;

/** Normalize a Beat Model string for case-insensitive matching. */
function normalizeModelKey(s: string): string {
  return toBeatModelMatchKey(s);
}

export function normalizeBeatBaseTemplateOrder(template: string): string {
  const lines = (template || '').split('\n');
  const beatModelIndex = lines.findIndex((line) => /^Beat Model\s*:/i.test(line.trim()));
  if (beatModelIndex === -1) return template;

  const [beatModelLine] = lines.splice(beatModelIndex, 1);
  const classIndex = lines.findIndex((line) => /^Class\s*:/i.test(line.trim()));
  const idIndex = lines.findIndex((line) => /^ID\s*:/i.test(line.trim()));
  const insertIndex = classIndex >= 0
    ? classIndex + 1
    : idIndex >= 0
      ? idIndex + 1
      : 0;
  lines.splice(insertIndex, 0, beatModelLine);
  return lines.join('\n');
}

/**
 * Resolve the BeatSystemConfig for the currently active system in settings.
 * Used by: settings UI editor, note generation (getMergedBeatYaml).
 * Optional systemKey overrides the active system (for editor previews).
 */
export function getBeatConfigForSystem(
  settings: RadialTimelineSettings,
  systemKey?: string
): BeatSystemConfig {
  const activeTab = getActiveLoadedBeatTab(settings);
  if (activeTab && (!systemKey || normalizeModelKey(systemKey) === normalizeModelKey(activeTab.name))) {
    return activeTab.config;
  }
  const system = (systemKey ?? resolveSelectedBeatModelFromSettings(settings) ?? '').trim();
  if (!system) return EMPTY_BEAT_CONFIG;
  const key = system;
  return settings.beatSystemConfigs?.[key] ?? EMPTY_BEAT_CONFIG;
}

/**
 * Resolve the BeatSystemConfig for a specific beat note by its Beat Model frontmatter value.
 * Used by: SynopsisManager (hover), SearchService (indexing).
 * Falls back through: exact built-in match → active custom → saved custom name match → empty.
 */
export function getBeatConfigForItem(
  settings: RadialTimelineSettings,
  beatModel: string | undefined
): BeatSystemConfig {
  const configs = settings.beatSystemConfigs;
  const beatModelValue = (beatModel ?? '').trim();
  const normalized = normalizeModelKey(beatModelValue);
  if (!normalized) {
    if (process.env.NODE_ENV !== 'production' && !warnedMissingBeatModelResolution) {
      warnedMissingBeatModelResolution = true;
      console.warn('[BeatHover] Attempted beat hover config resolution with missing Beat Model.');
    }
    return EMPTY_BEAT_CONFIG;
  }
  if (!configs) return EMPTY_BEAT_CONFIG;

  const activeTab = getActiveLoadedBeatTab(settings);
  if (activeTab && normalizeModelKey(activeTab.name) === normalized) {
    return activeTab.config;
  }

  // 1. Direct built-in match (exact key)
  if (configs[beatModelValue]) return configs[beatModelValue];

  // 2. Case-insensitive built-in match
  for (const builtinName of PLOT_SYSTEM_NAMES) {
    if (normalizeModelKey(builtinName) === normalized && configs[builtinName]) {
      return configs[builtinName];
    }
  }

  // 3. Active custom system (Beat Model stores the custom system name, not the key)
  const activeWorkspaceKey = getActiveBeatWorkspaceConfigKey(settings);
  if (activeWorkspaceKey && configs[activeWorkspaceKey] && activeTab && normalizeModelKey(activeTab.name) === normalized) {
    return configs[activeWorkspaceKey];
  }

  // 4. Search all saved custom systems by name match
  const saved = settings.savedBeatSystems?.find(
    s => normalizeModelKey(s.name) === normalized
  );
  if (saved) {
    const savedKey = `custom:${saved.id}`;
    if (configs[savedKey]) return configs[savedKey];
  }

  // 5. Starter custom systems by name (maps to custom:<starter-id>)
  const starter = STARTER_BEAT_SETS.find(
    s => normalizeModelKey(s.name) === normalized
  );
  if (starter) {
    const starterKey = `custom:${starter.id}`;
    if (configs[starterKey]) return configs[starterKey];
  }

  return EMPTY_BEAT_CONFIG;
}

/**
 * Convert beatInfo.range to Range field value (0-100 scale).
 */
function getRangeValue(beatInfo: PlotBeatInfo): string {
  if (beatInfo.range) {
    return beatInfo.range;
  }
  return '';
}

/**
 * Build the note body (description + optional placement). Shared by both paths.
 */
function buildBeatBody(beatInfo: PlotBeatInfo): string {
  const bodyParts: string[] = [];
  if (beatInfo.description) bodyParts.push(beatInfo.description);
  if (beatInfo.placement) {
    bodyParts.push('');
    bodyParts.push(`**Manuscript Position:** ${beatInfo.placement}`);
  }
  return bodyParts.length > 0 ? '\n' + bodyParts.join('\n') + '\n' : '';
}

/**
 * Returns the merged beat YAML string (base + properties).
 * @deprecated Use `getTemplateParts('Beat', settings).merged` from yamlTemplateNormalize.ts
 * which is the single source of truth for all note types.
 */
export function getMergedBeatYaml(settings: RadialTimelineSettings): string {
  const configuredBase = settings.beatYamlTemplates?.base
    ?? DEFAULT_SETTINGS.beatYamlTemplates!.base;
  const base = normalizeBeatBaseTemplateOrder(
    configuredBase.replace(/^Description:/gm, 'Purpose:')
  );
  const config = getBeatConfigForSystem(settings);
  const advanced = sanitizeBeatAdvancedForWrite(config.beatYamlAdvanced);
  return advanced.trim()
    ? mergeTemplateParts(base, advanced)
    : base;
}

export function sanitizeBeatAdvancedForWrite(advancedTemplate: string): string {
  const lines = (advancedTemplate || '').split('\n');
  const result: string[] = [];
  let skipUntilNextField = false;

  for (const line of lines) {
    const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9 _'-]*):/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1].trim();
      if (DISALLOWED_BEAT_WRITE_FIELDS.has(fieldName)) {
        skipUntilNextField = true;
        continue;
      }
      skipUntilNextField = false;
      result.push(line);
      continue;
    }
    if (skipUntilNextField) continue;
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Generate Beat note content with frontmatter and body.
 * When a template string is provided, uses {{Placeholder}} substitution.
 * When omitted, produces the exact legacy hardcoded output for backward compatibility.
 */
function applyTemplateCompatibilityAliases(content: string, purpose: string, beatSystem: string, rangeValue: string, act: number): string {
  // Explicit compatibility-only template boundary.
  let transformed = content;
  transformed = transformed.replace(/{{Act}}/g, act.toString());
  transformed = transformed.replace(/{{Purpose}}/g, purpose);
  transformed = transformed.replace(/{{Description}}/g, purpose);
  transformed = transformed.replace(/{{BeatModel}}/g, beatSystem);
  transformed = transformed.replace(/{{Range}}/g, rangeValue);
  return transformed;
}

function generatePlotNoteContent(
  beatInfo: PlotBeatInfo,
  act: number,
  beatSystem: string,
  template?: string
): string {
  const yamlEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const purpose = beatInfo.description ? `"${yamlEscape(beatInfo.description)}"` : '""';
  const rangeValue = getRangeValue(beatInfo);

  const ensureReferenceIdLine = (frontmatterBlock: string): string => {
    const lines = frontmatterBlock.split('\n');
    let foundId = false;
    const output = lines.map((line) => {
      if (!/^id\s*:/i.test(line.trim())) return line;
      foundId = true;
      const current = line.replace(/^id\s*:/i, '').trim();
      if (current.length > 0) return line;
      return `ID: ${generateSceneId()}`;
    });
    if (!foundId) {
      output.unshift(`ID: ${generateSceneId()}`);
    }
    return output.join('\n');
  };

  if (template) {
    // Template-based generation using {{Placeholder}} substitution
    const content = ensureReferenceIdLine(
      applyTemplateCompatibilityAliases(template, purpose, beatSystem, rangeValue, act)
    );

    return `---\n${content}\n---\n` + buildBeatBody(beatInfo);
  }

  // Legacy hardcoded output (backward compatibility)
  const frontmatter = [
    '---',
    `ID: ${generateSceneId()}`,
    'Class: Beat',
    `Beat Model: ${beatSystem}`,
    `Act: ${act}`,
    `Purpose: ${purpose}`,
    rangeValue ? `Range: ${rangeValue}` : 'Range:',
    '---',
    ''
  ].join('\n');

  return frontmatter + buildBeatBody(beatInfo);
}

function extractBeatModelFromFrontmatter(content: string): string | null {
  const match = content.match(/^Beat Model\s*:\s*(.+)$/m);
  if (!match) return null;
  const value = match[1]?.trim() ?? '';
  return value.length > 0 ? value : null;
}

async function findAvailableBeatNotePath(
  vault: Vault,
  targetFolder: string,
  initialPrefix: string,
  safeBeatName: string,
  beatModelName: string
): Promise<{ path: string | null; skippedExisting: boolean }> {
  const match = initialPrefix.match(/^(.+)\.(\d+)$/);
  const majorPrefix = match?.[1] ?? initialPrefix;
  let minorIndex = match ? Number.parseInt(match[2], 10) || 1 : 1;

  for (let attempts = 0; attempts < 200; attempts++) {
    const candidatePrefix = formatBeatDecimalPrefix(majorPrefix, minorIndex, 2);
    const filename = `${candidatePrefix} ${safeBeatName}.md`;
    const filePath = targetFolder ? `${targetFolder}/${filename}` : filename;
    const normalizedPath = normalizePath(filePath);
    const existingFile = vault.getAbstractFileByPath(normalizedPath);
    if (!existingFile) {
      return { path: normalizedPath, skippedExisting: false };
    }
    if (existingFile instanceof TFile) {
      const content = await vault.cachedRead(existingFile);
      const existingBeatModel = extractBeatModelFromFrontmatter(content);
      if (existingBeatModel && normalizeModelKey(existingBeatModel) === normalizeModelKey(beatModelName)) {
        return { path: null, skippedExisting: true };
      }
    }
    minorIndex += 1;
  }

  throw new Error(`Could not find an available filename for beat "${safeBeatName}" after 200 attempts.`);
}

/**
 * Determine Act number based on beat position
 * Roughly: first third = Act 1, middle third = Act 2, final third = Act 3
 */
function getBeatAct(beatIndex: number, totalBeats: number): number {
  const position = beatIndex / totalBeats;
  if (position < 0.33) return 1;
  if (position < 0.67) return 2;
  return 3;
}

/**
 * Spread N beats evenly across M scene positions, returning the chosen scene numbers.
 * - 0 beats: returns []
 * - 1 beat: picks the first scene number
 * - N beats, N <= M: picks evenly spaced scene numbers using index interpolation
 * - N > M: assigns scenes first, then interpolates extras between last scene and max+1
 * - fallback (no scene data): sequential from 1
 */
export function spreadBeatsAcrossScenes(
  beatCount: number,
  sceneNumbers: number[]
): number[] {
  if (beatCount === 0) return [];
  const M = sceneNumbers.length;
  if (M === 0) {
    // Fallback: sequential from 1
    return Array.from({ length: beatCount }, (_, i) => i + 1);
  }
  if (beatCount === 1) return [sceneNumbers[0]];
  if (beatCount <= M) {
    // Pick evenly spaced indices across the scene array
    return Array.from({ length: beatCount }, (_, i) => {
      const idx = Math.round(i * (M - 1) / (beatCount - 1));
      return sceneNumbers[idx];
    });
  }
  // More beats than scenes: assign scenes first, then interpolate extras
  const result = [...sceneNumbers];
  const lastScene = sceneNumbers[M - 1];
  const extra = beatCount - M;
  for (let i = 1; i <= extra; i++) {
    result.push(lastScene + i);
  }
  return result;
}

export function buildBeatDecimalPrefixes(
  beatActs: number[],
  actSceneNumbers?: Map<number, number[]>,
  explicitSceneNumbers?: number[]
): string[] {
  if (Array.isArray(explicitSceneNumbers) && explicitSceneNumbers.length === beatActs.length) {
    const beatPrefixByIndex = new Array<string>(beatActs.length);
    const minorByMajor = new Map<number, number>();

    explicitSceneNumbers.forEach((sceneNumber, index) => {
      const major = Math.max(0, Math.round(sceneNumber));
      const nextMinor = (minorByMajor.get(major) ?? 0) + 1;
      minorByMajor.set(major, nextMinor);
      beatPrefixByIndex[index] = formatBeatDecimalPrefix(String(major), nextMinor, 2);
    });

    return beatPrefixByIndex;
  }

  const beatsByAct = new Map<number, number[]>();
  beatActs.forEach((act, index) => {
    const list = beatsByAct.get(act) ?? [];
    list.push(index);
    beatsByAct.set(act, list);
  });

  const beatPrefixByIndex = new Array<string>(beatActs.length);
  const minorByMajor = new Map<number, number>();
  let fallbackMinor = 1;

  const nextMinorForMajor = (major: number): number => {
    const next = (minorByMajor.get(major) ?? 0) + 1;
    minorByMajor.set(major, next);
    return next;
  };

  const sortedActs = [...beatsByAct.keys()].sort((a, b) => a - b);
  sortedActs.forEach((actNum) => {
    const indices = beatsByAct.get(actNum) ?? [];
    const sceneNums = actSceneNumbers?.get(actNum) ?? [];
    if (sceneNums.length > 0) {
      const spread = spreadBeatsAcrossScenes(indices.length, sceneNums);
      indices.forEach((beatIdx, i) => {
        const major = spread[i];
        const minor = nextMinorForMajor(major);
        beatPrefixByIndex[beatIdx] = formatBeatDecimalPrefix(String(major), minor, 2);
      });
      return;
    }

    indices.forEach((beatIdx) => {
      beatPrefixByIndex[beatIdx] = formatBeatDecimalPrefix('0', fallbackMinor, 2);
      fallbackMinor += 1;
    });
  });

  beatPrefixByIndex.forEach((value, index) => {
    if (value === undefined) {
      beatPrefixByIndex[index] = formatBeatDecimalPrefix('0', fallbackMinor, 2);
      fallbackMinor += 1;
    }
  });

  return beatPrefixByIndex;
}

/**
 * Create beat set notes for a given beat system.
 */
export async function createBeatNotesFromSet(
  vault: Vault,
  beatSystemName: string,
  sourcePath: string,
  customSystem?: PlotSystemPreset,
  options?: { actSceneNumbers?: Map<number, number[]>; beatTemplate?: string; explicitSceneNumbers?: number[] }
): Promise<{ created: number; skipped: number; errors: string[]; createdPaths: string[] }> {
  const beatSystem = getPlotSystem(beatSystemName) ?? customSystem;

  if (!beatSystem) {
    throw new Error(`Unknown beat system: ${beatSystemName}`);
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const createdPaths: string[] = [];

  // Normalize source path
  const targetFolder = sourcePath.trim() ? normalizePath(sourcePath.trim()) : '';

  // Ensure folder exists
  if (targetFolder) {
    const folder = vault.getAbstractFileByPath(targetFolder);
    if (!folder) {
      try {
        await vault.createFolder(targetFolder);
      } catch {
        // Folder might already exist
      }
    }
  }

  const stripActPrefix = (name: string): string => {
    const m = name.match(/^Act\s*\d+\s*:\s*(.+)$/i);
    return m ? m[1].trim() : name.trim();
  };

  // Use the custom system name (if provided) for Beat Model frontmatter instead of generic "Custom"
  const beatModelName = normalizeBeatSetNameInput(beatSystem.name || beatSystemName, beatSystemName || 'Custom');
  if (!beatModelName.trim()) {
    const message = `[BeatTemplates] Missing Beat Model while creating beats for "${beatSystemName}".`;
    console.warn(message);
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(message);
    }
  }

  const actSceneNumbers = options?.actSceneNumbers;
  // Pre-compute beat filename prefixes per act using scene-aligned spread.
  // Scenes own integer slots; beats use decimal minors (e.g., 7.01, 7.02).
  const beatActs = beatSystem.beatDetails.map((beatInfo, index) => (
    beatInfo.act ? beatInfo.act : getBeatAct(index, beatSystem.beats.length)
  ));
  const beatPrefixByIndex = buildBeatDecimalPrefixes(beatActs, actSceneNumbers, options?.explicitSceneNumbers);

  for (let i = 0; i < beatSystem.beats.length; i++) {
    const beatName = beatSystem.beats[i];
    const beatInfo = beatSystem.beatDetails[i];
    const act = beatActs[i];
    const beatNumber = beatPrefixByIndex[i];
    
    // Use canonical title without "Act X:" prefix for filename
    const displayName = stripActPrefix(beatName);
    const safeBeatName = sanitizeBeatFilenameSegment(displayName);
    const resolvedPath = await findAvailableBeatNotePath(
      vault,
      targetFolder,
      beatNumber,
      safeBeatName,
      beatModelName
    );
    if (resolvedPath.skippedExisting || !resolvedPath.path) {
      skipped++;
      continue;
    }
    const normalizedPath = resolvedPath.path;
    const filename = normalizedPath.split('/').pop() ?? `${beatNumber} ${safeBeatName}.md`;

    // Generate full note content with frontmatter and body
    const content = generatePlotNoteContent(beatInfo, act, beatModelName, options?.beatTemplate);
    const beatModelMatch = content.match(/^Beat Model\s*:\s*(.+)$/m);
    const hasBeatModel = !!beatModelMatch && beatModelMatch[1].trim().length > 0;
    if (!hasBeatModel) {
      const message = `[BeatTemplates] Generated beat note without Beat Model: ${filename}`;
      console.warn(message);
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(message);
      }
    }

    try {
      await vault.create(normalizedPath, content);
      created++;
      createdPaths.push(normalizedPath);
    } catch (error) {
      errors.push(`Failed to create "${filename}": ${error}`);
    }
  }

  return { created, skipped, errors, createdPaths };
}


/** A loaded custom beat tab as a plot system the note creator can consume, or null when it has no beats. */
export function buildPlotSystemFromLoadedTab(tab: LoadedBeatTab): PlotSystemPreset | null {
    if (tab.beats.length === 0) return null;
    return {
        name: tab.name,
        category: 'blank',
        icon: 'square',
        beatCount: tab.beats.length,
        beats: tab.beats.map((beat) => beat.name),
        beatDetails: tab.beats.map((beat) => ({
            name: beat.name,
            id: beat.id,
            description: beat.purpose ?? '',
            range: beat.range ?? '',
            act: beat.act,
        })),
    };
}
