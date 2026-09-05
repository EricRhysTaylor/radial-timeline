/*
 * Frontmatter utilities - case-insensitive key handling
 */

import { getFrontMatterInfo, parseYaml } from 'obsidian';
import type { RadialTimelineSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { getBaseKeys } from './yamlTemplateNormalize';

export interface CanonicalAliasConflict {
  canonicalKey: string;
  keys: string[];
}

let supportedFrontmatterRemapTargetsCache: Set<string> | null = null;

function getSupportedFrontmatterRemapTargetSet(): Set<string> {
  if (!supportedFrontmatterRemapTargetsCache) {
    supportedFrontmatterRemapTargetsCache = new Set(
      getBaseKeys('Scene', DEFAULT_SETTINGS)
    );
  }
  return supportedFrontmatterRemapTargetsCache;
}

export function getSupportedFrontmatterRemapTargets(): string[] {
  return [...getSupportedFrontmatterRemapTargetSet()].sort();
}

export function sanitizeFrontmatterMappings(customMappings?: Record<string, string>): Record<string, string> | undefined {
  if (!customMappings) return undefined;

  const sanitized: Record<string, string> = {};
  for (const [rawUserKey, rawCanonicalKey] of Object.entries(customMappings)) {
    const userKey = rawUserKey.trim();
    const canonicalKey = rawCanonicalKey.trim();
    if (!userKey || !canonicalKey) continue;
    if (!getSupportedFrontmatterRemapTargetSet().has(canonicalKey)) continue;
    sanitized[userKey] = canonicalKey;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function getActiveFrontmatterMappings(
  settings: Pick<RadialTimelineSettings, 'enableCustomMetadataMapping' | 'frontmatterMappings'>
): Record<string, string> | undefined {
  if (!settings.enableCustomMetadataMapping) return undefined;
  return sanitizeFrontmatterMappings(settings.frontmatterMappings);
}

function buildFrontmatterKeyMappings(
  customMappings?: Record<string, string>,
  options?: { allowUnsupportedCustomMappings?: boolean }
): Record<string, string> {
  const keyMappings: Record<string, string> = {
    'id': 'ID',
    'class': 'Class',
    'itemtype': 'itemType',
    'plotsystem': 'Plot System',
    'beatmodel': 'Beat Model',
    'beatsupdate': 'Pulse Update',
    'pulseupdate': 'Pulse Update',
    'reviewupdate': 'Pulse Update',
    'publishstage': 'Publish Stage',
    'scenenumber': 'Scene Number',
    'subplot': 'Subplot',
    'character': 'Character',
    'location': 'Location',
    'act': 'Act',
    'date': 'Date',
    'status': 'Status',
    'synopsis': 'Synopsis',
    'context': 'Context',
    'summary': 'Summary',
    'summaryupdate': 'Summary Update',
    'end': 'End',
    'purpose': 'Purpose',
    'description': 'Description',
    'range': 'Range',
    'words': 'Words',
    'totaltime': 'Total Time',
    'supportfiles': 'Support Files',
    'due': 'Due',
    'pendingedits': 'Pending Edits',
    'iteration': 'Iteration',
    'iterations': 'Iteration',
    'revision': 'Iteration',
    'pov': 'POV',
    'duration': 'Duration',
    'type': 'Type',
    'shift': 'Shift',
    'questions': 'Questions',
    'readeremotion': 'Reader Emotion',
    'internal': 'Internal',
    'gossamer1': 'Gossamer1',
    'gossamer2': 'Gossamer2',
    'gossamer3': 'Gossamer3',
    'gossamer4': 'Gossamer4',
    'gossamer5': 'Gossamer5',
    'gossamer6': 'Gossamer6',
    'gossamer7': 'Gossamer7',
    'gossamer8': 'Gossamer8',
    'gossamer9': 'Gossamer9',
    'gossamer10': 'Gossamer10',
    'gossamer11': 'Gossamer11',
    'gossamer12': 'Gossamer12',
    'gossamer13': 'Gossamer13',
    'gossamer14': 'Gossamer14',
    'gossamer15': 'Gossamer15',
    'gossamer16': 'Gossamer16',
    'gossamer17': 'Gossamer17',
    'gossamer18': 'Gossamer18',
    'gossamer19': 'Gossamer19',
    'gossamer20': 'Gossamer20',
    'gossamer21': 'Gossamer21',
    'gossamer22': 'Gossamer22',
    'gossamer23': 'Gossamer23',
    'gossamer24': 'Gossamer24',
    'gossamer25': 'Gossamer25',
    'gossamer26': 'Gossamer26',
    'gossamer27': 'Gossamer27',
    'gossamer28': 'Gossamer28',
    'gossamer29': 'Gossamer29',
    'gossamer30': 'Gossamer30',
    '1beats': '1beats',
    '2beats': '2beats',
    '3beats': '3beats',
    'beats1': 'beats1',
    'beats2': 'beats2',
    'beats3': 'beats3',
    'beatslastupdated': 'Pulse Last Updated',
    'pulselastupdated': 'Pulse Last Updated',
    'when': 'When',
    'place': 'Place',
    'scope': 'Scope',
    'book': 'Book',
    'rights': 'Rights',
    'identifiers': 'Identifiers',
    'publisher': 'Publisher'
  };

  const resolvedMappings = options?.allowUnsupportedCustomMappings
    ? customMappings
    : sanitizeFrontmatterMappings(customMappings);
  if (resolvedMappings) {
    for (const [userKey, canonicalKey] of Object.entries(resolvedMappings)) {
      const normalizedKey = userKey.toLowerCase().replace(/[\s_-]/g, '');
      keyMappings[normalizedKey] = canonicalKey;
    }
  }

  return keyMappings;
}

export function canonicalizeFrontmatterKey(key: string, customMappings?: Record<string, string>): string {
  const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
  const keyMappings = buildFrontmatterKeyMappings(customMappings);
  return keyMappings[normalizedKey] || key;
}

export function findCanonicalAliasConflicts(fm: Record<string, unknown>, customMappings?: Record<string, string>): CanonicalAliasConflict[] {
  const seen = new Map<string, string[]>();
  const legacyConflictCanonical = (key: string): string => {
    const normalized = key.toLowerCase().replace(/[\s_-]/g, '');
    if (normalized === 'description' || normalized === 'purpose') return 'Purpose';
    if (normalized === 'synopsis' || normalized === 'context') return 'Context';
    return canonicalizeFrontmatterKey(key, customMappings);
  };

  for (const key of Object.keys(fm)) {
    const canonicalKey = legacyConflictCanonical(key);
    const keys = seen.get(canonicalKey) ?? [];
    keys.push(key);
    seen.set(canonicalKey, keys);
  }

  return Array.from(seen.entries())
    .filter(([, keys]) => new Set(keys.map(key => key.toLowerCase())).size > 1)
    .map(([canonicalKey, keys]) => ({ canonicalKey, keys }));
}

/**
 * Normalize frontmatter keys to canonical case-insensitive format.
 * This allows users to write keys in any case (e.g., "class", "Class", "CLASS")
 * and the code will find them under the canonical name.
 * 
 * Canonical key mappings:
 * - class/CLASS/Class → Class
 * - beat model/Beat Model/BEAT MODEL/BeatModel → Beat Model
 * - pulse update/Pulse Update/PulseUpdate/Beats Update → Pulse Update
 * - publish stage/Publish Stage/PublishStage → Publish Stage
 * - scene number/Scene Number/SceneNumber → Scene Number
 * - etc.
 * 
 * @param fm - The raw frontmatter object
 * @param customMappings - Optional user-defined mappings (User Key -> Canonical Key)
 */
export function normalizeFrontmatterKeys(fm: Record<string, unknown>, customMappings?: Record<string, string>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const keyMappings = buildFrontmatterKeyMappings(customMappings);

  // Process each key in the original frontmatter
  for (const [key, value] of Object.entries(fm)) {
    // Normalize to lowercase, remove spaces and special chars for lookup
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');

    // Find canonical name or keep original if not in mapping
    const canonicalKey = keyMappings[normalizedKey] || key;

    // If canonical key already exists, prefer the first occurrence
    if (!(canonicalKey in normalized)) {
      normalized[canonicalKey] = value;
    }
  }

  return normalized;
}

/**
 * Beat-only frontmatter normalization.
 * Keeps legacy `description` confined to the Beat ingest boundary by mapping
 * it directly to canonical `Purpose`.
 */
export function normalizeBeatFrontmatterKeys(fm: Record<string, unknown>, customMappings?: Record<string, string>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const keyMappings = buildFrontmatterKeyMappings({
    ...(customMappings ?? {}),
    description: 'Purpose'
  }, {
    allowUnsupportedCustomMappings: true
  });

  for (const [key, value] of Object.entries(fm)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
    const canonicalKey = keyMappings[normalizedKey] || key;
    if (!(canonicalKey in normalized)) {
      normalized[canonicalKey] = value;
    }
  }

  return normalized;
}

/**
 * Convert an arbitrary frontmatter value to display text.
 * Strings pass through; number/boolean/bigint stringify; objects and arrays
 * JSON-serialize (empty string when unserializable); null/undefined and
 * YAML-impossible types (symbol/function) -> ''.
 */
export function frontmatterValueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Canonical extraction of the `Summary` frontmatter field as a normalized
 * string. Single source of truth for inquiry/forecast corpus summary text:
 * array -> newline-joined (each element text-coerced); string -> trimmed;
 * null/undefined/missing -> ''; anything else -> frontmatterValueToText(raw).trim().
 */
export function extractSummary(frontmatter: Record<string, unknown>): string {
  const raw = frontmatter['Summary'];
  if (Array.isArray(raw)) return raw.map(value => frontmatterValueToText(value)).join('\n').trim();
  if (typeof raw === 'string') return raw.trim();
  if (raw === null || raw === undefined) return '';
  return frontmatterValueToText(raw).trim();
}

/* ----------------------------------------------------------------------- *
 * Canonical key registry for note types that have undergone field renames.
 *
 * Source of truth for which YAML keys are valid for each note type. Call
 * sites must read these fields through the helpers below — never reach for
 * a string literal like `fm.Synopsis` on a beat note (Beats never had a
 * Synopsis field; Synopsis is the *legacy* Backdrop key migrated to
 * Context). The first entry of each list is the canonical key that current
 * migrations write; remaining entries are legacy keys we still read so
 * un-migrated vaults keep working.
 *
 * Migrations that produced these lists live in
 *   src/utils/yamlBackfill.ts
 *     - runBeatDescriptionToPurposeMigration:  Description -> Purpose
 *     - runBackdropSynopsisToContextMigration: Synopsis    -> Context
 * ----------------------------------------------------------------------- */

export const BEAT_PURPOSE_KEYS = ['Purpose', 'Description', 'description'] as const;
export const BACKDROP_CONTEXT_KEYS = ['Context', 'Synopsis'] as const;

/**
 * Typed view of the YAML frontmatter on a Beat note. Lists only the fields
 * code reads directly from raw `fm`. Notably does NOT include `Synopsis`
 * (Beats never had that field; reaching for `fm.Synopsis` on a beat is a
 * bug). For dynamically-named keys (Gossamer1..30 etc.) use index access
 * with explicit narrowing — those are accessed by computed key, not by
 * literal, so the type guard doesn't apply.
 */
export interface BeatFrontmatter {
  Purpose?: string;
  Description?: string;
  description?: string;
  Range?: string;
  Act?: number | string;
  ID?: string;
  'Beat Model'?: string;
  Chapter?: string;
  'Suggest Placement'?: string;
  Class?: string;
}

/**
 * Typed view of the YAML frontmatter on a Backdrop note. Does NOT include
 * a `Description` field — Backdrops use `Context` (canonical) with
 * `Synopsis` as the legacy key.
 */
export interface BackdropFrontmatter {
  Context?: string;
  Synopsis?: string;
  Class?: string;
}

/**
 * Narrow the untyped frontmatter blob from Obsidian's metadataCache to the
 * BeatFrontmatter shape. The cast is documentation of intent — it does not
 * validate. Its real value is making `fm.Synopsis` on a beat-typed fm a
 * compile-time error.
 */
export function asBeatFrontmatter(fm: unknown): BeatFrontmatter | null {
  if (!fm || typeof fm !== 'object') return null;
  return fm;
}

export function asBackdropFrontmatter(fm: unknown): BackdropFrontmatter | null {
  if (!fm || typeof fm !== 'object') return null;
  return fm;
}

/**
 * Canonical extraction of the Beat purpose text. Reads `Purpose` first,
 * then falls back through the legacy keys for un-migrated vaults. Returns
 * undefined when no key holds a non-empty string — never an empty string,
 * never a fabricated default.
 */
export function readBeatPurpose(fm: BeatFrontmatter | null | undefined): string | undefined {
  return readFirstNonEmptyString(fm as Record<string, unknown> | null | undefined, BEAT_PURPOSE_KEYS);
}

/** Canonical extraction of the Backdrop context text. Same semantics as readBeatPurpose. */
export function readBackdropContext(fm: BackdropFrontmatter | null | undefined): string | undefined {
  return readFirstNonEmptyString(fm as Record<string, unknown> | null | undefined, BACKDROP_CONTEXT_KEYS);
}

function readFirstNonEmptyString(
  fm: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): string | undefined {
  if (!fm) return undefined;
  for (const key of keys) {
    const value = fm[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

/**
 * Parse a note's frontmatter the way the manuscript exporter does.
 *
 * Deliberately does NOT apply user key mappings. `SceneDataService` builds a
 * TimelineItem's `rawFrontmatter` with `normalizeFrontmatterKeys(fm, mappings)`,
 * so a vault using custom metadata mapping shows the timeline a renamed field
 * (`MyAct` → `Act`) that the export never sees — the export reads each file's
 * own frontmatter text and normalizes casing only.
 *
 * Anything that must reproduce export behaviour — the Part marker migration
 * above all — has to read through here rather than through the metadata cache,
 * or it will plan structure the export would not emit.
 */
export function extractFrontmatterObject(content: string): Record<string, unknown> | null {
  try {
    const fmInfo = getFrontMatterInfo(content);
    const fmText = (fmInfo as { frontmatter?: string }).frontmatter;
    if (!fmText) return null;
    const yaml: unknown = parseYaml(fmText);
    if (!yaml || typeof yaml !== 'object' || Array.isArray(yaml)) return null;
    return normalizeFrontmatterKeys(yaml as Record<string, unknown>);
  } catch {
    return null;
  }
}
