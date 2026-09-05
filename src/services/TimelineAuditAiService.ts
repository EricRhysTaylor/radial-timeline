/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Audit AI Service
 */

import type RadialTimelinePlugin from '../main';
import { runAuditPipeline } from '../timelineAudit/AuditPipeline';
import type {
    TimelineAuditAiScope,
    TimelineAuditAiScopeMode,
    TimelineAuditCallbacks,
    TimelineAuditPipelineConfig,
    TimelineAuditResult
} from '../timelineAudit/types';

export const TIMELINE_AUDIT_AI_STATE_EVENT = 'timeline-audit-ai-state';

export type TimelineAuditAiJobStatus = 'not_started' | 'running' | 'completed' | 'failed';

export interface TimelineAuditAiJobState {
    status: TimelineAuditAiJobStatus;
    contextKey: string | null;
    scopeKey: string | null;
    scope: TimelineAuditAiScope | null;
    startedAt: number | null;
    completedAt: number | null;
    progressCurrent: number;
    progressTotal: number;
    currentSceneName: string | null;
    scopeMode: TimelineAuditAiScopeMode;
    scopeLabel: string;
    requestedSceneCount: number;
    checkedSceneCount: number;
    suggestionCount: number;
    failedSceneCount: number;
    message: string;
    error: string | null;
    result: TimelineAuditResult | null;
}

export type TimelineAuditAiRunner = (
    plugin: RadialTimelinePlugin,
    config: TimelineAuditPipelineConfig,
    callbacks?: TimelineAuditCallbacks
) => Promise<TimelineAuditResult>;

export function createTimelineAuditAiJobState(
    overrides: Partial<TimelineAuditAiJobState> = {}
): TimelineAuditAiJobState {
    return {
        status: 'not_started',
        contextKey: null,
        scopeKey: null,
        scope: null,
        startedAt: null,
        completedAt: null,
        progressCurrent: 0,
        progressTotal: 0,
        currentSceneName: null,
        scopeMode: 'manuscript',
        scopeLabel: '',
        requestedSceneCount: 0,
        checkedSceneCount: 0,
        suggestionCount: 0,
        failedSceneCount: 0,
        message: '',
        error: null,
        result: null,
        ...overrides
    };
}

export function buildTimelineAuditAiContextKey(
    plugin: Pick<RadialTimelinePlugin, 'settings' | 'getActiveBook'>,
    runContinuityPass: boolean
): string {
    const book = plugin.getActiveBook();
    const scope = book?.sourceFolder?.trim() || plugin.settings.sourcePath || ''; // SAFE: blank scope is the canonical entire-vault identity
    const bookId = plugin.settings.activeBookId || ''; // SAFE: blank book id identifies legacy single-book settings
    return JSON.stringify({ bookId, scope, runContinuityPass });
}

export function freezeTimelineAuditAiScope(aiScope: TimelineAuditAiScope): TimelineAuditAiScope {
    return {
        ...aiScope,
        paths: aiScope.paths ? [...aiScope.paths] : undefined
    };
}

export function resolveTimelineAuditAiScopeKey(
    activeScopeKey: string | null,
    configuredScopeKey: string
): string {
    return activeScopeKey ?? configuredScopeKey; // SAFE: configured key is authoritative until a run freezes an active key
}

export function buildTimelineAuditAiScopeKey(
    plugin: Pick<RadialTimelinePlugin, 'settings' | 'getActiveBook'>,
    runContinuityPass: boolean,
    aiScope: TimelineAuditAiScope = { mode: 'manuscript' }
): string {
    const contextKey = buildTimelineAuditAiContextKey(plugin, runContinuityPass);
    const paths = aiScope.paths?.slice().sort() ?? []; // SAFE: manuscript scope intentionally has no explicit path list
    return JSON.stringify({
        contextKey,
        aiScope: {
            mode: aiScope.mode,
            paths,
            startScene: aiScope.startScene ?? null, // SAFE: null is the canonical serialized value when this scope is not a range
            endScene: aiScope.endScene ?? null // SAFE: null is the canonical serialized value when this scope is not a range
        }
    });
}

export function resolveTimelineAuditDisplayResult(
    baseResult: TimelineAuditResult | null,
    aiState: TimelineAuditAiJobState,
    scopeKey: string
): TimelineAuditResult | null {
    if (
        aiState.status === 'completed'
        && aiState.scopeKey === scopeKey
        && aiState.result
    ) {
        return aiState.result;
    }

    return baseResult;
}

export class TimelineAuditAiService {
    private state = createTimelineAuditAiJobState();
    private abortController: AbortController | null = null;

    constructor(
        private readonly plugin: RadialTimelinePlugin,
        private readonly runner: TimelineAuditAiRunner = runAuditPipeline
    ) {}

    getState(scopeKey: string): TimelineAuditAiJobState {
        if (this.state.scopeKey !== scopeKey) {
            return createTimelineAuditAiJobState();
        }
        return { ...this.state };
    }

    getLatestState(): TimelineAuditAiJobState {
        return {
            ...this.state,
            scope: this.state.scope ? freezeTimelineAuditAiScope(this.state.scope) : null
        };
    }

    invalidate(scopeKey: string): void {
        if (this.state.scopeKey !== scopeKey || this.state.status === 'running') {
            return;
        }

        this.state = createTimelineAuditAiJobState();
        this.emit();
    }

    async start(
        scopeKey: string,
        config: Pick<TimelineAuditPipelineConfig, 'runContinuityPass' | 'chronologyWindow' | 'bodyExcerptChars' | 'aiScope'> & {
            aiScopeLabel: string;
        }
    ): Promise<void> {
        if (this.state.status === 'running') {
            return;
        }

        const frozenScope = freezeTimelineAuditAiScope(config.aiScope ?? { mode: 'manuscript' }); // SAFE: omitted scope means the documented whole-manuscript mode
        const contextKey = buildTimelineAuditAiContextKey(this.plugin, config.runContinuityPass);
        this.abortController = new AbortController();
        const startedAt = Date.now();
        this.state = createTimelineAuditAiJobState({
            status: 'running',
            contextKey,
            scopeKey,
            scope: frozenScope,
            startedAt,
            scopeMode: frozenScope.mode,
            scopeLabel: config.aiScopeLabel,
            message: 'Preparing AI chronology scan…'
        });
        this.emit();

        try {
            const result = await this.runner(this.plugin, {
                runDeterministicPass: true,
                runContinuityPass: config.runContinuityPass,
                runAiInference: true,
                chronologyWindow: config.chronologyWindow,
                bodyExcerptChars: config.bodyExcerptChars,
                aiScope: frozenScope
            }, {
                abortSignal: this.abortController.signal,
                onStageChange: (stage) => {
                    if (stage === 'deterministic') {
                        this.state = { ...this.state, message: 'Refreshing audit context…' };
                    } else if (stage === 'continuity') {
                        this.state = { ...this.state, message: 'Refreshing continuity context…' };
                    } else if (stage === 'ai') {
                        this.state = { ...this.state, message: 'Running AI chronology scan…' };
                    } else if (stage === 'complete') {
                        this.state = { ...this.state, message: 'AI chronology scan complete' };
                    }
                    this.emit();
                },
                onAiQueue: (total) => {
                    this.state = {
                        ...this.state,
                        requestedSceneCount: total,
                        progressTotal: total
                    };
                    this.emit();
                },
                onAiProgress: (current, total, sceneName) => {
                    this.state = {
                        ...this.state,
                        message: 'Running AI chronology scan…',
                        progressCurrent: current,
                        progressTotal: total,
                        currentSceneName: sceneName
                    };
                    this.emit();
                }
            });

            if (this.abortController.signal.aborted) {
                return;
            }

            const aiRunSummary = result.aiRunSummary;
            if (!aiRunSummary) {
                throw new Error('Timeline Audit AI completed without a run summary.');
            }

            this.state = createTimelineAuditAiJobState({
                status: 'completed',
                contextKey,
                scopeKey,
                scope: frozenScope,
                startedAt,
                completedAt: Date.now(),
                progressCurrent: this.state.progressCurrent,
                progressTotal: this.state.progressTotal,
                currentSceneName: this.state.currentSceneName,
                scopeMode: frozenScope.mode,
                scopeLabel: config.aiScopeLabel,
                requestedSceneCount: aiRunSummary.requested,
                checkedSceneCount: aiRunSummary.checked,
                suggestionCount: aiRunSummary.suggestions,
                failedSceneCount: aiRunSummary.failed,
                message: 'AI chronology scan complete',
                result
            });
            this.emit();
        } catch (error) {
            if (this.abortController.signal.aborted) {
                return;
            }

            this.state = createTimelineAuditAiJobState({
                status: 'failed',
                contextKey,
                scopeKey,
                scope: frozenScope,
                startedAt,
                completedAt: Date.now(),
                scopeMode: frozenScope.mode,
                scopeLabel: config.aiScopeLabel,
                message: 'AI chronology scan failed',
                error: error instanceof Error ? error.message : String(error)
            });
            this.emit();
        } finally {
            this.abortController = null;
        }
    }

    private emit(): void {
        this.plugin.dispatch(TIMELINE_AUDIT_AI_STATE_EVENT, { ...this.state });
    }
}
