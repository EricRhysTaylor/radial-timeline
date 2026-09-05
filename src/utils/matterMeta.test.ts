import { describe, expect, it } from 'vitest';
import { parseMatterMetaFromFrontmatter } from './matterMeta';

describe('matterMeta parser', () => {
  it('parses canonical flat frontmatter fields and defaults BodyMode to plain', () => {
    const parsed = parseMatterMetaFromFrontmatter(
      {
        Class: 'Frontmatter',
        Role: 'title-page',
        UseBookMeta: true
      }
    );

    expect(parsed).toEqual({
      side: 'front',
      role: 'title-page',
      usesBookMeta: true,
      bodyMode: 'plain'
    });
  });

  it('uses back side when Class is Backmatter', () => {
    const parsed = parseMatterMetaFromFrontmatter(
      { Class: 'Backmatter', Role: 'acknowledgments' }
    );

    expect(parsed?.side).toBe('back');
    expect(parsed?.role).toBe('acknowledgments');
  });

  it('resolves side strictly from Class and ignores any Side field', () => {
    const parsed = parseMatterMetaFromFrontmatter(
      { Class: 'Frontmatter', Side: 'back', Role: 'dedication' }
    );

    expect(parsed?.side).toBe('front');
  });

  it('does not honor nested Matter block keys', () => {
    const parsed = parseMatterMetaFromFrontmatter(
      {
        Class: 'Frontmatter',
        Role: 'epigraph',
        Matter: { role: 'copyright' }
      }
    );

    expect(parsed).toEqual({
      side: 'front',
      role: 'epigraph',
      bodyMode: 'plain'
    });
  });

  it('returns null for Class: Matter', () => {
    const parsed = parseMatterMetaFromFrontmatter(
      { Class: 'Matter', Role: 'copyright' }
    );
    expect(parsed).toBeNull();
  });

  it('honors BodyMode: latex but rejects unknown values, defaulting to plain', () => {
    expect(parseMatterMetaFromFrontmatter(
      { Class: 'Frontmatter', BodyMode: 'latex' }
    )?.bodyMode).toBe('latex');

    expect(parseMatterMetaFromFrontmatter(
      { Class: 'Frontmatter', BodyMode: 'auto' }
    )?.bodyMode).toBe('plain');

    expect(parseMatterMetaFromFrontmatter(
      { Class: 'Frontmatter', BodyMode: 'whatever' }
    )?.bodyMode).toBe('plain');
  });

  it('does not honor legacy aliases (UsesBookMeta, MatterBodyMode, Mode)', () => {
    const parsed = parseMatterMetaFromFrontmatter(
      {
        Class: 'Frontmatter',
        UsesBookMeta: true,
        MatterBodyMode: 'latex',
        Mode: 'latex'
      }
    );

    expect(parsed).toEqual({
      side: 'front',
      bodyMode: 'plain'
    });
  });

  it('returns null for non-matter classes', () => {
    const parsed = parseMatterMetaFromFrontmatter(
      { Class: 'Scene' }
    );

    expect(parsed).toBeNull();
  });

  it('records only an explicit Enabled:false; absence/true leave it unset (no migration)', () => {
    expect(parseMatterMetaFromFrontmatter({ Class: 'Frontmatter', Enabled: false }))
      .toEqual({ side: 'front', bodyMode: 'plain', enabled: false });
    expect(parseMatterMetaFromFrontmatter({ Class: 'Frontmatter', Enabled: 'no' }))
      .toEqual({ side: 'front', bodyMode: 'plain', enabled: false });
    // true / absent → enabled key omitted (undefined === enabled everywhere).
    expect(parseMatterMetaFromFrontmatter({ Class: 'Frontmatter', Enabled: true }))
      .toEqual({ side: 'front', bodyMode: 'plain' });
    expect(parseMatterMetaFromFrontmatter({ Class: 'Frontmatter' }))
      .toEqual({ side: 'front', bodyMode: 'plain' });
  });
});
