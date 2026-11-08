/*
 * Book profile helpers
 */
import { slugifyToFileStem } from './slug';
import type { BeatDefinition, BeatSystemConfig, BeatWorkspaceState, BookProfile, LegacyPersistedSettings, LoadedBeatTab, ManuscriptSceneHeadingMode, NarrationDefaultsMigration, NarrationMode, RadialTimelineSettings } from '../types/settings';
import type { TimelineItem } from '../types/timeline';
import { normalizeRecentStructuralMoves } from './recentStructuralMoves';
import { normalizeOwnSubplotColorsRecord } from './ownSubplotColors';
import { isPathInFolderScope } from './pathScope';
import { isNarrationMode } from './pov';

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
  const mainPlotName = profile.mainPlotName?.trim();
  // Persisted data may hold any string; "not set" is stored as no field at all.
  const storedNarration: unknown = profile.narrationMode;
  const narrationMode = isNarrationMode(storedNarration) && storedNarration !== 'off' ? storedNarration : undefined;
  const ownSubplotColors = normalizeOwnSubplotColorsRecord(profile.ownSubplotColors);
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
    ...(profile.copy?.schemaVersion === 1
      && (profile.copy.kind === 'submission-snapshot' || profile.copy.kind === 'working-draft')
      ? { copy: { ...profile.copy } } : {}),
    ...(typeof profile.includeInSaga === 'boolean' ? { includeInSaga: profile.includeInSaga } : {}),
    fileStem: fileStem && fileStem.length > 0 ? fileStem : undefined,
    ...(genre && genre.length > 0 ? { genre } : {}),
    ...(projectStage && projectStage.length > 0 ? { projectStage } : {}),
    ...(publicLabel && publicLabel.length > 0 ? { publicLabel } : {}),
    ...(publicDescription && publicDescription.length > 0 ? { publicDescription } : {}),
    ...(Object.keys(normalizedStageTargetDates).length > 0 ? { stageTargetDates: normalizedStageTargetDates } : {}),
    ...(mainPlotName && mainPlotName.length > 0 ? { mainPlotName } : {}),
    ...(narrationMode ? { narrationMode } : {}),
    ...(ownSubplotColors ? { ownSubplotColors } : {}),
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

/** Equal, parent and child folders share scene ownership; an edited card ignores itself. */
export function getOverlappingBook(books: BookProfile[] | undefined, folder: string, excludeBookId?: string): BookProfile | null {
    return (books ?? []).find(book => book.id !== excludeBookId // SAFE: a new vault has no books
        && (isPathInFolderScope(book.sourceFolder, folder) || isPathInFolderScope(folder, book.sourceFolder))) ?? null; // SAFE: null means no overlap
}

export function getActiveBook(settings: Pick<RadialTimelineSettings, 'books' | 'activeBookId'>): BookProfile | null {
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

/**
 * The narration default of the book a scene belongs to: the scene's own book
 * in a saga, the active book otherwise (a book timeline holds only that book's
 * scenes). Undefined when the book sets none. Canonical reader for every
 * timeline surface that marks POV characters.
 */
export function bookNarrationMode(
  scene: Pick<TimelineItem, 'bookId'>,
  settings: Pick<RadialTimelineSettings, 'books' | 'activeBookId'>
): NarrationMode | undefined {
  const book = scene.bookId
    ? settings.books.find(candidate => candidate.id === scene.bookId)
    : getActiveBook(settings);
  return book?.narrationMode;
}

/** Every book's narration default, for render fingerprints: a change to any book redraws. */
export function narrationModesSignature(settings: Pick<RadialTimelineSettings, 'books'>): string {
  return settings.books.map(book => `${book.id}:${book.narrationMode ?? ''}`).join('|'); // SAFE: a book without a narration default contributes an empty slot that changes once it is set
}

export const NARRATION_DEFAULTS_MIGRATION_SCHEMA_VERSION = 1;

type NarrationMigrationSettings = Pick<RadialTimelineSettings, 'books' | 'narrationDefaultsMigration'> & Pick<LegacyPersistedSettings, 'globalPovMode'>;

/**
 * Settings migration, run on every load: the 7.x vault-wide narration default
 * (`globalPovMode`) becomes each book's own, so no timeline changes.
 *
 * - Runs once, stamped by `narrationDefaultsMigration`. Every book without a
 *   narration of its own takes the vault value and is recorded as inheriting it.
 * - Waits, unstamped, while there are no books (a book created later inherits
 *   the value) or while the vault value is one this build does not know.
 * - Afterwards, repairs: a device still on 7.x drops `narrationMode` from the
 *   books when it saves, so a recorded book that lost its narration takes the
 *   vault value again. A book the writer has set since is no longer recorded
 *   (markNarrationChosen), so "not set" stays not set.
 *
 * `globalPovMode` stays on disk through 8.0 for those 7.x devices.
 * TODO(8.1): delete `globalPovMode` and the repair branch; keep the stamp.
 * True when the settings changed.
 */
export function migrateVaultNarrationDefault(settings: NarrationMigrationSettings): boolean {
  const vaultMode = settings.globalPovMode;
  const inheritedMode = isNarrationMode(vaultMode) && vaultMode !== 'off' ? vaultMode : undefined;
  const record = settings.narrationDefaultsMigration;

  if (record === undefined) {
    if (settings.books.length === 0) return false;
    if (vaultMode !== undefined && !isNarrationMode(vaultMode)) return false;
    const inheritedBookIds: string[] = [];
    if (inheritedMode) {
      for (const book of settings.books) {
        if (book.narrationMode) continue;
        book.narrationMode = inheritedMode;
        inheritedBookIds.push(book.id);
      }
    }
    settings.narrationDefaultsMigration = { schemaVersion: NARRATION_DEFAULTS_MIGRATION_SCHEMA_VERSION, inheritedBookIds };
    return true;
  }

  // A record from a newer Radial Timeline is kept as found and never read.
  if (record.schemaVersion !== NARRATION_DEFAULTS_MIGRATION_SCHEMA_VERSION || !inheritedMode) return false;
  const inherited = new Set(inheritedBookIdsOf(record as NarrationDefaultsMigration));
  let repaired = false;
  for (const book of settings.books) {
    if (!inherited.has(book.id) || book.narrationMode) continue;
    book.narrationMode = inheritedMode;
    repaired = true;
  }
  return repaired;
}

/**
 * The writer set this book's narration themselves (including "not set"), so it
 * no longer inherits the vault value and the repair above leaves it alone.
 */
export function markNarrationChosen(settings: Pick<RadialTimelineSettings, 'narrationDefaultsMigration'>, bookId: string): void {
  const record = settings.narrationDefaultsMigration;
  if (record?.schemaVersion !== NARRATION_DEFAULTS_MIGRATION_SCHEMA_VERSION) return;
  settings.narrationDefaultsMigration = {
    schemaVersion: NARRATION_DEFAULTS_MIGRATION_SCHEMA_VERSION,
    inheritedBookIds: inheritedBookIdsOf(record as NarrationDefaultsMigration).filter(id => id !== bookId),
  };
}

/** The recorded ids, as stored: a hand-edited list keeps only its string entries. */
function inheritedBookIdsOf(record: NarrationDefaultsMigration): string[] {
  const ids: unknown = record.inheritedBookIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
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
    .filter(book => book.sourceFolder.trim().length > 0 && isBookIncludedInSaga(book));
}

export function isBookIncludedInSaga(book: BookProfile): boolean {
  return book.includeInSaga !== undefined ? book.includeInSaga : !book.copy;
}

/** Resolve a concrete book instance, never a lineage ID shared across copies. */
export function getBookIdForPath(books: BookProfile[] | undefined, path: string): string | undefined {
  const matches = (books ?? []).filter(book => { // SAFE: a vault without book profiles has no book identity
    const root = book.sourceFolder.replace(/\/$/, '');
    return root.length > 0 && (path === root || path.startsWith(`${root}/`));
  }).sort((left, right) => right.sourceFolder.length - left.sourceFolder.length);
  if (matches.length > 1 && matches[0].sourceFolder === matches[1].sourceFolder) return undefined;
  return matches[0]?.id;
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
