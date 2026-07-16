import { describe, it, expect } from 'vitest';
import {
  parseSurveyResult,
  parseSceneExtraction,
  parseEntityEnrichment,
  parseSplitProposal,
  capSubplotVocabulary,
  enforceSubplotVocabulary,
  MAX_SUBPLOTS,
  buildSceneFrontmatter,
  sanitizeName,
  toWikiLink,
  linkedCharacters,
  linkedPlaces,
  effectiveFlags,
  MAX_CHARACTERS,
  MAX_PLACES,
  type SceneExtraction,
} from './extraction';

function extraction(over: Partial<SceneExtraction> = {}): SceneExtraction {
  return {
    act: 1,
    title: 'Homecoming',
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

describe('capSubplotVocabulary', () => {
  it('puts Main Plot first, dedupes case-insensitively, and caps at MAX_SUBPLOTS', () => {
    const many = ['main plot', 'Revenge', 'revenge', ...Array.from({ length: 30 }, (_, i) => `Thread ${i}`)];
    const capped = capSubplotVocabulary(many);
    expect(capped[0]).toBe('Main Plot');
    expect(capped.filter((s) => s.toLowerCase() === 'revenge')).toHaveLength(1);
    expect(capped.length).toBeLessThanOrEqual(MAX_SUBPLOTS);
  });
});

describe('enforceSubplotVocabulary', () => {
  const vocab = ['Main Plot', 'Telemachus’ Journey', 'Divine Intervention'];
  it('keeps only vocabulary names, restoring canonical casing', () => {
    expect(enforceSubplotVocabulary(['divine intervention', 'The Wine-Dark Sea'], vocab))
      .toEqual(['Divine Intervention']);
  });
  it('falls back to Main Plot when nothing matches or vocabulary is empty', () => {
    expect(enforceSubplotVocabulary(['Invented Thread'], vocab)).toEqual(['Main Plot']);
    expect(enforceSubplotVocabulary(['Anything'], [])).toEqual(['Main Plot']);
  });
});

describe('parseSplitProposal', () => {
  it('parses scene starts and labels', () => {
    const raw = JSON.stringify({
      scenes: [
        { startParagraph: 1, label: 'The gods in council' },
        { startParagraph: 9, label: "Minerva's visit" },
      ],
    });
    const result = parseSplitProposal(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.starts).toEqual([1, 9]);
      expect(result.value.labels).toEqual(['The gods in council', "Minerva's visit"]);
    }
  });

  it('skips malformed entries and floors non-integers', () => {
    const raw = JSON.stringify({ scenes: [{ startParagraph: 3.7, label: 'A' }, { label: 'no start' }] });
    const result = parseSplitProposal(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.starts).toEqual([3]);
  });

  it('fails when scenes is missing', () => {
    expect(parseSplitProposal(JSON.stringify({})).ok).toBe(false);
    expect(parseSplitProposal('nope').ok).toBe(false);
  });
});

describe('parseEntityEnrichment', () => {
  it('parses role and summary, collapsing role whitespace', () => {
    const raw = JSON.stringify({ role: "Odysseus'  son\n and heir", summary: 'He sails to Pylos seeking news.' });
    const result = parseEntityEnrichment(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.role).toBe("Odysseus' son and heir");
      expect(result.value.summary).toBe('He sails to Pylos seeking news.');
    }
  });

  it('tolerates missing fields (blank rather than throwing)', () => {
    const result = parseEntityEnrichment(JSON.stringify({}));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.role).toBe('');
      expect(result.value.summary).toBe('');
    }
  });

  it('fails on non-JSON', () => {
    expect(parseEntityEnrichment('not json').ok).toBe(false);
  });
});

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

  it('writes the chosen publish stage when one is supplied', () => {
    const fm = buildSceneFrontmatter(extraction(), { actCount: 3, publishStage: 'Press' });
    expect(fm['Publish Stage']).toBe('Press');
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

describe('linked entities (stub sources)', () => {
  it('returns deduped sanitized names, split by type', () => {
    const e = extraction({ character: ['Odysseus', 'Odysseus'], place: ['Ithaca'] });
    expect(linkedCharacters(e)).toEqual(['Odysseus']);
    expect(linkedPlaces(e)).toEqual(['Ithaca']);
  });

  it('caps runaway entity lists so a chatty model cannot flood the vault', () => {
    const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const e = extraction({ character: many(40, 'C'), place: many(40, 'P') });
    expect(linkedCharacters(e)).toHaveLength(MAX_CHARACTERS);
    expect(linkedPlaces(e)).toHaveLength(MAX_PLACES);
    // The written frontmatter is capped to match, so stubs never exceed links.
    const fm = buildSceneFrontmatter(e, { actCount: 3 });
    expect(fm.Character).toHaveLength(MAX_CHARACTERS);
    expect(fm.Place).toHaveLength(MAX_PLACES);
  });
});

describe('effectiveFlags', () => {
  it('drops When/Duration flags when the model returned null (nothing was written)', () => {
    const e = extraction({ when: null, duration: null, flags: ['Act', 'When', 'Duration'] });
    expect(effectiveFlags(e)).toEqual(['Act']);
  });

  it('normalizes casing and dedupes ("act" and "Act" become one "Act")', () => {
    const e = extraction({ flags: ['act', 'Act', 'ACT'] });
    expect(effectiveFlags(e)).toEqual(['Act']);
  });

  it('keeps When/Duration flags when those fields were actually filled in', () => {
    const e = extraction({ when: '1998', duration: '1 hour', flags: ['When', 'Duration'] });
    expect(effectiveFlags(e)).toEqual(['When', 'Duration']);
  });
});
