/*
 * Word `.docx` ingest adapter — import flow 3 (locked 2026-07-15).
 *
 * A `.docx` is a ZIP whose main part is `word/document.xml` (OOXML). This
 * adapter inflates the archive (fflate), walks the `w:p` paragraphs in
 * document order, surfaces Heading1/2/3 + Title paragraph styles as
 * `#`-style heading lines, and then reuses the single-file division pipeline
 * (`detectDivisions`) so a single .docx with heading chapters yields one
 * `ManuscriptScene` per division — exactly mirroring `ingestSingleFile`.
 *
 * Deterministic and Obsidian-free (pure) so it is fully unit-testable.
 *
 * Error contract: `ingestDocxFile` / `extractDocxText` THROW a
 * `DocxParseError` with a clear message when the buffer is not a valid ZIP
 * or the archive has no `word/document.xml`. Callers surface the message in
 * a Notice / blocked state — no silent empty-model fallback.
 */

import { unzipSync, strFromU8 } from 'fflate';
import type { ManuscriptModel, ManuscriptScene } from './manuscriptModel';
import { detectDivisions } from './singleFileAdapter';

/** Thrown when the given bytes are not a readable .docx (bad ZIP / missing document.xml). */
export class DocxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxParseError';
  }
}

// --- ZIP layer --------------------------------------------------------------

const DOCUMENT_XML = 'word/document.xml';

/** Inflate the archive and return the raw `word/document.xml` markup. */
export function extractDocumentXml(data: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new DocxParseError(`Not a valid .docx file (could not read ZIP archive: ${detail}).`);
  }
  // Standard location first; some producers nest the package under a prefix.
  const key =
    DOCUMENT_XML in entries
      ? DOCUMENT_XML
      : Object.keys(entries).find((name) => name.endsWith('/' + DOCUMENT_XML));
  if (!key) {
    throw new DocxParseError('Not a valid .docx file (no word/document.xml inside the archive).');
  }
  return strFromU8(entries[key]);
}

// --- OOXML → plain text -----------------------------------------------------

/** The five XML named entities plus numeric character references. */
const XML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Match one paragraph: self-closing `<w:p/>` or `<w:p …>…</w:p>`. */
const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
/** Paragraph properties block (style, outline level, tab-stop definitions). */
const PPR_RE = /<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/;
/** In-order run content: literal text, line breaks, and tab characters. */
const RUN_TOKEN_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:br|cr)\s*\/?>|<w:tab\s*\/?>/g;

/** Heading level 1-3 from the paragraph's style / outline level, or null for body text. */
function headingLevel(pPr: string): number | null {
  const style = pPr.match(/<w:pStyle\s[^>]*w:val="([^"]+)"/)?.[1] ?? null;
  if (style !== null) {
    if (/^Title$/i.test(style)) return 1;
    const heading = style.match(/^Heading\s?([1-9])$/i);
    if (heading) return Math.min(Number(heading[1]), 3);
  }
  // Localized style names still carry the outline level (0-based).
  const outline = pPr.match(/<w:outlineLvl\s[^>]*w:val="(\d+)"/)?.[1];
  if (outline !== undefined) return Math.min(Number(outline) + 1, 3);
  return null;
}

/** One paragraph's inner markup → plain text (entities decoded, br/tab handled). */
function paragraphText(inner: string): string {
  // Drop the properties block first — `<w:tab w:val=…/>` inside `<w:tabs>` is a
  // tab-stop DEFINITION, not a tab character, and must not reach the token scan.
  const body = inner.replace(PPR_RE, '');
  let out = '';
  let m: RegExpExecArray | null;
  RUN_TOKEN_RE.lastIndex = 0;
  while ((m = RUN_TOKEN_RE.exec(body)) !== null) {
    if (m[1] !== undefined) {
      out += decodeXmlEntities(m[1]);
    } else if (/^<w:tab/.test(m[0])) {
      out += '\t';
    } else {
      out += '\n';
    }
  }
  return out;
}

/**
 * Convert `word/document.xml` markup to paragraph-preserving plain text.
 * Heading-styled paragraphs become `#`/`##`/`###` lines so the single-file
 * division pipeline can split on them.
 */
export function documentXmlToText(xml: string): string {
  const paragraphs: string[] = [];
  let m: RegExpExecArray | null;
  PARAGRAPH_RE.lastIndex = 0;
  while ((m = PARAGRAPH_RE.exec(xml)) !== null) {
    const inner = m[1];
    if (inner === undefined) continue; // self-closing <w:p/> — empty paragraph
    const text = paragraphText(inner).trim();
    if (text.length === 0) continue;
    const level = headingLevel(inner.match(PPR_RE)?.[0] ?? '');
    paragraphs.push(level === null ? text : `${'#'.repeat(level)} ${text}`);
  }
  return paragraphs.join('\n\n');
}

/** Full extraction: .docx bytes → paragraph-preserving plain text with heading lines. */
export function extractDocxText(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return documentXmlToText(extractDocumentXml(bytes));
}

// --- Model assembly ---------------------------------------------------------

/**
 * Ingest one `.docx` manuscript into a Manuscript Model (one scene per
 * detected division), mirroring `ingestSingleFile`. Throws `DocxParseError`
 * on a corrupt or non-docx buffer.
 */
export function ingestDocxFile(fileName: string, data: ArrayBuffer | Uint8Array): ManuscriptModel {
  const text = extractDocxText(data);
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
    sourceKind: 'docx',
    chapters: [{ title: null, scenes }],
    customFields: [],
  };
}
