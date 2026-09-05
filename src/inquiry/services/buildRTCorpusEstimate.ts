import type { RTCorpusTokenEstimate } from '../../ai/types';
import type { InquiryPayloadStats } from '../types';
import { estimateTokensFromChars, DEFAULT_CHARS_PER_TOKEN } from '../../ai/estimates';

// Alias of the canonical DEFAULT_CHARS_PER_TOKEN (ai/estimates). Kept as a
// named re-export so existing call sites read naturally; it is NOT a second
// value and must never be given one.
export const RT_CORPUS_CHARS_PER_TOKEN = DEFAULT_CHARS_PER_TOKEN;

const normalizeChars = (value: number | undefined): number => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : 0
);

export type RTCorpusCharCounts = {
    sceneCount: number;
    outlineCount: number;
    referenceCount: number;
    sceneChars: number;
    outlineChars: number;
    referenceChars: number;
};

/** The one chars-to-tokens arithmetic behind every RT corpus estimate. */
export function buildRTCorpusEstimateFromChars(counts: RTCorpusCharCounts): RTCorpusTokenEstimate {
    const breakdown = {
        scenesTokens: estimateTokensFromChars(counts.sceneChars, RT_CORPUS_CHARS_PER_TOKEN),
        outlineTokens: estimateTokensFromChars(counts.outlineChars, RT_CORPUS_CHARS_PER_TOKEN),
        referenceTokens: estimateTokensFromChars(counts.referenceChars, RT_CORPUS_CHARS_PER_TOKEN)
    };
    return {
        sceneCount: counts.sceneCount,
        outlineCount: counts.outlineCount,
        referenceCount: counts.referenceCount,
        evidenceChars: counts.sceneChars + counts.outlineChars + counts.referenceChars,
        estimatedTokens: breakdown.scenesTokens + breakdown.outlineTokens + breakdown.referenceTokens,
        method: 'rt_chars_heuristic',
        breakdown
    };
}

export function buildRTCorpusEstimate(payloadStats: InquiryPayloadStats): RTCorpusTokenEstimate {
    const sceneChars = normalizeChars(payloadStats.sceneChars);
    const outlineChars = normalizeChars(payloadStats.outlineChars);
    const referenceChars = normalizeChars(payloadStats.referenceChars);
    // Stats with no per-class split carry only the evidence total; it is
    // attributed to scenes so the estimate still adds up.
    const hasBreakdown = sceneChars + outlineChars + referenceChars > 0;
    return buildRTCorpusEstimateFromChars({
        sceneCount: Math.max(0, Math.floor(payloadStats.sceneTotal || 0)),
        outlineCount: Math.max(0, Math.floor((payloadStats.bookOutlineCount || 0) + (payloadStats.sagaOutlineCount || 0))),
        referenceCount: Math.max(0, Math.floor(payloadStats.referenceCounts?.total || 0)),
        sceneChars: hasBreakdown ? sceneChars : normalizeChars(payloadStats.evidenceChars),
        outlineChars: hasBreakdown ? outlineChars : 0,
        referenceChars: hasBreakdown ? referenceChars : 0
    });
}
