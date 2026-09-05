/*
 * Range Validation Utilities for Gossamer Beats
 */

/**
 * Parse a Range field from beat note frontmatter
 * Examples: "0-20", "50", "71-90"
 * Returns { min, max } or null if invalid
 */
export function parseRange(rangeStr: string | undefined): { min: number; max: number } | null {
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  
  const cleaned = rangeStr.trim();
  
  // Single number: "50" → { min: 50, max: 50 }
  if (/^\d+$/.test(cleaned)) {
    const value = parseInt(cleaned, 10);
    if (!isNaN(value) && value >= 0 && value <= 100) {
      return { min: value, max: value };
    }
    return null;
  }
  
  // Range: "0-20" or "71-90"
  const match = cleaned.match(/^(\d+)\s*-\s*(\d+)$/);
  if (match) {
    const min = parseInt(match[1], 10);
    const max = parseInt(match[2], 10);
    
    if (!isNaN(min) && !isNaN(max) && min >= 0 && max <= 100 && min <= max) {
      return { min, max };
    }
  }
  
  return null;
}

/**
 * Check if a score is within the ideal range
 */
export function isScoreInRange(score: number, range: { min: number; max: number }): boolean {
  return score >= range.min && score <= range.max;
}
