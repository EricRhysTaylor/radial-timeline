/*
 * Gossamer Signal Types
 *
 * A Gossamer run measures one of four narrative signals. Each signal has its own
 * scoring rubric; the shared scaffold + signal-specific block together form the
 * prompt sent to the AI. Runs are tagged with `signalType` so histories for
 * different signals never mix in the trace display.
 *
 * Legacy runs (written before signals existed) have no stored signal and are
 * read as `momentum`.
 */

export type GossamerSignalType = 'momentum' | 'tension' | 'activity' | 'interiority';

export const GOSSAMER_SIGNAL_TYPES: readonly GossamerSignalType[] = [
  'momentum',
  'tension',
  'activity',
  'interiority'
] as const;

export const DEFAULT_GOSSAMER_SIGNAL: GossamerSignalType = 'momentum';

export interface GossamerSignalMetadata {
  id: GossamerSignalType;
  label: string;        // UI label ("Momentum")
  short: string;        // Short form for prompt ("MOMENTUM")
  icon: string;         // lucide icon id used with Obsidian's setIcon()
  tooltip: string;      // Hover text for signal selector button
  /** Scoring instruction block inserted into the shared prompt scaffold. */
  promptBlock: string;
  /**
   * Optional inline SVG path data for the 24×24 Lucide icon. When present the
   * view renders this path directly instead of calling setIcon(), which lets us
   * ship the current Lucide silhouette for icons Obsidian still bundles in an
   * older shape (e.g. `flame`).
   */
  inlineIconPath?: string;
}

const MOMENTUM_BLOCK = `Score MOMENTUM (0-100) for each listed beat.
Momentum measures forward narrative drive and pacing—how strongly the story pulls the reader toward what happens next.
0   = stalled; digression, recap, or inert exposition
25  = drifting; minimal advancement, flat stakes
50  = steady; plot advances without urgency
75  = propulsive; escalation or new questions each beat
100 = relentless; consequences compound continuously
Judge forward drive, consequence-chaining, and reader pull—not sheer event volume.`;

const TENSION_BLOCK = `Score TENSION (0-100) for each listed beat.
Tension measures pressure and unresolved strain—the weight of stakes, conflict, and uncertainty, whether or not anything visible happens.
0   = at rest; no stakes, friction, or threat
25  = mild unease; low-grade worry or disagreement
50  = active pressure; clear conflict, uncertain outcome
75  = high strain; stakes escalate, resolution in doubt
100 = near-breaking; dread, ultimatum, or imminent rupture
Judge the pressure the reader carries forward—not the noise on the page.`;

const ACTIVITY_BLOCK = `Score ACTIVITY (0-100) for each listed beat.
Activity measures external event density—how much physically or observably happens on the page.
0   = static; reflection, description, or recap
25  = sparse; isolated actions or exchanges
50  = steady; regular action, dialogue, or movement
75  = dense; stacked events, shifts, or physical beats
100 = saturated; continuous action, multiple simultaneous events
Count observable happenings—movement, dialogue, discoveries, confrontations, and setting shifts.
Do not reward emotional intensity here; that belongs to Interiority.`;

const INTERIORITY_BLOCK = `Score INTERIORITY (0-100) for each listed beat.
Interiority measures emotional and psychological intensity—the depth and charge of inner experience on the page.
0   = purely external; no inner access
25  = shallow; brief noted reactions
50  = present; clear thought and felt response
75  = deep; sustained inner conflict or emotion
100 = saturated; intense psychological pressure dominates
Judge depth and charge of inner life—not the presence of emotional language.
A quiet realization can score higher than a loud outburst.`;

export const GOSSAMER_SIGNAL_METADATA: Record<GossamerSignalType, GossamerSignalMetadata> = {
  momentum: {
    id: 'momentum',
    label: 'Momentum',
    short: 'MOMENTUM',
    icon: 'trending-up',
    tooltip: 'Momentum\n\nMeasures how strongly the story moves forward—how much each beat pulls the reader toward what happens next. Focuses on pacing and consequence, not just event count.',
    promptBlock: MOMENTUM_BLOCK
  },
  tension: {
    id: 'tension',
    label: 'Tension',
    short: 'TENSION',
    icon: 'flame',
    // Current Lucide flame (exact path from lucide.dev). We inline this
    // because Obsidian ships an older Lucide where `flame` is the legacy
    // double-flame silhouette. The override class is intentionally NOT
    // `svg-icon lucide-flame` — those classes leak into Obsidian's global
    // icon styling and its internals may re-render anything matching them.
    inlineIconPath: 'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4',
    tooltip: 'Tension\n\nMeasures the pressure the reader feels—how much strain, uncertainty, or unresolved conflict is carried forward. A quiet scene can be highly tense if the stakes are clear.',
    promptBlock: TENSION_BLOCK
  },
  activity: {
    id: 'activity',
    label: 'Activity',
    short: 'ACTIVITY',
    icon: 'zap',
    tooltip: 'Activity\n\nMeasures how much is physically or visibly happening on the page—actions, events, and external change. High activity doesn\u2019t imply high tension or emotion.',
    promptBlock: ACTIVITY_BLOCK
  },
  interiority: {
    id: 'interiority',
    label: 'Interiority',
    short: 'INTERIORITY',
    icon: 'brain',
    tooltip: 'Interiority\n\nMeasures the intensity of the character\u2019s inner experience—thoughts, emotions, and psychological conflict. A subtle realization can be more intense than a dramatic outburst.',
    promptBlock: INTERIORITY_BLOCK
  }
};

/** Coerce any value to a valid signal, falling back to momentum for legacy/missing. */
export function coerceGossamerSignal(value: unknown): GossamerSignalType {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if ((GOSSAMER_SIGNAL_TYPES as readonly string[]).includes(normalized)) {
      return normalized as GossamerSignalType;
    }
  }
  return DEFAULT_GOSSAMER_SIGNAL;
}

