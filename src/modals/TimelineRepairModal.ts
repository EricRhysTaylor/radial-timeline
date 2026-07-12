/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard Modal
 * Two-phase modal: configuration wizard + review/edit UI for rapid human correction.
 */

import { App, Modal, ButtonComponent, Notice, setIcon, setTooltip, ToggleComponent } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { EventRef, TFile, WorkspaceLeaf } from 'obsidian';
import type { TimelineItem } from '../types';
import { t } from '../i18n';
import {
    type RepairPipelineConfig,
    type RepairPipelineResult,
    type SessionDiffModel,
    type ModalPhase,
    type PatternPresetId,
    type RepairSceneEntry,
    type TimeBucket,
    SCAFFOLD_PATTERNS,
    TIME_BUCKET_HOURS,
    TIME_BUCKET_LABELS,
    describeWhenLabel,
    getEffectiveWhen
} from '../timelineRepair/types';
import { runRepairPipeline } from '../timelineRepair/RepairPipeline';
import { buildSharedSceneNoteFileMap, loadScopedSceneNotes, mapSharedSceneNotesToTimelineItems } from '../timeline/sharedSceneNotes';
import {
    createSession,
    shiftSceneDays,
    shiftSceneHours,
    setSceneTimeBucket,
    toggleRippleMode,
    getChangedCount,
    getNeedsReviewCount
} from '../timelineRepair/sessionDiff';
import { formatWhenForDisplay, detectTimeBucket } from '../timelineRepair/patternSync';
import { writeSessionChanges, getChangeSummary } from '../timelineRepair/frontmatterWriter';
import {
    buildTimelineSnapshot,
    saveTimelineSnapshot,
    getLatestTimelineSnapshot,
    restoreTimelineSnapshot
} from '../timelineRepair/timelineSnapshot';
import { buildScaffoldPreview } from '../timelineRepair/scaffoldPreview';
import { parseWhenField } from '../utils/date';
import { renderWithYamlTokens } from '../utils/yamlTokenRender';
import { TimelineAuditModal } from './TimelineAuditModal';

// ============================================================================
// Modal Class
// ============================================================================

export class TimelineRepairModal extends Modal {
    private readonly plugin: RadialTimelinePlugin;

    // State
    private phase: ModalPhase = 'config';
    private config: RepairPipelineConfig | null = null;
    private result: RepairPipelineResult | null = null;
    private session: SessionDiffModel | null = null;
    private abortController: AbortController | null = null;

    // Scene data
    private scenes: TimelineItem[] = [];
    private files: Map<string, TFile> = new Map();

    // UI references
    private sceneListEl?: HTMLElement;
    private summaryBarEl?: HTMLElement;
    private needsReviewPillEl?: HTMLElement;
    /**
     * Manuscript index of the scene the user just edited, if any. Reset after
     * the next render. The matching row gets a one-shot pulse animation and is
     * scrolled into view so the author doesn't lose track of it after edits.
     */
    private lastEditedSceneIndex?: number;
    /**
     * Manuscript indices of scenes that were shifted by Ripple cascade in the
     * most recent edit (excludes the directly-edited row). These get a quieter
     * pulse so the author can see the cascade in action. Reset after render.
     */
    private lastRippledIndices?: Set<number>;
    /**
     * Manuscript indices of scenes whose effective When matches another
     * scene's effective When. Computed at render time from the current
     * session, so edit-induced duplicates are caught live.
     */
    private duplicateWhenIndices: Set<number> = new Set();
    /**
     * Frozen chronological order (scene paths) used to render the list. Edits
     * keep this snapshot stable so rows don't jump mid-click. The snapshot is
     * cleared on filter/mode changes and on a debounced timer after the last
     * edit, at which point the next render re-sorts to the new chronology.
     */
    private chronoOrderSnapshot?: string[];
    private resortTimer?: number;
    private pendingResortEditIndex?: number;

    // Review filters
    private filterNeedsReview = false;
    private filterKeywordDerived = false;

    // Open-note awareness (passive highlighting only)
    private openNotePaths: Set<string> = new Set();
    private workspaceEventRefs: EventRef[] = [];

    // Audit handoff: paths the author has marked for "send to Audit".
    // Auto-included on session build (Needs Review or Cue-adjusted), then
    // user-toggleable per row. Lives in the Normalizer modal only — never
    // written to YAML, never persisted between sessions.
    private auditIncluded: Set<string> = new Set();
    private auditFooterEl?: HTMLElement;

    constructor(app: App, plugin: RadialTimelinePlugin) {
        super(app);
        this.plugin = plugin;
    }

    private getDefaultAnchorWhen(): { date: Date; source: 'authored' | 'fallback' } {
        const firstScene = this.scenes[0];
        if (firstScene) {
            if (firstScene.when instanceof Date && !isNaN(firstScene.when.getTime())) {
                return { date: new Date(firstScene.when), source: 'authored' };
            }
            const rawWhen = firstScene.rawFrontmatter?.When;
            if (typeof rawWhen === 'string') {
                const parsed = parseWhenField(rawWhen);
                if (parsed) return { date: parsed, source: 'authored' };
            }
        }

        const fallback = new Date();
        fallback.setHours(8, 0, 0, 0);
        return { date: fallback, source: 'fallback' };
    }

    private parseAnchorWhenFromInputs(dateValue: string, timeValue: string, fallback: Date): Date {
        const [year, month, day] = dateValue.split('-').map(Number);
        const hasValidDate = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day);
        const [hour, minute] = timeValue.trim() ? timeValue.split(':').map(Number) : [0, 0];
        const safeHour = Number.isFinite(hour) ? hour : 0;
        const safeMinute = Number.isFinite(minute) ? minute : 0;

        if (!hasValidDate) {
            const fallbackDate = new Date(fallback);
            fallbackDate.setHours(safeHour, safeMinute, 0, 0);
            return fallbackDate;
        }

        return new Date(year, month - 1, day, safeHour, safeMinute, 0, 0);
    }

    async onOpen(): Promise<void> {
        const { contentEl, modalEl, titleEl } = this;
        titleEl.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-timeline-repair-modal-shell');
            modalEl.setCssStyles({ width: '900px', maxWidth: '95vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }

        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-timeline-repair-modal');

        // Load scene data
        await this.loadSceneData();

        // Show configuration phase
        this.showConfigPhase();

        // Set up keyboard navigation
        this.setupKeyboardNavigation();
    }

    onClose(): void {
        this.abortController?.abort();
        this.unregisterOpenNoteListeners();
        if (this.resortTimer !== undefined) {
            window.clearTimeout(this.resortTimer);
            this.resortTimer = undefined;
        }
    }

    private async loadSceneData(): Promise<void> {
        const sceneNotes = await loadScopedSceneNotes(this.plugin);
        this.scenes = mapSharedSceneNotesToTimelineItems(sceneNotes);
        this.files = buildSharedSceneNoteFileMap(sceneNotes);
    }

    private normalizeCueSearchText(value: string): string {
        return value
            .replace(/[\u2018\u2019]/g, '\'')
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private findCueRange(content: string, cueText: string): { start: number; end: number } | null {
        const attempts = [
            cueText,
            this.normalizeCueSearchText(cueText)
        ].filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

        for (const attempt of attempts) {
            const exactIndex = content.indexOf(attempt);
            if (exactIndex >= 0) {
                return { start: exactIndex, end: exactIndex + attempt.length };
            }

            const lowerContent = content.toLowerCase();
            const lowerAttempt = attempt.toLowerCase();
            const lowerIndex = lowerContent.indexOf(lowerAttempt);
            if (lowerIndex >= 0) {
                return { start: lowerIndex, end: lowerIndex + attempt.length };
            }
        }

        const normalizedContent = this.normalizeCueSearchText(content);
        const normalizedCue = this.normalizeCueSearchText(cueText);
        if (!normalizedCue) return null;

        const normalizedIndex = normalizedContent.toLowerCase().indexOf(normalizedCue.toLowerCase());
        if (normalizedIndex < 0) return null;

        const prefix = normalizedContent.slice(0, normalizedIndex);
        const rawPrefixMatch = content.match(new RegExp(`^[\\s\\S]{0,${prefix.length * 2}}`));
        const rawStart = rawPrefixMatch ? rawPrefixMatch[0].length : normalizedIndex;
        return {
            start: rawStart,
            end: Math.min(content.length, rawStart + cueText.length)
        };
    }

    private async openCueInFreshTab(file: TFile, cueText: string): Promise<void> {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.openFile(file, { active: true });
        void this.app.workspace.revealLeaf(leaf);

        const attemptSelection = (): boolean => {
            const view = leaf.view;
            if (!view || !('editor' in view)) return false;
            const editor = (view as { editor?: { getValue(): string; offsetToPos(offset: number): unknown; setSelection(from: unknown, to: unknown): void; scrollIntoView(range: { from: unknown; to: unknown }, center?: boolean): void; }; }).editor;
            if (!editor) return false;

            const content = editor.getValue();
            const range = this.findCueRange(content, cueText);
            if (!range) return false;

            const from = editor.offsetToPos(range.start);
            const to = editor.offsetToPos(range.end);
            editor.setSelection(from, to);
            editor.scrollIntoView({ from, to }, true);
            return true;
        };

        if (attemptSelection()) return;

        window.setTimeout(() => {
            attemptSelection();
        }, 50);
    }

    private buildConfigBadgeText(): string {
        const scenesWithWhen = this.scenes.filter(s => s.when instanceof Date).length;
        return `Beta · ${this.scenes.length} scenes • ${scenesWithWhen} dated`;
    }

    // ========================================================================
    // Configuration Phase
    // ========================================================================

    private showConfigPhase(): void {
        this.phase = 'config';
        this.contentEl.empty();
        this.unregisterOpenNoteListeners();
        this.sceneListEl = undefined;
        this.needsReviewPillEl = undefined;
        this.auditFooterEl = undefined;
        this.auditIncluded.clear();
        this.chronoOrderSnapshot = undefined;
        if (this.resortTimer !== undefined) {
            window.clearTimeout(this.resortTimer);
            this.resortTimer = undefined;
        }
        this.pendingResortEditIndex = undefined;

        // Header
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });
        const badgeRow = header.createDiv({ cls: 'ert-modal-badge-row' });
        badgeRow.createSpan({ cls: 'ert-modal-badge', text: this.buildConfigBadgeText() });
        badgeRow.createSpan({ cls: 'ert-timeline-tool-pill', text: t('timelineRepairModal.config.noAiPill') });
        header.createDiv({ cls: 'ert-modal-title', text: t('timelineRepairModal.config.title') });
        const subtitleEl = header.createDiv({ cls: 'ert-modal-subtitle' });
        renderWithYamlTokens(subtitleEl, t('timelineRepairModal.config.subtitle'));

        // Express card — populated at the end of this method, once the anchor
        // and pattern inputs it reads from exist.
        const expressCard = this.contentEl.createDiv({ cls: 'ert-glass-card ert-timeline-repair-express-card' });

        // Setup configuration
        const setupCard = this.contentEl.createDiv({ cls: 'ert-glass-card ert-timeline-repair-setup-card' });
        const setupGrid = setupCard.createDiv({ cls: 'ert-timeline-repair-setup-grid' });
        const leftCol = setupGrid.createDiv({ cls: 'ert-timeline-repair-config-column' });
        const rightCol = setupGrid.createDiv({ cls: 'ert-timeline-repair-config-column' });

        const defaultAnchor = this.getDefaultAnchorWhen();
        const defaultAnchorWhen = defaultAnchor.date;

        const anchorSection = leftCol.createDiv({ cls: 'ert-timeline-repair-config-block' });
        const anchorHeader = anchorSection.createDiv({ cls: 'ert-timeline-repair-block-header' });
        anchorHeader.createEl('h5', { text: t('timelineRepairModal.anchor.name'), cls: 'ert-timeline-repair-block-title' });

        const anchorPill = anchorHeader.createSpan({
            cls: 'ert-timeline-repair-compliance-chip ert-timeline-repair-anchor-pill'
        });
        anchorPill.addClass(`ert-compliance-${defaultAnchor.source === 'authored' ? 'authored' : 'pattern-based'}`);
        anchorPill.setText(
            defaultAnchor.source === 'authored'
                ? t('timelineRepairModal.anchor.pillAuthored')
                : t('timelineRepairModal.anchor.pillFallback')
        );

        anchorSection.createDiv({
            cls: 'ert-timeline-repair-section-desc',
            text: t('timelineRepairModal.anchor.desc')
        });

        const anchorRow = anchorSection.createDiv({ cls: 'ert-timeline-repair-anchor-row' });

        // Date input
        const dateInputContainer = anchorRow.createDiv({ cls: 'ert-timeline-repair-input-group' });
        dateInputContainer.createEl('label', { text: t('timelineRepairModal.anchor.dateLabel'), cls: 'ert-timeline-repair-label' });
        const dateInput = dateInputContainer.createEl('input', {
            type: 'date',
            cls: 'ert-timeline-repair-date-input ert-input ert-input--full'
        });
        dateInput.value = `${defaultAnchorWhen.getFullYear()}-${String(defaultAnchorWhen.getMonth() + 1).padStart(2, '0')}-${String(defaultAnchorWhen.getDate()).padStart(2, '0')}`;

        // Time input
        const timeInputContainer = anchorRow.createDiv({ cls: 'ert-timeline-repair-input-group' });
        timeInputContainer.createEl('label', { text: t('timelineRepairModal.anchor.timeLabel'), cls: 'ert-timeline-repair-label' });
        const timeInput = timeInputContainer.createEl('input', {
            type: 'time',
            cls: 'ert-timeline-repair-time-input ert-input ert-input--full'
        });
        timeInput.value = `${String(defaultAnchorWhen.getHours()).padStart(2, '0')}:${String(defaultAnchorWhen.getMinutes()).padStart(2, '0')}`;

        let selectedPattern: PatternPresetId = 'beats2';

        const previewSection = leftCol.createDiv({ cls: 'ert-timeline-repair-config-block ert-timeline-repair-preview-section' });
        previewSection.createDiv({ cls: 'ert-timeline-repair-block-header' })
            .createEl('h5', { text: t('timelineRepairModal.preview.name'), cls: 'ert-timeline-repair-block-title' });
        const previewPanel = previewSection.createDiv({ cls: 'ert-timeline-repair-preview-panel' });
        const previewStart = previewPanel.createDiv({ cls: 'ert-timeline-repair-preview-start' });
        const previewStrip = previewPanel.createDiv({ cls: 'ert-timeline-repair-preview-strip' });
        const previewHelper = previewSection.createDiv({ cls: 'ert-timeline-repair-preview-helper' });

        const updateScaffoldPreview = (): void => {
            const anchorWhen = this.parseAnchorWhenFromInputs(dateInput.value, timeInput.value, defaultAnchorWhen);
            const preview = buildScaffoldPreview(selectedPattern, anchorWhen, this.scenes.length, 4);
            previewStart.textContent = preview.startLabel;
            previewHelper.textContent = preview.helperLabel;
            previewStrip.empty();

            preview.steps.forEach((step, index) => {
                const stepEl = previewStrip.createDiv({ cls: 'ert-timeline-repair-preview-step' });
                stepEl.createDiv({ cls: 'ert-timeline-repair-preview-scene', text: step.sceneLabel });
                stepEl.createDiv({ cls: 'ert-timeline-repair-preview-label', text: step.spacingLabel });

                if (index < preview.steps.length - 1) {
                    previewStrip.createSpan({ cls: 'ert-timeline-repair-preview-arrow', text: '→' });
                }
            });
        };

        dateInput.addEventListener('input', updateScaffoldPreview);
        timeInput.addEventListener('input', updateScaffoldPreview);

        // Pattern selection
        const patternSection = rightCol.createDiv({ cls: 'ert-timeline-repair-config-block' });
        patternSection.createDiv({ cls: 'ert-timeline-repair-block-header' })
            .createEl('h5', { text: t('timelineRepairModal.pattern.name'), cls: 'ert-timeline-repair-block-title' });
        patternSection.createDiv({
            cls: 'ert-timeline-repair-section-desc',
            text: t('timelineRepairModal.pattern.desc')
        });

        const patternRow = patternSection.createDiv({ cls: 'ert-timeline-repair-pattern-grid' });

        for (const preset of Object.values(SCAFFOLD_PATTERNS)) {
            const isActive = preset.id === selectedPattern;
            const option = patternRow.createDiv({
                cls: 'ert-timeline-repair-pattern-option',
                attr: {
                    role: 'radio',
                    tabindex: '0',
                    'aria-checked': isActive ? 'true' : 'false'
                }
            });
            option.createSpan({ cls: 'ert-timeline-repair-pattern-radio' });
            option.toggleClass('ert-is-active', isActive);

            const optionText = option.createDiv({ cls: 'ert-timeline-repair-pattern-text' });
            optionText.createDiv({ text: preset.label, cls: 'ert-timeline-repair-pattern-label' });
            optionText.createDiv({ text: preset.description, cls: 'ert-timeline-repair-pattern-desc' });

            const select = () => {
                patternRow.querySelectorAll('.ert-timeline-repair-pattern-option').forEach(p => {
                    const isThis = p === option;
                    p.toggleClass('ert-is-active', isThis);
                    p.setAttribute('aria-checked', isThis ? 'true' : 'false');
                });
                selectedPattern = preset.id;
                updateScaffoldPreview();
            };

            option.addEventListener('click', select);
            option.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    select();
                }
            });
        }

        updateScaffoldPreview();

        const optionsSection = rightCol.createDiv({ cls: 'ert-timeline-repair-config-block' });

        const baseRow = optionsSection.createDiv({ cls: 'ert-timeline-repair-option-row ert-is-static' });
        const baseText = baseRow.createDiv({ cls: 'ert-timeline-repair-level-text' });
        baseText.createDiv({ cls: 'ert-timeline-repair-level-title', text: t('timelineRepairModal.refinements.baseScaffoldTitle') });
        renderWithYamlTokens(
            baseText.createDiv({ cls: 'ert-timeline-repair-level-desc' }),
            t('timelineRepairModal.refinements.baseScaffoldDesc')
        );

        // Action buttons
        const buttonRow = this.contentEl.createDiv({ cls: 'ert-modal-actions' });

        const restoreBtn = new ButtonComponent(buttonRow)
            .setButtonText(t('timelineRepairModal.config.restoreButton'))
            .setDisabled(true)
            .onClick(() => { void this.handleRestoreLatestSnapshot(); });
        restoreBtn.buttonEl.addClass('ert-timeline-repair-restore-btn');

        void getLatestTimelineSnapshot(this.app).then(meta => {
            if (meta) {
                restoreBtn.setDisabled(false);
                setTooltip(restoreBtn.buttonEl, t('timelineRepairModal.config.restoreTooltip', {
                    label: meta.snapshot.displayLabel
                }));
            } else {
                setTooltip(restoreBtn.buttonEl, t('timelineRepairModal.config.restoreEmptyTooltip'));
            }
        });

        new ButtonComponent(buttonRow)
            .setButtonText(t('timelineRepairModal.config.previewButton'))
            .setCta()
            .onClick(async () => {
                const anchorWhen = this.parseAnchorWhenFromInputs(dateInput.value, timeInput.value, defaultAnchorWhen);

                this.config = {
                    anchorWhen,
                    anchorSceneIndex: 0,
                    patternPreset: selectedPattern,
                    useTextCues: true,
                    preserveAuthoredDates: true
                };

                await this.runAnalysis();
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('timelineRepairModal.config.cancelButton'))
            .onClick(() => this.close());

        this.renderExpressCard(expressCard, () => ({
            anchorWhen: this.parseAnchorWhenFromInputs(dateInput.value, timeInput.value, defaultAnchorWhen),
            anchorSceneIndex: 0,
            patternPreset: selectedPattern,
            useTextCues: true,
            preserveAuthoredDates: true
        }));
    }

    /**
     * Express path: one click fills every missing When (existing dates are
     * never touched) and applies immediately — no review phase. When the
     * timeline is already fully dated there is nothing to fill, so the card
     * steers to Timeline Audit instead.
     */
    private renderExpressCard(card: HTMLElement, buildConfig: () => RepairPipelineConfig): void {
        const missingCount = this.scenes.filter(s => !(s.when instanceof Date)).length;

        const text = card.createDiv({ cls: 'ert-timeline-repair-level-text' });
        text.createDiv({ cls: 'ert-timeline-repair-level-title', text: t('timelineRepairModal.express.title') });

        if (missingCount === 0) {
            text.createDiv({
                cls: 'ert-timeline-repair-level-desc',
                text: `${t('timelineRepairModal.express.fullyDated', { count: this.scenes.length })} ${t('timelineRepairModal.express.fullyDatedHint')}`
            });
            new ButtonComponent(card)
                .setButtonText(t('timelineRepairModal.express.openAuditButton'))
                .onClick(() => {
                    this.close();
                    new TimelineAuditModal(this.app, this.plugin, {}).open();
                });
            return;
        }

        renderWithYamlTokens(
            text.createDiv({ cls: 'ert-timeline-repair-level-desc' }),
            t('timelineRepairModal.express.desc')
        );

        const expressBtn = new ButtonComponent(card)
            .setButtonText(t('timelineRepairModal.express.button'))
            .setCta()
            .onClick(async () => {
                expressBtn.setDisabled(true);
                try {
                    await this.expressScaffoldAndApply(buildConfig());
                } finally {
                    expressBtn.setDisabled(false);
                }
            });
    }

    private async expressScaffoldAndApply(config: RepairPipelineConfig): Promise<void> {
        this.config = config;
        try {
            this.result = await runRepairPipeline(this.scenes, this.files, this.plugin, config);
            this.session = createSession(this.result);
        } catch (error) {
            new Notice(`Scaffold failed: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        const summary = getChangeSummary(this.session);
        if (summary.totalChanges === 0) {
            new Notice(t('timelineRepairModal.apply.noChangesNotice'));
            return;
        }

        const written = await this.persistSessionChanges();
        if (written === null) return;
        if (written.failed === 0) {
            new Notice(t('timelineRepairModal.express.successNotice', { count: written.success }));
        }
        this.close();
    }

    private createLevelToggle(
        container: HTMLElement,
        title: string,
        description: string,
        initialValue: boolean,
        disabled: boolean,
        onChange?: (value: boolean) => void
    ): HTMLElement {
        const row = container.createDiv({ cls: 'ert-timeline-repair-option-row' });

        const textContainer = row.createDiv({ cls: 'ert-timeline-repair-level-text' });
        textContainer.createDiv({ cls: 'ert-timeline-repair-level-title', text: title });
        const descEl = textContainer.createDiv({ cls: 'ert-timeline-repair-level-desc' });
        renderWithYamlTokens(descEl, description);

        const toggle = new ToggleComponent(row);
        toggle.setValue(initialValue);
        toggle.setDisabled(disabled);
        if (onChange) {
            toggle.onChange(onChange);
        }

        return row;
    }

    // ========================================================================
    // Analysis Phase
    // ========================================================================

    private async handleOverwriteToggle(replaceExisting: boolean): Promise<void> {
        if (!this.config) return;
        this.config = { ...this.config, preserveAuthoredDates: !replaceExisting };

        // Snapshot in-session manual edits so the toggle does not discard them.
        const manualEdits = new Map<number, Date>();
        const previousRipple = this.session?.rippleEnabled ?? false;
        if (this.session) {
            for (const entry of this.session.entries) {
                if (entry.source === 'manual' && entry.editedWhen) {
                    manualEdits.set(entry.manuscriptIndex, new Date(entry.editedWhen));
                }
            }
        }

        try {
            this.result = await runRepairPipeline(
                this.scenes,
                this.files,
                this.plugin,
                this.config
            );
            this.session = createSession(this.result);
            if (this.session) {
                this.session.rippleEnabled = previousRipple;
                if (manualEdits.size > 0) {
                    for (const entry of this.session.entries) {
                        const edit = manualEdits.get(entry.manuscriptIndex);
                        if (!edit) continue;
                        entry.editedWhen = edit;
                        entry.source = 'manual';
                        entry.isChanged = entry.originalWhen === null ||
                            edit.getTime() !== entry.originalWhen.getTime();
                    }
                    this.session.hasUnsavedChanges = this.session.entries.some(e => e.isChanged);
                }
            }
            this.seedAuditIncluded();
            this.chronoOrderSnapshot = undefined; // fresh chrono after rebuild
            this.renderSceneList();
            this.updateSummaryBar();
            this.updateAuditFooter();
        } catch (error) {
            new Notice(`Rescaffold failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async runAnalysis(): Promise<void> {
        this.phase = 'analyzing';
        this.contentEl.empty();
        this.abortController = new AbortController();

        // Header
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: t('timelineRepairModal.analyzing.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('timelineRepairModal.analyzing.title') });
        const statusEl = header.createDiv({ cls: 'ert-modal-subtitle', text: t('timelineRepairModal.analyzing.statusApplying') });

        // Progress card
        const progressCard = this.contentEl.createDiv({ cls: 'ert-glass-card' });
        const progressContainer = progressCard.createDiv({ cls: 'ert-pulse-progress-container' });
        const progressBg = progressContainer.createDiv({ cls: 'ert-pulse-progress-bg' });
        const progressBar = progressBg.createDiv({ cls: 'ert-pulse-progress-bar' });
        progressBar.setCssProps({ '--progress-width': '0%' });

        const progressText = progressCard.createDiv({ cls: 'ert-pulse-progress-text' });
        progressText.setText(t('timelineRepairModal.analyzing.preparing'));

        // Abort button
        const buttonRow = this.contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(buttonRow)
            .setButtonText(t('timelineRepairModal.analyzing.abortButton'))
            .setDestructive()
            .onClick(() => {
                this.abortController?.abort();
                new Notice(t('timelineRepairModal.analyzing.abortedNotice'));
                this.showConfigPhase();
            });

        try {
            // Run pipeline
            this.result = await runRepairPipeline(
                this.scenes,
                this.files,
                this.plugin,
                this.config!,
                {
                    onPhaseChange: (phase) => {
                        switch (phase) {
                            case 'pattern':
                                statusEl.setText(t('timelineRepairModal.analyzing.phasePattern'));
                                progressBar.setCssProps({ '--progress-width': '30%' });
                                break;
                            case 'cues':
                                statusEl.setText(t('timelineRepairModal.analyzing.phaseCues'));
                                progressBar.setCssProps({ '--progress-width': '70%' });
                                break;
                            case 'complete':
                                statusEl.setText(t('timelineRepairModal.analyzing.phaseComplete'));
                                progressBar.setCssProps({ '--progress-width': '100%' });
                                break;
                        }
                    },
                    abortSignal: this.abortController.signal
                }
            );

            // Create session from results
            this.session = createSession(this.result);
            this.seedAuditIncluded();

            // Show review phase
            this.showReviewPhase();

        } catch (error) {
            if (!this.abortController.signal.aborted) {
                new Notice(`Scaffold failed: ${error instanceof Error ? error.message : String(error)}`);
                this.showConfigPhase();
            }
        }
    }

    // ========================================================================
    // Review Phase
    // ========================================================================

    private showReviewPhase(): void {
        this.phase = 'review';
        this.contentEl.empty();

        if (!this.session || !this.result) {
            this.showConfigPhase();
            return;
        }

        // Header
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });

        // Badge row: Quick Scaffold + status counts
        const badgeRow = header.createDiv({ cls: 'ert-timeline-repair-badge-row' });
        this.summaryBarEl = badgeRow.createSpan({ cls: 'ert-modal-badge ert-timeline-repair-review-badge' });
        this.updateSummaryBar();

        header.createDiv({ cls: 'ert-modal-title', text: t('timelineRepairModal.review.title') });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('timelineRepairModal.review.subtitle')
        });

        // Filter toggles
        const filterRow = this.contentEl.createDiv({ cls: 'ert-timeline-repair-filter-row' });

        this.needsReviewPillEl = this.createFilterPill(filterRow, t('timelineRepairModal.review.filterNeedsReview'), this.filterNeedsReview, (val) => {
            this.filterNeedsReview = val;
            this.chronoOrderSnapshot = undefined; // recompute chrono with the filtered set
            this.renderSceneList();
        });

        if (this.result.cueRefined > 0) {
            this.createFilterPill(filterRow, t('timelineRepairModal.review.filterTextCues'), this.filterKeywordDerived, (val) => {
                this.filterKeywordDerived = val;
                this.chronoOrderSnapshot = undefined;
                this.renderSceneList();
            });
        }

        // Overwrite author dates toggle (re-runs analysis)
        const overwriteContainer = filterRow.createDiv({ cls: 'ert-timeline-repair-overwrite-toggle' });
        overwriteContainer.createSpan({ text: t('timelineRepairModal.review.overwriteAuthorDates') });

        const overwriteHelp = overwriteContainer.createSpan({ cls: 'ert-timeline-repair-overwrite-help' });
        setIcon(overwriteHelp, 'help-circle');
        setTooltip(overwriteHelp, t('timelineRepairModal.review.overwriteAuthorDatesHelp'));

        const overwriteToggle = new ToggleComponent(overwriteContainer);
        overwriteToggle.setValue(this.config ? !this.config.preserveAuthoredDates : false);
        overwriteToggle.onChange((val) => {
            void this.handleOverwriteToggle(val);
        });

        // Ripple mode toggle
        const rippleContainer = filterRow.createDiv({ cls: 'ert-timeline-repair-ripple-toggle' });
        rippleContainer.createSpan({ text: t('timelineRepairModal.review.rippleMode') });

        const rippleHelp = rippleContainer.createSpan({ cls: 'ert-timeline-repair-ripple-help' });
        setIcon(rippleHelp, 'help-circle');
        setTooltip(rippleHelp, t('timelineRepairModal.review.rippleModeHelp'));

        const rippleToggle = new ToggleComponent(rippleContainer);
        rippleToggle.setValue(this.session.rippleEnabled);
        rippleToggle.onChange(() => {
            if (this.session) {
                this.session = toggleRippleMode(this.session);
                this.updateSummaryBar();
            }
        });

        // Scene list container
        this.sceneListEl = this.contentEl.createDiv({ cls: 'ert-timeline-repair-scene-list' });
        this.openNotePaths = this.collectOpenNotePaths();
        this.renderSceneList();
        this.registerOpenNoteListeners();

        // Action buttons. DOM order: audit-open first (pinned left via CSS),
        // then Back / Apply pinned right.
        const buttonRow = this.contentEl.createDiv({ cls: 'ert-modal-actions' });
        this.auditFooterEl = buttonRow;

        const auditOpenBtn = new ButtonComponent(buttonRow)
            .setButtonText(this.auditIncluded.size === 0
                ? t('timelineRepairModal.review.openAuditButtonAll')
                : t('timelineRepairModal.review.openAuditButton', { count: this.auditIncluded.size }))
            .onClick(() => this.openFocusedAudit());
        auditOpenBtn.buttonEl.addClass('ert-timeline-repair-audit-open-btn');

        new ButtonComponent(buttonRow)
            .setButtonText(t('timelineRepairModal.review.backButton'))
            .onClick(() => this.showConfigPhase());

        new ButtonComponent(buttonRow)
            .setButtonText(t('timelineRepairModal.review.applyButton'))
            .setCta()
            .setDisabled(!this.session.hasUnsavedChanges)
            .onClick(() => this.applyChanges());

        this.updateAuditFooter();
    }

    private updateSummaryBar(): void {
        if (!this.summaryBarEl || !this.session) return;

        const changedCount = getChangedCount(this.session);
        const reviewCount = getNeedsReviewCount(this.session);
        const authoredCount = this.session.entries.filter(e => e.source === 'authored').length;
        const parts: string[] = [
            t('timelineRepairModal.review.badge').toUpperCase(),
            t('timelineRepairModal.review.summaryChanged', { count: changedCount }).toUpperCase()
        ];
        if (authoredCount > 0) {
            parts.push(t('timelineRepairModal.review.summaryAuthored', { count: authoredCount }).toUpperCase());
        }
        if (reviewCount > 0) {
            parts.push(t('timelineRepairModal.review.summaryNeedReview', { count: reviewCount }).toUpperCase());
        }
        this.summaryBarEl.setText(parts.join(' • '));
        this.needsReviewPillEl?.toggleClass('ert-has-warnings', reviewCount > 0);
    }

    private createFilterPill(
        container: HTMLElement,
        label: string,
        active: boolean,
        onChange: (value: boolean) => void
    ): HTMLElement {
        const pill = container.createDiv({ cls: 'ert-timeline-repair-filter-pill' });
        if (active) pill.addClass('ert-is-active');
        pill.setText(label);

        pill.addEventListener('click', () => {
            const newActive = !pill.hasClass('ert-is-active');
            pill.toggleClass('ert-is-active', newActive);
            onChange(newActive);
        });
        return pill;
    }

    private registerOpenNoteListeners(): void {
        this.unregisterOpenNoteListeners();
        const handler = () => this.refreshOpenNoteHighlights();
        this.workspaceEventRefs.push(this.app.workspace.on('active-leaf-change', handler));
        this.workspaceEventRefs.push(this.app.workspace.on('layout-change', handler));
    }

    private unregisterOpenNoteListeners(): void {
        for (const ref of this.workspaceEventRefs) {
            this.app.workspace.offref(ref);
        }
        this.workspaceEventRefs = [];
    }

    private seedAuditIncluded(): void {
        this.auditIncluded.clear();
        if (!this.session) return;
        for (const entry of this.session.entries) {
            if (this.shouldAutoIncludeForAudit(entry)) {
                this.auditIncluded.add(entry.file.path);
            }
        }
    }

    private shouldAutoIncludeForAudit(entry: RepairSceneEntry): boolean {
        if (entry.needsReview) return true;
        if (entry.source === 'keyword' || entry.source === 'ai') return true;
        return false;
    }

    private updateAuditFooter(): void {
        if (!this.auditFooterEl) return;
        const count = this.auditIncluded.size;
        this.auditFooterEl.toggleClass('ert-is-empty', count === 0);
        const btn = this.auditFooterEl.querySelector<HTMLButtonElement>('.ert-timeline-repair-audit-open-btn');
        if (btn) {
            btn.disabled = false;
            btn.setText(count === 0
                ? t('timelineRepairModal.review.openAuditButtonAll')
                : t('timelineRepairModal.review.openAuditButton', { count }));
        }
    }

    private openFocusedAudit(): void {
        const focused = this.auditIncluded.size > 0 ? new Set(this.auditIncluded) : undefined;
        this.close();
        new TimelineAuditModal(this.app, this.plugin, focused ? { focusedPaths: focused } : {}).open();
    }

    private collectOpenNotePaths(): Set<string> {
        const paths = new Set<string>();
        this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
            const view = leaf.view as { file?: TFile } | undefined;
            const file = view?.file;
            if (file && typeof file.path === 'string') {
                paths.add(file.path);
            }
        });
        return paths;
    }

    private refreshOpenNoteHighlights(): void {
        if (!this.sceneListEl) return;
        this.openNotePaths = this.collectOpenNotePaths();
        const cards = this.sceneListEl.querySelectorAll<HTMLElement>('[data-ert-path]');
        cards.forEach(card => {
            const path = card.getAttribute('data-ert-path');
            const isOpen = path !== null && this.openNotePaths.has(path);
            card.toggleClass('ert-is-open-note', isOpen);

            const existingBadge = card.querySelector<HTMLElement>('.ert-timeline-repair-open-badge');
            if (isOpen && !existingBadge) {
                const titleEl = card.querySelector<HTMLElement>('.ert-timeline-repair-scene-title');
                if (titleEl?.parentElement) {
                    const badge = titleEl.parentElement.createSpan({ cls: 'ert-timeline-repair-open-badge' });
                    titleEl.parentElement.insertBefore(badge, titleEl.nextSibling);
                    setIcon(badge, 'file-text');
                    setTooltip(badge, t('timelineRepairModal.review.openInWorkspace'));
                }
            } else if (!isOpen && existingBadge) {
                existingBadge.remove();
            }
        });
    }

    private renderSceneList(): void {
        if (!this.sceneListEl || !this.session) return;

        this.sceneListEl.empty();

        // Detect scenes whose effective When timestamp collides with another
        // scene. Computed live (not stored on entries) so any edit-induced
        // duplicate flags up immediately on the next render.
        this.duplicateWhenIndices = new Set();
        const tsMap = new Map<number, number[]>();
        for (const e of this.session.entries) {
            const t = getEffectiveWhen(e).getTime();
            const list = tsMap.get(t);
            if (list) list.push(e.manuscriptIndex);
            else tsMap.set(t, [e.manuscriptIndex]);
        }
        for (const indices of tsMap.values()) {
            if (indices.length > 1) {
                for (const i of indices) this.duplicateWhenIndices.add(i);
            }
        }

        // Compute or reuse chronological order. We freeze the order across
        // edit re-renders so individual rows don't jump while the author is
        // clicking. The snapshot clears on filter/mode change or after a
        // debounced timer (see scheduleResort).
        if (!this.chronoOrderSnapshot) {
            const sorted = this.session.entries.slice().sort((a, b) => {
                const dt = getEffectiveWhen(a).getTime() - getEffectiveWhen(b).getTime();
                return dt !== 0 ? dt : a.manuscriptIndex - b.manuscriptIndex;
            });
            this.chronoOrderSnapshot = sorted.map(e => e.file.path);
        }
        const orderIndex = new Map<string, number>();
        for (let i = 0; i < this.chronoOrderSnapshot.length; i++) {
            orderIndex.set(this.chronoOrderSnapshot[i], i);
        }

        // Filter entries
        let entries = this.session.entries;

        if (this.filterNeedsReview) {
            entries = entries.filter(e => e.needsReview);
        }
        if (this.filterKeywordDerived) {
            entries = entries.filter(e => e.source === 'keyword');
        }

        if (entries.length === 0) {
            this.sceneListEl.createDiv({
                cls: 'ert-timeline-repair-empty',
                text: t('timelineRepairModal.review.emptyFilter')
            });
            return;
        }

        // Apply the frozen chronological order.
        entries = entries.slice().sort((a, b) =>
            (orderIndex.get(a.file.path) ?? Number.MAX_SAFE_INTEGER) -
            (orderIndex.get(b.file.path) ?? Number.MAX_SAFE_INTEGER)
        );

        // Render scene cards. chronoPosition is the row's 1-based position in
        // the displayed chronological order — distinct from manuscriptIndex
        // (story order) which drives the N pill.
        for (let i = 0; i < entries.length; i++) {
            this.renderSceneCard(entries[i], i + 1);
        }

        // Clear the just-edited and rippled markers so they only fire once
        // per edit. The CSS animation runs on freshly-mounted cards; clearing
        // here ensures unrelated re-renders (filter toggles, snapshots)
        // don't re-flash a stale edit.
        this.lastEditedSceneIndex = undefined;
        this.lastRippledIndices = undefined;
    }

    private renderSceneCard(entry: RepairSceneEntry, chronoPosition: number): void {
        if (!this.sceneListEl || !this.session) return;

        const idx = entry.manuscriptIndex;
        const effectiveWhen = getEffectiveWhen(entry);
        const currentBucket = detectTimeBucket(effectiveWhen);

        const card = this.sceneListEl.createDiv({ cls: 'ert-timeline-repair-scene-card' });
        card.setAttribute('data-ert-path', entry.file.path);
        if (entry.needsReview) card.addClass('ert-needs-review');
        if (entry.hasBackwardTime) card.addClass('ert-has-backward-time');
        if (this.duplicateWhenIndices.has(idx)) card.addClass('ert-has-duplicate-when');
        if (entry.source === 'authored') card.addClass('ert-is-authored');
        if (this.openNotePaths.has(entry.file.path)) {
            card.addClass('ert-is-open-note');
        }
        if (this.auditIncluded.has(entry.file.path)) {
            card.addClass('ert-is-audit-selected');
        }
        if (this.lastRippledIndices?.has(idx)) {
            card.addClass('ert-is-rippled');
        }

        if (this.lastEditedSceneIndex === idx) {
            card.addClass('ert-is-just-edited');
            // Only scroll if the card is fully OFF-screen. `block: 'nearest'`
            // alone scrolls partially-visible rows to the bottom, which feels
            // like a snap. Author can always rely on the pulse to find the row
            // when it IS visible.
            const list = this.sceneListEl;
            if (list) {
                window.requestAnimationFrame(() => {
                    const cardRect = card.getBoundingClientRect();
                    const listRect = list.getBoundingClientRect();
                    const isPartiallyVisible =
                        cardRect.bottom > listRect.top && cardRect.top < listRect.bottom;
                    if (!isPartiallyVisible) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }
        }

        // Two-line content area
        const contentArea = card.createDiv({ cls: 'ert-timeline-repair-card-content' });

        // LINE 1: identity + signal
        const line1 = contentArea.createDiv({ cls: 'ert-timeline-repair-line1' });

        const chronoNumber = line1.createSpan({
            text: `#${chronoPosition}`,
            cls: 'ert-timeline-repair-scene-number'
        });
        setTooltip(chronoNumber, t('timelineRepairModal.review.chronoPosition', { count: chronoPosition }));
        line1.createSpan({
            text: entry.scene.title || t('timelineRepairModal.review.untitled'),
            cls: 'ert-timeline-repair-scene-title'
        });

        const narrativePill = line1.createSpan({
            cls: 'ert-timeline-repair-narrative-pill',
            text: `N${idx + 1}`
        });
        setTooltip(narrativePill, t('timelineRepairModal.review.narrativePlacement', { count: idx + 1 }));

        // Status / warning icons — clustered together after the title pills
        // so the row reads: identity → state icons → evidence (cue chips).
        // The open-note marker is a state, not a warning, but it groups with
        // the others as part of the icon cluster.
        if (this.openNotePaths.has(entry.file.path)) {
            const openBadge = line1.createSpan({ cls: 'ert-timeline-repair-open-badge' });
            setIcon(openBadge, 'file-text');
            setTooltip(openBadge, t('timelineRepairModal.review.openInWorkspace'));
        }
        if (entry.originalWhen === null && entry.source !== 'authored') {
            const missingBadge = line1.createSpan({ cls: 'ert-timeline-repair-missing-badge' });
            setIcon(missingBadge, 'calendar-off');
            setTooltip(missingBadge, t('timelineRepairModal.review.warningMissingWhen'));
        }
        if (entry.hasBackwardTime) {
            const warningBadge = line1.createSpan({ cls: 'ert-timeline-repair-warning-badge' });
            setIcon(warningBadge, 'alert-triangle');
            warningBadge.setAttribute('aria-label', t('timelineRepairModal.review.warningBackwardTime'));
        }
        if (entry.hasLargeGap) {
            const gapBadge = line1.createSpan({ cls: 'ert-timeline-repair-gap-badge' });
            setIcon(gapBadge, 'clock');
            gapBadge.setAttribute('aria-label', t('timelineRepairModal.review.warningLargeGap'));
        }
        if (this.duplicateWhenIndices.has(idx)) {
            const dupBadge = line1.createSpan({ cls: 'ert-timeline-repair-duplicate-badge' });
            setIcon(dupBadge, 'copy');
            setTooltip(dupBadge, t('timelineRepairModal.review.warningDuplicateWhen'));
        }

        // Pattern compliance chip — sits at the right edge of line 1.
        const compliance = this.getComplianceState(entry);
        const complianceChip = line1.createSpan({
            cls: 'ert-timeline-repair-compliance-chip'
        });
        complianceChip.addClass(`ert-compliance-${compliance.className}`);
        complianceChip.setText(compliance.label);

        // Cue chips: editorial evidence, last in the row so the icon cluster
        // and compliance chip stay visually adjacent regardless of cue count.
        if (entry.cues?.length) {
            for (const cue of entry.cues) {
                const cueChip = line1.createEl('a', { cls: 'ert-timeline-repair-cue-chip' });
                cueChip.setText(`"${cue.match}"`);
                cueChip.setAttribute('aria-label', `Open note and search for "${cue.match}"`);
                cueChip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    void this.openCueInFreshTab(entry.file, cue.match);
                    this.close();
                });
            }
        }

        // LINE 2: timeline + actions
        const line2 = contentArea.createDiv({ cls: 'ert-timeline-repair-line2' });

        // Left: proposed + comparison
        const whenArea = line2.createDiv({ cls: 'ert-timeline-repair-when-area' });

        // Proposed When (primary, prominent)
        const proposedLine = whenArea.createDiv({ cls: 'ert-timeline-repair-proposed-when' });
        proposedLine.createSpan({
            text: formatWhenForDisplay(effectiveWhen),
            cls: 'ert-timeline-repair-proposed-date'
        });
        proposedLine.createSpan({
            text: ` · ${describeWhenLabel(effectiveWhen, currentBucket)}`,
            cls: 'ert-timeline-repair-proposed-bucket'
        });

        // Current When comparison (secondary, smaller) — only if different
        if (entry.originalWhen && entry.source !== 'authored') {
            const originalDisplay = formatWhenForDisplay(entry.originalWhen);
            const proposedDisplay = formatWhenForDisplay(effectiveWhen);
            const originalBucket = detectTimeBucket(entry.originalWhen);

            if (originalDisplay !== proposedDisplay || originalBucket !== currentBucket) {
                const comparisonLine = whenArea.createDiv({ cls: 'ert-timeline-repair-original-when' });
                comparisonLine.setText(`was ${originalDisplay} · ${describeWhenLabel(entry.originalWhen, originalBucket)}`);
            }
        }

        // Right: controls
        const controlsArea = line2.createDiv({ cls: 'ert-timeline-repair-controls' });

        const buildShiftBtn = (icon: string, tooltipKey: string, onClick: () => void): HTMLElement => {
            const btn = controlsArea.createEl('button', { cls: 'ert-iconBtn ert-timeline-repair-shift-btn' });
            setIcon(btn, icon);
            setTooltip(btn, t(tooltipKey));
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                onClick();
            });
            return btn;
        };

        buildShiftBtn('chevrons-left', 'timelineRepairModal.review.shiftDayBack', () => this.handleDayShift(idx, -1));
        buildShiftBtn('chevron-left', 'timelineRepairModal.review.shiftHourBack', () => this.handleHourShift(idx, -1));

        // Time bucket pills — icon-only, Lucide sunrise/sun/sunset/moon.
        // ert-iconBtn opts out of the generic .ert-ui.ert-scope--modal button
        // rule (min-height + horizontal padding) so the 22×22 squares hold.
        const bucketRow = controlsArea.createDiv({ cls: 'ert-timeline-repair-bucket-controls' });

        const buckets: { id: TimeBucket; icon: string }[] = [
            { id: 'morning', icon: 'sunrise' },
            { id: 'afternoon', icon: 'sun' },
            { id: 'evening', icon: 'sunset' },
            { id: 'night', icon: 'moon' }
        ];
        for (const bucket of buckets) {
            const pill = bucketRow.createEl('button', {
                cls: 'ert-iconBtn ert-timeline-repair-bucket-pill'
            });
            setIcon(pill, bucket.icon);
            setTooltip(pill, TIME_BUCKET_LABELS[bucket.id]);

            if (bucket.id === currentBucket) {
                pill.addClass('ert-is-active');
            }

            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleTimeBucketChange(idx, TIME_BUCKET_HOURS[bucket.id]);
            });
        }

        buildShiftBtn('chevron-right', 'timelineRepairModal.review.shiftHourForward', () => this.handleHourShift(idx, 1));
        buildShiftBtn('chevrons-right', 'timelineRepairModal.review.shiftDayForward', () => this.handleDayShift(idx, 1));

        // Audit handoff toggle (subtle, single icon).
        // ert-iconBtn opts out of the generic .ert-ui.ert-scope--modal button
        // rule which would otherwise apply min-height + horizontal padding
        // and crush the icon out of view.
        const auditBtn = controlsArea.createEl('button', { cls: 'ert-iconBtn ert-timeline-repair-audit-toggle' });
        setIcon(auditBtn, 'search');
        const isIncluded = this.auditIncluded.has(entry.file.path);
        if (isIncluded) auditBtn.addClass('ert-is-active');
        setTooltip(auditBtn, isIncluded
            ? t('timelineRepairModal.review.auditToggleOn')
            : t('timelineRepairModal.review.auditToggleOff'));
        auditBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const path = entry.file.path;
            if (this.auditIncluded.has(path)) {
                this.auditIncluded.delete(path);
                auditBtn.removeClass('ert-is-active');
                card.removeClass('ert-is-audit-selected');
                setTooltip(auditBtn, t('timelineRepairModal.review.auditToggleOff'));
            } else {
                this.auditIncluded.add(path);
                auditBtn.addClass('ert-is-active');
                card.addClass('ert-is-audit-selected');
                setTooltip(auditBtn, t('timelineRepairModal.review.auditToggleOn'));
            }
            this.updateAuditFooter();
        });
    }

    private getComplianceState(entry: RepairSceneEntry): { label: string; className: string } {
        if (entry.isFlashback) {
            return { label: entry.flashbackLabel ?? 'flashback', className: 'flashback' };
        }
        if (entry.needsReview) return { label: 'needs review', className: 'needs-review' };
        if (entry.source === 'authored') return { label: 'authored', className: 'authored' };
        if (entry.source === 'keyword' || entry.source === 'ai') return { label: 'cue-adjusted', className: 'cue-adjusted' };
        return { label: 'pattern-based', className: 'pattern-based' };
    }

    private captureRippledIndices(sceneIndex: number): void {
        if (!this.session) return;
        const lastOp = this.session.undoStack[this.session.undoStack.length - 1];
        if (lastOp?.type === 'ripple' && lastOp.changes?.length) {
            this.lastRippledIndices = new Set(
                lastOp.changes
                    .map(c => c.sceneIndex)
                    .filter(i => i !== sceneIndex)
            );
        } else {
            this.lastRippledIndices = undefined;
        }
    }

    /**
     * Schedule a re-sort of the chronological order ~500ms after the last
     * edit. While the timer is pending, edits keep the row stable in its
     * current visual position (the chronoOrderSnapshot is preserved). When
     * the timer fires, the snapshot clears and the next render re-sorts; the
     * pending edit index is restored so the row pulses at its NEW position.
     */
    private scheduleResort(sceneIndex: number): void {
        this.pendingResortEditIndex = sceneIndex;
        if (this.resortTimer !== undefined) {
            window.clearTimeout(this.resortTimer);
        }
        this.resortTimer = window.setTimeout(() => {
            this.resortTimer = undefined;
            this.chronoOrderSnapshot = undefined;
            this.lastEditedSceneIndex = this.pendingResortEditIndex;
            this.pendingResortEditIndex = undefined;
            this.renderSceneList();
        }, 500);
    }

    private handleDayShift(sceneIndex: number, days: number): void {
        if (!this.session) return;
        this.session = shiftSceneDays(this.session, sceneIndex, days);
        this.lastEditedSceneIndex = sceneIndex;
        this.captureRippledIndices(sceneIndex);
        this.scheduleResort(sceneIndex);
        this.renderSceneList();
        this.updateSummaryBar();
    }

    private handleHourShift(sceneIndex: number, hours: number): void {
        if (!this.session) return;
        this.session = shiftSceneHours(this.session, sceneIndex, hours);
        this.lastEditedSceneIndex = sceneIndex;
        this.captureRippledIndices(sceneIndex);
        this.scheduleResort(sceneIndex);
        this.renderSceneList();
        this.updateSummaryBar();
    }

    private handleTimeBucketChange(sceneIndex: number, hour: number): void {
        if (!this.session) return;
        this.session = setSceneTimeBucket(this.session, sceneIndex, hour);
        this.lastEditedSceneIndex = sceneIndex;
        this.captureRippledIndices(sceneIndex);
        this.scheduleResort(sceneIndex);
        this.renderSceneList();
        this.updateSummaryBar();
    }

    // ========================================================================
    // Keyboard Navigation
    // ========================================================================

    private setupKeyboardNavigation(): void {
        this.scope.register([], 'j', () => this.navigateScene(1));
        this.scope.register([], 'k', () => this.navigateScene(-1));
        this.scope.register([], '[', () => this.shiftFocusedScene(-1));
        this.scope.register([], ']', () => this.shiftFocusedScene(1));
    }

    private navigateScene(delta: number): boolean {
        if (this.phase !== 'review' || !this.sceneListEl) return false;

        const cards = this.sceneListEl.querySelectorAll('.ert-timeline-repair-scene-card');
        if (cards.length === 0) return false;

        const focused = this.sceneListEl.querySelector('.ert-timeline-repair-scene-card:focus');
        let currentIdx = focused ? Array.from(cards).indexOf(focused) : -1;

        const newIdx = Math.max(0, Math.min(cards.length - 1, currentIdx + delta));
        (cards[newIdx] as HTMLElement).focus();

        return true;
    }

    private shiftFocusedScene(days: number): boolean {
        if (this.phase !== 'review' || !this.sceneListEl || !this.session) return false;

        const focused = this.sceneListEl.querySelector('.ert-timeline-repair-scene-card:focus');
        if (!focused) return false;

        const cards = Array.from(this.sceneListEl.querySelectorAll('.ert-timeline-repair-scene-card'));
        const cardIdx = cards.indexOf(focused);

        // Get the scene index from the filtered list
        const visibleEntries = this.getVisibleEntries();
        if (cardIdx >= 0 && cardIdx < visibleEntries.length) {
            const sceneIdx = visibleEntries[cardIdx].manuscriptIndex;
            this.handleDayShift(sceneIdx, days);
        }

        return true;
    }

    private getVisibleEntries(): RepairSceneEntry[] {
        if (!this.session) return [];

        let entries = this.session.entries;

        if (this.filterNeedsReview) {
            entries = entries.filter(e => e.needsReview);
        }
        if (this.filterKeywordDerived) {
            entries = entries.filter(e => e.source === 'keyword');
        }

        return entries;
    }

    // ========================================================================
    // Apply Changes
    // ========================================================================

    private async applyChanges(): Promise<void> {
        if (!this.session || !this.config) return;

        const summary = getChangeSummary(this.session);

        if (summary.totalChanges === 0) {
            new Notice(t('timelineRepairModal.apply.noChangesNotice'));
            return;
        }

        // Confirm
        const confirmed = await this.showConfirmDialog(summary.totalChanges);
        if (!confirmed) return;

        const written = await this.persistSessionChanges();
        if (written === null) return;
        if (written.failed === 0) {
            new Notice(t('timelineRepairModal.apply.successWithSnapshotNotice', { count: written.success }));
        }
        this.close();
    }

    /**
     * Snapshot then write the session's changes. Shared by the review-phase
     * Apply and the express path. Returns the write result, or null when the
     * write was aborted (snapshot failure) or threw. Partial-failure notices
     * are raised here; full-success notices are the caller's, since the two
     * paths phrase success differently.
     */
    private async persistSessionChanges(): Promise<{ success: number; failed: number } | null> {
        if (!this.session || !this.config) return null;

        // Capture restore-point BEFORE writing. If snapshot fails, abort —
        // the author is about to do a mass overwrite and the restore point
        // is the cheap insurance that makes that decision safe.
        try {
            const snapshot = buildTimelineSnapshot(this.session, {
                patternPreset: this.config.patternPreset,
                preserveAuthoredDates: this.config.preserveAuthoredDates,
                useTextCues: this.config.useTextCues
            });
            await saveTimelineSnapshot(this.app, snapshot);
        } catch (error) {
            new Notice(t('timelineRepairModal.apply.snapshotFailedNotice', {
                message: error instanceof Error ? error.message : String(error)
            }));
            return null;
        }

        try {
            const result = await writeSessionChanges(this.app, this.session, {
                onProgress: () => {
                    // Could show progress here
                }
            });
            if (result.failed > 0) {
                new Notice(t('timelineRepairModal.apply.partialNotice', { success: result.success, failed: result.failed }));
            }
            return result;
        } catch (error) {
            new Notice(`Failed to apply changes: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    private async handleRestoreLatestSnapshot(): Promise<void> {
        try {
            const meta = await getLatestTimelineSnapshot(this.app);
            if (!meta) {
                new Notice(t('timelineRepairModal.restore.noSnapshotNotice'));
                return;
            }
            const result = await restoreTimelineSnapshot(this.app, meta);
            if (result.failed > 0) {
                new Notice(t('timelineRepairModal.restore.partialNotice', {
                    restored: result.restored,
                    failed: result.failed,
                    label: result.snapshotLabel
                }));
            } else {
                new Notice(t('timelineRepairModal.restore.successNotice', {
                    restored: result.restored,
                    label: result.snapshotLabel
                }));
            }
            this.close();
        } catch (error) {
            new Notice(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private showConfirmDialog(changeCount: number): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText(t('timelineRepairModal.confirm.title'));

            modal.contentEl.createDiv({
                text: t('timelineRepairModal.confirm.description', { count: changeCount })
            });
            modal.contentEl.createDiv({
                text: t('timelineRepairModal.confirm.warning'),
                cls: 'ert-timeline-repair-confirm-warning'
            });

            const buttonRow = modal.contentEl.createDiv({ cls: 'ert-modal-actions' });

            new ButtonComponent(buttonRow)
                .setButtonText(t('timelineRepairModal.confirm.applyButton'))
                .setCta()
                .onClick(() => {
                    modal.close();
                    resolve(true);
                });

            new ButtonComponent(buttonRow)
                .setButtonText(t('timelineRepairModal.confirm.cancelButton'))
                .onClick(() => {
                    modal.close();
                    resolve(false);
                });

            modal.open();
        });
    }
}

export default TimelineRepairModal;
