/*
 * Onboarding extraction — parse the local model's JSON and map it onto canonical
 * Radial Timeline Scene frontmatter.
 *
 * Pure and Obsidian-free: the model's raw output is untrusted, so every parse is
 * defensive (single-attempt, no repair — see the plan), and the frontmatter
 * builder enforces the canonical prompt's RULES (no commas in Subplot/Character/
 * Place; never fabricate When/Duration; flag guesses for review).
 */

import { clampActNumber } from '../utils/acts';
import type { Stage } from '../utils/constants';

export interface SurveyResult {
  /** The book's capped subplot vocabulary (4–14, "Main Plot" first). */
  subplots: string[];
}

export interface SceneExtraction {
  act: number;
  /** Short 2-4 word scene title from the model ('' when it gave none). */
  title: string;
  synopsis: string;
  subplot: string[];
  character: string[];
  place: string[];
  when: string | null;
  duration: string | null;
  /** Field names the model guessed (e.g. "Act", "When") — surfaced in Review, not written. */
  flags: string[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseJson(raw: string | null | undefined): ParseResult<unknown> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'Empty model response.' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'Model response was not valid JSON.' };
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseSurveyResult(raw: string | null | undefined): ParseResult<SurveyResult> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const obj = parsed.value as Record<string, unknown>;
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, error: 'Survey response was not an object.' };
  }
  const names = asStringArray(obj.subplots);
  // No usable subplots is a real failure, not a one-thread book — surface it so
  // the caller falls back visibly instead of silently landing on Main Plot.
  if (names.length === 0) {
    return { ok: false, error: 'Survey returned no subplots.' };
  }
  return { ok: true, value: { subplots: capSubplotVocabulary(names) } };
}

/** Timeline rings stay legible up to this many subplots (Eric: 4–14 major threads). */
export const MAX_SUBPLOTS = 14;

/**
 * Bound the survey's subplot vocabulary: dedupe (case-insensitive), "Main Plot"
 * always present and first, hard-capped at MAX_SUBPLOTS.
 */
export function capSubplotVocabulary(subplots: string[]): string[] {
  const seen = new Set<string>(['main plot']);
  const rest: string[] = [];
  for (const raw of subplots) {
    const name = sanitizeName(raw);
    const key = subplotKey(name);
    if (name.length === 0 || seen.has(key)) continue;
    seen.add(key);
    rest.push(name);
  }
  return ['Main Plot', ...rest.slice(0, MAX_SUBPLOTS - 1)];
}

export function parseSceneExtraction(raw: string | null | undefined): ParseResult<SceneExtraction> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const obj = parsed.value as Record<string, unknown>;
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, error: 'Scene response was not an object.' };
  }
  if (typeof obj.synopsis !== 'string') {
    return { ok: false, error: 'Scene response is missing a synopsis.' };
  }
  return {
    ok: true,
    value: {
      act: typeof obj.act === 'number' ? obj.act : 1,
      title: typeof obj.title === 'string' ? obj.title.replace(/\s+/g, ' ').trim() : '',
      synopsis: obj.synopsis.trim(),
      subplot: asStringArray(obj.subplot),
      character: asStringArray(obj.character),
      place: asStringArray(obj.place),
      when: asNullableString(obj.when),
      duration: asNullableString(obj.duration),
      flags: asStringArray(obj.flags),
    },
  };
}

export interface EntityEnrichment {
  /** Short grounded appositive (character header line); '' when unestablished. */
  role: string;
  /** Grounded prose summary written into the entity note's YAML `Summary`. */
  summary: string;
}

export function parseEntityEnrichment(raw: string | null | undefined): ParseResult<EntityEnrichment> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const obj = parsed.value as Record<string, unknown>;
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, error: 'Entity response was not an object.' };
  }
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  const role = typeof obj.role === 'string' ? obj.role.replace(/\s+/g, ' ').trim() : '';
  return { ok: true, value: { role, summary } };
}

export interface SplitProposal {
  /** 1-based paragraph numbers where each scene begins, in reading order. */
  starts: number[];
  /** Per-scene labels, aligned to `starts`. */
  labels: string[];
}

export function parseSplitProposal(raw: string | null | undefined): ParseResult<SplitProposal> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const obj = parsed.value as Record<string, unknown>;
  if (typeof obj !== 'object' || obj === null || !Array.isArray(obj.scenes)) {
    return { ok: false, error: 'Split response was not an object with a scenes array.' };
  }
  const starts: number[] = [];
  const labels: string[] = [];
  for (const entry of obj.scenes) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const start = typeof record.startParagraph === 'number' ? Math.floor(record.startParagraph) : NaN;
    if (!Number.isFinite(start)) continue;
    starts.push(start);
    labels.push(typeof record.label === 'string' ? record.label.replace(/\s+/g, ' ').trim() : '');
  }
  return { ok: true, value: { starts, labels } };
}

/** Strip commas (canonical RULE: no commas in Subplot/Character/Place) and collapse whitespace. */
export function sanitizeName(name: string): string {
  return name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Wrap a bare name as an Obsidian wiki link, comma-safe. */
export function toWikiLink(name: string): string {
  return `[[${sanitizeName(name)}]]`;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (value.length > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * Safety caps. The prompt asks the model to be selective, but a chatty model that
 * sweeps every proper noun would otherwise flood the vault with stub notes (a real
 * run on 3 Odyssey books produced 96). These bound the damage.
 */
export const MAX_CHARACTERS = 12;
export const MAX_PLACES = 8;

export interface BuildFrontmatterOptions {
  actCount: number;
  /**
   * Book-wide publish stage chosen at Checkpoint 1. A draft in progress is Zero;
   * a finished, published book being migrated from another tool is Press.
   */
  publishStage?: Stage;
  /**
   * The survey's capped subplot vocabulary. Scene subplots are restricted to it
   * (case-insensitive, canonical casing restored); anything else — including
   * everything when the survey failed — falls back to "Main Plot". This is what
   * keeps the timeline at 4–14 rings instead of one ring per invented name.
   */
  subplotVocabulary?: string[];
  /** Non-canonical metadata carried from the source (written as-is). */
  carriedMetadata?: Record<string, string>;
}

/**
 * Map a validated scene extraction onto the canonical Scene frontmatter object
 * consumed by `processFrontMatter`. Insertion order = YAML key order.
 * Per the canonical prompt: Status is `Complete` (text exists) and Publish Stage
 * defaults to `Zero`; When/Duration are omitted when the model couldn't ground
 * them (never fabricated).
 */
export function buildSceneFrontmatter(
  extraction: SceneExtraction,
  options: BuildFrontmatterOptions
): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    Class: 'Scene',
    Act: clampActNumber(extraction.act, Math.max(3, options.actCount)),
    Synopsis: extraction.synopsis,
    Subplot: enforceSubplotVocabulary(extraction.subplot, options.subplotVocabulary ?? []),
    Character: dedupe(extraction.character.map(toWikiLink)).slice(0, MAX_CHARACTERS),
    Place: dedupe(extraction.place.map(toWikiLink)).slice(0, MAX_PLACES),
    Status: 'Complete',
    'Publish Stage': options.publishStage ?? 'Zero',
  };
  if (extraction.when) fm.When = extraction.when;
  if (extraction.duration) fm.Duration = extraction.duration;
  // Carried non-canonical metadata never overwrites a canonical key.
  for (const [key, value] of Object.entries(options.carriedMetadata ?? {})) {
    if (!(key in fm)) fm[key] = value;
  }
  return fm;
}

/** Bare character names needing a stub note (deduped, sanitized, capped to match what was written). */
export function linkedCharacters(extraction: SceneExtraction): string[] {
  return dedupe(extraction.character.map(sanitizeName)).slice(0, MAX_CHARACTERS);
}

/** Bare place names needing a stub note (deduped, sanitized, capped to match what was written). */
export function linkedPlaces(extraction: SceneExtraction): string[] {
  return dedupe(extraction.place.map(sanitizeName)).slice(0, MAX_PLACES);
}

/**
 * Comparison key for subplot names: case-folded with curly quotes/dashes
 * normalized, so "Telemachus’ Journey" matches "Telemachus' journey" instead of
 * silently dropping to Main Plot over a typographic apostrophe.
 */
function subplotKey(name: string): string {
  return sanitizeName(name)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .toLowerCase();
}

/**
 * Restrict a scene's subplot to the survey vocabulary (case- and punctuation-
 * insensitive, canonical casing restored) — and to exactly ONE thread: onboarding
 * places a scene in the single subplot it most advances, until a local model can
 * handle selective multi-subplot placement (the author layers more later).
 * Unmatched names are dropped; no match — including when there is no vocabulary —
 * becomes ["Main Plot"].
 */
export function enforceSubplotVocabulary(subplots: string[], vocabulary: string[]): string[] {
  const canonical = new Map(vocabulary.map((name) => [subplotKey(name), name]));
  const first = subplots
    .map((name) => canonical.get(subplotKey(name)))
    .find((name): name is string => typeof name === 'string');
  return [first ?? 'Main Plot'];
}

/**
 * Ordinal act assignment (Eric: "it's all based on order — purely mathematical").
 * The written sequence divides into `actCount` contiguous blocks: with 108 scenes
 * and 3 acts, 1–36 → Act 1, 37–72 → Act 2, 73–108 → Act 3. Scene N can never
 * land in an earlier act than scene N-1.
 */
export function positionalAct(index: number, total: number, actCount: number): number {
  if (total <= 0 || actCount <= 0) return 1;
  const clampedIndex = Math.min(Math.max(index, 0), total - 1);
  return Math.min(actCount, Math.floor((clampedIndex * actCount) / total) + 1);
}

/**
 * Flags, minus any field the model didn't actually fill in. Models tend to flag
 * When/Duration as "guessed" even when they correctly returned null — reporting
 * those would claim a guess we never wrote. Names are normalized ("act" → "Act")
 * and deduped so downstream rollups can count them.
 */
export function effectiveFlags(extraction: SceneExtraction): string[] {
  const kept = extraction.flags.filter((flag) => {
    const key = flag.trim().toLowerCase();
    if (key === 'when') return extraction.when !== null;
    if (key === 'duration') return extraction.duration !== null;
    return true;
  });
  return dedupe(
    kept
      .map((flag) => flag.trim())
      .filter((flag) => flag.length > 0)
      .map((flag) => flag.charAt(0).toUpperCase() + flag.slice(1).toLowerCase())
  );
}
