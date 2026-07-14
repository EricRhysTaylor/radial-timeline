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

import { App, ButtonComponent, DropdownComponent, Modal, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
  OnboardingService,
  type MaterializeReport,
  type SceneProposal,
} from '../onboarding/OnboardingService';
import type { SurveyResult } from '../onboarding/extraction';
import { flattenScenes, type ManuscriptModel } from '../onboarding/adapters/manuscriptModel';
import { suggestOnboardingFolderName } from '../onboarding/paths';
import { getActiveBook } from '../utils/books';
import { STAGE_ORDER, type Stage } from '../utils/constants';
import type { BookProfile } from '../types/settings';

export class OnboardingModal extends Modal {
  private readonly plugin: RadialTimelinePlugin;
  private readonly service: OnboardingService;
  private book: BookProfile | null = null;
  private model: ManuscriptModel | null = null;
  private survey: SurveyResult | null = null;
  private proposals: SceneProposal[] = [];
  private publishStage: Stage = 'Zero';
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

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions)
      .setButtonText('Extract metadata')
      .setCta()
      .onClick(() => void this.runExtraction());
    new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
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
    this.showReviewCheckpoint();
  }

  /** Checkpoint 2 — review proposed frontmatter (and flagged guesses) before writing. */
  private showReviewCheckpoint(): void {
    const { contentEl } = this;
    contentEl.empty();

    const ok = this.proposals.filter((p) => p.frontmatter);
    const failed = this.proposals.filter((p) => !p.frontmatter);
    const flagged = ok.filter((p) => p.flags.length > 0);
    this.renderHeader(
      'Checkpoint 2 · Review',
      `${ok.length} scenes ready${flagged.length ? `, ${flagged.length} with flagged guesses` : ''}${failed.length ? `, ${failed.length} failed` : ''}. Nothing is written until you apply.`
    );

    const list = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    list.setCssStyles({ maxHeight: '340px', overflowY: 'auto' }); // SAFE: scrollable list
    for (const proposal of this.proposals) {
      const row = list.createDiv({ cls: 'ert-row ert-stack' });
      const head = row.createDiv();
      head.createSpan({ text: proposal.title || proposal.sourceRef });
      if (proposal.error) {
        head.createSpan({ text: `  · failed: ${proposal.error}`, cls: 'ert-error' });
        continue;
      }
      const fm = proposal.frontmatter as Record<string, unknown>;
      const bits = [
        `Act ${String(fm.Act ?? '?')}`,
        Array.isArray(fm.Subplot) && fm.Subplot.length ? (fm.Subplot as string[]).join(' · ') : '',
        Array.isArray(fm.Character) ? `${(fm.Character as string[]).length} chars` : '',
        Array.isArray(fm.Place) ? `${(fm.Place as string[]).length} places` : '',
        fm.When ? `When ${String(fm.When)}` : '',
      ].filter(Boolean);
      row.createDiv({ cls: 'ert-muted', text: bits.join('  ·  ') });
      if (proposal.flags.length > 0) {
        row.createSpan({ text: `⚑ guessed: ${proposal.flags.join(', ')}`, cls: 'ert-error' });
      }
    }

    const destName = suggestOnboardingFolderName(this.book?.sourceFolder ?? 'Book');
    contentEl.createDiv({
      cls: 'ert-muted',
      text: `Will write to a new folder: ${destName} (source left untouched) · Publish Stage: ${this.publishStage}.`,
    });

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions)
      .setButtonText(`Apply — write ${ok.length} scenes`)
      .setCta()
      .setDisabled(ok.length === 0)
      .onClick(() => void this.applyProposals());
    new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
  }

  private async applyProposals(): Promise<void> {
    this.renderBusy('Writing scene notes…');
    let report: MaterializeReport;
    try {
      report = await this.service.materialize(this.book, this.proposals);
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
