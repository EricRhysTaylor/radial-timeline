/*
 * Single-file ingest adapter — the "one big file" flow.
 *
 * Takes ONE file holding a whole book (a classic as .txt/.md or a Gutenberg-style
 * .html) and produces a Manuscript Model whose scenes are the book's internal
 * divisions (BOOK I, CHAPTER 1, …). Downstream, AI auto-split breaks each
 * division into its scenes — the 1-click "single file → ~60 scenes" path.
 *
 * Deterministic and Obsidian-free (pure) so it is fully unit-testable. PDF is a
 * later format (V2); text and HTML are handled here.
 */

import type { ManuscriptModel, ManuscriptScene } from './manuscriptModel';

/** A detected top-level division of the manuscript (a book/chapter). */
export interface DetectedDivision {
  /** Heading text, normalized (e.g. "Book IV"), or null for an undivided file. */
  title: string | null;
  /** The division's prose (its argument line + text), divisions' headings removed. */
  body: string;
}

// --- Format extraction ------------------------------------------------------

/** Extract plain text from a source file by extension (.html stripped; text as-is). */
export function extractPlainText(fileName: string, content: string): string {
  return /\.html?$/i.test(fileName) ? htmlToText(content) : content;
}

/** Trim Project Gutenberg license/boilerplate to the actual work, when present. */
export function trimGutenbergBoilerplate(text: string): string {
  let out = text;
  const start = out.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (start && typeof start.index === 'number') out = out.slice(start.index + start[0].length);
  const end = out.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (end && typeof end.index === 'number') out = out.slice(0, end.index);
  return out.trim();
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Convert HTML to paragraph-preserving plain text (Gutenberg boilerplate trimmed). */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  // Block-level tags become paragraph breaks; <br> a single newline.
  text = text
    .replace(/<br\s*\/?>(?!\n)/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  text = decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return trimGutenbergBoilerplate(text);
}

// --- Chapter / book detection ----------------------------------------------

/** A standalone division heading line: BOOK/CHAPTER/PART/CANTO/LETTER + numeral. */
const HEADING_RE =
  /^\s*(?:BOOK|CHAPTER|PART|CANTO|LETTER)\s+(?:[IVXLCDM]+|\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE)\b[.:]?\s*$/i;
/** A Markdown division heading (# / ## / ###). */
const MD_HEADING_RE = /^\s{0,3}#{1,3}\s+\S/;

export function isDivisionHeading(line: string): boolean {
  return HEADING_RE.test(line) || MD_HEADING_RE.test(line);
}

/** Title-case a heading, keeping Roman-numeral tokens uppercase. "BOOK IV." → "Book IV". */
export function normalizeHeading(line: string): string {
  const cleaned = line.replace(/^\s{0,3}#{1,3}\s+/, '').replace(/[.:]\s*$/, '').trim();
  return cleaned
    .split(/\s+/)
    .map((word) => {
      if (/^[IVXLCDM]+$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Split a manuscript into its top-level divisions on standalone heading lines.
 * Text before the first heading (license, TOC, preface) is dropped. A file with
 * no detectable headings yields a single undivided division (title null).
 */
export function detectDivisions(text: string): DetectedDivision[] {
  const lines = text.split(/\r?\n/);
  const divisions: DetectedDivision[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (isDivisionHeading(line)) {
      if (current) divisions.push({ title: current.title, body: current.lines.join('\n').trim() });
      current = { title: normalizeHeading(line), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) divisions.push({ title: current.title, body: current.lines.join('\n').trim() });

  if (divisions.length === 0) {
    // No headings — the whole file is one undivided division (AI splits it all).
    return [{ title: null, body: text.trim() }];
  }

  const withBody = divisions.filter((division) => division.body.length > 0);
  // A Gutenberg table of contents repeats every heading ("BOOK I" … "BOOK XXIV")
  // before the real text; the last TOC entry swallows the preface as its body.
  // When a title repeats, the REAL division is the last occurrence — keep it,
  // which drops the TOC duplicates (and the front matter they captured).
  const lastIndex = new Map<string, number>();
  withBody.forEach((division, i) => {
    if (division.title !== null) lastIndex.set(division.title, i);
  });
  return withBody.filter(
    (division, i) => division.title === null || lastIndex.get(division.title) === i
  );
}

// --- Model assembly ---------------------------------------------------------

/** Ingest one manuscript file into a Manuscript Model (one scene per division). */
export function ingestSingleFile(fileName: string, content: string): ManuscriptModel {
  const text = extractPlainText(fileName, content);
  const divisions = detectDivisions(text);
  const scenes: ManuscriptScene[] = divisions.map((division, index) => ({
    title: division.title,
    rawText: division.body,
    knownMetadata: {},
    knownSynopsis: null,
    sourceRef: `${fileName}#${index + 1}`,
    alreadyOnboarded: false,
  }));
  return {
    sourceKind: 'md',
    chapters: [{ title: null, scenes }],
    customFields: [],
  };
}
