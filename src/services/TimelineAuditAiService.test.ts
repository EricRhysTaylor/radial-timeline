import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import {
    TimelineAuditAiService,
    buildTimelineAuditAiScopeKey,
    createTimelineAuditAiJobState,
    resolveTimelineAuditAiScopeKey,
    resolveTimelineAuditDisplayResult,
    TIMELINE_AUDIT_AI_STATE_EVENT,
    type TimelineAuditAiJobState
} from './TimelineAuditAiService';
import type { TimelineAuditResult } from '../timelineAudit/types';

function makePlugin() {
    const dispatched: TimelineAuditAiJobState[] = [];
    const plugin = {
        settings: {
            activeBookId: 'book-1',
            sourcePath: 'Books/Novel'
        },
        getActiveBook: () => ({ sourceFolder: 'Books/Novel' }),
        dispatch: (type: string, detail: TimelineAuditAiJobState) => {
            if (type === TIMELINE_AUDIT_AI_STATE_EVENT) {
                dispatched.push(detail);
            }
        }
    } as unknown as RadialTimelinePlugin;

    return { plugin, dispatched };
}

function makeResult(label: string): TimelineAuditResult {
    return {
        findings: [],
        stats: {
            totalScenes: 1,
            aligned: label === 'base' ? 1 : 0,
            warnings: 0,
            contradictions: label === 'ai' ? 1 : 0,
            missingWhen: 0
        },
        appliedSuggestionCount: 0,
        unresolvedCount: 0,
        aiRunSummary: label === 'ai' ? {
            scopeMode: 'range',
            requested: 5,
            checked: 4,
            suggestions: 2,
            failed: 1
        } : undefined
    };
}

describe('TimelineAuditAiService', () => {
    it('starts explicitly, updates running state immediately, and preserves completed state by scope', async () => {
        const { plugin, dispatched } = makePlugin();
        const result = makeResult('ai');
        const runner = vi.fn(async (_plugin, _config, callbacks) => {
            callbacks?.onStageChange?.('ai');
            callbacks?.onAiProgress?.(2, 5, 'Scene Two');
            return result;
        });

        const service = new TimelineAuditAiService(plugin, runner);
        const aiScope = { mode: 'range' as const, paths: ['Story/1.md', 'Story/2.md'] };
        const scopeKey = buildTimelineAuditAiScopeKey(plugin, true, aiScope);
        const promise = service.start(scopeKey, {
            runContinuityPass: true,
            chronologyWindow: 2,
            bodyExcerptChars: 0,
            aiScope,
            aiScopeLabel: 'Scenes 1–2'
        });
        aiScope.paths.push('Story/3.md');

        expect(service.getState(scopeKey).status).toBe('running');
        await promise;

        const state = service.getState(scopeKey);
        expect(state.status).toBe('completed');
        expect(state.progressCurrent).toBe(2);
        expect(state.progressTotal).toBe(5);
        expect(state.currentSceneName).toBe('Scene Two');
        expect(state.scopeLabel).toBe('Scenes 1–2');
        expect(state.checkedSceneCount).toBe(4);
        expect(state.suggestionCount).toBe(2);
        expect(state.failedSceneCount).toBe(1);
        expect(state.scope?.paths).toEqual(['Story/1.md', 'Story/2.md']);
        expect(state.contextKey).not.toBeNull();
        expect(state.result).toBe(result);
        expect(dispatched.some((entry) => entry.status === 'running')).toBe(true);
        expect(dispatched.some((entry) => entry.status === 'completed')).toBe(true);
    });

    it('resolves displayed results only when the completed AI state matches the current scope', () => {
        const { plugin } = makePlugin();
        const scopeKey = buildTimelineAuditAiScopeKey(plugin, true);
        const otherScopeKey = buildTimelineAuditAiScopeKey(plugin, false);
        const base = makeResult('base');
        const ai = makeResult('ai');

        expect(resolveTimelineAuditDisplayResult(
            base,
            createTimelineAuditAiJobState({
                status: 'completed',
                scopeKey,
                result: ai
            }),
            scopeKey
        )).toBe(ai);

        expect(resolveTimelineAuditDisplayResult(
            base,
            createTimelineAuditAiJobState({
                status: 'completed',
                scopeKey,
                result: ai
            }),
            otherScopeKey
        )).toBe(base);
    });

    it('keys completed AI state to the exact manuscript, range, or marked-scene queue', () => {
        const { plugin } = makePlugin();
        const manuscript = buildTimelineAuditAiScopeKey(plugin, true, { mode: 'manuscript' });
        const range = buildTimelineAuditAiScopeKey(plugin, true, {
            mode: 'range',
            startScene: 2,
            endScene: 4,
            paths: ['Story/4.md', 'Story/2.md', 'Story/3.md']
        });
        const marked = buildTimelineAuditAiScopeKey(plugin, true, {
            mode: 'marked',
            paths: ['Story/2.md', 'Story/4.md']
        });

        expect(range).not.toBe(manuscript);
        expect(marked).not.toBe(range);
        expect(range).toContain('Story/2.md');
    });

    it('keeps the run-start scope key stable while marked review actions change', () => {
        const { plugin } = makePlugin();
        const startedKey = buildTimelineAuditAiScopeKey(plugin, true, {
            mode: 'marked',
            paths: ['Story/A.md', 'Story/B.md', 'Story/C.md']
        });
        const mutatedKey = buildTimelineAuditAiScopeKey(plugin, true, {
            mode: 'marked',
            paths: ['Story/B.md', 'Story/C.md']
        });

        expect(mutatedKey).not.toBe(startedKey);
        expect(resolveTimelineAuditAiScopeKey(startedKey, mutatedKey)).toBe(startedKey);
    });

    it('allows only one chronology pipeline at a time, even when a second scope is requested', async () => {
        const { plugin } = makePlugin();
        let finishFirst: ((result: TimelineAuditResult) => void) | undefined;
        const runner = vi.fn(() => new Promise<TimelineAuditResult>((resolve) => {
            finishFirst = resolve;
        }));
        const service = new TimelineAuditAiService(plugin, runner);
        const firstScope = { mode: 'range' as const, paths: ['Story/1.md'] };
        const secondScope = { mode: 'range' as const, paths: ['Story/2.md'] };
        const firstKey = buildTimelineAuditAiScopeKey(plugin, true, firstScope);
        const secondKey = buildTimelineAuditAiScopeKey(plugin, true, secondScope);

        const firstRun = service.start(firstKey, {
            runContinuityPass: true,
            chronologyWindow: 2,
            bodyExcerptChars: 0,
            aiScope: firstScope,
            aiScopeLabel: 'Scene 1'
        });
        await service.start(secondKey, {
            runContinuityPass: true,
            chronologyWindow: 2,
            bodyExcerptChars: 0,
            aiScope: secondScope,
            aiScopeLabel: 'Scene 2'
        });

        expect(runner).toHaveBeenCalledTimes(1);
        expect(service.getState(firstKey).status).toBe('running');
        expect(service.getState(secondKey).status).toBe('not_started');

        finishFirst?.(makeResult('ai'));
        await firstRun;
    });

    it('invalidates completed AI state when requested for the current scope', async () => {
        const { plugin } = makePlugin();
        const service = new TimelineAuditAiService(plugin, async () => makeResult('ai'));
        const scopeKey = buildTimelineAuditAiScopeKey(plugin, true);

        await service.start(scopeKey, {
            runContinuityPass: true,
            chronologyWindow: 2,
            bodyExcerptChars: 0,
            aiScope: { mode: 'manuscript' },
            aiScopeLabel: 'Entire manuscript'
        });
        expect(service.getState(scopeKey).status).toBe('completed');

        service.invalidate(scopeKey);
        expect(service.getState(scopeKey).status).toBe('not_started');
    });
});
