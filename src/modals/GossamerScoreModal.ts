/*
 * Gossamer Score Entry Modal - Manual entry of beat momentum scores
 */
import { Modal, App, ButtonComponent, Notice, TextComponent, TFile, TAbstractFile } from 'obsidian';
import { tooltip, tooltipForComponent } from '../utils/tooltip';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { buildDefaultAiSettings } from '../ai/settings/aiSettings';
import { validateAiSettings } from '../ai/settings/validateAiSettings';
import type { TimelineItem } from '../types';
import { clearAllGossamerData, clearGossamerRunSlot, collectGossamerManagedSnapshot, filterBeatsBySystem, GOSSAMER_LEGACY_FIELDS, normalizeBeatName, normalizeGossamerHistory } from '../utils/gossamer';
import { DEFAULT_GOSSAMER_SIGNAL, GOSSAMER_SIGNAL_METADATA, type GossamerSignalType } from '../types/gossamerSignals';
import { parseScoresAndJustifications, type ParsedBeatEntry } from '../GossamerCommands';
import { getSortedSceneFiles } from '../utils/manuscript';
import { buildGossamerEvidenceDocument } from '../gossamer/evidence/buildGossamerEvidence';
import { ensureManuscriptOutputFolder, resolveManuscriptOutputFolder } from '../utils/aiOutput';
import { buildExportFilename } from '../utils/exportFormats';
import { getPlotSystem } from '../utils/beatsSystems';
import { getActiveFrontmatterMappings, asBeatFrontmatter, readBeatPurpose } from '../utils/frontmatter';
import {
  resolveSelectedBeatModelFromSettings
} from '../utils/beatSystemState';
import { isPathInFolderScope } from '../utils/pathScope';
import { getActiveBookTitle } from '../utils/books';
import { comparePrefixTokens, extractPrefixToken } from '../utils/prefixOrder';
import { getActiveLoadedBeatTab } from '../storyBeats/workspaceState';
import { archiveGossamerFrontmatterFields } from '../gossamer/logs';

interface ScoreHistoryItem {
  index: number;
  value: number;
  justification?: string;
}

interface BeatScoreEntry {
  beatTitle: string; // Full title like "1 Opening Image" or "5 Theme Stated 5%"
  beatName: string; // Normalized name for matching
  currentScore?: number; // Latest score (highest Gossamer#)
  currentIndex?: number;
  currentJustification?: string;
  history: ScoreHistoryItem[]; // Older scores with their Gossamer numbers
  newScore?: number; // User-entered score
  newJustification?: string; // Populated by AI-response paste
  inputEl?: TextComponent;
  scoresToDelete: Set<number>; // Track which Gossamer fields to delete (1, 2, 3, etc.)
  scoreDisplayEl?: HTMLElement; // Reference to the scores display element
  range?: string; // Ideal range from beat note (e.g., "0-20", "60-70")
  description?: string; // Beat purpose from YAML (legacy Description supported)
  beatPath?: string;
}

interface NormalizationIssue {
  beatTitle: string;
  missingSlots: number[];
  orphanJustifications: number[];
  hasRenumbering: boolean;
  changed: boolean;
}

export class GossamerScoreModal extends Modal {
  private plugin: RadialTimelinePlugin;
  private plotBeats: TimelineItem[];
  private entries: BeatScoreEntry[] = [];
  // Internal name retained for local state continuity; controls inclusion of Beat Purpose text.
  private includeBeatDescriptions = false;
  /** Path of the most recent manuscript export during this modal session. */
  private lastManuscriptPath: string | null = null;
  private saveBtn?: ButtonComponent;

  private hasPendingChanges(): boolean {
    for (const entry of this.entries) {
      if (entry.newScore !== undefined) return true;
      if (entry.scoresToDelete.size > 0) return true;
    }
    return false;
  }

  private refreshSaveButtonState(): void {
    this.saveBtn?.setDisabled(!this.hasPendingChanges());
  }

  constructor(
    app: App,
    plugin: RadialTimelinePlugin,
    plotBeats: TimelineItem[]
  ) {
    super(app);
    this.plugin = plugin;
    this.plotBeats = plotBeats;
  }

  private async snapshotGossamerFields(files: TFile[], operation: string, meta: Record<string, unknown> = {}): Promise<string | null> {
    return archiveGossamerFrontmatterFields(this.app, files, {
      operation,
      selectFields: (frontmatter) => collectGossamerManagedSnapshot(frontmatter),
      meta: {
        scope: 'beat-note',
        ...meta
      }
    });
  }

  private analyzeNormalizationFrontmatter(frontmatter: Record<string, unknown>, beatTitle: string): NormalizationIssue {
    const maxHistory = 30;
    const missingSlots: number[] = [];
    const orphanJustifications: number[] = [];
    const indices: number[] = [];

    for (let i = 1; i <= maxHistory; i++) {
      const scoreKey = `Gossamer${i}`;
      const justKey = `Gossamer${i} Justification`;
      const rawScore = frontmatter[scoreKey];
      const rawJustification = frontmatter[justKey];
      let numeric: number | undefined;

      if (typeof rawScore === 'number') {
        numeric = rawScore;
      } else if (typeof rawScore === 'string') {
        const parsed = parseInt(rawScore);
        if (!Number.isNaN(parsed)) numeric = parsed;
      }

      if (numeric !== undefined) {
        indices.push(i);
      } else if (typeof rawJustification === 'string' && rawJustification.trim().length > 0) {
        orphanJustifications.push(i);
      }
    }

    let hasRenumbering = false;
    let expectedIndex = 1;
    for (const idx of indices) {
      if (idx !== expectedIndex) {
        hasRenumbering = true;
        while (expectedIndex < idx) {
          missingSlots.push(expectedIndex);
          expectedIndex++;
        }
      }
      expectedIndex = idx + 1;
    }

    const changed = hasRenumbering || orphanJustifications.length > 0;
    return { beatTitle, missingSlots, orphanJustifications, hasRenumbering, changed };
  }

  /**
   * Reveal the most recent manuscript export in Obsidian's file explorer.
   * Falls back to the export folder when no file has been written this session,
   * and shows a Notice if the file explorer sidebar isn't open.
   */
  private async revealManuscriptInVault(): Promise<void> {
    let target: TAbstractFile | null = null;
    if (this.lastManuscriptPath) {
      target = this.plugin.app.vault.getAbstractFileByPath(this.lastManuscriptPath);
    }
    if (!target) {
      const folderPath = resolveManuscriptOutputFolder(this.plugin);
      target = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    }
    if (!target) {
      new Notice(t('gossamer.scoreModal.exportFolderMissing'));
      return;
    }
    const explorerLeaf = this.plugin.app.workspace.getLeavesOfType('file-explorer')[0];
    if (!explorerLeaf) {
      new Notice(t('gossamer.scoreModal.openExplorerSidebar'));
      return;
    }
    const explorerView = explorerLeaf.view as unknown as { revealInFolder?: (node: TAbstractFile) => void };
    if (!explorerView.revealInFolder) {
      new Notice(t('gossamer.scoreModal.explorerNoReveal'));
      return;
    }
    explorerView.revealInFolder(target);
    void this.plugin.app.workspace.revealLeaf(explorerLeaf);
  }

  /** Cheap check: does any in-scope Beat note have at least one slot tagged with the active signal? */
  private hasSignalScores(signal: GossamerSignalType): boolean {
    const sourcePath = this.plugin.settings.sourcePath || '';
    const allFiles = this.plugin.app.vault.getMarkdownFiles();
    const files = sourcePath
      ? allFiles.filter(f => isPathInFolderScope(f.path, sourcePath))
      : allFiles;
    for (const file of files) {
      const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      if (fm.Class !== 'Beat' && fm.class !== 'Beat') continue;
      for (let i = 1; i <= 30; i++) {
        if (fm[`Gossamer${i}`] === undefined) continue;
        const raw = fm[`GossamerSignal${i}`];
        const slotSignal = typeof raw === 'string' && raw.trim().length > 0
          ? raw.trim().toLowerCase()
          : 'momentum';
        if (slotSignal === signal) return true;
      }
    }
    return false;
  }

  /** True if any beat carries Gossamer data of any signal (or legacy fields). */
  private hasAnyGossamerData(): boolean {
    const sourcePath = this.plugin.settings.sourcePath || '';
    const allFiles = this.plugin.app.vault.getMarkdownFiles();
    const files = sourcePath
      ? allFiles.filter(f => isPathInFolderScope(f.path, sourcePath))
      : allFiles;
    for (const file of files) {
      const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      if (fm.Class !== 'Beat' && fm.class !== 'Beat') continue;
      for (let i = 1; i <= 30; i++) {
        if (fm[`Gossamer${i}`] !== undefined) return true;
      }
      for (const key of GOSSAMER_LEGACY_FIELDS) {
        if (fm[key] !== undefined) return true;
      }
    }
    return false;
  }

  /** Scan beat notes for any normalization-worthy issues. Cheap — reads metadata cache. */
  private collectNormalizationIssues(): NormalizationIssue[] {
    const issues: NormalizationIssue[] = [];
    for (const beat of this.plotBeats) {
      if (!beat.path) continue;
      const file = this.plugin.app.vault.getAbstractFileByPath(beat.path);
      if (!file || !(file instanceof TFile)) continue;

      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const analysis = this.analyzeNormalizationFrontmatter(fm, beat.title || beat.path);
      if (analysis.changed) issues.push(analysis);
    }
    return issues;
  }

  private async normalizeAllScores(): Promise<void> {
    const beatsToNormalize = this.plotBeats.filter(beat => beat.path);
    const normalizationIssues = this.collectNormalizationIssues();
    if (normalizationIssues.length === 0) {
      new Notice(t('gossamer.scoreModal.normalizeNothing'));
      return;
    }

    const confirmMessage = t('gossamer.scoreModal.normalizeConfirmMessage', {
      count: normalizationIssues.length,
      plural: normalizationIssues.length === 1 ? '' : 's'
    });

    new NormalizeConfirmationModal(
      this.app,
      confirmMessage,
      normalizationIssues,
      () => { void (async () => {
        let changedCount = 0;
        const filesToSnapshot = beatsToNormalize
          .map((beat) => beat.path ? this.plugin.app.vault.getAbstractFileByPath(beat.path) : null)
          .filter((file): file is TFile => !!file && file instanceof TFile);
        const snapshotPath = await this.snapshotGossamerFields(filesToSnapshot, 'gossamer-normalize', {
          beatCount: filesToSnapshot.length
        });

        for (const beat of beatsToNormalize) {
          if (!beat.path) continue;
          const file = this.plugin.app.vault.getAbstractFileByPath(beat.path);
          if (!file || !(file instanceof TFile)) continue;

          await this.plugin.app.fileManager.processFrontMatter(file, (yaml: Record<string, unknown>) => {
            const fm = yaml;
            const { normalized, changed } = normalizeGossamerHistory(fm);
            if (changed) {
              changedCount++;
              for (let i = 1; i <= 40; i++) {
                clearGossamerRunSlot(fm, i);
              }
              Object.assign(fm, normalized);
            }
          });
        }

        if (changedCount > 0) {
          const parts = [t('gossamer.scoreModal.normalizedDone', { count: changedCount, plural: changedCount === 1 ? '' : 's' })];
          if (snapshotPath) parts.push(t('gossamer.scoreModal.normalizeArchive', { path: snapshotPath }));
          new Notice(parts.join(' '));
          this.close();
          const refreshed = new GossamerScoreModal(this.app, this.plugin, this.plotBeats);
          refreshed.open();
        } else {
          new Notice(t('gossamer.scoreModal.normalizeNoFragments'));
        }
      })(); }
    ).open();
  }

  // Helper to create Lucide circle-x SVG icon
  private createCircleXIcon(): SVGElement {
    const doc = this.contentEl.ownerDocument;
    const svg = doc.win.createSvg('svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const circle = doc.win.createSvg('circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    circle.setAttribute('stroke-width', '2');
    svg.appendChild(circle);

    const line1 = doc.win.createSvg('line');
    line1.setAttribute('x1', '15');
    line1.setAttribute('y1', '9');
    line1.setAttribute('x2', '9');
    line1.setAttribute('y2', '15');
    svg.appendChild(line1);

    const line2 = doc.win.createSvg('line');
    line2.setAttribute('x1', '9');
    line2.setAttribute('y1', '9');
    line2.setAttribute('x2', '15');
    line2.setAttribute('y2', '15');
    svg.appendChild(line2);

    return svg;
  }


  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Set modal width using new generic system
    if (modalEl) {
      modalEl.setCssStyles({ width: '980px', maxWidth: '98vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
      modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
    }

    contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-gossamer-score-modal');

    const selectedBeatModel = resolveSelectedBeatModelFromSettings(this.plugin.settings);
    const settingsSystem = selectedBeatModel ?? '';
    const beatModelLabel = selectedBeatModel ?? 'No active beat system selected';
    
    // ... filtering logic ...

    // Filter beats based on settings (same logic as main.ts getSceneData)
    // Need to read Beat Model from metadata cache since it's not on Scene object
    const beatsWithModel = this.plotBeats.map((beat) => {
      if (!beat.path) {
        return { beat, "Beat Model": undefined as string | undefined };
      }
      const file = this.plugin.app.vault.getAbstractFileByPath(beat.path);
      if (!(file instanceof TFile)) {
        return { beat, "Beat Model": undefined as string | undefined };
      }
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      return { beat, "Beat Model": fm?.["Beat Model"] as string | undefined };
    });
    const filteredBeats = filterBeatsBySystem(
      beatsWithModel,
      selectedBeatModel
    ).map(entry => entry.beat);

    // Use filtered beats for entry building
    this.plotBeats = filteredBeats;

    let plotSystemTemplate = getPlotSystem(settingsSystem);
    
    // Support active workspace systems that do not map to canonical presets.
    const activeTab = getActiveLoadedBeatTab(this.plugin.settings);
    if (!plotSystemTemplate && activeTab?.beats.length) {
        const customName = activeTab.name;
        plotSystemTemplate = {
            name: customName,
            category: 'blank',
            icon: 'square',
            beats: activeTab.beats.map(b => b.name),
            beatDetails: activeTab.beats.map(b => ({ name: b.name, description: '', range: '' })),
            beatCount: activeTab.beats.length
        };
    }

    // Validate beat count (only when template exists)
    const actualCount = filteredBeats.length;
    const countMismatch = plotSystemTemplate ? actualCount !== (plotSystemTemplate.beatCount || plotSystemTemplate.beats.length) : false;

    // Validate Range fields (filter by beat system but ignore title matching)
    // NOTE: Temporarily disabled - metadata cache not refreshing Range field
    // const rangeValidation = validateBeatRanges(filteredBeats, settingsSystem);

    // Title with plot system name rendered in hero card
    const activeSignal: GossamerSignalType = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
    const signalMeta = GOSSAMER_SIGNAL_METADATA[activeSignal];
    const headerEl = contentEl.createDiv({ cls: 'ert-modal-header' });
    const bookTitle = getActiveBookTitle(this.plugin.settings);
    const badgeParts = [t('gossamer.scoreModal.badgePrefix', { signal: signalMeta.label.toLowerCase() }), bookTitle].filter(Boolean);
    headerEl.createSpan({ text: badgeParts.join(' · '), cls: 'ert-modal-badge' });
    headerEl.createDiv({ text: t('gossamer.scoreModal.beatSystemTitle', { label: beatModelLabel }), cls: 'ert-modal-title' });
    const heroSubtitle = headerEl.createDiv({ cls: 'ert-modal-subtitle' });
    heroSubtitle.setText(t('gossamer.scoreModal.subtitle', { signal: signalMeta.label.toLowerCase() }));
    const heroMeta = headerEl.createDiv({ cls: 'ert-modal-meta' });
    heroMeta.createSpan({ text: t('gossamer.scoreModal.signalMeta', { label: signalMeta.label }), cls: 'ert-modal-meta-item' });
    heroMeta.createSpan({ text: t('gossamer.scoreModal.beatsDetectedMeta', { count: actualCount }), cls: 'ert-modal-meta-item' });

    // Show warning if no beats match
    if (actualCount === 0) {
      const noBeatsWarning = contentEl.createDiv({
        text: !selectedBeatModel
          ? t('gossamer.scoreModal.noActiveBeatSystem', { signal: signalMeta.label.toLowerCase() })
          : settingsSystem === 'Custom'
          ? t('gossamer.scoreModal.noBeatsCustom', { label: beatModelLabel })
          : t('gossamer.scoreModal.noBeatsForModel', { label: beatModelLabel })
      });
      noBeatsWarning.addClass('ert-gossamer-warning');
    } else if (countMismatch && plotSystemTemplate) {
      const warningEl = contentEl.createDiv({
        text: t('gossamer.scoreModal.countMismatch', { expected: plotSystemTemplate.beatCount, label: beatModelLabel, actual: actualCount })
      });
      warningEl.addClass('ert-gossamer-warning');
    }

    // Range validation warning disabled - metadata cache issue
    // if (!rangeValidation.valid && rangeValidation.missingRangeBeats.length > 0) {
    //   const rangeWarningEl = contentEl.createEl('div');
    //   rangeWarningEl.addClass('ert-gossamer-warning');
    //   
    //   const count = rangeValidation.missingRangeBeats.length;
    //   const beatList = rangeValidation.missingRangeBeats.slice(0, 3).join(', ');
    //   const more = count > 3 ? `, and ${count - 3} more` : '';
    //   
    //   rangeWarningEl.setText(
    //     `⚠️ ${count} beat${count > 1 ? 's' : ''} missing ideal Range (e.g., "0-20", "71-90"): ${beatList}${more}. ` +
    //     `Add "Range: 0-20" to beat note frontmatter. Scores outside ideal range will show thicker red y-axis spokes.`
    //   );
    // }

    // Scrollable list of beat scores
    const scoresContainer = contentEl.createDiv('ert-gossamer-score-container');

    // Build entries from plot beats
    this.buildEntries();

    // Render each beat entry
    this.entries.forEach((entry, index) => {
      const entryDiv = scoresContainer.createDiv('ert-gossamer-score-entry');

      // First row: Beat title, justification, and new score input
      const firstRow = entryDiv.createDiv('ert-gossamer-score-row');

      // 1. Left side: Beat title with range
      const titleContainer = firstRow.createDiv('ert-gossamer-beat-title-container');
      const beatTitleEl = titleContainer.createSpan({ text: entry.beatTitle });
      beatTitleEl.addClass('ert-gossamer-beat-title');

      if (entry.range) {
        const rangeEl = titleContainer.createSpan({ text: ` (${entry.range})` });
        rangeEl.addClass('ert-gossamer-beat-range');
      }

      // 2. Middle: Beat Purpose (primary context) + latest justification (secondary)
      const justificationContainer = firstRow.createDiv('ert-gossamer-justification-container');
      if (entry.description && entry.description.trim().length > 0) {
        const purposeEl = justificationContainer.createDiv('ert-gossamer-beat-purpose');
        purposeEl.setText(entry.description.trim());
      }
      if (entry.currentJustification) {
        const currentNote = justificationContainer.createDiv('ert-gossamer-current-justification');
        currentNote.setText(`Latest: ${entry.currentJustification}`);
      }

      // 3. Right side: New score input
      const inputContainer = firstRow.createDiv('ert-gossamer-input-container');
      const inputLabel = inputContainer.createSpan({ text: t('gossamer.scoreModal.enterScoreLabel') });
      inputLabel.addClass('ert-gossamer-input-label');

      entry.inputEl = new TextComponent(inputContainer);
      entry.inputEl.inputEl.addClass('ert-gossamer-score-input');
      entry.inputEl.setPlaceholder(t('gossamer.scoreModal.scorePlaceholder'));

      // Validate on input
      entry.inputEl.onChange((value) => {
        const num = parseInt(value);
        if (!isNaN(num) && num >= 0 && num <= 100) {
          entry.newScore = num;
          entry.inputEl?.inputEl.removeClass('ert-input-error');
        } else if (value.trim().length > 0) {
          entry.inputEl?.inputEl.addClass('ert-input-error');
          entry.newScore = undefined;
        } else {
          entry.inputEl?.inputEl.removeClass('ert-input-error');
          entry.newScore = undefined;
        }
        this.refreshSaveButtonState();
      });

      // Second row: Existing scores with delete buttons
      const secondRow = entryDiv.createDiv('ert-gossamer-scores-history-row');
      const existingScoresEl = secondRow.createDiv('ert-gossamer-existing-scores-container');
      entry.scoreDisplayEl = existingScoresEl;

      const renderScores = () => {
        existingScoresEl.empty();

        const createScoreCard = (gossamerNum: number, score: number, justification?: string) => {
          const scoreContainer = existingScoresEl.createDiv();
          scoreContainer.addClass('ert-gossamer-score-item-container');
          scoreContainer.setAttribute('data-gossamer-num', gossamerNum.toString());

          // Header row: Icon + Label + Value (Centered)
          const headerRow = scoreContainer.createDiv('ert-gossamer-score-header');

          const iconColumn = headerRow.createDiv();
          iconColumn.addClass('ert-gossamer-icon-column');
          iconColumn.appendChild(this.createCircleXIcon());

          headerRow.createSpan({
            text: `G${gossamerNum}`,
            cls: 'ert-gossamer-score-label'
          });
          
          headerRow.createSpan({
            text: `${score}`,
            cls: 'ert-gossamer-score-value'
          });

          // Body row: Justification (Full width)
          if (justification) {
            const justEl = scoreContainer.createDiv({
              text: justification,
              cls: 'ert-gossamer-score-justification'
            });
            tooltip(justEl, justification, 'bottom');
          }

          scoreContainer.addEventListener('click', () => {
            entry.scoresToDelete.add(gossamerNum);
            renderScores();
            this.refreshSaveButtonState();
          });
        };

        // Count total scores to display
        const totalScores =
          (entry.currentScore !== undefined &&
            entry.currentIndex !== undefined &&
            !entry.scoresToDelete.has(entry.currentIndex) ? 1 : 0) +
          entry.history.filter(item => !entry.scoresToDelete.has(item.index)).length;

        // Existing scores oldest → newest
        entry.history.forEach(item => {
          if (entry.scoresToDelete.has(item.index)) return;
          createScoreCard(item.index, item.value, item.justification);
        });

        if (entry.currentScore !== undefined &&
          entry.currentIndex !== undefined &&
          !entry.scoresToDelete.has(entry.currentIndex)) {
          createScoreCard(entry.currentIndex, entry.currentScore, entry.currentJustification);
        }

        // Add count indicator if there are many scores
        if (totalScores > 10) {
          existingScoresEl.createSpan({
            text: t('gossamer.scoreModal.scoreCount', { count: totalScores }),
            cls: 'ert-gossamer-score-count'
          });
        }
      };

      renderScores();
    });


    // Footer: three groups — Maintenance | AI workflow | Commit cluster
    const activeSignalLabel = signalMeta.label;
    const footer = contentEl.createDiv({ cls: 'ert-gossamer-footer' });

    // Group 1: Maintenance (bordered container — demoted, rarely used)
    const maintenanceGroup = footer.createDiv({ cls: 'ert-gossamer-footer__group ert-gossamer-footer__group--maintenance' });
    maintenanceGroup.createSpan({ text: t('gossamer.scoreModal.groupMaintenance'), cls: 'ert-gossamer-footer__group-label' });
    const maintenanceRow = maintenanceGroup.createDiv({ cls: 'ert-row' });
    const hasNormalizationWork = this.collectNormalizationIssues().length > 0;
    const normalizeBtn = new ButtonComponent(maintenanceRow)
      .setButtonText(t('gossamer.scoreModal.normalizeButton'))
      .setDisabled(!hasNormalizationWork)
      .onClick(async () => {
        await this.normalizeAllScores();
      });

    const hasDeletableScores = this.hasSignalScores(activeSignal);
    const deleteBtn = new ButtonComponent(maintenanceRow)
      .setButtonText(t('gossamer.scoreModal.deleteButton', { label: activeSignalLabel }))
      .setDisabled(!hasDeletableScores)
      .onClick(async () => {
        await this.deleteAllScores();
      });
    // Outline-only danger treatment; only the red border is overridden so the
    // theme's native hover/focus styles still apply.
    deleteBtn.buttonEl.classList.add('ert-gossamer-btn-danger-outline');

    // Full reset — wipes every signal's runs plus legacy fields, returning the
    // book's beats to a clean slate. Enabled whenever any Gossamer data exists.
    const hasAnyGossamerData = this.hasAnyGossamerData();
    const deleteAllBtn = new ButtonComponent(maintenanceRow)
      .setButtonText(t('gossamer.scoreModal.deleteAllButton'))
      .setDisabled(!hasAnyGossamerData)
      .onClick(async () => {
        await this.deleteAllGossamerData();
      });
    deleteAllBtn.buttonEl.classList.add('ert-gossamer-btn-danger-outline');

    // Group 2: AI workflow (bordered container — primary path; both workflow
    // actions live here so Copy → Paste reads as one continuous workflow.)
    const aiGroup = footer.createDiv({ cls: 'ert-gossamer-footer__group ert-gossamer-footer__group--ai' });
    aiGroup.createSpan({ text: t('gossamer.scoreModal.groupAi'), cls: 'ert-gossamer-footer__group-label' });
    const aiRow = aiGroup.createDiv({ cls: 'ert-row' });
    // Neither Copy nor Paste use setCta(): the CTA class forces taller padding
    // than regular footer buttons, visually "distorting" them relative to Save
    // scores / Cancel. The bordered AI workflow container already signals that
    // these are the primary workflow actions.
    const copyBtn = new ButtonComponent(aiRow)
      .setButtonText(t('gossamer.scoreModal.copyButton'))
      .onClick(async () => {
        const ok = await this.copyFullAIPrompt(null);
        if (ok) copyBtn.buttonEl.classList.add('ert-gossamer-copy-success');
      });
    const pasteBtn = new ButtonComponent(aiRow)
      .setButtonText(t('gossamer.scoreModal.pasteButton'))
      .onClick(async () => {
        const result = await this.pasteFromClipboard();
        this.flashPasteResult(pasteBtn.buttonEl, result);
        if (result.ok) {
          // Paste IS the commit in this flow — save immediately so user isn't
          // stuck wondering which button to press next.
          await this.saveScores('clipboard-paste');
        }
      });
    const aiMeta = aiGroup.createDiv({ cls: 'ert-gossamer-footer__meta' });
    aiMeta.createSpan({ text: t('gossamer.scoreModal.aiMetaPrefix') });
    const vaultLink = aiMeta.createEl('a', {
      text: t('gossamer.scoreModal.aiMetaVaultLink'),
      cls: 'ert-gossamer-footer__vault-link',
      attr: { href: '#', role: 'button', tabindex: '0' }
    });
    vaultLink.addEventListener('click', (event) => {
      event.preventDefault();
      void this.revealManuscriptInVault();
    });
    aiMeta.createSpan({ text: t('gossamer.scoreModal.aiMetaSuffix', { count: this.entries.length, label: activeSignalLabel }) });

    // Group 3: Commit cluster (standard dialog actions) — Save (primary) then Cancel.
    const commitGroup = footer.createDiv({ cls: 'ert-gossamer-footer__commit' });
    const saveBtn = new ButtonComponent(commitGroup)
      .setButtonText(t('gossamer.scoreModal.saveButton'))
      .setDisabled(true)
      .onClick(async () => {
        await this.saveScores();
      });
    this.saveBtn = saveBtn;
    const cancelBtn = new ButtonComponent(commitGroup)
      .setButtonText(t('gossamer.scoreModal.cancelButton'))
      .onClick(() => this.close());

    // Tooltips (Delete button omitted — its label already says what it does).
    tooltipForComponent(
      normalizeBtn,
      hasNormalizationWork
        ? t('gossamer.scoreModal.tooltipNormalizeAvailable')
        : t('gossamer.scoreModal.tooltipNormalizeNone'),
      'top'
    );
    tooltipForComponent(copyBtn, t('gossamer.scoreModal.tooltipCopy'), 'top');
    tooltipForComponent(pasteBtn, t('gossamer.scoreModal.tooltipPaste'), 'top');
    tooltipForComponent(saveBtn, t('gossamer.scoreModal.tooltipSave'), 'top');
    tooltipForComponent(cancelBtn, t('gossamer.scoreModal.tooltipCancel'), 'top');
  }

  /** Flash the paste button green on valid response, red on invalid. */
  private flashPasteResult(btnEl: HTMLElement, result: { ok: boolean; matchCount: number; expected: number; reason?: string }): void {
    btnEl.classList.remove('ert-gossamer-paste-success', 'ert-gossamer-paste-error');
    void btnEl.offsetWidth; // reset animation
    if (result.ok) {
      btnEl.classList.add('ert-gossamer-paste-success');
      if (result.matchCount < result.expected) {
        new Notice(t('gossamer.scoreModal.pastePartial', { matched: result.matchCount, expected: result.expected }));
      } else {
        new Notice(t('gossamer.scoreModal.pasteSuccess', { matched: result.matchCount }));
      }
    } else {
      btnEl.classList.add('ert-gossamer-paste-error');
      new Notice(t('gossamer.scoreModal.pasteError', { reason: result.reason ?? 'Clipboard format not recognized.' }));
    }
    window.setTimeout(() => {
      btnEl.classList.remove('ert-gossamer-paste-success', 'ert-gossamer-paste-error');
    }, 1500);
  }

  private buildEntries(): void {
    const activeSignal: GossamerSignalType = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;

    // Sort plot beats by filename prefix using natural token ordering.
    const sortedBeats = [...this.plotBeats].sort((a, b) => {
      const aPrefix = extractPrefixToken(a.title || '');
      const bPrefix = extractPrefixToken(b.title || '');
      const prefixCmp = comparePrefixTokens(aPrefix, bPrefix);
      if (prefixCmp !== 0) return prefixCmp;
      return (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' });
    });

    for (const beat of sortedBeats) {
      if (!beat.title || !beat.path) continue;

      // Get metadata from cache
      const file = this.plugin.app.vault.getAbstractFileByPath(beat.path);
      if (!(file instanceof TFile)) continue;

      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const fm = asBeatFrontmatter(cache?.frontmatter);
      // rawFm is retained for the dynamic Gossamer<N> / Score<N> sweep below —
      // those keys are accessed by computed name (`Gossamer${i}`), not by literal,
      // so the BeatFrontmatter type guard doesn't apply to them.
      const rawFm = cache?.frontmatter;

      const entry: BeatScoreEntry = {
        beatTitle: beat.title,
        beatName: normalizeBeatName(beat.title),
        beatPath: beat.path,
        history: [],
        scoresToDelete: new Set<number>()
      };

      if (fm) {
        if (typeof fm.Range === 'string') {
          entry.range = fm.Range;
        }
        const purpose = readBeatPurpose(fm);
        if (purpose !== undefined) {
          entry.description = purpose;
        }

        const scores: ScoreHistoryItem[] = [];
        let hasAnyScores = false;
        for (let i = 1; i <= 30; i++) {
          const key = `Gossamer${i}`;
          const value = rawFm?.[key];
          let numeric: number | undefined;
          if (typeof value === 'number') {
            numeric = value;
          } else if (typeof value === 'string') {
            const parsed = parseInt(value);
            if (!isNaN(parsed)) numeric = parsed;
          }

          if (numeric !== undefined) {
            // Only include slots whose signal matches the active signal.
            // Missing signal field = momentum (legacy runs).
            const rawSignal = rawFm?.[`GossamerSignal${i}`];
            const slotSignal = typeof rawSignal === 'string' && rawSignal.trim().length > 0
              ? rawSignal.trim().toLowerCase()
              : 'momentum';
            if (slotSignal !== activeSignal) continue;

            hasAnyScores = true;
            const justificationKey = `Gossamer${i} Justification`;
            const justificationValue = rawFm?.[justificationKey];
            scores.push({ index: i, value: numeric });
            if (typeof justificationValue === 'string' && justificationValue.trim().length > 0) {
              scores[scores.length - 1].justification = justificationValue;
            }
          } else {
            const orphanJustKey = `Gossamer${i} Justification`;
            if (typeof rawFm?.[orphanJustKey] === 'string') {
              // Remove orphaned justification entries (handled during cleanup)
            }
          }
        }

        if (hasAnyScores && scores.length > 0) {
          const latest = scores[scores.length - 1];
          entry.currentScore = latest.value;
          entry.currentIndex = latest.index;
          entry.currentJustification = latest.justification;
          entry.history = scores.slice(0, -1);
        }
      }

      this.entries.push(entry);
    }
  }

  /**
   * Assemble the full AI prompt: role + signal rubric + beat list (with
   * Purpose / Range) + full manuscript + output format. One clipboard blob
   * that a user can paste into any external LLM; the response can be pasted
   * back via the Paste AI response button.
   */
  private async copyFullAIPrompt(meta: { sceneCount: number; wordCount: number } | null): Promise<boolean> {
    try {
      const settingsSystem = resolveSelectedBeatModelFromSettings(this.plugin.settings);
      if (!settingsSystem) {
        new Notice(t('gossamer.scoreModal.noBookSystem'));
        return false;
      }
      if (this.entries.length === 0) {
        new Notice(t('gossamer.scoreModal.noBeatsAvailable'));
        return false;
      }

      const { name: contextTemplateName, prompt: contextPrompt } = this.getActiveAiContextInfo();
      const activeSignal: GossamerSignalType = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
      const signalMeta = GOSSAMER_SIGNAL_METADATA[activeSignal];

      // Gather manuscript evidence (same as automated flow)
      const { files: sceneFiles } = await getSortedSceneFiles(this.plugin);
      if (sceneFiles.length === 0) {
        new Notice(t('gossamer.scoreModal.noScenesInBook'));
        return false;
      }
      const evidenceDocument = await buildGossamerEvidenceDocument({
        sceneFiles,
        vault: this.plugin.app.vault,
        metadataCache: this.plugin.app.metadataCache,
        frontmatterMappings: getActiveFrontmatterMappings(this.plugin.settings)
      });
      if (!evidenceDocument.text || evidenceDocument.text.trim().length === 0) {
        new Notice(t('gossamer.scoreModal.manuscriptEmpty'));
        return false;
      }

      const lines: string[] = [];
      lines.push(`# Gossamer ${signalMeta.label} Analysis — ${settingsSystem}`);
      lines.push('');

      // Role / context
      if (contextPrompt) {
        lines.push('## Role');
        if (contextTemplateName) lines.push(`Template: ${contextTemplateName}`);
        lines.push(contextPrompt.trim());
        lines.push('');
      }

      // Signal-specific scoring rubric
      lines.push(`## ${signalMeta.label} Scoring Rubric`);
      lines.push(signalMeta.promptBlock);
      lines.push('');

      // Beat list — Purpose only. DO NOT include ideal ranges here: they would
      // anchor the LLM's scoring toward canonical targets and contaminate the
      // fresh-eyes judgment. Ranges are used only internally (display, audit).
      // Beat titles already carry a filename prefix that encodes manuscript position
      // (e.g. "1.01 Ordinary World", "10.01 Call to Adventure"). No outer enumeration.
      lines.push(`## Story Beats (${settingsSystem})`);
      lines.push('Score each beat in the order listed below. Keep your response in the same order.');
      lines.push('');
      const missingPurposeBeats: string[] = [];
      this.entries.forEach((entry) => {
        lines.push(entry.beatTitle);
        if (entry.description && entry.description.trim().length > 0) {
          lines.push(`Purpose: ${entry.description.trim()}`);
        } else {
          missingPurposeBeats.push(entry.beatTitle);
        }
        lines.push('');
      });

      // Tell the LLM the manuscript comes in as an attached file (the user will
      // upload the file saved below). This keeps the pastable prompt small.
      lines.push('## Manuscript');
      lines.push('The full manuscript is provided as a separate attached file (upload). Score each beat based on the content of that file.');
      lines.push('');

      // Output format — pipe-delimited with justification
      lines.push('## Response Format');
      lines.push(`Return **only** the block below, one line per beat in the original order. Use pipe (\`|\`) delimiters with no extra commentary before or after:`);
      lines.push('');
      lines.push('```');
      lines.push('Beat Name | score (0-100) | one short sentence justification');
      lines.push('```');
      lines.push('');
      lines.push('Example:');
      lines.push('```');
      lines.push(`${this.entries[0]?.beatTitle ?? 'Opening Image'} | 35 | Establishes the protagonist's status quo with quiet unease.`);
      lines.push('```');
      lines.push('');

      const prompt = lines.join('\n');

      // Save the manuscript to the vault so the user can attach it as a file
      // to the LLM chat. Pasting a 90k-word manuscript into a chat input
      // exceeds every mainstream LLM's single-message limit, so we don't try.
      // Use the shared manuscript export path + filename convention so these
      // land alongside regular manuscript exports.
      const manuscriptFolder = await ensureManuscriptOutputFolder(this.plugin);
      const manuscriptFilename = buildExportFilename({
        exportType: 'manuscript',
        order: 'narrative',
        manuscriptPreset: 'novel',
        extension: 'md'
      });
      const manuscriptPath = `${manuscriptFolder}/${manuscriptFilename}`;
      const manuscriptFile = await this.plugin.app.vault.create(manuscriptPath, evidenceDocument.text);
      this.lastManuscriptPath = manuscriptPath;

      // Copy the small prompt (no manuscript body) to the clipboard.
      await navigator.clipboard.writeText(prompt);

      // Open the manuscript file in a new tab so the user can find it in their
      // vault folder and upload it to the LLM.
      const leaf = this.plugin.app.workspace.getLeaf('tab');
      await leaf.openFile(manuscriptFile);

      const sceneLabel = meta?.sceneCount ?? evidenceDocument.totalScenes;
      const wordLabel = (meta?.wordCount ?? evidenceDocument.totalWords).toLocaleString();
      new Notice(
        t('gossamer.scoreModal.promptCopied', { path: manuscriptPath, scenes: sceneLabel, words: wordLabel }),
        10000
      );

      if (missingPurposeBeats.length > 0) {
        this.showMetadataWarning('Purpose', missingPurposeBeats);
      }
      return true;
    } catch (error) {
      console.error('[Gossamer] Failed to copy AI prompt:', error);
      new Notice(t('gossamer.scoreModal.promptCopyFailed'));
      return false;
    }
  }

  /**
   * Read clipboard, parse as AI response (pipe-delimited preferred, with
   * fallback to legacy score-only formats), and populate the modal entries.
   * Returns a result object the caller can use to flash the paste button.
   */
  private async pasteFromClipboard(): Promise<{ ok: boolean; matchCount: number; expected: number; reason?: string }> {
    let clipboard = '';
    try {
      clipboard = await navigator.clipboard.readText();
    } catch {
      return { ok: false, matchCount: 0, expected: this.entries.length, reason: t('gossamer.scoreModal.clipboardReadFailed') };
    }
    if (!clipboard || clipboard.trim().length === 0) {
      return { ok: false, matchCount: 0, expected: this.entries.length, reason: t('gossamer.scoreModal.clipboardEmpty') };
    }

    const parsed = parseScoresAndJustifications(clipboard);
    if (parsed.size === 0) {
      return {
        ok: false,
        matchCount: 0,
        expected: this.entries.length,
        reason: t('gossamer.scoreModal.noScoresDetected')
      };
    }

    const isPositional = Array.from(parsed.keys())[0]?.startsWith('__position_');
    let matchCount = 0;

    if (isPositional) {
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        const hit = parsed.get(`__position_${i + 1}`);
        if (hit && entry.inputEl) {
          entry.inputEl.setValue(hit.score.toString());
          entry.newScore = hit.score;
          entry.newJustification = hit.justification;
          entry.inputEl.inputEl.removeClass('ert-input-error');
          matchCount++;
        }
      }
    } else {
      for (const entry of this.entries) {
        const hit = this.lookupEntryFromParsed(parsed, entry);
        if (hit && entry.inputEl) {
          entry.inputEl.setValue(hit.score.toString());
          entry.newScore = hit.score;
          entry.newJustification = hit.justification;
          entry.inputEl.inputEl.removeClass('ert-input-error');
          matchCount++;
        }
      }
    }

    return { ok: matchCount > 0, matchCount, expected: this.entries.length };
  }

  /** Try multiple name variants to locate a parsed entry for a given beat. */
  private lookupEntryFromParsed(parsed: Map<string, ParsedBeatEntry>, entry: BeatScoreEntry): ParsedBeatEntry | undefined {
    const attempts = new Set<string>();
    attempts.add(entry.beatTitle);
    attempts.add(entry.beatTitle.replace(/^\d+(?:\.\d+)?\.?\s*/, '').trim());
    attempts.add(normalizeBeatName(entry.beatTitle));
    attempts.add(normalizeBeatName(entry.beatName));
    attempts.add(entry.beatName);

    for (const key of attempts) {
      if (!key) continue;
      const hit = parsed.get(key);
      if (hit) return hit;
    }

    // Case-insensitive scan as last resort.
    const lowerKeys = new Map<string, ParsedBeatEntry>();
    for (const [k, v] of parsed.entries()) lowerKeys.set(k.toLowerCase(), v);
    for (const key of attempts) {
      if (!key) continue;
      const hit = lowerKeys.get(key.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  }

  private async saveScores(source: 'manual-entry' | 'clipboard-paste' = 'manual-entry'): Promise<void> {
    const scores = new Map<string, number>();
    const justifications = new Map<string, string>();
    const deletions = new Map<string, Set<number>>(); // beatTitle -> Set of Gossamer numbers to delete
    const errors: string[] = [];

    // Collect scores, justifications, deletions
    for (const entry of this.entries) {
      if (entry.newScore !== undefined) {
        scores.set(entry.beatTitle, entry.newScore);
        if (entry.newJustification && entry.newJustification.trim().length > 0) {
          justifications.set(entry.beatTitle, entry.newJustification.trim());
        }
      } else if (entry.inputEl && entry.inputEl.getValue().trim().length > 0) {
        errors.push(t('gossamer.scoreModal.invalidScore', { title: entry.beatTitle }));
      }

      if (entry.scoresToDelete.size > 0) {
        deletions.set(entry.beatTitle, entry.scoresToDelete);
      }
    }

    if (errors.length > 0) {
      new Notice(t('gossamer.scoreModal.errorsList', { list: errors.join(', ') }));
      return;
    }

    if (scores.size === 0 && deletions.size === 0) {
      new Notice(t('gossamer.scoreModal.noChanges'));
      return;
    }

    try {
      if (scores.size > 0) {
        const signalForSave = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
        await this.plugin.saveGossamerScores(scores, signalForSave, justifications, source);
      }

      // Process deletions if there are any
      if (deletions.size > 0) {
        await this.processDeletions(deletions);
      }

      const changeCount = scores.size + deletions.size;
      new Notice(t('gossamer.scoreModal.updatedCount', { count: changeCount }));
      this.close();
    } catch (error) {
      console.error('[Gossamer] Failed to save scores:', error);
      new Notice(t('gossamer.scoreModal.saveFailed'));
    }
  }

  private async processDeletions(deletions: Map<string, Set<number>>): Promise<void> {
    // Get files from source path (same as saveGossamerScores)
    const sourcePath = this.plugin.settings.sourcePath || '';
    const allFiles = this.plugin.app.vault.getMarkdownFiles();
    const files = sourcePath
      ? allFiles.filter(f => isPathInFolderScope(f.path, sourcePath))
      : allFiles;

    const filesToSnapshot: TFile[] = [];
    for (const [beatTitle] of deletions) {
      // Find Plot note by title (same logic as saveGossamerScores)
      let file = null;
      const targetKey = normalizeBeatName(beatTitle);
      for (const f of files) {
        if (normalizeBeatName(f.basename) === targetKey) {
          const cache = this.plugin.app.metadataCache.getFileCache(f);
          const fm = cache?.frontmatter;
          if (fm && (fm.Class === 'Beat' || fm.Class === 'Plot')) {
            file = f;
            break;
          }
        }
      }

      if (!file) {
        continue;
      }
      filesToSnapshot.push(file);
    }

    const snapshotPath = await this.snapshotGossamerFields(filesToSnapshot, 'gossamer-delete-selected', {
      beatCount: filesToSnapshot.length
    });

    for (const [beatTitle, gossamerNums] of deletions) {
      let file = null;
      const targetKey = normalizeBeatName(beatTitle);
      for (const f of files) {
        if (normalizeBeatName(f.basename) === targetKey) {
          const cache = this.plugin.app.metadataCache.getFileCache(f);
          const fm = cache?.frontmatter;
          if (fm && (fm.Class === 'Beat' || fm.Class === 'Plot')) {
            file = f;
            break;
          }
        }
      }

      if (!file) {
        continue;
      }

      try {
        await this.plugin.app.fileManager.processFrontMatter(file, (yaml: Record<string, unknown>) => {
          // Delete specified Gossamer fields
          for (const num of gossamerNums) {
            clearGossamerRunSlot(yaml, num);
          }
        });
      } catch (error) {
        console.error(`[Gossamer] Failed to delete scores for ${beatTitle}:`, error);
      }
    }

    if (snapshotPath) {
      new Notice(t('gossamer.scoreModal.archivedDeletion', { path: snapshotPath }));
    }
  }

  /**
   * Shared warning-confirm dialog for the destructive delete actions. Returns
   * true if the user confirms. Single home for the modal sizing so the two
   * delete flows don't each re-declare the inline-style block.
   */
  private confirmPurge(opts: { title: string; subtitle: string; body: string; confirmLabel: string }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      const { modalEl, contentEl } = modal;
      modal.titleEl.setText('');
      contentEl.empty();

      modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
      modalEl.setCssStyles({ width: '680px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
      contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-gossamer-score-modal', 'ert-purge-confirm-modal');

      const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
      hero.createSpan({ text: t('gossamer.scoreModal.deleteConfirmBadge'), cls: 'ert-modal-badge' });
      hero.createDiv({ text: opts.title, cls: 'ert-modal-title' });
      hero.createDiv({ cls: 'ert-modal-subtitle', text: opts.subtitle });

      const card = contentEl.createDiv({ cls: 'ert-glass-card ert-purge-confirm-card' });
      card.createDiv({ text: opts.body, cls: 'ert-purge-message' });

      const buttonContainer = contentEl.createDiv({ cls: 'ert-modal-actions ert-gossamer-confirm-actions' });

      new ButtonComponent(buttonContainer)
        .setButtonText(opts.confirmLabel)
        .setDestructive()
        .onClick(() => {
          modal.close();
          resolve(true);
        });

      new ButtonComponent(buttonContainer)
        .setButtonText(t('gossamer.scoreModal.deleteConfirmCancel'))
        .onClick(() => {
          modal.close();
          resolve(false);
        });

      modal.open();
    });
  }

  private async deleteAllScores(): Promise<void> {
    const activeSignal: GossamerSignalType = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
    const activeSignalLabel = GOSSAMER_SIGNAL_METADATA[activeSignal].label;

    const sourcePath = this.plugin.settings.sourcePath || '';
    const allFiles = this.plugin.app.vault.getMarkdownFiles();
    const files = sourcePath
      ? allFiles.filter(f => isPathInFolderScope(f.path, sourcePath))
      : allFiles;

    // Signal-aware score detection: only count slots whose GossamerSignal${i}
    // matches the active signal (missing signal field = momentum by legacy rule).
    const slotMatchesActiveSignal = (fm: Record<string, unknown>, index: number): boolean => {
      const raw = fm[`GossamerSignal${index}`];
      if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim().toLowerCase() === activeSignal;
      }
      return activeSignal === 'momentum';
    };

    const fileHasActiveSignalScore = (fm: Record<string, unknown>): number[] => {
      const hits: number[] = [];
      for (let i = 1; i <= 30; i++) {
        if (fm[`Gossamer${i}`] === undefined) continue;
        if (slotMatchesActiveSignal(fm, i)) hits.push(i);
      }
      return hits;
    };

    let hasAnyScores = false;
    for (const file of files) {
      const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && (fm.Class === 'Beat' || fm.class === 'Beat')) {
        if (fileHasActiveSignalScore(fm).length > 0) {
          hasAnyScores = true;
          break;
        }
      }
    }

    if (!hasAnyScores) {
      new Notice(t('gossamer.scoreModal.noScoresToDelete', { signal: activeSignalLabel.toLowerCase() }));
      return;
    }

    const confirmed = await this.confirmPurge({
      title: t('gossamer.scoreModal.deleteConfirmTitle', { label: activeSignalLabel }),
      subtitle: t('gossamer.scoreModal.deleteConfirmSubtitle', { label: activeSignalLabel }),
      body: t('gossamer.scoreModal.deleteConfirmBody', { label: activeSignalLabel }),
      confirmLabel: t('gossamer.scoreModal.deleteConfirmButton', { label: activeSignalLabel })
    });

    if (!confirmed) return;

    try {
      let deletedCount = 0;
      const filesToSnapshot = files.filter((file) => {
        const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!(fm && (fm.Class === 'Beat' || fm.class === 'Beat'))) return false;
        return fileHasActiveSignalScore(fm).length > 0;
      });
      const snapshotPath = await this.snapshotGossamerFields(filesToSnapshot, `gossamer-delete-${activeSignal}`, {
        beatCount: filesToSnapshot.length,
        signal: activeSignal
      });

      for (const file of files) {
        const fmRead = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!(fmRead && (fmRead.Class === 'Beat' || fmRead.class === 'Beat'))) continue;
        const slotsToClear = fileHasActiveSignalScore(fmRead);
        if (slotsToClear.length === 0) continue;

        await this.plugin.app.fileManager.processFrontMatter(file, (yaml: Record<string, unknown>) => {
          const frontmatter = yaml;
          // Re-check inside the write to avoid races on stale cache.
          for (let i = 1; i <= 30; i++) {
            if (frontmatter[`Gossamer${i}`] === undefined) continue;
            if (slotMatchesActiveSignal(frontmatter, i)) {
              clearGossamerRunSlot(frontmatter, i);
            }
          }
          // Only drop the Last Updated field if no signal slots remain at all.
          let anyRemaining = false;
          for (let i = 1; i <= 30; i++) {
            if (frontmatter[`Gossamer${i}`] !== undefined) { anyRemaining = true; break; }
          }
          if (!anyRemaining) delete frontmatter['Gossamer Last Updated'];
        });
        deletedCount++;
      }

      const parts = [t('gossamer.scoreModal.deletedScores', { label: activeSignalLabel, count: deletedCount })];
      if (snapshotPath) parts.push(t('gossamer.scoreModal.normalizeArchive', { path: snapshotPath }));
      new Notice(parts.join(' '));
      this.close(); // Close the modal since all scores are cleared

    } catch (error) {
      console.error('[Gossamer] Failed to delete all scores:', error);
      new Notice(t('gossamer.scoreModal.deleteFailed'));
    }
  }

  /**
   * Total reset — strips every Gossamer slot (all signals) plus legacy fields
   * from every Beat note in scope, returning the book to a clean slate ready
   * for a fresh run. Unlike deleteAllScores (signal-scoped), this is unconditional.
   */
  private async deleteAllGossamerData(): Promise<void> {
    const sourcePath = this.plugin.settings.sourcePath || '';
    const allFiles = this.plugin.app.vault.getMarkdownFiles();
    const files = sourcePath
      ? allFiles.filter(f => isPathInFolderScope(f.path, sourcePath))
      : allFiles;

    const isBeat = (fm: Record<string, unknown> | undefined): fm is Record<string, unknown> =>
      !!fm && (fm.Class === 'Beat' || fm.class === 'Beat');

    const fileHasGossamerData = (fm: Record<string, unknown>): boolean => {
      for (let i = 1; i <= 30; i++) {
        if (fm[`Gossamer${i}`] !== undefined) return true;
      }
      for (const key of GOSSAMER_LEGACY_FIELDS) {
        if (fm[key] !== undefined) return true;
      }
      return false;
    };

    const beatsWithData = files.filter((file) => {
      const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      return isBeat(fm) && fileHasGossamerData(fm);
    });

    if (beatsWithData.length === 0) {
      new Notice(t('gossamer.scoreModal.noGossamerToDelete'));
      return;
    }

    const confirmed = await this.confirmPurge({
      title: t('gossamer.scoreModal.deleteAllConfirmTitle'),
      subtitle: t('gossamer.scoreModal.deleteAllConfirmSubtitle'),
      body: t('gossamer.scoreModal.deleteAllConfirmBody'),
      confirmLabel: t('gossamer.scoreModal.deleteAllConfirmButton')
    });

    if (!confirmed) return;

    try {
      const snapshotPath = await this.snapshotGossamerFields(beatsWithData, 'gossamer-delete-all', {
        beatCount: beatsWithData.length
      });

      let deletedCount = 0;
      for (const file of beatsWithData) {
        await this.plugin.app.fileManager.processFrontMatter(file, (yaml) => {
          if (clearAllGossamerData(yaml as Record<string, unknown>)) deletedCount++;
        });
      }

      const parts = [t('gossamer.scoreModal.deletedAllGossamer', { count: deletedCount })];
      if (snapshotPath) parts.push(t('gossamer.scoreModal.normalizeArchive', { path: snapshotPath }));
      new Notice(parts.join(' '));
      this.close();

    } catch (error) {
      console.error('[Gossamer] Failed to delete all Gossamer data:', error);
      new Notice(t('gossamer.scoreModal.deleteFailed'));
    }
  }

  private showMetadataWarning(field: string, beats: string[]): void {
    const preview = beats.slice(0, 3).join(', ');
    const remainder = beats.length > 3 ? `, +${beats.length - 3} more` : '';
    new Notice(t('gossamer.scoreModal.missingMetadata', { field, preview, remainder }));
  }

  private getActiveAiContextInfo(): { name: string; prompt: string } {
    const aiSettings = validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
    const templates = aiSettings.roleTemplates || [];
    const activeId = aiSettings.roleTemplateId;
    const active = templates.find(t => t.id === activeId) || templates[0];
    if (active) {
      return { name: active.name, prompt: active.prompt };
    }
    const signal = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
    const signalLabel = GOSSAMER_SIGNAL_METADATA[signal].label.toLowerCase();
    return {
      name: 'Generic Editor',
      prompt: `Act as a developmental editor evaluating narrative ${signalLabel} across the manuscript beats.`
    };
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class NormalizeConfirmationModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly issues: NormalizationIssue[],
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl, titleEl } = this;
    titleEl.setText('');
    contentEl.empty();

    if (modalEl) {
      modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
      // SAFE: Modal sizing via inline styles (Obsidian pattern). Match the
      // Gossamer score modal's constraints so this confirm dialog doesn't
      // stretch edge-to-edge.
      modalEl.setCssStyles({ width: '540px', maxWidth: '90vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
    }
      contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-gossamer-score-modal', 'ert-purge-confirm-modal');

    const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
    hero.createSpan({ text: t('gossamer.scoreModal.normalizeConfirmBadge'), cls: 'ert-modal-badge' });
    hero.createDiv({ text: t('gossamer.scoreModal.normalizeConfirmTitle'), cls: 'ert-modal-title' });
    hero.createDiv({ cls: 'ert-modal-subtitle', text: t('gossamer.scoreModal.normalizeConfirmSubtitle') });

    const card = contentEl.createDiv({ cls: 'ert-glass-card ert-purge-confirm-card' });

    // Single summary line — count of beats that will be touched.
    card.createDiv({ cls: 'ert-purge-message' }).setText(this.message);

    if (this.issues.length > 0) {
      const issuesEl = card.createDiv({ cls: 'ert-purge-issues' });
      issuesEl.createEl('h3', { text: t('gossamer.scoreModal.normalizeIssuesTitle'), cls: 'ert-purge-issues-title' });

      const listEl = issuesEl.createEl('ul', { cls: 'ert-purge-issues-list' });
      const preview = this.issues.slice(0, 6);

      preview.forEach(issue => {
        const item = listEl.createEl('li', { cls: 'ert-purge-issues-item' });
        item.createEl('strong', { text: issue.beatTitle });

        const details: string[] = [];

        if (issue.missingSlots.length > 0) {
          const gapLabel = issue.missingSlots.length === 1
            ? t('gossamer.scoreModal.normalizeGapLabel')
            : t('gossamer.scoreModal.normalizeGapsLabel');
          const gapList = issue.missingSlots.map(slot => `G${slot}`).join(', ');
          details.push(`${gapLabel}: ${gapList}`);
        } else if (issue.hasRenumbering) {
          details.push(t('gossamer.scoreModal.normalizeOutOfOrder'));
        }

        if (issue.orphanJustifications.length > 0) {
          const orphanLabel = issue.orphanJustifications.length === 1
            ? t('gossamer.scoreModal.normalizeOrphanLabel')
            : t('gossamer.scoreModal.normalizeOrphansLabel');
          const orphanList = issue.orphanJustifications.map(slot => `G${slot}`).join(', ');
          details.push(`${orphanLabel}: ${orphanList}`);
        }

        item.createSpan({ text: details.join(' • ') || t('gossamer.scoreModal.normalizeWillCompact') });
      });

      if (this.issues.length > preview.length) {
        issuesEl.createDiv({
          cls: 'ert-purge-issues-footnote',
          text: t('gossamer.scoreModal.normalizeMoreSuffix', {
            count: this.issues.length - preview.length,
            plural: this.issues.length - preview.length === 1 ? '' : 's'
          })
        });
      }
    }

    const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions ert-gossamer-confirm-actions' });
    new ButtonComponent(buttonRow)
      .setButtonText(t('gossamer.scoreModal.normalizeConfirmButton'))
      .setDestructive()
      .onClick(() => {
        this.close();
        this.onConfirm();
      });

    new ButtonComponent(buttonRow)
      .setButtonText(t('gossamer.scoreModal.normalizeConfirmCancel'))
      .onClick(() => this.close());
  }
}
