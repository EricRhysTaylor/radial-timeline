/*
 * Onboarding prompts — canonical text + JSON schemas for one-button manuscript
 * onboarding.
 *
 * SINGLE SOURCE OF TRUTH: the *instruction block* below is a bundled snapshot of
 * the canonical onboarding prompt whose live source is Supabase (so the website,
 * plugin, and wiki cannot drift). The plugin ships this snapshot as the
 * offline-safe default and may refresh from Supabase only when the remote
 * `schema_version` matches `ONBOARDING_SCHEMA_VERSION` — so a server-side prompt
 * edit can never break this parser. The JSON *output schemas* stay pinned here.
 *
 * See docs/engineering/plans/one-button-onboarding-local-llm-plan.md (Appendix A).
 */

/** Bump when the output schemas below change in a parser-breaking way. */
export const ONBOARDING_SCHEMA_VERSION = 1;

/**
 * The canonical onboarding instruction block (bundled snapshot of the Supabase
 * source). Displayed for website parity and used as the editable default in the
 * settings override. The operational survey/scene instructions below are derived
 * from these same rules.
 */
export const ONBOARDING_CANONICAL_PROMPT = `ROLE
You are migrating a finished manuscript into an Obsidian vault for the
Radial Timeline plugin. Work in stages. Report after each stage and wait
for my approval before continuing. Never rewrite or "improve" the prose.

SOURCE
- The vault folder contains one book folder with the manuscript:
  a single PDF, or exported scene/chapter files (.md, .txt, .docx).
- Numbered file names (01, 02, …) define the reading order.
- If names aren't numbered, TOC.md maps the reading order to exact
  file names. If neither exists, stop and ask me for the order.
- If a Scrivener metadata export exists (synopses, notes, custom
  fields), load it now and hold it for Stage 4.

STRUCTURE
- Chapters, not scenes? Treat each chapter as one scene note now;
  split at scene breaks (***, blank space) in a later pass.
- Radial Timeline defaults to 3 acts; Settings can raise the
  act count to match big structures (the Odyssey's 24 books).
  Pick a practical number, and keep the original division in
  its own field: the Cyclops scene gets Act: 2 plus Book: 9.
- From PDF: strip running headers, footers, and page numbers;
  keep italics as *emphasis*; never let a page break split a
  paragraph.

STAGE 1 — SPLIT INTO SCENES
- Create one Markdown note per scene inside the book folder.
- Name notes "NN Scene Title.md" — zero-padded, narrative order.
- Scene prose goes below the frontmatter, unchanged.

STAGE 2 — REQUIRED YAML
Add this frontmatter block to every scene note:
Class: Scene
Act: 1
Status: Complete
Subplot:
  - Main Plot
Set Act by structural read; if the book runs past 3 acts, raise the act count in Settings to match. Flag uncertain calls.

STAGE 3 — CORE METADATA
- When: the in-world date, YYYY-MM-DD (a bare year is enough)
- Synopsis: 1-2 sentences of what happens in the scene
- Character: wiki links — e.g. "[[Odysseus]]"
- Place: wiki links — e.g. "[[Ithaca]]"
- Create a stub note for every character and place you link.

STAGE 4 — ADVANCED FIELDS
- Publish Stage: Zero | Author | House | Press
- Duration, Words, Due, Pending Edits
- Type, Shift, Questions, Reader Emotion, Internal
- Map Scrivener custom metadata to same-named YAML fields —
  Radial Timeline safely ignores fields it doesn't recognize.

RULES
- YAML frontmatter is always the first thing in the file.
- No commas inside Subplot, Character, or Place names.
- Flag guesses (Act, When) for review — never invent silently.
- Finish each stage across the whole book before starting the next.`;

// ---------------------------------------------------------------------------
// Corpus survey — one structured call over the whole book.
// ---------------------------------------------------------------------------

const ONBOARDING_SURVEY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    acts: {
      type: 'array',
      description: 'Probable act boundaries. One entry per act, in order.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          act: { type: 'number', description: 'Act number, starting at 1' },
          startsAtScene: {
            type: 'string',
            description: 'File name of the scene this act begins on',
          },
        },
        required: ['act', 'startsAtScene'],
      },
    },
    subplots: {
      type: 'array',
      description:
        'The book\'s subplot vocabulary: 4 to 14 MAJOR thematic threads, "Main Plot" first. ' +
        'These are the only subplot names scenes may use. No commas in names.',
      items: { type: 'string' },
    },
    scenes: {
      type: 'array',
      description: 'Per-file classification: prose scene vs. non-scene (character/place/research note).',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fileName: { type: 'string' },
          isScene: { type: 'boolean' },
        },
        required: ['fileName', 'isScene'],
      },
    },
  },
  required: ['acts', 'subplots', 'scenes'],
} as const;

export function getOnboardingSurveyJsonSchema(): Record<string, unknown> {
  return ONBOARDING_SURVEY_SCHEMA;
}

/** Task instructions for the survey call (derived from the canonical rules). */
export function getOnboardingSurveyInstructions(): string {
  return [
    'Survey a whole manuscript to establish shared structure before per-scene extraction.',
    'From the ordered file list and each scene opening, determine: probable act boundaries',
    '(Radial Timeline defaults to 3 acts — pick a practical number), the book\'s subplot',
    'vocabulary, and whether each file is a prose scene or a non-scene note',
    '(character sheet, place, research). Do not read or rewrite prose.',
    '',
    'SUBPLOT VOCABULARY — this is the hard part; be disciplined:',
    '- Return between 4 and 14 subplots for the WHOLE book. "Main Plot" is always first.',
    '- "Main Plot" is the LOGLINE — the key movement of the whole story (the Odyssey\'s:',
    '  the hero\'s return home to his wife; Interstellar\'s: saving humanity by finding a',
    '  new world). It need not contain the most scenes; it is the spine every other',
    '  thread hangs from.',
    '- Then the major character or relationship arcs (a journey, a courtship, a rivalry,',
    '  a homecoming); then at most a few broad thematic threads (e.g. divine',
    '  intervention, revenge, disguise and recognition).',
    '- Every subplot must plausibly span MANY scenes. Never create a subplot that would',
    '  apply to only one or two scenes — fold it into a broader thread instead.',
    'Return only the schema.',
  ].join('\n');
}

export interface SurveySceneInput {
  fileName: string;
  /** First ~80 words of the note — the opening, not the full text. */
  opening: string;
}

export function buildOnboardingSurveyPrompt(scenes: SurveySceneInput[]): string {
  const list = scenes
    .map((scene, i) => `${i + 1}. ${scene.fileName}\n   ${scene.opening.trim()}`)
    .join('\n');
  return `Manuscript files in reading order (file name + opening):\n${list}`;
}

// ---------------------------------------------------------------------------
// Per-scene extraction — one structured call per candidate scene.
// ---------------------------------------------------------------------------

const ONBOARDING_SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    act: {
      type: 'number',
      description: 'Act number by structural read; clamped downstream to the configured act count.',
    },
    title: {
      type: 'string',
      description:
        'A short scene title, 2-4 words drawn from the scene\'s action (e.g. "Leaving home", ' +
        '"The Cyclops blinded"). Plain words — no numbering, no punctuation-heavy styling.',
    },
    synopsis: { type: 'string', description: '1-2 sentences of what happens in the scene.' },
    subplot: {
      type: 'array',
      maxItems: 1,
      description:
        'Exactly ONE name chosen from the given subplot vocabulary, verbatim — the single ' +
        'thread this scene most advances. Never invent a new subplot name. No commas.',
      items: { type: 'string' },
    },
    character: {
      type: 'array',
      description:
        'PRINCIPAL characters only — those who appear, act, or speak in this scene. ' +
        'Do NOT list names merely mentioned in passing, backstory, genealogy, or simile. ' +
        'Bare names, no [[ ]], no commas. Prefer fewer than 8.',
      items: { type: 'string' },
    },
    place: {
      type: 'array',
      description:
        'Named GEOGRAPHIC locations where the scene actually takes place (city, island, region, named building). ' +
        'NOT peoples or nations (e.g. "Taphians", "Ethiopians"), NOT generic interiors ' +
        '(e.g. "The Sea", "The Cloisters", "The Tower"). Bare names, no [[ ]], no commas. Prefer fewer than 5.',
      items: { type: 'string' },
    },
    when: {
      type: ['string', 'null'],
      description: 'In-world date YYYY-MM-DD (a bare year is enough), or null if it cannot be grounded.',
    },
    duration: {
      type: ['string', 'null'],
      description: 'Scene duration if inferable (e.g. "1 hour"), else null. Never fabricate.',
    },
    flags: {
      type: 'array',
      description: 'Fields that are guesses needing review — use the field names, e.g. "Act", "When".',
      items: { type: 'string' },
    },
  },
  required: ['act', 'title', 'synopsis', 'subplot', 'character', 'place', 'when', 'duration', 'flags'],
} as const;

export function getOnboardingSceneJsonSchema(): Record<string, unknown> {
  return ONBOARDING_SCENE_SCHEMA;
}

/** Task instructions for the per-scene extraction call (derived from Stages 2-4). */
export function getOnboardingSceneInstructions(): string {
  return [
    'Extract Radial Timeline scene metadata from one scene of a manuscript. Never rewrite prose.',
    'Set Act by structural read. Write a 1-2 sentence Synopsis, and a short 2-4 word Title',
    'drawn from the scene\'s action ("Leaving home", "The Cyclops blinded").',
    'Assign the scene to exactly ONE subplot — the single thread it most advances, chosen from the',
    'given vocabulary verbatim. Never invent a subplot name. (The author can layer more later.)',
    'BE SELECTIVE with entities — this is the difference between a usable vault and hundreds of junk notes:',
    '- Character: only the PRINCIPAL people who appear, act, or speak in this scene. Exclude names that are',
    '  merely mentioned in passing, backstory, genealogy, or simile. Aim for fewer than 8.',
    '- Place: only NAMED geographic settings where the scene actually happens (city, island, region, named',
    '  building). Exclude peoples/nations and generic interiors. Aim for fewer than 5.',
    'Give both as bare names (the plugin adds the wiki links), no commas.',
    'Give When as YYYY-MM-DD or a bare year only when grounded in the text — otherwise null; same for',
    'Duration. Never fabricate. Prefer any metadata the source already carried.',
    'In "flags", list ONLY fields you actually filled in but guessed at (e.g. "Act"). Do not flag a field',
    'you returned as null. Return only the schema.',
  ].join('\n');
}

export interface SceneExtractionInput {
  /** The scene prose (frontmatter already stripped). */
  body: string;
  /** Subplot vocabulary the survey established, for consistency. */
  subplotVocabulary: string[];
  /** Metadata the source already carried (e.g. Scrivener synopsis/custom fields). */
  knownMetadata?: Record<string, string>;
  knownSynopsis?: string | null;
}

// ---------------------------------------------------------------------------
// Entity enrichment — one structured call per Character/Place, grounded ONLY in
// the scenes that entity is linked from (no outside knowledge of the name).
// ---------------------------------------------------------------------------

const ONBOARDING_ENTITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: {
      type: 'string',
      description:
        'Short appositive naming what this entity IS in the book (e.g. "Odysseus\' son and heir of Ithaca", ' +
        'or for a place "the rocky island Odysseus rules"). One phrase, no trailing period. Empty string if the ' +
        'scenes do not establish it.',
    },
    summary: {
      type: 'string',
      description:
        'A grounded prose summary of who/what this entity is and what they do ACROSS the provided scenes of this ' +
        'book. Use ONLY the provided scenes — never outside knowledge of the name. Stay near the target word ' +
        'count. If the scenes give little, be brief rather than padding. No headings, plain prose.',
    },
  },
  required: ['role', 'summary'],
} as const;

export function getOnboardingEntityJsonSchema(): Record<string, unknown> {
  return ONBOARDING_ENTITY_SCHEMA;
}

/** Task instructions for the per-entity enrichment call. */
export function getOnboardingEntityInstructions(): string {
  return [
    'Summarize one character or place for a story bible, grounded ONLY in the manuscript scenes provided.',
    'This is a real, possibly well-known work — but you must ignore any outside knowledge of the name and',
    'describe ONLY what these scenes actually show. Do not import myth, history, or later plot the text has',
    'not yet reached. Never invent traits, relationships, or events not present in the scenes.',
    'Return: "role" (a short appositive of what the entity is here) and "summary" (grounded prose near the',
    'requested word count). If the scenes barely feature the entity, keep both short. Return only the schema.',
  ].join('\n');
}

export interface EntityEnrichmentInput {
  kind: 'character' | 'place';
  name: string;
  /** Target summary length (words) — from the Summary-generation setting. */
  targetWords: number;
  /** Excerpts of the scenes this entity is linked from, in reading order. */
  sceneExcerpts: string[];
}

// ---------------------------------------------------------------------------
// Scene splitting — one call per file, proposing where each scene begins.
// Constrained by the file's own argument beats when present (align, don't guess).
// ---------------------------------------------------------------------------

const ONBOARDING_SPLIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scenes: {
      type: 'array',
      description: 'The scenes of this file, in reading order. The first scene starts at paragraph 1.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startParagraph: {
            type: 'number',
            description: 'The 1-based paragraph number where this scene begins (use the numbers shown).',
          },
          label: {
            type: 'string',
            description: 'A short scene label — reuse the matching argument beat verbatim when beats are given.',
          },
        },
        required: ['startParagraph', 'label'],
      },
    },
  },
  required: ['scenes'],
} as const;

export function getOnboardingSplitJsonSchema(): Record<string, unknown> {
  return ONBOARDING_SPLIT_SCHEMA;
}

export function getOnboardingSplitInstructions(): string {
  return [
    'Divide ONE file of a manuscript into its scenes. You are given the paragraphs, each numbered.',
    'Return the 1-based paragraph number where each scene BEGINS, in reading order, plus a short label.',
    'The first scene always begins at paragraph 1. Never split inside a paragraph; boundaries fall between them.',
    'When the file lists "argument beats", those ARE the scenes in order — align each beat to the paragraph',
    'where it begins and reuse the beat text as the label. Return exactly that many scenes.',
    'When no beats are given, find natural boundaries — a clear shift in location, time, viewpoint, or action —',
    'and prefer fewer, well-justified scenes over many small ones. Do not rewrite any prose. Return only the schema.',
  ].join('\n');
}

export interface SplitProposalInput {
  /** Body paragraphs in reading order (argument header, if any, is paragraph 1). */
  paragraphs: string[];
  /** Argument beats when the file had them — the model aligns scenes to these. */
  labels: string[];
  /** Per-paragraph char cap so a long chapter can't blow the context window. */
  perParagraphChars?: number;
}

export function buildOnboardingSplitPrompt(input: SplitProposalInput): string {
  const cap = input.perParagraphChars ?? 600;
  const numbered = input.paragraphs
    .map((paragraph, i) => {
      const text = paragraph.length > cap ? `${paragraph.slice(0, cap)}…` : paragraph;
      return `[${i + 1}] ${text}`;
    })
    .join('\n\n');
  const beats = input.labels.length > 0
    ? `Argument beats (the scenes, in order — return exactly ${input.labels.length}):\n` +
      input.labels.map((label, i) => `${i + 1}. ${label}`).join('\n')
    : 'No argument beats — infer the scene boundaries from the prose.';
  return `${beats}\n\nParagraphs (numbered):\n${numbered}`;
}

export function buildOnboardingEntityPrompt(input: EntityEnrichmentInput): string {
  const scenes = input.sceneExcerpts
    .map((text, i) => `--- Scene ${i + 1} ---\n${text.trim()}`)
    .join('\n\n');
  return [
    `Entity type: ${input.kind}`,
    `Name: ${input.name}`,
    `Target summary length: about ${input.targetWords} words.`,
    `Scenes this ${input.kind} appears in (grounding — use nothing else):`,
    scenes,
  ].join('\n\n');
}

export function buildOnboardingScenePrompt(input: SceneExtractionInput): string {
  const parts: string[] = [];
  if (input.subplotVocabulary.length > 0) {
    parts.push(`Book subplot vocabulary (choose from these): ${input.subplotVocabulary.join(' · ')}`);
  }
  if (input.knownSynopsis && input.knownSynopsis.trim().length > 0) {
    parts.push(`Source synopsis (prefer/refine this): ${input.knownSynopsis.trim()}`);
  }
  const known = input.knownMetadata ? Object.entries(input.knownMetadata) : [];
  if (known.length > 0) {
    parts.push(
      `Source metadata already present:\n${known.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    );
  }
  parts.push(`Scene text:\n${input.body.trim()}`);
  return parts.join('\n\n');
}
