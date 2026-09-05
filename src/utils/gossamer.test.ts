import { describe, expect, it } from 'vitest';
import { appendGossamerScore, buildAllGossamerRuns, clearAllGossamerData, normalizeGossamerHistory } from './gossamer';
import { toBeatModelMatchKey } from './beatsInputNormalize';

function makeBeat(title: string, fields: Record<string, unknown> = {}) {
  return {
    itemType: 'Beat',
    title,
    'Beat Model': 'Save The Cat',
    ...fields
  };
}

describe('gossamer run inventory', () => {
  it('defaults to showing all runs when no filter state is stored', () => {
    const scenes = [
      makeBeat('1 Opening Image', {
        Gossamer1: 20,
        GossamerRunId1: 'run-1',
        GossamerCreatedAt1: '2026-04-07T10:00:00.000Z',
        GossamerModel1: 'Gemini 3.1 Pro',
        Gossamer2: 40,
        GossamerRunId2: 'run-2',
        GossamerCreatedAt2: '2026-04-07T11:00:00.000Z',
        GossamerModel2: 'GPT-5.4'
      })
    ];

    const allRuns = buildAllGossamerRuns(scenes, 'Save The Cat');

    expect(allRuns.latestOnly).toBe(false);
    expect(allRuns.visibleRunIds).toEqual(['run-1', 'run-2']);
    expect(allRuns.current.meta?.id).toBe('run-2');
    expect(allRuns.historical).toHaveLength(1);
  });

  it('reconstructs multiple runs for one beat system and uses the latest visible run as current', () => {
    const scenes = [
      makeBeat('1 Opening Image', {
        Gossamer1: 20,
        GossamerRunId1: 'run-1',
        GossamerCreatedAt1: '2026-04-07T10:00:00.000Z',
        GossamerProvider1: 'google',
        GossamerModel1: 'Gemini 3.1 Pro',
        rawFrontmatter: {
          Gossamer2: 40,
          GossamerRunId2: 'run-2',
          GossamerCreatedAt2: '2026-04-07T11:00:00.000Z',
          GossamerProvider2: 'openai',
          GossamerModel2: 'GPT-5.4'
        }
      }),
      makeBeat('2 Theme Stated', {
        Gossamer1: 35,
        GossamerRunId1: 'run-1',
        GossamerCreatedAt1: '2026-04-07T10:00:00.000Z',
        GossamerProvider1: 'google',
        GossamerModel1: 'Gemini 3.1 Pro',
        rawFrontmatter: {
          Gossamer2: 55,
          GossamerRunId2: 'run-2',
          GossamerCreatedAt2: '2026-04-07T11:00:00.000Z',
          GossamerProvider2: 'openai',
          GossamerModel2: 'GPT-5.4'
        }
      })
    ];

    const allRuns = buildAllGossamerRuns(scenes, 'Save The Cat', {
      latestOnly: false,
      beatSystemKey: toBeatModelMatchKey('Save The Cat')
    });

    expect(allRuns.runs).toHaveLength(2);
    expect(allRuns.runs.map((run) => run.id)).toEqual(['run-1', 'run-2']);
    expect(allRuns.current.meta?.id).toBe('run-2');
    expect(allRuns.historical).toHaveLength(1);
    expect(allRuns.historical[0]?.runIndex).toBe(1);
    expect(allRuns.visibleModelCount).toBe(2);
  });

  it('filters to explicit visible runs when latest-only is off', () => {
    const scenes = [
      makeBeat('1 Opening Image', {
        Gossamer1: 10,
        GossamerRunId1: 'run-1',
        GossamerCreatedAt1: '2026-04-07T10:00:00.000Z',
        GossamerModel1: 'Gemini 3.1 Pro',
        Gossamer2: 60,
        GossamerRunId2: 'run-2',
        GossamerCreatedAt2: '2026-04-07T11:00:00.000Z',
        GossamerModel2: 'GPT-5.4'
      })
    ];

    const filtered = buildAllGossamerRuns(scenes, 'Save The Cat', {
      latestOnly: false,
      visibleRunIds: ['run-1'],
      beatSystemKey: toBeatModelMatchKey('Save The Cat')
    });

    expect(filtered.visibleRunIds).toEqual(['run-1']);
    expect(filtered.current.meta?.id).toBe('run-1');
    expect(filtered.historical).toHaveLength(0);
  });

  it('falls back to show all when the beat system changes', () => {
    const scenes = [
      makeBeat('1 Opening Image', {
        Gossamer1: 10,
        GossamerRunId1: 'run-1',
        GossamerCreatedAt1: '2026-04-07T10:00:00.000Z',
        GossamerModel1: 'Gemini 3.1 Pro',
        Gossamer2: 60,
        GossamerRunId2: 'run-2',
        GossamerCreatedAt2: '2026-04-07T11:00:00.000Z',
        GossamerModel2: 'GPT-5.4'
      })
    ];

    const filtered = buildAllGossamerRuns(scenes, 'Save The Cat', {
      latestOnly: true,
      visibleRunIds: ['run-2'],
      beatSystemKey: toBeatModelMatchKey('Story Circle')
    });

    expect(filtered.latestOnly).toBe(false);
    expect(filtered.visibleRunIds).toEqual(['run-1', 'run-2']);
    expect(filtered.current.meta?.id).toBe('run-2');
  });
});

describe('gossamer slot persistence', () => {
  it('shifts metadata with the score when the history is full', () => {
    const frontmatter = {
      Gossamer1: 15,
      GossamerRunId1: 'run-1',
      GossamerProvider1: 'google',
      GossamerModel1: 'Gemini 3.1 Pro',
      GossamerStage1: 'Zero',
      Gossamer2: 45,
      GossamerRunId2: 'run-2',
      GossamerProvider2: 'openai',
      GossamerModel2: 'GPT-5.4',
      GossamerStage2: 'Author'
    };

    const { nextIndex, updated } = appendGossamerScore(frontmatter, 2);

    expect(nextIndex).toBe(2);
    expect(updated.Gossamer1).toBe(45);
    expect(updated.GossamerRunId1).toBe('run-2');
    expect(updated.GossamerProvider1).toBe('openai');
    expect(updated.GossamerModel1).toBe('GPT-5.4');
    expect(updated.GossamerStage1).toBe('Author');
    expect(updated.Gossamer2).toBeUndefined();
    expect(updated.GossamerRunId2).toBeUndefined();
  });

  it('renumbers fragmented history without losing slot metadata', () => {
    const frontmatter = {
      Gossamer1: 15,
      GossamerRunId1: 'run-1',
      GossamerModel1: 'Gemini 3.1 Pro',
      Gossamer3: 45,
      GossamerRunId3: 'run-3',
      GossamerProvider3: 'openai',
      GossamerModel3: 'GPT-5.4',
      GossamerStage3: 'Author'
    };

    const { normalized, changed } = normalizeGossamerHistory(frontmatter);

    expect(changed).toBe(true);
    expect(normalized.Gossamer1).toBe(15);
    expect(normalized.GossamerRunId1).toBe('run-1');
    expect(normalized.Gossamer2).toBe(45);
    expect(normalized.GossamerRunId2).toBe('run-3');
    expect(normalized.GossamerProvider2).toBe('openai');
    expect(normalized.GossamerModel2).toBe('GPT-5.4');
    expect(normalized.GossamerStage2).toBe('Author');
  });
});

describe('clearAllGossamerData', () => {
  it('strips every signal slot plus legacy fields, preserving non-Gossamer keys', () => {
    const frontmatter: Record<string, unknown> = {
      ID: 'scn_9cc52149',
      Class: 'Beat',
      Act: 1,
      'Gossamer Last Updated': 'Apr 22, 2026, 7:37 AM by gpt-5.4',
      Gossamer3: 20,
      'Gossamer3 Justification': 'satirical and external',
      GossamerStage3: 'Press',
      GossamerRunId3: 'goss-mo9jchii-6zs1zw',
      GossamerSignal3: 'interiority',
      Gossamer4: 35,
      GossamerSignal4: 'activity',
      Gossamer5: 18,
      GossamerSignal5: 'tension'
    };

    const removed = clearAllGossamerData(frontmatter);

    expect(removed).toBe(true);
    // Non-Gossamer keys survive untouched.
    expect(frontmatter.ID).toBe('scn_9cc52149');
    expect(frontmatter.Class).toBe('Beat');
    expect(frontmatter.Act).toBe(1);
    // No Gossamer key of any signal or legacy field remains.
    const leftover = Object.keys(frontmatter).filter((k) => k.startsWith('Gossamer'));
    expect(leftover).toEqual([]);
  });

  it('returns false when there is no Gossamer data to remove', () => {
    const frontmatter: Record<string, unknown> = { ID: 'scn_1', Class: 'Beat' };
    expect(clearAllGossamerData(frontmatter)).toBe(false);
    expect(Object.keys(frontmatter)).toEqual(['ID', 'Class']);
  });
});
