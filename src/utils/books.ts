/*
 * Book profile helpers
 */
import { slugifyToFileStem } from './slug';
import type { BeatDefinition, BeatSystemConfig, BeatWorkspaceState, BookProfile, LoadedBeatTab, ManuscriptSceneHeadingMode, RadialTimelineSettings } from '../types/settings';
import type { TimelineItem } from '../types/timeline';
import { normalizeRecentStructuralMoves } from './recentStructuralMoves';

export const DEFAULT_BOOK_TITLE = 'Untitled Manuscript';

export function createBookId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto).randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `book_${ts}_${rand}`;
}

export function deriveBookTitleFromSourcePath(sourcePath: string | undefined | null): string | null {
  const trimmed = (sourcePath || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/').filter(p => p.length > 0);
  if (parts.length === 0) return null;
  return parts[parts.length - 1];
}

export function shouldSeedBookProfileFromLegacySettings(params: {
  sourcePath?: string | null;
  legacyTitle?: string | null;
}): boolean {
  return (params.sourcePath || '').trim().length > 0
    || (params.legacyTitle || '').trim().length > 0;
}

export function normalizeBookProfile(profile: BookProfile): BookProfile {
  const title = profile.title?.trim() || DEFAULT_BOOK_TITLE;
  const sourceFolder = (profile.sourceFolder || '').trim();
  const fileStem = profile.fileStem?.trim();
  const genre = profile.genre?.trim();
  const projectStage = profile.projectStage?.trim();
  const publicLabel = profile.publicLabel?.trim();
  const publicDescription = profile.publicDescription?.trim();
  const normalizedLayoutOptions: BookProfile['layoutOptions'] = {};
  const normalizeSceneHeadingMode = (value: unknown): ManuscriptSceneHeadingMode | undefined => {
    if (value === 'scene-number' || value === 'scene-number-title' || value === 'title-only') return value;
    return undefined;
  };
  for (const [layoutId, options] of Object.entries(profile.layoutOptions || {})) {
    const layoutKey = layoutId.trim();
    if (!layoutKey) continue;
    const normalizeList = (values: unknown): string[] | undefined => {
      if (!Array.isArray(values)) return undefined;
      const normalized = values.map(value => (typeof value === 'string' ? value.trim() : ''));
      let lastNonEmptyIndex = -1;
      for (let i = 0; i < normalized.length; i++) {
        if (normalized[i].length > 0) lastNonEmptyIndex = i;
      }
      if (lastNonEmptyIndex < 0) return undefined;
      return normalized.slice(0, lastNonEmptyIndex + 1);
    };
    // `actEpigraphs` was the stored name while Parts were derived from Acts.
    // Read it as a fallback so an author's existing epigraph text survives the
    // rename; the normalized profile is written back under the new name, so the
    // legacy key disappears on first save without anything being lost.
    const legacy = options as { actEpigraphs?: unknown; actEpigraphAttributions?: unknown };
    const partEpigraphs = normalizeList(options?.partEpigraphs)
      ?? normalizeList(legacy?.actEpigraphs);
    const partEpigraphAttributions = normalizeList(options?.partEpigraphAttributions)
      ?? normalizeList(legacy?.actEpigraphAttributions);
    const sceneHeadingMode = normalizeSceneHeadingMode(options?.sceneHeadingMode);
    if (!partEpigraphs && !partEpigraphAttributions && !sceneHeadingMode) continue;
    normalizedLayoutOptions[layoutKey] = {
      ...(partEpigraphs ? { partEpigraphs } : {}),
      ...(partEpigraphAttributions ? { partEpigraphAttributions } : {}),
      ...(sceneHeadingMode ? { sceneHeadingMode } : {})
    };
  }

  const normalizedBookPageOrder = Array.isArray(profile.bookPageOrder)
    ? profile.bookPageOrder
        .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(entry => entry.length > 0)
    : undefined;

  // Publishing target dates: keep every valid YYYY-MM-DD entry. Dropping this
  // field here once wiped all target dates on every settings load.
  const normalizedStageTargetDates: NonNullable<BookProfile['stageTargetDates']> = {};
  for (const stage of ['Zero', 'Author', 'House', 'Press'] as const) {
    const date = profile.stageTargetDates?.[stage];
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      normalizedStageTargetDates[stage] = date;
    }
  }

  return {
    id: profile.id || createBookId(),
    title,
    sourceFolder,
    fileStem: fileStem && fileStem.length > 0 ? fileStem : undefined,
    ...(genre && genre.length > 0 ? { genre } : {}),
    ...(projectStage && projectStage.length > 0 ? { projectStage } : {}),
    ...(publicLabel && publicLabel.length > 0 ? { publicLabel } : {}),
    ...(publicDescription && publicDescription.length > 0 ? { publicDescription } : {}),
    ...(Object.keys(normalizedStageTargetDates).length > 0 ? { stageTargetDates: normalizedStageTargetDates } : {}),
    ...(profile.lastUsedPandocLayoutByPreset ? { lastUsedPandocLayoutByPreset: { ...profile.lastUsedPandocLayoutByPreset } } : {}),
    ...(Object.keys(normalizedLayoutOptions).length > 0 ? { layoutOptions: normalizedLayoutOptions } : {}),
    ...(normalizeBeatWorkspace(profile.beatWorkspace) ? { beatWorkspace: normalizeBeatWorkspace(profile.beatWorkspace) } : {}),
    ...(normalizeRecentStructuralMoves(profile.recentStructuralMoves) ? { recentStructuralMoves: normalizeRecentStructuralMoves(profile.recentStructuralMoves) } : {}),
    ...(normalizedBookPageOrder && normalizedBookPageOrder.length > 0 ? { bookPageOrder: normalizedBookPageOrder } : {})
  };
}

export function getSequencedBooks(
  books: BookProfile[] | undefined
): Array<{ book: BookProfile; sequenceNumber: number }> {
  return (books || []).map((book, index) => ({
    book,
    sequenceNumber: index + 1
  }));
}

export function getBookSequenceNumber(
  settings: Pick<RadialTimelineSettings, 'books'>,
  bookId: string | undefined
): number | undefined {
  if (!bookId) return undefined;
  const match = getSequencedBooks(settings.books).find(entry => entry.book.id === bookId);
  return match?.sequenceNumber;
}

export function getActiveBook(settings: RadialTimelineSettings): BookProfile | null {
  const books = settings.books || []; // SAFE: pre-Book-Manager vaults have no books array; callers read empty as "no books yet"
  if (!books.length) return null;
  const active = settings.activeBookId
    ? books.find(b => b.id === settings.activeBookId)
    : undefined;
  return active || books[0] || null;
}

/**
 * Whether a scene belongs to the given book. Canonical book-membership
 * predicate: explicit bookId wins, then bookTitle, then source-folder
 * containment. No book profile means a single-book vault — every scene
 * belongs.
 */
export function isSceneInBook(scene: TimelineItem, book: BookProfile | null | undefined): boolean {
  if (!book) return true;
  if (scene.bookId) return scene.bookId === book.id;
  if (scene.bookTitle) return scene.bookTitle === book.title;
  const sourceFolder = book.sourceFolder;
  return sourceFolder ? Boolean(scene.path?.startsWith(`${sourceFolder}/`) || scene.path === sourceFolder) : true;
}

/**
 * Publishing target dates for the active book. Canonical accessor — target
 * dates are per-book (BookProfile.stageTargetDates); the legacy vault-global
 * settings field is migrated on load and never read at runtime. Structural
 * param type so narrower renderer facades can call it too.
 */
export function getActiveStageTargetDates(
  settings: { books?: BookProfile[]; activeBookId?: string }
): NonNullable<BookProfile['stageTargetDates']> {
  const books = settings.books || []; // SAFE: pre-Book-Manager vaults have no books array; callers read empty as "no books yet"
  const active = (settings.activeBookId ? books.find(b => b.id === settings.activeBookId) : undefined) || books[0];
  return active?.stageTargetDates ?? {}; // SAFE: a book with no target dates set yet has none to report
}

export function getActiveBookTitle(settings: RadialTimelineSettings, fallback = DEFAULT_BOOK_TITLE): string {
  const active = getActiveBook(settings);
  const title = active?.title?.trim();
  return title && title.length > 0 ? title : fallback;
}

export function getActiveBookSourceFolder(settings: RadialTimelineSettings): string {
  const active = getActiveBook(settings);
  return (active?.sourceFolder || '').trim();
}

export function isSagaScopeAvailable(
  settings: Pick<RadialTimelineSettings, 'books'>
): boolean {
  return getSagaBooks(settings).length >= 2;
}

export function getTimelineScope(
  settings: Pick<RadialTimelineSettings, 'books' | 'timelineScope'>
): 'book' | 'saga' {
  return settings.timelineScope === 'saga' && isSagaScopeAvailable(settings)
    ? 'saga'
    : 'book';
}

export function getTimelineScopeTitle(
  settings: RadialTimelineSettings,
  fallback = DEFAULT_BOOK_TITLE
): string {
  return getTimelineScope(settings) === 'saga'
    ? 'Saga'
    : getActiveBookTitle(settings, fallback);
}

export function getSagaBooks(
  settings: Pick<RadialTimelineSettings, 'books'>
): BookProfile[] {
  return (settings.books || [])
    .map(book => normalizeBookProfile(book))
    .filter(book => book.sourceFolder.trim().length > 0);
}

export function getActiveBookExportContext(settings: RadialTimelineSettings): { sourceFolder: string; title: string; fileStem: string } {
  const title = getActiveBookTitle(settings, DEFAULT_BOOK_TITLE);
  const sourceFolder = getActiveBookSourceFolder(settings);
  const active = getActiveBook(settings);
  const fileStem = (active?.fileStem && active.fileStem.trim().length > 0)
    ? active.fileStem.trim()
    : slugifyToFileStem(title);
  return { sourceFolder, title, fileStem };
}

  const normalizeBeatDefinition = (beat: BeatDefinition): BeatDefinition => {
    const name = typeof beat?.name === 'string' ? beat.name.trim() : '';
    return {
      ...beat,
      name,
      act: typeof beat?.act === 'number' && Number.isFinite(beat.act) ? beat.act : 1,
      purpose: typeof beat?.purpose === 'string' ? beat.purpose.trim() || undefined : undefined,
      id: typeof beat?.id === 'string' ? beat.id.trim() || undefined : undefined,
      range: typeof beat?.range === 'string' ? beat.range.trim() || undefined : undefined,
    };
  };
  const normalizeBeatConfig = (config: BeatSystemConfig | undefined): BeatSystemConfig => ({
    beatYamlAdvanced: typeof config?.beatYamlAdvanced === 'string' ? config.beatYamlAdvanced : '',
    beatHoverMetadataFields: Array.isArray(config?.beatHoverMetadataFields)
      ? config.beatHoverMetadataFields.map((field) => ({
          key: typeof field?.key === 'string' ? field.key.trim() : '',
          label: typeof field?.label === 'string' ? field.label : '',
          icon: typeof field?.icon === 'string' ? field.icon : '',
          enabled: !!field?.enabled,
        })).filter((field) => field.key.length > 0)
      : [],
  });
  const normalizeLoadedBeatTab = (tab: LoadedBeatTab | undefined): LoadedBeatTab | null => {
    const tabId = typeof tab?.tabId === 'string' ? tab.tabId.trim() : '';
    if (!tabId) return null;
    const sourceKind = tab?.sourceKind;
    if (sourceKind !== 'builtin' && sourceKind !== 'starter' && sourceKind !== 'saved' && sourceKind !== 'blank' && sourceKind !== 'detected') {
      return null;
    }
    const name = typeof tab?.name === 'string' ? tab.name.trim() : '';
    return {
      tabId,
      sourceKind,
      sourceId: typeof tab?.sourceId === 'string' && tab.sourceId.trim().length > 0 ? tab.sourceId.trim() : undefined,
      name: name || 'Untitled beat system',
      description: typeof tab?.description === 'string' ? tab.description : '',
      beats: Array.isArray(tab?.beats) ? tab.beats.map(normalizeBeatDefinition).filter((beat) => beat.name.length > 0) : [],
      config: normalizeBeatConfig(tab?.config),
      linkedSavedSystemId: typeof tab?.linkedSavedSystemId === 'string' && tab.linkedSavedSystemId.trim().length > 0
        ? tab.linkedSavedSystemId.trim()
        : undefined,
      dirty: !!tab?.dirty,
    };
  };
  const normalizeBeatWorkspace = (workspace: BeatWorkspaceState | undefined): BeatWorkspaceState | undefined => {
    if (!workspace || typeof workspace !== 'object') return undefined;
    const tabsById: Record<string, LoadedBeatTab> = {};
    for (const [tabId, tab] of Object.entries(workspace.tabsById || {})) {
      const normalized = normalizeLoadedBeatTab({ ...tab, tabId });
      if (!normalized) continue;
      tabsById[normalized.tabId] = normalized;
    }
    const loadedTabIds = Array.isArray(workspace.loadedTabIds)
      ? workspace.loadedTabIds
          .map((tabId) => (typeof tabId === 'string' ? tabId.trim() : ''))
          .filter((tabId) => tabId.length > 0 && !!tabsById[tabId])
      : [];
    const activeTabId = typeof workspace.activeTabId === 'string' && workspace.activeTabId.trim().length > 0
      ? workspace.activeTabId.trim()
      : undefined;
    if (!loadedTabIds.length && !activeTabId) return undefined;
    return {
      loadedTabIds,
      tabsById,
      ...(activeTabId && tabsById[activeTabId] ? { activeTabId } : {}),
    };
  };
