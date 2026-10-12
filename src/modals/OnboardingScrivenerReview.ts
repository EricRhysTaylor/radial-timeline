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
import { t, tCount } from '../i18n';

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
  help.createEl('summary', { text: t('ui.onboardingScrivenerReview.exportHelpSummary') });
  const steps = help.createEl('ol');
  steps.createEl('li', { text: t('ui.onboardingScrivenerReview.exportHelpStepFiles') });
  steps.createEl('li', { text: t('ui.onboardingScrivenerReview.exportHelpStepOutline') });
  steps.createEl('li', { text: t('ui.onboardingScrivenerReview.exportHelpStepVault') });
}

function renderHeader(container: HTMLElement, title: string, subtitle?: string): void {
  const header = container.createDiv({ cls: 'ert-modal-header' });
  header.createSpan({ cls: 'ert-modal-badge', text: t('ui.onboardingScrivenerReview.badge') });
  header.createDiv({ cls: 'ert-modal-title', text: title });
  if (subtitle) header.createDiv({ cls: 'ert-modal-subtitle', text: subtitle });
}

/** What an import without an outline CSV loses, and how to include it. */
export function missingOutlineText(): string {
  return t('ui.onboardingScrivenerReview.missingOutline');
}

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
  return names.length > 8 ? t('ui.onboardingScrivenerReview.nameListMore', { names: shown, count: names.length - 8 }) : shown;
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
    renderHeader(container, t('ui.onboardingScrivenerReview.checkExportTitle'), t('ui.onboardingScrivenerReview.checkExportSubtitle', { name }));
  } else {
    renderHeader(container, t('ui.onboardingScrivenerReview.nothingToImportTitle'), t('ui.onboardingScrivenerReview.nothingToImportSubtitle', { name }));
  }
  const panel = container.createDiv({ cls: 'ert-panel ert-stack' });
  for (const item of problems) {
    const entry = panel.createDiv({ cls: 'ert-stack ert-onb-cast' });
    entry.createDiv({ cls: 'ert-onb-warn', text: item.problem });
    if (actions.onContinue) entry.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingScrivenerReview.ifYouContinue', { consequence: item.ifImported }) });
  }
  if (actions.onContinue) {
    panel.createEl('hr', { cls: 'ert-onb-divider' });
    panel.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingScrivenerReview.fixHint') });
  }
  renderScrivenerExportHelp(panel);
  const row = container.createDiv({ cls: 'ert-modal-actions' });
  new ButtonComponent(row).setButtonText(t('ui.onboardingScrivenerReview.chooseAnotherExport')).onClick(actions.onChangeSource);
  const recheck = new ButtonComponent(row).setButtonText(t('ui.onboardingScrivenerReview.checkAgain')).onClick(actions.onRecheck);
  if (actions.onContinue) {
    new ButtonComponent(row).setButtonText(t('ui.onboardingScrivenerReview.continueAnyway')).setCta().onClick(actions.onContinue);
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
  select.setAttribute('aria-label', t('ui.onboardingScrivenerReview.targetAria', { field: bareFieldName(field) }));
  const group = (label: string, options: Array<[value: string, text: string]>): void => {
    const optgroup = select.createEl('optgroup', { attr: { label } });
    for (const [value, text] of options) optgroup.createEl('option', { value, text });
  };
  const fieldOptions = (keys: readonly string[]): Array<[string, string]> => keys.map((key) => [`rt:${key}`, key]);
  group(t('ui.onboardingScrivenerReview.groupSceneField'), [
    ...fieldOptions(SCRIVENER_FIELD_TARGETS.timeline),
    ['pov-character', t('ui.onboardingScrivenerReview.optionPovCharacter')],
  ]);
  group(t('ui.onboardingScrivenerReview.groupMoreSceneFields'), fieldOptions(SCRIVENER_FIELD_TARGETS.other));
  group(t('ui.onboardingScrivenerReview.groupThisColumn'), [
    ['subplot-flag', t('ui.onboardingScrivenerReview.optionSubplotFlag', { field: bareFieldName(field) })],
    ['custom', t('ui.onboardingScrivenerReview.optionKeepAs', { field })],
    ['ignore', t('ui.onboardingScrivenerReview.optionSkip')],
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
  renderHeader(container, t('ui.onboardingScrivenerReview.reviewTitle'));
  renderSourceParts(container, [
    { label: t('ui.onboardingScrivenerReview.sourceScenes'), value: t('ui.onboardingScrivenerReview.sourceScenesValue', { files: tCount('textFile', scenes.length), folder: basename(state.book.sourceFolder) }) },
    state.outlineName
      ? { label: t('ui.onboardingScrivenerReview.sourceProperties'), value: t('ui.onboardingScrivenerReview.sourcePropertiesValue', { outline: state.outlineName }) }
      : { label: t('ui.onboardingScrivenerReview.sourceProperties'), value: missingOutlineText(), warn: true },
    { label: t('ui.onboardingScrivenerReview.sourceOrder'), value: state.outlineName ? t('ui.onboardingScrivenerReview.orderFromOutline') : t('ui.onboardingScrivenerReview.orderFromFileNames') },
  ]);
  for (const warning of state.warnings) container.createDiv({ cls: 'ert-onb-warn', text: warning });

  // --- Book -----------------------------------------------------------------
  const bookPanel = container.createDiv({ cls: 'ert-panel ert-stack' });
  const bookRow = bookPanel.createDiv({ cls: 'ert-onb-bookrow' });
  const titleLabel = bookRow.createEl('label', { cls: 'ert-onb-field' });
  titleLabel.createSpan({ cls: 'ert-section-desc', text: t('ui.onboardingScrivenerReview.bookTitle') });
  new TextComponent(titleLabel)
    .setValue(state.book.title)
    .then((text) => text.inputEl.addClass('ert-input'))
    .onChange((value) => {
      state.book.title = value.trim();
      edited();
    });
  const stageLabel = bookRow.createEl('label', { cls: 'ert-onb-field' });
  stageLabel.createSpan({ cls: 'ert-section-desc', text: t('ui.onboardingScrivenerReview.stage') });
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
    fieldPanel.createDiv({ cls: 'ert-section-title', text: t('ui.onboardingScrivenerReview.scenePropertiesTitle') });
    fieldPanel.createDiv({
      cls: 'ert-section-desc',
      text: state.outlineName
        ? t('ui.onboardingScrivenerReview.scenePropertiesDesc', { outline: state.outlineName })
        : t('ui.onboardingScrivenerReview.scenePropertiesDescNoOutline'),
    });
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
      fieldPanel.createDiv({ cls: 'ert-section-desc', text: t('ui.onboardingScrivenerReview.notImported', { fields: skipped.map(bareFieldName).join(', ') }) });
    }
  }

  // --- Result (live) ---------------------------------------------------------
  const resultPanel = container.createDiv({ cls: 'ert-panel ert-stack' });
  const actions = container.createDiv({ cls: 'ert-modal-actions' });
  new ButtonComponent(actions).setButtonText(t('ui.onboardingScrivenerReview.chooseAnotherExport')).onClick(host.onChangeSource);
  new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(host.onCancel);
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
      !state.book.title ? t('ui.onboardingScrivenerReview.needTitle')
        : taken ? t('ui.onboardingScrivenerReview.folderTaken', { name: basename(destination) })
          : t('ui.onboardingScrivenerReview.createsDestination', { destination })
    );

    if (conflictsEl) {
      conflictsEl.empty();
      for (const key of mappingConflicts(state.mapping)) {
        conflictsEl.createDiv({ cls: 'ert-onb-warn', text: t('ui.onboardingScrivenerReview.mappingConflict', { field: key }) });
      }
    }

    const listWasOpen = resultPanel.querySelector('details')?.open === true;
    resultPanel.empty();
    resultPanel.createDiv({ cls: 'ert-section-title', text: t('ui.onboardingScrivenerReview.yourTimeline') });
    const subplotRow = resultPanel.createDiv({ cls: 'ert-onb-resultrow' });
    subplotRow.createSpan({ cls: 'ert-section-desc', text: t('ui.onboardingScrivenerReview.subplots') });
    const pills = subplotRow.createDiv({ cls: 'ert-onb-pills' });
    for (const subplot of summary.subplots) {
      pills.createSpan({ cls: 'ert-badgePill ert-badgePill--sm ert-onb-pill--subplot', text: `${subplot.name} ${subplot.scenes}` });
    }
    const actRow = resultPanel.createDiv({ cls: 'ert-onb-resultrow' });
    actRow.createSpan({ cls: 'ert-section-desc', text: t('ui.onboardingScrivenerReview.acts') });
    actRow.createSpan({
      text: result.actSource === 'column' ? t('ui.onboardingScrivenerReview.actsFromColumn')
        : result.actSource === 'folders' ? t('ui.onboardingScrivenerReview.actsFromFolders')
          : t('ui.onboardingScrivenerReview.actsSplitEvenly', { count: result.actCount }),
    });
    if (result.highestSourceAct > result.actCount) {
      resultPanel.createDiv({
        cls: 'ert-onb-warn',
        text: t('ui.onboardingScrivenerReview.actOverflow', { highest: result.highestSourceAct, count: result.actCount }),
      });
    }
    const cast: Array<{ label: string; names: string[]; toggleAria: string; toggleText: string; on: boolean; set: (on: boolean) => void }> = [
      {
        label: t('ui.onboardingScrivenerReview.characters'),
        names: summary.characters,
        toggleAria: t('ui.onboardingScrivenerReview.createCharacterNotes'),
        toggleText: t('ui.onboardingScrivenerReview.createCharacterNotesCount', { count: summary.characters.length }),
        on: state.createCharacterNotes,
        set: (on) => { state.createCharacterNotes = on; },
      },
      {
        label: t('ui.onboardingScrivenerReview.places'),
        names: summary.places,
        toggleAria: t('ui.onboardingScrivenerReview.createPlaceNotes'),
        toggleText: t('ui.onboardingScrivenerReview.createPlaceNotesCount', { count: summary.places.length }),
        on: state.createPlaceNotes,
        set: (on) => { state.createPlaceNotes = on; },
      },
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
        .then((toggle) => toggle.toggleEl.setAttribute('aria-label', entry.toggleAria))
        .onChange((on) => {
          entry.set(on);
          host.onEdit();
        });
      toggleRow.createSpan({ cls: 'ert-section-desc', text: entry.toggleText });
    }

    resultPanel.createEl('hr', { cls: 'ert-onb-divider' });
    const list = resultPanel.createEl('details', { cls: 'ert-onb-help' });
    list.open = listWasOpen;
    list.createEl('summary', { text: t('ui.onboardingScrivenerReview.showAllScenes', { count: summary.scenes }) });
    const rows = list.createDiv({ cls: 'ert-onb-scenelist' });
    result.proposals.forEach((proposal, index) => {
      const row = rows.createDiv({ cls: 'ert-onb-scenelist__row' });
      row.createSpan({ cls: 'ert-onb-scene__idx', text: String(index + 1).padStart(2, '0') });
      row.createSpan({ text: proposal.title });
      const subplots = proposal.frontmatter?.Subplot;
      row.createSpan({
        cls: 'ert-section-desc',
        text: t('ui.onboardingScrivenerReview.sceneRowMeta', { act: String(proposal.frontmatter?.Act), subplots: Array.isArray(subplots) ? subplots.join(', ') : '' }),
      });
    });

    importButton.setButtonText(t('ui.onboardingScrivenerReview.importScenes', { scenes: tCount('scene', summary.scenes) }));
    importButton.setDisabled(summary.scenes === 0 || taken || !state.book.title);
  }

  refresh();
}
