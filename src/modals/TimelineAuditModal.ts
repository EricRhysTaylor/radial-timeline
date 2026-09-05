/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Auditor Modal
 */

import { App, ButtonComponent, Modal, Notice, setIcon, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { renderWithYamlTokens } from '../utils/yamlTokenRender';
import { applyAuditFindings, buildAuditApplyPlan } from '../timelineAudit/apply';
import { buildSnapshotFromFiles, saveTimelineSnapshot } from '../timelineRepair/timelineSnapshot';
import { TimelineRepairModal } from './TimelineRepairModal';
import { runAuditPipeline } from '../timelineAudit/AuditPipeline';
import { buildTimelineOverviewEntries, scrollFindingCardIntoView } from '../timelineAudit/TimelineOverviewStrip';
import {
    describeAuditIssue,
    getAuditDisplayTitle,
    formatAuditIssueLabel,
    formatAuditStatusLabel,
    getAuditFindingBadgeLabels,
    getAuditFindingPreviewSnippet,
    getInitialExpandedFindingPath
} from '../timelineAudit/presentation';
import {
    TIMELINE_AUDIT_AI_STATE_EVENT,
    buildTimelineAuditAiContextKey,
    buildTimelineAuditAiScopeKey,
    createTimelineAuditAiJobState,
    freezeTimelineAuditAiScope,
    resolveTimelineAuditAiScopeKey,
    resolveTimelineAuditDisplayResult,
    type TimelineAuditAiJobState
} from '../services/TimelineAuditAiService';
import type {
    TimelineAuditAiScope,
    TimelineAuditAiScopeMode,
    TimelineAuditAiTimelineRole,
    TimelineAuditDetectionSource,
    TimelineAuditEvidenceSource,
    TimelineAuditEvidenceTier,
    TimelineAuditFinding,
    TimelineAuditPipelineConfig,
    TimelineAuditResult
} from '../timelineAudit/types';

type FindingFilter =
    | 'all'
    | 'contradictions'
    | 'missing_when'
    | 'summary_body_disagreement'
    | 'continuity_problems'
    | 'ai_checked'
    | 'ai_suggested'
    | 'unresolved';

export class TimelineAuditModal extends Modal {
    private readonly plugin: RadialTimelinePlugin;

    private result: TimelineAuditResult | null = null;
    private running = false;
    private runContinuityPass = true;
    private filter: FindingFilter = 'all';
    private abortController: AbortController | null = null;
    private unsubscribeAiState: (() => void) | null = null;
    private aiState: TimelineAuditAiJobState = createTimelineAuditAiJobState();
    private expandedFindingPath: string | null = null;
    private hasAutoExpandedCurrentResult = false;
    private readonly findingCardEls = new Map<string, HTMLElement>();
    private focusedPaths: Set<string> | null = null;
    private aiScopeMode: TimelineAuditAiScopeMode = 'manuscript';
    private aiRangeStart = 1;
    private aiRangeEnd = 0;
    private activeAiScope: TimelineAuditAiScope | null = null;
    private activeAiScopeKey: string | null = null;
    private reviewActionsBeforeAi = new Map<string, TimelineAuditFinding['reviewAction']>();

    constructor(app: App, plugin: RadialTimelinePlugin, options: { focusedPaths?: Set<string> } = {}) {
        super(app);
        this.plugin = plugin;
        if (options.focusedPaths && options.focusedPaths.size > 0) {
            this.focusedPaths = new Set(options.focusedPaths);
            this.aiScopeMode = 'focused';
        }
    }

    async onOpen(): Promise<void> {
        const { contentEl, titleEl, modalEl } = this;
        titleEl.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-timeline-audit-modal-shell');
            modalEl.setCssStyles({ width: '960px', maxWidth: '96vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }

        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-timeline-audit-modal');
        this.restoreLatestAiState();
        this.unsubscribeAiState = this.plugin.subscribe<TimelineAuditAiJobState>(
            TIMELINE_AUDIT_AI_STATE_EVENT,
            () => {
                const previousStatus = this.aiState.status;
                this.refreshAiState();
                if (this.aiState.status === 'completed' && previousStatus !== 'completed') {
                    this.restoreReviewActions(this.aiState.result);
                    this.expandedFindingPath = null;
                    this.hasAutoExpandedCurrentResult = false;
                }
                if (!this.running) {
                    this.render();
                }
            }
        );

        await this.runAudit();
    }

    onClose(): void {
        this.abortController?.abort();
        this.unsubscribeAiState?.();
        this.unsubscribeAiState = null;
    }

    private getConfig(): TimelineAuditPipelineConfig {
        return {
            runDeterministicPass: true,
            runContinuityPass: this.runContinuityPass,
            runAiInference: false,
            chronologyWindow: 2,
            bodyExcerptChars: 2600
        };
    }

    private getAiScopeSourceResult(): TimelineAuditResult | null {
        return this.aiState.result ?? this.result;
    }

    private buildConfiguredAiScope(): TimelineAuditAiScope {
        const ordered = (this.getAiScopeSourceResult()?.findings ?? []) // SAFE: no audit result means there are no selectable scenes yet
            .slice()
            .sort((a, b) => a.manuscriptOrderIndex - b.manuscriptOrderIndex);

        if (this.aiScopeMode === 'manuscript') {
            return { mode: 'manuscript' };
        }

        if (this.aiScopeMode === 'focused') {
            if (!this.focusedPaths) {
                throw new Error('Focused Timeline Audit scope requires focused scene paths.');
            }
            return { mode: 'focused', paths: Array.from(this.focusedPaths) };
        }

        if (this.aiScopeMode === 'marked') {
            return {
                mode: 'marked',
                paths: ordered
                    .filter(finding => finding.reviewAction === 'mark_review')
                    .map(finding => finding.path)
            };
        }

        const total = ordered.length;
        const start = Math.min(Math.max(1, this.aiRangeStart), Math.max(total, 1));
        const end = Math.min(Math.max(start, this.aiRangeEnd || total), Math.max(total, 1)); // SAFE: zero means the range has not been initialized, so it extends to the final scene
        return {
            mode: 'range',
            startScene: start,
            endScene: end,
            paths: ordered
                .filter(finding => {
                    const sceneNumber = finding.manuscriptOrderIndex + 1;
                    return sceneNumber >= start && sceneNumber <= end;
                })
                .map(finding => finding.path)
        };
    }

    private getAiScope(): TimelineAuditAiScope {
        return this.activeAiScope ?? this.buildConfiguredAiScope();
    }

    private getAiScopeCount(scope = this.getAiScope()): number {
        if (scope.mode === 'manuscript') {
            return this.getAiScopeSourceResult()?.stats.totalScenes ?? 0; // SAFE: no result means the current manuscript scan contains zero known scenes
        }
        return scope.paths?.length ?? 0; // SAFE: only manuscript scope may omit paths, and it is handled above
    }

    private getAiScopeLabel(scope = this.getAiScope()): string {
        const count = this.getAiScopeCount(scope);
        switch (scope.mode) {
            case 'range':
                return t('timelineAuditModal.aiScope.rangeSummary', {
                    start: scope.startScene ?? 1, // SAFE: malformed legacy in-memory range state displays the first scene instead of an empty label
                    end: scope.endScene ?? 1, // SAFE: malformed legacy in-memory range state displays the first scene instead of an empty label
                    count
                });
            case 'marked':
                return t('timelineAuditModal.aiScope.markedSummary', { count });
            case 'focused':
                return t('timelineAuditModal.aiScope.focusedSummary', { count });
            case 'manuscript':
                return t('timelineAuditModal.aiScope.manuscriptSummary', { count });
        }
    }

    private getAiScopeKey(): string {
        const configuredScopeKey = buildTimelineAuditAiScopeKey(
            this.plugin,
            this.runContinuityPass,
            this.buildConfiguredAiScope()
        );
        return resolveTimelineAuditAiScopeKey(this.activeAiScopeKey, configuredScopeKey);
    }

    private clearActiveAiScope(): void {
        this.activeAiScope = null;
        this.activeAiScopeKey = null;
    }

    private restoreLatestAiState(): void {
        const latest = this.plugin.getTimelineAuditAiService().getLatestState();
        const contextKey = buildTimelineAuditAiContextKey(this.plugin, this.runContinuityPass);
        const focusedEntryMatches = !this.focusedPaths || (
            latest.scope?.mode === 'focused'
            && latest.scope.paths?.length === this.focusedPaths.size
            && latest.scope.paths.every(path => this.focusedPaths?.has(path))
        );
        if (latest.contextKey !== contextKey || !latest.scopeKey || !latest.scope || !focusedEntryMatches) {
            this.clearActiveAiScope();
            this.aiState = createTimelineAuditAiJobState();
            return;
        }

        this.activeAiScope = freezeTimelineAuditAiScope(latest.scope);
        this.activeAiScopeKey = latest.scopeKey;
        this.aiScopeMode = latest.scope.mode;
        if (latest.scope.mode === 'range') {
            this.aiRangeStart = latest.scope.startScene ?? 1; // SAFE: legacy in-memory range state without a start begins at scene one
            this.aiRangeEnd = latest.scope.endScene ?? this.aiRangeStart; // SAFE: legacy in-memory range state without an end collapses to its start
        }
        this.aiState = latest;
    }

    private refreshAiState(): void {
        if (!this.activeAiScopeKey) {
            this.restoreLatestAiState();
            return;
        }
        this.aiState = this.plugin.getTimelineAuditAiService().getState(this.activeAiScopeKey);
    }

    private getDisplayedResult(): TimelineAuditResult | null {
        return resolveTimelineAuditDisplayResult(this.result, this.aiState, this.getAiScopeKey());
    }

    private async runAudit(options: { invalidateAi?: boolean } = {}): Promise<void> {
        if (options.invalidateAi) {
            this.plugin.getTimelineAuditAiService().invalidate(this.getAiScopeKey());
            this.clearActiveAiScope();
        }

        this.aiState = this.plugin.getTimelineAuditAiService().getState(this.getAiScopeKey());
        this.running = true;
        this.abortController?.abort();
        this.abortController = new AbortController();
        this.render();

        try {
            this.result = await runAuditPipeline(this.plugin, this.getConfig(), {
                abortSignal: this.abortController.signal
            });
        } catch (error) {
            if (!this.abortController.signal.aborted) {
                new Notice(`Timeline audit failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            this.running = false;
            if (this.result && this.aiRangeEnd === 0) {
                this.aiRangeEnd = this.result.stats.totalScenes;
            }
            this.expandedFindingPath = null;
            this.hasAutoExpandedCurrentResult = false;
            if (this.activeAiScopeKey) {
                this.refreshAiState();
            } else {
                this.restoreLatestAiState();
            }
            this.render();
        }
    }

    private startAiAudit(): void {
        const aiService = this.plugin.getTimelineAuditAiService();
        const latest = aiService.getLatestState();
        if (latest.status === 'running') {
            this.restoreLatestAiState();
            new Notice(t('timelineAuditModal.notices.aiScanAlreadyRunning'));
            this.render();
            return;
        }

        const aiScope = freezeTimelineAuditAiScope(this.buildConfiguredAiScope());
        const sceneCount = this.getAiScopeCount(aiScope);
        if (sceneCount === 0) {
            new Notice(t('timelineAuditModal.notices.emptyAiScope'));
            return;
        }

        this.reviewActionsBeforeAi.clear();
        for (const finding of this.getDisplayedResult()?.findings ?? []) { // SAFE: an absent result contains no review decisions to preserve
            this.reviewActionsBeforeAi.set(finding.path, finding.reviewAction);
        }

        const scopeKey = buildTimelineAuditAiScopeKey(this.plugin, this.runContinuityPass, aiScope);
        this.activeAiScope = aiScope;
        this.activeAiScopeKey = scopeKey;
        void aiService.start(scopeKey, {
            runContinuityPass: this.runContinuityPass,
            chronologyWindow: 2,
            // AI chronology reads the full scene. Each scene is dispatched as
            // its own request with compact narrative-neighbor context, which
            // keeps Local LLM context bounded while avoiding a first-page-only
            // blind spot.
            bodyExcerptChars: 0,
            aiScope,
            aiScopeLabel: this.getAiScopeLabel(aiScope)
        });
        this.aiState = aiService.getState(scopeKey);
        this.render();
    }

    private restoreReviewActions(result: TimelineAuditResult | null): void {
        if (!result || this.reviewActionsBeforeAi.size === 0) return;
        for (const finding of result.findings) {
            const action = this.reviewActionsBeforeAi.get(finding.path);
            if (!action) continue;
            finding.reviewAction = action;
            finding.unresolved = action === 'apply' ? false : finding.status !== 'aligned' || action === 'mark_review';
        }
    }

    private syncExpandedFinding(findings: TimelineAuditFinding[]): void {
        const expandedStillVisible = this.expandedFindingPath
            ? findings.some((finding) => finding.path === this.expandedFindingPath)
            : false;

        if (!expandedStillVisible) {
            this.expandedFindingPath = null;
        }

        if (!this.hasAutoExpandedCurrentResult) {
            this.expandedFindingPath = getInitialExpandedFindingPath(findings);
            this.hasAutoExpandedCurrentResult = true;
        }
    }

    private toggleFindingExpansion(path: string): void {
        this.expandedFindingPath = this.expandedFindingPath === path ? null : path;
        this.render();
    }

    private expandFinding(path: string, scroll = false): void {
        this.expandedFindingPath = path;
        this.render();

        if (scroll) {
            window.requestAnimationFrame(() => {
                scrollFindingCardIntoView(this.findingCardEls, path);
            });
        }
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        const badgeRow = header.createDiv({ cls: 'ert-modal-badge-row' });
        badgeRow.createSpan({ cls: 'ert-modal-badge', text: t('timelineAuditModal.header.badge') });
        badgeRow.createSpan({ cls: 'ert-timeline-tool-pill', text: t('timelineAuditModal.header.aiPill') });
        header.createDiv({ cls: 'ert-modal-title', text: t('timelineAuditModal.header.title') });
        const subtitleEl = header.createDiv({ cls: 'ert-modal-subtitle' });
        renderWithYamlTokens(subtitleEl, t('timelineAuditModal.header.subtitle'));

        if (this.aiState.status === 'completed') {
            header.createDiv({
                cls: 'ert-timeline-audit-ai-header-badge',
                text: t('timelineAuditModal.header.aiEnhancedBadge')
            });
        }

        if (this.focusedPaths) {
            const focusBadge = header.createDiv({ cls: 'ert-timeline-audit-focus-badge' });
            focusBadge.setText(t('timelineAuditModal.header.focusedScope', { count: this.focusedPaths.size }));
            const clearBtn = focusBadge.createEl('button', {
                cls: 'ert-timeline-audit-focus-clear',
                text: t('timelineAuditModal.header.focusedClear')
            });
            clearBtn.disabled = this.aiState.status === 'running';
            clearBtn.addEventListener('click', () => {
                if (this.aiState.status === 'running') return;
                this.clearActiveAiScope();
                this.focusedPaths = null;
                if (this.aiScopeMode === 'focused') {
                    this.aiScopeMode = 'manuscript';
                }
                this.aiState = this.plugin.getTimelineAuditAiService().getState(this.getAiScopeKey());
                this.render();
            });
        }

        if (this.running) {
            const loadingCard = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-timeline-audit-loading' });
            loadingCard.createDiv({ cls: 'ert-timeline-audit-loading-title', text: t('timelineAuditModal.loading.title') });
            loadingCard.createDiv({
                cls: 'ert-timeline-audit-loading-copy',
                text: t('timelineAuditModal.loading.description')
            });

            const actionRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
            new ButtonComponent(actionRow)
                .setButtonText(t('timelineAuditModal.actions.abort'))
                .setDestructive()
                .onClick(() => {
                    this.abortController?.abort();
                    this.running = false;
                    this.render();
                });
            return;
        }

        const displayedResult = this.getDisplayedResult();
        if (!displayedResult) {
            const emptyCard = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-timeline-audit-loading' });
            emptyCard.createDiv({ text: t('timelineAuditModal.empty.noResults') });
            return;
        }

        const findings = this.getFilteredFindings();
        this.syncExpandedFinding(findings);

        const book = this.plugin.getActiveBook();
        const statsCard = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-timeline-audit-stats' });
        const scopeRow = statsCard.createDiv({ cls: 'ert-timeline-audit-scope' });
        scopeRow.createSpan({
            cls: 'ert-timeline-audit-scope-book',
            text: this.plugin.getActiveBookTitle()
        });
        scopeRow.createSpan({
            cls: 'ert-timeline-audit-scope-path',
            text: t('timelineAuditModal.scope.activeScope', { path: book?.sourceFolder?.trim() || this.plugin.settings.sourcePath || t('timelineAuditModal.scope.entireVault') })
        });

        const statsGrid = statsCard.createDiv({ cls: 'ert-timeline-audit-stats-grid' });
        this.createStat(statsGrid, t('timelineAuditModal.stats.totalScenes'), String(displayedResult.stats.totalScenes));
        this.createStat(statsGrid, t('timelineAuditModal.stats.aligned'), String(displayedResult.stats.aligned));
        this.createStat(statsGrid, t('timelineAuditModal.stats.warnings'), String(displayedResult.stats.warnings));
        this.createStat(statsGrid, t('timelineAuditModal.stats.contradictions'), String(displayedResult.stats.contradictions));
        this.createStat(statsGrid, t('timelineAuditModal.stats.missingWhen'), String(displayedResult.stats.missingWhen));

        this.renderTimelineOverview(contentEl, findings);
        this.renderAuditActions(contentEl);

        const filterRow = contentEl.createDiv({ cls: 'ert-timeline-audit-filter-row' });
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.all'), 'all');
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.contradictions'), 'contradictions');
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.missingWhen'), 'missing_when');
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.summaryBodyDisagreement'), 'summary_body_disagreement');
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.continuityProblems'), 'continuity_problems');
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.aiChecked'), 'ai_checked');
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.aiSuggested'), 'ai_suggested');
        this.createFilterPill(filterRow, t('timelineAuditModal.filters.unresolved'), 'unresolved');

        // Bulk decisions — with dozens of findings, per-card clicking is the
        // bookkeeping these tools exist to remove. Acts on the findings the
        // current filter shows, so filter + bulk composes (e.g. filter to
        // Contradictions, then Mark all).
        if (findings.length > 0) {
            const bulkRow = contentEl.createDiv({ cls: 'ert-timeline-audit-bulk-row' });
            setTooltip(bulkRow, t('timelineAuditModal.bulk.scopeNote', { count: findings.length }));

            const safeCount = findings.filter(f => f.safeApplyEligible).length;
            new ButtonComponent(bulkRow)
                .setButtonText(t('timelineAuditModal.bulk.acceptSafe', { count: safeCount }))
                .setDisabled(safeCount === 0)
                .onClick(() => this.setBulkAction(findings, 'apply'));
            new ButtonComponent(bulkRow)
                .setButtonText(t('timelineAuditModal.bulk.keepAll'))
                .onClick(() => this.setBulkAction(findings, 'keep'));
            new ButtonComponent(bulkRow)
                .setButtonText(t('timelineAuditModal.bulk.markAll'))
                .onClick(() => this.setBulkAction(findings, 'mark_review'));
        }

        const findingsList = contentEl.createDiv({ cls: 'ert-timeline-audit-findings' });
        this.findingCardEls.clear();

        if (findings.length === 0) {
            const emptyState = findingsList.createDiv({ cls: 'ert-timeline-audit-empty ert-panel ert-panel--glass' });
            emptyState.createDiv({ text: t('timelineAuditModal.empty.noFindings') });
        } else {
            for (const finding of findings) {
                this.renderFindingListItem(findingsList, finding);
            }
        }

        contentEl.createDiv({
            cls: 'ert-timeline-tool-snapshot-note',
            text: t('timelineAuditModal.actions.snapshotAssurance')
        });

        const actionRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actionRow)
            .setButtonText(t('timelineAuditModal.actions.reRunAudit'))
            .onClick(() => {
                void this.runAudit({ invalidateAi: true });
            });

        new ButtonComponent(actionRow)
            .setButtonText(t('timelineAuditModal.actions.applyAccepted'))
            .setCta()
            .onClick(() => {
                void this.applyDecisions();
            });

        new ButtonComponent(actionRow)
            .setButtonText(t('timelineAuditModal.actions.close'))
            .onClick(() => this.close());
    }

    private renderAuditActions(container: HTMLElement): void {
        const actionsSection = container.createDiv({ cls: 'ert-timeline-audit-controls' });
        actionsSection.createDiv({ cls: 'ert-timeline-audit-controls-title', text: t('timelineAuditModal.controls.title') });

        const cards = actionsSection.createDiv({ cls: 'ert-timeline-audit-actions-grid' });

        const aiCard = cards.createDiv({ cls: 'ert-panel ert-panel--glass ert-timeline-audit-action-card' });
        const aiHeader = aiCard.createDiv({ cls: 'ert-timeline-audit-ai-card-header' });
        aiHeader.createDiv({ cls: 'ert-timeline-audit-action-card-title', text: t('timelineAuditModal.aiCard.title') });
        if (this.aiState.status === 'completed') {
            aiHeader.createDiv({ cls: 'ert-timeline-audit-ai-header-badge', text: t('timelineAuditModal.aiCard.aiEnhancedBadge') });
        }
        aiCard.createDiv({
            cls: 'ert-timeline-audit-action-card-copy',
            text: t('timelineAuditModal.aiCard.description')
        });

        this.renderAiScopeControls(aiCard);

        const statusCol = aiCard.createDiv({ cls: 'ert-timeline-audit-ai-status' });
        statusCol.createDiv({
            cls: 'ert-timeline-audit-ai-status-title',
            text: this.getAiStatusLabel()
        });

        const meta = this.getAiStatusMeta();
        if (meta) {
            statusCol.createDiv({
                cls: 'ert-timeline-audit-ai-status-meta',
                text: meta
            });
        }

        if (this.aiState.status === 'running') {
            const progressWrap = aiCard.createDiv({ cls: 'ert-timeline-audit-ai-progress' });
            const progressBar = progressWrap.createDiv({ cls: 'ert-timeline-audit-ai-progress-bar' });
            const hasProgress = this.aiState.progressTotal > 0 && this.aiState.progressCurrent > 0;
            const progressWidth = hasProgress
                ? `${Math.max(8, Math.round((this.aiState.progressCurrent / this.aiState.progressTotal) * 100))}%`
                : '22%';
            progressBar.style.width = progressWidth; // SAFE: inline style used for lightweight AI progress width in modal UI
            if (!hasProgress) {
                progressBar.addClass('ert-is-indeterminate');
            }
        }

        const aiRow = aiCard.createDiv({ cls: 'ert-timeline-audit-ai-action-row' });
        const aiButton = new ButtonComponent(aiRow);
        aiButton.setButtonText(this.getAiActionLabel());
        if (this.aiState.status === 'running') {
            aiButton.setDisabled(true);
        } else {
            aiButton.setCta();
            aiButton.onClick(() => this.startAiAudit());
        }
    }

    private setAiScopeMode(mode: TimelineAuditAiScopeMode): void {
        if (this.aiState.status === 'running') return;
        this.clearActiveAiScope();
        this.aiScopeMode = mode;
        this.aiState = this.plugin.getTimelineAuditAiService().getState(this.getAiScopeKey());
        this.expandedFindingPath = null;
        this.hasAutoExpandedCurrentResult = false;
        this.render();
    }

    private renderAiScopeControls(container: HTMLElement): void {
        const scopeWrap = container.createDiv({ cls: 'ert-timeline-audit-ai-scope' });
        scopeWrap.createDiv({
            cls: 'ert-timeline-audit-ai-scope-title',
            text: t('timelineAuditModal.aiScope.title')
        });

        const choices = scopeWrap.createDiv({ cls: 'ert-timeline-audit-ai-scope-choices' });
        const markedCount = (this.getAiScopeSourceResult()?.findings ?? []) // SAFE: no audit result means no scenes have been marked
            .filter(finding => finding.reviewAction === 'mark_review').length;
        const options: Array<{ mode: TimelineAuditAiScopeMode; label: string; disabled?: boolean }> = [
            { mode: 'manuscript', label: t('timelineAuditModal.aiScope.manuscript') },
            { mode: 'range', label: t('timelineAuditModal.aiScope.range') },
            { mode: 'marked', label: t('timelineAuditModal.aiScope.marked', { count: markedCount }), disabled: markedCount === 0 }
        ];
        if (this.focusedPaths && this.focusedPaths.size > 0) {
            options.push({
                mode: 'focused',
                label: t('timelineAuditModal.aiScope.focused', { count: this.focusedPaths.size })
            });
        }

        for (const option of options) {
            const button = choices.createEl('button', {
                cls: 'ert-timeline-audit-ai-scope-choice',
                text: option.label,
                attr: {
                    type: 'button',
                    'aria-pressed': this.aiScopeMode === option.mode ? 'true' : 'false'
                }
            });
            button.toggleClass('ert-is-active', this.aiScopeMode === option.mode);
            button.disabled = Boolean(option.disabled) || this.aiState.status === 'running';
            button.addEventListener('click', () => this.setAiScopeMode(option.mode));
        }

        if (this.aiScopeMode === 'range') {
            const total = this.getAiScopeSourceResult()?.stats.totalScenes ?? 0; // SAFE: range controls use zero while the initial audit is still loading
            const rangeRow = scopeWrap.createDiv({ cls: 'ert-timeline-audit-ai-range' });
            const startLabel = rangeRow.createEl('label');
            startLabel.createSpan({ text: t('timelineAuditModal.aiScope.fromScene') });
            const startInput = startLabel.createEl('input', {
                type: 'number',
                attr: { min: '1', max: String(Math.max(total, 1)), value: String(this.aiRangeStart) }
            });
            startInput.disabled = this.aiState.status === 'running';
            startInput.addEventListener('change', () => {
                this.clearActiveAiScope();
                this.aiRangeStart = Math.min(Math.max(1, startInput.valueAsNumber || 1), Math.max(total, 1)); // SAFE: an empty numeric field resets to scene one
                if (this.aiRangeEnd < this.aiRangeStart) this.aiRangeEnd = this.aiRangeStart;
                this.aiState = this.plugin.getTimelineAuditAiService().getState(this.getAiScopeKey());
                this.render();
            });

            const endLabel = rangeRow.createEl('label');
            endLabel.createSpan({ text: t('timelineAuditModal.aiScope.toScene') });
            const endInput = endLabel.createEl('input', {
                type: 'number',
                attr: { min: '1', max: String(Math.max(total, 1)), value: String(this.aiRangeEnd || total || 1) } // SAFE: before initialization the range ends at the final scene, or scene one for an empty manuscript
            });
            endInput.disabled = this.aiState.status === 'running';
            endInput.addEventListener('change', () => {
                this.clearActiveAiScope();
                this.aiRangeEnd = Math.min(Math.max(this.aiRangeStart, endInput.valueAsNumber || total || 1), Math.max(total, 1)); // SAFE: an empty numeric field extends to the final scene, or scene one when empty
                this.aiState = this.plugin.getTimelineAuditAiService().getState(this.getAiScopeKey());
                this.render();
            });
        }

        scopeWrap.createDiv({
            cls: 'ert-timeline-audit-ai-scope-summary',
            text: this.getAiScopeLabel()
        });
        scopeWrap.createDiv({
            cls: 'ert-timeline-audit-ai-scope-evidence',
            text: t('timelineAuditModal.aiScope.evidence', { provider: this.getActiveAiProviderLabel() })
        });
    }

    private getActiveAiProviderLabel(): string {
        const provider = this.plugin.settings.aiSettings?.provider;
        if (provider === 'ollama') return t('timelineAuditModal.aiScope.providerLocal');
        if (provider === 'anthropic') return 'Anthropic';
        if (provider === 'google') return 'Google';
        if (provider === 'openai') return 'OpenAI';
        return t('timelineAuditModal.aiScope.providerConfigured');
    }

    private getAiActionLabel(): string {
        const count = this.getAiScopeCount();
        switch (this.aiState.status) {
            case 'running':
                return t('timelineAuditModal.aiCard.actionRunning');
            case 'completed':
                return t('timelineAuditModal.aiCard.actionReRun', { count });
            case 'failed':
            case 'not_started':
                return t('timelineAuditModal.aiCard.actionStart', { count });
        }
    }

    private getAiStatusLabel(): string {
        switch (this.aiState.status) {
            case 'running':
                return t('timelineAuditModal.aiStatus.inProgress');
            case 'completed':
                return t('timelineAuditModal.aiStatus.complete');
            case 'failed':
                return t('timelineAuditModal.aiStatus.failed');
            case 'not_started':
                return t('timelineAuditModal.aiStatus.notStarted');
        }
    }

    private getAiStatusMeta(): string {
        if (this.aiState.status === 'running') {
            if (this.aiState.progressTotal > 0) {
                if (this.aiState.currentSceneName) {
                    return t('timelineAuditModal.aiStatus.progressCountWithScene', { current: this.aiState.progressCurrent, total: this.aiState.progressTotal, scene: this.aiState.currentSceneName });
                }
                return t('timelineAuditModal.aiStatus.progressCount', { current: this.aiState.progressCurrent, total: this.aiState.progressTotal });
            }
            return this.aiState.message || t('timelineAuditModal.aiStatus.runningBackground');
        }

        if (this.aiState.status === 'completed' && this.aiState.completedAt) {
            return t('timelineAuditModal.aiStatus.completedSummary', {
                scope: this.aiState.scopeLabel,
                checked: this.aiState.checkedSceneCount,
                requested: this.aiState.requestedSceneCount,
                suggestions: this.aiState.suggestionCount,
                failed: this.aiState.failedSceneCount,
                time: this.formatRelativeAge(this.aiState.completedAt)
            });
        }

        if (this.aiState.status === 'failed') {
            return this.aiState.error || t('timelineAuditModal.aiStatus.failedRetry');
        }

        return t('timelineAuditModal.aiStatus.notStartedHint');
    }

    private formatRelativeAge(timestamp: number): string {
        const deltaMs = Math.max(0, Date.now() - timestamp);
        const minutes = Math.floor(deltaMs / 60000);
        if (minutes < 1) return t('timelineAuditModal.relativeTime.justNow');
        if (minutes < 60) return t('timelineAuditModal.relativeTime.minutesAgo', { minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('timelineAuditModal.relativeTime.hoursAgo', { hours });
        const days = Math.floor(hours / 24);
        return t('timelineAuditModal.relativeTime.daysAgo', { days });
    }

    private createStat(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({ cls: 'ert-timeline-audit-stat' });
        item.createDiv({ cls: 'ert-timeline-audit-stat-value', text: value });
        item.createDiv({ cls: 'ert-timeline-audit-stat-label', text: label });
    }

    private createFilterPill(container: HTMLElement, label: string, value: FindingFilter): void {
        const pill = container.createDiv({ cls: 'ert-timeline-audit-filter-pill' });
        if (this.filter === value) {
            pill.addClass('ert-is-active');
        }
        pill.setText(label);
        pill.addEventListener('click', () => {
            this.filter = value;
            this.render();
        });
    }

    private renderTimelineOverview(container: HTMLElement, findings: TimelineAuditFinding[]): void {
        const overviewCard = container.createDiv({ cls: 'ert-panel ert-panel--glass ert-timeline-audit-overview' });
        overviewCard.createDiv({ cls: 'ert-timeline-audit-overview-title', text: t('timelineAuditModal.overview.title') });

        if (findings.length === 0) {
            overviewCard.createDiv({
                cls: 'ert-timeline-audit-overview-empty',
                text: t('timelineAuditModal.empty.noFindings')
            });
            return;
        }

        const strip = overviewCard.createDiv({ cls: 'ert-timeline-audit-overview-strip' });
        for (const entry of buildTimelineOverviewEntries(findings)) {
            const sceneLabel = `Scene ${entry.finding.manuscriptOrderIndex + 1}`;
            const sceneTitle = getAuditDisplayTitle(entry.finding.title);
            const block = strip.createEl('button', {
                cls: `ert-timeline-audit-overview-block ert-timeline-audit-overview-block--${entry.severity}`,
                text: `S${entry.finding.manuscriptOrderIndex + 1}`
            });
            if (entry.finding.path === this.expandedFindingPath) {
                block.addClass('ert-is-active');
            }
            block.type = 'button';
            block.setAttr('aria-label', `${sceneLabel}, ${sceneTitle}. ${entry.issueSummary}`);
            block.addEventListener('click', () => {
                this.expandFinding(entry.finding.path, true);
            });
        }

        const legendItems: Array<{ severity: string; label: string }> = [
            { severity: 'clean', label: t('timelineAuditModal.overview.legendClean') },
            { severity: 'missing_when', label: t('timelineAuditModal.overview.legendMissingWhen') },
            { severity: 'warning', label: t('timelineAuditModal.overview.legendWarning') },
            { severity: 'contradiction', label: t('timelineAuditModal.overview.legendContradiction') },
            { severity: 'impossible', label: t('timelineAuditModal.overview.legendImpossible') }
        ];
        const legend = overviewCard.createDiv({ cls: 'ert-timeline-audit-overview-legend' });
        for (const item of legendItems) {
            const entryEl = legend.createSpan({ cls: 'ert-timeline-audit-legend-item' });
            entryEl.createSpan({ cls: `ert-timeline-audit-legend-swatch ert-timeline-audit-overview-block--${item.severity}` });
            entryEl.createSpan({ text: item.label });
        }
    }

    private getFilteredFindings(): TimelineAuditFinding[] {
        const result = this.getDisplayedResult();
        if (!result) return [];

        const focused = this.focusedPaths;
        return result.findings.filter((finding) => {
            if (focused && !focused.has(finding.path)) return false;
            switch (this.filter) {
                case 'contradictions':
                    return finding.status === 'contradiction';
                case 'missing_when':
                    return finding.whenParseIssue === 'missing_when';
                case 'summary_body_disagreement':
                    return finding.issues.some((issue) => issue.type === 'summary_body_disagree');
                case 'continuity_problems':
                    return finding.issues.some((issue) =>
                        issue.type === 'continuity_conflict'
                        || issue.type === 'relative_order_conflict'
                        || issue.type === 'impossible_sequence'
                    );
                case 'ai_checked':
                    return finding.aiChecked === true;
                case 'ai_suggested':
                    return finding.aiSuggested;
                case 'unresolved':
                    return finding.unresolved;
                case 'all':
                    return true;
            }
        });
    }

    /**
     * Set a review decision across many findings at once. 'apply' only
     * touches findings whose suggestion is safe to apply — the same guard
     * as the per-card Apply button.
     */
    private setBulkAction(findings: TimelineAuditFinding[], action: 'apply' | 'keep' | 'mark_review'): void {
        for (const finding of findings) {
            if (action === 'apply') {
                if (!finding.safeApplyEligible) continue;
                finding.reviewAction = 'apply';
                finding.unresolved = false;
            } else if (action === 'keep') {
                finding.reviewAction = 'keep';
                finding.unresolved = finding.status !== 'aligned';
            } else {
                finding.reviewAction = 'mark_review';
                finding.unresolved = true;
            }
        }
        this.render();
    }

    private renderFindingListItem(container: HTMLElement, finding: TimelineAuditFinding): void {
        const shell = container.createDiv({ cls: 'ert-timeline-audit-finding-shell' });
        shell.addClass(`ert-timeline-audit-finding-shell--${finding.status}`);
        if (finding.path === this.expandedFindingPath) {
            shell.addClass('ert-is-expanded');
        }
        shell.tabIndex = -1;
        this.findingCardEls.set(finding.path, shell);

        // Use a <div role="button"> instead of <button> so the row escapes the
        // generic .ert-ui.ert-scope--modal button rule (which sets min-height
        // and zero vertical padding, clipping two-line titles).
        const row = shell.createDiv({
            cls: `ert-timeline-audit-row ert-timeline-audit-row--${finding.status}`,
            attr: { role: 'button', tabindex: '0' }
        });
        if (finding.path === this.expandedFindingPath) {
            row.addClass('ert-is-expanded');
        }
        row.addEventListener('click', () => this.toggleFindingExpansion(finding.path));
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleFindingExpansion(finding.path);
            }
        });

        const left = row.createDiv({ cls: 'ert-timeline-audit-row-left' });
        const titleRow = left.createDiv({ cls: 'ert-timeline-audit-row-title-row' });
        titleRow.createSpan({
            cls: 'ert-timeline-audit-row-index',
            text: `#${finding.manuscriptOrderIndex + 1}`
        });
        titleRow.createSpan({
            cls: 'ert-timeline-audit-row-title',
            text: getAuditDisplayTitle(finding.title)
        });

        const preview = getAuditFindingPreviewSnippet(finding);
        if (preview) {
            left.createDiv({
                cls: 'ert-timeline-audit-row-snippet',
                text: preview
            });
        }

        const middle = row.createDiv({ cls: 'ert-timeline-audit-row-middle' });
        for (const label of getAuditFindingBadgeLabels(finding)) {
            middle.createSpan({
                cls: 'ert-timeline-audit-row-issue',
                text: label
            });
        }

        // Provenance survives scrolling: AI-derived findings carry the tag on
        // the row itself, not just in the filter or the expanded detail.
        const hasAiSignal = finding.issues.some(i => i.detectionSource === 'ai')
            || finding.evidence.some(e => e.detectionSource === 'ai');
        if (finding.aiChecked || hasAiSignal) {
            middle.createSpan({
                cls: 'ert-timeline-audit-row-ai-badge',
                text: finding.aiChecked
                    ? t('timelineAuditModal.detectionSource.aiChecked')
                    : t('timelineAuditModal.detectionSource.ai')
            });
        }
        if (finding.reviewAction === 'mark_review') {
            middle.createSpan({
                cls: 'ert-timeline-audit-row-ai-queued-badge',
                text: t('timelineAuditModal.detectionSource.aiQueued')
            });
        }

        const right = row.createDiv({ cls: 'ert-timeline-audit-row-right' });
        right.createSpan({
            cls: `ert-timeline-audit-row-status ert-timeline-audit-row-status--${finding.status}`,
            text: formatAuditStatusLabel(finding.status)
        });
        const chevron = right.createSpan({ cls: 'ert-timeline-audit-row-chevron' });
        setIcon(chevron, finding.path === this.expandedFindingPath ? 'chevron-down' : 'chevron-right');

        if (finding.path === this.expandedFindingPath) {
            const detailWrap = shell.createDiv({ cls: 'ert-timeline-audit-detail-wrap' });
            this.renderFindingDetail(detailWrap, finding);
        }
    }

    private renderFindingDetail(container: HTMLElement, finding: TimelineAuditFinding): void {
        const card = container.createDiv({ cls: 'ert-timeline-audit-card' });
        card.addClass(`ert-timeline-audit-card--${finding.status}`);

        const titleRow = card.createDiv({ cls: 'ert-timeline-audit-card-title-row' });
        titleRow.createDiv({
            cls: 'ert-timeline-audit-card-title',
            text: `#${finding.manuscriptOrderIndex + 1} ${getAuditDisplayTitle(finding.title)}`
        });
        titleRow.createDiv({
            cls: 'ert-timeline-audit-card-status',
            text: formatAuditStatusLabel(finding.status)
        });

        const issueRow = card.createDiv({ cls: 'ert-timeline-audit-badge-row' });
        for (const issue of finding.issues.filter((candidate, index, issues) =>
            issues.findIndex((entry) => entry.type === candidate.type) === index
        )) {
            issueRow.createSpan({
                cls: `ert-timeline-audit-badge ert-timeline-audit-badge--${issue.severity}`,
                text: formatAuditIssueLabel(issue.type)
            });
        }

        const sourceRow = card.createDiv({ cls: 'ert-timeline-audit-badge-row' });
        const detectionSources = Array.from(new Set([
            ...finding.issues.map((issue) => issue.detectionSource),
            ...finding.evidence.map((evidence) => evidence.detectionSource)
        ]));
        if (finding.aiChecked && !detectionSources.includes('ai')) {
            detectionSources.push('ai');
        }
        detectionSources.forEach((source) => {
            sourceRow.createSpan({
                cls: 'ert-timeline-audit-source-badge',
                text: this.formatDetectionSource(source)
            });
        });

        const qaGrid = card.createDiv({ cls: 'ert-timeline-audit-qa-grid' });
        const totalScenes = this.getDisplayedResult()?.stats.totalScenes ?? 0; // SAFE: no audit result on screen yet means there are no scenes to count
        this.createQuestionBlock(qaGrid, t('timelineAuditModal.detail.whatYamlSays'), [
            this.describeCurrentWhen(finding),
            finding.expectedChronologyPosition !== null
                ? t('timelineAuditModal.detail.chronologyPosition', { position: finding.expectedChronologyPosition, total: totalScenes })
                : t('timelineAuditModal.detail.chronologyNotPlaced')
        ]);
        const manuscriptImplications = [
            finding.inferredWrittenTimelinePosition?.label ?? t('timelineAuditModal.detail.noAlternatePosition'),
            finding.suggestedWhen ? t('timelineAuditModal.detail.suggestedWhen', { when: this.formatWhen(finding.suggestedWhen) }) : t('timelineAuditModal.detail.noSuggestedWhen')
        ];
        if (finding.aiTimelineRole) {
            manuscriptImplications.unshift(t('timelineAuditModal.detail.aiTimelineRole', {
                role: this.formatAiTimelineRole(finding.aiTimelineRole)
            }));
        }
        this.createQuestionBlock(qaGrid, t('timelineAuditModal.detail.whatManuscriptImplies'), manuscriptImplications);
        this.createQuestionBlock(qaGrid, t('timelineAuditModal.detail.whyFlagged'), this.getFlagExplanationLines(finding));
        this.createQuestionBlock(qaGrid, t('timelineAuditModal.detail.whatAuthorCanDo'), [
            finding.suggestedWhen && finding.suggestedProvenance
                ? finding.safeApplyEligible
                    ? t('timelineAuditModal.detail.actionEligible')
                    : t('timelineAuditModal.detail.actionAiSuggestionAvailable')
                : t('timelineAuditModal.detail.actionIneligible')
        ]);

        const evidenceList = card.createDiv({ cls: 'ert-timeline-audit-evidence-list' });
        if (finding.evidence.length === 0) {
            evidenceList.createDiv({ cls: 'ert-timeline-audit-evidence-empty', text: t('timelineAuditModal.detail.noEvidence') });
        } else {
            for (const evidence of finding.evidence.slice(0, 4)) {
                const evidenceItem = evidenceList.createDiv({ cls: 'ert-timeline-audit-evidence-item' });
                evidenceItem.createSpan({
                    cls: 'ert-timeline-audit-evidence-label',
                    text: t('timelineAuditModal.detail.evidenceLabel', { source: this.formatEvidenceSource(evidence.source), tier: this.formatEvidenceTier(evidence.tier) })
                });
                evidenceItem.createSpan({
                    cls: 'ert-timeline-audit-evidence-snippet',
                    text: evidence.snippet
                });
            }
        }

        const actionRow = card.createDiv({ cls: 'ert-timeline-audit-card-actions' });
        const canApplySuggestion = finding.suggestedWhen instanceof Date && Boolean(finding.suggestedProvenance);
        const applyButton = new ButtonComponent(actionRow)
            .setButtonText(t('timelineAuditModal.detail.applyButton'))
            .setDisabled(!canApplySuggestion)
            .onClick(() => {
                finding.reviewAction = 'apply';
                finding.unresolved = false;
                this.render();
            });
        if (finding.reviewAction === 'apply') {
            applyButton.setCta();
        }

        const keepButton = new ButtonComponent(actionRow)
            .setButtonText(t('timelineAuditModal.detail.keepButton'))
            .onClick(() => {
                finding.reviewAction = 'keep';
                finding.unresolved = finding.status !== 'aligned';
                this.render();
            });
        if (finding.reviewAction === 'keep') {
            keepButton.setCta();
        }

        const markReviewButton = new ButtonComponent(actionRow)
            .setButtonText(t('timelineAuditModal.detail.markReviewButton'))
            .onClick(() => {
                finding.reviewAction = 'mark_review';
                finding.unresolved = true;
                this.render();
            });
        if (finding.reviewAction === 'mark_review') {
            markReviewButton.setCta();
        }

        // The other kind of timeline fix: Apply corrects THIS scene's date;
        // "Adjust with ripple" hands off to Timeline Scaffold when the story
        // shifted from this point onward and everything after must follow.
        const rippleButton = new ButtonComponent(actionRow)
            .setButtonText(t('timelineAuditModal.detail.adjustRippleButton'))
            .onClick(() => {
                this.close();
                new TimelineRepairModal(this.app, this.plugin, { focusScenePath: finding.path }).open();
            });
        setTooltip(rippleButton.buttonEl, t('timelineAuditModal.detail.adjustRippleHelp'));
    }

    private createQuestionBlock(container: HTMLElement, title: string, lines: string[]): void {
        const block = container.createDiv({ cls: 'ert-timeline-audit-question-block' });
        block.createDiv({ cls: 'ert-timeline-audit-question-title', text: title });
        for (const line of lines) {
            block.createDiv({ cls: 'ert-timeline-audit-question-copy', text: line });
        }
    }

    private getFlagExplanationLines(finding: TimelineAuditFinding): string[] {
        const issueLines = finding.issues
            .filter((issue, index, issues) => issues.findIndex((candidate) => candidate.type === issue.type) === index)
            .slice(0, 2)
            .map((issue) => describeAuditIssue(issue.type));

        if (finding.rationale) {
            issueLines.push(finding.rationale);
        }

        return issueLines.length > 0 ? issueLines : [t('timelineAuditModal.detail.noRationale')];
    }

    private describeCurrentWhen(finding: TimelineAuditFinding): string {
        if (finding.whenParseIssue === 'missing_when') return t('timelineAuditModal.detail.whenMissing');
        if (finding.whenParseIssue === 'invalid_when') return t('timelineAuditModal.detail.whenInvalid', { raw: finding.currentWhenRaw ?? 'unknown' });
        return t('timelineAuditModal.detail.whenCurrent', { when: this.formatWhen(finding.currentWhen) });
    }

    private formatWhen(value: Date | null): string {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) return t('timelineAuditModal.detail.formatWhenMissing');
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        const hour = String(value.getHours()).padStart(2, '0');
        const minute = String(value.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }

    private formatEvidenceSource(source: TimelineAuditEvidenceSource): string {
        switch (source) {
            case 'summary': return t('timelineAuditModal.evidenceSource.summary');
            case 'synopsis': return t('timelineAuditModal.evidenceSource.synopsis');
            case 'body': return t('timelineAuditModal.evidenceSource.body');
            case 'neighbor': return t('timelineAuditModal.evidenceSource.neighbor');
            case 'ai': return t('timelineAuditModal.evidenceSource.ai');
        }
    }

    private formatEvidenceTier(tier: TimelineAuditEvidenceTier): string {
        switch (tier) {
            case 'direct': return t('timelineAuditModal.evidenceTier.direct');
            case 'strong_inference': return t('timelineAuditModal.evidenceTier.strongInference');
            case 'ambiguous': return t('timelineAuditModal.evidenceTier.ambiguous');
        }
    }

    private formatDetectionSource(source: TimelineAuditDetectionSource): string {
        switch (source) {
            case 'deterministic': return t('timelineAuditModal.detectionSource.deterministic');
            case 'continuity': return t('timelineAuditModal.detectionSource.continuity');
            case 'ai': return t('timelineAuditModal.detectionSource.ai');
        }
    }

    private formatAiTimelineRole(role: TimelineAuditAiTimelineRole): string {
        switch (role) {
            case 'mainline': return t('timelineAuditModal.timelineRole.mainline');
            case 'flashback': return t('timelineAuditModal.timelineRole.flashback');
            case 'flash_forward': return t('timelineAuditModal.timelineRole.flashForward');
            case 'parallel': return t('timelineAuditModal.timelineRole.parallel');
            case 'unclear': return t('timelineAuditModal.timelineRole.unclear');
        }
    }

    private async applyDecisions(): Promise<void> {
        const result = this.getDisplayedResult();
        if (!result) return;

        // Capture a restore point for the scenes whose When is about to
        // change. If the snapshot cannot be saved, abort — same safety
        // stance as Timeline Scaffold's apply.
        const plan = buildAuditApplyPlan(result.findings);
        if (plan.whenUpdates.length > 0) {
            try {
                const snapshot = await buildSnapshotFromFiles(
                    this.app,
                    plan.whenUpdates.map(u => u.file),
                    'audit'
                );
                await saveTimelineSnapshot(this.app, snapshot);
            } catch (error) {
                new Notice(t('timelineAuditModal.notices.snapshotFailed', {
                    message: error instanceof Error ? error.message : String(error)
                }));
                return;
            }
        }

        try {
            const applyResult = await applyAuditFindings(this.app, result.findings, { logTool: 'audit' });
            if (applyResult.failed > 0) {
                new Notice(t('timelineAuditModal.notices.applyPartial', { failed: applyResult.failed }));
            } else {
                new Notice(t('timelineAuditModal.notices.applySuccess'));
            }
            this.plugin.getTimelineAuditAiService().invalidate(this.getAiScopeKey());
            this.clearActiveAiScope();
            this.close();
        } catch (error) {
            new Notice(`Failed to apply timeline audit decisions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

export default TimelineAuditModal;
