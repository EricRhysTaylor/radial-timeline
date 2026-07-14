import { describe, it, expect } from 'vitest';
import { buildEntityNoteContent, entityFolderFor } from './entityNotes';

describe('buildEntityNoteContent', () => {
  it('builds a character note with Class, Book, and Scene Count filled', () => {
    const content = buildEntityNoteContent('character', { book: 'Odyssey', sceneCount: 3 });
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('Class: Character');
    expect(content).toContain('Book: Odyssey');
    expect(content).toContain('Scene Count: 3');
    // The section scaffold is present but intentionally blank.
    for (const heading of ['# Description', '## Motivations', '##### External (Wants)', '# Change', '# Summary']) {
      expect(content).toContain(heading);
    }
  });

  it('builds a place note with its own scaffold', () => {
    const content = buildEntityNoteContent('place', { book: 'Odyssey', sceneCount: 2 });
    expect(content).toContain('Class: Place');
    expect(content).toContain('Scene Count: 2');
    for (const heading of ['## Description', '##### Role in Story', '# History', '# Summary']) {
      expect(content).toContain(heading);
    }
    expect(content).not.toContain('Motivations');
  });

  it('handles a blank book and clamps a negative scene count', () => {
    const content = buildEntityNoteContent('character', { book: '  ', sceneCount: -4 });
    expect(content).toContain('Book: \n');
    expect(content).toContain('Scene Count: 0');
  });
});

describe('entityFolderFor', () => {
  it('places entity folders as siblings of the book folder', () => {
    expect(entityFolderFor('Books/Odyssey RT', 'character')).toBe('Books/Character');
    expect(entityFolderFor('Books/Odyssey RT', 'place')).toBe('Books/Place');
  });

  it('uses vault root for a root-level book folder', () => {
    expect(entityFolderFor('Book Odyssey RT', 'character')).toBe('Character');
    expect(entityFolderFor('Book Odyssey RT', 'place')).toBe('Place');
  });
});
