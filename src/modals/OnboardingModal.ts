/*
 * OnboardingModal — imports an existing manuscript into a new book.
 *
 * Every import starts at Choose (detected exports, or any folder). Then:
 *
 *   Radial Timeline book (a folder of scene notes) → Add book, as it is; there
 *                      is nothing to import, and importing would only copy it
 *   Scrivener export → Review (one screen: title, outline columns, live
 *                      result) → Import → the timeline
 *   Other sources    → Prepare → CHECKPOINT 1 (Split: confirm scenes + order,
 *                      before any AI) → Progress (optional AI extraction)
 *                      → CHECKPOINT 2 (Review) → Materialize → Report
 *
 * Nothing is written before the author approves. Scrivener scenes arrive
 * already split and described by the outline, so that lane needs no split
 * editor and no AI.
 *
 * See docs/engineering/plans/one-button-onboarding-local-llm-plan.md.
 */

import { frontmatterValueToText } from '../utils/frontmatter';
import { openSettingsTab } from '../utils/obsidianInternals';
import { App, ButtonComponent, DropdownComponent, Modal, Notice, TFolder, normalizePath, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
  OnboardingService,
  type MaterializeReport,
  type SceneProposal,
  type EntityProposal,
  type ImportFlow,
} from '../onboarding/OnboardingService';
import type { SurveyResult } from '../onboarding/extraction';
import { flattenScenes, type ManuscriptModel } from '../onboarding/adapters/manuscriptModel';
import {
  planSceneSplit,
  toggleBreak,
  segmentCount,
  applySplitsToModel,
  type ScenePlan,
} from '../onboarding/sceneSplitting';
import { basename } from '../onboarding/paths';
import { refreshOnboardingPrompt } from '../onboarding/promptSync';
import { proposeScrivenerAutomap, type ScrivenerFieldTarget } from '../onboarding/adapters/scrivenerAdapter';
import { createBookId, normalizeBookProfile } from '../utils/books';
import { isPathInFolderScope } from '../utils/pathScope';
import { countSceneNotes, discoverOnboardingCandidates, type OnboardingCandidate } from '../onboarding/discovery';
import { missingOutlineText, renderScrivenerExportHelp, renderScrivenerProblems, renderScrivenerReview, renderSourceParts, type ScrivenerReviewState } from './OnboardingScrivenerReview';
import { STAGE_ORDER, type Stage } from '../utils/constants';
import type { AIProviderId } from '../ai/types';
import { forecastOnboardingTokens, forecastOnboardingCost } from '../onboarding/costForecast';
import { formatApproxUsdCost } from '../ai/cost/estimateCorpusCost';
import {
  getOnboardingSplitInstructions,
  getOnboardingSceneInstructions,
  getOnboardingSurveyInstructions,
  getOnboardingEntityInstructions,
  getOnboardingSplitJsonSchema,
  getOnboardingSceneJsonSchema,
  getOnboardingSurveyJsonSchema,
  getOnboardingEntityJsonSchema
} from '../ai/prompts/onboarding';
import { measureRequestEnvelopeChars } from '../ai/runtime/aiClient';
import { resolveSpendLabel } from '../onboarding/spendLabel';
import { captureSpendFields, applySpendFields } from '../onboarding/sessionSpend';
import type { EntityKind } from '../utils/entityNotes';
import type { BookProfile } from '../types/settings';
import { t, tCount } from '../i18n';

/** Narrow an unknown frontmatter value to a list of non-empty strings. */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Display a `[[Wiki Link]]` as its bare name for a pill. */
function stripWikiLink(value: string): string {
  return value.replace(/^\[\[/, '').replace(/\]\]$/, '');
}

/**
 * The labeled parts of a manuscript found in the vault. A Scrivener export is
 * its scene files plus the outline CSV; a missing outline is flagged.
 */
export function candidateParts(candidate: OnboardingCandidate): Array<{ label: string; value: string; warn?: boolean }> {
  const scenes = t('ui.onboardingScrivenerReview.sourceScenes');
  if (candidate.kind === 'book') return [{ label: scenes, value: t('ui.onboardingModal.existingBookScenes', { scenes: tCount('sceneNote', candidate.sceneCount) }) }];
  if (candidate.kind === 'word') return [{ label: t('ui.onboardingModal.sourceDocument'), value: candidate.document }];
  const properties = t('ui.onboardingScrivenerReview.sourceProperties');
  return [
    { label: scenes, value: tCount('textFile', candidate.sceneCount) },
    candidate.outline
      ? { label: properties, value: t('ui.onboardingModal.scrivenerOutlineValue', { outline: candidate.outline }) }
      : { label: properties, value: missingOutlineText(), warn: true },
  ];
}

/** Author-facing names for the import lanes shown on the Prepare screen. */
const FLOW_LABELS: Record<ImportFlow, () => string> = {
  single: () => t('ui.onboardingModal.flowSingle'),
  docx: () => t('ui.onboardingModal.flowDocx'),
  scrivener: () => t('ui.onboardingModal.flowScrivener'),
  folder: () => t('ui.onboardingModal.flowFolder'),
};

/**
 * Open plugin settings on the AI tab. The tab is forced AFTER the pane opens —
 * setting it before let the pane restore its last-active tab instead.
 */
function openAiSettings(plugin: RadialTimelinePlugin): void {
  if (!openSettingsTab(plugin.app)) return;
  window.setTimeout(() => plugin.settingsTab?.setActiveTab('ai'), 80);
}

/** Local model ids can be full filesystem paths — show just the leaf name in the header pill. */
function abbreviateModelId(id: string): string {
  const leaf = (id || '').trim().split(/[\\/]/).pop() ?? ''; // SAFE: display-only leaf of a model id; an empty id renders as an empty label
  return leaf.replace(/\.(gguf|safetensors|bin)$/i, '');
}

/** First `max` chars of a paragraph for the split-editor preview, with an ellipsis. */
function truncateText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed;
}

/**
 * In-flight onboarding state that survives the modal being dismissed (a stray
 * click outside an Obsidian modal closes it). Module-scoped: reopening the
 * command on the same book folder resumes — including partially extracted
 * scenes, which are reused instead of re-run. Cleared on Apply, on an explicit
 * Cancel, or when a different book folder is onboarded. In-memory only: an
 * app relaunch starts fresh.
 */
interface OnboardingSession {
  folder: string;
  sourceBook: BookProfile | null;
  stage: 'confirm' | 'review' | 'scrivener';
  aiAvailable: boolean;
  useAi: boolean;
  engine: 'local' | 'cloud';
  modelLabel: string;
  flowOverride: ImportFlow | null;
  publishStage: Stage;
  createCharacters: boolean;
  createPlaces: boolean;
  generateSummaries: boolean;
  metadataMapping: Record<string, ScrivenerFieldTarget> | null;
  importAnyway: boolean;
  model: ManuscriptModel | null;
  extractModel: ManuscriptModel | null;
  splitPlans: Map<string, ScenePlan>;
  splitOutcomes: Map<string, 'split' | 'failed' | 'fallback'> | null;
  survey: SurveyResult | null;
  proposals: SceneProposal[];
  entityProposals: EntityProposal[];
  /**
   * Spend-forecast inputs. Persisted because they are derived at ingest and
   * from the split — a resumed session that dropped them would silently lose
   * the cost display, and a missing price reads as "free".
   */
  manuscriptChars: number;
  chapterCount: number;
  forecastSceneCount: number | null;
  /**
   * Cloud pricing identity. Persisted because resume does NOT re-run preflight
   * — without these, buildSpendLabel() returns null on every resumed session
   * and the price silently disappears. A missing price reads as "free", which
   * is the most expensive thing this UI could imply.
   */
  costProvider: AIProviderId | null;
  costModelId: string | null;
  costSubstitutedFrom: string | null;
}

let activeSession: OnboardingSession | null = null;

export class OnboardingModal extends Modal {
  private readonly plugin: RadialTimelinePlugin;
  private readonly service: OnboardingService;
  private book: BookProfile | null = null;
  private model: ManuscriptModel | null = null;
  private survey: SurveyResult | null = null;
  private proposals: SceneProposal[] = [];
  private entityProposals: EntityProposal[] = [];
  /** Per-file split proposals, keyed by sourceRef; edited at Checkpoint 1. */
  private splitPlans: Map<string, ScenePlan> = new Map();
  /** Per-file auto-split outcomes; null until "Auto-split with AI" has run. */
  private splitOutcomes: Map<string, 'split' | 'failed' | 'fallback'> | null = null;
  private publishStage: Stage = 'Zero';
  // Extra work beyond scenes — all off by default so the core run is just
  // "split into scene notes with YAML + Synopsis". The author opts in.
  private createCharacters = false;
  private createPlaces = false;
  private generateSummaries = false;
  /** Abbreviated local model name for the header pill (set once preflight runs). */
  private modelLabel = '';
  /** Author's Prepare-screen lane choice; null = trust auto-detection. */
  private flowOverride: ImportFlow | null = null;
  /** Scrivener column decisions (seeded from the automap; author-edited at Review). */
  private metadataMapping: Record<string, ScrivenerFieldTarget> | null = null;
  /** The author chose to import a Scrivener export despite its problems. */
  private importAnyway = false;
  /**
   * True only when AI was requested and a capable engine is available.
   * Structure-only imports skip every AI stage and hide its controls.
   */
  private aiAvailable = false;
  /** AI assistance is an explicit per-run opt-in. */
  private useAi = false;
  /** Which AI drives the run: local model (default) or the configured cloud provider. */
  private engine: 'local' | 'cloud' = 'local';
  /**
   * Manuscript size and structure, captured at ingest, for the spend forecast
   * in the header pill. Scene count stays null until the split stage has run —
   * before that the forecast is a RANGE, because the number of extraction
   * calls genuinely is not known yet. Inventing a point estimate there would
   * be a guess dressed as a number.
   */
  /** Cloud engine identity for pricing; null whenever cost does not apply. */
  // These six fields are the SpendSessionFields slice; captureSpendFields /
  // applySpendFields read and write them by name.
  manuscriptChars = 0;
  chapterCount = 0;
  forecastSceneCount: number | null = null;
  costProvider: AIProviderId | null = null;
  costModelId: string | null = null;
  /** Live handle to the spend pill so option changes update it in place. */
  private spendEl: HTMLElement | null = null;
  /**
   * Alias the policy asked for when the resolver had to substitute. Non-null
   * means the run will NOT use the model the author's settings name — most
   * often a Claude alias pinned under a non-Claude provider.
   */
  costSubstitutedFrom: string | null = null;
  /** The split+mapping-applied model extraction actually ran against (for resume). */
  private extractModel: ManuscriptModel | null = null;
  private abortController: AbortController | null = null;

  /**
   * `folder` opens straight on a source the opener already found; `onClosed`
   * lets the opener refresh after an import (Book Manager redraws its list).
   */
  constructor(app: App, plugin: RadialTimelinePlugin, private readonly options: { folder?: string; onClosed?: () => void } = {}) {
    super(app);
    this.plugin = plugin;
    this.service = new OnboardingService(plugin);
  }

  /** Snapshot the run into the module-scoped session so dismissal loses nothing. */
  private persistSession(stage: OnboardingSession['stage']): void {
    activeSession = {
      sourceBook: this.book,
      folder: this.book?.sourceFolder ?? '', // SAFE: no book selected yet; the empty path is the "nothing chosen" state the form renders
      stage,
      aiAvailable: this.aiAvailable,
      useAi: this.useAi,
      engine: this.engine,
      modelLabel: this.modelLabel,
      flowOverride: this.flowOverride,
      publishStage: this.publishStage,
      createCharacters: this.createCharacters,
      createPlaces: this.createPlaces,
      // Spend slice is captured as a unit — see sessionSpend.ts. Listing these
      // by hand in two places is how the resume defect got in.
      ...captureSpendFields(this),
      generateSummaries: this.generateSummaries,
      metadataMapping: this.metadataMapping,
      importAnyway: this.importAnyway,
      model: this.model,
      extractModel: this.extractModel,
      splitPlans: this.splitPlans,
      splitOutcomes: this.splitOutcomes,
      survey: this.survey,
      proposals: this.proposals,
      entityProposals: this.entityProposals,
    };
  }

  private restoreSession(session: OnboardingSession): void {
    this.book = session.sourceBook;
    this.aiAvailable = session.aiAvailable;
    this.useAi = session.useAi;
    this.engine = session.engine;
    this.service.setEngine(session.engine);
    this.modelLabel = session.modelLabel;
    this.flowOverride = session.flowOverride;
    this.publishStage = session.publishStage;
    this.createCharacters = session.createCharacters;
    this.createPlaces = session.createPlaces;
    applySpendFields(this, session);
    this.generateSummaries = session.generateSummaries;
    this.metadataMapping = session.metadataMapping;
    this.importAnyway = session.importAnyway;
    this.model = session.model;
    this.extractModel = session.extractModel;
    this.splitPlans = session.splitPlans;
    this.splitOutcomes = session.splitOutcomes;
    this.survey = session.survey;
    this.proposals = session.proposals;
    this.entityProposals = session.entityProposals;
  }

  onOpen(): void {
    const { modalEl, contentEl } = this;
    modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
    modalEl.setCssStyles({ width: '832px', maxWidth: '94vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
    contentEl.addClass('ert-modal-container', 'ert-stack');

    // Resume: a dismissed modal (stray outside click, Escape) loses nothing —
    // reopening picks up exactly where it left off.
    const folder = this.options.folder;
    if (activeSession?.model && (!folder || activeSession.folder === folder)) {
      this.restoreSession(activeSession);
      if (activeSession.stage === 'scrivener') {
        void this.showScrivenerReview();
      } else if (activeSession.stage === 'review' && this.proposals.length > 0) {
        this.showReviewCheckpoint();
      } else {
        this.showSplitCheckpoint();
      }
      return;
    }
    if (folder) {
      void this.selectSourceFolder(folder);
      return;
    }
    void this.showSourceSelection();
  }

  onClose(): void {
    this.abortController?.abort();
    this.contentEl.empty();
    this.options.onClosed?.();
  }

  // ---- Views -------------------------------------------------------------

  private async showSourceSelection(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: 'ert-modal-header' });
    header.createSpan({ cls: 'ert-modal-badge', text: t('ui.onboardingModal.importBadge') });
    header.createDiv({ cls: 'ert-modal-title', text: t('ui.onboardingModal.importTitle') });
    header.createDiv({ cls: 'ert-modal-subtitle', text: t('ui.onboardingModal.importSubtitle') });

    const panel = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    const found = panel.createDiv({ cls: 'ert-stack' });
    found.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingModal.lookingForExports') });

    const other = panel.createDiv({ cls: 'ert-onb-bookrow' });
    const input = other.createEl('input', { type: 'text', cls: 'ert-input', attr: { placeholder: t('ui.onboardingModal.folderInputPlaceholder'), 'aria-label': t('ui.onboardingModal.folderInputAria') } });
    const error = panel.createDiv({ cls: 'ert-section-desc ert-section-desc--alert' });
    const selectFolder = async (path: string) => {
      const folder = normalizePath(path.trim());
      if (!folder || folder === '/' || !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
        error.setText(t('ui.onboardingModal.chooseFolderInVault'));
        return;
      }
      await this.selectSourceFolder(folder);
    };
    new ButtonComponent(other).setButtonText(t('ui.onboardingModal.openFolder')).onClick(() => void selectFolder(input.value));
    const { ModalFolderSuggest } = await import('../settings/FolderSuggest');
    new ModalFolderSuggest(this.app, input, () => error.setText(''));
    renderScrivenerExportHelp(panel);

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => this.close());

    try {
      const candidates = await discoverOnboardingCandidates(this.app, (this.plugin.settings.books ?? []).map(book => book.sourceFolder)); // SAFE: new vaults have no registered books
      if (!found.isConnected) return;
      found.empty();
      if (candidates.length === 0) {
        found.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingModal.noExportsFound') });
      }
      for (const candidate of candidates) {
        const row = found.createEl('button', { cls: 'ert-modal-choice', attr: { type: 'button' } });
        const name = row.createDiv({ cls: 'ert-onb-source__name', text: basename(candidate.folder) });
        if (candidate.folder !== basename(candidate.folder)) name.createSpan({ cls: 'ert-section-desc', text: `  ${candidate.folder}` });
        renderSourceParts(row, candidateParts(candidate));
        row.addEventListener('click', () => void selectFolder(candidate.folder));
      }
    } catch (failure) {
      if (found.isConnected) found.setText(t('ui.onboardingModal.cannotScanVault', { message: failure instanceof Error ? failure.message : String(failure) }));
    }
  }

  /**
   * Keep the chosen source local until the author approves materialization.
   * A folder of scene notes is already a Radial Timeline book: it is added as
   * it is, never run through an import.
   */
  private async selectSourceFolder(folder: string): Promise<void> {
    const registered = (this.plugin.settings.books ?? []) // SAFE: a new vault has no books
      .filter(book => isPathInFolderScope(folder, book.sourceFolder))
      .sort((a, b) => b.sourceFolder.length - a.sourceFolder.length)[0] ?? null; // SAFE: null when no book in Book Manager holds this folder
    const sceneCount = countSceneNotes(this.app, folder);
    if (registered || sceneCount > 0) {
      this.showExistingBook(folder, registered, sceneCount);
      return;
    }
    activeSession = null;
    this.book = normalizeBookProfile({ id: createBookId(), title: folder.slice(folder.lastIndexOf('/') + 1), sourceFolder: folder });
    this.flowOverride = null;
    this.metadataMapping = null;
    this.importAnyway = false;
    this.model = null;
    this.extractModel = null;
    this.survey = null;
    this.proposals = [];
    this.entityProposals = [];
    this.useAi = false;
    this.aiAvailable = false;
    this.modelLabel = '';
    this.forecastSceneCount = null;
    this.splitPlans.clear();
    this.splitOutcomes = null;
    await this.showPreflight();
  }

  /**
   * A folder that is already a Radial Timeline book: add it to Book Manager as
   * it is, or show it when Book Manager already has it.
   */
  private showExistingBook(folder: string, registered: BookProfile | null, sceneCount: number): void {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: 'ert-modal-header' });
    header.createSpan({ cls: 'ert-modal-badge', text: t('ui.onboardingModal.importBadge') });
    header.createDiv({ cls: 'ert-modal-title', text: basename(folder) });
    header.createDiv({ cls: 'ert-modal-subtitle', text: registered
      ? t('ui.onboardingModal.registeredBookSubtitle', { title: registered.title })
      : t('ui.onboardingModal.existingBookSubtitle') });
    const panel = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    renderSourceParts(panel, [{ label: t('ui.onboardingScrivenerReview.sourceScenes'), value: tCount('sceneNote', sceneCount) }]);
    if (!registered) panel.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingModal.existingBookNothingToImport') });
    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.chooseAnotherManuscript')).onClick(() => void this.showSourceSelection());
    new ButtonComponent(actions)
      .setButtonText(registered ? t('ui.onboardingModal.showOnTimeline') : t('ui.generalSection.addBook'))
      .setCta()
      .onClick(() => void (async () => {
        if (registered) {
          await this.plugin.setActiveBookId(registered.id);
        } else {
          const added = await this.service.addBook({ title: basename(folder), sourceFolder: folder });
          new Notice(t('ui.onboardingModal.bookAddedNotice', { title: added.title }));
        }
        this.close();
        await this.plugin.getTimelineService().activateView();
      })());
  }

  /**
   * Scrivener lane: read and validate the export, then the one-screen review.
   * Column decisions survive a re-read (Check again, or reopening after a
   * stray dismissal); a column new to this read gets the automap's proposal.
   */
  private async showScrivenerReview(): Promise<void> {
    const book = this.book;
    if (!book) return;
    this.renderBusy(t('ui.onboardingModal.readingExport'));
    const result = await this.service.ingestScrivener(book.sourceFolder, { importAnyway: this.importAnyway });
    if (result.kind !== 'ok') {
      const recheck = (): void => {
        this.importAnyway = false;
        void this.showScrivenerReview();
      };
      const changeSource = (): void => void this.showSourceSelection();
      if (result.kind === 'empty') {
        renderScrivenerProblems(this.contentEl, book.sourceFolder, [{ problem: result.reason, ifImported: '' }], { onRecheck: recheck, onChangeSource: changeSource });
      } else {
        renderScrivenerProblems(this.contentEl, book.sourceFolder, result.problems, {
          onRecheck: recheck,
          onChangeSource: changeSource,
          onContinue: () => {
            this.importAnyway = true;
            void this.showScrivenerReview();
          },
        });
      }
      return;
    }
    this.model = result.model;
    const proposed = proposeScrivenerAutomap(result.model.customFields);
    const decided = this.metadataMapping ?? {}; // SAFE: a first read has no author decisions yet; every column then takes its proposal
    this.metadataMapping = Object.fromEntries(
      result.model.customFields.map((field) => [field, decided[field] ?? proposed[field]]) // SAFE: the author's earlier decision wins; columns they never saw take the proposal
    );
    const state: ScrivenerReviewState = {
      book,
      model: result.model,
      outlineName: result.outlineName,
      warnings: result.warnings,
      mapping: this.metadataMapping,
      publishStage: this.publishStage,
      createCharacterNotes: this.createCharacters,
      createPlaceNotes: this.createPlaces,
    };
    const remember = (): void => {
      this.publishStage = state.publishStage;
      this.createCharacters = state.createCharacterNotes;
      this.createPlaces = state.createPlaceNotes;
      this.persistSession('scrivener');
    };
    remember();
    renderScrivenerReview(this.contentEl, state, {
      propose: (model, publishStage) => this.service.buildStructureOnlyProposals(model, { publishStage }),
      destinationFor: (target) => this.service.destinationFor(target),
      destinationExists: (target) => this.service.destinationExists(target),
      onEdit: remember,
      onChangeSource: () => void this.showSourceSelection(),
      onCancel: () => {
        activeSession = null; // explicit cancel discards the run
        this.close();
      },
      onImport: (reviewed) => void this.importScrivener(reviewed.proposals),
    });
  }

  /** Write the reviewed Scrivener import, then show the author their timeline. */
  private async importScrivener(proposals: SceneProposal[]): Promise<void> {
    const book = this.book;
    if (!book) return;
    this.renderBusy(t('ui.onboardingModal.creatingSceneNotes'));
    let report: MaterializeReport;
    try {
      const kinds: EntityKind[] = [];
      if (this.createCharacters) kinds.push('character');
      if (this.createPlaces) kinds.push('place');
      const entities = await this.service.enrichEntities(proposals, { kinds, generateSummaries: false });
      report = await this.service.materialize(book, proposals, entities);
    } catch (error) {
      this.renderMessage(t('ui.onboardingModal.importFailed'), error instanceof Error ? error.message : String(error), true);
      return;
    }
    if (report.errors.length > 0) {
      this.showReport(report);
      return;
    }
    activeSession = null;
    this.close();
    new Notice(t('ui.onboardingModal.importedNotice', { count: report.notesCreated, folder: report.bookFolder }));
    await this.plugin.getTimelineService().activateView();
  }

  private async showPreflight(): Promise<void> {
    this.renderBusy(this.useAi ? t('ui.onboardingModal.checkingAiAndReading') : t('ui.onboardingModal.readingBookFolder'));

    const book = this.book;
    if (!book) {
      await this.showSourceSelection();
      return;
    }

    // A Scrivener export is already split into scenes and described by its
    // outline: it goes straight to the one-screen review, never through the
    // split editor or AI.
    const detection = await this.service.detectImportFlow(book.sourceFolder);
    const activeFlow: ImportFlow | null = this.flowOverride ?? detection?.flow ?? null;
    if (activeFlow === 'scrivener') {
      await this.showScrivenerReview();
      return;
    }
    // Best-effort canonical-prompt refresh (throttled daily; never blocks).
    if (this.useAi) void refreshOnboardingPrompt(this.plugin);

    let preflightReason = '';
    let preflightOk = false;
    let tier = 0;
    try {
      const preflight = this.useAi ? await this.service.preflight() : null;
      if (preflight) {
        preflightOk = preflight.ok;
        preflightReason = preflight.reason;
        tier = preflight.tier;
        if (preflight.modelId) this.modelLabel = abbreviateModelId(preflight.modelId);
      }
    } catch (error) {
      preflightReason = error instanceof Error ? error.message : String(error);
    }

    let ingestReason = '';
    let candidateCount = 0;
    let skippedCount = 0;
    try {
      this.model = null;
      const ingest = await this.service.ingest(book.sourceFolder, activeFlow ?? 'folder');
      if (ingest.kind === 'needs-order') {
        ingestReason = ingest.reason;
      } else {
        this.model = ingest.model;
        const scenes = flattenScenes(ingest.model);
        skippedCount = scenes.filter((scene) => scene.alreadyOnboarded).length;
        candidateCount = scenes.length - skippedCount;
        // Prose actually sent to the model — the same text the adapters
        // produced, so the forecast measures the real payload rather than the
        // source file (which still carries markup the adapter stripped).
        this.manuscriptChars = scenes.reduce((total, scene) => total + scene.rawText.length, 0);
        this.chapterCount = ingest.model.chapters.length;
      }
    } catch (error) {
      ingestReason = error instanceof Error ? error.message : String(error);
    }

    // Check configured engines only after the author requests AI assistance.
    const cloud = this.useAi
      ? await this.service.cloudAvailability()
      : { ok: false, provider: 'none' as const, label: '', modelId: undefined, modelLabel: undefined, substitutedFromAlias: undefined };
    if (this.engine === 'local' && !preflightOk && cloud.ok) this.engine = 'cloud';
    if (this.engine === 'cloud' && !cloud.ok) this.engine = 'local';
    this.costProvider = cloud.ok ? cloud.provider : null;
    this.costModelId = cloud.ok ? (cloud.modelId ?? null) : null;
    this.aiAvailable = this.engine === 'cloud' ? cloud.ok : preflightOk;
    // Name the MODEL, not just the provider. "Anthropic cloud" does not tell an
    // author whether they are about to spend a dollar or ten, and the pill sits
    // right beside a figure derived from that exact model.
    this.modelLabel = this.engine === 'cloud' && cloud.ok
        ? (cloud.modelLabel ? `${cloud.label} ${cloud.modelLabel}` : t('ui.onboardingModal.providerCloudLabel', { provider: cloud.label }))
        : this.modelLabel;
    this.costSubstitutedFrom = cloud.ok ? (cloud.substitutedFromAlias ?? null) : null;
    this.service.setEngine(this.engine);

    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(1, t('ui.onboardingModal.prepareTitle'), t('ui.onboardingModal.prepareSubtitle', { folder: book.sourceFolder }));

    const status = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    // Raw diagnostics text ("Structured JSON path not tested") is engineer-speak
    // — authors get a plain state; the tier reason stays since it is actionable.
    const localUnavailable = /tier/i.test(preflightReason)
      ? t('ui.onboardingModal.localModelNotAvailable', { reason: preflightReason.toLowerCase() })
      : t('ui.onboardingModal.localModelNotConnected');
    const engineValue = this.engine === 'cloud'
      ? t('ui.onboardingModal.cloudEngine', { provider: cloud.label })
      : preflightOk ? t('ui.onboardingModal.localModelReady', { tier }) : localUnavailable;
    const modeRow = status.createDiv({ cls: 'ert-row ert-onb-stagerow' });
    modeRow.createSpan({ text: t('ui.onboardingModal.importModeLabel'), cls: 'ert-section-desc' });
    new DropdownComponent(modeRow)
      .addOptions({ structure: t('ui.onboardingModal.modeStructureOnly'), ai: t('ui.onboardingModal.modeAiAssisted') })
      .setValue(this.useAi ? 'ai' : 'structure')
      .then((dropdown) => dropdown.selectEl.setAttribute('aria-label', t('ui.onboardingModal.importModeAria')))
      .onChange((value) => {
        this.useAi = value === 'ai';
        void this.showPreflight();
      });
    if (this.useAi) this.renderStatusRow(status, t('ui.onboardingModal.aiEngineLabel'), engineValue, this.aiAvailable);

    // Offer the switch whenever the OTHER engine is also viable.
    const engineChoices: Array<['local' | 'cloud', string]> = [];
    if (preflightOk) engineChoices.push(['local', t('ui.onboardingModal.engineLocalFree')]);
    if (cloud.ok) engineChoices.push(['cloud', t('ui.onboardingModal.cloudEngine', { provider: cloud.label })]);
    if (engineChoices.length > 1) {
      const engineRow = status.createDiv({ cls: 'ert-row ert-onb-stagerow' });
      engineRow.createSpan({ text: t('ui.onboardingModal.runAiWithLabel'), cls: 'ert-section-desc' });
      new DropdownComponent(engineRow)
        .addOptions(Object.fromEntries(engineChoices))
        .setValue(this.engine)
        .onChange((value) => {
          this.engine = value as 'local' | 'cloud'; // SAFE: options are exactly local|cloud
          void this.showPreflight();
        });
    }
    if (this.engine === 'cloud' && this.costSubstitutedFrom) {
      status.createDiv({
        cls: 'ert-onb-warn',
        text: cloud.modelLabel !== undefined
          ? t('ui.onboardingModal.pinnedModelSubstituted', { pinned: this.costSubstitutedFrom, model: cloud.modelLabel })
          : t('ui.onboardingModal.pinnedModelSubstitutedUnknown', { pinned: this.costSubstitutedFrom }),
      });
    }
    if (!this.aiAvailable) {
      status.createDiv({
        cls: 'ert-section-desc',
        text: this.useAi
          ? t('ui.onboardingModal.aiNotAvailable')
          : t('ui.onboardingModal.structureOnlyDesc'),
      });
    }

    // Import lane: say what was detected and why. When the folder's contents
    // support more than one reading, the author can switch lanes right here.
    if (detection && activeFlow) {
      const overridden = this.flowOverride !== null && this.flowOverride !== detection.flow;
      this.renderStatusRow(
        status,
        t('ui.onboardingModal.importFlowLabel'),
        overridden
          ? t('ui.onboardingModal.importFlowValueOverridden', { flow: FLOW_LABELS[activeFlow](), evidence: detection.evidence })
          : t('ui.onboardingModal.importFlowValue', { flow: FLOW_LABELS[activeFlow](), evidence: detection.evidence }),
        true
      );
      const choices = [detection.flow, ...detection.alternatives];
      if (choices.length > 1) {
        const switchRow = status.createDiv({ cls: 'ert-row' });
        switchRow.createSpan({ text: t('ui.onboardingModal.treatFolderAsLabel'), cls: 'ert-section-desc' });
        new DropdownComponent(switchRow)
          .addOptions(Object.fromEntries(choices.map((flow) => [flow, FLOW_LABELS[flow]()])))
          .setValue(activeFlow)
          .onChange((value) => {
            this.flowOverride = value as ImportFlow; // SAFE: options are exactly ImportFlow values
            // A lane switch re-ingests: split plans/outcomes are keyed by the
            // old model's sourceRefs and must rebuild from scratch — and
            // column decisions belong to the old lane's fields.
            this.splitPlans = new Map();
            this.splitOutcomes = null;
            this.metadataMapping = null;
            void this.showPreflight();
          });
      }
    }

    if (ingestReason) {
      this.renderStatusRow(status, t('ui.onboardingModal.bookFolderLabel'), ingestReason, false);
    } else {
      const chaptersValue = skippedCount > 0
        ? t('ui.onboardingModal.chaptersFoundSkipped', { count: candidateCount, skipped: skippedCount })
        : String(candidateCount);
      this.renderStatusRow(status, t('ui.onboardingModal.chaptersFoundLabel'), chaptersValue, candidateCount > 0);
    }
    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.chooseAnotherManuscript')).onClick(() => void this.showSourceSelection());
    new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.checkAgain')).onClick(() => void this.showPreflight());
    const canStart = !ingestReason && candidateCount > 0 && this.model !== null;
    new ButtonComponent(actions)
      .setButtonText(this.useAi ? t('ui.onboardingModal.continueWithAi') : t('ui.onboardingModal.continueWithoutAi'))
      .setCta()
      .setDisabled(!canStart || (this.useAi && !this.aiAvailable))
      .onClick(() => this.showSplitCheckpoint());
    // Show AI setup only when the author requested AI assistance.
    if (this.useAi && !this.aiAvailable) {
      new ButtonComponent(actions)
        .setButtonText(t('ui.onboardingModal.setUpAi'))
        .onClick(() => {
          this.close();
          openAiSettings(this.plugin);
        });
    }
    new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.close')).onClick(() => this.close());
  }

  /** Checkpoint 1 — confirm the scene split and reading order before any AI runs. */
  private showSplitCheckpoint(): void {
    if (!this.model) return;
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(
      2,
      t('ui.onboardingModal.confirmScenesTitle'),
      this.aiAvailable
        ? t('ui.onboardingModal.confirmScenesSubtitleAi')
        : t('ui.onboardingModal.confirmScenesSubtitleManual')
    );

    // One split plan per source file (built once; edits persist across re-render).
    const scenes = flattenScenes(this.model);
    if (this.splitPlans.size === 0) {
      for (const scene of scenes) this.splitPlans.set(scene.sourceRef, planSceneSplit(scene));
    }
    this.persistSession('confirm');

    const totalLine = contentEl.createDiv({ cls: 'ert-section-desc' });
    const updateTotal = (): void => {
      // No scene count until the chapters are actually split — quoting "24
      // scenes" before splitting and "90" after read as a contradiction.
      const plans = scenes
        .map((scene) => this.splitPlans.get(scene.sourceRef))
        .filter((plan): plan is ScenePlan => !!plan);
      const undecided = plans.filter(
        (plan) => !plan.alreadyOnboarded && plan.paragraphs.length > 1 && plan.breaks.length === 0
      ).length;
      if (this.aiAvailable && !this.splitOutcomes && undecided > 0) {
        totalLine.setText(
          t('ui.onboardingModal.chaptersFoundAutoSplit', { chapters: tCount('chapter', plans.length) })
        );
        return;
      }
      const total = plans.reduce((sum, plan) => sum + segmentCount(plan), 0);
      // Scenes are known now, so the pill stops quoting a floor and becomes a
      // point estimate. This assignment happens AFTER renderStageHeader has
      // already drawn the pill, so it must refresh in place — otherwise the
      // header keeps showing "from ~$X" for the rest of the stage.
      this.forecastSceneCount = total;
      this.refreshSpendLabel();
      totalLine.setText(
        t('ui.onboardingModal.willCreateSceneNotes', { notes: tCount('sceneNote', total), chapters: tCount('chapter', plans.length) })
      );
    };

    // Discoverability: authors can hard-mark breaks in the source itself.
    // Marker glyphs lead as code chips so the eye lands on the symbols first.
    const tip = contentEl.createDiv({ cls: 'ert-onb-tip' });
    tip.createSpan({ cls: 'ert-onb-tip__icon', text: '💡' });
    const tipBody = tip.createSpan();
    for (const marker of ['***', '---', '⁂', t('ui.onboardingModal.headingMarker')]) {
      tipBody.createEl('code', { cls: 'ert-onb-tip__marker', text: marker });
    }
    tipBody.createSpan({
      text: t('ui.onboardingModal.markerTip'),
    });

    // After an auto-split run, say plainly what just happened — the author
    // should see "done" at a glance, not have to re-derive it from the rows.
    if (this.splitOutcomes) {
      const split = [...this.splitOutcomes.values()].filter((o) => o === 'split').length;
      const failed = this.splitOutcomes.size - split;
      const sceneTotal = scenes.reduce((sum, scene) => {
        const plan = this.splitPlans.get(scene.sourceRef);
        return sum + (plan ? segmentCount(plan) : 1);
      }, 0);
      const done = contentEl.createDiv({ cls: 'ert-onb-splitdone' });
      done.createSpan({ cls: 'ert-onb-splitdone__icon', text: '✓' });
      done.createSpan({
        text: failed > 0
          ? t('ui.onboardingModal.autoSplitDoneAttention', { chapters: tCount('chapter', scenes.length), count: sceneTotal, attention: tCount('chapterNeedsAttention', failed) })
          : t('ui.onboardingModal.autoSplitDoneReview', { chapters: tCount('chapter', scenes.length), count: sceneTotal }),
      });
    }

    const list = contentEl.createDiv({ cls: 'ert-onb-list' });
    scenes.forEach((scene, i) => {
      const plan = this.splitPlans.get(scene.sourceRef);
      if (plan) this.renderSplitCard(list, plan, i + 1, updateTotal);
    });
    updateTotal();

    const stageRow = contentEl.createDiv({ cls: 'ert-row ert-onb-stagerow' });
    stageRow.createSpan({ text: t('ui.onboardingModal.publishStageLabel'), cls: 'ert-section-desc' });
    new DropdownComponent(stageRow)
      .addOptions(Object.fromEntries(STAGE_ORDER.map((stage) => [stage, stage])))
      .setValue(this.publishStage)
      .onChange((value) => {
        this.publishStage = value as Stage; // SAFE: dropdown options are exactly STAGE_ORDER
      });
    stageRow.createSpan({
      cls: 'ert-section-desc',
      text: t('ui.onboardingModal.publishStageHint'),
    });


    // All actions live together at the bottom. Auto-split is the main path for
    // unmarked prose, so it takes the CTA until it has run; Continue takes over
    // after (or when there is nothing to auto-split).
    const splittable = [...this.splitPlans.values()].some(
      (plan) => !plan.alreadyOnboarded && plan.paragraphs.length > 1 && plan.breaks.length === 0
    );
    const offerAutoSplit = splittable && !this.splitOutcomes && this.aiAvailable;
    if (offerAutoSplit) {
      contentEl.createDiv({
        cls: 'ert-section-desc',
        text: t('ui.onboardingModal.autoSplitHint'),
      });
    }
    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    if (offerAutoSplit) {
      new ButtonComponent(actions)
        .setButtonText(t('ui.onboardingModal.autoSplitButton'))
        .setCta()
        .onClick(() => void this.runSplitProposal());
    }
    const doneCount = this.proposals.filter((proposal) => proposal.frontmatter).length;
    const continueBtn = new ButtonComponent(actions)
      .setButtonText(doneCount > 0 ? t('ui.onboardingModal.resumeExtraction', { count: doneCount }) : t('ui.onboardingModal.continue'))
      .onClick(() => void this.runExtraction());
    if (!offerAutoSplit) continueBtn.setCta();
    new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => {
      activeSession = null; // explicit cancel discards the run
      this.close();
    });
  }

  /** A labeled checkbox row; returns the input for enable/disable wiring. */
  private renderCheckbox(
    parent: HTMLElement,
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void
  ): HTMLInputElement {
    const row = parent.createEl('label', { cls: 'ert-onb-check' });
    const input = row.createEl('input', { attr: { type: 'checkbox' } });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    row.createSpan({ text: label });
    return input;
  }

  /** One file's split card: headline count, status tint, lazily-built break editor. */
  private renderSplitCard(
    list: HTMLElement,
    plan: ScenePlan,
    displayIndex: number,
    onTotalChange: () => void
  ): void {
    const card = list.createDiv({ cls: 'ert-onb-scene' });

    // Row status: red = hard failure (nothing to split), orange = needs the
    // author's attention, green = processed by a completed auto-split run.
    // Neutral until auto-split has run so the initial list stays calm.
    let statusText = '';
    if (plan.paragraphs.length === 0 && !plan.alreadyOnboarded) {
      card.addClass('is-failed');
      statusText = t('ui.onboardingModal.noProse');
    } else if (plan.alreadyOnboarded) {
      card.addClass('is-warn');
      statusText = t('ui.onboardingModal.alreadyOnboardedSkipped');
    } else if (this.splitOutcomes?.get(plan.sourceRef) === 'fallback') {
      card.addClass('is-warn');
      statusText = t('ui.onboardingModal.splitFallback');
    } else if (this.splitOutcomes?.get(plan.sourceRef) === 'failed') {
      card.addClass('is-warn');
      statusText = t('ui.onboardingModal.splitFailed');
    } else if (this.splitOutcomes) {
      card.addClass('is-ok');
    }

    const head = card.createEl('button', { cls: 'ert-onb-scene__head', attr: { type: 'button' } });
    head.createSpan({ cls: 'ert-onb-scene__idx', text: String(displayIndex).padStart(2, '0') });
    head.createSpan({ cls: 'ert-onb-scene__title', text: plan.baseTitle ?? plan.sourceRef });
    const meta = head.createDiv({ cls: 'ert-onb-scene__meta' });
    // "Section titles", never "beats" — beats is the story-structure system
    // (Save the Cat etc.) elsewhere in RT; these are TOC-style titles parsed
    // from the chapter's argument line that become scene titles on split.
    // Titles sit left of the scene-count pill (the count is the primary status).
    if (plan.labels.length > 0) meta.createSpan({ cls: 'ert-onb-flag', text: t('ui.onboardingModal.sectionTitlesFlag', { titles: tCount('title', plan.labels.length) }) });
    const countPill = meta.createSpan({ cls: 'ert-badgePill ert-onb-pill--act' });
    const refreshCount = (): void => {
      // Language model: a row is a CHAPTER; scenes are what splitting produces.
      // Until a chapter has been split (markers, AI, or by hand), its pill says
      // "unsplit" — never "1 scene", which read as a final count and made the
      // later total look like a contradiction (24 scenes → split → 90).
      // Without AI, nothing further will "decide" a chapter — it is what it is.
      const undecided =
        this.aiAvailable &&
        !plan.alreadyOnboarded &&
        plan.paragraphs.length > 1 &&
        plan.breaks.length === 0 &&
        !this.splitOutcomes;
      const n = segmentCount(plan);
      countPill.setText(plan.alreadyOnboarded ? t('ui.onboardingModal.pillSkip') : undecided ? t('ui.onboardingModal.pillUnsplit') : tCount('scene', n));
      countPill.toggleClass('ert-onb-pill--undecided', undecided);
    };
    refreshCount();
    const caret = meta.createSpan({ cls: 'ert-onb-caret' });
    setIcon(caret, 'chevron-right');

    // Issue rows carry their message in the collapsed row itself.
    if (statusText) card.createDiv({ cls: 'ert-onb-scene__status', text: statusText });

    const body = card.createDiv({ cls: 'ert-onb-scene__body' });
    let built = false;
    const buildOnce = (): void => {
      if (built) return;
      built = true;
      this.buildSplitEditor(body, plan, () => {
        refreshCount();
        onTotalChange();
      });
    };
    head.addEventListener('click', () => {
      if (card.hasClass('is-open')) {
        card.removeClass('is-open');
      } else {
        buildOnce();
        card.addClass('is-open');
      }
    });
  }

  /** The break editor: section titles (if any) + paragraphs with clickable break dividers. */
  private buildSplitEditor(body: HTMLElement, plan: ScenePlan, onChange: () => void): void {
    if (plan.alreadyOnboarded) {
      body.createDiv({ cls: 'ert-onb-error', text: t('ui.onboardingModal.alreadyOnboardedNotSplit') });
      return;
    }
    if (plan.paragraphs.length === 0) {
      body.createDiv({ cls: 'ert-onb-error', text: t('ui.onboardingModal.noProse') });
      return;
    }
    if (plan.labels.length > 0) {
      const hint = body.createDiv({ cls: 'ert-onb-split-hint' });
      hint.createDiv({ cls: 'ert-onb-synopsis__label', text: t('ui.onboardingModal.sectionTitlesLabel', { count: plan.labels.length }) });
      const chips = hint.createDiv({ cls: 'ert-onb-fm__val' });
      plan.labels.forEach((label) => this.pill(chips, label, 'ert-onb-pill--subplot', true));
      hint.createDiv({
        cls: 'ert-onb-split-note',
        text: t('ui.onboardingModal.noSceneMarkers'),
      });
    }
    const editor = body.createDiv({ cls: 'ert-onb-para-list' });
    this.renderParagraphs(editor, plan, onChange);
  }

  /** Render paragraphs with break dividers; re-renders in place on toggle. */
  private renderParagraphs(editor: HTMLElement, plan: ScenePlan, onChange: () => void): void {
    editor.empty();
    plan.paragraphs.forEach((paragraph, i) => {
      if (i > 0) {
        const isBreak = plan.breaks.includes(i);
        const divider = editor.createDiv({ cls: 'ert-onb-break' });
        divider.toggleClass('is-break', isBreak);
        const btn = divider.createEl('button', { cls: 'ert-onb-break__btn', attr: { type: 'button' } });
        btn.setText(isBreak ? t('ui.onboardingModal.removeBreak') : t('ui.onboardingModal.addBreak'));
        btn.addEventListener('click', () => {
          plan.breaks = toggleBreak(plan, i);
          this.renderParagraphs(editor, plan, onChange);
          onChange();
        });
      }
      if (i === 0 || plan.breaks.includes(i)) {
        const segIndex = plan.breaks.filter((b) => b <= i).length;
        const segHead = editor.createDiv({ cls: 'ert-onb-seg-head' });
        segHead.createSpan({ cls: 'ert-onb-seg-num', text: t('ui.onboardingModal.sceneNumber', { number: segIndex + 1 }) });
        const label = plan.labels[segIndex];
        if (label) segHead.createSpan({ cls: 'ert-onb-seg-label', text: label });
      }
      const row = editor.createDiv({ cls: 'ert-onb-para' });
      row.createSpan({ cls: 'ert-onb-para__idx', text: String(i + 1) });
      row.createSpan({ cls: 'ert-onb-para__text', text: truncateText(paragraph, 180) });
    });
  }

  /** AI auto-split: propose breaks for unmarked files, then return to Confirm scenes. */
  private async runSplitProposal(): Promise<void> {
    const plans = [...this.splitPlans.values()];
    this.abortController = new AbortController();
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(2, t('ui.onboardingModal.autoSplittingTitle'), t('ui.onboardingModal.autoSplittingSubtitle'));

    const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    const statusEl = progressWrap.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingModal.readingEachFile') });
    const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
    barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
    const barFill = barTrack.createDiv();
    barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.abort')).setDestructive().onClick(() => this.abortController?.abort());

    this.splitOutcomes = await this.service.proposeSplits(plans, {
      signal: this.abortController.signal,
      onProgress: (current, total, title) => {
        statusEl.setText(t('ui.onboardingModal.splittingProgress', { current, total, title }));
        barFill.setCssStyles({ width: `${total > 0 ? Math.round((current / total) * 100) : 0}%` }); // SAFE: progress width
      },
    });

    this.showSplitCheckpoint();
  }

  private async runExtraction(): Promise<void> {
    if (!this.model) return;
    // Apply the confirmed scene split: one source file may now yield several scenes.
    const model = applySplitsToModel(this.model, this.splitPlans);

    this.extractModel = model;

    // Structure-only path (no local model): everything is deterministic and
    // instant — no survey, no per-scene calls, no entity summaries.
    if (!this.aiAvailable) {
      this.survey = null;
      this.proposals = this.service.buildStructureOnlyProposals(model, { publishStage: this.publishStage }).proposals;
      const kinds: EntityKind[] = [];
      if (this.createCharacters) kinds.push('character');
      if (this.createPlaces) kinds.push('place');
      this.entityProposals = kinds.length > 0
        ? await this.service.enrichEntities(this.proposals, { kinds, generateSummaries: false })
        : [];
      this.persistSession('review');
      this.showReviewCheckpoint();
      return;
    }

    this.abortController = new AbortController();
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(2, t('ui.onboardingModal.readingScenesTitle'), t('ui.onboardingModal.readingScenesSubtitle'));

    const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    const statusEl = progressWrap.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingModal.surveyingBook') });
    const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
    barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
    const barFill = barTrack.createDiv();
    barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.abort')).setDestructive().onClick(() => this.abortController?.abort());
    // (setDestructive is the Obsidian ButtonComponent API for the muted-danger style.)

    // Survey is skipped on resume when one already exists.
    this.survey = this.survey ?? await this.service.survey(model);

    // Resume: scenes already extracted in an interrupted run are reused.
    const reuse = new Map(
      this.proposals
        .filter((proposal) => proposal.frontmatter)
        .map((proposal) => [proposal.sourceRef, proposal] as const)
    );
    this.proposals = await this.service.extractScenes(model, this.survey, {
      signal: this.abortController.signal,
      publishStage: this.publishStage,
      reuse,
      onProgress: (current, total, title) => {
        statusEl.setText(t('ui.onboardingModal.extractingProgress', { current, total, title }));
        barFill.setCssStyles({ width: `${total > 0 ? Math.round((current / total) * 100) : 0}%` }); // SAFE: progress width
      },
    });

    if (this.abortController.signal.aborted) {
      // Keep the partial work — reopening the command resumes from here.
      this.persistSession('confirm');
      this.renderMessage(
        t('ui.onboardingModal.extractionPausedTitle'),
        t('ui.onboardingModal.extractionPausedBody'),
        true
      );
      return;
    }

    // Character/Place profiles are decided at the Review checkpoint and built
    // at apply time — this stage stays about the narrative only.
    this.entityProposals = [];

    this.persistSession('review');
    this.showReviewCheckpoint();
  }

  /** Checkpoint 2 — review each scene's RT-template mapping before writing. */
  private showReviewCheckpoint(): void {
    const { contentEl } = this;
    contentEl.empty();

    const ok = this.proposals.filter((p) => p.frontmatter);
    const failed = this.proposals.filter((p) => !p.frontmatter);
    const flagged = ok.filter((p) => p.flags.length > 0);
    this.renderStageHeader(
      3,
      t('ui.onboardingModal.reviewTitle'),
      flagged.length && failed.length
        ? t('ui.onboardingModal.reviewSubtitleFlaggedFailed', { ready: ok.length, flagged: flagged.length, failed: failed.length })
        : flagged.length
          ? t('ui.onboardingModal.reviewSubtitleFlagged', { ready: ok.length, flagged: flagged.length })
          : failed.length
            ? t('ui.onboardingModal.reviewSubtitleFailed', { ready: ok.length, failed: failed.length })
            : t('ui.onboardingModal.reviewSubtitle', { ready: ok.length })
    );

    // An all-Main-Plot book is almost always a failed structure survey, not a
    // one-thread story — say so instead of letting the timeline look broken.
    // (Structure-only runs skip the survey by design; no banner there.)
    if (this.aiAvailable && (!this.survey || this.survey.subplots.length === 0)) {
      contentEl.createDiv({
        cls: 'ert-onb-error',
        text: t('ui.onboardingModal.surveyFailed'),
      });
    }

    // Accordion: one detailed card open, the rest collapsed in a scroll view.
    // The first successful scene starts expanded; bodies build lazily on open.
    const list = contentEl.createDiv({ cls: 'ert-onb-list' });
    let firstOpenTaken = false;
    this.proposals.forEach((proposal, i) => {
      const openByDefault = !firstOpenTaken && !!proposal.frontmatter;
      if (openByDefault) firstOpenTaken = true;
      this.renderReviewScene(list, proposal, i + 1, openByDefault);
    });

    const destName = this.book ? this.service.destinationFor(this.book) : '';
    contentEl.createDiv({
      cls: 'ert-section-desc',
      text: t('ui.onboardingModal.createsDestination', { destination: destName, stage: this.publishStage }),
    });

    // Optional extras, decided here — after the narrative is settled. Built at
    // apply time; summaries are the slow part (one AI call per entity).
    // Without a model there is no entity ANALYSIS either — profiles can only
    // come from carried Character/Place columns. When neither AI nor carried
    // names exist, the section would be dead weight: hide it entirely.
    const hasEntityNames = this.proposals.some(
      (proposal) => proposal.characters.length > 0 || proposal.places.length > 0
    );
    if (!this.aiAvailable && !hasEntityNames) {
      this.createCharacters = false;
      this.createPlaces = false;
      this.generateSummaries = false;
      this.renderReviewActions(contentEl, ok.length);
      return;
    }
    const optionsPanel = contentEl.createDiv({ cls: 'ert-onb-options ert-stack' });
    optionsPanel.createDiv({ cls: 'ert-onb-synopsis__label', text: t('ui.onboardingModal.alsoCreate') });
    this.renderCheckbox(optionsPanel, t('ui.onboardingModal.createCharacterProfiles'), this.createCharacters, (checked) => {
      this.createCharacters = checked;
      syncSummaryToggle();
      this.refreshSpendLabel();
    });
    this.renderCheckbox(optionsPanel, t('ui.onboardingModal.createPlaceProfiles'), this.createPlaces, (checked) => {
      this.createPlaces = checked;
      syncSummaryToggle();
      this.refreshSpendLabel();
    });
    const summaryToggle = this.renderCheckbox(
      optionsPanel,
      t('ui.onboardingModal.generateSummaries'),
      this.generateSummaries,
      (checked) => {
        this.generateSummaries = checked;
        this.refreshSpendLabel();
      }
    );
    const syncSummaryToggle = (): void => {
      // Profiles-without-summaries needs zero AI, so those boxes stay live in
      // structure-only mode; only the summary pass itself requires the model.
      const enabled = (this.createCharacters || this.createPlaces) && this.aiAvailable;
      summaryToggle.disabled = !enabled;
      summaryToggle.parentElement?.toggleClass('ert-setting-dimmed', !enabled);
      if (!enabled && this.generateSummaries) {
        this.generateSummaries = false;
        summaryToggle.checked = false;
      }
    };
    syncSummaryToggle();

    this.renderReviewActions(contentEl, ok.length);
  }

  /** Apply/Cancel row for the Review screen (shared by both option-panel paths). */
  private renderReviewActions(contentEl: HTMLElement, okCount: number): void {
    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions)
      .setButtonText(t('ui.onboardingModal.applyWriteScenes', { count: okCount }))
      .setCta()
      .setDisabled(okCount === 0)
      .onClick(() => void this.applyProposals());
    new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => {
      activeSession = null; // explicit cancel discards the run
      this.close();
    });
  }

  /** One accordion row: headline metadata always visible, detail lazily built on open. */
  private renderReviewScene(
    list: HTMLElement,
    proposal: SceneProposal,
    displayIndex: number,
    openByDefault: boolean
  ): void {
    const fm = proposal.frontmatter;
    const scene = list.createDiv({ cls: 'ert-onb-scene' });
    if (!fm) scene.addClass('is-failed');

    const head = scene.createEl('button', { cls: 'ert-onb-scene__head', attr: { type: 'button' } });
    head.createSpan({ cls: 'ert-onb-scene__idx', text: String(displayIndex).padStart(2, '0') });
    head.createSpan({ cls: 'ert-onb-scene__title', text: proposal.title || proposal.sourceRef });
    const meta = head.createDiv({ cls: 'ert-onb-scene__meta' });
    if (fm) {
      this.pill(meta, t('ui.onboardingModal.actPill', { act: frontmatterValueToText(fm.Act) || '?' }), 'ert-onb-pill--act'); // SAFE: pill label — the question mark marks an unknown Act instead of asserting one
      const chars = Array.isArray(fm.Character) ? fm.Character.length : 0;
      const places = Array.isArray(fm.Place) ? fm.Place.length : 0;
      this.pill(meta, t('ui.onboardingModal.charsPill', { count: chars }), 'ert-onb-pill--count', true);
      this.pill(meta, t('ui.onboardingModal.placesPill', { count: places }), 'ert-onb-pill--count', true);
      if (proposal.flags.length > 0) meta.createSpan({ cls: 'ert-onb-flag', text: '⚑' });
    } else {
      this.pill(meta, t('ui.onboardingModal.failedPill'), 'ert-onb-pill--warn', true);
    }
    const caret = meta.createSpan({ cls: 'ert-onb-caret' });
    setIcon(caret, 'chevron-right');

    const body = scene.createDiv({ cls: 'ert-onb-scene__body' });
    let built = false;
    const buildOnce = (): void => {
      if (built) return;
      built = true;
      this.buildSceneBody(body, proposal);
    };
    head.addEventListener('click', () => {
      if (scene.hasClass('is-open')) {
        scene.removeClass('is-open');
      } else {
        buildOnce();
        scene.addClass('is-open');
      }
    });
    if (openByDefault) {
      buildOnce();
      scene.addClass('is-open');
    }
  }

  /** The expanded detail: frontmatter keys, pill'd arrays, and the synopsis. */
  private buildSceneBody(body: HTMLElement, proposal: SceneProposal): void {
    const fm = proposal.frontmatter;
    if (!fm) {
      body.createDiv({
        cls: 'ert-onb-error',
        text: proposal.error ? t('ui.onboardingModal.extractionFailedReason', { error: proposal.error }) : t('ui.onboardingModal.extractionFailedSkipped'),
      });
      return;
    }

    const grid = body.createDiv({ cls: 'ert-onb-fm' });
    this.fmScalar(grid, 'Class', frontmatterValueToText(fm.Class) || 'Scene'); // SAFE: onboarding only ever proposes Scene notes, so that is the Class being previewed
    this.fmScalar(grid, 'Act', frontmatterValueToText(fm.Act)); // SAFE: frontmatter preview — an unset Act renders as a blank field rather than a guess
    this.fmScalar(grid, 'Status', frontmatterValueToText(fm.Status)); // SAFE: frontmatter preview — an unset Status renders blank rather than implying one
    this.fmScalar(grid, 'Publish Stage', frontmatterValueToText(fm['Publish Stage'])); // SAFE: frontmatter preview — an unset Publish Stage renders blank rather than implying one
    if (fm.When) this.fmScalar(grid, 'When', frontmatterValueToText(fm.When));
    if (fm.Duration) this.fmScalar(grid, 'Duration', frontmatterValueToText(fm.Duration));
    this.fmPills(grid, 'Subplot', asStringList(fm.Subplot), 'ert-onb-pill--subplot');
    this.fmPills(grid, 'Character', asStringList(fm.Character).map(stripWikiLink), 'ert-onb-pill--char');
    this.fmPills(grid, 'Place', asStringList(fm.Place).map(stripWikiLink), 'ert-onb-pill--place');

    const synopsis = frontmatterValueToText(fm.Synopsis).trim(); // SAFE: preview of extracted frontmatter — a scene with no Synopsis previews an empty one
    if (synopsis) {
      const syn = body.createDiv({ cls: 'ert-onb-synopsis' });
      syn.createDiv({ cls: 'ert-onb-synopsis__label', text: 'Synopsis' });
      syn.createDiv({ cls: 'ert-onb-synopsis__text', text: synopsis });
    }

    if (proposal.flags.length > 0) {
      const flags = body.createDiv({ cls: 'ert-onb-fm__val' });
      proposal.flags.forEach((flag) => this.pill(flags, t('ui.onboardingModal.guessedPill', { flag }), 'ert-onb-pill--warn', true));
    }
  }

  private pill(parent: HTMLElement, text: string, variant: string, small = false): void {
    const cls = ['ert-badgePill', variant];
    if (small) cls.push('ert-badgePill--sm');
    parent.createSpan({ cls: cls.join(' '), text });
  }

  private fmScalar(grid: HTMLElement, key: string, value: string): void {
    grid.createDiv({ cls: 'ert-onb-fm__key', text: `${key}:` });
    const val = grid.createDiv({ cls: 'ert-onb-fm__val ert-onb-fm__val--mono' });
    if (value.trim().length > 0) {
      val.setText(value);
    } else {
      val.addClass('ert-onb-fm__val--empty');
      val.setText('—');
    }
  }

  private fmPills(grid: HTMLElement, key: string, values: string[], variant: string): void {
    grid.createDiv({ cls: 'ert-onb-fm__key', text: `${key}:` });
    const val = grid.createDiv({ cls: 'ert-onb-fm__val' });
    if (values.length === 0) {
      val.addClass('ert-onb-fm__val--empty');
      val.setText('—');
      return;
    }
    values.forEach((value) => this.pill(val, value, variant, true));
  }

  private async applyProposals(): Promise<void> {
    // Profiles were chosen at Review; build them now, just before writing.
    const kinds: EntityKind[] = [];
    if (this.createCharacters) kinds.push('character');
    if (this.createPlaces) kinds.push('place');

    if (kinds.length === 0) {
      this.entityProposals = [];
    } else if (this.generateSummaries) {
      // The slow path — one local-AI call per character/place, abortable back
      // to the Review checkpoint (nothing has been written yet).
      this.abortController = new AbortController();
      const { contentEl } = this;
      contentEl.empty();
      this.renderStageHeader(3, t('ui.onboardingModal.creatingProfilesTitle'), t('ui.onboardingModal.creatingProfilesSubtitle'));
      const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
      const statusEl = progressWrap.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingModal.gatheringEntities') });
      const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
      barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
      const barFill = barTrack.createDiv();
      barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill
      const abortRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
      new ButtonComponent(abortRow).setButtonText(t('ui.onboardingModal.abort')).setDestructive().onClick(() => this.abortController?.abort());

      this.entityProposals = await this.service.enrichEntities(this.proposals, {
        kinds,
        generateSummaries: true,
        signal: this.abortController.signal,
        onProgress: (current, total, name) => {
          statusEl.setText(t('ui.onboardingModal.summarizingProgress', { current, total, name }));
          barFill.setCssStyles({ width: `${total > 0 ? Math.round((current / total) * 100) : 0}%` }); // SAFE: progress width
        },
      });
      if (this.abortController.signal.aborted) {
        this.showReviewCheckpoint();
        return;
      }
    } else {
      // No AI — just plan the scaffolds.
      this.entityProposals = await this.service.enrichEntities(this.proposals, {
        kinds,
        generateSummaries: false,
      });
    }

    if (!this.book) return;
    this.renderBusy(t('ui.onboardingModal.writingSceneNotes'));
    let report: MaterializeReport;
    try {
      report = await this.service.materialize(this.book, this.proposals, this.entityProposals);
    } catch (error) {
      this.renderMessage(t('ui.onboardingModal.onboardingFailed'), error instanceof Error ? error.message : String(error), true);
      return;
    }
    this.showReport(report);
  }

  private showReport(report: MaterializeReport): void {
    activeSession = null; // the run is written — nothing left to resume
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(4, t('ui.onboardingModal.completeTitle'), report.bookFolder);

    const panel = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    this.renderStatusRow(panel, t('ui.onboardingModal.scenesWritten'), String(report.notesCreated), report.notesCreated > 0);
    this.renderStatusRow(panel, t('ui.onboardingModal.entityNotesCreated'), String(report.stubsCreated), true);
    // Roll guesses up to counts (at 106 scenes a per-scene list is noise — most
    // flags are the expected "Act guessed" for a manuscript without explicit
    // structure). Failures are rare and important: list those individually.
    const failures = report.needsReview.filter((proposal) => proposal.error);
    const flagged = report.needsReview.filter((proposal) => !proposal.error && proposal.flags.length > 0);
    if (flagged.length > 0) {
      const counts = new Map<string, number>();
      for (const proposal of flagged) {
        for (const flag of proposal.flags) counts.set(flag, (counts.get(flag) ?? 0) + 1); // SAFE: first sighting of a flag starts its tally at 0
      }
      const rollup = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([flag, count]) => t('ui.onboardingModal.guessedFlagCount', { flag, count }))
        .join(' · ');
      this.renderStatusRow(
        panel,
        t('ui.onboardingModal.guessedFieldsLabel'),
        flagged.length === 1 ? t('ui.onboardingModal.guessedRollupOne', { rollup }) : t('ui.onboardingModal.guessedRollupOther', { rollup }),
        true
      );
      panel.createDiv({
        cls: 'ert-section-desc',
        text: t('ui.onboardingModal.guessedFieldsHint'),
      });
    }
    if (failures.length > 0) {
      this.renderStatusRow(panel, t('ui.onboardingModal.failedLabel'), String(failures.length), false);
      const reviewList = panel.createDiv({ cls: 'ert-onb-review-list ert-stack' });
      for (const proposal of failures) {
        const item = reviewList.createDiv({ cls: 'ert-onb-review-item' });
        item.createSpan({ cls: 'ert-onb-review-item__name', text: proposal.title || proposal.sourceRef });
        item.createSpan({ cls: 'ert-onb-review-item__reason', text: proposal.error ?? t('ui.onboardingModal.failedPill') }); // SAFE: the proposal already failed; this labels it when the extractor recorded no reason
      }
    }
    for (const err of report.errors) {
      panel.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: err });
    }

    new Notice(t('ui.onboardingModal.onboardedNotice', { count: report.notesCreated, folder: report.bookFolder }));
    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.done')).setCta().onClick(() => this.close());
  }

  // ---- Rendering helpers -------------------------------------------------

  private renderHeader(title: string, subtitle?: string): void {
    const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });
    header.createDiv({ cls: 'ert-modal-title', text: title });
    if (subtitle) header.createDiv({ cls: 'ert-modal-subtitle', text: subtitle });
  }

  /**
   * Consistent numbered header for the 4-stage onboarding sequence
   * (1 Prepare → 2 Confirm → 3 Review → 4 Complete), with a step indicator so
   * the author always knows where they are.
   */
  /**
   * Running-spend label for the header pill.
   *
   * Rules this obeys, in order of importance:
   *   1. The local engine is free. Not "about $0" — free. Say so plainly.
   *   2. Before the split has run, the number of extraction calls is unknown,
   *      so the answer is a RANGE bounded by realistic scenes-per-chapter.
   *      Publishing a point estimate there would dress a guess as a fact.
   *   3. Once scenes are known, it becomes a point estimate.
   *   4. If pricing cannot be resolved for the active model, render NOTHING.
   *      A missing number is honest; a zero would read as "free".
   *
   * All arithmetic is delegated — see src/onboarding/costForecast.ts.
   */
  /**
   * Update the pill in place. Ticking a profile box changes what the run will
   * cost, and the author is looking at the number when they tick it — so it
   * has to move then, not on the next stage.
   */
  private refreshSpendLabel(): void {
    if (!this.spendEl) return;
    const spend = this.buildSpendLabel();
    if (!spend) {
      this.spendEl.setText('');
      return;
    }
    this.spendEl.setText(spend.text);
    this.spendEl.setAttr('aria-label', spend.ariaLabel);
    this.spendEl.toggleClass('is-free', spend.free);
  }

  private buildSpendLabel(): { text: string; ariaLabel: string; free: boolean } | null {
    const priceFor = (sceneCount: number): number | null => {
      if (!this.costProvider || !this.costModelId) return null;
      try {
        const tokens = forecastOnboardingTokens({
          manuscriptChars: this.manuscriptChars,
          chapterCount: this.chapterCount,
          sceneCount,
          promptChars: this.measureStagePromptChars(),
          entityCount: this.estimateEntityCount(),
          generateSummaries: this.generateSummaries
        });
        const cost = forecastOnboardingCost(this.costProvider, this.costModelId, tokens);
        return Number.isFinite(cost.freshCostUSD) ? cost.freshCostUSD : null;
      } catch {
        // Pricing genuinely unavailable for this model — resolveSpendLabel
        // turns null into "render nothing", never into a zero.
        return null;
      }
    };

    const label = resolveSpendLabel(
      {
        aiAvailable: this.aiAvailable,
        engine: this.engine,
        costProvider: this.costProvider,
        costModelId: this.costModelId,
        manuscriptChars: this.manuscriptChars,
        forecastSceneCount: this.forecastSceneCount
      },
      // Pre-split, resolveSpendLabel asks for one scene per chapter as the
      // true lower bound; it passes 1 and this scales it.
      (scenes) => priceFor(scenes === 1 ? Math.max(1, this.chapterCount) : scenes),
      formatApproxUsdCost
    );
    if (label.kind === 'hidden') return null;
    return { text: label.text, ariaLabel: label.ariaLabel, free: label.kind === 'free' };
  }

  /**
   * Fixed per-call overhead for each stage, measured through the same envelope
   * composition the AI client uses. See measureRequestEnvelopeChars.
   */
  private measureStagePromptChars(): { split: number; scene: number; survey: number; entity: number } {
    const envelopeFor = (
      task: string,
      instructions: string,
      schema: unknown
    ): number => measureRequestEnvelopeChars(this.plugin, {
      feature: 'Onboarding',
      task,
      featureModeInstructions: instructions,
      returnType: 'json',
      responseSchema: schema
    } as Parameters<typeof measureRequestEnvelopeChars>[1]);

    return {
      split: envelopeFor('OnboardingSplit', getOnboardingSplitInstructions(), getOnboardingSplitJsonSchema()),
      scene: envelopeFor('OnboardingScene', getOnboardingSceneInstructions(), getOnboardingSceneJsonSchema()),
      survey: envelopeFor('OnboardingSurvey', getOnboardingSurveyInstructions(), getOnboardingSurveyJsonSchema()),
      entity: envelopeFor('OnboardingEntity', getOnboardingEntityInstructions(), getOnboardingEntityJsonSchema())
    };
  }

  /**
   * Entities the run will summarise. Zero unless a profile box is ticked AND
   * summaries are on — profiles without summaries make no model calls, so they
   * cost nothing and must not inflate the forecast.
   */
  private estimateEntityCount(): number {
    if (!this.generateSummaries) return 0;
    if (!this.createCharacters && !this.createPlaces) return 0;
    const scenes = this.forecastSceneCount ?? Math.max(1, this.chapterCount);
    // Observed on the Odyssey runs: ~1.2 characters and ~1.5 places per scene
    // survive as distinct entities. Used only when the real list is not yet
    // known, and deliberately on the high side.
    const perScene = (this.createCharacters ? 1.2 : 0) + (this.createPlaces ? 1.5 : 0);
    return Math.round(scenes * perScene);
  }

  private renderStageHeader(stage: number, title: string, subtitle?: string): void {
    const total = 4;

    // Top bar: canonical modal pill (modal name · local model) on the left,
    // stage step indicator on the right, same line.
    const topbar = this.contentEl.createDiv({ cls: 'ert-onb-topbar' });
    const badgeText = this.modelLabel ? t('ui.onboardingModal.badgeWithModel', { model: this.modelLabel }) : t('ui.onboardingModal.badge');
    topbar.createSpan({ cls: 'ert-modal-badge', text: badgeText });
    const spend = this.buildSpendLabel();
    this.spendEl = spend
      ? topbar.createSpan({
        cls: `ert-modal-badge ert-onb-spend${spend.free ? ' is-free' : ''}`,
        text: spend.text,
        attr: { 'aria-label': spend.ariaLabel }
      })
      : null;
    const steps = topbar.createDiv({ cls: 'ert-onb-steps', attr: { 'aria-label': t('ui.onboardingModal.stepAria', { stage, total }) } });
    for (let i = 1; i <= total; i++) {
      const pip = steps.createSpan({ cls: 'ert-onb-step' });
      if (i < stage) pip.addClass('is-done');
      else if (i === stage) pip.addClass('is-current');
    }

    const header = this.contentEl.createDiv({ cls: 'ert-onb-stage' });
    header.createDiv({ cls: 'ert-onb-stage__num', text: String(stage) });
    const titles = header.createDiv({ cls: 'ert-onb-stage__titles' });
    // Canonical modal typography — same title/subtitle treatment as every
    // other ERT modal; the onboarding classes only carry layout.
    titles.createDiv({ cls: 'ert-modal-title ert-onb-stage__title', text: `${title}` });
    if (subtitle) titles.createDiv({ cls: 'ert-modal-subtitle ert-onb-stage__subtitle', text: subtitle });
  }

  private renderBusy(message: string): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ cls: 'ert-section-desc', text: message });
  }

  private renderMessage(title: string, body: string, showClose: boolean): void {
    const { contentEl } = this;
    contentEl.empty();
    this.renderHeader(title);
    contentEl.createDiv({ cls: 'ert-section-desc', text: body });
    if (showClose) {
      const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
      new ButtonComponent(actions).setButtonText(t('ui.onboardingModal.close')).setCta().onClick(() => this.close());
    }
  }

  private renderStatusRow(parent: HTMLElement, label: string, value: string, good: boolean): void {
    const row = parent.createDiv({ cls: 'ert-row' });
    row.createSpan({ text: `${label}: `, cls: 'ert-section-desc' });
    row.createSpan({ text: value, cls: good ? undefined : 'ert-section-desc ert-section-desc--alert' });
  }
}
