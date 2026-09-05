import { describe, it, expect } from 'vitest';
import {
  ingestMarkdownFolder,
  isAlreadyOnboarded,
  stripFrontmatter,
  titleFromFileName,
  type MarkdownNote,
  type MarkdownSource,
} from './mdAdapter';

function sourceOf(notes: MarkdownNote[], toc: string | null = null): MarkdownSource {
  return {
    listNotes: async () => notes,
    readToc: async () => toc,
  };
}

function note(fileName: string, over: Partial<MarkdownNote> = {}): MarkdownNote {
  return {
    fileName,
    path: `Book/${fileName}`,
    content: 'plain prose',
    frontmatter: null,
    ...over,
  };
}

describe('isAlreadyOnboarded', () => {
  it('is true only when Class is Scene (case-insensitive value)', () => {
    expect(isAlreadyOnboarded({ Class: 'Scene' })).toBe(true);
    expect(isAlreadyOnboarded({ Class: 'scene' })).toBe(true);
    expect(isAlreadyOnboarded({ Class: 'Character' })).toBe(false);
    expect(isAlreadyOnboarded({})).toBe(false);
    expect(isAlreadyOnboarded(null)).toBe(false);
  });
});

describe('stripFrontmatter', () => {
  it('removes a leading YAML block and keeps the body', () => {
    const content = '---\nClass: Scene\nAct: 1\n---\nThe body starts here.';
    expect(stripFrontmatter(content)).toBe('The body starts here.');
  });

  it('returns content unchanged when there is no frontmatter', () => {
    expect(stripFrontmatter('No frontmatter at all.')).toBe('No frontmatter at all.');
  });
});

describe('titleFromFileName', () => {
  it('drops a leading number and the extension', () => {
    expect(titleFromFileName('01 Ithaca.md')).toBe('Ithaca');
    expect(titleFromFileName('12-The Cyclops.md')).toBe('The Cyclops');
    expect(titleFromFileName('Troy.md')).toBe('Troy');
  });
});

describe('ingestMarkdownFolder', () => {
  it('builds a single-chapter model in reading order', async () => {
    const notes = [
      note('02 Troy.md', { content: '---\nSomething: x\n---\nAt Troy.' }),
      note('01 Ithaca.md', { content: 'On Ithaca.', frontmatter: { Storyline: 'Homecoming' } }),
    ];
    const result = await ingestMarkdownFolder(sourceOf(notes), 'Book');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const scenes = result.model.chapters[0].scenes;
      expect(scenes.map((s) => s.sourceRef)).toEqual(['Book/01 Ithaca.md', 'Book/02 Troy.md']);
      expect(scenes[0].rawText).toBe('On Ithaca.');
      // Non-canonical frontmatter is carried; drives the custom-field list.
      expect(scenes[0].knownMetadata).toEqual({ Storyline: 'Homecoming' });
      expect(result.model.customFields).toContain('Storyline');
    }
  });

  it('flags an already-onboarded note without dropping it', async () => {
    const notes = [note('01 A.md', { frontmatter: { Class: 'Scene' } })];
    const result = await ingestMarkdownFolder(sourceOf(notes), 'Book');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.model.chapters[0].scenes[0].alreadyOnboarded).toBe(true);
    }
  });

  it('returns needs-order when files are unnumbered and there is no TOC', async () => {
    const notes = [note('Ithaca.md'), note('Troy.md')];
    const result = await ingestMarkdownFolder(sourceOf(notes), 'Book');
    expect(result.kind).toBe('needs-order');
  });

  it('excludes canonical Scene keys from carried metadata', async () => {
    const notes = [
      note('01 A.md', { frontmatter: { Act: 2, Synopsis: 'x', POV: 'first', Mood: 'tense' } }),
    ];
    const result = await ingestMarkdownFolder(sourceOf(notes), 'Book');
    if (result.kind === 'ok') {
      const meta = result.model.chapters[0].scenes[0].knownMetadata;
      expect(meta).toEqual({ Mood: 'tense' });
    }
  });
});
