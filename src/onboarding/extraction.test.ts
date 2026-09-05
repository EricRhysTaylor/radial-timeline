import { describe, it, expect } from 'vitest';
import {
  parseSurveyResult,
  parseSceneExtraction,
  parseEntityEnrichment,
  parseSplitProposal,
  capSubplotVocabulary,
  enforceSubplotVocabulary,
  deterministicExtraction,
  sanitizeWhen,
  positionalAct,
  resolveActs,
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
  it('caps a scene to ONE subplot — the first vocabulary match', () => {
    expect(enforceSubplotVocabulary(['telemachus’ journey', 'Divine Intervention'], vocab))
      .toEqual(['Telemachus’ Journey']);
  });
  it('falls back to Main Plot when nothing matches or vocabulary is empty', () => {
    expect(enforceSubplotVocabulary(['Invented Thread'], vocab)).toEqual(['Main Plot']);
    expect(enforceSubplotVocabulary(['Anything'], [])).toEqual(['Main Plot']);
  });
  it('matches across curly/straight apostrophes instead of dropping to Main Plot', () => {
    expect(enforceSubplotVocabulary(["Telemachus' Journey"], vocab)).toEqual(['Telemachus’ Journey']);
  });
});

describe('sanitizeWhen', () => {
  it('rejects zeroed placeholder dates the model fabricates', () => {
    expect(sanitizeWhen('0000-00-00')).toBeNull();
    expect(sanitizeWhen('0000-01-01')).toBeNull(); // renders as "1900 Jan 1" downstream
    expect(sanitizeWhen('0000')).toBeNull();
    expect(sanitizeWhen('1184-00-12')).toBeNull();
    expect(sanitizeWhen('1184-03-00')).toBeNull();
  });

  it('keeps real in-world dates and bare years', () => {
    expect(sanitizeWhen('1184-03-12')).toBe('1184-03-12');
    expect(sanitizeWhen('1184')).toBe('1184');
    expect(sanitizeWhen('1998-06-01')).toBe('1998-06-01');
    expect(sanitizeWhen(null)).toBeNull();
  });

  it('is applied by parseSceneExtraction (a zeroed When also drops its flag)', () => {
    const raw = JSON.stringify({
      title: 'Sacrifice', synopsis: 'A rite at dawn.', subplot: ['Main Plot'],
      character: [], place: [], when: '0000-01-01', duration: null, flags: ['When'],
    });
    const result = parseSceneExtraction(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.when).toBeNull();
      expect(effectiveFlags(result.value)).toEqual([]); // null When ⇒ no "guessed: When"
    }
  });
});

describe('deterministicExtraction (structure-only mode)', () => {
  it('carries the sidecar synopsis and a mapped Subplot; AI fields stay empty', () => {
    const e = deterministicExtraction({
      knownSynopsis: 'The ferry docks at dawn.',
      knownMetadata: { Subplot: 'Homecoming', Label: 'Travel' },
    });
    expect(e.synopsis).toBe('The ferry docks at dawn.');
    expect(e.subplot).toEqual(['Homecoming']);
    expect(e.character).toEqual([]);
    expect(e.place).toEqual([]);
    expect(e.when).toBeNull();
    expect(e.flags).toEqual([]);
    // Feeding the subplot back as vocabulary keeps the carried thread alive.
    const fm = buildSceneFrontmatter(e, { actCount: 3, subplotVocabulary: e.subplot });
    expect(fm.Subplot).toEqual(['Homecoming']);
    expect(fm.Synopsis).toBe('The ferry docks at dawn.');
  });

  it('yields blank synopsis and Main Plot when the source carried nothing', () => {
    const e = deterministicExtraction({ knownSynopsis: null, knownMetadata: {} });
    expect(e.synopsis).toBe('');
    const fm = buildSceneFrontmatter(e, { actCount: 3, subplotVocabulary: e.subplot });
    expect(fm.Subplot).toEqual(['Main Plot']);
  });

  it('splits mapped Character/Place columns into wiki-linked arrays', () => {
    const e = deterministicExtraction({
      knownSynopsis: null,
      knownMetadata: { Character: 'Newlan; Michi, Aria', Place: 'BowShock' },
    });
    expect(e.character).toEqual(['Newlan', 'Michi', 'Aria']);
    expect(e.place).toEqual(['BowShock']);
    const fm = buildSceneFrontmatter(e, { actCount: 3, subplotVocabulary: e.subplot });
    expect(fm.Character).toEqual(['[[Newlan]]', '[[Michi]]', '[[Aria]]']);
    expect(fm.Place).toEqual(['[[BowShock]]']);
  });

  it('lets a mapped When arrive through carried-metadata gap-fill', () => {
    const e = deterministicExtraction({ knownSynopsis: null, knownMetadata: { When: '1184-06-15' } });
    const fm = buildSceneFrontmatter(e, {
      actCount: 3,
      subplotVocabulary: e.subplot,
      carriedMetadata: { When: '1184-06-15' },
    });
    expect(fm.When).toBe('1184-06-15');
  });
});

describe('positionalAct', () => {
  it('divides 108 scenes into three contiguous acts of 36', () => {
    expect(positionalAct(0, 108, 3)).toBe(1);
    expect(positionalAct(35, 108, 3)).toBe(1);
    expect(positionalAct(36, 108, 3)).toBe(2);
    expect(positionalAct(71, 108, 3)).toBe(2);
    expect(positionalAct(72, 108, 3)).toBe(3);
    expect(positionalAct(107, 108, 3)).toBe(3); // the last scene can never be Act 1
  });
  it('is monotonically non-decreasing and clamps degenerate inputs', () => {
    let last = 1;
    for (let i = 0; i < 10; i++) {
      const act = positionalAct(i, 10, 4);
      expect(act).toBeGreaterThanOrEqual(last);
      last = act;
    }
    expect(positionalAct(5, 0, 3)).toBe(1);
    expect(positionalAct(-2, 10, 3)).toBe(1);
    expect(positionalAct(99, 10, 3)).toBe(3);
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
  it('parses a subplots-only survey and caps the vocabulary', () => {
    const raw = JSON.stringify({ subplots: ['Main Plot', 'Revenge', 'Homecoming'] });
    const result = parseSurveyResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.subplots).toEqual(['Main Plot', 'Revenge', 'Homecoming']);
  });

  it('fails when subplots is missing or empty (real failure, not a one-thread book)', () => {
    expect(parseSurveyResult(JSON.stringify({ subplots: [] })).ok).toBe(false);
    expect(parseSurveyResult(JSON.stringify({})).ok).toBe(false);
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

describe('resolveActs', () => {
  it('uses structural acts with carry-forward for unmarked trailing scenes (Wrapup)', () => {
    expect(resolveActs([1, 1, 2, 2, 3, undefined, undefined], 3)).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });
  it('falls back to positional thirds when no structural acts exist', () => {
    expect(resolveActs([undefined, undefined, undefined], 3)).toEqual([1, 2, 3]);
  });
  it('clamps structural acts into the configured act count', () => {
    expect(resolveActs([1, 5, 5], 3)).toEqual([1, 3, 3]);
  });
  it('leading unmarked scenes stay in act 1', () => {
    expect(resolveActs([undefined, 2, undefined], 3)).toEqual([1, 2, 2]);
  });
});
