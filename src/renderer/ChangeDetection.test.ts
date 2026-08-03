import { describe, expect, it, vi } from 'vitest';
import { ChangeType, createSnapshot, detectChanges, type TimelineSnapshot } from './ChangeDetection';

vi.mock('../services/VersionCheckService', () => ({
  getVersionCheckService: () => ({ isUpdateAvailable: () => false })
}));

function makeSnapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return {
    sceneCount: 1,
    sceneHash: 'scene-hash',
    sceneVisualHash: 'scene-visual-hash',
    openFilePaths: new Set(),
    searchActive: false,
    searchResults: new Set(),
    currentMode: 'narrative',
    currentMonth: 0,
    currentDate: '2026-03-23',
    sortByWhen: false,
    aiEnabled: false,
    targetDate: undefined,
    stageTargetDatesHash: 'Zero:|Author:|House:|Press:',
    chronologueDurationCap: undefined,
    discontinuityThreshold: undefined,
    showBackdropRing: true,
    microBackdropHash: '',
    publishStageColorsHash: '',
    subplotColorsHash: '',
    dominantSubplotsHash: '',
    povMode: 'off',
    gossamerRunExists: false,
    gossamerRunHash: '',
    updateAvailable: false,
    runtimeModeActive: false,
    activeBookId: '',
    activeBookTitle: 'Untitled Book',
    readabilityScale: 'normal',
    showChapterMarkers: false,
    activeNovelPandocLayoutId: '',
    recentMovesHash: '',
    timestamp: 1,
    ...overrides
  };
}

describe('detectChanges', () => {
  it('forces a full render when dominant subplot preferences change', () => {
    const prev = makeSnapshot();
    const current = makeSnapshot({
      dominantSubplotsHash: '{"scene.md":"Romance"}',
      timestamp: 2
    });

    const result = detectChanges(prev, current);

    expect(result.changeTypes.has(ChangeType.DOMINANT_SUBPLOT)).toBe(true);
    expect(result.canUseSelectiveUpdate).toBe(false);
    expect(result.updateStrategy).toBe('full');
  });

  it('uses a selective update when per-stage target dates change', () => {
    const prev = makeSnapshot();
    const current = makeSnapshot({
      stageTargetDatesHash: 'Zero:2026-07-01|Author:|House:|Press:',
      timestamp: 2
    });

    const result = detectChanges(prev, current);

    expect(result.changeTypes.has(ChangeType.TARGET_DATES)).toBe(true);
    expect(result.canUseSelectiveUpdate).toBe(true);
    expect(result.updateStrategy).toBe('selective');
  });

  it('uses a selective update when the legacy target date changes', () => {
    const prev = makeSnapshot();
    const current = makeSnapshot({
      targetDate: '2026-07-01',
      timestamp: 2
    });

    const result = detectChanges(prev, current);

    expect(result.changeTypes.has(ChangeType.TARGET_DATES)).toBe(true);
    expect(result.canUseSelectiveUpdate).toBe(true);
    expect(result.updateStrategy).toBe('selective');
  });

  it('uses a selective update when only scene visual data changes', () => {
    const prev = makeSnapshot();
    const current = makeSnapshot({
      sceneVisualHash: 'scene-visual-hash:working',
      timestamp: 2
    });

    const result = detectChanges(prev, current);

    expect(result.changeTypes.has(ChangeType.SCENE_VISUAL)).toBe(true);
    expect(result.canUseSelectiveUpdate).toBe(true);
    expect(result.updateStrategy).toBe('selective');
  });

  it('forces a full render when a scene Chapter marker changes', () => {
    const base = createSnapshot(
      [{ path: 'scene.md', title: 'Scene', rawFrontmatter: {} } as never],
      new Set(),
      false,
      new Set(),
      'narrative',
      {} as never,
      null
    );
    const withChapter = createSnapshot(
      [{ path: 'scene.md', title: 'Scene', rawFrontmatter: { Chapter: 'Arrival' } } as never],
      new Set(),
      false,
      new Set(),
      'narrative',
      {} as never,
      null
    );

    const result = detectChanges(base, withChapter);

    expect(base.sceneHash).not.toBe(withChapter.sceneHash);
    expect(result.changeTypes.has(ChangeType.SCENE_DATA)).toBe(true);
    expect(result.canUseSelectiveUpdate).toBe(false);
    expect(result.updateStrategy).toBe('full');
  });

  it('forces a full render when a scene Part marker changes', () => {
    // Without Part in the signature the hash is identical, the renderer skips
    // the redraw, and the badge never appears until something unrelated
    // forces one — which reads as "setting a part did nothing".
    const snapshot = (frontmatter: Record<string, unknown>) => createSnapshot(
      [{ path: 'scene.md', title: 'Scene', rawFrontmatter: frontmatter } as never],
      new Set(),
      false,
      new Set(),
      'narrative',
      {} as never,
      null
    );

    const base = snapshot({});
    const withPart = snapshot({ Part: true });

    const result = detectChanges(base, withPart);

    expect(base.sceneHash).not.toBe(withPart.sceneHash);
    expect(result.changeTypes.has(ChangeType.SCENE_DATA)).toBe(true);
    expect(result.updateStrategy).toBe('full');
  });

  it('distinguishes an untitled Part from a titled one, and from a retitle', () => {
    const snapshot = (frontmatter: Record<string, unknown>) => createSnapshot(
      [{ path: 'scene.md', title: 'Scene', rawFrontmatter: frontmatter } as never],
      new Set(),
      false,
      new Set(),
      'narrative',
      {} as never,
      null
    );

    const untitled = snapshot({ Part: true });
    const titled = snapshot({ Part: 'The Crossing' });
    const retitled = snapshot({ Part: 'The Gathering' });

    expect(untitled.sceneHash).not.toBe(titled.sceneHash);
    expect(titled.sceneHash).not.toBe(retitled.sceneHash);
  });

  it('does not redraw for an empty Part value, which is not a marker', () => {
    const snapshot = (frontmatter: Record<string, unknown>) => createSnapshot(
      [{ path: 'scene.md', title: 'Scene', rawFrontmatter: frontmatter } as never],
      new Set(),
      false,
      new Set(),
      'narrative',
      {} as never,
      null
    );

    expect(snapshot({}).sceneHash).toBe(snapshot({ Part: '' }).sceneHash);
  });

  it('forces a full render when Gossamer run data changes so the run list refreshes', () => {
    const prev = makeSnapshot({
      currentMode: 'gossamer',
      gossamerRunExists: true,
      gossamerRunHash: 'run-1'
    });
    const current = makeSnapshot({
      currentMode: 'gossamer',
      gossamerRunExists: true,
      gossamerRunHash: 'run-2',
      timestamp: 2
    });

    const result = detectChanges(prev, current);

    expect(result.changeTypes.has(ChangeType.GOSSAMER)).toBe(true);
    expect(result.canUseSelectiveUpdate).toBe(false);
    expect(result.updateStrategy).toBe('full');
  });

  it('forces a full render when the active novel PDF layout changes', () => {
    const prev = makeSnapshot({
      activeNovelPandocLayoutId: 'bundled-fiction-signature-literary'
    });
    const current = makeSnapshot({
      activeNovelPandocLayoutId: 'bundled-fiction-modern-classic',
      timestamp: 2
    });

    const result = detectChanges(prev, current);

    expect(result.changeTypes.has(ChangeType.SETTINGS)).toBe(true);
    expect(result.canUseSelectiveUpdate).toBe(false);
    expect(result.updateStrategy).toBe('full');
  });
});
