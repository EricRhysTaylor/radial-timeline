/*
 * Markdown ingest adapter — the existing-vault path.
 *
 * Reads a folder of prose `.md` notes into a Manuscript Model: resolves reading
 * order, strips any existing frontmatter to get raw prose, and flags notes that
 * already carry `Class: Scene` so a re-run is a no-op. No AI here.
 *
 * The adapter depends on a narrow `MarkdownSource` surface (not the whole
 * Obsidian App) so it stays unit-testable; `createObsidianMarkdownSource`
 * adapts a live App to that surface.
 */

import { getFrontMatterInfo, normalizePath, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import {
  type ManuscriptModel,
  type ManuscriptScene,
  resolveReadingOrder,
  type ReadingOrderResult,
} from './manuscriptModel';

/** A markdown note as seen by the adapter (Obsidian-free for testing). */
export interface MarkdownNote {
  /** Base file name including extension, e.g. `01 Ithaca.md`. */
  fileName: string;
  /** Full vault path. */
  path: string;
  /** Raw file contents (frontmatter + body). */
  content: string;
  /** Parsed frontmatter, or null when the note has none. */
  frontmatter: Record<string, unknown> | null;
}

/** The minimal surface the adapter needs — easy to stub in tests. */
export interface MarkdownSource {
  /** Markdown notes directly in the book folder (non-recursive), TOC excluded. */
  listNotes(folderPath: string): Promise<MarkdownNote[]>;
  /** Raw text of a `TOC.md` in the folder, or null when absent. */
  readToc(folderPath: string): Promise<string | null>;
}

export type MarkdownIngestResult =
  | { kind: 'ok'; model: ManuscriptModel }
  | { kind: 'needs-order'; reason: string };

const TOC_FILE = 'toc.md';

/**
 * Ingest a folder of markdown notes into a single-chapter Manuscript Model.
 * (Chapter splitting from scene breaks is a later pass — per the canonical
 * prompt, each note is treated as one scene now.)
 */
export async function ingestMarkdownFolder(
  source: MarkdownSource,
  folderPath: string
): Promise<MarkdownIngestResult> {
  const notes = await source.listNotes(folderPath);
  const tocContent = await source.readToc(folderPath);

  const order: ReadingOrderResult = resolveReadingOrder(
    notes.map((note) => note.fileName),
    tocContent
  );
  if (order.kind === 'needs-order') {
    return { kind: 'needs-order', reason: order.reason };
  }

  const byName = new Map(notes.map((note) => [note.fileName, note]));
  const scenes: ManuscriptScene[] = [];
  for (const fileName of order.order) {
    const note = byName.get(fileName);
    if (!note) continue;
    scenes.push(noteToScene(note));
  }

  return {
    kind: 'ok',
    model: {
      sourceKind: 'md',
      chapters: [{ title: null, scenes }],
      customFields: collectCustomFields(scenes),
    },
  };
}

/** True when a note already carries `Class: Scene` (any casing of the value). */
export function isAlreadyOnboarded(frontmatter: Record<string, unknown> | null): boolean {
  const value = frontmatter?.['Class'];
  return typeof value === 'string' && value.trim().toLowerCase() === 'scene';
}

function noteToScene(note: MarkdownNote): ManuscriptScene {
  return {
    title: titleFromFileName(note.fileName),
    rawText: stripFrontmatter(note.content).trim(),
    knownMetadata: nonCanonicalStrings(note.frontmatter),
    knownSynopsis: readString(note.frontmatter?.['Synopsis']),
    sourceRef: note.path,
    alreadyOnboarded: isAlreadyOnboarded(note.frontmatter),
  };
}

/** Derive a display title from the file name, dropping a leading number and the extension. */
export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.md$/i, '')
    .replace(/^\s*\d+\s*[-._)]?\s*/, '')
    .trim();
}

/** Remove a leading YAML frontmatter block, returning the body. */
export function stripFrontmatter(content: string): string {
  const info = getFrontMatterInfo(content);
  if (!info.exists || typeof info.to !== 'number') return content;
  return content.slice(info.to).replace(/^\r?\n/, '');
}

/** Canonical Scene keys the LLM will (re)compute — excluded from carried metadata. */
const CANONICAL_KEYS = new Set(
  [
    'Class', 'Act', 'When', 'Duration', 'Chapter', 'Synopsis', 'Summary',
    'Pending Edits', 'Subplot', 'Character', 'POV', 'Words', 'Runtime',
    'Publish Stage', 'Status', 'Due', 'Pulse Update', 'Summary Update',
    'Place', 'Questions', 'Reader Emotion', 'Internal', 'Type', 'Shift', 'Iteration',
  ].map((key) => key.toLowerCase())
);

function nonCanonicalStrings(frontmatter: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!frontmatter) return out;
  for (const [key, value] of Object.entries(frontmatter)) {
    if (CANONICAL_KEYS.has(key.toLowerCase())) continue;
    const str = readString(value);
    if (str !== null) out[key] = str;
  }
  return out;
}

function collectCustomFields(scenes: ManuscriptScene[]): string[] {
  const fields = new Set<string>();
  for (const scene of scenes) {
    for (const key of Object.keys(scene.knownMetadata)) fields.add(key);
  }
  return Array.from(fields).sort();
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Adapt a live Obsidian App to the `MarkdownSource` surface. */
export function createObsidianMarkdownSource(app: App): MarkdownSource {
  const readNote = async (file: TFile): Promise<MarkdownNote> => {
    const content = await app.vault.read(file);
    const cache = app.metadataCache.getFileCache(file);
    return {
      fileName: file.name,
      path: file.path,
      content,
      frontmatter: (cache?.frontmatter) ?? null,
    };
  };

  const childrenOf = (folderPath: string): TFile[] => {
    const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter(
      (child): child is TFile => child instanceof TFile && child.extension === 'md'
    );
  };

  return {
    async listNotes(folderPath: string): Promise<MarkdownNote[]> {
      const files = childrenOf(folderPath).filter((file) => file.name.toLowerCase() !== TOC_FILE);
      return Promise.all(files.map(readNote));
    },
    async readToc(folderPath: string): Promise<string | null> {
      const toc = childrenOf(folderPath).find((file) => file.name.toLowerCase() === TOC_FILE);
      return toc ? app.vault.read(toc) : null;
    },
  };
}
