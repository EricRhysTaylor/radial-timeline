import { describe, expect, it } from 'vitest';
import {
    buildGossamerCacheWindow,
    formatGossamerCacheClock,
    formatGossamerCacheCostHint,
    formatGossamerCachePillLabel,
    isGossamerCacheWindowOpen,
    type GossamerCacheWindow
} from './cacheWindow';
import { buildDefaultAiSettings } from '../ai/settings/aiSettings';
import { resolveProviderCacheWindowMs } from '../ai/settings/cacheWindows';
import type { AIRunAdvancedContext } from '../ai/types';

const AI_SETTINGS = buildDefaultAiSettings();

const ctx = (over: Partial<AIRunAdvancedContext>): AIRunAdvancedContext => ({
    roleTemplateName: '',
    provider: 'anthropic',
    modelAlias: '',
    modelLabel: 'Claude',
    modelSelectionReason: '',
    availabilityStatus: 'visible',
    maxInputTokens: 0,
    maxOutputTokens: 0,
    reuseState: 'eligible',
    featureModeInstructions: '',
    finalPrompt: '',
    ...over
});

describe('buildGossamerCacheWindow', () => {
    const RETURNED = 1_000_000;

    it('returns null without provider proof of a cache write or read', () => {
        // aiClient marks reuseState 'eligible' before the call whenever the
        // cache delimiter is present — e.g. an Anthropic prefix below the
        // minimum, or an OpenAI call that wrote nothing. That is not proof.
        expect(buildGossamerCacheWindow(ctx({ reuseState: 'eligible' }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(ctx({ provider: 'openai', reuseState: 'eligible' }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(ctx({ reuseState: 'idle' }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(ctx({ reuseState: undefined }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(null, RETURNED, AI_SETTINGS)).toBeNull();
    });

    it('opens on a reported cache write or read', () => {
        const created = buildGossamerCacheWindow(ctx({ cacheStatus: 'created' }), RETURNED, AI_SETTINGS);
        expect(created?.cacheStatus).toBe('created');
        const hit = buildGossamerCacheWindow(ctx({ reuseState: 'warm', cacheStatus: 'hit' }), RETURNED, AI_SETTINGS);
        expect(hit?.cacheStatus).toBe('hit');
    });

    it('returns null for non-caching providers', () => {
        expect(buildGossamerCacheWindow(ctx({ provider: 'ollama', cacheStatus: 'created' }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(ctx({ provider: 'none', cacheStatus: 'created' }), RETURNED, AI_SETTINGS)).toBeNull();
    });

    it('trusts the provider-reported expiry (Gemini cachedContent) when present', () => {
        const expiresAt = RETURNED + 12 * 60_000;
        const win = buildGossamerCacheWindow(
            ctx({ provider: 'google', cacheExpiresAt: expiresAt, reuseState: 'warm', cacheStatus: 'hit' }),
            RETURNED,
            AI_SETTINGS
        );
        expect(win?.expiresAt).toBe(expiresAt);
        expect(win?.provider).toBe('google');
    });

    it('derives expiry from the provider TTL when none is reported (Anthropic)', () => {
        const win = buildGossamerCacheWindow(ctx({ provider: 'anthropic', cacheStatus: 'created' }), RETURNED, AI_SETTINGS);
        expect(win).not.toBeNull();
        // Anthropic window is fixed at 1h.
        expect(win!.expiresAt).toBe(RETURNED + 60 * 60_000);
    });

    it('derives expiry from the provider TTL for an OpenAI cache write', () => {
        const win = buildGossamerCacheWindow(ctx({ provider: 'openai', cacheStatus: 'created' }), RETURNED, AI_SETTINGS);
        expect(win).not.toBeNull();
        expect(win!.expiresAt).toBe(RETURNED + resolveProviderCacheWindowMs('openai', AI_SETTINGS)!);
    });

    it('ignores a stale provider expiry that is already in the past', () => {
        const win = buildGossamerCacheWindow(
            ctx({ provider: 'google', cacheExpiresAt: RETURNED - 5_000, cacheStatus: 'created' }),
            RETURNED,
            AI_SETTINGS
        );
        // Falls back to the derived Gemini TTL rather than the stale expiry.
        expect(win).not.toBeNull();
        expect(win!.expiresAt).toBeGreaterThan(RETURNED);
    });
});

describe('formatGossamerCacheClock', () => {
    const win = (expiresAt: number): GossamerCacheWindow => ({
        provider: 'anthropic',
        modelLabel: 'Claude',
        armedAt: 0,
        expiresAt
    });

    it('renders MM:SS under an hour', () => {
        expect(formatGossamerCacheClock(win(10 * 60_000), 0)).toBe('10:00');
        expect(formatGossamerCacheClock(win(90_000), 0)).toBe('01:30');
    });

    it('renders H:MM:SS at or above an hour', () => {
        expect(formatGossamerCacheClock(win(60 * 60_000), 0)).toBe('1:00:00');
    });

    it('returns null once the window has closed', () => {
        expect(formatGossamerCacheClock(win(1_000), 2_000)).toBeNull();
        expect(formatGossamerCacheClock(null, 0)).toBeNull();
        expect(isGossamerCacheWindowOpen(win(1_000), 2_000)).toBe(false);
    });

    it('builds the short pill label', () => {
        expect(formatGossamerCachePillLabel(win(5 * 60_000), 0)).toBe('Cache 05:00');
        expect(formatGossamerCachePillLabel(win(1_000), 2_000)).toBeNull();
    });
});

describe('formatGossamerCacheCostHint', () => {
    const base: GossamerCacheWindow = { provider: 'anthropic', modelLabel: 'Claude', armedAt: 0, expiresAt: 1 };

    it('returns null when no cost was captured', () => {
        expect(formatGossamerCacheCostHint(base)).toBeNull();
        expect(formatGossamerCacheCostHint(null)).toBeNull();
    });

    it('reports the factual last-run cost with cache status', () => {
        const hit = formatGossamerCacheCostHint({ ...base, lastRunCostUSD: 0.157, cacheStatus: 'hit' });
        expect(hit).toBe('last run $0.157 · cache hit');
        const created = formatGossamerCacheCostHint({ ...base, lastRunCostUSD: 2.43, cacheStatus: 'created' });
        expect(created).toBe('last run $2.43 · cache created');
    });

    it('omits status when unknown, and never projects future runs', () => {
        const hint = formatGossamerCacheCostHint({ ...base, lastRunCostUSD: 0.157 });
        expect(hint).toBe('last run $0.157');
        expect(hint).not.toContain('next');
        expect(hint).not.toContain('~');
    });
});

// Multi-book cache proof must never inherit the last book's request or cost.
import {
    getGossamerCacheContext,
    recordGossamerCacheWindow, resolveGossamerCacheWindow,
    type GossamerCacheContext, type GossamerCacheEntry
} from './cacheWindow';
import type { AIRunRequest } from '../ai/types';
import { DEFAULT_SETTINGS } from '../settings/defaults';

const scarlet: GossamerCacheContext = {
    bookKey: 'scarlet', provider: 'anthropic', modelId: 'claude-opus-5-5'
};
const sign: GossamerCacheContext = { ...scarlet, bookKey: 'sign' };
const request: AIRunRequest = {
    feature: 'Gossamer', task: 'BeatMomentumAnalysis', requiredCapabilities: [], userInput: 'Beat list\nManuscript A',
    projectContext: 'Book A', featureModeInstructions: 'Score requested signal',
    userQuestion: 'Score momentum', returnType: 'json'
};
const windowA: GossamerCacheWindow = {
    provider: 'anthropic', modelLabel: 'Opus', armedAt: 100, expiresAt: 10_000,
    cacheStatus: 'created', lastRunCostUSD: 0.676
};

describe('book-scoped Gossamer cache windows', () => {
    it('never borrows a warm window from another book, and restores it when switching back', () => {
        const windows = new Map<string, GossamerCacheEntry>();
        recordGossamerCacheWindow(windows, scarlet, request, windowA, 100);
        expect(resolveGossamerCacheWindow(windows, sign, 200, request)).toBeNull();
        const signWindow = { ...windowA, lastRunCostUSD: 0.662 };
        recordGossamerCacheWindow(windows, sign, request, signWindow, 200);
        expect(resolveGossamerCacheWindow(windows, scarlet, 300, request)).toBe(windowA);
        expect(resolveGossamerCacheWindow(windows, sign, 300, request)).toBe(signWindow);
    });

    it('shares the stable request across signals but rejects changed manuscript, beats, or envelope', () => {
        const windows = new Map<string, GossamerCacheEntry>();
        recordGossamerCacheWindow(windows, scarlet, request, windowA, 100);
        expect(resolveGossamerCacheWindow(windows, scarlet, 200, {
            ...request, task: 'BeatTensionAnalysis', userQuestion: 'Score tension'
        })).toBe(windowA);
        for (const edited of [
            { ...request, userInput: 'Beat list\nManuscript B' },
            { ...request, userInput: 'Edited beats\nManuscript A' },
            { ...request, projectContext: 'Renamed book' },
            { ...request, featureModeInstructions: 'Changed instructions' }
        ]) expect(resolveGossamerCacheWindow(windows, scarlet, 200, edited)).toBeNull();
    });

    it('does not share proof across providers or models', () => {
        const windows = new Map<string, GossamerCacheEntry>();
        recordGossamerCacheWindow(windows, scarlet, request, windowA, 100);
        expect(resolveGossamerCacheWindow(windows, { ...scarlet, modelId: 'another-model' }, 200)).toBeNull();
        expect(resolveGossamerCacheWindow(windows, { ...scarlet, provider: 'google' }, 200)).toBeNull();
    });

    it('expires windows and clears only the selected context when cache proof is absent', () => {
        const windows = new Map<string, GossamerCacheEntry>();
        recordGossamerCacheWindow(windows, scarlet, request, windowA, 100);
        recordGossamerCacheWindow(windows, sign, request, windowA, 100);
        recordGossamerCacheWindow(windows, sign, request, null, 200);
        expect(resolveGossamerCacheWindow(windows, sign, 200)).toBeNull();
        expect(resolveGossamerCacheWindow(windows, scarlet, 200)).toBe(windowA);
        expect(resolveGossamerCacheWindow(windows, scarlet, 10_000)).toBeNull();
        recordGossamerCacheWindow(windows, sign, request, null, 10_000);
        expect(windows.size).toBe(0);
    });

    it('attributes a late response to the captured book, not the newly selected one', () => {
        const windows = new Map<string, GossamerCacheEntry>();
        let active = scarlet;
        const submittedContext = active;
        active = sign;
        recordGossamerCacheWindow(windows, submittedContext, request, windowA, 100);
        expect(resolveGossamerCacheWindow(windows, active, 200)).toBeNull();
        expect(resolveGossamerCacheWindow(windows, scarlet, 200)).toBe(windowA);
    });

    it('has no cache ownership without a book and configured model', () => {
        expect(getGossamerCacheContext({ ...DEFAULT_SETTINGS, books: [] })).toBeNull();
    });

    it('resolves the active book and model from actual settings', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            aiSettings: { ...buildDefaultAiSettings(), provider: 'anthropic' as const },
            books: [
                { id: 'a', title: 'Scarlet', sourceFolder: '01 Scarlet' },
                { id: 'b', title: 'Sign', sourceFolder: '02 Sign' }
            ],
            activeBookId: 'a'
        };
        const first = getGossamerCacheContext(settings);
        expect(JSON.parse(first!.bookKey)).toEqual(['a', '01 Scarlet', 'Scarlet']);
        expect(first?.provider).toBe('anthropic');
        expect(first?.modelId).toBeTruthy();
        settings.activeBookId = 'b';
        const second = getGossamerCacheContext(settings);
        expect(JSON.parse(second!.bookKey)).toEqual(['b', '02 Sign', 'Sign']);
        expect(second?.bookKey).not.toBe(first?.bookKey);
    });
});
