/* global __RT_DEV__ -- build-time flags injected by esbuild define; see esbuild.config.mjs */
/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { ButtonComponent, Plugin, Notice, TAbstractFile, WorkspaceLeaf, addIcon } from "obsidian";
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { TimelineService } from './services/TimelineService';
import { SceneDataService } from './services/SceneDataService';
import { hexToRgb, rgbToHsl, hslToRgb, rgbToHex } from './utils/colour';
import SynopsisManager from './SynopsisManager';
import { RadialTimelineView } from './view/TimeLineView';
import { InquiryView } from './inquiry/InquiryView';
import { migrateInquirySidecarToVisible, readInquirySessionsFromVault, writeInquirySessionsToVault } from './inquiry/InquiryArtifactStore';
import { DEFAULT_INQUIRY_HISTORY_LIMIT } from './inquiry/constants';
import type { InquirySession } from './inquiry/sessionTypes';
import { InquiryService } from './inquiry/InquiryService';
import { InquiryEstimateService } from './inquiry/services/inquiryEstimateService';
import { OutputProfileStore } from './ai/cost/outputProfile';
import { INQUIRY_VIEW_TYPE } from './inquiry/constants';
import { RendererService } from './services/RendererService';
import { RadialTimelineSettingsTab } from './settings/SettingsTab';
import { cleanupTooltipAnchors } from './utils/tooltip';
import type { RadialTimelineSettings, LegacyPersistedSettings, TimelineItem, BookMeta, EmbeddedReleaseNotesBundle, EmbeddedReleaseNotesEntry, ManuscriptExportCleanupOptions, GossamerRunFilterSettings } from './types';
import { ReleaseNotesService } from './services/ReleaseNotesService';
import { getAllRefactorAlertIds } from './settings/refactorAlerts';
import { autoAdoptDetectedBeatsIfEmpty } from './storyBeats/workspaceState';
import releaseNotesBundle from './data/releaseNotesBundle.json';
import { CommandRegistrar } from './services/CommandRegistrar';
import { HoverHighlighter } from './services/HoverHighlighter';
import { SceneHighlighter } from './services/SceneHighlighter';
import { GossamerScoreService } from './services/GossamerScoreService';
import { SceneAnalysisService } from './services/SceneAnalysisService';
import { StatusBarService } from './services/StatusBarService';
import { BeatsProcessingService } from './services/BeatsProcessingService';
import { ThemeService } from './services/ThemeService';
import type { SceneAnalysisProcessingModal } from './modals/SceneAnalysisProcessingModal';
import { TimelineMetricsService } from './services/TimelineMetricsService';
import { migrateSceneAnalysisFields } from './migrations/sceneAnalysis';
import { migrateSceneFrontmatterIds } from './migrations/sceneIds';
import { normalizeTimelineMode } from './migrations/timelineMode';
import { SettingsService } from './services/SettingsService';
import { DEFAULT_SETTINGS } from './settings/defaults';
import { migrateAiSettings, stripLegacyAiSettings } from './ai/settings/migrateAiSettings';
import { validateAiSettings } from './ai/settings/validateAiSettings';
import { buildDefaultAiSettings } from './ai/settings/aiSettings';
import { getAIClient } from './ai/runtime/aiClient';
import { migrateLegacyKeysToSecretStorage, needsLegacyKeyMigration } from './ai/credentials/credentials';
import { hasSecret } from './ai/credentials/secretStorage';
import type { AIProviderId } from './ai/types';
import { migrateAuthorProgressSettings } from './authorProgress/authorProgressConfig';
import { syncCommunityProjectsIfConnected } from './communityShare/communityShareClient';
import { migrateBeatSettings, stripLegacyBeatSettings } from './migrations/beatSettings';
import { DEFAULT_BOOK_TITLE, createBookId, deriveBookTitleFromSourcePath, getActiveBook, getSagaBooks, getTimelineScope, isSagaScopeAvailable, normalizeBookProfile, shouldSeedBookProfileFromLegacySettings } from './utils/books';
import { adaptPandocLayoutsToPublishingModel } from './utils/publishingModel';
import { convertExportProfileToLegacyManuscriptExportTemplate, migratePublishingModelState } from './utils/publishingMigration';
import { initVersionCheckService } from './services/VersionCheckService';
import { AuthorProgressService } from './services/AuthorProgressService';
import { PublishingValidationService } from './services/PublishingValidationService';
import { TimelineAuditAiService } from './services/TimelineAuditAiService';
import { WritingSessionService } from './services/WritingSessionService';
import { ensureBundledPandocLayoutsRegistered, ensureSpecDrivenBundledFictionTemplatesCurrent, setBundledFontSourcePath, setPandocFontPathsForVault } from './utils/pandocBundledLayouts';
import { normalizeManuscriptCleanupOptions } from './utils/manuscriptSanitize';
import { DARIAN_MARS_MONTH_NAMES, MARS_TEMPLATE_ID, matchesLegacyMarsMonthNames } from './utils/planetaryMars';
import type { GossamerHistoricalRunOverlay, GossamerMinMaxBand, GossamerRun, GossamerRunRecord } from './utils/gossamer';
import { coerceGossamerSignal, DEFAULT_GOSSAMER_SIGNAL, type GossamerSignalType } from './types/gossamerSignals';
import type { GossamerCacheWindow } from './gossamer/cacheWindow';
import { seedProEntitlement } from './settings/proEntitlementSeed';
import { hasProFeatureAccess } from './settings/featureGate';
import { DisposableRegistry } from './core/disposable';

// Import the new scene analysis function <<< UPDATED IMPORT

// Constants for the view
export const TIMELINE_VIEW_TYPE = "radial-timeline";

const DEV_PLAINTEXT_KEY_PATTERNS: Array<{ label: string; regex: RegExp }> = [
    { label: 'OpenAI key signature', regex: /sk-[A-Za-z0-9_-]{10,}/ },
    { label: 'Anthropic key signature', regex: /sk-ant-[A-Za-z0-9_-]{10,}/ },
    { label: 'Google API key signature', regex: /AIza[0-9A-Za-z_-]{16,}/ },
    { label: 'Bearer header token', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i },
    { label: 'Header-like high-entropy secret', regex: /(authorization|x-api-key|apiKey|token|secret)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{40,}/i }
];
function detectPlaintextCredentialPattern(serialized: string): string | null {
    for (const pattern of DEV_PLAINTEXT_KEY_PATTERNS) {
        if (pattern.regex.test(serialized)) {
            return pattern.label;
        }
    }
    return null;
}

const WORD_START_PATTERN = /[\p{L}\p{N}]/u;

type ButtonComponentPrototype = typeof ButtonComponent.prototype & {
    setDestructive?: () => ButtonComponent;
};

function ensureButtonComponentCompatibility(): void {
    const prototype = ButtonComponent.prototype as ButtonComponentPrototype;
    if (typeof prototype.setDestructive === 'function') return;

    prototype.setDestructive = function setDestructiveCompat(this: ButtonComponent): ButtonComponent {
        this.buttonEl.addClass('ert-btn', 'ert-btn--destructive');
        return this;
    };
}

function isWordCharacter(value: string): boolean {
    return WORD_START_PATTERN.test(value);
}

function countTypedWordStarts(previousChar: string, inserted: string): number {
    let count = 0;
    let previousIsWord = isWordCharacter(previousChar);
    for (const char of inserted) {
        const currentIsWord = isWordCharacter(char);
        if (currentIsWord && !previousIsWord) count += 1;
        previousIsWord = currentIsWord;
    }
    return count;
}

// Search highlighting is centralized in TimeLineView.addHighlightRectangles() after SVG render.

export interface GetSceneDataOptions {
    filterBeatsBySystem?: boolean;
    sourcePath?: string;  // Override the default source path (used for Social APR project targeting)
}

export default class RadialTimelinePlugin extends Plugin {
    settings: RadialTimelineSettings;
    public inquiryFreshLaunchPending = true;

    // Do not store persistent references to views (per Obsidian guidelines)

    // Track open scene paths
    openScenePaths: Set<string> = new Set<string>();
    // Ensure settings tab is only added once per load
    private _settingsTabAdded: boolean = false;
    // Reference to settings tab for programmatic tab switching
    public settingsTab?: RadialTimelineSettingsTab;

    // Search related properties
    searchTerm: string = '';
    searchActive: boolean = false;
    searchResults: Set<string> = new Set<string>();

    // Transient (not persisted): an Inquiry run currently in flight.
    // Lives on the plugin so it survives InquiryView close/reopen — the run
    // promise is owned by the (possibly orphaned) view instance, but this
    // marker lets a freshly reopened view observe that a run is still
    // running and pick up its persisted result without starting a new one.
    public _inquiryRunInFlight: { sessionKey: string; question: string; startedAt: number } | null = null;

    /**
     * Per-provider "a REAL key is actually stored" flags, resolved async via
     * hasSecret() on load and whenever a key changes. The engine resolver reads
     * THIS — not the always-present secret-ID alias — so a keyless vault honestly
     * reports no credential (and Demo Mode / "Not configured" states fire).
     */
    public credentialPresence: Partial<Record<AIProviderId, boolean>> = {};

    /**
     * Recompute credentialPresence from secret storage, then notify Inquiry views
     * so they re-resolve the engine. Fire-and-forget on load; awaited after a key
     * is saved/removed. Cheap (a few hasSecret lookups).
     */
    public async refreshCredentialPresence(): Promise<void> {
        const creds = this.settings.aiSettings?.credentials;
        const next: Partial<Record<AIProviderId, boolean>> = {};
        const entries: Array<[AIProviderId, string | undefined]> = [
            ['openai', creds?.openaiSecretId],
            ['anthropic', creds?.anthropicSecretId],
            ['google', creds?.googleSecretId]
        ];
        for (const [provider, secretId] of entries) {
            next[provider] = secretId ? await hasSecret(this.app, secretId) : false;
        }
        this.credentialPresence = next;
        this.inquiryService?.notifyAiSettingsChanged();
    }

    private readonly eventBus = new EventTarget();
    private readonly disposables = new DisposableRegistry();
    private metadataCacheListener: (() => void) | null = null;
    // Serialized settings persistence: a single in-flight save drain plus a
    // coalescing request flag. Concurrent saveSettings() callers never run
    // saveData() in parallel (no last-writer-wins clobbering); every caller's
    // mutation is guaranteed to be covered by a save that starts after its call.
    private saveInFlight: Promise<void> | null = null;
    private saveRequested = false;

    // Services
    private timelineService!: TimelineService;
    private inquiryService!: InquiryService;
    private inquiryEstimateService!: InquiryEstimateService;
    private outputProfileStore!: OutputProfileStore;
    private sceneDataService!: SceneDataService;
    private searchService!: import('./services/SearchService').SearchService;
    private fileTrackingService!: import('./services/FileTrackingService').FileTrackingService;
    private rendererService!: RendererService;
    private releaseNotesService!: ReleaseNotesService;
    private commandRegistrar!: CommandRegistrar;
    private sceneHighlighter!: SceneHighlighter;
    private gossamerScoreService!: GossamerScoreService;
    private sceneAnalysisService!: SceneAnalysisService;
    private statusBarService!: StatusBarService;
    private beatsProcessingService!: BeatsProcessingService;
    private themeService!: ThemeService;
    private timelineMetricsService!: TimelineMetricsService;
    private writingSessionService!: WritingSessionService;
    private lastWritingActivitySignalMs = 0;
    private settingsService!: SettingsService;
    private publishingValidationService!: PublishingValidationService;
    private timelineAuditAiService!: TimelineAuditAiService;
    public milestonesService!: import('./services/MilestonesService').MilestonesService;
    public lastSceneData?: TimelineItem[];
    public gossamerLatestOnly = false;
    public gossamerVisibleRunIds: string[] = [];
    public gossamerRunInventory: GossamerRunRecord[] = [];
    public gossamerVisibleRunInventory: GossamerRunRecord[] = [];
    public gossamerFilterBeatSystemKey = '';
    public gossamerSelectedSignal: GossamerSignalType = DEFAULT_GOSSAMER_SIGNAL;
    /** Most recent Gossamer scoring run (in-memory only; written by GossamerCommands). */
    public _gossamerLastRun?: GossamerRun;
    /** Historical Gossamer runs for overlay rendering (in-memory only; written by GossamerCommands). */
    public _gossamerHistoricalRuns?: GossamerHistoricalRunOverlay[];
    /** Min/max band across Gossamer runs (in-memory only; written by GossamerCommands). */
    public _gossamerMinMax?: GossamerMinMaxBand | null;
    /** Whether any Gossamer scores exist for the active signal (in-memory only; written by GossamerCommands). */
    public _gossamerHasAnyScores?: boolean;
    /** Beat label angles captured during ring rendering (in-memory only; written by the renderer). */
    public _beatAngles?: Map<string, number>;
    /** Beat slice geometry captured during ring rendering (in-memory only; written by the renderer). */
    public _beatSlices?: Map<string, { startAngle: number; endAngle: number; innerR: number; outerR: number }>;
    /**
     * Provider-cache window armed by the most recent Gossamer AI run. While
     * open, scoring the remaining signals reuses the cached manuscript. In
     * memory only (a fresh plugin process can't prove a prior window is still
     * live), read by every cache-countdown surface. See gossamer/cacheWindow.ts.
     */
    public gossamerCacheWindow: GossamerCacheWindow | null = null;

    // APR Service
    private authorProgressService!: AuthorProgressService;

    // Completion estimate stats
    latestTotalScenes: number = 0;
    latestRemainingScenes: number = 0;
    latestScenesPerWeek: number = 0;

    // Add a synopsisManager instance
    public synopsisManager: SynopsisManager;

    // Add property to store the latest status counts for completion estimate
    public latestStatusCounts?: Record<string, number>;


    // Track active scene analysis processing modal and status bar item
    public activeBeatsModal: SceneAnalysisProcessingModal | null = null;

    // Last error reported while parsing a Pulse/scene-analysis AI response
    public lastAnalysisError = '';

    // Helper: get all currently open timeline views
    public getTimelineViews(): RadialTimelineView[] { return this.timelineService.getTimelineViews(); }

    // Helper: expose the scene data service to consumers (modals, services)
    public getSceneDataService(): SceneDataService { return this.sceneDataService; }

    // Helper: get the first open timeline view (if any)
    private getFirstTimelineView(): RadialTimelineView | null {
        const list = this.getTimelineViews();
        return list.length > 0 ? list[0] : null;
    }

    private normalizeGossamerRunFilterSettings(input: unknown): GossamerRunFilterSettings {
        const current = (input && typeof input === 'object') ? input as Partial<GossamerRunFilterSettings> : {};
        return {
            latestOnly: current.latestOnly === true,
            visibleRunIds: Array.isArray(current.visibleRunIds)
                ? current.visibleRunIds.filter((value): value is string => typeof value === 'string')
                : [],
            beatSystemKey: typeof current.beatSystemKey === 'string' ? current.beatSystemKey : '',
            signal: coerceGossamerSignal(current.signal),
        };
    }

    private syncGossamerRunFilterSettings(): boolean {
        const next = this.normalizeGossamerRunFilterSettings({
            latestOnly: this.gossamerLatestOnly,
            visibleRunIds: this.gossamerVisibleRunIds,
            beatSystemKey: this.gossamerFilterBeatSystemKey,
            signal: this.gossamerSelectedSignal,
        });
        const current = this.normalizeGossamerRunFilterSettings(this.settings.gossamerRunFilter);
        if (JSON.stringify(current) === JSON.stringify(next)) {
            return false;
        }
        this.settings.gossamerRunFilter = next;
        return true;
    }

    private handleWritingSessionEditorUpdate(update: ViewUpdate): void {
        const service = this.writingSessionService;
        if (!service?.getActiveSession()) return;
        const docChanged = update.docChanged;
        if (!docChanged && !update.selectionSet) return;
        const path = this.app.workspace.getActiveFile()?.path;
        const scenePath = path && this.isSceneFile(path) ? path : undefined;
        // Editor activity in a scene keeps the session alive and resumes it if it
        // idle-paused. Routed straight through onActivity (not the throttled
        // signalWritingActivity used for scroll/leaf bursts) so the resume happens
        // synchronously BEFORE we count the words below — a paused session would
        // otherwise drop them. onActivity throttles its own persistence.
        if (scenePath) {
            void service.onActivity(scenePath);
        }
        if (!docChanged) return;
        let typedWords = 0;
        for (const transaction of update.transactions) {
            if (!transaction.docChanged) continue;
            if (!transaction.isUserEvent('input.type') && !transaction.isUserEvent('input.type.compose')) continue;
            transaction.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
                const insertedText = inserted.toString();
                if (!insertedText.trim()) return;
                const previousChar = fromA > 0 ? transaction.startState.doc.sliceString(fromA - 1, fromA) : '';
                typedWords += countTypedWordStarts(previousChar, insertedText);
            }, true);
        }
        if (typedWords > 0) {
            // Total counts regardless of file; per-scene bucketing only for scenes.
            this.writingSessionService.registerTypedWords(typedWords, scenePath);
        }
    }

    /**
     * Gate for auto-track: keeps a session the author has begun alive while they
     * write. Only runs when a session is active (auto-track never starts one),
     * the app is focused, and the active file is a scene. Throttled so
     * per-keystroke and scroll bursts stay cheap; the service throttles
     * persistence separately.
     */
    private signalWritingActivity(): void {
        const service = this.writingSessionService;
        if (!service?.isAutoTrackEnabled() || !service.getActiveSession()) return;
        const now = Date.now();
        if (now - this.lastWritingActivitySignalMs < 1000) return;
        this.lastWritingActivitySignalMs = now;
        if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) return;
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isSceneFile(file.path)) return;
        void service.onActivity(file.path);
    }

    public async saveGossamerRunFilterState(): Promise<void> {
        if (!this.syncGossamerRunFilterSettings()) return;
        await this.saveSettings();
    }

    public getActiveBook() {
        return getActiveBook(this.settings);
    }

    public getActiveBookTitle(): string {
        const active = getActiveBook(this.settings);
        return active?.title?.trim() || DEFAULT_BOOK_TITLE;
    }

    private syncLegacySourcePathFromActiveBook(): void {
        const active = getActiveBook(this.settings);
        this.settings.sourcePath = active?.sourceFolder?.trim() || '';
    }

    private syncPublishingModelState(): boolean {
        const templateProfiles = adaptPandocLayoutsToPublishingModel(this.settings.pandocLayouts || []).profiles;
        const migration = migratePublishingModelState(this.settings, templateProfiles);
        let changed = false;

        if (JSON.stringify(this.settings.exportProfiles || []) !== JSON.stringify(migration.exportProfiles)) {
            this.settings.exportProfiles = migration.exportProfiles;
            changed = true;
        }
        if (JSON.stringify(this.settings.bookPublishingPreferences || []) !== JSON.stringify(migration.bookPublishingPreferences)) {
            this.settings.bookPublishingPreferences = migration.bookPublishingPreferences;
            changed = true;
        }
        if ((this.settings.lastUsedExportProfileId || '') !== (migration.lastUsedExportProfileId || '')) {
            this.settings.lastUsedExportProfileId = migration.lastUsedExportProfileId;
            changed = true;
        }
        if ((this.settings.lastUsedManuscriptExportTemplateId || '') !== (migration.lastUsedExportProfileId || '')) {
            this.settings.lastUsedManuscriptExportTemplateId = migration.lastUsedExportProfileId;
            changed = true;
        }
        const currentLegacyTemplates = Array.isArray(this.settings.manuscriptExportTemplates)
            ? this.settings.manuscriptExportTemplates
            : [];
        const legacyTemplates = migration.exportProfiles.map(profile => {
            const existing = currentLegacyTemplates.find(template => template.id === profile.id);
            return convertExportProfileToLegacyManuscriptExportTemplate(profile, {
                createdAt: existing?.createdAt,
            });
        });
        if (JSON.stringify(this.settings.manuscriptExportTemplates || []) !== JSON.stringify(legacyTemplates)) {
            this.settings.manuscriptExportTemplates = legacyTemplates;
            changed = true;
        }

        return changed;
    }

    public updateTimelineBookHeaders(): void {
        this.getTimelineViews().forEach(view => {
            view.syncBookHeader();
        });
    }

    public async setActiveBookId(bookId: string): Promise<void> {
        if (!bookId) return;
        const scopeChanged = this.settings.timelineScope === 'saga';
        if (this.settings.activeBookId === bookId && !scopeChanged) return;
        this.settings.activeBookId = bookId;
        this.settings.timelineScope = 'book';
        this.syncLegacySourcePathFromActiveBook();
        await this.saveSettings();
        this.maybeAutoAdoptBeatSystems();
        this.refreshTimelineIfNeeded(null);
        this.updateTimelineBookHeaders();
        this.inquiryService?.notifyBookSettingsChanged();
    }

    /**
     * Fresh-vault beat adoption. If the active book has no loaded beat tabs but
     * the manuscript already contains `Class: Beat` notes, load each detected
     * system and activate the dominant one. Runs only while the workspace is
     * empty, so it fires once on first open and never overrides manual choices.
     * Must be called after the metadata cache is populated (layout-ready).
     * Returns true when it adopted, so callers can refresh the timeline.
     */
    private maybeAutoAdoptBeatSystems(): boolean {
        const result = autoAdoptDetectedBeatsIfEmpty(this.app, this.settings);
        if (!result.changed) return false;
        void this.saveSettings();
        if (result.activatedName) {
            new Notice(`Adopted "${result.activatedName}" beats from your manuscript.`);
        }
        return true;
    }

    public async setTimelineScope(scope: 'book' | 'saga'): Promise<void> {
        if (scope === 'saga') {
            if (!isSagaScopeAvailable(this.settings)) {
                new Notice('Add at least two books in Book Manager to use Saga Timeline.');
                return;
            }
            if (!hasProFeatureAccess(this)) {
                new Notice('Saga Timeline is a Pro feature.');
                return;
            }
            this.settings.timelineScope = 'saga';
            this.settings.currentMode = 'narrative';
        } else {
            this.settings.timelineScope = 'book';
        }

        await this.saveSettings();
        this.refreshTimelineIfNeeded(null);
        this.updateTimelineBookHeaders();
    }

    public async persistBookSettings(): Promise<void> {
        this.syncLegacySourcePathFromActiveBook();
        // Pointing a freshly-created book at its manuscript folder is the moment
        // its beat notes first become discoverable — adopt them now so a new user
        // doesn't have to manually load the detected set.
        this.maybeAutoAdoptBeatSystems();
        await this.saveSettings();
        this.refreshTimelineIfNeeded(null);
        this.updateTimelineBookHeaders();
        this.inquiryService?.notifyBookSettingsChanged();
        // Keep the open Story beats system panel in sync with the active book
        // (source folder, auto-adopted systems). No-op when settings is closed.
        this.settingsTab?.refreshBeatPropertiesSection();
    }

    /**
     * Position and curve the text elements in the SVG
     * @param container The container element with the SVG
     */




    public getReleaseNotesBundle(): EmbeddedReleaseNotesBundle | null {
        return this.releaseNotesService?.getBundle() ?? null;
    }

    public getReleaseNotesEntries(): EmbeddedReleaseNotesEntry[] {
        return this.releaseNotesService?.getEntries() ?? [];
    }

    public getReleaseNotesMajorVersion(): string | null {
        return this.releaseNotesService?.getMajorVersion() ?? null;
    }

    public async markReleaseNotesSeen(version: string): Promise<void> {
        await this.releaseNotesService?.markReleaseNotesSeen(version);
    }

    public async maybeShowReleaseNotesModal(): Promise<void> {
        await this.releaseNotesService?.maybeShowReleaseNotesModal(this.app, this);
    }

    public openReleaseNotesModal(): void {
        this.releaseNotesService?.openReleaseNotesModal(this.app, this);
    }

    async onload() {
        ensureButtonComponentCompatibility();
        this.settingsService = new SettingsService(this);
        await this.loadSettings();

        addIcon('rt-logo', '<g transform="translate(-56.82,-75.59) scale(0.12030)"><path fill="currentColor" d="M604.11,1274.16l-131.83.12,36.57-162.23c12.42-55.12,57.45-94.1,114.42-94.09h122.98c10.22.01,20-1.99,28.72-6.65,14.3-7.63,20.82-22.45,19.24-38.15-2.34-23.35-20.29-34.12-42.51-35.41l-201.37-.06,29.2-125.03,185.04.12c69.83,3.45,127.94,44.91,151.99,110.3,18.56,53.7,7.91,111.98-27.6,156.25-17.24,21.5-39.41,37.45-64.95,49.11l71.96,144.34c.9,1.81,1.8,2.59-1.12,1.42l-142.07.04-64.96-128.49-53.36-.13-30.34,128.56Z"/><path fill="currentColor" d="M937.3,1274.25l17.69-77.78,60.02-258.56-45.47-.23c-9.55-54.08-42.3-98.13-90.97-124.96l425-.04-28.48,125.02-129.43.05-78.44,336.43-129.93.06Z"/></g>');

        // Resolve bundled font source and vault-local Pandoc font destination.
        // Bundled templates point at Radial Timeline/Pandoc/fonts, not MacTeX,
        // Font Book, Google URLs, or the plugin internals.
        try {
            const adapter = this.app.vault.adapter as { getBasePath?: () => string };
            const basePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : undefined;
            if (basePath) {
                const configDir = this.app.vault.configDir;
                setBundledFontSourcePath(`${basePath}/${configDir}/plugins/${this.manifest.id}/assets/fonts`);
                setPandocFontPathsForVault(this);
            }
        } catch {
            // Non-fatal: export checks will report missing bundled font files.
        }
        try {
            const templateSync = await ensureSpecDrivenBundledFictionTemplatesCurrent(this);
            if (templateSync.failed.length > 0) {
                console.warn(`[Radial Timeline] Failed to sync bundled PDF templates: ${templateSync.failed.join(', ')}.`);
            }
        } catch (error) {
            console.warn('[Radial Timeline] Failed to sync bundled fiction PDF templates.', error);
        }
        void getAIClient(this).refreshModelDataIfStale();
        this.releaseNotesService = new ReleaseNotesService(this.settings, () => this.saveSettings());
        this.releaseNotesService.initializeFromEmbedded();
        void this.releaseNotesService.ensureReleaseNotesFresh(); // Removed argument

        // Migration: Convert old field names to new field names
        await migrateSceneAnalysisFields(this);

        // Scene ID migration deferred until vault is fully indexed
        this.app.workspace.onLayoutReady(() => {
            void (async () => {
                const sceneIdsMigrated = await migrateSceneFrontmatterIds(this);
                if (sceneIdsMigrated > 0) {
                    new Notice(`🔑 Scene IDs added to ${sceneIdsMigrated} scene${sceneIdsMigrated === 1 ? '' : 's'}. No action required.`);
                }
                // Fresh-vault beat adoption: load+activate beats already present in
                // the manuscript. Safe here — metadata cache is populated at layout-ready.
                if (this.maybeAutoAdoptBeatSystems()) {
                    this.refreshTimelineIfNeeded(null);
                }
            })();

            // Standing community share: while sharing is on, keep the live
            // report current. Delayed so startup stays snappy; the sync is a
            // no-op when sharing is off or nothing changed.
            window.setTimeout(() => {
                void import('./communityShare/communityShareClient')
                    .then(({ syncCommunityShareIfDue }) => syncCommunityShareIfDue(this));
            }, 20_000);
            this.registerInterval(window.setInterval(() => {
                void import('./communityShare/communityShareClient')
                    .then(({ syncCommunityShareIfDue }) => syncCommunityShareIfDue(this));
            }, 6 * 60 * 60 * 1000));
        });

        // Load embedded fonts (no external requests per Obsidian guidelines)
        // Embedded font injection removed to avoid inserting <style> tags at runtime.
        // All styles should live in styles.css so Obsidian can manage load/unload.

        // Initialize services and managers
        this.timelineService = new TimelineService(this.app, this);
        this.disposables.add(this.timelineService);
        this.inquiryService = new InquiryService(this.app, this);
        // Resolve real key presence (async) now that secret storage + Inquiry
        // service exist; refreshes any open Inquiry view when it lands.
        void this.refreshCredentialPresence();
        this.inquiryEstimateService = new InquiryEstimateService();
        this.outputProfileStore = new OutputProfileStore(this);
        void this.outputProfileStore.ensureLoaded();
        this.sceneDataService = new SceneDataService(this.app, this.settings);
        const { SearchService } = await import('./services/SearchService');
        const { FileTrackingService } = await import('./services/FileTrackingService');
        this.searchService = new SearchService(this.app, this);
        this.fileTrackingService = new FileTrackingService(this);
        this.rendererService = new RendererService(this);
        this.synopsisManager = new SynopsisManager(this);
        this.commandRegistrar = new CommandRegistrar(this, this.app);
        this.sceneHighlighter = new SceneHighlighter(this);
        this.gossamerScoreService = new GossamerScoreService(this.app, this);
        this.sceneAnalysisService = new SceneAnalysisService(this);
        this.statusBarService = new StatusBarService(this);
        this.beatsProcessingService = new BeatsProcessingService(this.statusBarService);
        this.themeService = new ThemeService(this);
        // Popout windows have their own document — apply RT CSS variables as each opens.
        this.registerEvent(this.app.workspace.on('window-open', (win) => this.themeService.applyCssVariablesToDocument(win.doc)));
        this.timelineMetricsService = new TimelineMetricsService(this);
        this.writingSessionService = new WritingSessionService(this);
        // Normalize session settings once and reconcile any session abandoned
        // by a previous crash/quit before the UI starts ticking.
        await this.writingSessionService.hydrate();
        this.registerEditorExtension(EditorView.updateListener.of((update) => this.handleWritingSessionEditorUpdate(update)));
        // Auto-track activity signals beyond typing: switching scenes and
        // scrolling/reading a scene both keep a session alive (revision time).
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.signalWritingActivity()));
        this.registerEvent(this.app.workspace.on('file-open', () => this.signalWritingActivity()));
        this.registerDomEvent(document, 'scroll', () => this.signalWritingActivity(), { capture: true });
        this.publishingValidationService = new PublishingValidationService(this);
        this.timelineAuditAiService = new TimelineAuditAiService(this);
        
        // Milestones Service (single source of truth for stage completion milestones)
        // Separate from TimelineMetricsService (estimation/tick tracking)
        const { MilestonesService } = await import('./services/MilestonesService');
        this.milestonesService = new MilestonesService(this);
        
        // APR Service
        this.authorProgressService = new AuthorProgressService(this, this.app);

        // CSS variables for publish stage colors are set once on layout ready

        // Register the view
        this.registerView(
            TIMELINE_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => {
                return new RadialTimelineView(leaf, this);
            }
        );
        this.registerView(
            INQUIRY_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => {
                return new InquiryView(leaf, this);
            }
        );

        // Register ribbon + commands (single orchestration point)
        this.commandRegistrar.registerAll(this.sceneAnalysisService);

        // Add settings tab (only once)
        if (!this._settingsTabAdded) {
            this.settingsTab = new RadialTimelineSettingsTab(this.app, this);
            this.addSettingTab(this.settingsTab);
            this._settingsTabAdded = true;
        }

        // Frontmatter detection is centralized in TimelineView debouncing; avoid duplicate listeners here.

        // Listen for tab changes and file manager interactions using Obsidian's events
        // This is more reliable than DOM events
        // (file-open listener consolidated below at line ~941)

        // Track workspace layout changes to update our view
        // (layout-change listener consolidated below at line ~949)

        this.fileTrackingService.registerWorkspaceListeners();

        // Setup hover listeners
        new HoverHighlighter(this.app, this, this.sceneHighlighter).register();

        // Initialize version check service and check for updates in background
        const versionService = initVersionCheckService(this.manifest.version);
        
        // Check for updates asynchronously (don't block plugin load)
        versionService.checkForUpdates().then(hasUpdate => {
            if (hasUpdate) {
                // Refresh timeline to show update indicator
                this.refreshTimelineIfNeeded(null);
            }
        }).catch((err) => {
            console.warn('[RadialTimeline] Version check failed on startup:', err);
        });

        // APR Auto-Update Check
        void this.authorProgressService.checkAutoUpdate();

        // Community share surface 2: keep the website's private project shells
        // in sync with Book Manager (no-op unless Community Share is connected).
        void syncCommunityProjectsIfConnected(this);

        // Initial status bar update (placeholder for future stats)
        // this.statusBarService.update(...);

        // Dev-only debug infrastructure (tree-shaken in production)
        if (__RT_DEV__) {
            void import('./debug/index').then(m => m.installDebug(this));
        }
    }
    public getRendererService(): RendererService { return this.rendererService; }
    public getTimelineService(): TimelineService { return this.timelineService; }
    public getInquiryService(): InquiryService { return this.inquiryService; }
    public getInquiryEstimateService(): InquiryEstimateService { return this.inquiryEstimateService; }
    public getOutputProfileStore(): OutputProfileStore { return this.outputProfileStore; }
    public getPublishingValidationService(): PublishingValidationService { return this.publishingValidationService; }
    public getWritingSessionService(): WritingSessionService { return this.writingSessionService; }
    public openManuscriptExportModal(): void { this.commandRegistrar.openManuscriptExportModal(); }

    public consumeInquiryFreshLaunchPending(): boolean {
        const pending = this.inquiryFreshLaunchPending;
        this.inquiryFreshLaunchPending = false;
        return pending;
    }

    /** Show or hide the Inquiry ribbon icon and close open Inquiry views when hiding. */
    public setInquiryVisible(visible: boolean): void {
        this.commandRegistrar.setInquiryRibbonVisible(visible);
        if (!visible) {
            // Close any open Inquiry leaves
            const leaves = this.app.workspace.getLeavesOfType(INQUIRY_VIEW_TYPE);
            for (const leaf of leaves) {
                leaf.detach();
            }
        }
    }

    public isSceneFile(path: string): boolean {
        return this.sceneHighlighter.isSceneFile(path);
    }

    public async processSceneAnalysisByManuscriptOrder(): Promise<void> {
        await this.sceneAnalysisService.processByManuscriptOrder();
    }

    public async processSceneAnalysisBySubplotName(subplotName: string): Promise<void> {
        await this.sceneAnalysisService.processBySubplotName(subplotName);
    }

    public async processEntireSubplot(subplotName: string): Promise<void> {
        await this.sceneAnalysisService.processEntireSubplot(subplotName);
    }



    async getSceneData(options?: GetSceneDataOptions): Promise<TimelineItem[]> {
        return this.sceneDataService.getSceneData(options);
    }

    async getTimelineSceneData(options?: GetSceneDataOptions): Promise<TimelineItem[]> {
        if (getTimelineScope(this.settings) !== 'saga') {
            return this.getSceneData(options);
        }

        const books = getSagaBooks(this.settings);
        const allScenes: TimelineItem[] = [];
        for (const [bookIndex, book] of books.entries()) {
            const bookScenes = await this.getSceneData({ ...options, sourcePath: book.sourceFolder });
            allScenes.push(...bookScenes.map(scene => ({
                ...scene,
                bookId: book.id,
                bookTitle: book.title,
                bookIndex,
                bookSourceFolder: book.sourceFolder
            })));
        }
        return allScenes;
    }

    /**
     * Get the BookMeta for the active manuscript.
     * Populated during getSceneData() — returns null if no BookMeta note exists.
     */
    getBookMeta(): BookMeta | null {
        return this.sceneDataService.getBookMeta();
    }

    /**
     * Inquiry sessions are persisted to a visible vault sidecar
     * (`Radial Timeline/Inquiry/Sessions/sessions.json`), not `data.json` — the vault is
     * the single source of truth for brief content, so briefs ship with the
     * vault and rehydrate on a fresh plugin install.
     *
     * Hydrates the in-memory working set from the vault. Any sessions that exist
     * only in a legacy `data.json` cache (pre-upgrade) are migrated into the
     * sidecar once; thereafter `performSave` strips the field from `data.json`.
     * The vault wins on key collisions.
     */
    private async hydrateInquirySessionsFromVault(): Promise<void> {
        // Move the sidecar out of the hidden .radial-timeline/ dotfolder into the
        // visible Radial Timeline/Inquiry/Sessions/ folder before reading it.
        await migrateInquirySidecarToVisible(this.app);
        const vaultSessions = await readInquirySessionsFromVault(this.app);
        const legacySessions = (this.settings.inquirySessionCache?.sessions ?? []) as unknown as InquirySession[];

        const byKey = new Map<string, InquirySession>();
        for (const session of legacySessions) byKey.set(session.key, session);
        for (const session of vaultSessions) byKey.set(session.key, session);
        const merged = Array.from(byKey.values());

        this.settings.inquirySessionCache = {
            sessions: merged,
            max: DEFAULT_INQUIRY_HISTORY_LIMIT
        };

        const legacyOnly = legacySessions.some(
            legacy => !vaultSessions.some(vaultSession => vaultSession.key === legacy.key)
        );
        if (legacyOnly) {
            const activeBook = getActiveBook(this.settings);
            const vaultIdentity = activeBook
                ? { displayName: activeBook.title, bookFolder: activeBook.sourceFolder }
                : undefined;
            await writeInquirySessionsToVault(this.app, merged, vaultIdentity);
        }
    }

    async loadSettings() {
        const rawLoaded = await this.loadData();
        // A brand-new vault has no data.json yet (loadData → null/empty). Used
        // below to suppress the backlog of upgrade alerts for fresh installs.
        const isFreshInstall = rawLoaded == null || Object.keys(rawLoaded as object).length === 0;
        const loadedSettings = rawLoaded ?? {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);
        await this.hydrateInquirySessionsFromVault();
        if (this.settings.publishStageColors?.House === '#DA7847') {
            this.settings.publishStageColors.House = '#F2863C';
        }
        const normalizedGossamerRunFilter = this.normalizeGossamerRunFilterSettings(this.settings.gossamerRunFilter);
        const gossamerRunFilterMigrated = JSON.stringify(this.settings.gossamerRunFilter ?? null) !== JSON.stringify(normalizedGossamerRunFilter);
        this.settings.gossamerRunFilter = normalizedGossamerRunFilter;
        this.gossamerLatestOnly = normalizedGossamerRunFilter.latestOnly;
        this.gossamerVisibleRunIds = [...normalizedGossamerRunFilter.visibleRunIds];
        this.gossamerFilterBeatSystemKey = normalizedGossamerRunFilter.beatSystemKey;
        this.gossamerSelectedSignal = coerceGossamerSignal(normalizedGossamerRunFilter.signal);
        const proEntitlementSeeded = seedProEntitlement(this.settings);
        this.settings.aiSettings = (loadedSettings as Partial<RadialTimelineSettings>).aiSettings;
        this.settings.authorProgress = migrateAuthorProgressSettings((loadedSettings as Partial<RadialTimelineSettings>).authorProgress);
        let modeMigrated = false;
        const modeNormalization = normalizeTimelineMode(this.settings.currentMode);
        if (modeNormalization.mode) {
            if (modeNormalization.mode !== this.settings.currentMode) {
                this.settings.currentMode = modeNormalization.mode;
                modeMigrated = true;
            }
        } else if (this.settings.currentMode) {
            this.settings.currentMode = DEFAULT_SETTINGS.currentMode || 'narrative';
            modeMigrated = true;
        }
        let planetarySelectionMigrated = false;
        const planetaryProfiles = Array.isArray(this.settings.planetaryProfiles) ? this.settings.planetaryProfiles : [];
        this.settings.planetaryProfiles = planetaryProfiles;
        for (const profile of planetaryProfiles) {
            if (profile?.id === MARS_TEMPLATE_ID && matchesLegacyMarsMonthNames(profile.monthNames)) {
                profile.monthNames = [...DARIAN_MARS_MONTH_NAMES];
                planetarySelectionMigrated = true;
            }
        }

        if (typeof this.settings.activePlanetaryProfileId !== 'string') {
            this.settings.activePlanetaryProfileId = '';
            planetarySelectionMigrated = true;
        }

        if (
            this.settings.activePlanetaryProfileId
            && !planetaryProfiles.some(profile => profile.id === this.settings.activePlanetaryProfileId)
        ) {
            this.settings.activePlanetaryProfileId = '';
            planetarySelectionMigrated = true;
        }

        if (
            this.settings.planetaryTimeLastDirection !== 'earth-to-planet'
            && this.settings.planetaryTimeLastDirection !== 'planet-to-earth'
        ) {
            this.settings.planetaryTimeLastDirection = DEFAULT_SETTINGS.planetaryTimeLastDirection;
            planetarySelectionMigrated = true;
        }

        let booksMigrated = false;
        const settingsAny = this.settings as unknown as Record<string, unknown>;
        const hasBooks = Array.isArray(this.settings.books) && this.settings.books.length > 0;

        if (!hasBooks) {
            const legacySourcePath = (this.settings.sourcePath || '').trim();
            const legacyTitle = typeof settingsAny.bookTitle === 'string' ? (settingsAny.bookTitle).trim() : '';
            if (shouldSeedBookProfileFromLegacySettings({
                sourcePath: legacySourcePath,
                legacyTitle
            })) {
                const derivedTitle = (this.settings as LegacyPersistedSettings).showSourcePathAsTitle !== false
                    ? deriveBookTitleFromSourcePath(legacySourcePath)
                    : null;
                const title = legacyTitle || derivedTitle || DEFAULT_BOOK_TITLE;

                this.settings.books = [
                    normalizeBookProfile({
                        id: createBookId(),
                        title,
                        sourceFolder: legacySourcePath
                    })
                ];
                this.settings.activeBookId = this.settings.books[0].id;
                booksMigrated = true;
            } else {
                this.settings.books = [];
                this.settings.activeBookId = undefined;
            }
        } else {
            const normalized = this.settings.books.map(b => normalizeBookProfile(b));
            if (JSON.stringify(normalized) !== JSON.stringify(this.settings.books)) {
                this.settings.books = normalized;
                booksMigrated = true;
            }
            const activeExists = this.settings.activeBookId
                ? this.settings.books.some(b => b.id === this.settings.activeBookId)
                : false;
            if (!activeExists) {
                this.settings.activeBookId = this.settings.books[0]?.id;
                booksMigrated = true;
            }
        }

        if (this.settings.books.length > 0) {
            const active = getActiveBook(this.settings);
            const activeSource = active?.sourceFolder?.trim() || '';
            if (this.settings.sourcePath !== activeSource) {
                this.settings.sourcePath = activeSource;
                booksMigrated = true;
            }

            // ─── Migrate global lastUsedPandocLayoutByPreset into active book ───
            const globalLayoutPrefs = (this.settings as LegacyPersistedSettings).lastUsedPandocLayoutByPreset;
            if (active && globalLayoutPrefs && Object.keys(globalLayoutPrefs).length > 0 && !active.lastUsedPandocLayoutByPreset) {
                const validPresets = new Set(['novel', 'screenplay', 'podcast']);
                const filtered: Record<string, string> = {};
                for (const [key, val] of Object.entries(globalLayoutPrefs)) {
                    if (validPresets.has(key) && typeof val === 'string') {
                        filtered[key] = val;
                    }
                }
                if (Object.keys(filtered).length > 0) {
                    active.lastUsedPandocLayoutByPreset = filtered;
                }
                (this.settings as LegacyPersistedSettings).lastUsedPandocLayoutByPreset = {};
                booksMigrated = true;
            }
        }

        let timelineScopeMigrated = false;
        if (this.settings.timelineScope !== 'book' && this.settings.timelineScope !== 'saga') {
            this.settings.timelineScope = 'book';
            timelineScopeMigrated = true;
        }
        if (this.settings.timelineScope === 'saga' && (!isSagaScopeAvailable(this.settings) || !hasProFeatureAccess(this))) {
            this.settings.timelineScope = 'book';
            timelineScopeMigrated = true;
        }

        // Canonical AI settings migration/validation.
        const aiMigration = migrateAiSettings(this.settings);
        this.settings.aiSettings = aiMigration.aiSettings;
        const aiValidation = validateAiSettings(this.settings.aiSettings);
        this.settings.aiSettings = aiValidation.value;
        const aiSettingsMigrated = aiMigration.changed || aiValidation.warnings.length > 0;
        if (aiValidation.warnings.length) {
            const prior = new Set(this.settings.aiSettings.migrationWarnings || []);
            aiValidation.warnings.forEach(warning => prior.add(warning));
            this.settings.aiSettings.migrationWarnings = Array.from(prior);
            this.settings.aiSettings.upgradedBannerPending = true;
        }

        if (needsLegacyKeyMigration(this)) {
            const keyMigration = await migrateLegacyKeysToSecretStorage(this);
            if (keyMigration.warnings.length) {
                const canonical = this.settings.aiSettings ?? buildDefaultAiSettings();
                const prior = new Set(canonical.migrationWarnings || []);
                keyMigration.warnings.forEach(warning => prior.add(warning));
                canonical.migrationWarnings = Array.from(prior);
                this.settings.aiSettings = canonical;
            }
        }
        stripLegacyAiSettings(this.settings);

        if (typeof this.settings.lastSeenReleaseNotesVersion !== 'string') {
            this.settings.lastSeenReleaseNotesVersion = DEFAULT_SETTINGS.lastSeenReleaseNotesVersion;
        }
        if (this.settings.cachedReleaseNotes === undefined) {
            this.settings.cachedReleaseNotes = DEFAULT_SETTINGS.cachedReleaseNotes;
        }

        // Fresh first-time install: the upgrade/migration alerts and the
        // release-notes modal target existing users moving up from an earlier
        // version — a brand-new vault has nothing to migrate. Snapshot the
        // current alert IDs as a "pre-acknowledged at install" baseline and mark
        // the latest release notes as already seen, so a new user starts clean.
        // Future updates introduce alert IDs not in this baseline, so genuine
        // upgrade notices still surface once this user becomes an upgrader.
        let freshInstallSeeded = false;
        if (isFreshInstall && this.settings.installAlertBaseline === undefined) {
            this.settings.installAlertBaseline = getAllRefactorAlertIds();
            const latestReleaseVersion = (releaseNotesBundle as { entries?: Array<{ version?: string }> }).entries?.[0]?.version;
            if (typeof latestReleaseVersion === 'string') {
                this.settings.lastSeenReleaseNotesVersion = latestReleaseVersion;
            }
            freshInstallSeeded = true;
        }
        if (this.settings.authorProgress) {
            // Always auto-update export paths (no user toggle)
            this.settings.authorProgress.defaults.autoUpdateExportPath = true;
            // Clear stale legacy paths that use old size tokens (medium/small/large/thumb)
            const defaults = this.settings.authorProgress.defaults;
            const ep = defaults.exportPath ?? '';
            if (ep && /-(thumb|small|medium|large)\.(png|svg)$/.test(ep)) {
                defaults.exportPath = '';
            }
        }
        if (this.settings.releaseNotesLastFetched !== undefined) {
            const parsed = Date.parse(this.settings.releaseNotesLastFetched);
            if (Number.isNaN(parsed)) {
                this.settings.releaseNotesLastFetched = undefined;
            }
        }

        const legacyManuscriptFolder = 'Radial Timeline/Manuscript';
        const legacyOutlineFolder = 'Radial Timeline/Outline';
        const exportFolderDefault = DEFAULT_SETTINGS.manuscriptOutputFolder || 'Radial Timeline/Export';
        const manuscriptFolder = (this.settings.manuscriptOutputFolder || '').trim();
        const outlineFolder = ((this.settings as LegacyPersistedSettings).outlineOutputFolder || '').trim();
        let exportFolderMigrated = false;

        if (!manuscriptFolder || manuscriptFolder === legacyManuscriptFolder) {
            this.settings.manuscriptOutputFolder = exportFolderDefault;
            exportFolderMigrated = true;
        }

        if (!outlineFolder || outlineFolder === legacyOutlineFolder || outlineFolder !== this.settings.manuscriptOutputFolder) {
            (this.settings as LegacyPersistedSettings).outlineOutputFolder = this.settings.manuscriptOutputFolder || exportFolderDefault;
            exportFolderMigrated = true;
        }

        if (!this.settingsService) {
            this.settingsService = new SettingsService(this);
        }

        const beatSettingsMigration = migrateBeatSettings(this.settings);

        // ─── Migrate legacy backdropYamlTemplate → backdropYamlTemplates ────
        let backdropTemplateMigrated = false;
        if (!this.settings.backdropYamlTemplates) {
            const knownBaseKeys = ['Class', 'When', 'End', 'Context', 'Synopsis'];
            const legacyBackdropTemplate = (this.settings as LegacyPersistedSettings).backdropYamlTemplate ?? '';
            if (legacyBackdropTemplate.trim()) {
                // Parse all keys from the legacy template
                const allKeys: string[] = [];
                for (const line of legacyBackdropTemplate.split('\n')) {
                    const m = line.match(/^([A-Za-z0-9 _'-]+):/);
                    if (m) {
                        const k = m[1].trim();
                        if (k && !allKeys.includes(k)) allKeys.push(k);
                    }
                }
                // Base = known base keys in canonical order; Advanced = everything else in original order
                const advancedKeys = allKeys.filter(k => !knownBaseKeys.includes(k));
                if (advancedKeys.length > 0) {
                    // Build advanced YAML string from extra keys (strip comments, use empty values)
                    const advLines = advancedKeys.map(k => `${k}:`);
                    this.settings.backdropYamlTemplates = {
                        base: `Class: Backdrop\nWhen: {{When}}\nEnd: {{End}}\nContext:`,
                        advanced: advLines.join('\n'),
                    };
                } else {
                    this.settings.backdropYamlTemplates = {
                        base: `Class: Backdrop\nWhen: {{When}}\nEnd: {{End}}\nContext:`,
                        advanced: '',
                    };
                }
                backdropTemplateMigrated = true;
            }
        }
        if (this.settings.backdropYamlTemplates?.base?.includes('Synopsis:')) {
            this.settings.backdropYamlTemplates.base = this.settings.backdropYamlTemplates.base.replace(/^Synopsis:/gm, 'Context:');
            backdropTemplateMigrated = true;
        }
        if (this.settings.backdropHoverMetadataFields === undefined) {
            this.settings.backdropHoverMetadataFields = [];
            backdropTemplateMigrated = true;
        }
        if (this.settings.enableBackdropYamlEditor === undefined) {
            this.settings.enableBackdropYamlEditor = false;
            backdropTemplateMigrated = true;
        }

        // ─── Migrate legacy pandocTemplates → pandocLayouts ─────────────────
        let pandocLayoutsMigrated = false;
        const legacyTemplates = (this.settings as LegacyPersistedSettings).pandocTemplates;
        if (legacyTemplates && (!this.settings.pandocLayouts || this.settings.pandocLayouts.length === 0)) {
            const migrated: import('./types').PandocLayoutTemplate[] = [];
            const presets = ['screenplay', 'podcast', 'novel'] as const;
            const nameMap: Record<string, string> = { screenplay: 'Screenplay Template', podcast: 'Podcast Template', novel: 'Novel Template' };
            for (const preset of presets) {
                const p = legacyTemplates[preset];
                if (p && p.trim()) {
                    migrated.push({
                        id: `${preset}-migrated`,
                        name: nameMap[preset],
                        preset,
                        path: p.trim(),
                        bundled: false
                    });
                }
            }
            if (migrated.length > 0) {
                this.settings.pandocLayouts = migrated;
                (this.settings as LegacyPersistedSettings).pandocTemplates = undefined;
                pandocLayoutsMigrated = true;
            }
        }
        const bundledPandocLayoutsRegistered = ensureBundledPandocLayoutsRegistered(this);
        const publishingModelMigrated = this.syncPublishingModelState();
        const legacyLayoutIdMap: Record<string, string> = {
            'bundled-novel-signature-literary-rt': 'bundled-fiction-signature-literary',
            'bundled-novel': 'bundled-fiction-signature-literary',
        };
        let pandocLayoutReferenceMigrated = false;
        let manuscriptExportCleanupMigrated = false;
        if (Array.isArray(this.settings.manuscriptExportTemplates)) {
            for (const template of this.settings.manuscriptExportTemplates) {
                const selected = template.selectedLayoutId;
                if (selected && legacyLayoutIdMap[selected]) {
                    template.selectedLayoutId = legacyLayoutIdMap[selected];
                    pandocLayoutReferenceMigrated = true;
                }
                const cleanupFormat = template.outputFormat === 'pdf' ? 'pdf' : 'markdown';
                const existingCleanup = (template as { exportCleanup?: Partial<ManuscriptExportCleanupOptions> }).exportCleanup;
                const normalizedCleanup = normalizeManuscriptCleanupOptions(existingCleanup, cleanupFormat);
                if (
                    !existingCleanup
                    || existingCleanup.stripComments !== normalizedCleanup.stripComments
                    || existingCleanup.stripAiComments !== normalizedCleanup.stripAiComments
                    || existingCleanup.stripLinks !== normalizedCleanup.stripLinks
                    || existingCleanup.stripCallouts !== normalizedCleanup.stripCallouts
                    || existingCleanup.stripBlockIds !== normalizedCleanup.stripBlockIds
                ) {
                    template.exportCleanup = normalizedCleanup;
                    manuscriptExportCleanupMigrated = true;
                }
            }
        }
        if (Array.isArray(this.settings.books)) {
            for (const book of this.settings.books) {
                const lastUsed = book.lastUsedPandocLayoutByPreset;
                if (!lastUsed) continue;
                const novelLayout = lastUsed.novel;
                if (novelLayout && legacyLayoutIdMap[novelLayout]) {
                    lastUsed.novel = legacyLayoutIdMap[novelLayout];
                    pandocLayoutReferenceMigrated = true;
                }
            }
        }
        const globalLastUsed = (this.settings as LegacyPersistedSettings).lastUsedPandocLayoutByPreset;
        if (globalLastUsed?.novel && legacyLayoutIdMap[globalLastUsed.novel]) {
            globalLastUsed.novel = legacyLayoutIdMap[globalLastUsed.novel];
            pandocLayoutReferenceMigrated = true;
        }

        // ─── Migrate vault-global stage target dates → per-book (active book) ───
        // Target dates described "the book being worked on"; they now live on
        // BookProfile.stageTargetDates. The legacy field is copied onto the
        // active book (unless it already has its own) and cleared for good.
        let stageTargetsMigrated = false;
        const legacyStageTargets = this.settings.stageTargetDates;
        if (legacyStageTargets !== undefined) {
            const hasLegacyValues = Object.values(legacyStageTargets ?? {}).some(v => typeof v === 'string' && v);
            if (hasLegacyValues) {
                const activeBook = getActiveBook(this.settings);
                if (activeBook && !activeBook.stageTargetDates) {
                    activeBook.stageTargetDates = { ...legacyStageTargets };
                }
            }
            this.settings.stageTargetDates = undefined;
            stageTargetsMigrated = true;
        }

        if (freshInstallSeeded || proEntitlementSeeded || gossamerRunFilterMigrated || aiSettingsMigrated || exportFolderMigrated || beatSettingsMigration.changed || backdropTemplateMigrated || pandocLayoutsMigrated || bundledPandocLayoutsRegistered || publishingModelMigrated || pandocLayoutReferenceMigrated || manuscriptExportCleanupMigrated || booksMigrated || timelineScopeMigrated || planetarySelectionMigrated || modeMigrated || stageTargetsMigrated) {
            await this.saveSettings();
        }
    }

    async saveSettings(): Promise<void> {
        this.saveRequested = true;
        if (!this.saveInFlight) {
            this.saveInFlight = (async () => {
                try {
                    while (this.saveRequested) {
                        this.saveRequested = false;
                        await this.performSave();
                    }
                } finally {
                    this.saveInFlight = null;
                }
            })();
        }
        await this.saveInFlight;
    }

    private async performSave(): Promise<void> {
        this.syncGossamerRunFilterSettings();
        this.syncLegacySourcePathFromActiveBook();
        this.syncPublishingModelState();
        stripLegacyAiSettings(this.settings);
        stripLegacyBeatSettings(this.settings);
        if (__RT_DEV__) {
            try {
                const serialized = JSON.stringify(this.settings);
                const match = detectPlaintextCredentialPattern(serialized);
                if (match) {
                    console.error(
                        `[AI][credentials] Plaintext credential detected in settings serialization: ${match}. `
                        + 'Use saved keys and clear older key fields.'
                    );
                }
            } catch (error) {
                console.error('[AI][credentials] Failed to run plaintext credential scan.', error);
            }
        }
        // Inquiry sessions live in the vault sidecar (single source of truth),
        // never in data.json. Strip the in-memory mirror before writing so the
        // brief store has exactly one persisted home.
        const persistedSettings = { ...this.settings };
        delete persistedSettings.inquirySessionCache;
        await this.saveData(persistedSettings);
    }

    // Helper method to validate and remember folder paths
    async validateAndRememberPath(path: string): Promise<boolean> {
        return this.settingsService.validateAndRememberPath(path);
    }

    // ── Settings-aware refresh (tiered impact model) ─────────────────
    // Settings UI calls this instead of refreshTimelineIfNeeded(null) so
    // that only settings with a real visual effect trigger a render.
    //
    //   Tier 1 ("none")       — no-op; just save.
    //   Tier 2 ("selective")  — selective DOM-mutation path (no container.empty()).
    //   Tier 3 ("full")       — full SVG rebuild (same as the legacy path).

    onSettingChanged(impact: import('./settings/SettingImpact').SettingImpact): void {
        if (impact.kind === 'none') return;

        if (impact.kind === 'selective') {
            // Route through the batched scheduler so rapid changes are coalesced.
            // Debounce 50 ms — fast enough to feel live, slow enough to batch.
            this.timelineService.scheduleRender(impact.changeTypes, 50);
            return;
        }

        // impact.kind === 'full' — debounce 100 ms to avoid flicker cascades
        this.refreshTimelineIfNeeded(null, 100);
    }

    // Method to refresh the timeline if the active view exists (with debouncing)
    refreshTimelineIfNeeded(file: TAbstractFile | null | undefined, delayMs?: number) {
        // For settings changes (file=null), use 0ms delay for immediate feedback
        // For file changes, use provided delay or default 400ms
        const effectiveDelay = file === null && delayMs === undefined ? 0 : (delayMs ?? 400);
        this.timelineService.refreshTimelineIfNeeded(file, effectiveDelay);
    }

    // Search related methods
    public openSearchPrompt(): void { this.searchService.openSearchPrompt(); }

    public performSearch(term: string): void { this.searchService.performSearch(term); }

    public clearSearch(): void { this.searchService.clearSearch(); }

    public setCSSColorVariables(): void {
        this.themeService.applyCssVariables();
    }

    // Add helper method to highlight search terms

    // Helper method to convert DocumentFragment to string for backward compatibility


    // --- START: Color Conversion & Desaturation Helpers ---
    // Ensure these are PUBLIC
    public desaturateColor(hexColor: string, amount: number): string {
        const rgb = hexToRgb(hexColor);
        if (!rgb) return hexColor;
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        hsl.s = Math.max(0, hsl.s * (1 - amount));
        const desat = hslToRgb(hsl.h, hsl.s, hsl.l);
        return rgbToHex(desat.r, desat.g, desat.b);
    }
    // --- END: Color Conversion & Desaturation Helpers ---

    // Add this function inside the RadialTimelinePlugin class
    public calculateCompletionEstimate(scenes: TimelineItem[]) {
        return this.timelineMetricsService.calculateCompletionEstimate(scenes);
    }

    /**
     * Show status bar item with beats processing progress
     */
    showBeatsStatusBar(current: number, total: number): void {
        this.beatsProcessingService.showStatus(current, total);
    }

    /**
     * Hide and remove status bar item when processing completes
     */
    hideBeatsStatusBar(): void {
        this.beatsProcessingService?.hideStatus();
    }

    async saveGossamerScores(
        scores: Map<string, number>,
        signal: GossamerSignalType = DEFAULT_GOSSAMER_SIGNAL,
        justifications?: Map<string, string>,
        source: 'manual-entry' | 'clipboard-paste' = 'manual-entry'
    ): Promise<void> {
        await this.gossamerScoreService.saveScores(scores, signal, justifications, source);
    }

    onunload() {
        // Tear down registered services first; failures are caught per-item
        // so one bad cleanup cannot leak the rest.
        this.disposables.disposeAll();
        // Clean up any other resources
        this.hideBeatsStatusBar();
        // Clean up tooltip anchors appended to document.body
        cleanupTooltipAnchors();
        // Do not detach leaves here; Obsidian owns leaf teardown.
    }

    public dispatch<T>(type: string, detail: T): void {
        this.eventBus.dispatchEvent(new CustomEvent(type, { detail }));
    }

    public subscribe<T>(type: string, listener: (detail: T) => void): () => void {
        const wrapped: EventListener = (event) => {
            listener((event as CustomEvent<T>).detail);
        };
        this.eventBus.addEventListener(type, wrapped);
        return () => this.eventBus.removeEventListener(type, wrapped);
    }

    public getTimelineAuditAiService(): TimelineAuditAiService {
        return this.timelineAuditAiService;
    }

} // End of RadialTimelinePlugin class
