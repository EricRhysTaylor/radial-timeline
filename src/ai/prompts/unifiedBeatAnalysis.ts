/*
 * Unified Beat Analysis Prompt Builder
 *
 * Produces a Gossamer scoring prompt for one of four narrative signals:
 * momentum, tension, activity, interiority. A shared scaffold wraps a
 * signal-specific scoring block so every run sends the same envelope
 * but the AI scores distinct narrative properties.
 */

import {
  DEFAULT_GOSSAMER_SIGNAL,
  GOSSAMER_SIGNAL_METADATA,
  GOSSAMER_SIGNAL_TYPES,
  type GossamerSignalType
} from '../../types/gossamerSignals';

export interface UnifiedBeatInfo {
  beatName: string;
  beatNumber: number;
  idealRange: string; // e.g., "0-20" — used downstream for range validation; NOT sent to AI (anchoring)
  placement?: string; // Structural placement token from beat-note title prefix, e.g. "1.01", "4.01"
  description?: string; // Beat Purpose from frontmatter — tells the AI what this beat is in the story
  // Note: previousScore, previousJustification, and idealRange are intentionally NOT sent to the AI
  // to avoid anchoring bias. Each analysis is fresh based on manuscript content only.
}

/**
 * JSON schema for signal-agnostic beat analysis response.
 *
 * Each beat row carries:
 *   - beatName     (string)
 *   - signal       (one of the four signal ids — echoed per row for audit/debug)
 *   - score        (0-100)
 *   - justification (one short sentence)
 *
 * idealRange / isWithinRange are computed in code after the AI response,
 * not requested from the AI, to avoid anchoring bias.
 */
const UNIFIED_BEAT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    beats: {
      type: "array",
      description: "Signal scoring for each story beat",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          beatName: {
            type: "string",
            description: "Name of the beat"
          },
          signal: {
            type: "string",
            enum: [...GOSSAMER_SIGNAL_TYPES],
            description: "The narrative signal being scored (momentum, tension, activity, interiority)"
          },
          score: {
            type: "number",
            description: "Signal score 0-100",
            minimum: 0,
            maximum: 100
          },
          justification: {
            type: "string",
            description: "Brief justification for the score (one sentence)"
          }
        },
        required: ["beatName", "signal", "score", "justification"]
      }
    },
    overallAssessment: {
      type: "object",
      additionalProperties: false,
      description: "Overall manuscript assessment",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of the overall signal shape (max 30 words)"
        },
        strengths: {
          type: "array",
          items: { type: "string" },
          description: "List of 2-3 strengths"
        },
        improvements: {
          type: "array",
          items: { type: "string" },
          description: "List of 2-3 suggested improvements"
        }
      },
      required: ["summary", "strengths", "improvements"]
    }
  },
  required: ["beats", "overallAssessment"]
};

export function getUnifiedBeatAnalysisJsonSchema() {
  return UNIFIED_BEAT_ANALYSIS_SCHEMA;
}

function formatBeatList(beats: UnifiedBeatInfo[]): string {
  return beats
    .map((b, i) => {
      const prefix = b.placement ? `[${b.placement}]` : `${i + 1}.`;
      const description = b.description && b.description.trim().length > 0
        ? ` — ${b.description.trim()}`
        : '';
      return `${prefix} ${b.beatName}${description}`;
    })
    .join('\n');
}

/** The signal-specific scoring rubric plus the per-row response contract. */
function buildSignalInstruction(signal: GossamerSignalType): string {
  const signalBlock = GOSSAMER_SIGNAL_METADATA[signal].promptBlock;
  return `${signalBlock}

Respond strictly in the provided JSON schema.
Return a score (0-100) and one short sentence justification per beat.
For each row, set "signal" to "${signal}".`;
}

/**
 * Build the prompt as a cache-stable / volatile split for provider prompt caching.
 *
 * `stableInput` (beat list + full manuscript) is byte-identical across all four
 * signals on a given manuscript, so when it lands in the provider cache prefix
 * (Anthropic `cache_control`, Gemini `cachedContent`, OpenAI prefix cache) the
 * second-through-fourth signal runs reuse it instead of re-billing the corpus.
 * `volatileQuestion` (the signal-specific rubric + "set signal to X") is the only
 * part that changes between signals and MUST be placed after the cache break.
 *
 * The caller wires this as `userInput: stableInput` + `userQuestion: volatileQuestion`
 * with `placeUserQuestionLast: true` so composeEnvelope inserts the cache-break
 * delimiter between them. For the stable prefix to actually be reused, the caller
 * must also keep every other envelope input signal-neutral (role template,
 * projectContext incl. `task`, featureModeInstructions, output rules).
 */
export function buildUnifiedBeatAnalysisCacheParts(
  manuscriptText: string,
  beats: UnifiedBeatInfo[],
  beatSystem: string,
  signal: GossamerSignalType = DEFAULT_GOSSAMER_SIGNAL
): { stableInput: string; volatileQuestion: string } {
  const beatList = formatBeatList(beats);
  const stableInput = `Beat system: ${beatSystem}
Story beats:
${beatList}

Manuscript:
${manuscriptText}`;
  return { stableInput, volatileQuestion: buildSignalInstruction(signal) };
}

export function buildUnifiedBeatAnalysisPromptParts(
  manuscriptText: string,
  beats: UnifiedBeatInfo[],
  beatSystem: string,
  signal: GossamerSignalType = DEFAULT_GOSSAMER_SIGNAL
): {
  transformText: string;
  instructionText: string;
  prompt: string;
} {
  const beatList = formatBeatList(beats);

  const signalBlock = GOSSAMER_SIGNAL_METADATA[signal].promptBlock;

  const transformText = `Beat system: ${beatSystem}
Story beats:
${beatList}`;

  const instructionText = `${signalBlock}

Respond strictly in the provided JSON schema.
Return a score (0-100) and one short sentence justification per beat.
For each row, set "signal" to "${signal}".

Manuscript:`;

  return {
    transformText,
    instructionText,
    prompt: `${transformText}
${instructionText}
${manuscriptText}`
  };
}

/**
 * Build a Gossamer analysis prompt for a given signal.
 *
 * @param manuscriptText - Full manuscript text with table of contents and scene headings
 * @param beats - Array of story beats
 * @param beatSystem - Name of the beat system (e.g., "Save The Cat")
 * @param signal - The signal to score (momentum, tension, activity, interiority). Defaults to momentum.
 * @returns Prompt string for the AI call.
 */
export function buildUnifiedBeatAnalysisPrompt(
  manuscriptText: string,
  beats: UnifiedBeatInfo[],
  beatSystem: string,
  signal: GossamerSignalType = DEFAULT_GOSSAMER_SIGNAL
): string {
  return buildUnifiedBeatAnalysisPromptParts(manuscriptText, beats, beatSystem, signal).prompt;
}
