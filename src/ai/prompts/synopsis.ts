/*
 * AI Summary & Synopsis Prompt Builders
 * Summary = extended AI-generated scene analysis (≈200–300 words)
 * Synopsis = concise, skimmable navigation text (strict max word cap)
 */

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    "summary": {
      type: "string",
      description: "Factual extended summary of scene events (≈200–300 words)"
    }
  },
  required: ["summary"]
};

const SYNOPSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    "synopsis": {
      type: "string",
      description: "Concise scene synopsis for navigation and hovers (strict word cap)"
    }
  },
  required: ["synopsis"]
};

export function getSummaryJsonSchema() {
  return SUMMARY_JSON_SCHEMA;
}

export function getSynopsisJsonSchema() {
  return SYNOPSIS_JSON_SCHEMA;
}

export function getSummarySystemPrompt(): string {
  return `You are a precise, neutral summarizer for fiction manuscripts. Your goal is to generate detailed, purely factual summaries of scene events for an analysis database. Do not critique, do not improve the prose, and do not use flowery language.`;
}

/**
 * Build a prompt for generating an extended Summary (≈200–300 words).
 * This is the primary AI-generated artifact.
 */
export function buildSummaryPrompt(
  sceneBody: string,
  sceneNumber: string,
  targetWords: number = 300,
  extraInstructions?: string
): string {
  let instructions = extraInstructions ? extraInstructions.trim() + '\n\n' : '';

  // Calculate paragraph guidance based on target
  let paragraphGuidance = '2-3 paragraphs';
  if (targetWords < 150) {
    paragraphGuidance = '1-2 paragraphs';
  } else if (targetWords > 400) {
    paragraphGuidance = '3-4 paragraphs';
  }

  return `${instructions}Read the scene below and write a factual summary of events.
Return ONLY valid JSON matching this structure:

{
  "summary": "Character A does X, then Y happens..."
}

Rules:
1. FOCUS: Purely factual summary of what happens in the scene.
2. LENGTH: Approximately ${targetWords} words (${paragraphGuidance}).
3. STRUCTURE: First paragraph covers main events. Second covers character actions/reactions. Optional third paragraph for setup or consequences.
4. TONE: Neutral, objective, unadorned. No flowery prose.
5. CONTENT: Do NOT include analysis, critique, or "The scene is about...". Just the events.
6. FORMAT: Output ONLY valid JSON. No markdown fencing around the JSON.

Scene ${sceneNumber}:
${sceneBody || 'N/A'}
`;
}

/**
 * Build a prompt for generating a short Synopsis with a strict word cap.
 * Synopsis is concise, skimmable navigation text for hovers and outlines.
 */
export function buildSynopsisPrompt(
  sceneBody: string,
  sceneNumber: string,
  maxWords: number = 30,
  extraInstructions?: string
): string {
  let instructions = extraInstructions ? extraInstructions.trim() + '\n\n' : '';

  return `${instructions}Read the scene below and write a concise synopsis (brief summary).
Return ONLY valid JSON matching this structure:

{
  "synopsis": "Short factual synopsis of the scene."
}

Rules:
1. FOCUS: Purely factual summary of the main event(s) in the scene.
2. LENGTH: Maximum ${maxWords} words. Hard cap; do not exceed it.
3. TONE: Neutral, objective, concise. No flowery prose.
4. CONTENT: Capture the key action or turning point. Prefer one compact paragraph. Do NOT include analysis or "The scene is about...".
5. FORMAT: Output ONLY valid JSON. No markdown fencing around the JSON.

Scene ${sceneNumber}:
${sceneBody || 'N/A'}
`;
}
