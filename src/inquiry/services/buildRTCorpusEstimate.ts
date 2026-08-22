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

export function buildRTCorpusEstimate(payloadStats: InquiryPayloadStats): RTCorpusTokenEstimate {
    const sceneChars = normalizeChars(payloadStats.sceneChars);
    const outlineChars = normalizeChars(payloadStats.outlineChars);
    const referenceChars = normalizeChars(payloadStats.referenceChars);
    const normalizedEvidenceChars = normalizeChars(payloadStats.evidenceChars);
    const breakdownCharsTotal = sceneChars + outlineChars + referenceChars;
    const evidenceChars = breakdownCharsTotal > 0 ? breakdownCharsTotal : normalizedEvidenceChars;
    const breakdown = breakdownCharsTotal > 0
        ? {
            scenesTokens: estimateTokensFromChars(sceneChars, RT_CORPUS_CHARS_PER_TOKEN),
            outlineTokens: estimateTokensFromChars(outlineChars, RT_CORPUS_CHARS_PER_TOKEN),
            referenceTokens: estimateTokensFromChars(referenceChars, RT_CORPUS_CHARS_PER_TOKEN)
        }
        : {
            scenesTokens: estimateTokensFromChars(evidenceChars, RT_CORPUS_CHARS_PER_TOKEN),
            outlineTokens: 0,
            referenceTokens: 0
        };
    const estimatedTokens = breakdown.scenesTokens + breakdown.outlineTokens + breakdown.referenceTokens;
    return {
        sceneCount: Math.max(0, Math.floor(payloadStats.sceneTotal || 0)),
        outlineCount: Math.max(0, Math.floor((payloadStats.bookOutlineCount || 0) + (payloadStats.sagaOutlineCount || 0))),
        referenceCount: Math.max(0, Math.floor(payloadStats.referenceCounts?.total || 0)),
        evidenceChars,
        estimatedTokens,
        method: 'rt_chars_heuristic',
        breakdown
    };
}
