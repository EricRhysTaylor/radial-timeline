/*
 * Import summary — the counts the import review shows before anything is
 * written: subplot rings with their scene counts, and the distinct characters
 * and places the scenes name. Pure: derived only from the scene proposals the
 * import will write, so the review can never disagree with the result.
 */

import type { SceneProposal } from './OnboardingService';

export interface ImportSummary {
  scenes: number;
  /** Subplots in order of first appearance, each with how many scenes it holds. */
  subplots: Array<{ name: string; scenes: number }>;
  /** Distinct character names (case-insensitive), in first-appearance spelling. */
  characters: string[];
  /** Distinct place names (case-insensitive), in first-appearance spelling. */
  places: string[];
}

function distinct(lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const name of lists.flat()) {
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
}

export function summarizeImport(proposals: SceneProposal[]): ImportSummary {
  const written = proposals.filter((proposal) => proposal.frontmatter);
  const subplots = new Map<string, number>();
  for (const proposal of written) {
    const value = proposal.frontmatter?.Subplot;
    for (const name of Array.isArray(value) ? value : []) {
      if (typeof name === 'string') subplots.set(name, (subplots.get(name) ?? 0) + 1); // SAFE: a subplot's first scene starts its tally at 0
    }
  }
  return {
    scenes: written.length,
    subplots: [...subplots].map(([name, scenes]) => ({ name, scenes })),
    characters: distinct(written.map((proposal) => proposal.characters)),
    places: distinct(written.map((proposal) => proposal.places)),
  };
}
