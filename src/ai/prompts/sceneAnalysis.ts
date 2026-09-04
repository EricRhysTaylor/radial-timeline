/*
 * AI Scene Analysis Prompt Builder
 * This analyzes scene performance, not story beats (timeline slices)
 */

const SCENE_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    "previousSceneAnalysis": {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref_id: { type: "string", description: "Stable scene reference id (scn_...)" },
          scene: { type: "string", description: "Scene number" },
          title: { type: "string", description: "Short analysis title" },
          grade: { type: "string", enum: ["+", "-", "?"], description: "Connection strength" },
          comment: { type: "string", description: "Editorial comment (max 10 words)" }
        },
        required: ["ref_id", "scene", "title", "grade", "comment"]
      }
    },
    "currentSceneAnalysis": {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref_id: { type: "string", description: "Stable scene reference id (scn_...)" },
          scene: { type: "string", description: "Scene number" },
          title: { type: "string", description: "Short analysis title or grade (A/B/C for first item)" },
          grade: { type: "string", enum: ["+", "-", "?", "A", "B", "C"], description: "Grade or connection strength" },
          comment: { type: "string", description: "Editorial comment (max 15 words for first item, 10 for others)" }
        },
        required: ["ref_id", "scene", "title", "grade", "comment"]
      }
    },
    "nextSceneAnalysis": {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref_id: { type: "string", description: "Stable scene reference id (scn_...)" },
          scene: { type: "string", description: "Scene number" },
          title: { type: "string", description: "Short analysis title" },
          grade: { type: "string", enum: ["+", "-", "?"], description: "Connection strength" },
          comment: { type: "string", description: "Editorial comment (max 10 words)" }
        },
        required: ["ref_id", "scene", "title", "grade", "comment"]
      }
    }
  },
  required: ["previousSceneAnalysis", "currentSceneAnalysis", "nextSceneAnalysis"]
};

export function getSceneAnalysisJsonSchema() {
  return SCENE_ANALYSIS_JSON_SCHEMA;
}

export function getSceneAnalysisSystemPrompt(): string {
  return `You are Radial Timeline's scene-analysis assistant.`;
}

const SCENE_ANALYSIS_JSON_EXAMPLE = `{
  "previousSceneAnalysis": [
    { "ref_id": "scn_prev23", "scene": "23", "title": "First-rescue echo", "grade": "+", "comment": "A supporting character's choice parallels the protagonist's later desperation" },
    { "ref_id": "scn_prev23", "scene": "23", "title": "Implant mystery", "grade": "?", "comment": "Tech anomalies foreshadow later biological puzzles" }
  ],
  "currentSceneAnalysis": [
    { "ref_id": "scn_cur24", "scene": "24", "title": "Overall Scene Grade", "grade": "B", "comment": "Tighten pacing and reduce repetition in survival beats" },
    { "ref_id": "scn_cur24", "scene": "24", "title": "Harsh environment pressure", "grade": "+", "comment": "Strongly escalates physical and emotional stakes" }
  ],
  "nextSceneAnalysis": [
    { "ref_id": "scn_next25", "scene": "25", "title": "Tech–bio tension", "grade": "+", "comment": "Survival biology echoes earlier genetic stakes" },
    { "ref_id": "scn_next25", "scene": "25", "title": "Trust and secrecy", "grade": "+", "comment": "The protagonist's reliance reflects earlier disclosure themes" }
  ]
}`;

const SCENE_ANALYSIS_EXAMPLE_SECTION = `Example of valid JSON (do not copy verbatim; adapt to the scenes below):
${SCENE_ANALYSIS_JSON_EXAMPLE}
`;

export function buildSceneAnalysisPrompt(
  prevBody: string | null,
  currentBody: string,
  nextBody: string | null,
  prevNum: string,
  currentNum: string,
  nextNum: string,
  contextPrompt?: string,
  sceneRefs?: {
    prevRefId?: string;
    currentRefId: string;
    nextRefId?: string;
  }
): string {
  // Build context prefix if provided
  let contextPrefix = contextPrompt?.trim() 
    ? `${contextPrompt.trim()}\n\n`
    : 'You are a developmental editor for fiction.\n\n';

  const isPrevAvailable = !!prevBody;
  const isNextAvailable = !!nextBody;
  const prevRef = sceneRefs?.prevRefId || prevNum;
  const currentRef = sceneRefs?.currentRefId || currentNum;
  const nextRef = sceneRefs?.nextRefId || nextNum;

  // Boundary-specific prompts to reduce confusion for first/last scenes
  if (!isPrevAvailable && !isNextAvailable) {
    // Only one scene in manuscript (or both neighbors missing): evaluate current only
    return `${contextPrefix}Evaluate the single scene below. Return ONLY valid JSON matching this structure:

{
  "previousSceneAnalysis": [],
  "currentSceneAnalysis": [
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Overall Scene Grade",
      "grade": "A" or "B" or "C",
      "comment": "Instructions on how to improve it (max 15 words)"
    },
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Concise editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points
  ],
  "nextSceneAnalysis": []
}

Rules:
- Output ONLY valid JSON. No markdown code blocks, no preamble, no commentary.
- First item in currentSceneAnalysis must have grade A/B/C (overall scene quality).
- Subsequent items use +/-/? for connection strength.
- previousSceneAnalysis and nextSceneAnalysis must still be present as empty arrays.
- Every item must include ref_id using scene IDs: previous=${prevRef}, current=${currentRef}, next=${nextRef}.
- Keep comments concise (first item max 15 words, others max 10 words).
- Never use letter grades (A/B/C) outside that first item; use only "+", "-", or "?" afterwards.

${SCENE_ANALYSIS_EXAMPLE_SECTION}

Scene ${currentNum}:
${currentBody || 'N/A'}
`;
  }

  if (!isPrevAvailable && isNextAvailable) {
    // First scene: no previous, only currentSceneAnalysis and nextSceneAnalysis
    return `${contextPrefix}Evaluate the first scene in context of the following scene. Return ONLY valid JSON matching this structure:

{
  "previousSceneAnalysis": [],
  "currentSceneAnalysis": [
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Overall Scene Grade",
      "grade": "A" or "B" or "C",
      "comment": "Instructions on how to improve it (max 15 words)"
    },
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points
  ],
  "nextSceneAnalysis": [
    {
      "ref_id": "${nextRef}",
      "scene": "${nextNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points analyzing next scene
  ]
}

Rules:
- Output ONLY valid JSON. No markdown code blocks, no preamble.
- previousSceneAnalysis must be present as an empty array.
- First currentSceneAnalysis item: grade A/B/C (overall quality). Others: +/-/? (connection strength).
- nextSceneAnalysis items: +/-/? showing how next scene builds on current.
- Every item must include ref_id using scene IDs: previous=${prevRef}, current=${currentRef}, next=${nextRef}.
- Never use letter grades (A/B/C) outside that first item; use only "+", "-", or "?" afterwards.
- For nextSceneAnalysis entries, grades must be "+", "-", or "?" only.

${SCENE_ANALYSIS_EXAMPLE_SECTION}

Scene ${currentNum}:
${currentBody || 'N/A'}

Scene ${nextNum}:
${nextBody ?? 'N/A'}
`;
  }

  if (isPrevAvailable && !isNextAvailable) {
    // Last scene: no next, only previousSceneAnalysis and currentSceneAnalysis
    return `${contextPrefix}Evaluate the last scene in context of the previous scene. Return ONLY valid JSON matching this structure:

{
  "previousSceneAnalysis": [
    {
      "ref_id": "${prevRef}",
      "scene": "${prevNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points analyzing previous scene
  ],
  "currentSceneAnalysis": [
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Overall Scene Grade",
      "grade": "A" or "B" or "C",
      "comment": "Instructions on how to improve it (max 15 words)"
    },
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points
  ],
  "nextSceneAnalysis": []
}

Rules:
- Output ONLY valid JSON. No markdown code blocks, no preamble.
- previousSceneAnalysis items: +/-/? showing how previous scene sets up current.
- nextSceneAnalysis must be present as an empty array.
- First currentSceneAnalysis item: grade A/B/C (overall quality). Others: +/-/? (connection strength).
- Every item must include ref_id using scene IDs: previous=${prevRef}, current=${currentRef}, next=${nextRef}.
- Never use letter grades (A/B/C) outside that first item; use only "+", "-", or "?" afterwards.
- For previousSceneAnalysis entries, grades must be "+", "-", or "?" only.

${SCENE_ANALYSIS_EXAMPLE_SECTION}

Scene ${prevNum}:
${prevBody ?? 'N/A'}

Scene ${currentNum}:
${currentBody || 'N/A'}
`;
  }

  return `${contextPrefix}For each of the three scenes below, generate concise narrative pulse points from the perspective of the middle scene (${currentNum}), showing connections between previous (${prevNum}) and next (${nextNum}) scenes. Return ONLY valid JSON matching this structure:

{
  "previousSceneAnalysis": [
    {
      "ref_id": "${prevRef}",
      "scene": "${prevNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points analyzing how previous scene sets up current
  ],
  "currentSceneAnalysis": [
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Overall Scene Grade",
      "grade": "A" or "B" or "C",
      "comment": "Instructions on how to improve it (max 15 words)"
    },
    {
      "ref_id": "${currentRef}",
      "scene": "${currentNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points analyzing current scene
  ],
  "nextSceneAnalysis": [
    {
      "ref_id": "${nextRef}",
      "scene": "${nextNum}",
      "title": "Pulse point title",
      "grade": "+" or "-" or "?",
      "comment": "Editorial comment (max 10 words)"
    }
    // ... 3-5 more pulse points analyzing how next scene builds on current
  ]
}

Rules:
- Output ONLY valid JSON. No markdown code blocks (no \`\`\`json), no preamble, no commentary.
- First currentSceneAnalysis item must have grade A/B/C (A=nearly perfect, C=needs improvement).
- All other items use +/-/?: "+" for strong connections, "-" for weak, "?" for neutral.
- Every item must include ref_id using scene IDs: previous=${prevRef}, current=${currentRef}, next=${nextRef}.
- Keep comments concise (first currentSceneAnalysis max 15 words, all others max 10 words).
- Never use letter grades (A/B/C) outside that first item; use only "+", "-", or "?" afterwards.
- previousSceneAnalysis and nextSceneAnalysis entries must use "+", "-", or "?".

${SCENE_ANALYSIS_EXAMPLE_SECTION}

Scene ${prevNum}:
${prevBody ?? 'N/A'}

Scene ${currentNum}:
${currentBody || 'N/A'}

Scene ${nextNum}:
${nextBody ?? 'N/A'}
`;
}
