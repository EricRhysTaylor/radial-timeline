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
  /** Things that don't line up; importing anyway is the author's call. */
  | { kind: 'problems'; problems: ScrivenerProblem[] }
  /** Nothing to import. */
  | { kind: 'empty'; reason: string };

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

/** True when an outline has a Title column. */
export function hasTitleColumn(outline: OutlineSidecar): boolean {
  return outline.fields.some((field) => /^title$/i.test(field));
}

/**
 * True when the outline lists every one of these exported scene files by
 * title. An outline found OUTSIDE an export's folder belongs to that export
 * only when this holds — otherwise it is another export's outline.
 */
export function outlineListsAll(outline: OutlineSidecar, sceneFileNames: string[]): boolean {
  const titles = new Set(outline.rows.map((row) => normalizeTitle(readColumn(row, 'Title') ?? ''))); // SAFE: a row with no title matches no scene file
  return sceneFileNames.length > 0 && sceneFileNames.every((name) => titles.has(normalizeTitle(titleFromExportFileName(name))));
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

/** Up to five names, quoted, then a count of the rest. */
function listNames(names: string[]): string {
  const quoted = names.slice(0, 5).map((name) => `“${name}”`).join(', ');
  return names.length > 5 ? `${quoted} and ${names.length - 5} more` : quoted;
}

/**
 * Ingest a Scrivener export — scene files plus an optional Outliner CSV — into
 * a single-chapter Manuscript Model. Files are read once. Only an export with
 * no scene text cannot be imported (`empty`). Anything that doesn't line up
 * comes back as `problems` for the author to fix in Scrivener; with
 * `importAnyway` the import goes ahead and each problem's consequence rides
 * along as a warning.
 */
export async function ingestScrivenerFolder(
  source: ScrivenerSource,
  folderPath: string,
  options: { importAnyway?: boolean } = {}
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
  if (files.length === 0) {
    return { kind: 'empty', reason: 'No scene text found. In Scrivener, choose File → Export → Files as plain text, then copy the exported folder into this vault.' };
  }
  const outlineFile = await source.readSidecar(folderPath);
  const parsed = outlineFile ? parseOutlineSidecar(outlineFile.text) : null;
  const outline = parsed && hasTitleColumn(parsed) ? parsed : null;
  const problems: ScrivenerProblem[] = [];
  if (outlineFile && !outline) {
    problems.push({
      problem: `${outlineFile.name} has no Title column or no rows.`,
      ifImported: `${outlineFile.name} is left out, so scenes import without synopses or properties.`,
    });
  }
  const check = inspectScrivenerExport(files, outline);
  problems.push(...check.problems);
  const order = resolveOrder(files, outline, folderPath);
  if (order.problem) problems.push(order.problem);
  if (problems.length > 0 && !options.importAnyway) return { kind: 'problems', problems };

  const disagreement = outline && problems.length === 0 ? numberingDisagreement(order.files, folderPath) : null;
  const rowsByFile = matchRowsToFiles(order.files, outline);
  const scenes = order.files.map((file, index) => ({
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
    outlineName: outline ? outlineFile?.name ?? null : null, // SAFE: an outline is only parsed from a found file
    warnings: [
      ...problems.map((problem) => problem.ifImported),
      ...check.warnings,
      ...(disagreement ? [disagreement] : []),
    ],
  };
}

/**
 * Exports carry order twice: the outline's rows and, with numbered files, the
 * file names. Both come from the binder, so they only disagree when the binder
 * changed between the two exports. The outline wins; say so, naming the first
 * scene that lands differently.
 */
function numberingDisagreement(outlineOrder: ScrivenerFile[], folderPath: string): string | null {
  const numbered = orderNumberedFiles(outlineOrder, folderPath);
  if (numbered.kind !== 'ok') return null;
  const index = numbered.files.findIndex((file, i) => file !== outlineOrder[i]);
  if (index === -1) return null;
  const title = titleFromExportFileName(outlineOrder[index].fileName);
  return `The file numbers and the outline disagree on order, starting at “${title}”. The outline’s order is used. If you moved scenes in the binder between the two exports, export both again.`;
}

/**
 * Something in an export that doesn't line up. The import can still go ahead;
 * `ifImported` says what happens to the affected scenes when it does.
 */
export interface ScrivenerProblem {
  problem: string;
  ifImported: string;
}

export interface ScrivenerExportCheck { problems: ScrivenerProblem[]; warnings: string[] }

/** Check that the outline describes exactly these scene files before carrying its metadata. */
export function inspectScrivenerExport(files: ScrivenerFile[], outline: OutlineSidecar | null): ScrivenerExportCheck {
  const problems: ScrivenerProblem[] = [];
  const warnings: string[] = [];
  if (!outline) return { problems, warnings }; // a missing outline is shown by the review itself
  const fileTitles = files.map(file => normalizeTitle(titleFromExportFileName(file.fileName)));
  const rowTitles = outline.rows.map(row => normalizeTitle(readColumn(row, 'Title') ?? '')); // SAFE: empty outline titles cannot match a scene
  const shared = [...new Set(fileTitles.filter((title, index) =>
    fileTitles.indexOf(title) !== index || rowTitles.filter(row => row === title).length > 1
  ))];
  if (shared.length) {
    const names = shared.map(title => titleFromExportFileName(files[fileTitles.indexOf(title)].fileName));
    problems.push({
      problem: `More than one document is titled ${listNames(names)}, so the outline can’t tell those scenes apart.`,
      ifImported: `Scenes titled ${listNames(names)} import without outline properties.`,
    });
  }
  const unmatched = files.filter((_, index) => !rowTitles.includes(fileTitles[index])).map(file => titleFromExportFileName(file.fileName));
  if (unmatched.length) {
    problems.push({
      problem: `${unmatched.length} scene file${unmatched.length === 1 ? ' is' : 's are'} not in the outline: ${listNames(unmatched)}.`,
      ifImported: `${listNames(unmatched)} ${unmatched.length === 1 ? 'imports' : 'import'} without outline properties, after the scenes the outline lists.`,
    });
  }
  const missing = outline.rows
    .filter((row, index) => {
      const count = readColumn(row, 'Word Count');
      return count !== null && Number(count.replace(/,/g, '')) > 0 && !fileTitles.includes(rowTitles[index]);
    })
    .map(row => readColumn(row, 'Title') ?? ''); // SAFE: a row reaches here only through its title, which can be blank
  if (missing.length) {
    problems.push({
      problem: `${missing.length} outline document${missing.length === 1 ? ' has' : 's have'} text but no exported file: ${listNames(missing)}.`,
      ifImported: `${listNames(missing)} ${missing.length === 1 ? 'is' : 'are'} not imported.`,
    });
  }
  const uncertain = outline.rows.filter((row, index) => !fileTitles.includes(rowTitles[index]) && readColumn(row, 'Word Count') === null);
  if (uncertain.length) warnings.push(`${uncertain.length} outline row${uncertain.length === 1 ? ' has' : 's have'} no exported file. That is expected for folders and empty documents; otherwise export again with Word Count visible so missing text can be detected.`);
  if (!outline.fields.some(field => /^synopsis$/i.test(field))) warnings.push('The outline has no Synopsis column, so scenes arrive without synopses.');
  return { problems, warnings };
}

/** Leading binder number of a path segment ("03 Chapter Three" → 3), or null. */
function segmentNumber(segment: string): number | null {
  const match = segment.match(/^\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Files in folder-and-name order, numbers compared as numbers. */
function byPath(files: ScrivenerFile[]): ScrivenerFile[] {
  return files.slice().sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/**
 * Order numbered exports without an outline. Scrivener numbers documents by
 * binder position; in a hierarchical export that numbering restarts in every
 * folder. Unique file numbers are book-wide and order on their own; repeated
 * ones are per-folder, so the folders must be numbered too, and the path is
 * compared segment by segment.
 */
function orderNumberedFiles(files: ScrivenerFile[], folderPath: string):
  | { kind: 'ok'; files: ScrivenerFile[] }
  | { kind: 'unclear'; problem: ScrivenerProblem } {
  const prefix = folderPath.replace(/\/+$/, '') + '/';
  const segmentsOf = (file: ScrivenerFile): string[] =>
    (file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.fileName).split('/');
  const fileNumbers = files.map((file) => segmentNumber(file.fileName));
  if (fileNumbers.some((n) => n === null)) {
    return {
      kind: 'unclear',
      problem: {
        problem: 'The files are not numbered and there is no outline CSV, so the order is unknown.',
        ifImported: 'Scenes are ordered by file name. Check the order in the scene list before importing.',
      },
    };
  }
  if (new Set(fileNumbers).size === files.length) {
    return { kind: 'ok', files: files.slice().sort((a, b) => (segmentNumber(a.fileName) ?? 0) - (segmentNumber(b.fileName) ?? 0)) }; // SAFE: every file number was checked non-null above
  }
  const keys = new Map(files.map((file) => [file, segmentsOf(file).map(segmentNumber)]));
  if ([...keys.values()].some((numbers) => numbers.some((n) => n === null))) {
    return {
      kind: 'unclear',
      problem: {
        problem: 'File numbers restart in each folder, but the folders are not numbered, so the order is unclear.',
        ifImported: 'Scenes are ordered by folder and file name. Check the order in the scene list before importing.',
      },
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
 * Narrative order. An outline orders every file it lists (a title shared by
 * several documents pairs rows and files in turn); files it doesn't list follow
 * in file order. Without an outline, file numbering orders the book. When
 * neither settles it, files go by name and the problem says so.
 */
function resolveOrder(
  files: ScrivenerFile[],
  outline: OutlineSidecar | null,
  folderPath: string
): { files: ScrivenerFile[]; problem: ScrivenerProblem | null } {
  const numbered = orderNumberedFiles(files, folderPath);
  const fileOrder = numbered.kind === 'ok' ? numbered.files : byPath(files);
  if (!outline) return { files: fileOrder, problem: numbered.kind === 'ok' ? null : numbered.problem };
  const byTitle = new Map<string, ScrivenerFile[]>();
  for (const file of fileOrder) {
    const key = normalizeTitle(titleFromExportFileName(file.fileName));
    byTitle.set(key, [...(byTitle.get(key) ?? []), file]); // SAFE: a title's first file starts its list
  }
  const listed: ScrivenerFile[] = [];
  for (const row of outline.rows) {
    const file = byTitle.get(normalizeTitle(readColumn(row, 'Title') ?? ''))?.shift(); // SAFE: a row with no title matches no file
    if (file) listed.push(file);
  }
  return { files: [...listed, ...fileOrder.filter((file) => !listed.includes(file))], problem: null };
}

/**
 * Match outline rows to files for metadata carry, by normalized document title
 * only — never by position. A title held by more than one file or row is
 * ambiguous, so those scenes carry no outline properties.
 */
function matchRowsToFiles(
  files: ScrivenerFile[],
  outline: OutlineSidecar | null
): (Record<string, string> | null)[] {
  if (!outline) return files.map(() => null);
  const keyOf = (file: ScrivenerFile): string => normalizeTitle(titleFromExportFileName(file.fileName));
  const rowsByTitle = new Map<string, Record<string, string>[]>();
  for (const row of outline.rows) {
    const title = readColumn(row, 'Title');
    if (!title) continue;
    const key = normalizeTitle(title);
    rowsByTitle.set(key, [...(rowsByTitle.get(key) ?? []), row]); // SAFE: a title's first row starts its list
  }
  const fileCounts = new Map<string, number>();
  for (const file of files) fileCounts.set(keyOf(file), (fileCounts.get(keyOf(file)) ?? 0) + 1); // SAFE: a title's first file starts its tally at 0
  return files.map((file) => {
    const rows = rowsByTitle.get(keyOf(file));
    return rows?.length === 1 && fileCounts.get(keyOf(file)) === 1 ? rows[0] : null;
  });
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
 * "outline…". Only a CSV with a Title column counts, and one outside the
 * export folder must list every scene file: an unrelated spreadsheet, or
 * another export's outline, is never taken for this export's.
 */
export async function findScrivenerOutline(app: App, folderPath: string): Promise<OutlineFile | null> {
  const root = app.vault.getAbstractFileByPath(normalizePath(folderPath));
  if (!(root instanceof TFolder)) return null;
  const exportName = root.name.toLowerCase();
  const rank = (file: TFile): number =>
    file.basename.toLowerCase().includes(exportName) ? 0 : /outlin/i.test(file.name) ? 1 : 2;
  const inside = filesUnder(root);
  const sceneNames = inside
    .filter((file) => SCENE_EXTENSIONS.has(file.extension.toLowerCase()) && !isScrivenerAuxiliaryFile(file.name))
    .map((file) => file.name);
  const levels: TFile[][] = [inside];
  for (let parent = root.parent; parent; parent = parent.parent) {
    levels.push(parent.children.filter((child): child is TFile => child instanceof TFile));
  }
  for (const [depth, level] of levels.entries()) {
    const csvs = level
      .filter((file) => file.extension.toLowerCase() === 'csv')
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    for (const csv of csvs) {
      const text = await app.vault.cachedRead(csv);
      const outline = parseOutlineSidecar(text);
      if (outline && hasTitleColumn(outline) && (depth === 0 || outlineListsAll(outline, sceneNames))) {
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
