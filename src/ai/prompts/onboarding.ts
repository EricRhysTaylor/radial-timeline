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
      description: 'Candidate subplot vocabulary for the whole book (e.g. "Main Plot"). No commas in names.',
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
    '(Radial Timeline defaults to 3 acts — pick a practical number), a consistent subplot',
    'vocabulary for the book, and whether each file is a prose scene or a non-scene note',
    '(character sheet, place, research). Do not read or rewrite prose. Return only the schema.',
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
    synopsis: { type: 'string', description: '1-2 sentences of what happens in the scene.' },
    subplot: {
      type: 'array',
      description: 'One or more subplot names from the survey vocabulary. No commas in names.',
      items: { type: 'string' },
    },
    character: {
      type: 'array',
      description: 'Character names to wiki-link (bare names, no [[ ]], no commas).',
      items: { type: 'string' },
    },
    place: {
      type: 'array',
      description: 'Place names to wiki-link (bare names, no [[ ]], no commas).',
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
  required: ['act', 'synopsis', 'subplot', 'character', 'place', 'when', 'duration', 'flags'],
} as const;

export function getOnboardingSceneJsonSchema(): Record<string, unknown> {
  return ONBOARDING_SCENE_SCHEMA;
}

/** Task instructions for the per-scene extraction call (derived from Stages 2-4). */
export function getOnboardingSceneInstructions(): string {
  return [
    'Extract Radial Timeline scene metadata from one scene of a manuscript. Never rewrite prose.',
    'Set Act by structural read. Write a 1-2 sentence Synopsis. List Characters and Places as bare',
    'names (the plugin adds the wiki links) with no commas. Give When as YYYY-MM-DD or a bare year',
    'only when grounded in the text — otherwise null; same for Duration. Prefer any metadata the',
    'source already carried. Flag any guessed field (e.g. "Act", "When") in "flags". Return only the schema.',
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
