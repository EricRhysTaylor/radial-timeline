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
 *   - reading order from the sidecar's row order, else from filename numbering;
 *   - sidecar rows matched to files by normalized title, never by position;
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
import type { ManuscriptModel, ManuscriptScene } from './manuscriptModel';

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

/** The outline CSV found for an export: its file name (shown to the author) and text. */
export interface OutlineFile {
  name: string;
  text: string;
}

/** The minimal surface the adapter needs — easy to stub in tests. */
export interface ScrivenerSource {
  /** Exported prose files (`.md`/`.txt`) anywhere under the export folder, sidecar excluded. */
  listSceneFiles(folderPath: string): Promise<ScrivenerFile[]>;
  /** The export's Outliner CSV (one with a Title column), or null when absent. */
  readSidecar(folderPath: string): Promise<OutlineFile | null>;
}

export type ScrivenerIngestResult =
  | { kind: 'ok'; model: ManuscriptModel; outlineName: string | null; warnings: string[] }
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
      record[header] = (cells[index] ?? '').trim(); // SAFE: a short CSV row leaves its trailing columns empty rather than shifting values left
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
export function normalizeTitle(title: string): string {
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
  | { target: 'ignore' }
  /**
   * Per-subplot COLUMN model: the column's NAME is the subplot; any non-empty
   * cell marks the scene as belonging to it (the cell's text is a note and
   * rides along as a custom field). A scene flagged in several columns
   * belongs to each of those subplots.
   */
  | { target: 'subplot-flag' }
  /**
   * The scene's viewpoint character. Radial Timeline marks the FIRST name in
   * Character as the POV character (its POV field holds a mode such as
   * "third", not a name), so the name is placed first in Character.
   */
  | { target: 'pov-character' };

/**
 * Scene fields an outline column can become, in the order the import review
 * offers them: timeline structure first, then notes, then the advanced
 * template. Fields the importer writes itself (Class, Status, Publish Stage)
 * and plugin-maintained fields (Words, Pulse/Summary Update) are not offered —
 * a mapped value there would be overwritten or would break the timeline.
 */
export const SCRIVENER_FIELD_TARGETS = {
  timeline: ['Subplot', 'Character', 'Place', 'When', 'Duration', 'Act', 'Chapter'],
  other: ['Synopsis', 'Summary', 'POV', 'Pending Edits', 'Due', 'Questions', 'Reader Emotion', 'Internal', 'Type', 'Shift', 'Iteration'],
} as const;

const TARGET_KEYS = new Set<string>([...SCRIVENER_FIELD_TARGETS.timeline, ...SCRIVENER_FIELD_TARGETS.other]);

/** Fields that hold a list: values from several columns accumulate instead of competing. */
const LIST_KEYS = new Set(['Subplot', 'Character', 'Place']);

/** Scrivener outliner columns that are tool/derived data — never worth carrying. */
const IGNORED_FIELDS = new Set([
  'title', 'word count', 'total word count', 'character count', 'chars',
  'words', 'created', 'created date', 'date created', 'modified',
  'modified date', 'date modified', 'include in compile', 'compile',
  'target', 'targets', 'target type', 'progress', 'total progress',
  'section type', 'position', 'depth',
]);

/** True for outliner columns that are Scrivener's own bookkeeping, not story metadata. */
export function isDerivedOutlineField(fieldName: string): boolean {
  return IGNORED_FIELDS.has(bareFieldName(fieldName).toLowerCase());
}

/** Common Scrivener column names for a differently named scene field. */
const FIELD_ALIASES: Record<string, string> = {
  subplots: 'Subplot', storyline: 'Subplot', storylines: 'Subplot', plotline: 'Subplot',
  plotlines: 'Subplot', plot: 'Subplot', thread: 'Subplot', threads: 'Subplot',
  theme: 'Subplot', themes: 'Subplot', arc: 'Subplot', arcs: 'Subplot',
  characters: 'Character', people: 'Character', person: 'Character', cast: 'Character',
  places: 'Place', location: 'Place', locations: 'Place', setting: 'Place', settings: 'Place',
  date: 'When', 'story date': 'When', 'scene date': 'When',
  'value shift': 'Shift', 'scene type': 'Type',
};

/** Scrivener columns naming the viewpoint character (a name, not RT's POV mode). */
const POV_CHARACTER_FIELDS = new Set(['pov', 'pov character', 'point of view', 'viewpoint', 'viewpoint character']);

/** The column name as the author wrote it (the adapter prefixes canonical-key collisions). */
export function bareFieldName(fieldName: string): string {
  return fieldName.replace(new RegExp(`^${COLLISION_PREFIX}`, 'i'), '').trim();
}

/**
 * Propose a disposition for each carried field: a scene field when the column
 * name (or a common synonym) names one, skip for Scrivener's derived columns,
 * otherwise keep it unchanged so nothing is silently lost. The author reviews
 * every proposal before anything is written.
 */
export function proposeScrivenerAutomap(
  fieldNames: string[]
): Record<string, ScrivenerFieldTarget> {
  const proposals: Record<string, ScrivenerFieldTarget> = {};
  for (const fieldName of fieldNames) {
    const lower = bareFieldName(fieldName).toLowerCase();
    if (IGNORED_FIELDS.has(lower)) {
      proposals[fieldName] = { target: 'ignore' };
      continue;
    }
    if (POV_CHARACTER_FIELDS.has(lower)) {
      proposals[fieldName] = { target: 'pov-character' };
      continue;
    }
    const key = CANONICAL_BY_LOWER.get(lower) ?? FIELD_ALIASES[lower];
    proposals[fieldName] = key && TARGET_KEYS.has(key) ? { target: 'rt-key', key } : { target: 'custom' };
  }
  return proposals;
}

/** Single-value scene fields that more than one column feeds; the first filled column wins. */
export function mappingConflicts(mapping: Record<string, ScrivenerFieldTarget>): string[] {
  const counts = new Map<string, number>();
  for (const decision of Object.values(mapping)) {
    if (decision.target !== 'rt-key' || LIST_KEYS.has(decision.key)) continue;
    counts.set(decision.key, (counts.get(decision.key) ?? 0) + 1); // SAFE: first column for a field starts its tally at 0
  }
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key);
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
 * Apply the author's mapping decisions to one scene's carried metadata:
 * `ignore` drops the field, `rt-key` renames it to the scene field, `custom`
 * — and any unmapped field — keeps it as-is. List fields (Subplot, Character,
 * Place) gather every mapped column, `; `-joined; a single-value field keeps
 * the first filled column (the review flags such conflicts). A POV character
 * goes to the front of Character, where Radial Timeline looks for it.
 */
export function applyMetadataMapping(
  metadata: Record<string, string>,
  mapping: Record<string, ScrivenerFieldTarget>
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string): void => {
    if (!(key in out)) out[key] = value;
    else if (LIST_KEYS.has(key)) out[key] = `${out[key]}; ${value}`;
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (value.trim().length === 0) continue;
    const decision = mapping[key];
    if (!decision || decision.target === 'custom') {
      if (!(key in out)) out[key] = value;
    } else if (decision.target === 'subplot-flag') {
      // Membership marker: the COLUMN name is the subplot; the cell text is a
      // per-scene note and is kept as a custom field so nothing is lost.
      put('Subplot', bareFieldName(key));
      if (!(key in out)) out[key] = value;
    } else if (decision.target === 'rt-key') {
      put(decision.key, value);
    } else if (decision.target === 'pov-character') {
      out['Character'] = 'Character' in out ? `${value}; ${out['Character']}` : value;
    }
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

/** Same-selection re-export advice, shared by every blocking outline problem. */
const REEXPORT_ADVICE = 'In Scrivener, select the same documents and export both Files and Outliner Contents again.';

/**
 * Ingest a Scrivener export — scene files plus an optional Outliner CSV — into
 * a single-chapter Manuscript Model. Files are read once: the same listing is
 * validated (blocking problems return `needs-order` with the author-facing
 * reasons; soft ones ride along as `warnings`) and then assembled into scenes.
 */
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
      stripLeadingYaml(file.content).trim().length > 0
  );
  const outlineFile = await source.readSidecar(folderPath);
  const sidecar = outlineFile ? parseOutlineSidecar(outlineFile.text) : null;
  if (outlineFile && !sidecar?.fields.some((field) => /^title$/i.test(field))) {
    return { kind: 'needs-order', reason: `${outlineFile.name} has no Title column or no rows. ${REEXPORT_ADVICE}` };
  }

  const check = inspectScrivenerExport(files, sidecar);
  if (check.errors.length > 0) return { kind: 'needs-order', reason: check.errors.join('\n') };

  const ordered = resolveOrder(files, sidecar, folderPath);
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
    outlineName: outlineFile?.name ?? null,
    warnings: check.warnings,
  };
}

export interface ScrivenerExportCheck { errors: string[]; warnings: string[] }

/** Validate that the outline describes exactly these scene files before carrying its metadata. */
export function inspectScrivenerExport(files: ScrivenerFile[], outline: OutlineSidecar | null): ScrivenerExportCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!files.length) {
    errors.push('No scene text found. In Scrivener, choose File → Export → Files as plain text, then copy the exported folder into this vault.');
    return { errors, warnings };
  }
  if (!outline) {
    warnings.push('No outline CSV found, so scenes arrive without synopses or metadata. To bring those, export Outliner Contents as CSV next to this folder.');
    return { errors, warnings };
  }
  const fileTitles = files.map(file => normalizeTitle(titleFromExportFileName(file.fileName)));
  const rowTitles = outline.rows.map(row => normalizeTitle(readColumn(row, 'Title') ?? '')); // SAFE: empty outline titles cannot match a scene
  const matchedRows = rowTitles.filter(title => fileTitles.includes(title));
  if (new Set(fileTitles).size !== fileTitles.length || new Set(matchedRows).size !== matchedRows.length) {
    errors.push(`Two documents share a title, so the outline cannot tell them apart. Rename one in Scrivener. ${REEXPORT_ADVICE}`);
  }
  const unmatchedFiles = files.filter((_, index) => !rowTitles.includes(fileTitles[index]));
  if (unmatchedFiles.length) errors.push(`${unmatchedFiles.length} scene file${unmatchedFiles.length === 1 ? ' is' : 's are'} not in the outline: ${unmatchedFiles.slice(0, 5).map(file => titleFromExportFileName(file.fileName)).join(', ')}. ${REEXPORT_ADVICE}`);
  const missing = outline.rows.filter((row, index) => {
    const count = readColumn(row, 'Word Count');
    return count !== null && Number(count.replace(/,/g, '')) > 0 && !fileTitles.includes(rowTitles[index]);
  });
  if (missing.length) errors.push(`${missing.length} outline document${missing.length === 1 ? ' has' : 's have'} text but no exported file: ${missing.slice(0, 5).map(row => readColumn(row, 'Title')).join(', ')}. ${REEXPORT_ADVICE}`);
  const uncertain = outline.rows.filter((row, index) => !fileTitles.includes(rowTitles[index]) && readColumn(row, 'Word Count') === null);
  if (uncertain.length) warnings.push(`${uncertain.length} outline row${uncertain.length === 1 ? ' has' : 's have'} no exported file. That is expected for folders and empty documents; otherwise export again with Word Count visible so missing text can be detected.`);
  if (!outline.fields.some(field => /^synopsis$/i.test(field))) warnings.push('The outline has no Synopsis column, so scenes arrive without synopses.');
  return { errors, warnings };
}

type OrderResolution =
  | { kind: 'ok'; files: ScrivenerFile[] }
  | { kind: 'needs-order'; reason: string };

/** Leading binder number of a path segment ("03 Chapter Three" → 3), or null. */
function segmentNumber(segment: string): number | null {
  const match = segment.match(/^\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Order numbered exports without an outline. Scrivener numbers documents by
 * binder position; in a hierarchical export that numbering restarts in every
 * folder. Unique file numbers are book-wide and order on their own; repeated
 * ones are per-folder, so the folders must be numbered too, and the path is
 * compared segment by segment.
 */
function orderNumberedFiles(files: ScrivenerFile[], folderPath: string): OrderResolution {
  const prefix = folderPath.replace(/\/+$/, '') + '/';
  const segmentsOf = (file: ScrivenerFile): string[] =>
    (file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.fileName).split('/');
  const fileNumbers = files.map((file) => segmentNumber(file.fileName));
  if (fileNumbers.some((n) => n === null)) {
    return {
      kind: 'needs-order',
      reason: 'The exported files are not numbered and no outline CSV was found. Export again with numbered files, or add the Outliner Contents CSV.',
    };
  }
  if (new Set(fileNumbers).size === files.length) {
    return { kind: 'ok', files: files.slice().sort((a, b) => (segmentNumber(a.fileName) ?? 0) - (segmentNumber(b.fileName) ?? 0)) }; // SAFE: every file number was checked non-null above
  }
  const keys = new Map(files.map((file) => [file, segmentsOf(file).map(segmentNumber)]));
  if ([...keys.values()].some((numbers) => numbers.some((n) => n === null))) {
    return {
      kind: 'needs-order',
      reason: 'File numbers restart in each folder, but the folders are not numbered, so the order is unclear. Add the Outliner Contents CSV.',
    };
  }
  const ordered = files.slice().sort((a, b) => {
    const left = keys.get(a) ?? [];
    const right = keys.get(b) ?? [];
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0); // SAFE: every segment number was checked non-null above
    }
    return left.length - right.length;
  });
  return { kind: 'ok', files: ordered };
}

/**
 * The outline row order is authoritative whenever a CSV is supplied.
 * Numbered filenames supply order only for exports with no outline.
 * A partial outline blocks import rather than substituting filename order.
 */
function resolveOrder(files: ScrivenerFile[], sidecar: OutlineSidecar | null, folderPath: string): OrderResolution {
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
      reason: `The outline matches ${inOrder.length} of ${files.length} exported files by title. ${REEXPORT_ADVICE}`,
    };
  }
  return orderNumberedFiles(files, folderPath);
}

/**
 * Match sidecar rows to files (already in reading order) for metadata carry.
 * Match by normalized document title only. Never attach metadata by position.
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

/** Every file under a folder, skipping Scrivener snapshot folders wholesale. */
function filesUnder(folder: TFolder): TFile[] {
  const out: TFile[] = [];
  const walk = (current: TFolder): void => {
    for (const child of current.children) {
      if (child instanceof TFolder) {
        if (!isSnapshotFolderName(child.name)) walk(child);
      } else if (child instanceof TFile) {
        out.push(child);
      }
    }
  };
  walk(folder);
  return out;
}

/**
 * Locate the export's Outliner CSV. Scrivener writes it wherever the author
 * saves it — usually BESIDE the exported folder — so search under the export
 * folder first, then each ancestor's direct children up to the vault root.
 * Within a level, a CSV named after the export folder wins, then one named
 * "outline…". Only a CSV with a Title column counts: an unrelated spreadsheet
 * in a parent folder must never be mistaken for the outline.
 */
export async function findScrivenerOutline(app: App, folderPath: string): Promise<OutlineFile | null> {
  const root = app.vault.getAbstractFileByPath(normalizePath(folderPath));
  if (!(root instanceof TFolder)) return null;
  const exportName = root.name.toLowerCase();
  const rank = (file: TFile): number =>
    file.basename.toLowerCase().includes(exportName) ? 0 : /outlin/i.test(file.name) ? 1 : 2;
  const levels: TFile[][] = [filesUnder(root)];
  for (let parent = root.parent; parent; parent = parent.parent) {
    levels.push(parent.children.filter((child): child is TFile => child instanceof TFile));
  }
  for (const level of levels) {
    const csvs = level
      .filter((file) => file.extension.toLowerCase() === 'csv')
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    for (const csv of csvs) {
      const text = await app.vault.cachedRead(csv);
      if (parseOutlineSidecar(text)?.fields.some((field) => /^title$/i.test(field))) {
        return { name: csv.name, text };
      }
    }
  }
  return null;
}

/** Adapt a live Obsidian App to the `ScrivenerSource` surface. */
export function createObsidianScrivenerSource(app: App): ScrivenerSource {
  return {
    async listSceneFiles(folderPath: string): Promise<ScrivenerFile[]> {
      const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
      if (!(folder instanceof TFolder)) return [];
      const files = filesUnder(folder).filter((file) => SCENE_EXTENSIONS.has(file.extension.toLowerCase()));
      return Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          path: file.path,
          content: await app.vault.cachedRead(file),
        }))
      );
    },
    readSidecar: (folderPath: string) => findScrivenerOutline(app, folderPath),
  };
}
