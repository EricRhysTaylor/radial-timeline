import { describe, expect, it } from 'vitest';
import {
    CACHE_ARMED_PILL_TEXT,
    buildKeyBlockedPreviewCopy,
    isCloudKeyBlockedState,
    MAX_PREVIEW_SIGNALS,
    PREVIEW_SIGNAL_PRIORITY,
    buildOutlineCapacityLine,
    buildReferenceCapacityLine,
    buildScenesCapacityLine,
    buildTokenCapacityLine,
    estimateTokensFromChars,
    formatApproxTokens,
    formatCorpusBreakdownToken,
    formatCorpusStructureSummary,
    formatCorpusTokenSummary,
    formatInquiryCount,
    formatPreviewCacheObservedLabel,
    formatPreviewCacheRemaining,
    formatPreviewReasonLabel,
    formatPromptToken,
    mergePreviewCachePills,
    resolvePreviewSignals
} from './aiSettingsPreview';
import type { PreviewPill } from './aiSettingsPreview';
import { t, tCount } from '../../i18n';

describe('aiSettingsPreview constants', () => {
    it('locks CACHE_ARMED_PILL_TEXT to the static-capability wording (doctrine)', () => {
        expect(CACHE_ARMED_PILL_TEXT).toBe('Provider cache supported');
    });

    it('ranks preview signals citation → reuse → passBehavior and caps at 4', () => {
        expect(PREVIEW_SIGNAL_PRIORITY).toEqual(['citation', 'reuse', 'passBehavior']);
        expect(MAX_PREVIEW_SIGNALS).toBe(4);
    });
});

describe('formatInquiryCount', () => {
    it('returns ? for null', () => {
        expect(formatInquiryCount(null)).toBe('?');
    });

    it('locale-formats integers', () => {
        expect(formatInquiryCount(0)).toBe('0');
        expect(formatInquiryCount(1)).toBe('1');
        expect(formatInquiryCount(1234)).toBe((1234).toLocaleString());
    });
});

describe('formatCorpusBreakdownToken', () => {
    it('returns em-dash for null', () => {
        expect(formatCorpusBreakdownToken(null)).toBe('—');
    });

    it('formats >=1k with one decimal and strips trailing .0', () => {
        expect(formatCorpusBreakdownToken(1000)).toBe('~1k');
        expect(formatCorpusBreakdownToken(1500)).toBe('~1.5k');
        expect(formatCorpusBreakdownToken(125_000)).toBe('~125k');
        expect(formatCorpusBreakdownToken(99_500)).toBe('~99.5k');
    });

    it('treats non-finite tokens as 0', () => {
        expect(formatCorpusBreakdownToken(NaN)).toBe('~0k');
        expect(formatCorpusBreakdownToken(Infinity)).toBe('~0k');
    });
});

describe('estimateTokensFromChars', () => {
    it('returns 0 for zero/negative input', () => {
        expect(estimateTokensFromChars(0)).toBe(0);
        expect(estimateTokensFromChars(-100)).toBe(0);
    });

    it('uses the 4-char-per-token heuristic and ceils', () => {
        expect(estimateTokensFromChars(1)).toBe(1);
        expect(estimateTokensFromChars(4)).toBe(1);
        expect(estimateTokensFromChars(5)).toBe(2);
        expect(estimateTokensFromChars(400)).toBe(100);
    });
});

describe('formatPromptToken', () => {
    it('returns em-dash for null', () => {
        expect(formatPromptToken(null)).toBe('—');
    });

    it('delegates to formatCorpusBreakdownToken at >=1000', () => {
        expect(formatPromptToken(1500)).toBe('~1.5k');
        expect(formatPromptToken(125_000)).toBe('~125k');
    });

    it('uses locale-formatted integer with ~ prefix below 1000', () => {
        expect(formatPromptToken(0)).toBe('~0');
        expect(formatPromptToken(123)).toBe(`~${(123).toLocaleString()}`);
        expect(formatPromptToken(999)).toBe(`~${(999).toLocaleString()}`);
    });
});

describe('buildTokenCapacityLine', () => {
    it('composes label and formatted token', () => {
        expect(buildTokenCapacityLine('Zone question', 250))
            .toBe(`Zone question (~${(250).toLocaleString()})`);
        expect(buildTokenCapacityLine('Role template', null)).toBe('Role template (—)');
        expect(buildTokenCapacityLine('Big block', 12_500)).toBe('Big block (~12.5k)');
    });
});

describe('buildScenesCapacityLine', () => {
    it('always uses full-text branch', () => {
        expect(buildScenesCapacityLine(42, 16_000))
            .toBe(t('ui.aiSettingsPreview.scenesCapacityLine', { count: (42).toLocaleString(), tokens: '~16k' }));
    });

    it('passes ? for null count', () => {
        expect(buildScenesCapacityLine(null, null)).toBe(t('ui.aiSettingsPreview.scenesCapacityLine', { count: '?', tokens: '—' }));
    });
});

describe('buildOutlineCapacityLine', () => {
    it('returns unavailable for null count', () => {
        expect(buildOutlineCapacityLine(null, null)).toBe(t('ui.aiSettingsPreview.outlineUnavailableLine', { tokens: '—' }));
        expect(buildOutlineCapacityLine(null, 2000)).toBe(t('ui.aiSettingsPreview.outlineUnavailableLine', { tokens: '~2k' }));
    });

    it('returns full-text for positive count', () => {
        expect(buildOutlineCapacityLine(3, 1500))
            .toBe(t('ui.aiSettingsPreview.outlineFullTextLine', { count: (3).toLocaleString(), tokens: '~1.5k' }));
    });

    it('returns Outline — none for zero count', () => {
        expect(buildOutlineCapacityLine(0, 0)).toBe(t('ui.aiSettingsPreview.outlineNone'));
        expect(buildOutlineCapacityLine(0, 1000)).toBe(t('ui.aiSettingsPreview.outlineNone'));
    });
});

describe('buildReferenceCapacityLine', () => {
    it('returns unavailable for null count', () => {
        expect(buildReferenceCapacityLine(null, null)).toBe(t('ui.aiSettingsPreview.referenceUnavailableLine', { tokens: '—' }));
        expect(buildReferenceCapacityLine(null, 500)).toBe(t('ui.aiSettingsPreview.referenceUnavailableLine', { tokens: '~0.5k' }));
    });

    it('returns included for positive count (uses "included" not "full text")', () => {
        expect(buildReferenceCapacityLine(2, 1200))
            .toBe(t('ui.aiSettingsPreview.referenceIncludedLine', { count: (2).toLocaleString(), tokens: '~1.2k' }));
    });

    it('returns References — none for zero count', () => {
        expect(buildReferenceCapacityLine(0, 0)).toBe(t('ui.aiSettingsPreview.referenceNone'));
        expect(buildReferenceCapacityLine(0, 5000)).toBe(t('ui.aiSettingsPreview.referenceNone'));
    });
});

describe('formatApproxTokens', () => {
    it('returns n/a for non-finite / non-positive', () => {
        expect(formatApproxTokens(NaN)).toBe(t('ui.aiSettingsPreview.notAvailable'));
        expect(formatApproxTokens(Infinity)).toBe(t('ui.aiSettingsPreview.notAvailable'));
        expect(formatApproxTokens(0)).toBe(t('ui.aiSettingsPreview.notAvailable'));
        expect(formatApproxTokens(-1)).toBe(t('ui.aiSettingsPreview.notAvailable'));
    });

    it('rounds sub-1000 to ~<int>', () => {
        expect(formatApproxTokens(1)).toBe('~1');
        expect(formatApproxTokens(750)).toBe('~750');
        expect(formatApproxTokens(999)).toBe('~999');
    });

    it('rounds 1000+ to ~<int>k integer thousands', () => {
        expect(formatApproxTokens(1000)).toBe('~1k');
        expect(formatApproxTokens(1500)).toBe('~2k');
        expect(formatApproxTokens(125_000)).toBe('~125k');
    });

    it('uses ~<n>M with two decimals under 10M and one decimal at >=10M', () => {
        expect(formatApproxTokens(1_000_000)).toBe('~1.00M');
        expect(formatApproxTokens(2_500_000)).toBe('~2.50M');
        expect(formatApproxTokens(10_000_000)).toBe('~10.0M');
        expect(formatApproxTokens(25_500_000)).toBe('~25.5M');
    });
});

describe('formatCorpusStructureSummary', () => {
    it('returns "0 scenes" when both zero (the "No scenes or outlines" fallback is unreachable with current branch ordering — locking the actual preserved behavior, not the dead fallback)', () => {
        expect(formatCorpusStructureSummary(0, 0)).toBe(tCount('scene', 0));
    });

    it('pluralizes scenes alone', () => {
        expect(formatCorpusStructureSummary(1, 0)).toBe(tCount('scene', 1));
        expect(formatCorpusStructureSummary(5, 0)).toBe(tCount('scene', 5));
        expect(formatCorpusStructureSummary(0, 0)).toBe(tCount('scene', 0));
    });

    it('omits scenes part when scene count is 0 and outline count > 0', () => {
        expect(formatCorpusStructureSummary(0, 3)).toBe(tCount('outline', 3));
        expect(formatCorpusStructureSummary(0, 1)).toBe(tCount('outline', 1));
    });

    it('joins scenes + outlines when both positive', () => {
        expect(formatCorpusStructureSummary(4, 2)).toBe(`${tCount('scene', 4)} + ${tCount('outline', 2)}`);
        expect(formatCorpusStructureSummary(1, 1)).toBe(`${tCount('scene', 1)} + ${tCount('outline', 1)}`);
    });
});

describe('formatCorpusTokenSummary', () => {
    it('appends " tokens" to corpus shorthand', () => {
        expect(formatCorpusTokenSummary(1500)).toBe(t('ui.aiSettingsPreview.corpusTokens', { tokens: '~1.5k' }));
        expect(formatCorpusTokenSummary(125_000)).toBe(t('ui.aiSettingsPreview.corpusTokens', { tokens: '~125k' }));
    });
});

describe('formatPreviewReasonLabel', () => {
    it('special-cases quota_exceeded', () => {
        expect(formatPreviewReasonLabel('error', 'quota_exceeded')).toBe(t('ui.aiSettingsPreview.reasonQuotaExceeded'));
    });

    it('special-cases spend_cap', () => {
        expect(formatPreviewReasonLabel(undefined, 'spend_cap')).toBe(t('ui.aiSettingsPreview.reasonSpendCap'));
    });

    it('normalizes underscores → spaces and title-cases first char of reason', () => {
        expect(formatPreviewReasonLabel('error', 'rate_limit')).toBe('Rate limit');
        expect(formatPreviewReasonLabel('error', 'invalid_response')).toBe('Invalid response');
    });

    it('falls back to status when reason is missing', () => {
        expect(formatPreviewReasonLabel('error', undefined)).toBe('Error');
        expect(formatPreviewReasonLabel('error')).toBe('Error');
    });

    it('returns "issue detected" when both are empty', () => {
        expect(formatPreviewReasonLabel(undefined, undefined)).toBe(t('ui.aiSettingsPreview.reasonIssueDetected'));
        expect(formatPreviewReasonLabel('', '')).toBe(t('ui.aiSettingsPreview.reasonIssueDetected'));
        expect(formatPreviewReasonLabel('   ', '   ')).toBe(t('ui.aiSettingsPreview.reasonIssueDetected'));
    });
});

describe('formatPreviewCacheRemaining', () => {
    it('floor-rounds to at least 1 minute', () => {
        expect(formatPreviewCacheRemaining(0)).toBe(t('ui.aiSettingsPreview.cacheRemainingMinutes', { minutes: 1 }));
        expect(formatPreviewCacheRemaining(1)).toBe(t('ui.aiSettingsPreview.cacheRemainingMinutes', { minutes: 1 }));
        expect(formatPreviewCacheRemaining(30_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingMinutes', { minutes: 1 }));
        expect(formatPreviewCacheRemaining(60_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingMinutes', { minutes: 1 }));
    });

    it('uses Nm remaining below 1 hour', () => {
        expect(formatPreviewCacheRemaining(60_001)).toBe(t('ui.aiSettingsPreview.cacheRemainingMinutes', { minutes: 2 }));
        expect(formatPreviewCacheRemaining(15 * 60_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingMinutes', { minutes: 15 }));
        expect(formatPreviewCacheRemaining(59 * 60_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingMinutes', { minutes: 59 }));
    });

    it('uses Xh Ym remaining past 60 minutes', () => {
        expect(formatPreviewCacheRemaining(60 * 60_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingHours', { hours: 1 }));
        expect(formatPreviewCacheRemaining(90 * 60_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingHoursMinutes', { hours: 1, minutes: 30 }));
        expect(formatPreviewCacheRemaining(2 * 60 * 60_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingHours', { hours: 2 }));
        expect(formatPreviewCacheRemaining((2 * 60 + 45) * 60_000)).toBe(t('ui.aiSettingsPreview.cacheRemainingHoursMinutes', { hours: 2, minutes: 45 }));
    });
});

describe('formatPreviewCacheObservedLabel', () => {
    it('returns null for missing or non-positive', () => {
        expect(formatPreviewCacheObservedLabel(undefined)).toBeNull();
        expect(formatPreviewCacheObservedLabel(NaN)).toBeNull();
        expect(formatPreviewCacheObservedLabel(Infinity)).toBeNull();
        expect(formatPreviewCacheObservedLabel(0)).toBeNull();
        expect(formatPreviewCacheObservedLabel(-0.1)).toBeNull();
    });

    it('formats positive ratio as Observed cache hit · N% reused', () => {
        expect(formatPreviewCacheObservedLabel(0.5)).toBe('Observed cache hit · 50% reused');
        expect(formatPreviewCacheObservedLabel(1)).toBe('Observed cache hit · 100% reused');
        expect(formatPreviewCacheObservedLabel(0.001)).toBe('Observed cache hit · 0% reused');
    });

    it('clamps ratios above 1 to 100%', () => {
        expect(formatPreviewCacheObservedLabel(1.5)).toBe('Observed cache hit · 100% reused');
    });
});

describe('mergePreviewCachePills', () => {
    it('returns empty input as-is', () => {
        expect(mergePreviewCachePills([])).toEqual([]);
    });

    it('passes through unrelated pills unchanged', () => {
        const other: PreviewPill[] = [
            { text: 'Citation pill', extraCls: 'ert-test-tone-a' },
            { text: 'Pass behavior', extraCls: 'ert-test-tone-b' }
        ];
        expect(mergePreviewCachePills(other)).toEqual(other);
    });

    it('collapses the static cache-armed pill on its own', () => {
        const result = mergePreviewCachePills([
            { text: CACHE_ARMED_PILL_TEXT, extraCls: 'ert-ai-pill--active' }
        ]);
        expect(result).toEqual([
            { text: CACHE_ARMED_PILL_TEXT, extraCls: 'ert-ai-pill--active' }
        ]);
    });

    it('treats Cache enabled / Provider cache enabled as the armed base', () => {
        const result = mergePreviewCachePills([
            { text: 'Cache enabled', extraCls: 'ert-ai-pill--active' }
        ]);
        expect(result[0].text).toBe(CACHE_ARMED_PILL_TEXT);
    });

    it('merges armed + observed-hit into a single segmented pill', () => {
        const result = mergePreviewCachePills([
            { text: CACHE_ARMED_PILL_TEXT, extraCls: 'ert-ai-pill--active' },
            { text: 'Observed cache hit · 75% reused', extraCls: 'ert-ai-pill--success' }
        ]);
        expect(result).toEqual([
            {
                text: `${CACHE_ARMED_PILL_TEXT} — 75% reused`,
                extraCls: 'ert-ai-pill--active'
            }
        ]);
    });

    it('merges Cache off base with window-expired segment and forces muted tone', () => {
        const result = mergePreviewCachePills([
            { text: 'Cache off (exclusive of citations)', extraCls: 'ert-ai-pill--muted' },
            { text: 'Cache window expired' }
        ]);
        expect(result).toEqual([
            {
                text: 'Cache off (exclusive of citations) — window expired',
                extraCls: 'ert-ai-pill--muted'
            }
        ]);
    });

    it('produces armed-only pill when only window-expired present (no base)', () => {
        const result = mergePreviewCachePills([
            { text: 'Cache window expired' }
        ]);
        expect(result).toEqual([
            { text: `${CACHE_ARMED_PILL_TEXT} — window expired`, extraCls: 'ert-ai-pill--muted' }
        ]);
    });

    it('keeps other pills before the merged cache pill', () => {
        const result = mergePreviewCachePills([
            { text: 'Citations · supported', extraCls: 'ert-ai-pill--active' },
            { text: CACHE_ARMED_PILL_TEXT, extraCls: 'ert-ai-pill--active' },
            { text: 'Observed cache hit · 30% reused' }
        ]);
        expect(result).toEqual([
            { text: 'Citations · supported', extraCls: 'ert-ai-pill--active' },
            { text: `${CACHE_ARMED_PILL_TEXT} — 30% reused`, extraCls: 'ert-ai-pill--active' }
        ]);
    });
});

describe('resolvePreviewSignals', () => {
    const cit: PreviewPill = { text: 'Cite', extraCls: 'ert-test-tone-a' };
    const reuse: PreviewPill = { text: 'Reuse', extraCls: 'ert-test-tone-b' };
    const pass: PreviewPill = { text: 'Pass', extraCls: 'ert-test-tone-c' };

    it('returns empty array when all inputs are null', () => {
        expect(resolvePreviewSignals({
            citationLabel: null,
            reuseLabel: null,
            passBehaviorLabel: null
        })).toEqual([]);
    });

    it('orders citation → reuse → passBehavior regardless of input order', () => {
        expect(resolvePreviewSignals({
            passBehaviorLabel: pass,
            citationLabel: cit,
            reuseLabel: reuse
        })).toEqual([cit, reuse, pass]);
    });

    it('drops null entries and keeps surviving order', () => {
        expect(resolvePreviewSignals({
            citationLabel: null,
            reuseLabel: reuse,
            passBehaviorLabel: pass
        })).toEqual([reuse, pass]);
    });
});

describe('cloud key gating for the preview card', () => {
    it('treats only the three cannot-run credential states as blocking', () => {
        expect(isCloudKeyBlockedState('not_configured')).toBe(true);
        expect(isCloudKeyBlockedState('rejected')).toBe(true);
        expect(isCloudKeyBlockedState('network_blocked')).toBe(true);
        expect(isCloudKeyBlockedState('ready')).toBe(false);
        expect(isCloudKeyBlockedState('checking')).toBe(false);
        expect(isCloudKeyBlockedState(undefined)).toBe(false);
    });

    it('names the provider and points at the API keys fold in every blocked state', () => {
        const noKey = buildKeyBlockedPreviewCopy('OpenAI', 'not_configured');
        expect(noKey.title).toBe(t('ui.aiSettingsPreview.noKeyTitle'));
        expect(noKey.detail).toBe(t('ui.aiSettingsPreview.noKeyDetail', { provider: 'OpenAI' }));
        expect(noKey.forecastReason).toBe(t('ui.aiSettingsPreview.noKeyForecast', { provider: 'OpenAI' }));

        const rejected = buildKeyBlockedPreviewCopy('Anthropic', 'rejected');
        expect(rejected.title).toBe(t('ui.aiSettingsPreview.keyRejectedTitle'));
        expect(rejected.detail).toBe(t('ui.aiSettingsPreview.keyRejectedDetail', { provider: 'Anthropic' }));

        const blocked = buildKeyBlockedPreviewCopy('Google', 'network_blocked');
        expect(blocked.title).toBe(t('ui.aiSettingsPreview.unreachableTitle'));
        expect(blocked.forecastReason).toBe(t('ui.aiSettingsPreview.unreachableForecast', { provider: 'Google' }));
    });
});
