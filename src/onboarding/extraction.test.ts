import { describe, it, expect } from 'vitest';
import {
  parseSurveyResult,
  parseSceneExtraction,
  buildSceneFrontmatter,
  sanitizeName,
  toWikiLink,
  linkedEntities,
  type SceneExtraction,
} from './extraction';

function extraction(over: Partial<SceneExtraction> = {}): SceneExtraction {
  return {
    act: 1,
    synopsis: 'Odysseus returns home.',
    subplot: ['Main Plot'],
    character: ['Odysseus'],
    place: ['Ithaca'],
    when: null,
    duration: null,
    flags: [],
    ...over,
  };
}

describe('parseSurveyResult', () => {
  it('parses a well-formed survey', () => {
    const raw = JSON.stringify({
      acts: [{ act: 1, startsAtScene: '01 A.md' }],
      subplots: ['Main Plot'],
      scenes: [{ fileName: '01 A.md', isScene: true }],
    });
    const result = parseSurveyResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.subplots).toEqual(['Main Plot']);
  });

  it('defaults isScene to true when omitted, false only when explicit', () => {
    const raw = JSON.stringify({ scenes: [{ fileName: 'a' }, { fileName: 'b', isScene: false }] });
    const result = parseSurveyResult(raw);
    if (result.ok) {
      expect(result.value.scenes[0].isScene).toBe(true);
      expect(result.value.scenes[1].isScene).toBe(false);
    }
  });

  it('fails on non-JSON', () => {
    expect(parseSurveyResult('not json').ok).toBe(false);
    expect(parseSurveyResult('').ok).toBe(false);
  });
});

describe('parseSceneExtraction', () => {
  it('parses and trims a valid scene', () => {
    const raw = JSON.stringify({
      act: 2,
      synopsis: '  He arrives.  ',
      subplot: ['Main Plot'],
      character: ['Odysseus'],
      place: ['Ithaca'],
      when: '-800',
      duration: null,
      flags: ['When'],
    });
    const result = parseSceneExtraction(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.synopsis).toBe('He arrives.');
      expect(result.value.flags).toEqual(['When']);
    }
  });

  it('fails when synopsis is missing (single-attempt, surfaced not repaired)', () => {
    const raw = JSON.stringify({ act: 1 });
    const result = parseSceneExtraction(raw);
    expect(result.ok).toBe(false);
  });

  it('coerces a null When/Duration and a blank string to null', () => {
    const raw = JSON.stringify({ synopsis: 'x', when: '   ', duration: null });
    const result = parseSceneExtraction(raw);
    if (result.ok) {
      expect(result.value.when).toBeNull();
      expect(result.value.duration).toBeNull();
    }
  });
});

describe('name sanitization', () => {
  it('strips commas and collapses whitespace', () => {
    expect(sanitizeName('Smith,  John')).toBe('Smith John');
  });
  it('wraps wiki links comma-safe', () => {
    expect(toWikiLink('Athens, Greece')).toBe('[[Athens Greece]]');
  });
});

describe('buildSceneFrontmatter', () => {
  it('produces canonical keys with wiki-linked entities and Complete status', () => {
    const fm = buildSceneFrontmatter(extraction(), { actCount: 3 });
    expect(fm.Class).toBe('Scene');
    expect(fm.Status).toBe('Complete');
    expect(fm['Publish Stage']).toBe('Zero');
    expect(fm.Character).toEqual(['[[Odysseus]]']);
    expect(fm.Place).toEqual(['[[Ithaca]]']);
  });

  it('clamps Act to the configured act count (floor of 3)', () => {
    expect(buildSceneFrontmatter(extraction({ act: 9 }), { actCount: 3 }).Act).toBe(3);
    expect(buildSceneFrontmatter(extraction({ act: 0 }), { actCount: 3 }).Act).toBe(1);
    expect(buildSceneFrontmatter(extraction({ act: 5 }), { actCount: 24 }).Act).toBe(5);
  });

  it('omits When/Duration when the model could not ground them', () => {
    const fm = buildSceneFrontmatter(extraction({ when: null, duration: null }), { actCount: 3 });
    expect(fm).not.toHaveProperty('When');
    expect(fm).not.toHaveProperty('Duration');
  });

  it('writes When/Duration when present', () => {
    const fm = buildSceneFrontmatter(extraction({ when: '1998', duration: '1 hour' }), { actCount: 3 });
    expect(fm.When).toBe('1998');
    expect(fm.Duration).toBe('1 hour');
  });

  it('carries non-canonical metadata but never overwrites a canonical key', () => {
    const fm = buildSceneFrontmatter(extraction(), {
      actCount: 3,
      carriedMetadata: { Storyline: 'Homecoming', Class: 'Nope' },
    });
    expect(fm.Storyline).toBe('Homecoming');
    expect(fm.Class).toBe('Scene');
  });

  it('dedupes repeated characters case-insensitively', () => {
    const fm = buildSceneFrontmatter(extraction({ character: ['Odysseus', 'odysseus', 'Athena'] }), {
      actCount: 3,
    });
    expect(fm.Character).toEqual(['[[Odysseus]]', '[[Athena]]']);
  });
});

describe('linkedEntities', () => {
  it('returns deduped sanitized character + place names for stubbing', () => {
    const names = linkedEntities(extraction({ character: ['Odysseus'], place: ['Ithaca', 'Ithaca'] }));
    expect(names).toEqual(['Odysseus', 'Ithaca']);
  });
});
