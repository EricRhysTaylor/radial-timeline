import { describe, it, expect } from 'vitest';
import {
  isSceneBreakMarker,
  splitIntoParagraphs,
  parseArgumentHeader,
  planSceneSplit,
  toggleBreak,
  segmentCount,
  planSegments,
  scenesFromPlan,
  applySplitsToModel,
  type ScenePlan,
} from './sceneSplitting';
import type { ManuscriptScene, ManuscriptModel } from './adapters/manuscriptModel';

function scene(over: Partial<ManuscriptScene> = {}): ManuscriptScene {
  return {
    title: 'Book 1',
    rawText: '',
    knownMetadata: {},
    knownSynopsis: null,
    sourceRef: 'Book Odyssey/01 Book 1.md',
    alreadyOnboarded: false,
    ...over,
  };
}

describe('isSceneBreakMarker', () => {
  it('recognizes common scene-break glyphs', () => {
    for (const m of ['***', '* * *', '---', '⁂', '###', '. . .', '• • •']) {
      expect(isSceneBreakMarker(m)).toBe(true);
    }
  });
  it('rejects prose', () => {
    expect(isSceneBreakMarker('Tell me, O Muse, of that ingenious hero.')).toBe(false);
    expect(isSceneBreakMarker('A star * in the middle of a sentence.')).toBe(false);
  });
});

describe('splitIntoParagraphs', () => {
  it('splits on blank-line runs and trims', () => {
    expect(splitIntoParagraphs('One.\n\n\nTwo.\n \nThree.')).toEqual(['One.', 'Two.', 'Three.']);
  });
});

describe('parseArgumentHeader', () => {
  it('parses a Butler-style argument line into sentence-cased labels', () => {
    const text =
      'THE GODS IN COUNCIL—MINERVA’S VISIT TO ITHACA—THE CHALLENGE FROM TELEMACHUS TO THE SUITORS.\n\n' +
      'Tell me, O Muse, of that ingenious hero.';
    const { labels, body } = parseArgumentHeader(text);
    expect(labels).toEqual([
      'The gods in council',
      'Minerva’s visit to ithaca',
      'The challenge from telemachus to the suitors',
    ]);
    expect(body).toBe('Tell me, O Muse, of that ingenious hero.');
  });

  it('ignores a normal prose first paragraph', () => {
    const text = 'Tell me, O Muse, of that ingenious hero — who travelled far.\n\nMany cities did he visit.';
    const { labels, body } = parseArgumentHeader(text);
    expect(labels).toEqual([]);
    expect(body).toBe(text);
  });

  it('requires at least two dash-separated clauses', () => {
    expect(parseArgumentHeader('THE GODS IN COUNCIL.\n\nProse.').labels).toEqual([]);
  });
});

describe('planSceneSplit + markers', () => {
  it('turns marker paragraphs into breaks and drops them from prose', () => {
    const plan = planSceneSplit(scene({ rawText: 'Scene one para.\n\n***\n\nScene two para.\n\nStill two.' }));
    expect(plan.paragraphs).toEqual(['Scene one para.', 'Scene two para.', 'Still two.']);
    expect(plan.breaks).toEqual([1]);
    expect(segmentCount(plan)).toBe(2);
    const segs = planSegments(plan);
    expect(segs.map((s) => s.text)).toEqual(['Scene one para.', 'Scene two para.\n\nStill two.']);
  });

  it('yields one scene when there are no markers or argument', () => {
    const plan = planSceneSplit(scene({ rawText: 'Para one.\n\nPara two.' }));
    expect(plan.breaks).toEqual([]);
    expect(segmentCount(plan)).toBe(1);
    expect(planSegments(plan)[0].title).toBe('Book 1');
  });
});

describe('argument-driven titling', () => {
  it('titles segments from argument labels once the author adds breaks', () => {
    const text =
      'THE COUNCIL—THE VISIT—THE CHALLENGE.\n\nAlpha para.\n\nBeta para.\n\nGamma para.';
    const plan = planSceneSplit(scene({ rawText: text }));
    expect(plan.labels).toEqual(['The council', 'The visit', 'The challenge']);
    // No markers → starts as one scene; author adds two breaks.
    plan.breaks = toggleBreak(plan, 1);
    plan.breaks = toggleBreak(plan, 2);
    expect(segmentCount(plan)).toBe(3);
    expect(planSegments(plan).map((s) => s.title)).toEqual([
      'Book 1 — The council',
      'Book 1 — The visit',
      'Book 1 — The challenge',
    ]);
  });
});

describe('toggleBreak', () => {
  it('adds and removes a break, ignoring out-of-range indices', () => {
    const plan = planSceneSplit(scene({ rawText: 'a\n\nb\n\nc' }));
    expect(toggleBreak(plan, 1)).toEqual([1]);
    plan.breaks = [1];
    expect(toggleBreak(plan, 1)).toEqual([]); // toggles off
    expect(toggleBreak(plan, 0)).toEqual([1]); // index 0 is implicit start
    expect(toggleBreak(plan, 9)).toEqual([1]); // past the end
  });
});

describe('scenesFromPlan', () => {
  it('splits into multiple scenes with #n sourceRefs and synopsis only on the first', () => {
    const plan = planSceneSplit(scene({ rawText: 'one\n\n***\n\ntwo', knownSynopsis: 'whole-file synopsis' }));
    const scenes = scenesFromPlan(plan);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].sourceRef).toBe('Book Odyssey/01 Book 1.md#1');
    expect(scenes[1].sourceRef).toBe('Book Odyssey/01 Book 1.md#2');
    expect(scenes[0].knownSynopsis).toBe('whole-file synopsis');
    expect(scenes[1].knownSynopsis).toBeNull();
  });

  it('never splits an already-onboarded note', () => {
    const plan = planSceneSplit(scene({ rawText: 'one\n\n***\n\ntwo', alreadyOnboarded: true }));
    expect(scenesFromPlan(plan)).toHaveLength(1);
  });

  it('strips the argument header from the single-scene body', () => {
    const plan = planSceneSplit(scene({ rawText: 'THE COUNCIL—THE VISIT.\n\nProse body.' }));
    expect(scenesFromPlan(plan)[0].rawText).toBe('Prose body.');
  });
});

describe('applySplitsToModel', () => {
  it('expands split scenes in place and leaves unplanned scenes untouched', () => {
    const model: ManuscriptModel = {
      sourceKind: 'md',
      customFields: [],
      chapters: [{
        title: null,
        scenes: [
          scene({ sourceRef: 'a.md', rawText: 'x\n\n***\n\ny' }),
          scene({ sourceRef: 'b.md', title: 'Book 2', rawText: 'solo' }),
        ],
      }],
    };
    const plans = new Map<string, ScenePlan>();
    plans.set('a.md', planSceneSplit(model.chapters[0].scenes[0]));
    const out = applySplitsToModel(model, plans);
    expect(out.chapters[0].scenes.map((s) => s.sourceRef)).toEqual(['a.md#1', 'a.md#2', 'b.md']);
  });
});
