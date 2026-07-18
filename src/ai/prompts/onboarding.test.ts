import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_SCHEMA_VERSION,
  ONBOARDING_CANONICAL_PROMPT,
  getOnboardingSurveyJsonSchema,
  getOnboardingSceneJsonSchema,
  getOnboardingSurveyInstructions,
  getOnboardingSceneInstructions,
  buildOnboardingSurveyPrompt,
  buildOnboardingScenePrompt,
} from './onboarding';

/**
 * Every strict object schema must set additionalProperties:false and list each
 * `required` key in `properties` — otherwise providers reject the strict schema.
 */
function assertStrictObject(schema: Record<string, unknown>): void {
  expect(schema.type).toBe('object');
  expect(schema.additionalProperties).toBe(false);
  const properties = schema.properties as Record<string, unknown>;
  const required = schema.required as string[];
  for (const key of required) {
    expect(properties).toHaveProperty(key);
  }
  // Recurse into nested object items so array-of-object rows are strict too.
  for (const value of Object.values(properties)) {
    const prop = value as Record<string, unknown>;
    if (prop.type === 'object') assertStrictObject(prop);
    if (prop.type === 'array' && prop.items && (prop.items as Record<string, unknown>).type === 'object') {
      assertStrictObject(prop.items as Record<string, unknown>);
    }
  }
}

describe('onboarding schemas', () => {
  it('survey schema is strict and self-consistent', () => {
    assertStrictObject(getOnboardingSurveyJsonSchema());
  });

  it('scene schema is strict and requires every property (strict-mode contract)', () => {
    const schema = getOnboardingSceneJsonSchema();
    assertStrictObject(schema);
    const properties = Object.keys(schema.properties as Record<string, unknown>).sort();
    const required = ([...(schema.required as string[])]).sort();
    expect(required).toEqual(properties);
  });

  it('scene schema allows nullable When/Duration (never fabricate)', () => {
    const props = getOnboardingSceneJsonSchema().properties as Record<string, { type: unknown }>;
    expect(props.when.type).toEqual(['string', 'null']);
    expect(props.duration.type).toEqual(['string', 'null']);
  });
});

describe('onboarding prompt text', () => {
  it('exposes a numeric schema version', () => {
    expect(typeof ONBOARDING_SCHEMA_VERSION).toBe('number');
  });

  it('bundled canonical prompt carries all four stages and the core rules', () => {
    for (const marker of ['ROLE', 'STAGE 1', 'STAGE 2', 'STAGE 3', 'STAGE 4', 'RULES']) {
      expect(ONBOARDING_CANONICAL_PROMPT).toContain(marker);
    }
    expect(ONBOARDING_CANONICAL_PROMPT).toContain('Never rewrite');
  });

  it('operational instructions are non-empty', () => {
    expect(getOnboardingSurveyInstructions().length).toBeGreaterThan(0);
    expect(getOnboardingSceneInstructions().length).toBeGreaterThan(0);
  });
});

describe('onboarding prompt builders', () => {
  it('survey prompt lists scene openings in reading order, without file names', () => {
    const prompt = buildOnboardingSurveyPrompt([
      { opening: 'On Ithaca.' },
      { opening: 'At Troy.' },
    ]);
    expect(prompt).toContain('On Ithaca.');
    expect(prompt.indexOf('On Ithaca.')).toBeLessThan(prompt.indexOf('At Troy.'));
    // File names are deliberately excluded (53b22416): the survey must derive
    // subplots from the prose, never from how the author named their files.
    expect(prompt).not.toContain('01 Ithaca.md');
  });

  it('scene prompt threads survey vocabulary and source metadata', () => {
    const prompt = buildOnboardingScenePrompt({
      body: 'Odysseus returns home.',
      subplotVocabulary: ['Main Plot', 'Homecoming'],
      knownSynopsis: 'He arrives.',
      knownMetadata: { Storyline: 'Homecoming' },
    });
    expect(prompt).toContain('Main Plot');
    expect(prompt).toContain('He arrives.');
    expect(prompt).toContain('Storyline: Homecoming');
    expect(prompt).toContain('Odysseus returns home.');
  });
});
