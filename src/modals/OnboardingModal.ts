/*
 * OnboardingModal — drives the existing-vault onboarding spine with two review
 * checkpoints (per the canonical prompt's stage-with-approval model):
 *
 *   Preflight → CHECKPOINT 1 (Split: confirm scenes + order, before any AI)
 *             → Progress (survey + sequential extraction, abortable)
 *             → CHECKPOINT 2 (Review: proposed frontmatter + flagged guesses)
 *             → Materialize → Report
 *
 * Nothing is written before the user approves at Checkpoint 2. UI strings are
 * plain (this is a dev-only beta command); i18n keys land when it graduates.
 *
 * See docs/engineering/plans/one-button-onboarding-local-llm-plan.md.
 */

import { App, ButtonComponent, DropdownComponent, Modal, Notice, setIcon } from 'obsidian';
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
import { suggestOnboardingFolderName } from '../onboarding/paths';
import {
  proposeScrivenerAutomap,
  applyMetadataMappingToModel,
  type ScrivenerFieldTarget,
} from '../onboarding/adapters/scrivenerAdapter';
import { getSupportedFrontmatterRemapTargets } from '../utils/frontmatter';
import { getActiveBook } from '../utils/books';
import { STAGE_ORDER, type Stage } from '../utils/constants';
import type { EntityKind } from '../utils/entityNotes';
import type { BookProfile } from '../types/settings';

/** Narrow an unknown frontmatter value to a list of non-empty strings. */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Display a `[[Wiki Link]]` as its bare name for a pill. */
function stripWikiLink(value: string): string {
  return value.replace(/^\[\[/, '').replace(/\]\]$/, '');
}

/** Author-facing names for the import lanes shown on the Prepare screen. */
const FLOW_LABELS: Record<ImportFlow, string> = {
  single: 'Single manuscript file',
  docx: 'Word manuscript (.docx)',
  scrivener: 'Scrivener export',
  folder: 'Folder of notes',
};

/**
 * Open plugin settings on a specific tab. The tab is forced AFTER the pane
 * opens — setting it before let the pane restore its last-active tab instead
 * (observed landing on AI when the author expected the Book Manager).
 */
function openPluginSettings(plugin: RadialTimelinePlugin, tab: 'core' | 'ai', scrollSelector?: string): void {
  const setting = (plugin.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting; // SAFE: undocumented settings surface (established WelcomeScreen pattern)
  if (!setting) return;
  setting.open();
  setting.openTabById('radial-timeline');
  window.setTimeout(() => {
    plugin.settingsTab?.setActiveTab(tab);
    if (scrollSelector) {
      window.setTimeout(() => {
        activeDocument.querySelector(scrollSelector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  }, 80);
}

/** Open plugin settings scrolled to the Book Manager (same landing as the Welcome screen link). */
function openSettingsAtBookManager(plugin: RadialTimelinePlugin): void {
  openPluginSettings(plugin, 'core', '.ert-books-heading');
}

/** Local model ids can be full filesystem paths — show just the leaf name in the header pill. */
function abbreviateModelId(id: string): string {
  const leaf = (id || '').trim().split(/[\\/]/).pop() ?? '';
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
  stage: 'confirm' | 'review';
  aiAvailable: boolean;
  modelLabel: string;
  flowOverride: ImportFlow | null;
  publishStage: Stage;
  createCharacters: boolean;
  createPlaces: boolean;
  generateSummaries: boolean;
  metadataMapping: Record<string, ScrivenerFieldTarget> | null;
  model: ManuscriptModel | null;
  extractModel: ManuscriptModel | null;
  splitPlans: Map<string, ScenePlan>;
  splitOutcomes: Map<string, 'split' | 'failed' | 'fallback'> | null;
  survey: SurveyResult | null;
  proposals: SceneProposal[];
  entityProposals: EntityProposal[];
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
  private publishStage: Stage = 'Press';
  // Extra work beyond scenes — all off by default so the core run is just
  // "split into scene notes with YAML + Synopsis". The author opts in.
  private createCharacters = false;
  private createPlaces = false;
  private generateSummaries = false;
  /** Abbreviated local model name for the header pill (set once preflight runs). */
  private modelLabel = '';
  /** Author's Prepare-screen lane choice; null = trust auto-detection. */
  private flowOverride: ImportFlow | null = null;
  /** Scrivener metadata mapping table (seeded from the automap; author-edited). */
  private metadataMapping: Record<string, ScrivenerFieldTarget> | null = null;
  /**
   * False when preflight found no capable local model. Onboarding still runs —
   * structure-only (split titles, sidecar synopses, mapped metadata, positional
   * acts) — with every AI stage skipped and its controls hidden.
   */
  private aiAvailable = false;
  /** The split+mapping-applied model extraction actually ran against (for resume). */
  private extractModel: ManuscriptModel | null = null;
  private abortController: AbortController | null = null;

  constructor(app: App, plugin: RadialTimelinePlugin) {
    super(app);
    this.plugin = plugin;
    this.service = new OnboardingService(plugin);
  }

  /** Snapshot the run into the module-scoped session so dismissal loses nothing. */
  private persistSession(stage: 'confirm' | 'review'): void {
    activeSession = {
      folder: this.book?.sourceFolder ?? '',
      stage,
      aiAvailable: this.aiAvailable,
      modelLabel: this.modelLabel,
      flowOverride: this.flowOverride,
      publishStage: this.publishStage,
      createCharacters: this.createCharacters,
      createPlaces: this.createPlaces,
      generateSummaries: this.generateSummaries,
      metadataMapping: this.metadataMapping,
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
    this.aiAvailable = session.aiAvailable;
    this.modelLabel = session.modelLabel;
    this.flowOverride = session.flowOverride;
    this.publishStage = session.publishStage;
    this.createCharacters = session.createCharacters;
    this.createPlaces = session.createPlaces;
    this.generateSummaries = session.generateSummaries;
    this.metadataMapping = session.metadataMapping;
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
    // reopening on the same book folder picks up exactly where it left off.
    const book = getActiveBook(this.plugin.settings);
    if (activeSession && book?.sourceFolder === activeSession.folder && activeSession.model) {
      this.book = book;
      this.restoreSession(activeSession);
      if (activeSession.stage === 'review' && this.proposals.length > 0) {
        this.showReviewCheckpoint();
      } else {
        this.showSplitCheckpoint();
      }
      return;
    }
    void this.showPreflight();
  }

  onClose(): void {
    this.abortController?.abort();
    this.contentEl.empty();
  }

  // ---- Views -------------------------------------------------------------

  private async showPreflight(): Promise<void> {
    this.renderBusy('Checking the local model and reading the book folder…');

    const book = getActiveBook(this.plugin.settings);
    if (!book || !book.sourceFolder) {
      const { contentEl } = this;
      contentEl.empty();
      this.renderHeader('No book folder');
      contentEl.createDiv({
        cls: 'ert-muted',
        text: 'Onboarding needs an active book pointing at the folder that holds your manuscript. Set one up in the Book Manager, then run onboarding again.',
      });
      const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
      new ButtonComponent(actions)
        .setButtonText('Open Book Manager')
        .setCta()
        .onClick(() => {
          this.close();
          openSettingsAtBookManager(this.plugin);
        });
      new ButtonComponent(actions).setButtonText('Close').onClick(() => this.close());
      return;
    }
    this.book = book;

    let preflightReason = '';
    let preflightOk = false;
    let tier = 0;
    try {
      const preflight = await this.service.preflight();
      preflightOk = preflight.ok;
      preflightReason = preflight.reason;
      tier = preflight.tier;
      if (preflight.modelId) this.modelLabel = abbreviateModelId(preflight.modelId);
    } catch (error) {
      preflightReason = error instanceof Error ? error.message : String(error);
    }

    let ingestReason = '';
    let candidateCount = 0;
    let skippedCount = 0;
    const detection = this.service.detectImportFlow(book.sourceFolder);
    const activeFlow: ImportFlow | null = this.flowOverride ?? detection?.flow ?? null;
    try {
      const ingest = await this.service.ingest(book.sourceFolder, this.flowOverride ?? undefined);
      if (ingest.kind === 'needs-order') {
        ingestReason = ingest.reason;
      } else {
        this.model = ingest.model;
        const scenes = flattenScenes(ingest.model);
        skippedCount = scenes.filter((scene) => scene.alreadyOnboarded).length;
        candidateCount = scenes.length - skippedCount;
      }
    } catch (error) {
      ingestReason = error instanceof Error ? error.message : String(error);
    }

    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(1, 'Prepare', `Onboard "${book.sourceFolder}"`);

    // The local model is optional: without one, onboarding runs structure-only
    // (split titles, sidecar synopses, mapped metadata, positional acts) and
    // every AI stage is skipped. Scrivener/Word migrations rarely need more.
    this.aiAvailable = preflightOk;
    const status = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    // Raw diagnostics text ("Structured JSON path not tested") is engineer-speak
    // — authors get a plain state; the tier reason stays since it is actionable.
    const notAvailable = /tier/i.test(preflightReason)
      ? `Not available — ${preflightReason}`
      : 'Not connected — onboarding runs without AI.';
    this.renderStatusRow(status, 'Local model', preflightOk ? `Ready — tier ${tier}` : notAvailable, preflightOk);
    if (!preflightOk) {
      status.createDiv({
        cls: 'ert-muted',
        text: 'You still get scenes, titles, and any carried Scrivener metadata. AI synopses, characters/places, and auto-split need a local model (Settings → AI).',
      });
    }

    // Import lane: say what was detected and why. When the folder's contents
    // support more than one reading, the author can switch lanes right here.
    if (detection && activeFlow) {
      const overridden = this.flowOverride !== null && this.flowOverride !== detection.flow;
      this.renderStatusRow(
        status,
        'Import flow',
        `${FLOW_LABELS[activeFlow]} — ${detection.evidence}${overridden ? ' (your choice)' : ''}`,
        true
      );
      const choices = [detection.flow, ...detection.alternatives];
      if (choices.length > 1) {
        const switchRow = status.createDiv({ cls: 'ert-row' });
        switchRow.createSpan({ text: 'Treat this folder as: ', cls: 'ert-muted' });
        new DropdownComponent(switchRow)
          .addOptions(Object.fromEntries(choices.map((flow) => [flow, FLOW_LABELS[flow]])))
          .setValue(activeFlow)
          .onChange((value) => {
            this.flowOverride = value as ImportFlow; // SAFE: options are exactly ImportFlow values
            // A lane switch re-ingests: split plans/outcomes are keyed by the
            // old model's sourceRefs and must rebuild from scratch — and the
            // metadata table belongs to the old lane's fields.
            this.splitPlans = new Map();
            this.splitOutcomes = null;
            this.metadataMapping = null;
            void this.showPreflight();
          });
      }
    }

    if (ingestReason) {
      this.renderStatusRow(status, 'Book folder', ingestReason, false);
    } else {
      const skipNote = skippedCount > 0 ? ` (${skippedCount} already onboarded, skipped)` : '';
      this.renderStatusRow(status, 'Chapters found', `${candidateCount}${skipNote}`, candidateCount > 0);
    }

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    const canStart = !ingestReason && candidateCount > 0 && this.model !== null;
    new ButtonComponent(actions)
      .setButtonText(preflightOk ? 'Continue' : 'Continue without AI')
      .setCta()
      .setDisabled(!canStart)
      .onClick(() => this.showSplitCheckpoint());
    // No model? Lead with the fix — a red shortcut straight to the AI settings.
    if (!preflightOk) {
      new ButtonComponent(actions)
        .setButtonText('Set up local AI')
        .setWarning()
        .onClick(() => {
          this.close();
          openPluginSettings(this.plugin, 'ai');
        });
    }
    // Set/reset the active book project without hunting through settings.
    new ButtonComponent(actions)
      .setButtonText('Book Manager')
      .onClick(() => {
        this.close();
        openSettingsAtBookManager(this.plugin);
      });
    new ButtonComponent(actions).setButtonText('Close').onClick(() => this.close());
  }

  /** Checkpoint 1 — confirm the scene split and reading order before any AI runs. */
  private showSplitCheckpoint(): void {
    if (!this.model) return;
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(
      2,
      'Confirm scenes',
      this.aiAvailable
        ? 'Each chapter is split into its scenes. Marker breaks split automatically; Auto-split proposes the rest, then you adjust.'
        : 'Each chapter is split into its scenes. Marker breaks split automatically; place any others by hand.'
    );

    // One split plan per source file (built once; edits persist across re-render).
    const scenes = flattenScenes(this.model);
    if (this.splitPlans.size === 0) {
      for (const scene of scenes) this.splitPlans.set(scene.sourceRef, planSceneSplit(scene));
    }
    this.persistSession('confirm');

    const totalLine = contentEl.createDiv({ cls: 'ert-muted' });
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
          `${plans.length} chapter${plans.length === 1 ? '' : 's'} found. Auto-split with AI detects the scenes inside them.`
        );
        return;
      }
      const total = plans.reduce((sum, plan) => sum + segmentCount(plan), 0);
      totalLine.setText(
        `Will create ${total} scene note${total === 1 ? '' : 's'} from ${plans.length} chapter${plans.length === 1 ? '' : 's'}.`
      );
    };

    // Discoverability: authors can hard-mark breaks in the source itself.
    // Marker glyphs lead as code chips so the eye lands on the symbols first.
    const tip = contentEl.createDiv({ cls: 'ert-onb-tip' });
    tip.createSpan({ cls: 'ert-onb-tip__icon', text: '💡' });
    const tipBody = tip.createSpan();
    for (const marker of ['***', '---', '⁂', '# heading']) {
      tipBody.createEl('code', { cls: 'ert-onb-tip__marker', text: marker });
    }
    tipBody.createSpan({
      text: ' on its own line in your manuscript forces a scene break there. It’s exact, survives re-runs, and the AI won’t override it.',
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
        text: `Auto-split done — ${scenes.length} chapter${scenes.length === 1 ? '' : 's'} → ${sceneTotal} scenes.`
          + (failed > 0 ? ` ${failed} chapter${failed === 1 ? '' : 's'} need${failed === 1 ? 's' : ''} attention below.` : ' Review the rows below, then continue.'),
      });
    }

    const list = contentEl.createDiv({ cls: 'ert-onb-list' });
    scenes.forEach((scene, i) => {
      const plan = this.splitPlans.get(scene.sourceRef);
      if (plan) this.renderSplitCard(list, plan, i + 1, updateTotal);
    });
    updateTotal();

    const stageRow = contentEl.createDiv({ cls: 'ert-row ert-onb-stagerow' });
    stageRow.createSpan({ text: 'Publish stage: ', cls: 'ert-muted' });
    new DropdownComponent(stageRow)
      .addOptions(Object.fromEntries(STAGE_ORDER.map((stage) => [stage, stage])))
      .setValue(this.publishStage)
      .onChange((value) => {
        this.publishStage = value as Stage; // SAFE: dropdown options are exactly STAGE_ORDER
      });
    stageRow.createSpan({
      cls: 'ert-muted',
      text: 'Set first draft to Zero; a finished, published book is Press.',
    });

    this.renderMetadataMappingTable(contentEl);

    // All actions live together at the bottom. Auto-split is the main path for
    // unmarked prose, so it takes the CTA until it has run; Continue takes over
    // after (or when there is nothing to auto-split).
    const splittable = [...this.splitPlans.values()].some(
      (plan) => !plan.alreadyOnboarded && plan.paragraphs.length > 1 && plan.breaks.length === 0
    );
    const offerAutoSplit = splittable && !this.splitOutcomes && this.aiAvailable;
    if (offerAutoSplit) {
      contentEl.createDiv({
        cls: 'ert-muted',
        text: 'Auto-split proposes scene breaks for every file that has none — you can adjust after.',
      });
    }
    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    if (offerAutoSplit) {
      new ButtonComponent(actions)
        .setButtonText('Auto-split with AI')
        .setCta()
        .onClick(() => void this.runSplitProposal());
    }
    const doneCount = this.proposals.filter((proposal) => proposal.frontmatter).length;
    const continueBtn = new ButtonComponent(actions)
      .setButtonText(doneCount > 0 ? `Resume extraction (${doneCount} done)` : 'Continue')
      .onClick(() => void this.runExtraction());
    if (!offerAutoSplit) continueBtn.setCta();
    new ButtonComponent(actions).setButtonText('Cancel').onClick(() => {
      activeSession = null; // explicit cancel discards the run
      this.close();
    });
  }

  /**
   * Scrivener metadata mapping table (flow 2 only): one row per sidecar field,
   * disposition per row — map to an RT key, keep as a custom field, or ignore.
   * Seeded from the automap proposal; the author's edits persist across
   * re-renders and are applied to the model just before extraction.
   */
  private renderMetadataMappingTable(contentEl: HTMLElement): void {
    if (!this.model || this.model.sourceKind !== 'scrivener' || this.model.customFields.length === 0) return;
    if (!this.metadataMapping) {
      this.metadataMapping = proposeScrivenerAutomap(this.model.customFields);
    }
    const mapping = this.metadataMapping;

    const panel = contentEl.createDiv({ cls: 'ert-onb-options ert-stack' });
    panel.createDiv({ cls: 'ert-onb-synopsis__label', text: 'Scrivener metadata' });
    panel.createDiv({
      cls: 'ert-muted',
      text: 'Each exported field can map to a Radial Timeline key, ride along as a custom field, or be dropped.',
    });

    const rtKeys = getSupportedFrontmatterRemapTargets();
    const encode = (decision: ScrivenerFieldTarget): string =>
      decision.target === 'rt-key' ? `rt:${decision.key}` : decision.target;
    const fields = this.model.customFields;

    // Bulk lane for the per-subplot-column model: most exported custom columns
    // ARE subplots, so one click flips every still-custom field at once.
    const bulkRow = panel.createDiv({ cls: 'ert-onb-map__bulk' });
    new ButtonComponent(bulkRow)
      .setButtonText('Mark all custom fields as subplots')
      .onClick(() => {
        for (const field of fields) {
          const current = mapping[field] ?? { target: 'custom' as const };
          if (current.target === 'custom') mapping[field] = { target: 'subplot-flag' };
        }
        renderRows();
      });

    const grid = panel.createDiv({ cls: 'ert-onb-map' });
    const renderRows = (): void => {
      grid.empty();
      for (const field of fields) {
        const bare = field.replace(/^Scrivener /i, '').trim();
        const options: Record<string, string> = {
          custom: 'Keep as custom field',
          ignore: 'Ignore',
          // The column NAME is the subplot; a non-empty cell marks membership.
          'subplot-flag': `Subplot “${bare}” — mark its scenes`,
        };
        for (const key of rtKeys) options[`rt:${key}`] = `Map to ${key}`;
        const decision = mapping[field] ?? { target: 'custom' as const };
        grid.createDiv({ cls: 'ert-onb-map__field', text: field });
        const cell = grid.createDiv({ cls: 'ert-onb-map__choice' });
        new DropdownComponent(cell)
          .addOptions(options)
          .setValue(encode(decision))
          .onChange((value) => {
            mapping[field] = value.startsWith('rt:')
              ? { target: 'rt-key', key: value.slice(3) }
              : { target: value as 'custom' | 'ignore' | 'subplot-flag' }; // SAFE: options are exactly custom|ignore|subplot-flag|rt:*
          });
      }
    };
    renderRows();
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
      statusText = 'No prose found in this file.';
    } else if (plan.alreadyOnboarded) {
      card.addClass('is-warn');
      statusText = 'Already onboarded — this file will be skipped.';
    } else if (this.splitOutcomes?.get(plan.sourceRef) === 'fallback') {
      card.addClass('is-warn');
      statusText = 'AI couldn’t find clean breaks, so this was split into even parts — open the row to adjust.';
    } else if (this.splitOutcomes?.get(plan.sourceRef) === 'failed') {
      card.addClass('is-warn');
      statusText = 'Couldn’t split this file — open the row to place breaks by hand.';
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
    if (plan.labels.length > 0) meta.createSpan({ cls: 'ert-onb-flag', text: `❖ ${plan.labels.length} title${plan.labels.length === 1 ? '' : 's'}` });
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
      countPill.setText(plan.alreadyOnboarded ? 'skip' : undecided ? 'unsplit' : `${n} scene${n === 1 ? '' : 's'}`);
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
      body.createDiv({ cls: 'ert-onb-error', text: 'Already onboarded — this file is skipped, not split.' });
      return;
    }
    if (plan.paragraphs.length === 0) {
      body.createDiv({ cls: 'ert-onb-error', text: 'No prose found in this file.' });
      return;
    }
    if (plan.labels.length > 0) {
      const hint = body.createDiv({ cls: 'ert-onb-split-hint' });
      hint.createDiv({ cls: 'ert-onb-synopsis__label', text: `Section titles (${plan.labels.length})` });
      const chips = hint.createDiv({ cls: 'ert-onb-fm__val' });
      plan.labels.forEach((label) => this.pill(chips, label, 'ert-onb-pill--subplot', true));
      hint.createDiv({
        cls: 'ert-onb-split-note',
        text: 'No scene markers in this text — use “Auto-split with AI” below, or click a break to place one by hand.',
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
        btn.setText(isBreak ? '✕ remove break' : '＋ scene break');
        btn.addEventListener('click', () => {
          plan.breaks = toggleBreak(plan, i);
          this.renderParagraphs(editor, plan, onChange);
          onChange();
        });
      }
      if (i === 0 || plan.breaks.includes(i)) {
        const segIndex = plan.breaks.filter((b) => b <= i).length;
        const segHead = editor.createDiv({ cls: 'ert-onb-seg-head' });
        segHead.createSpan({ cls: 'ert-onb-seg-num', text: `Scene ${segIndex + 1}` });
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
    this.renderStageHeader(2, 'Auto-splitting', 'Proposing scene boundaries with the local model…');

    const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    const statusEl = progressWrap.createDiv({ cls: 'ert-muted', text: 'Reading each file…' });
    const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
    barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
    const barFill = barTrack.createDiv();
    barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText('Abort').setWarning().onClick(() => this.abortController?.abort());

    this.splitOutcomes = await this.service.proposeSplits(plans, {
      signal: this.abortController.signal,
      onProgress: (current, total, title) => {
        statusEl.setText(`Splitting ${current} / ${total} — ${title}`);
        barFill.setCssStyles({ width: `${total > 0 ? Math.round((current / total) * 100) : 0}%` }); // SAFE: progress width
      },
    });

    this.showSplitCheckpoint();
  }

  private async runExtraction(): Promise<void> {
    if (!this.model) return;
    // Apply the confirmed scene split: one source file may now yield several scenes.
    let model = applySplitsToModel(this.model, this.splitPlans);
    // Then the Scrivener mapping table: rename/keep/drop carried metadata fields.
    if (this.metadataMapping) {
      model = applyMetadataMappingToModel(model, this.metadataMapping);
    }

    this.extractModel = model;

    // Structure-only path (no local model): everything is deterministic and
    // instant — no survey, no per-scene calls, no entity summaries.
    if (!this.aiAvailable) {
      this.survey = null;
      this.proposals = this.service.buildStructureOnlyProposals(model, { publishStage: this.publishStage });
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
    this.renderStageHeader(2, 'Reading scenes', 'Filling in each scene’s details — synopsis, characters, places, timing.');

    const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    const statusEl = progressWrap.createDiv({ cls: 'ert-muted', text: 'Surveying the whole book…' });
    const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
    barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
    const barFill = barTrack.createDiv();
    barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText('Abort').setWarning().onClick(() => this.abortController?.abort());
    // (setWarning is the Obsidian ButtonComponent API for the muted-danger style.)

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
        statusEl.setText(`Extracting ${current} / ${total} — ${title}`);
        barFill.setCssStyles({ width: `${total > 0 ? Math.round((current / total) * 100) : 0}%` }); // SAFE: progress width
      },
    });

    if (this.abortController.signal.aborted) {
      // Keep the partial work — reopening the command resumes from here.
      this.persistSession('confirm');
      this.renderMessage(
        'Extraction paused',
        'Progress is kept — run the onboarding command again to resume where you left off.',
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
      'Review',
      `${ok.length} scenes ready${flagged.length ? `, ${flagged.length} with flagged guesses` : ''}${failed.length ? `, ${failed.length} failed` : ''}. Expand a scene to see how it maps into the Radial Timeline template — Apply writes the book.`
    );

    // An all-Main-Plot book is almost always a failed structure survey, not a
    // one-thread story — say so instead of letting the timeline look broken.
    // (Structure-only runs skip the survey by design; no banner there.)
    if (this.aiAvailable && (!this.survey || this.survey.subplots.length === 0)) {
      contentEl.createDiv({
        cls: 'ert-onb-error',
        text: 'The structure survey failed, so every scene is on Main Plot. You can re-run onboarding for another pass, or layer subplots later.',
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

    const destName = suggestOnboardingFolderName(this.book?.sourceFolder ?? 'Book');
    contentEl.createDiv({
      cls: 'ert-muted',
      text: `Will write to a new folder: ${destName} (source left untouched) · Publish Stage: ${this.publishStage}.`,
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
    optionsPanel.createDiv({ cls: 'ert-onb-synopsis__label', text: 'Also create (optional)' });
    this.renderCheckbox(optionsPanel, 'Create Character profiles', this.createCharacters, (checked) => {
      this.createCharacters = checked;
      syncSummaryToggle();
    });
    this.renderCheckbox(optionsPanel, 'Create Place profiles', this.createPlaces, (checked) => {
      this.createPlaces = checked;
      syncSummaryToggle();
    });
    const summaryToggle = this.renderCheckbox(
      optionsPanel,
      'Generate AI summaries for profiles (slow — one call per character/place)',
      this.generateSummaries,
      (checked) => {
        this.generateSummaries = checked;
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
      .setButtonText(`Apply — write ${okCount} scenes`)
      .setCta()
      .setDisabled(okCount === 0)
      .onClick(() => void this.applyProposals());
    new ButtonComponent(actions).setButtonText('Cancel').onClick(() => {
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
      this.pill(meta, `Act ${String(fm.Act ?? '?')}`, 'ert-onb-pill--act');
      const chars = Array.isArray(fm.Character) ? fm.Character.length : 0;
      const places = Array.isArray(fm.Place) ? fm.Place.length : 0;
      this.pill(meta, `${chars} chars`, 'ert-onb-pill--count', true);
      this.pill(meta, `${places} places`, 'ert-onb-pill--count', true);
      if (proposal.flags.length > 0) meta.createSpan({ cls: 'ert-onb-flag', text: '⚑' });
    } else {
      this.pill(meta, 'failed', 'ert-onb-pill--warn', true);
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
        text: proposal.error ? `Extraction failed: ${proposal.error}` : 'Extraction failed — this scene will be skipped.',
      });
      return;
    }

    const grid = body.createDiv({ cls: 'ert-onb-fm' });
    this.fmScalar(grid, 'Class', String(fm.Class ?? 'Scene'));
    this.fmScalar(grid, 'Act', String(fm.Act ?? ''));
    this.fmScalar(grid, 'Status', String(fm.Status ?? ''));
    this.fmScalar(grid, 'Publish Stage', String(fm['Publish Stage'] ?? ''));
    if (fm.When) this.fmScalar(grid, 'When', String(fm.When));
    if (fm.Duration) this.fmScalar(grid, 'Duration', String(fm.Duration));
    this.fmPills(grid, 'Subplot', asStringList(fm.Subplot), 'ert-onb-pill--subplot');
    this.fmPills(grid, 'Character', asStringList(fm.Character).map(stripWikiLink), 'ert-onb-pill--char');
    this.fmPills(grid, 'Place', asStringList(fm.Place).map(stripWikiLink), 'ert-onb-pill--place');

    const synopsis = String(fm.Synopsis ?? '').trim();
    if (synopsis) {
      const syn = body.createDiv({ cls: 'ert-onb-synopsis' });
      syn.createDiv({ cls: 'ert-onb-synopsis__label', text: 'Synopsis' });
      syn.createDiv({ cls: 'ert-onb-synopsis__text', text: synopsis });
    }

    if (proposal.flags.length > 0) {
      const flags = body.createDiv({ cls: 'ert-onb-fm__val' });
      proposal.flags.forEach((flag) => this.pill(flags, `guessed: ${flag}`, 'ert-onb-pill--warn', true));
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
      this.renderStageHeader(3, 'Creating profiles', 'Summarizing characters and places with the local model…');
      const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
      const statusEl = progressWrap.createDiv({ cls: 'ert-muted', text: 'Gathering characters and places…' });
      const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
      barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
      const barFill = barTrack.createDiv();
      barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill
      const abortRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
      new ButtonComponent(abortRow).setButtonText('Abort').setWarning().onClick(() => this.abortController?.abort());

      this.entityProposals = await this.service.enrichEntities(this.proposals, {
        kinds,
        generateSummaries: true,
        signal: this.abortController.signal,
        onProgress: (current, total, name) => {
          statusEl.setText(`Summarizing ${current} / ${total} — ${name}`);
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

    this.renderBusy('Writing scene notes…');
    let report: MaterializeReport;
    try {
      report = await this.service.materialize(this.book, this.proposals, this.entityProposals);
    } catch (error) {
      this.renderMessage('Onboarding failed', error instanceof Error ? error.message : String(error), true);
      return;
    }
    this.showReport(report);
  }

  private showReport(report: MaterializeReport): void {
    activeSession = null; // the run is written — nothing left to resume
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(4, 'Complete', report.bookFolder);

    const panel = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    this.renderStatusRow(panel, 'Scenes written', String(report.notesCreated), report.notesCreated > 0);
    this.renderStatusRow(panel, 'Character & Place notes created', String(report.stubsCreated), true);
    // Roll guesses up to counts (at 106 scenes a per-scene list is noise — most
    // flags are the expected "Act guessed" for a manuscript without explicit
    // structure). Failures are rare and important: list those individually.
    const failures = report.needsReview.filter((proposal) => proposal.error);
    const flagged = report.needsReview.filter((proposal) => !proposal.error && proposal.flags.length > 0);
    if (flagged.length > 0) {
      const counts = new Map<string, number>();
      for (const proposal of flagged) {
        for (const flag of proposal.flags) counts.set(flag, (counts.get(flag) ?? 0) + 1);
      }
      const rollup = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([flag, count]) => `${flag} on ${count}`)
        .join(' · ');
      this.renderStatusRow(panel, 'Guessed fields', `${rollup} scene${flagged.length === 1 ? '' : 's'}`, true);
      panel.createDiv({
        cls: 'ert-muted',
        text: 'Expected when the text has no explicit dates or act marks — spot-check on the timeline.',
      });
    }
    if (failures.length > 0) {
      this.renderStatusRow(panel, 'Failed', String(failures.length), false);
      const reviewList = panel.createDiv({ cls: 'ert-onb-review-list ert-stack' });
      for (const proposal of failures) {
        const item = reviewList.createDiv({ cls: 'ert-onb-review-item' });
        item.createSpan({ cls: 'ert-onb-review-item__name', text: proposal.title || proposal.sourceRef });
        item.createSpan({ cls: 'ert-onb-review-item__reason', text: proposal.error ?? 'failed' });
      }
    }
    for (const err of report.errors) {
      panel.createDiv({ cls: 'ert-error', text: err });
    }

    new Notice(`Onboarded ${report.notesCreated} scenes into ${report.bookFolder}.`);
    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText('Done').setCta().onClick(() => this.close());
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
  private renderStageHeader(stage: number, title: string, subtitle?: string): void {
    const total = 4;

    // Top bar: canonical modal pill (modal name · local model) on the left,
    // stage step indicator on the right, same line.
    const topbar = this.contentEl.createDiv({ cls: 'ert-onb-topbar' });
    const badgeText = this.modelLabel ? `Onboarding · ${this.modelLabel}` : 'Onboarding';
    topbar.createSpan({ cls: 'ert-modal-badge', text: badgeText });
    const steps = topbar.createDiv({ cls: 'ert-onb-steps', attr: { 'aria-label': `Step ${stage} of ${total}` } });
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
    contentEl.createDiv({ cls: 'ert-muted', text: message });
  }

  private renderMessage(title: string, body: string, showClose: boolean): void {
    const { contentEl } = this;
    contentEl.empty();
    this.renderHeader(title);
    contentEl.createDiv({ cls: 'ert-muted', text: body });
    if (showClose) {
      const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
      new ButtonComponent(actions).setButtonText('Close').setCta().onClick(() => this.close());
    }
  }

  private renderStatusRow(parent: HTMLElement, label: string, value: string, good: boolean): void {
    const row = parent.createDiv({ cls: 'ert-row' });
    row.createSpan({ text: `${label}: `, cls: 'ert-muted' });
    row.createSpan({ text: value, cls: good ? undefined : 'ert-error' });
  }
}
