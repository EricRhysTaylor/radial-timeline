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
} from '../onboarding/OnboardingService';
import type { SurveyResult } from '../onboarding/extraction';
import { flattenScenes, type ManuscriptModel } from '../onboarding/adapters/manuscriptModel';
import { suggestOnboardingFolderName } from '../onboarding/paths';
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

export class OnboardingModal extends Modal {
  private readonly plugin: RadialTimelinePlugin;
  private readonly service: OnboardingService;
  private book: BookProfile | null = null;
  private model: ManuscriptModel | null = null;
  private survey: SurveyResult | null = null;
  private proposals: SceneProposal[] = [];
  private entityProposals: EntityProposal[] = [];
  private publishStage: Stage = 'Zero';
  // Extra work beyond scenes — all off by default so the core run is just
  // "split into scene notes with YAML + Synopsis". The author opts in.
  private createCharacters = false;
  private createPlaces = false;
  private generateSummaries = false;
  private abortController: AbortController | null = null;

  constructor(app: App, plugin: RadialTimelinePlugin) {
    super(app);
    this.plugin = plugin;
    this.service = new OnboardingService(plugin);
  }

  onOpen(): void {
    const { modalEl, contentEl } = this;
    modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
    modalEl.setCssStyles({ width: '832px', maxWidth: '94vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
    contentEl.addClass('ert-modal-container', 'ert-stack');
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
      this.renderMessage(
        'No book folder',
        'Set an active book with a source folder (Book Designer) before onboarding.',
        true
      );
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
    } catch (error) {
      preflightReason = error instanceof Error ? error.message : String(error);
    }

    let ingestReason = '';
    let candidateCount = 0;
    let skippedCount = 0;
    try {
      const ingest = await this.service.ingest(book.sourceFolder);
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
    this.renderHeader('Onboard existing manuscript', book.sourceFolder);

    const status = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    this.renderStatusRow(status, 'Local model', preflightOk ? `Ready — tier ${tier}` : `Not ready — ${preflightReason}`, preflightOk);
    if (ingestReason) {
      this.renderStatusRow(status, 'Book folder', ingestReason, false);
    } else {
      const skipNote = skippedCount > 0 ? ` (${skippedCount} already onboarded, skipped)` : '';
      this.renderStatusRow(status, 'Scenes found', `${candidateCount}${skipNote}`, candidateCount > 0);
    }

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    const canStart = preflightOk && !ingestReason && candidateCount > 0 && this.model !== null;
    new ButtonComponent(actions)
      .setButtonText('Continue')
      .setCta()
      .setDisabled(!canStart)
      .onClick(() => this.showSplitCheckpoint());
    new ButtonComponent(actions).setButtonText('Close').onClick(() => this.close());
  }

  /** Checkpoint 1 — confirm the scene split and reading order before any AI runs. */
  private showSplitCheckpoint(): void {
    if (!this.model) return;
    const { contentEl } = this;
    contentEl.empty();
    this.renderHeader('Checkpoint 1 · Confirm scenes', 'Each note becomes one scene, in reading order. Nothing is written yet.');

    const list = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    list.setCssStyles({ maxHeight: '340px', overflowY: 'auto' }); // SAFE: scrollable list (Obsidian pattern)
    const scenes = flattenScenes(this.model);
    scenes.forEach((scene, i) => {
      const row = list.createDiv({ cls: 'ert-row' });
      row.createSpan({ text: `${String(i + 1).padStart(2, '0')}. `, cls: 'ert-muted' });
      row.createSpan({ text: scene.title ?? scene.sourceRef });
      if (scene.alreadyOnboarded) {
        row.createSpan({ text: '  · already onboarded (skip)', cls: 'ert-muted' });
      }
    });

    const stageRow = contentEl.createDiv({ cls: 'ert-row' });
    stageRow.createSpan({ text: 'Publish stage: ', cls: 'ert-muted' });
    new DropdownComponent(stageRow)
      .addOptions(Object.fromEntries(STAGE_ORDER.map((stage) => [stage, stage])))
      .setValue(this.publishStage)
      .onChange((value) => {
        this.publishStage = value as Stage; // SAFE: dropdown options are exactly STAGE_ORDER
      });
    contentEl.createDiv({
      cls: 'ert-muted',
      text: 'Applied to every scene. A draft still being written is Zero; a finished, published book is Press.',
    });

    // Extra work, opt-in. The core run (always on) is: split into scene notes
    // with YAML across acts + Synopsis. The rest is slower and off by default.
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
      const anyProfile = this.createCharacters || this.createPlaces;
      summaryToggle.disabled = !anyProfile;
      summaryToggle.parentElement?.toggleClass('ert-setting-dimmed', !anyProfile);
      if (!anyProfile && this.generateSummaries) {
        this.generateSummaries = false;
        summaryToggle.checked = false;
      }
    };
    syncSummaryToggle();

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions)
      .setButtonText('Extract metadata')
      .setCta()
      .onClick(() => void this.runExtraction());
    new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
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

  private async runExtraction(): Promise<void> {
    if (!this.model) return;
    this.abortController = new AbortController();
    const { contentEl } = this;
    contentEl.empty();
    this.renderHeader('Reading the manuscript…', 'Surveying structure, then extracting each scene.');

    const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    const statusEl = progressWrap.createDiv({ cls: 'ert-muted', text: 'Surveying the whole book…' });
    const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
    barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
    const barFill = barTrack.createDiv();
    barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText('Abort').setWarning().onClick(() => this.abortController?.abort());
    // (setWarning is the Obsidian ButtonComponent API for the muted-danger style.)

    this.survey = await this.service.survey(this.model);

    this.proposals = await this.service.extractScenes(this.model, this.survey, {
      signal: this.abortController.signal,
      publishStage: this.publishStage,
      onProgress: (current, total, title) => {
        statusEl.setText(`Extracting ${current} / ${total} — ${title}`);
        barFill.setCssStyles({ width: `${total > 0 ? Math.round((current / total) * 100) : 0}%` }); // SAFE: progress width
      },
    });

    if (this.abortController.signal.aborted) {
      this.renderMessage('Onboarding cancelled', 'No files were written.', true);
      return;
    }

    // Optional second phase: only for the profile kinds the author enabled. When
    // summaries are on this is the slow part (one AI call per entity); otherwise
    // it just builds plain-scaffold proposals. Skipped entirely when no profile
    // kind is enabled — the core run is scenes only.
    const kinds: EntityKind[] = [];
    if (this.createCharacters) kinds.push('character');
    if (this.createPlaces) kinds.push('place');

    if (kinds.length === 0) {
      this.entityProposals = [];
    } else if (this.generateSummaries) {
      statusEl.setText('Summarizing characters and places…');
      barFill.setCssStyles({ width: '0%' }); // SAFE: progress width
      this.entityProposals = await this.service.enrichEntities(this.proposals, {
        kinds,
        generateSummaries: true,
        signal: this.abortController.signal,
        onProgress: (current, total, name) => {
          statusEl.setText(`Summarizing ${current} / ${total} — ${name}`);
          barFill.setCssStyles({ width: `${total > 0 ? Math.round((current / total) * 100) : 0}%` }); // SAFE: progress width
        },
      });
    } else {
      // No AI — just plan the scaffolds.
      this.entityProposals = await this.service.enrichEntities(this.proposals, {
        kinds,
        generateSummaries: false,
      });
    }

    this.showReviewCheckpoint();
  }

  /** Checkpoint 2 — review each scene's RT-template mapping before writing. */
  private showReviewCheckpoint(): void {
    const { contentEl } = this;
    contentEl.empty();

    const ok = this.proposals.filter((p) => p.frontmatter);
    const failed = this.proposals.filter((p) => !p.frontmatter);
    const flagged = ok.filter((p) => p.flags.length > 0);
    this.renderHeader(
      'Checkpoint 2 · Review',
      `${ok.length} scenes ready${flagged.length ? `, ${flagged.length} with flagged guesses` : ''}${failed.length ? `, ${failed.length} failed` : ''}. Expand a scene to see how it maps into the Radial Timeline template. Nothing is written until you apply.`
    );

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
    const summarized = this.entityProposals.filter((entity) => entity.summary).length;
    const entityNote = this.entityProposals.length > 0
      ? ` · ${this.entityProposals.length} Character/Place notes (${summarized} summarized)`
      : '';
    contentEl.createDiv({
      cls: 'ert-muted',
      text: `Will write to a new folder: ${destName} (source left untouched) · Publish Stage: ${this.publishStage}${entityNote}.`,
    });

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions)
      .setButtonText(`Apply — write ${ok.length} scenes`)
      .setCta()
      .setDisabled(ok.length === 0)
      .onClick(() => void this.applyProposals());
    new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
  }

  /** One accordion row: headline metadata always visible, detail lazily built on open. */
  private renderReviewScene(
    list: HTMLElement,
    proposal: SceneProposal,
    displayIndex: number,
    openByDefault: boolean
  ): void {
    const fm = proposal.frontmatter as Record<string, unknown> | null;
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
    const fm = proposal.frontmatter as Record<string, unknown> | null;
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
    const { contentEl } = this;
    contentEl.empty();
    this.renderHeader('Onboarding complete', report.bookFolder);

    const panel = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    this.renderStatusRow(panel, 'Scenes written', String(report.notesCreated), report.notesCreated > 0);
    this.renderStatusRow(panel, 'Character & Place notes created', String(report.stubsCreated), true);
    if (report.needsReview.length > 0) {
      this.renderStatusRow(panel, 'Needs review', `${report.needsReview.length} (flagged guesses or failures)`, false);
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
