/*
 * Scrivener import review — the one screen between choosing an export and
 * having a book. Everything the author decides is here: the book's title and
 * stage, where each outline column goes, and a live preview of the result
 * (subplot rings, acts, characters, places, every scene) built from the exact
 * proposals the import will write. Nothing is written until Import.
 *
 * Rendering only; the modal owns state persistence and the write.
 */

import { ButtonComponent, DropdownComponent, TextComponent, ToggleComponent } from 'obsidian';
import type { BookProfile } from '../types/settings';
import { flattenScenes, type ManuscriptModel } from '../onboarding/adapters/manuscriptModel';
import {
  SCRIVENER_FIELD_TARGETS,
  applyMetadataMappingToModel,
  bareFieldName,
  isDerivedOutlineField,
  mappingConflicts,
  type ScrivenerFieldTarget,
} from '../onboarding/adapters/scrivenerAdapter';
import type { StructureOnlyImport } from '../onboarding/OnboardingService';
import { summarizeImport } from '../onboarding/importSummary';
import { basename } from '../onboarding/paths';
import { STAGE_ORDER, type Stage } from '../utils/constants';

export interface ScrivenerReviewState {
  /** The import's book; the author edits its title here. */
  book: BookProfile;
  model: ManuscriptModel;
  outlineName: string | null;
  warnings: string[];
  mapping: Record<string, ScrivenerFieldTarget>;
  publishStage: Stage;
  createProfiles: boolean;
}

export interface ScrivenerReviewHost {
  /** The proposals an import of `model` would write. */
  propose: (model: ManuscriptModel, publishStage: Stage) => StructureOnlyImport;
  destinationFor: (book: BookProfile) => string;
  destinationExists: (book: BookProfile) => boolean;
  /** Called after every author edit (the modal keeps the session). */
  onEdit: () => void;
  onChangeSource: () => void;
  onCancel: () => void;
  onImport: (result: StructureOnlyImport) => void;
}

/** Short Scrivener export instructions, collapsed until asked for. */
export function renderScrivenerExportHelp(parent: HTMLElement): void {
  const help = parent.createEl('details', { cls: 'ert-onb-help' });
  help.createEl('summary', { text: 'How to export from Scrivener' });
  const steps = help.createEl('ol');
  steps.createEl('li', { text: 'Select your manuscript in the binder, then File → Export → Files… as plain text, with numbered files.' });
  steps.createEl('li', { text: 'File → Export → Outliner Contents as CSV…, with Title, Synopsis and the columns you want to bring.' });
  steps.createEl('li', { text: 'Put both in this vault. The CSV can sit next to the exported folder.' });
}

function renderHeader(container: HTMLElement, title: string, subtitle: string): void {
  const header = container.createDiv({ cls: 'ert-modal-header' });
  header.createSpan({ cls: 'ert-modal-badge', text: 'Scrivener import' });
  header.createDiv({ cls: 'ert-modal-title', text: title });
  header.createDiv({ cls: 'ert-modal-subtitle', text: subtitle });
}

/** The export cannot be imported as it stands: say why and how to fix it. */
export function renderScrivenerBlocked(
  container: HTMLElement,
  folder: string,
  reason: string,
  actions: { onRecheck: () => void; onChangeSource: () => void }
): void {
  container.empty();
  renderHeader(container, 'This export needs a fix', `“${basename(folder)}” can’t be imported yet.`);
  const panel = container.createDiv({ cls: 'ert-panel ert-stack' });
  for (const line of reason.split('\n')) {
    panel.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: line });
  }
  renderScrivenerExportHelp(panel);
  const row = container.createDiv({ cls: 'ert-modal-actions' });
  new ButtonComponent(row).setButtonText('Choose another export').onClick(actions.onChangeSource);
  new ButtonComponent(row).setButtonText('Check again').setCta().onClick(actions.onRecheck);
}

function encode(decision: ScrivenerFieldTarget): string {
  return decision.target === 'rt-key' ? `rt:${decision.key}` : decision.target;
}

function decode(value: string): ScrivenerFieldTarget {
  if (value.startsWith('rt:')) return { target: 'rt-key', key: value.slice(3) };
  return { target: value as 'custom' | 'ignore' | 'subplot-flag' }; // SAFE: the select's only other values are exactly these three
}

/** A field's target select: scene fields first, then the column's own options. */
function renderTargetSelect(parent: HTMLElement, field: string, decision: ScrivenerFieldTarget, onPick: (decision: ScrivenerFieldTarget) => void): void {
  const dropdown = new DropdownComponent(parent);
  const select = dropdown.selectEl;
  select.setAttribute('aria-label', `Where “${bareFieldName(field)}” goes`);
  const group = (label: string, keys: readonly string[]): void => {
    const optgroup = select.createEl('optgroup', { attr: { label } });
    for (const key of keys) optgroup.createEl('option', { value: `rt:${key}`, text: key });
  };
  group('Scene field', SCRIVENER_FIELD_TARGETS.timeline);
  group('More scene fields', SCRIVENER_FIELD_TARGETS.other);
  const own = select.createEl('optgroup', { attr: { label: 'This column' } });
  own.createEl('option', { value: 'subplot-flag', text: `Subplot “${bareFieldName(field)}” for filled cells` });
  own.createEl('option', { value: 'custom', text: `Keep as “${field}”` });
  own.createEl('option', { value: 'ignore', text: 'Skip' });
  dropdown.setValue(encode(decision)).onChange((value) => onPick(decode(value)));
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed;
}

export function renderScrivenerReview(container: HTMLElement, state: ScrivenerReviewState, host: ScrivenerReviewHost): void {
  container.empty();
  const scenes = flattenScenes(state.model);
  const folderName = basename(state.book.sourceFolder);
  renderHeader(
    container,
    'Review your import',
    `${scenes.length} scene${scenes.length === 1 ? '' : 's'} from “${folderName}”, in ${state.outlineName ? `the order of ${state.outlineName}` : 'numbered file order'}.`
  );
  for (const warning of state.warnings) container.createDiv({ cls: 'ert-onb-warn', text: warning });

  // --- Book -----------------------------------------------------------------
  const bookPanel = container.createDiv({ cls: 'ert-panel ert-stack' });
  const bookRow = bookPanel.createDiv({ cls: 'ert-onb-bookrow' });
  const titleLabel = bookRow.createEl('label', { cls: 'ert-onb-field' });
  titleLabel.createSpan({ cls: 'ert-section-desc', text: 'Book title' });
  new TextComponent(titleLabel)
    .setValue(state.book.title)
    .then((text) => text.inputEl.addClass('ert-input'))
    .onChange((value) => {
      state.book.title = value.trim();
      edited();
    });
  const stageLabel = bookRow.createEl('label', { cls: 'ert-onb-field' });
  stageLabel.createSpan({ cls: 'ert-section-desc', text: 'Stage' });
  new DropdownComponent(stageLabel)
    .addOptions(Object.fromEntries(STAGE_ORDER.map((stage) => [stage, stage])))
    .setValue(state.publishStage)
    .onChange((value) => {
      state.publishStage = value as Stage; // SAFE: options are exactly STAGE_ORDER
      edited();
    });
  const destinationEl = bookPanel.createDiv({ cls: 'ert-section-desc' });

  // --- Fields ---------------------------------------------------------------
  const fields = state.model.customFields.filter((field) => !isDerivedOutlineField(field));
  const skipped = state.model.customFields.filter((field) => isDerivedOutlineField(field));
  let conflictsEl: HTMLElement | null = null;
  if (fields.length > 0) {
    const fieldPanel = container.createDiv({ cls: 'ert-panel ert-stack' });
    fieldPanel.createDiv({ cls: 'ert-section-title', text: 'Outline columns' });
    const grid = fieldPanel.createDiv({ cls: 'ert-onb-map' });
    for (const field of fields) {
      const cell = grid.createDiv({ cls: 'ert-onb-map__field' });
      cell.createDiv({ text: bareFieldName(field) });
      const samples = [...new Set(scenes.map((scene) => scene.knownMetadata[field]).filter((value) => value?.trim()))].slice(0, 3);
      if (samples.length) cell.createDiv({ cls: 'ert-section-desc', text: truncate(samples.join(' · '), 70) });
      renderTargetSelect(grid.createDiv({ cls: 'ert-onb-map__choice' }), field, state.mapping[field] ?? { target: 'custom' }, (decision) => {
        state.mapping[field] = decision;
        edited();
      });
    }
    conflictsEl = fieldPanel.createDiv({ cls: 'ert-stack' });
    if (skipped.length) {
      fieldPanel.createDiv({ cls: 'ert-section-desc', text: `Not imported: ${skipped.map(bareFieldName).join(', ')} (Scrivener bookkeeping).` });
    }
  }

  // --- Result (live) ---------------------------------------------------------
  const resultPanel = container.createDiv({ cls: 'ert-panel ert-stack' });
  const actions = container.createDiv({ cls: 'ert-modal-actions' });
  new ButtonComponent(actions).setButtonText('Choose another export').onClick(host.onChangeSource);
  new ButtonComponent(actions).setButtonText('Cancel').onClick(host.onCancel);
  const importButton = new ButtonComponent(actions).setCta();
  let current: StructureOnlyImport | null = null;
  importButton.onClick(() => { if (current) host.onImport(current); });

  function edited(): void {
    host.onEdit();
    refresh();
  }

  function refresh(): void {
    const result = host.propose(applyMetadataMappingToModel(state.model, state.mapping), state.publishStage);
    current = result;
    const summary = summarizeImport(result.proposals);
    const destination = host.destinationFor(state.book);
    const taken = host.destinationExists(state.book);
    destinationEl.toggleClass('ert-section-desc--alert', taken || !state.book.title);
    destinationEl.setText(
      !state.book.title ? 'Give the book a title.'
        : taken ? `A folder named “${basename(destination)}” already exists. Choose another title.`
          : `Creates “${destination}”. Your export stays as it is.`
    );

    if (conflictsEl) {
      conflictsEl.empty();
      for (const key of mappingConflicts(state.mapping)) {
        conflictsEl.createDiv({ cls: 'ert-onb-warn', text: `More than one column goes to ${key}; each scene keeps the first filled one.` });
      }
    }

    const listWasOpen = resultPanel.querySelector('details')?.open === true;
    resultPanel.empty();
    resultPanel.createDiv({ cls: 'ert-section-title', text: 'Your timeline' });
    const subplotRow = resultPanel.createDiv({ cls: 'ert-onb-resultrow' });
    subplotRow.createSpan({ cls: 'ert-section-desc', text: 'Subplots' });
    const pills = subplotRow.createDiv({ cls: 'ert-onb-pills' });
    for (const subplot of summary.subplots) {
      pills.createSpan({ cls: 'ert-badgePill ert-badgePill--sm ert-onb-pill--subplot', text: `${subplot.name} ${subplot.scenes}` });
    }
    const actRow = resultPanel.createDiv({ cls: 'ert-onb-resultrow' });
    actRow.createSpan({ cls: 'ert-section-desc', text: 'Acts' });
    actRow.createSpan({
      text: result.actSource === 'column' ? 'From your Act column'
        : result.actSource === 'folders' ? 'From your ACT folders'
          : `${result.actCount}, split evenly by scene order`,
    });
    if (result.highestSourceAct > result.actCount) {
      resultPanel.createDiv({
        cls: 'ert-onb-warn',
        text: `Your export names ${result.highestSourceAct} acts but the timeline has ${result.actCount}; later acts are placed in Act ${result.actCount}. Raise the act count in Settings first to keep them.`,
      });
    }
    const entityCount = summary.characters.length + summary.places.length;
    if (entityCount > 0) {
      const castRow = resultPanel.createDiv({ cls: 'ert-onb-resultrow' });
      castRow.createSpan({ cls: 'ert-section-desc', text: 'Cast' });
      castRow.createSpan({ text: `${summary.characters.length} character${summary.characters.length === 1 ? '' : 's'} · ${summary.places.length} place${summary.places.length === 1 ? '' : 's'}` });
      const check = resultPanel.createDiv({ cls: 'ert-onb-check' });
      new ToggleComponent(check)
        .setValue(state.createProfiles)
        .then((toggle) => toggle.toggleEl.setAttribute('aria-label', 'Create character and place notes'))
        .onChange((value) => {
          state.createProfiles = value;
          host.onEdit();
        });
      check.createSpan({ text: `Also create a note for each (${entityCount})` });
    }

    const list = resultPanel.createEl('details', { cls: 'ert-onb-help' });
    list.open = listWasOpen;
    list.createEl('summary', { text: `Show all ${summary.scenes} scenes` });
    const rows = list.createDiv({ cls: 'ert-onb-scenelist' });
    result.proposals.forEach((proposal, index) => {
      const row = rows.createDiv({ cls: 'ert-onb-scenelist__row' });
      row.createSpan({ cls: 'ert-onb-scene__idx', text: String(index + 1).padStart(2, '0') });
      row.createSpan({ text: proposal.title });
      const subplots = proposal.frontmatter?.Subplot;
      row.createSpan({
        cls: 'ert-section-desc',
        text: `Act ${String(proposal.frontmatter?.Act)} · ${Array.isArray(subplots) ? subplots.join(', ') : ''}`,
      });
    });

    importButton.setButtonText(`Import ${summary.scenes} scene${summary.scenes === 1 ? '' : 's'}`);
    importButton.setDisabled(summary.scenes === 0 || taken || !state.book.title);
  }

  refresh();
}
