export interface SynopsisRowStyle {
  pulse: boolean;
  synopsis: boolean;
  gossamer: boolean;
}

/** The established baseline spacing, shared by wrapping, fitting and final placement. */
export function getSynopsisRowOffsets(rows: SynopsisRowStyle[], fontScale: number, pulseLineHeight: number): number[] {
  let offset = 0;
  return rows.map((row, index) => {
    if (index === 1) offset += 32 * fontScale;
    else if (index > 1) {
      const previous = rows[index - 1];
      if (row.gossamer && previous.synopsis) offset += 46 * fontScale;
      else if (row.pulse || previous.pulse) offset += pulseLineHeight;
      else offset += 22 * fontScale;
    }
    return offset;
  });
}

/** Reserve a real chord for the full footer, rather than wrapping into the bottom tip. */
export function getBottomSynopsisSpace(radius: number, fontScale: number): { footerBottom: number; footerWidth: number } {
  const footerBottom = radius - 48 * fontScale;
  const footerWidth = 2 * Math.sqrt(radius ** 2 - footerBottom ** 2) - 12 * fontScale;
  return { footerBottom, footerWidth };
}
