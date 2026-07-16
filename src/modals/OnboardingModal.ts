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
import {
  planSceneSplit,
  toggleBreak,
  segmentCount,
  applySplitsToModel,
  type ScenePlan,
} from '../onboarding/sceneSplitting';
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

/** First `max` chars of a paragraph for the split-editor preview, with an ellipsis. */
function truncateText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed;
}

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
  private splitOutcomes: Map<string, 'split' | 'failed'> | null = null;
  private publishStage: Stage = 'Press';
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
    this.renderStageHeader(1, 'Prepare', `Onboard "${book.sourceFolder}"`);

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
    this.renderStageHeader(2, 'Confirm scenes', 'Files with scene-break markers split automatically. For unmarked prose, let AI propose the breaks, then adjust. Nothing is written yet.');

    // One split plan per source file (built once; edits persist across re-render).
    const scenes = flattenScenes(this.model);
    if (this.splitPlans.size === 0) {
      for (const scene of scenes) this.splitPlans.set(scene.sourceRef, planSceneSplit(scene));
    }

    const totalLine = contentEl.createDiv({ cls: 'ert-muted' });
    const updateTotal = (): void => {
      const total = scenes.reduce((sum, scene) => {
        const plan = this.splitPlans.get(scene.sourceRef);
        return sum + (plan ? segmentCount(plan) : 1);
      }, 0);
      totalLine.setText(`Will create ${total} scene note${total === 1 ? '' : 's'} from ${scenes.length} file${scenes.length === 1 ? '' : 's'}.`);
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
        text: `Auto-split done — ${scenes.length} file${scenes.length === 1 ? '' : 's'} → ${sceneTotal} scenes.`
          + (failed > 0 ? ` ${failed} file${failed === 1 ? '' : 's'} need${failed === 1 ? 's' : ''} attention below.` : ' Review the rows below, then continue.'),
      });
    }

    const list = contentEl.createDiv({ cls: 'ert-onb-list' });
    scenes.forEach((scene, i) => {
      const plan = this.splitPlans.get(scene.sourceRef);
      if (plan) this.renderSplitCard(list, plan, i + 1, updateTotal);
    });
    updateTotal();

    const stageRow = contentEl.createDiv({ cls: 'ert-row' });
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

    // All actions live together at the bottom. Auto-split is the main path for
    // unmarked prose, so it takes the CTA until it has run; Continue takes over
    // after (or when there is nothing to auto-split).
    const splittable = [...this.splitPlans.values()].some(
      (plan) => !plan.alreadyOnboarded && plan.paragraphs.length > 1 && plan.breaks.length === 0
    );
    const offerAutoSplit = splittable && !this.splitOutcomes;
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
    const continueBtn = new ButtonComponent(actions)
      .setButtonText('Continue')
      .onClick(() => void this.runExtraction());
    if (!offerAutoSplit) continueBtn.setCta();
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
    } else if (this.splitOutcomes?.get(plan.sourceRef) === 'failed') {
      card.addClass('is-warn');
      statusText = 'AI could not place breaks here — open the row to add them by hand.';
    } else if (this.splitOutcomes) {
      card.addClass('is-ok');
    }

    const head = card.createEl('button', { cls: 'ert-onb-scene__head', attr: { type: 'button' } });
    head.createSpan({ cls: 'ert-onb-scene__idx', text: String(displayIndex).padStart(2, '0') });
    head.createSpan({ cls: 'ert-onb-scene__title', text: plan.baseTitle ?? plan.sourceRef });
    const meta = head.createDiv({ cls: 'ert-onb-scene__meta' });
    const countPill = meta.createSpan({ cls: 'ert-badgePill ert-onb-pill--act' });
    const refreshCount = (): void => {
      const n = segmentCount(plan);
      countPill.setText(plan.alreadyOnboarded ? 'skip' : `${n} scene${n === 1 ? '' : 's'}`);
    };
    refreshCount();
    // "Section titles", never "beats" — beats is the story-structure system
    // (Save the Cat etc.) elsewhere in RT; these are TOC-style titles parsed
    // from the chapter's argument line that become scene titles on split.
    if (plan.labels.length > 0) meta.createSpan({ cls: 'ert-onb-flag', text: `❖ ${plan.labels.length} title${plan.labels.length === 1 ? '' : 's'}` });
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
    const model = applySplitsToModel(this.model, this.splitPlans);
    this.abortController = new AbortController();
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(2, 'Reading scenes', 'Filling in each scene’s details — synopsis, characters, places, timing. Nothing is written yet.');

    const progressWrap = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    const statusEl = progressWrap.createDiv({ cls: 'ert-muted', text: 'Surveying the whole book…' });
    const barTrack = progressWrap.createDiv({ cls: 'ert-progress-track' });
    barTrack.setCssStyles({ height: '6px', background: 'var(--background-modifier-border)', borderRadius: '3px' }); // SAFE: progress track
    const barFill = barTrack.createDiv();
    barFill.setCssStyles({ height: '100%', width: '0%', background: 'var(--interactive-accent)', borderRadius: '3px' }); // SAFE: progress fill

    const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
    new ButtonComponent(actions).setButtonText('Abort').setWarning().onClick(() => this.abortController?.abort());
    // (setWarning is the Obsidian ButtonComponent API for the muted-danger style.)

    this.survey = await this.service.survey(model);

    this.proposals = await this.service.extractScenes(model, this.survey, {
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

    // Character/Place profiles are decided at the Review checkpoint and built
    // at apply time — this stage stays about the narrative only.
    this.entityProposals = [];

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
    contentEl.createDiv({
      cls: 'ert-muted',
      text: `Will write to a new folder: ${destName} (source left untouched) · Publish Stage: ${this.publishStage}.`,
    });

    // Optional extras, decided here — after the narrative is settled. Built at
    // apply time; summaries are the slow part (one AI call per entity).
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
    const { contentEl } = this;
    contentEl.empty();
    this.renderStageHeader(4, 'Complete', report.bookFolder);

    const panel = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
    this.renderStatusRow(panel, 'Scenes written', String(report.notesCreated), report.notesCreated > 0);
    this.renderStatusRow(panel, 'Character & Place notes created', String(report.stubsCreated), true);
    if (report.needsReview.length > 0) {
      this.renderStatusRow(panel, 'Needs review', String(report.needsReview.length), false);
      const reviewList = panel.createDiv({ cls: 'ert-onb-review-list ert-stack' });
      for (const proposal of report.needsReview) {
        const reason = proposal.error
          ? `failed: ${proposal.error}`
          : proposal.flags.length > 0
            ? `guessed: ${proposal.flags.join(', ')}`
            : 'flagged';
        const item = reviewList.createDiv({ cls: 'ert-onb-review-item' });
        item.createSpan({ cls: 'ert-onb-review-item__name', text: proposal.title || proposal.sourceRef });
        item.createSpan({ cls: 'ert-onb-review-item__reason', text: reason });
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
    const header = this.contentEl.createDiv({ cls: 'ert-onb-stage' });
    header.createDiv({ cls: 'ert-onb-stage__num', text: String(stage) });
    const titles = header.createDiv({ cls: 'ert-onb-stage__titles' });
    // Canonical modal typography — same title/subtitle treatment as every
    // other ERT modal; the onboarding classes only carry layout.
    titles.createDiv({ cls: 'ert-modal-title ert-onb-stage__title', text: `${title}` });
    if (subtitle) titles.createDiv({ cls: 'ert-modal-subtitle ert-onb-stage__subtitle', text: subtitle });
    const steps = header.createDiv({ cls: 'ert-onb-steps', attr: { 'aria-label': `Step ${stage} of ${total}` } });
    for (let i = 1; i <= total; i++) {
      const pip = steps.createSpan({ cls: 'ert-onb-step' });
      if (i < stage) pip.addClass('is-done');
      else if (i === stage) pip.addClass('is-current');
    }
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
