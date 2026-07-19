import { describe, it, expect } from 'vitest';
import { sortScenesChronologically } from './sceneHelpers';
import type { TimelineItem } from '../types';

/** Minimal TimelineItem for sort tests: numbered title (manuscript order) + optional When. */
function scene(title: string, when?: string): TimelineItem {
  return { title, when } as unknown as TimelineItem; // SAFE: sort reads only title/when
}

const titles = (items: TimelineItem[]): string[] => items.map((item) => item.title ?? '');

describe('sortScenesChronologically', () => {
  it('sorts a fully dated book by When (manuscript order on ties)', () => {
    const out = sortScenesChronologically([
      scene('03 C', '1184-06-15'),
      scene('01 A', '1184-06-01'),
      scene('02 B', '1184-06-01'),
    ]);
    expect(titles(out)).toEqual(['01 A', '02 B', '03 C']);
  });

  it('keeps a fully undated book in manuscript order', () => {
    const out = sortScenesChronologically([scene('02 B'), scene('03 C'), scene('01 A')]);
    expect(titles(out)).toEqual(['01 A', '02 B', '03 C']);
  });

  it('interleaves undated scenes beside their preceding dated anchor (no front pile-up)', () => {
    // Manuscript: 01(dated) 02 03 04(dated) 05 — sparse dates, the onboarded-book case.
    const out = sortScenesChronologically([
      scene('01 A', '1184-06-01'),
      scene('02 B'),
      scene('03 C'),
      scene('04 D', '1184-06-10'),
      scene('05 E'),
    ]);
    expect(titles(out)).toEqual(['01 A', '02 B', '03 C', '04 D', '05 E']);
  });

  it('reorders anchor GROUPS when dates disagree with manuscript order, followers riding along', () => {
    const out = sortScenesChronologically([
      scene('01 A', '1184-06-10'),
      scene('02 B'), // follows A
      scene('03 C', '1184-06-01'),
      scene('04 D'), // follows C
    ]);
    expect(titles(out)).toEqual(['03 C', '04 D', '01 A', '02 B']);
  });

  it('leads with undated scenes that precede the first dated scene, in manuscript order', () => {
    const out = sortScenesChronologically([
      scene('01 A'),
      scene('02 B'),
      scene('03 C', '1184-06-01'),
    ]);
    expect(titles(out)).toEqual(['01 A', '02 B', '03 C']);
  });

  it('treats an unparseable When as undated (inherits its anchor)', () => {
    const out = sortScenesChronologically([
      scene('01 A', '1184-06-01'),
      scene('02 B', 'not a date'),
      scene('03 C', '1184-06-02'),
    ]);
    expect(titles(out)).toEqual(['01 A', '02 B', '03 C']);
  });
});
