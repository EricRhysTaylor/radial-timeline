import { describe, expect, it } from 'vitest';
import {
    buildModelDriftReport,
    computeActionableDrift,
    computeAliasChanges,
    computeAnthropicNewestChange,
    computeDiff,
    computeTokenLimitChanges,
    createLatestAliasTracking,
    parseCanonicalSnapshot,
} from '../scripts/modelSnapshotUtils.mjs';

describe('modelSnapshotUtils', () => {
    it('parses the canonical snapshot format', () => {
        const snapshot = parseCanonicalSnapshot({
            generatedAt: '2026-04-15T21:26:52.350Z',
            summary: { openai: 1, anthropic: 1, google: 1 },
            models: [
                { provider: 'anthropic', id: 'claude-opus-4-6', createdAt: '2026-02-04T00:00:00.000Z', raw: {} },
                { provider: 'openai', id: 'gpt-5.4', createdAt: '2026-03-05T00:00:00.000Z', raw: {} },
                { provider: 'google', id: 'gemini-pro-latest', outputTokenLimit: 65536, raw: {} },
            ],
        });

        expect(snapshot?.generatedAt).toBe('2026-04-15T21:26:52.350Z');
        expect(snapshot?.summary.anthropic).toBe(1);
        expect(snapshot?.models.map(model => model.id)).toEqual(['gpt-5.4', 'claude-opus-4-6', 'gemini-pro-latest']);
    });

    it('coerces the legacy grouped shape without breaking', () => {
        const snapshot = parseCanonicalSnapshot({
            generatedAt: '2026-04-15T21:26:52.350Z',
            openai: [{ id: 'gpt-5.4', created: 1741132800 }],
            anthropic: [{ id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', created_at: '2026-02-04T00:00:00.000Z' }],
            gemini: [{ id: 'gemini-pro-latest', displayName: 'Gemini Pro Latest', outputTokenLimit: 65536 }],
        });

        expect(snapshot?.summary.openai).toBe(1);
        expect(snapshot?.summary.anthropic).toBe(1);
        expect(snapshot?.summary.google).toBe(1);
    });

    it('detects provider drift for a newly added Anthropic model', () => {
        const changes = computeDiff(
            [{ provider: 'anthropic', id: 'claude-opus-4-6' }],
            [
                { provider: 'anthropic', id: 'claude-opus-4-6' },
                { provider: 'anthropic', id: 'claude-opus-4-7' },
            ]
        );

        expect(changes.anthropic.added).toEqual(['claude-opus-4-7']);
        expect(changes.anthropic.removed).toEqual([]);
    });

    it('tracks Anthropic newest-model changes from createdAt', () => {
        const previous = createLatestAliasTracking({
            generatedAt: '2026-04-15T00:00:00.000Z',
            models: [
                { provider: 'anthropic', id: 'claude-opus-4-6', label: 'Claude Opus 4.6', createdAt: '2026-02-04T00:00:00.000Z' },
            ],
        });
        const next = createLatestAliasTracking({
            generatedAt: '2026-04-16T00:00:00.000Z',
            models: [
                { provider: 'anthropic', id: 'claude-opus-4-6', label: 'Claude Opus 4.6', createdAt: '2026-02-04T00:00:00.000Z' },
                { provider: 'anthropic', id: 'claude-opus-4-7', label: 'Claude Opus 4.7', createdAt: '2026-04-16T00:00:00.000Z' },
            ],
        });

        expect(computeAnthropicNewestChange(previous, next)).toEqual({
            from: {
                id: 'claude-opus-4-6',
                displayName: 'Claude Opus 4.6',
                createdAt: '2026-02-04T00:00:00.000Z',
            },
            to: {
                id: 'claude-opus-4-7',
                displayName: 'Claude Opus 4.7',
                createdAt: '2026-04-16T00:00:00.000Z',
            },
        });
    });

    it('populates alias tracking and token limits from the canonical snapshot', () => {
        const tracking = createLatestAliasTracking({
            generatedAt: '2026-04-16T00:00:00.000Z',
            models: [
                { provider: 'openai', id: 'gpt-5.2-2026-04-10', createdAt: '2026-04-10T00:00:00.000Z' },
                { provider: 'openai', id: 'gpt-5.2-codex', createdAt: '2026-04-12T00:00:00.000Z' },
                { provider: 'openai', id: 'gpt-5.1-2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' },
                { provider: 'google', id: 'gemini-pro-latest', outputTokenLimit: 65536, label: 'Gemini Pro Latest' },
                { provider: 'google', id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
                { provider: 'google', id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
                { provider: 'google', id: 'gemini-flash-latest', outputTokenLimit: 32768, label: 'Gemini Flash Latest' },
                { provider: 'google', id: 'gemini-3.1-flash-preview', label: 'Gemini 3.1 Flash Preview' },
                { provider: 'google', id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
            ],
        }, '2026-04-16T12:00:00.000Z');

        expect(tracking.snapshotGeneratedAt).toBe('2026-04-16T00:00:00.000Z');
        expect(tracking.openai['gpt-5.2-chat-latest']?.likelyResolves).toBe('gpt-5.2-2026-04-10');
        expect(tracking.gemini['gemini-pro-latest']?.likelyResolves).toBe('gemini-3.1-pro-preview');
        expect(tracking.tokenLimits).toEqual({
            'gemini-pro-latest': 65536,
            'gemini-flash-latest': 32768,
        });
    });

    it('detects alias resolution changes between tracking snapshots', () => {
        const changes = computeAliasChanges(
            {
                openai: {
                    'gpt-5.2-chat-latest': { likelyResolves: 'gpt-5.2-2026-03-01' },
                },
                gemini: {
                    'gemini-pro-latest': { likelyResolves: 'gemini-3-pro-preview' },
                },
            },
            {
                openai: {
                    'gpt-5.2-chat-latest': { likelyResolves: 'gpt-5.2-2026-04-10' },
                },
                gemini: {
                    'gemini-pro-latest': { likelyResolves: 'gemini-3.1-pro-preview' },
                },
            }
        );

        expect(changes).toEqual([
            {
                provider: 'openai',
                alias: 'gpt-5.2-chat-latest',
                from: 'gpt-5.2-2026-03-01',
                to: 'gpt-5.2-2026-04-10',
            },
            {
                provider: 'gemini',
                alias: 'gemini-pro-latest',
                from: 'gemini-3-pro-preview',
                to: 'gemini-3.1-pro-preview',
            },
        ]);
    });

    it('detects tracked token-limit changes', () => {
        const changes = computeTokenLimitChanges(
            { tokenLimits: { 'gemini-pro-latest': 32768 } },
            { tokenLimits: { 'gemini-pro-latest': 65536 } }
        );

        expect(changes).toEqual([
            {
                modelId: 'gemini-pro-latest',
                from: 32768,
                to: 65536,
            },
        ]);
    });

    it('builds an actionable drift report with curated follow-ups', () => {
        const report = buildModelDriftReport({
            checkedAt: '2026-04-16T12:00:00.000Z',
            beforeSnapshot: { generatedAt: '2026-04-15T00:00:00.000Z' },
            afterSnapshot: { generatedAt: '2026-04-16T00:00:00.000Z' },
            changes: {
                openai: { added: [], removed: [] },
                anthropic: { added: ['claude-opus-4-7'], removed: [] },
                google: { added: [], removed: [] },
            },
            aliasChanges: [],
            anthropicNewestChanged: null,
            tokenLimitChanges: [],
        });

        expect(report.mode).toBe('report');
        expect(report.hasActionableChanges).toBe(true);
        expect(report.recommendedFollowUps.some(item => item.includes('src/ai/registry/builtinModels.ts'))).toBe(true);
    });

    it('suppresses already-curated provider additions from actionable drift', () => {
        const actionable = computeActionableDrift({
            changes: {
                openai: { added: [], removed: [] },
                anthropic: { added: ['claude-opus-4-7'], removed: [] },
                google: { added: [], removed: [] },
            },
            aliasChanges: [],
            anthropicNewestChanged: {
                from: {
                    id: 'claude-sonnet-4-6',
                    displayName: 'Claude Sonnet 4.6',
                    createdAt: '2026-02-17T00:00:00.000Z',
                },
                to: {
                    id: 'claude-opus-4-7',
                    displayName: 'Claude Opus 4.7',
                    createdAt: '2026-04-16T00:00:00.000Z',
                },
            },
            tokenLimitChanges: [],
            releaseAlerts: [],
            curatedModelIds: new Set(['claude-opus-4-7']),
        });

        const report = buildModelDriftReport({
            checkedAt: '2026-04-16T12:00:00.000Z',
            beforeSnapshot: { generatedAt: '2026-04-15T00:00:00.000Z' },
            afterSnapshot: { generatedAt: '2026-04-16T00:00:00.000Z' },
            changes: {
                openai: { added: [], removed: [] },
                anthropic: { added: ['claude-opus-4-7'], removed: [] },
                google: { added: [], removed: [] },
            },
            aliasChanges: [],
            anthropicNewestChanged: actionable.anthropicNewestChanged,
            tokenLimitChanges: [],
            releaseAlerts: [],
            actionable,
        });

        expect(actionable.changes.anthropic.added).toEqual([]);
        expect(actionable.anthropicNewestChanged).toBeNull();
        expect(report.hasActionableChanges).toBe(false);
    });
});
