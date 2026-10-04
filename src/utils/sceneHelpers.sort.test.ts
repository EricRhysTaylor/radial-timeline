import { describe, it, expect } from 'vitest';
import { sortScenesChronologically, buildChronologicalPlacements, sceneKey } from './sceneHelpers';
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

  it('keeps a subplot follower with an anchor outside that subplot', () => {
    const manuscript = [scene('01 A', '2026-01-20'), scene('02 B'), scene('03 C', '2026-01-10')];
    expect(titles(sortScenesChronologically(manuscript.slice(1), manuscript))).toEqual(['03 C', '02 B']);
    expect(manuscript[1].when).toBeUndefined();
  });

  it('never borrows another book’s anchor when chapter numbers overlap', () => {
    const a = { ...scene('01 A', '2026-01-20'), path: 'A/1.md', bookIndex: 0, bookId: 'A' };
    const follower = { ...scene('02 A follower'), path: 'A/2.md', bookIndex: 0, bookId: 'A' };
    const b = { ...scene('01 B', '2026-01-10'), path: 'B/1.md', bookIndex: 1, bookId: 'B' };
    const manuscript = [follower, b, a];
    expect(sortScenesChronologically(manuscript).map(s => s.path)).toEqual(['B/1.md', 'A/1.md', 'A/2.md']);
    expect(buildChronologicalPlacements(manuscript).get(sceneKey(follower))?.anchor).toBe(a);
  });

  it('keeps opening undated scenes beside their first narrative anchor after a flashback reorders', () => {
    const manuscript = [scene('01 Opening'), scene('02 Present', '2026-01-20'), scene('03 Past', '2020-01-10')];
    expect(titles(sortScenesChronologically(manuscript))).toEqual(['03 Past', '01 Opening', '02 Present']);
    expect(buildChronologicalPlacements(manuscript).get(sceneKey(manuscript[0]))?.beforeAnchor).toBe(true);
  });

  it('keeps groups together when books share the same anchor date', () => {
    const manuscript = [
      { ...scene('01 A', '2026-01-10'), path: 'A/1.md', bookIndex: 0 },
      { ...scene('02 A follower'), path: 'A/2.md', bookIndex: 0 },
      { ...scene('01 B', '2026-01-10'), path: 'B/1.md', bookIndex: 1 },
      { ...scene('02 B follower'), path: 'B/2.md', bookIndex: 1 },
    ];
    expect(sortScenesChronologically(manuscript).map(s => s.path)).toEqual(['A/1.md', 'A/2.md', 'B/1.md', 'B/2.md']);
  });

  it('does not use a dated beat as a scene’s narrative anchor', () => {
    const manuscript = [scene('01 A', '2026-01-20'), { ...scene('01.01 Beat', '2026-01-10'), itemType: 'Beat' }, scene('02 B')];
    expect(buildChronologicalPlacements(manuscript).get(sceneKey(manuscript[2]))?.anchor).toBe(manuscript[0]);
  });

  it('preserves all date fields and the input order', () => {
    const manuscript = [scene('03 Dated', '2026-01-10'), scene('01 Opening'), scene('02 Invalid', 'invalid')];
    const before = JSON.stringify(manuscript);
    sortScenesChronologically(manuscript);
    expect(JSON.stringify(manuscript)).toBe(before);
  });
});
