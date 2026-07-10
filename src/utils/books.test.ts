import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings } from '../types/settings';
import { getActiveBookExportContext } from './exportContext';
import {
  getBookSequenceNumber,
  getSagaBooks,
  getSequencedBooks,
  getTimelineScope,
  getTimelineScopeTitle,
  isSagaScopeAvailable,
  normalizeBookProfile,
  shouldSeedBookProfileFromLegacySettings
} from './books';
import type RadialTimelinePlugin from '../main';

describe('getActiveBookExportContext', () => {
  it('resolves active profile and derives fileStem', () => {
    const settings: RadialTimelineSettings = {
      ...DEFAULT_SETTINGS,
      sourcePath: 'Legacy/Path',
      books: [
        { id: 'b1', title: 'Book One', sourceFolder: 'Books/One', fileStem: 'OneStem' },
        { id: 'b2', title: 'Second Book', sourceFolder: 'Books/Two' }
      ],
      activeBookId: 'b2'
    };

    const plugin = { settings } as RadialTimelinePlugin;
    const ctx = getActiveBookExportContext(plugin);
    expect(ctx).toEqual({
      sourceFolder: 'Books/Two',
      title: 'Second Book',
      fileStem: 'Second-Book'
    });

    settings.activeBookId = 'b1';
    const ctx2 = getActiveBookExportContext(plugin);
    expect(ctx2).toEqual({
      sourceFolder: 'Books/One',
      title: 'Book One',
      fileStem: 'OneStem'
    });
  });

  it('falls back cleanly when no books are configured', () => {
    const settings: RadialTimelineSettings = {
      ...DEFAULT_SETTINGS,
      books: [],
      activeBookId: undefined,
      sourcePath: ''
    };

    const plugin = { settings } as RadialTimelinePlugin;
    const ctx = getActiveBookExportContext(plugin);
    expect(ctx).toEqual({
      sourceFolder: '',
      title: 'Untitled Manuscript',
      fileStem: 'Untitled-Manuscript'
    });
  });
});

describe('shouldSeedBookProfileFromLegacySettings', () => {
  it('returns false for a clean empty settings state', () => {
    expect(shouldSeedBookProfileFromLegacySettings({
      sourcePath: '',
      legacyTitle: ''
    })).toBe(false);
  });

  it('returns true when legacy data exists', () => {
    expect(shouldSeedBookProfileFromLegacySettings({
      sourcePath: 'Books/One',
      legacyTitle: ''
    })).toBe(true);

    expect(shouldSeedBookProfileFromLegacySettings({
      sourcePath: '',
      legacyTitle: 'Legacy Title'
    })).toBe(true);
  });
});

describe('book sequencing', () => {
  it('normalizes optional project metadata without leaking blank values', () => {
    const book = normalizeBookProfile({
      id: 'b1',
      title: 'Private Title',
      sourceFolder: 'Books/Private',
      genre: ' sci-fi ',
      projectStage: ' first book ',
      publicLabel: ' Public Project ',
      publicDescription: '  Drafting the sequel.  '
    });

    expect(book.genre).toBe('sci-fi');
    expect(book.projectStage).toBe('first book');
    expect(book.publicLabel).toBe('Public Project');
    expect(book.publicDescription).toBe('Drafting the sequel.');

    const blank = normalizeBookProfile({
      id: 'b2',
      title: 'Blank',
      sourceFolder: 'Books/Blank',
      genre: ' ',
      projectStage: '',
      publicLabel: ' ',
      publicDescription: ''
    });
    expect(blank.genre).toBeUndefined();
    expect(blank.projectStage).toBeUndefined();
    expect(blank.publicLabel).toBeUndefined();
    expect(blank.publicDescription).toBeUndefined();
  });

  // Regression: normalizeBookProfile once rebuilt the profile without
  // stageTargetDates, wiping every publishing target date on settings load.
  it('carries stageTargetDates through normalization, dropping invalid entries', () => {
    const book = normalizeBookProfile({
      id: 'b1',
      title: 'Dated',
      sourceFolder: 'Books/Dated',
      stageTargetDates: { Zero: '2026-08-15', Author: '2026-09-30', House: 'garbage', Press: undefined }
    });
    expect(book.stageTargetDates).toEqual({ Zero: '2026-08-15', Author: '2026-09-30' });

    const none = normalizeBookProfile({ id: 'b2', title: 'Undated', sourceFolder: 'Books/Undated' });
    expect(none.stageTargetDates).toBeUndefined();
  });

  it('derives sequence identity from row order, not title text', () => {
    const books = [
      { id: 'b1', title: 'Book 1 Shail + Trisan', sourceFolder: 'Books/Shail-Trisan' },
      { id: 'b2', title: 'Book 9 Prequel - The General', sourceFolder: 'Books/The-General' },
      { id: 'b3', title: 'Book 2 Saturn & Jupiter', sourceFolder: 'Books/Saturn-Jupiter' }
    ];

    expect(getSequencedBooks(books).map(entry => `${entry.sequenceNumber}:${entry.book.id}`)).toEqual([
      '1:b1',
      '2:b2',
      '3:b3'
    ]);

    expect(getBookSequenceNumber({ books }, 'b2')).toBe(2);
    expect(getBookSequenceNumber({ books }, 'b3')).toBe(3);
  });
});

describe('saga timeline scope helpers', () => {
  it('keeps saga as a scope and preserves Book Manager order', () => {
    const settings: RadialTimelineSettings = {
      ...DEFAULT_SETTINGS,
      timelineScope: 'saga',
      activeBookId: 'b2',
      books: [
        { id: 'b1', title: 'Shail + Trisan', sourceFolder: 'Books/Shail-Trisan' },
        { id: 'b2', title: 'The General', sourceFolder: 'Books/The-General' },
        { id: 'b3', title: 'Book 2', sourceFolder: 'Books/Book-2' }
      ]
    };

    expect(isSagaScopeAvailable(settings)).toBe(true);
    expect(getTimelineScope(settings)).toBe('saga');
    expect(getTimelineScopeTitle(settings)).toBe('Saga');
    expect(getSagaBooks(settings).map(book => book.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('ignores books without a usable source folder', () => {
    const settings: RadialTimelineSettings = {
      ...DEFAULT_SETTINGS,
      timelineScope: 'saga',
      books: [
        { id: 'b1', title: 'One', sourceFolder: 'Books/One' },
        { id: 'b2', title: 'No Folder', sourceFolder: '   ' },
        { id: 'b3', title: 'Three', sourceFolder: 'Books/Three' }
      ]
    };

    expect(getSagaBooks(settings).map(book => book.id)).toEqual(['b1', 'b3']);
    expect(isSagaScopeAvailable(settings)).toBe(true);
  });

  it('falls back to book scope when fewer than two usable books exist', () => {
    const settings: RadialTimelineSettings = {
      ...DEFAULT_SETTINGS,
      timelineScope: 'saga',
      activeBookId: 'b1',
      books: [
        { id: 'b1', title: 'Only Book', sourceFolder: 'Books/Only' }
      ]
    };

    expect(isSagaScopeAvailable(settings)).toBe(false);
    expect(getTimelineScope(settings)).toBe('book');
    expect(getTimelineScopeTitle(settings)).toBe('Only Book');
  });
});
