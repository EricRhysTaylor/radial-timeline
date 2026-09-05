import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  DocxParseError,
  extractDocumentXml,
  documentXmlToText,
  extractDocxText,
  ingestDocxFile,
} from './docxAdapter';

// --- Fixture builders -------------------------------------------------------

/** One OOXML paragraph: optional heading style + one run per text segment. */
function para(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

/** Wrap paragraphs in a minimal but well-formed word/document.xml. */
function documentXml(...paragraphs: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
  );
}

/** Zip a document.xml (plus the standard sibling parts) into .docx bytes. */
function docxBytes(xml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml':
      strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships/>'),
    'word/document.xml': strToU8(xml),
  });
}

const TWO_CHAPTER_DOCX = docxBytes(
  documentXml(
    para('My Novel', 'Title'),
    para('Chapter One', 'Heading1'),
    para('It was a dark and stormy night.'),
    para('The rain fell in torrents.'),
    para('Chapter Two', 'Heading1'),
    para('Morning came &amp; the storm had passed.')
  )
);

// --- ZIP layer --------------------------------------------------------------

describe('extractDocumentXml', () => {
  it('pulls word/document.xml out of the archive', () => {
    const xml = extractDocumentXml(docxBytes(documentXml(para('Hello.'))));
    expect(xml).toContain('<w:document');
    expect(xml).toContain('Hello.');
  });

  it('throws DocxParseError on a non-ZIP buffer', () => {
    const junk = strToU8('This is just prose, not a ZIP archive at all.');
    expect(() => extractDocumentXml(junk)).toThrow(DocxParseError);
    expect(() => extractDocumentXml(junk)).toThrow(/not a valid \.docx/i);
  });

  it('throws DocxParseError when the ZIP has no word/document.xml', () => {
    const zipButNotDocx = zipSync({ 'readme.txt': strToU8('hi') });
    expect(() => extractDocumentXml(zipButNotDocx)).toThrow(/word\/document\.xml/);
  });
});

// --- OOXML → text -----------------------------------------------------------

describe('documentXmlToText', () => {
  it('extracts paragraphs in order, separated by blank lines', () => {
    const text = documentXmlToText(documentXml(para('First paragraph.'), para('Second paragraph.')));
    expect(text).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('maps Heading1/2/3 and Title styles to #-style heading lines', () => {
    const text = documentXmlToText(
      documentXml(
        para('The Book', 'Title'),
        para('Part One', 'Heading1'),
        para('Scene A', 'Heading2'),
        para('Beat', 'Heading3'),
        para('Prose line.')
      )
    );
    expect(text.split('\n\n')).toEqual([
      '# The Book',
      '# Part One',
      '## Scene A',
      '### Beat',
      'Prose line.',
    ]);
  });

  it('falls back to outlineLvl for localized heading style names', () => {
    const xml = documentXml(
      '<w:p><w:pPr><w:pStyle w:val="berschrift1"/><w:outlineLvl w:val="0"/></w:pPr>' +
        '<w:r><w:t>Kapitel Eins</w:t></w:r></w:p>',
      para('Prosa.')
    );
    expect(documentXmlToText(xml)).toBe('# Kapitel Eins\n\nProsa.');
  });

  it('joins multiple runs, honors w:br and w:tab, and skips empty paragraphs', () => {
    const xml = documentXml(
      '<w:p><w:r><w:t xml:space="preserve">He said</w:t></w:r>' +
        '<w:r><w:br/><w:t xml:space="preserve">nothing.</w:t></w:r></w:p>',
      '<w:p/>',
      '<w:p><w:r><w:tab/><w:t>Indented.</w:t></w:r></w:p>'
    );
    expect(documentXmlToText(xml)).toBe('He said\nnothing.\n\nIndented.');
  });

  it('does not emit tab characters for tab-stop definitions in w:pPr', () => {
    const xml = documentXml(
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
        '<w:r><w:t>No leading tab.</w:t></w:r></w:p>'
    );
    expect(documentXmlToText(xml)).toBe('No leading tab.');
  });

  it('decodes XML named and numeric entities', () => {
    const xml = documentXml(para('Fish &amp; chips &#8212; &#x2018;grand&#x2019; &lt;really&gt;.'));
    expect(documentXmlToText(xml)).toBe('Fish & chips — ‘grand’ <really>.');
  });
});

// --- End-to-end -------------------------------------------------------------

describe('extractDocxText', () => {
  it('accepts an ArrayBuffer and produces heading-line text', () => {
    const bytes = TWO_CHAPTER_DOCX;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const text = extractDocxText(buffer);
    expect(text).toContain('# Chapter One');
    expect(text).toContain('It was a dark and stormy night.');
  });
});

describe('ingestDocxFile', () => {
  it('splits heading chapters into one scene per division', () => {
    const model = ingestDocxFile('novel.docx', TWO_CHAPTER_DOCX);
    expect(model.sourceKind).toBe('docx');
    expect(model.customFields).toEqual([]);
    const scenes = model.chapters[0].scenes;
    // The Title page line has no body of its own; divisions keep last-with-body.
    expect(scenes.map((s) => s.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(scenes.map((s) => s.sourceRef)).toEqual(['novel.docx#1', 'novel.docx#2']);
    expect(scenes[0].rawText).toContain('It was a dark and stormy night.');
    expect(scenes[0].rawText).toContain('The rain fell in torrents.');
    expect(scenes[0].rawText).not.toContain('Chapter Two');
    expect(scenes[1].rawText).toBe('Morning came & the storm had passed.');
    expect(scenes.every((s) => !s.alreadyOnboarded)).toBe(true);
    expect(scenes.every((s) => s.knownSynopsis === null)).toBe(true);
  });

  it('yields a single undivided scene when the document has no headings', () => {
    const model = ingestDocxFile(
      'flat.docx',
      docxBytes(documentXml(para('Only prose here.'), para('More prose.')))
    );
    const scenes = model.chapters[0].scenes;
    expect(scenes).toHaveLength(1);
    expect(scenes[0].title).toBeNull();
    expect(scenes[0].rawText).toBe('Only prose here.\n\nMore prose.');
    expect(scenes[0].sourceRef).toBe('flat.docx#1');
  });

  it('propagates DocxParseError for a corrupt buffer', () => {
    expect(() => ingestDocxFile('bad.docx', strToU8('not a docx'))).toThrow(DocxParseError);
  });
});
