/*
 * Scrivener EXPORT ingest adapter — import flow 2 (locked 2026-07-15).
 *
 * V1 intake is a Scrivener *export*, never a raw `.scriv` bundle (no RTF
 * parsing): the author uses File ▸ Export ▸ Files… (or a per-document Compile)
 * to produce one `.md`/`.txt` file per scene — Scrivener's "number exported
 * files" option prefixes each name with its binder position ("1 The Hook.md",
 * "2 Landfall.md", …) — and optionally File ▸ Export ▸ Outliner Contents as
 * CSV…, which writes one CSV row per binder item with the visible outliner
 * columns (Title, Synopsis, Label, Status, Keywords, custom metadata, word
 * counts…). The CSV sidecar is optional: scene files alone still ingest.
 *
 * Normalization:
 *   - one ManuscriptScene per exported prose file;
 *   - reading order from filename numbering, else from sidecar row order;
 *   - sidecar rows matched to files by title (positional fallback when no
 *     titles match and counts align);
 *   - the Synopsis column populates `knownSynopsis`; every other carryable
 *     column lands in `knownMetadata` as strings. Canonical RT Scene keys are
 *     never used as `knownMetadata` keys — a Scrivener column whose name
 *     collides with one (e.g. Scrivener's own Status) is carried under a
 *     `Scrivener `-prefixed name so nothing is silently lost and the mapping
 *     table can still repoint it.
 *
 * Like mdAdapter, the parsing core is pure (Obsidian-free) behind a narrow
 * `ScrivenerSource` surface; `createObsidianScrivenerSource` adapts a live App.
 */

import { normalizePath, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import {
  type ManuscriptModel,
  type ManuscriptScene,
  resolveReadingOrder,
} from './manuscriptModel';

// --- Source surface ---------------------------------------------------------

/** One exported prose file as seen by the adapter (Obsidian-free for testing). */
export interface ScrivenerFile {
  /** Base file name including extension, e.g. `1 The Hook.md`. */
  fileName: string;
  /** Full vault path — becomes the scene's `sourceRef`. */
  path: string;
  /** Raw file contents. */
  content: string;
}

/** The minimal surface the adapter needs — easy to stub in tests. */
export interface ScrivenerSource {
  /** Exported prose files (`.md`/`.txt`) directly in the book folder, sidecar excluded. */
  listSceneFiles(folderPath: string): Promise<ScrivenerFile[]>;
  /** Raw text of the CSV outline sidecar in the folder, or null when absent. */
  readSidecar(folderPath: string): Promise<string | null>;
}

export type ScrivenerIngestResult =
  | { kind: 'ok'; model: ManuscriptModel }
  | { kind: 'needs-order'; reason: string };

// --- Delimited-text parsing (no dependencies) -------------------------------

/**
 * Parse RFC-4180-style delimited text: quoted fields, `""` escapes, embedded
 * delimiters/newlines inside quotes, CRLF or LF rows, optional BOM. Scrivener's
 * outliner export offers comma / semicolon / tab delimiters, so the delimiter
 * is sniffed from the header row unless given.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const delim = delimiter ?? sniffDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
    } else if (ch === delim) {
      endField();
      i += 1;
    } else if (ch === '\n') {
      endRow();
      i += 1;
    } else if (ch === '\r') {
      endRow();
      i += input[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) endRow();

  // Drop rows that are entirely empty (trailing newline artifacts).
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

/** Pick the delimiter (comma / tab / semicolon) that dominates the header row, quotes respected. */
function sniffDelimiter(input: string): string {
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0 };
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  let best = ',';
  for (const candidate of ['\t', ';']) {
    if (counts[candidate] > counts[best]) best = candidate;
  }
  return best;
}

/** A parsed outline sidecar: column names plus one string record per data row. */
export interface OutlineSidecar {
  /** Header names in column order (trimmed, empties dropped from `fields` but kept positional for rows). */
  fields: string[];
  /** One record per row, keyed by header name; missing cells are empty strings. */
  rows: Record<string, string>[];
}

/** Parse a Scrivener outline CSV/TSV export into header names + row records. */
export function parseOutlineSidecar(content: string): OutlineSidecar | null {
  const table = parseDelimited(content);
  if (table.length < 2) return null; // header only (or nothing) — no usable rows
  const headers = table[0].map((cell) => cell.trim());
  const fields = headers.filter((header) => header.length > 0);
  const rows = table.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header.length === 0) return;
      record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });
  return { fields, rows };
}

// --- Titles & matching ------------------------------------------------------

/** Derive the scene title from an exported file name: drop extension and the export-order prefix. */
export function titleFromExportFileName(fileName: string): string {
  return fileName
    .replace(/\.(?:md|markdown|txt|text)$/i, '')
    .replace(/^\s*\d+\s*[-._)]?\s*/, '')
    .trim();
}

/** Normalize a title for file↔row matching (case/whitespace-insensitive). */
function normalizeTitle(title: string): string {
  // Scrivener strips filename-hostile characters when exporting files but keeps
  // them in outliner titles ("FB: A New Home" → "FB A New Home.txt") — fold
  // that punctuation on both sides so title matching survives the round trip.
  return title
    .replace(/[:\\/*"<>|?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Case-insensitive column lookup on a sidecar record. */
function readColumn(row: Record<string, string>, name: string): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (key.trim().toLowerCase() === name.toLowerCase()) {
      return value.trim().length > 0 ? value.trim() : null;
    }
  }
  return null;
}

// --- Canonical-key handling -------------------------------------------------

/**
 * Canonical Scene keys (mirrors mdAdapter's CANONICAL_KEYS, which is private
 * to that module; keep the two lists in sync). `knownMetadata` must never use
 * one of these as a key — the extraction pipeline owns them.
 */
const CANONICAL_KEY_NAMES = [
  'Class', 'Act', 'When', 'Duration', 'Chapter', 'Synopsis', 'Summary',
  'Pending Edits', 'Subplot', 'Character', 'POV', 'Words', 'Runtime',
  'Publish Stage', 'Status', 'Due', 'Pulse Update', 'Summary Update',
  'Place', 'Questions', 'Reader Emotion', 'Internal', 'Type', 'Shift', 'Iteration',
] as const;

const CANONICAL_BY_LOWER = new Map<string, string>(
  CANONICAL_KEY_NAMES.map((key) => [key.toLowerCase(), key])
);

/** Prefix applied when a Scrivener column name collides with a canonical RT key. */
const COLLISION_PREFIX = 'Scrivener ';

// --- Automap proposal (pure — the mapping-table UI consumes this) -----------

export type ScrivenerFieldTarget =
  | { target: 'rt-key'; key: string }
  | { target: 'custom' }
  | { target: 'ignore' };

/** Scrivener outliner columns that are tool/derived data — never worth carrying. */
const IGNORED_FIELDS = new Set([
  'title', 'word count', 'total word count', 'character count', 'chars',
  'words', 'created', 'created date', 'date created', 'modified',
  'modified date', 'date modified', 'include in compile', 'compile',
  'target', 'targets', 'target type', 'progress', 'total progress',
  'section type', 'position', 'depth',
]);

/** Scrivener names that map to a *differently named* RT key. */
const FIELD_ALIASES: Record<string, string> = {
  storyline: 'Subplot',
  location: 'Place',
  setting: 'Place',
  date: 'When',
  characters: 'Character',
  notes: 'Summary',
};

/**
 * Propose a best-guess disposition for each distinct sidecar field name:
 * map to an RT key, keep as a custom field, or ignore. The author overrides
 * per row in the mapping table before Materialize; unmatched fields default
 * to `custom` so nothing is silently lost. Accepts both raw sidecar column
 * names and the `Scrivener `-prefixed keys the adapter writes on collision.
 */
export function proposeScrivenerAutomap(
  fieldNames: string[]
): Record<string, ScrivenerFieldTarget> {
  const proposals: Record<string, ScrivenerFieldTarget> = {};
  for (const fieldName of fieldNames) {
    const bare = fieldName.replace(new RegExp(`^${COLLISION_PREFIX}`, 'i'), '').trim();
    const lower = bare.toLowerCase();

    if (IGNORED_FIELDS.has(lower)) {
      proposals[fieldName] = { target: 'ignore' };
      continue;
    }
    const canonical = CANONICAL_BY_LOWER.get(lower);
    if (canonical) {
      proposals[fieldName] = { target: 'rt-key', key: canonical };
      continue;
    }
    const alias = FIELD_ALIASES[lower];
    if (alias) {
      proposals[fieldName] = { target: 'rt-key', key: alias };
      continue;
    }
    // Label, Keywords, and any custom metadata column: keep, author decides.
    proposals[fieldName] = { target: 'custom' };
  }
  return proposals;
}

// --- Scene assembly ---------------------------------------------------------

/** Remove a leading YAML frontmatter block without Obsidian (exports may carry one). */
function stripLeadingYaml(content: string): string {
  const match = content.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? content.slice(match[0].length) : content;
}

/** Carry a sidecar row into `knownMetadata`: skip Title/Synopsis/empties, prefix canonical collisions. */
function carriedMetadata(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (key.length === 0 || value.length === 0) continue;
    const lower = key.toLowerCase();
    if (lower === 'title' || lower === 'synopsis') continue; // handled directly
    if (CANONICAL_BY_LOWER.has(lower)) {
      out[`${COLLISION_PREFIX}${CANONICAL_BY_LOWER.get(lower)}`] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function fileToScene(file: ScrivenerFile, row: Record<string, string> | null): ManuscriptScene {
  const fallbackTitle = titleFromExportFileName(file.fileName);
  const rowTitle = row ? readColumn(row, 'Title') : null;
  return {
    title: rowTitle ?? (fallbackTitle.length > 0 ? fallbackTitle : null),
    rawText: stripLeadingYaml(file.content).trim(),
    knownMetadata: row ? carriedMetadata(row) : {},
    knownSynopsis: row ? readColumn(row, 'Synopsis') : null,
    sourceRef: file.path,
    alreadyOnboarded: false, // exports are fresh material, never existing RT notes
  };
}

// --- Ingest -----------------------------------------------------------------

/**
 * Ingest a folder of Scrivener-exported scene files (plus an optional CSV
 * outline sidecar) into a single-chapter Manuscript Model.
 */
/**
 * Apply the author's mapping-table decisions to one scene's carried metadata:
 * `ignore` drops the field, `rt-key` renames it to the canonical key (first
 * writer wins on collision), `custom` — and any unmapped field — keeps it as-is.
 */
export function applyMetadataMapping(
  metadata: Record<string, string>,
  mapping: Record<string, ScrivenerFieldTarget>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const decision = mapping[key];
    if (!decision || decision.target === 'custom') {
      if (!(key in out)) out[key] = value;
      continue;
    }
    if (decision.target === 'ignore') continue;
    if (!(decision.key in out)) out[decision.key] = value;
  }
  return out;
}

/** Apply the mapping across every scene of a model, recomputing `customFields`. */
export function applyMetadataMappingToModel(
  model: ManuscriptModel,
  mapping: Record<string, ScrivenerFieldTarget>
): ManuscriptModel {
  const fields = new Set<string>();
  const chapters = model.chapters.map((chapter) => ({
    title: chapter.title,
    scenes: chapter.scenes.map((scene) => {
      const knownMetadata = applyMetadataMapping(scene.knownMetadata, mapping);
      for (const key of Object.keys(knownMetadata)) fields.add(key);
      return { ...scene, knownMetadata };
    }),
  }));
  return { ...model, chapters, customFields: [...fields].sort() };
}

/**
 * Scrivener's "Export Files" writes per-document sidecars next to the prose —
 * "<Title> MetaData.txt" and "<Title> Notes.txt". They are not scenes.
 */
export function isScrivenerAuxiliaryFile(fileName: string): boolean {
  return / (MetaData|Notes)\.(txt|md)$/i.test(fileName);
}

/** Snapshot folders exported alongside documents ("<Title> Snapshots/"). */
export function isSnapshotFolderName(folderName: string): boolean {
  return / Snapshots$/i.test(folderName.trim());
}

/**
 * Act carried by the export's own folder structure: a file living under an
 * "ACT <n>" folder gets that act (the deepest ACT segment wins). Undefined for
 * files outside any ACT folder (e.g. a trailing "Wrapup" — downstream carry-
 * forward keeps those in the last seen act).
 */
export function deriveSourceAct(path: string): number | undefined {
  const matches = [...path.matchAll(/(?:^|\/)ACT[ _-]?(\d{1,2})(?=\/|$)/gi)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : undefined;
}

export async function ingestScrivenerFolder(
  source: ScrivenerSource,
  folderPath: string
): Promise<ScrivenerIngestResult> {
  const listed = await source.listSceneFiles(folderPath);
  // Real exports are messy: per-doc MetaData/Notes sidecars, snapshot folders,
  // and empty placeholder docs (structure beats, art slots). Only non-empty
  // prose survives; everything else is export furniture, not manuscript.
  const files = listed.filter(
    (file) =>
      !isScrivenerAuxiliaryFile(file.fileName) &&
      !/ Snapshots\//i.test(file.path) &&
      file.content.trim().length > 0
  );
  if (files.length === 0) {
    return { kind: 'needs-order', reason: 'The book folder contains no exported scene files with prose.' };
  }
  const sidecarText = await source.readSidecar(folderPath);
  const sidecar = sidecarText ? parseOutlineSidecar(sidecarText) : null;

  const ordered = resolveOrder(files, sidecar);
  if (ordered.kind === 'needs-order') return ordered;

  const rowsByFile = matchRowsToFiles(ordered.files, sidecar);
  const scenes = ordered.files.map((file, index) => ({
    ...fileToScene(file, rowsByFile[index]),
    sourceAct: deriveSourceAct(file.path),
  }));

  return {
    kind: 'ok',
    model: {
      sourceKind: 'scrivener',
      chapters: [{ title: null, scenes }],
      customFields: collectCustomFields(scenes),
    },
  };
}

type OrderResolution =
  | { kind: 'ok'; files: ScrivenerFile[] }
  | { kind: 'needs-order'; reason: string };

/**
 * Reading order: filename numbering first (Scrivener's "number exported files"
 * prefix); else the sidecar's row order when its titles cover every file
 * (outliner rows are in binder order); else stop and ask — never guess.
 */
function resolveOrder(files: ScrivenerFile[], sidecar: OutlineSidecar | null): OrderResolution {
  const byName = new Map(files.map((file) => [file.fileName, file]));
  const numbered = resolveReadingOrder(files.map((file) => file.fileName), null);
  if (numbered.kind === 'ordered') {
    const inOrder = numbered.order
      .map((name) => byName.get(name))
      .filter((file): file is ScrivenerFile => file !== undefined);
    return { kind: 'ok', files: inOrder };
  }

  if (sidecar) {
    const byTitle = new Map<string, ScrivenerFile>();
    for (const file of files) {
      const key = normalizeTitle(titleFromExportFileName(file.fileName));
      if (key.length > 0 && !byTitle.has(key)) byTitle.set(key, file);
    }
    const inOrder: ScrivenerFile[] = [];
    const used = new Set<ScrivenerFile>();
    for (const row of sidecar.rows) {
      const rowTitle = readColumn(row, 'Title');
      if (!rowTitle) continue;
      const file = byTitle.get(normalizeTitle(rowTitle));
      if (file && !used.has(file)) {
        inOrder.push(file);
        used.add(file);
      }
    }
    if (inOrder.length === files.length) return { kind: 'ok', files: inOrder };
    return {
      kind: 'needs-order',
      reason:
        `The outline CSV does not match every exported file by title ` +
        `(${inOrder.length}/${files.length} matched). Re-export with numbered ` +
        `file names, or make the outline titles match the file names.`,
    };
  }

  return {
    kind: 'needs-order',
    reason:
      'Exported file names are not numbered and no outline CSV was found. ' +
      'Re-export with "number exported files" enabled, or add the outline CSV.',
  };
}

/**
 * Match sidecar rows to files (already in reading order) for metadata carry.
 * Primary: by normalized title. Fallback: when no title matches at all and the
 * row count equals the file count, assume binder order and zip positionally.
 */
function matchRowsToFiles(
  files: ScrivenerFile[],
  sidecar: OutlineSidecar | null
): (Record<string, string> | null)[] {
  if (!sidecar) return files.map(() => null);

  const rowByTitle = new Map<string, Record<string, string>>();
  for (const row of sidecar.rows) {
    const title = readColumn(row, 'Title');
    if (!title) continue;
    const key = normalizeTitle(title);
    if (!rowByTitle.has(key)) rowByTitle.set(key, row);
  }

  const matches = files.map((file) => {
    const key = normalizeTitle(titleFromExportFileName(file.fileName));
    return key.length > 0 ? (rowByTitle.get(key) ?? null) : null;
  });

  const anyTitleMatch = matches.some((row) => row !== null);
  if (!anyTitleMatch && sidecar.rows.length === files.length) {
    return files.map((_, index) => sidecar.rows[index]);
  }
  return matches;
}

function collectCustomFields(scenes: ManuscriptScene[]): string[] {
  const fields = new Set<string>();
  for (const scene of scenes) {
    for (const key of Object.keys(scene.knownMetadata)) fields.add(key);
  }
  return Array.from(fields).sort();
}

// --- Obsidian adapter -------------------------------------------------------

const SCENE_EXTENSIONS = new Set(['md', 'txt']);

/** Adapt a live Obsidian App to the `ScrivenerSource` surface. */
/**
 * Locate the Outliner CSV sidecar. Scrivener exports it as a SIBLING of the
 * exported folder tree, so the book folder rarely contains it: search anywhere
 * under the book folder first (snapshot folders skipped), then climb the
 * ancestor folders' direct children up to the vault root. "outlin*"-named CSVs
 * win at every level.
 */
export function findScrivenerSidecarFile(app: App, folderPath: string): TFile | null {
  const root = app.vault.getAbstractFileByPath(normalizePath(folderPath));
  if (!(root instanceof TFolder)) return null;
  const pick = (candidates: TFile[]): TFile | null => {
    const csvs = candidates
      .filter((file) => file.extension.toLowerCase() === 'csv')
      .sort((a, b) => a.name.localeCompare(b.name));
    if (csvs.length === 0) return null;
    return csvs.find((file) => /outlin/i.test(file.name)) ?? csvs[0];
  };
  const descendants: TFile[] = [];
  const walk = (folder: TFolder): void => {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        if (!isSnapshotFolderName(child.name)) walk(child);
      } else if (child instanceof TFile) {
        descendants.push(child);
      }
    }
  };
  walk(root);
  const inside = pick(descendants);
  if (inside) return inside;
  for (let parent = root.parent; parent; parent = parent.parent) {
    const hit = pick(parent.children.filter((child): child is TFile => child instanceof TFile));
    if (hit) return hit;
  }
  return null;
}

export function createObsidianScrivenerSource(app: App): ScrivenerSource {
  // Exports preserve the binder hierarchy (Book/ACT 1/…) — walk it, skipping
  // snapshot folders wholesale.
  const walk = (folder: TFolder, out: TFile[]): void => {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        if (!isSnapshotFolderName(child.name)) walk(child, out);
      } else if (child instanceof TFile) {
        out.push(child);
      }
    }
  };
  const descendantsOf = (folderPath: string): TFile[] => {
    const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return [];
    const out: TFile[] = [];
    walk(folder, out);
    return out;
  };

  return {
    async listSceneFiles(folderPath: string): Promise<ScrivenerFile[]> {
      const files = descendantsOf(folderPath).filter((file) =>
        SCENE_EXTENSIONS.has(file.extension.toLowerCase())
      );
      return Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          path: file.path,
          content: await app.vault.read(file),
        }))
      );
    },
    async readSidecar(folderPath: string): Promise<string | null> {
      const sidecar = findScrivenerSidecarFile(app, folderPath);
      return sidecar ? app.vault.read(sidecar) : null;
    },
  };
}
