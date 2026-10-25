import { describe, expect, it } from 'vitest';
import { getBottomSynopsisSpace, getSynopsisRowOffsets, type SynopsisRowStyle } from './SynopsisLayout';

const regular: SynopsisRowStyle = { pulse: false, synopsis: false, gossamer: false };
const synopsis: SynopsisRowStyle = { ...regular, synopsis: true };
const pulse: SynopsisRowStyle = { ...regular, pulse: true };
const gossamer: SynopsisRowStyle = { ...regular, gossamer: true };

describe('synopsis baseline spacing', () => {
  it('preserves the established title, synopsis, Gossamer and Pulse transitions', () => {
    expect(getSynopsisRowOffsets([regular, synopsis, synopsis, gossamer, pulse, pulse, regular, regular], 1, 18))
      .toEqual([0, 32, 54, 100, 118, 136, 154, 176]);
  });

  it('keeps wrapped footer rows in the spacing calculation', () => {
    expect(getSynopsisRowOffsets([regular, synopsis, regular, regular, regular, regular], 1, 18))
      .toEqual([0, 32, 54, 76, 98, 120]);
  });

  it('scales every row without changing the top-quadrant spacing rules', () => {
    const rows = [regular, synopsis, gossamer, pulse, regular];
    const normal = getSynopsisRowOffsets(rows, 1, 18);
    getSynopsisRowOffsets(rows, 1.3, 23.4).forEach((offset, index) => {
      expect(offset).toBeCloseTo(normal[index] * 1.3);
    });
  });
});

describe('bottom synopsis footer reservation', () => {
  it.each([1, 1.3, 1.4])('reserves a complete padded chord at font scale %s', scale => {
    for (const radius of [650, 750, 778]) {
      const { footerBottom, footerWidth } = getBottomSynopsisSpace(radius, scale);
      expect(footerBottom).toBeLessThan(radius);
      expect(footerWidth).toBeGreaterThan(0);
      // A full-width footer and its white-strip padding fit on both sides of x=0.
      expect(Math.hypot(footerWidth / 2 + 3 * scale, footerBottom)).toBeLessThan(radius);
    }
  });
});
