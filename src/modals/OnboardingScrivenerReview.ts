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
  type ScrivenerProblem,
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
  createCharacterNotes: boolean;
  createPlaceNotes: boolean;
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

function renderHeader(container: HTMLElement, title: string, subtitle?: string): void {
  const header = container.createDiv({ cls: 'ert-modal-header' });
  header.createSpan({ cls: 'ert-modal-badge', text: 'Scrivener import' });
  header.createDiv({ cls: 'ert-modal-title', text: title });
  if (subtitle) header.createDiv({ cls: 'ert-modal-subtitle', text: subtitle });
}

/** What an import without an outline CSV loses, and how to include it. */
export const MISSING_OUTLINE_TEXT = 'No outline CSV found. Scenes will import without synopses or properties. To include them, export Outliner Contents as CSV next to the scene folder.';

/**
 * The parts of a manuscript, one labeled line each: a Scrivener export is its
 * scene files plus the outline CSV with their properties. A warning line flags
 * a missing part.
 */
export function renderSourceParts(parent: HTMLElement, parts: Array<{ label: string; value: string; warn?: boolean }>): void {
  const list = parent.createDiv({ cls: 'ert-onb-sources' });
  for (const part of parts) {
    list.createSpan({ cls: 'ert-section-desc', text: part.label });
    list.createSpan({ cls: part.warn ? 'ert-onb-warn' : 'ert-onb-sources__value', text: part.value });
  }
}

/** A name list short enough to read at a glance. */
function nameList(names: string[]): string {
  const shown = names.slice(0, 8).join(', ');
  return names.length > 8 ? `${shown} and ${names.length - 8} more` : shown;
}

/**
 * The export doesn't line up. Each problem says what continuing would do, so
 * the author can fix it in Scrivener or carry on. Only an export with nothing
 * to import (no `onContinue`) has no way forward.
 */
export function renderScrivenerProblems(
  container: HTMLElement,
  folder: string,
  problems: ScrivenerProblem[],
  actions: { onRecheck: () => void; onChangeSource: () => void; onContinue?: () => void }
): void {
  container.empty();
  const name = basename(folder);
  if (actions.onContinue) {
    renderHeader(container, 'Check this export', `Some of “${name}” doesn’t line up. Fix it in Scrivener, or continue anyway.`);
  } else {
    renderHeader(container, 'Nothing to import', `“${name}” has no scene text.`);
  }
  const panel = container.createDiv({ cls: 'ert-panel ert-stack' });
  for (const item of problems) {
    const entry = panel.createDiv({ cls: 'ert-stack ert-onb-cast' });
    entry.createDiv({ cls: 'ert-onb-warn', text: item.problem });
    if (actions.onContinue) entry.createDiv({ cls: 'ert-section-desc', text: `If you continue: ${item.ifImported}` });
  }
  if (actions.onContinue) {
    panel.createEl('hr', { cls: 'ert-onb-divider' });
    panel.createDiv({ cls: 'ert-section-desc', text: 'To fix it, select the same documents in Scrivener, export Files and Outliner Contents again, then choose Check again.' });
  }
  renderScrivenerExportHelp(panel);
  const row = container.createDiv({ cls: 'ert-modal-actions' });
  new ButtonComponent(row).setButtonText('Choose another export').onClick(actions.onChangeSource);
  const recheck = new ButtonComponent(row).setButtonText('Check again').onClick(actions.onRecheck);
  if (actions.onContinue) {
    new ButtonComponent(row).setButtonText('Continue anyway').setCta().onClick(actions.onContinue);
  } else {
    recheck.setCta();
  }
}

function encode(decision: ScrivenerFieldTarget): string {
  return decision.target === 'rt-key' ? `rt:${decision.key}` : decision.target;
}

function decode(value: string): ScrivenerFieldTarget {
  if (value.startsWith('rt:')) return { target: 'rt-key', key: value.slice(3) };
  return { target: value as 'custom' | 'ignore' | 'subplot-flag' | 'pov-character' }; // SAFE: the select's only other values are exactly these four
}

/** A field's target select: scene fields first, then the column's own options. */
function renderTargetSelect(parent: HTMLElement, field: string, decision: ScrivenerFieldTarget, onPick: (decision: ScrivenerFieldTarget) => void): void {
  const dropdown = new DropdownComponent(parent);
  const select = dropdown.selectEl;
  select.setAttribute('aria-label', `Where “${bareFieldName(field)}” goes`);
  const group = (label: string, options: Array<[value: string, text: string]>): void => {
    const optgroup = select.createEl('optgroup', { attr: { label } });
    for (const [value, text] of options) optgroup.createEl('option', { value, text });
  };
  const fieldOptions = (keys: readonly string[]): Array<[string, string]> => keys.map((key) => [`rt:${key}`, key]);
  group('Scene field', [
    ...fieldOptions(SCRIVENER_FIELD_TARGETS.timeline),
    ['pov-character', 'POV character (listed first in Character)'],
  ]);
  group('More scene fields', fieldOptions(SCRIVENER_FIELD_TARGETS.other));
  group('This column', [
    ['subplot-flag', `Subplot “${bareFieldName(field)}” for filled cells`],
    ['custom', `Keep as “${field}”`],
    ['ignore', 'Skip'],
  ]);
  dropdown.setValue(encode(decision)).onChange((value) => onPick(decode(value)));
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed;
}

export function renderScrivenerReview(container: HTMLElement, state: ScrivenerReviewState, host: ScrivenerReviewHost): void {
  container.empty();
  const scenes = flattenScenes(state.model);
  renderHeader(container, 'Review your import');
  renderSourceParts(container, [
    { label: 'Scenes', value: `${scenes.length} text file${scenes.length === 1 ? '' : 's'} in “${basename(state.book.sourceFolder)}”` },
    state.outlineName
      ? { label: 'Properties', value: `${state.outlineName}, the outline exported from your Scrivener project` }
      : { label: 'Properties', value: MISSING_OUTLINE_TEXT, warn: true },
    { label: 'Order', value: state.outlineName ? 'From the outline' : 'From the numbered file names' },
  ]);
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
    fieldPanel.createDiv({ cls: 'ert-section-title', text: 'Scene properties' });
    fieldPanel.createDiv({ cls: 'ert-section-desc', text: `Each column of ${state.outlineName ?? 'the outline'}, and where it goes in Radial Timeline.` });
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
          : `Creates “${destination}”.`
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
    const cast: Array<{ label: string; names: string[]; noun: string; on: boolean; set: (on: boolean) => void }> = [
      { label: 'Characters', names: summary.characters, noun: 'character', on: state.createCharacterNotes, set: (on) => { state.createCharacterNotes = on; } },
      { label: 'Places', names: summary.places, noun: 'place', on: state.createPlaceNotes, set: (on) => { state.createPlaceNotes = on; } },
    ];
    const named = cast.filter((item) => item.names.length > 0);
    if (named.length > 0) resultPanel.createEl('hr', { cls: 'ert-onb-divider' });
    for (const entry of named) {
      const row = resultPanel.createDiv({ cls: 'ert-onb-resultrow' });
      row.createSpan({ cls: 'ert-section-desc', text: entry.label });
      const value = row.createDiv({ cls: 'ert-stack ert-onb-cast' });
      value.createSpan({ text: nameList(entry.names) });
      const toggleRow = value.createDiv({ cls: 'ert-onb-check' });
      new ToggleComponent(toggleRow)
        .setValue(entry.on)
        .then((toggle) => toggle.toggleEl.setAttribute('aria-label', `Create a note for each ${entry.noun}`))
        .onChange((on) => {
          entry.set(on);
          host.onEdit();
        });
      toggleRow.createSpan({ cls: 'ert-section-desc', text: `Create a note for each ${entry.noun} (${entry.names.length})` });
    }

    resultPanel.createEl('hr', { cls: 'ert-onb-divider' });
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
