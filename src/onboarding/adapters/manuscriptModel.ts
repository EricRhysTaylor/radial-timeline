/*
 * Manuscript Model — the adapter → spine contract.
 *
 * Every ingest adapter (existing `.md`, Scrivener export, Word `.docx`) parses
 * its source deterministically (no AI) into this normalized shape. Everything
 * downstream — survey, per-scene extraction, review, materialize — is
 * format-agnostic and consumes only the Manuscript Model.
 *
 * See docs/engineering/plans/one-button-onboarding-local-llm-plan.md.
 */

export type SourceKind = 'md' | 'scrivener' | 'docx';

export interface ManuscriptScene {
  /** Scene title from the source (heading / Scrivener title / filename), or null. */
  title: string | null;
  /** Plain prose with source markup (RTF/HTML) already stripped by the adapter. */
  rawText: string;
  /** Non-canonical metadata the source carried (e.g. Scrivener label/status/custom fields). */
  knownMetadata: Record<string, string>;
  /** Scrivener's synopsis field, if the source provided one. */
  knownSynopsis: string | null;
  /** Where this scene came from (file path / heading path) — for the report. */
  sourceRef: string;
  /** True when the source note already carries `Class: Scene` (existing-vault re-run skip). */
  alreadyOnboarded: boolean;
}

export interface ManuscriptChapter {
  title: string | null;
  scenes: ManuscriptScene[];
}

export interface ManuscriptModel {
  sourceKind: SourceKind;
  chapters: ManuscriptChapter[];
  /** Distinct non-canonical keys seen across the source (drives the Scrivener mapping table). */
  customFields: string[];
}

/** Flatten a model to its scenes in reading order. */
export function flattenScenes(model: ManuscriptModel): ManuscriptScene[] {
  return model.chapters.flatMap((chapter) => chapter.scenes);
}

/** Count scenes, optionally excluding ones already onboarded. */
export function sceneCount(model: ManuscriptModel, opts?: { excludeOnboarded?: boolean }): number {
  const scenes = flattenScenes(model);
  if (opts?.excludeOnboarded) {
    return scenes.filter((scene) => !scene.alreadyOnboarded).length;
  }
  return scenes.length;
}

export type ReadingOrderResult =
  | { kind: 'ordered'; order: string[] }
  | { kind: 'needs-order'; reason: string };

/**
 * Resolve reading order from a folder's markdown filenames, per the canonical
 * onboarding prompt's SOURCE rules:
 *   1. Zero-padded numbered names (01, 02, …) define order.
 *   2. Else a `TOC.md` maps the order to exact file names.
 *   3. Else stop and ask (never guess).
 *
 * Pure — no Obsidian dependency — so it is fully unit-testable.
 *
 * @param markdownFileNames base file names (e.g. `01 Ithaca.md`), TOC excluded by caller
 * @param tocContent raw text of a `TOC.md` in the folder, or null if none
 */
export function resolveReadingOrder(
  markdownFileNames: string[],
  tocContent: string | null
): ReadingOrderResult {
  const names = markdownFileNames.filter((name) => name.trim().length > 0);
  if (names.length === 0) {
    return { kind: 'needs-order', reason: 'The book folder contains no markdown notes.' };
  }

  // 1. Numbered filenames — every note must carry a leading integer.
  const numbered = names
    .map((name) => {
      const match = name.match(/^\s*(\d+)/);
      return match ? { name, n: Number(match[1]) } : null;
    })
    .filter((entry): entry is { name: string; n: number } => entry !== null);

  if (numbered.length === names.length) {
    const order = numbered
      .slice()
      .sort((a, b) => (a.n - b.n) || a.name.localeCompare(b.name))
      .map((entry) => entry.name);
    return { kind: 'ordered', order };
  }

  // 2. TOC.md — take file names in the order they appear; must cover every note.
  if (tocContent && tocContent.trim().length > 0) {
    const remaining = new Set(names);
    const order: string[] = [];
    for (const token of extractTocReferences(tocContent)) {
      const match = matchFileName(token, remaining);
      if (match) {
        order.push(match);
        remaining.delete(match);
      }
    }
    if (order.length === names.length) {
      return { kind: 'ordered', order };
    }
    return {
      kind: 'needs-order',
      reason:
        `TOC.md does not reference every note (${order.length}/${names.length} matched). ` +
        `Add the missing notes to TOC.md or number the files.`,
    };
  }

  // 3. Ambiguous — ask.
  return {
    kind: 'needs-order',
    reason: 'File names are not numbered and no TOC.md was found. Provide a reading order.',
  };
}

/** Pull candidate file-name references from a TOC in document order (wikilinks, list items, bare names). */
function extractTocReferences(tocContent: string): string[] {
  const tokens: string[] = [];
  const wikiLink = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let hasWikiLinks = false;
  let m: RegExpExecArray | null;
  while ((m = wikiLink.exec(tocContent)) !== null) {
    hasWikiLinks = true;
    tokens.push(m[1].trim());
  }
  if (hasWikiLinks) return tokens;

  // Fall back to line-by-line: strip list/heading markers, keep the remaining text.
  for (const line of tocContent.split(/\r?\n/)) {
    const cleaned = line.replace(/^\s*(?:[-*+]|\d+[.)]|#+)\s*/, '').trim();
    if (cleaned.length > 0) tokens.push(cleaned);
  }
  return tokens;
}

/** Match a TOC token to one of the remaining file names (with/without `.md`, case-insensitive). */
function matchFileName(token: string, remaining: Set<string>): string | null {
  const candidates = [token, `${token}.md`];
  const stems = new Map<string, string>();
  for (const name of remaining) {
    stems.set(name.toLowerCase(), name);
    stems.set(name.replace(/\.md$/i, '').toLowerCase(), name);
  }
  for (const candidate of candidates) {
    const hit = stems.get(candidate.toLowerCase());
    if (hit && remaining.has(hit)) return hit;
  }
  return null;
}
