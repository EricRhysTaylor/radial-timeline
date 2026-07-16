import { describe, it, expect } from 'vitest';
import {
  extractPlainText,
  trimGutenbergBoilerplate,
  htmlToText,
  isDivisionHeading,
  normalizeHeading,
  detectDivisions,
  ingestSingleFile,
} from './singleFileAdapter';

describe('isDivisionHeading', () => {
  it('matches standalone book/chapter headings, not prose', () => {
    expect(isDivisionHeading('BOOK I.')).toBe(true);
    expect(isDivisionHeading('CHAPTER 12')).toBe(true);
    expect(isDivisionHeading('Chapter One')).toBe(true);
    expect(isDivisionHeading('## Part 3')).toBe(true);
    expect(isDivisionHeading('the removal to Book i., 1-79, was the only')).toBe(false);
    expect(isDivisionHeading('Tell me, O Muse, of that ingenious hero.')).toBe(false);
  });
});

describe('normalizeHeading', () => {
  it('title-cases but keeps Roman numerals uppercase', () => {
    expect(normalizeHeading('BOOK IV.')).toBe('Book IV');
    expect(normalizeHeading('CHAPTER ONE')).toBe('Chapter One');
    expect(normalizeHeading('### Part 2')).toBe('Part 2');
  });
});

describe('detectDivisions', () => {
  it('splits on headings and drops pre-first-heading front matter', () => {
    const text = [
      'Translator preface and table of contents.',
      '',
      'BOOK I.',
      '',
      'THE GODS IN COUNCIL.',
      '',
      'Tell me, O Muse.',
      '',
      'BOOK II.',
      '',
      'Now when the child of morning appeared.',
    ].join('\n');
    const divisions = detectDivisions(text);
    expect(divisions.map((d) => d.title)).toEqual(['Book I', 'Book II']);
    expect(divisions[0].body).toContain('THE GODS IN COUNCIL.');
    expect(divisions[0].body).toContain('Tell me, O Muse.');
    expect(divisions[0].body).not.toContain('Translator preface');
    expect(divisions[1].body).toBe('Now when the child of morning appeared.');
  });

  it('returns one undivided division when there are no headings', () => {
    const divisions = detectDivisions('Just one continuous run of prose.\n\nMore prose.');
    expect(divisions).toHaveLength(1);
    expect(divisions[0].title).toBeNull();
    expect(divisions[0].body).toContain('one continuous run');
  });
});

describe('htmlToText', () => {
  it('strips tags, decodes entities, and preserves paragraphs', () => {
    const html = '<p>The gods&mdash;in council.</p><p>Tell me, O Muse&rsquo;s son.</p>';
    const text = htmlToText(html);
    expect(text).toContain('The gods—in council.');
    expect(text).toContain('Tell me, O Muse’s son.');
    expect(text.split(/\n{2,}/).length).toBe(2);
  });
});

describe('trimGutenbergBoilerplate', () => {
  it('keeps only the text between the START and END markers', () => {
    const raw = 'LICENSE HEADER\n*** START OF THE PROJECT GUTENBERG EBOOK THE ODYSSEY ***\nReal text.\n*** END OF THE PROJECT GUTENBERG EBOOK THE ODYSSEY ***\nLICENSE FOOTER';
    expect(trimGutenbergBoilerplate(raw)).toBe('Real text.');
  });
});

describe('extractPlainText + ingestSingleFile', () => {
  it('routes .html through the stripper and .txt through unchanged', () => {
    expect(extractPlainText('book.txt', 'Plain <b>not a tag here')).toBe('Plain <b>not a tag here');
    expect(extractPlainText('book.html', '<p>Hi &amp; bye</p>')).toContain('Hi & bye');
  });

  it('builds a model with one scene per division', () => {
    const model = ingestSingleFile('odyssey.txt', 'BOOK I.\n\nArg.\n\nProse.\n\nBOOK II.\n\nMore.');
    const scenes = model.chapters[0].scenes;
    expect(scenes.map((s) => s.title)).toEqual(['Book I', 'Book II']);
    expect(scenes.map((s) => s.sourceRef)).toEqual(['odyssey.txt#1', 'odyssey.txt#2']);
    expect(scenes[0].rawText).toContain('Arg.');
  });
});
