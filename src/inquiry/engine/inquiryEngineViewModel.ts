import type { RTCorpusTokenEstimate } from '../../ai/types';
import type { TokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';

export function buildInquiryEngineCorpusSummary(
    estimate: RTCorpusTokenEstimate,
    requestTokens: number,
    formatApproxCorpusTokens: (value: number) => string,
    requestEstimateMethod?: TokenEstimateMethod
): string {
    if (requestTokens <= 0 && estimate.estimatedTokens <= 0) return 'Full request · Estimating…';
    const outlineLabel = estimate.breakdown.outlineTokens > 0
        ? `Outline ${formatApproxCorpusTokens(estimate.breakdown.outlineTokens)}`
        : 'Outline none';
    const referenceLabel = estimate.breakdown.referenceTokens > 0
        ? `References ${formatApproxCorpusTokens(estimate.breakdown.referenceTokens)}`
        : 'References none';
    // When the provider count failed, surface that honestly instead of stalling
    // on "Estimating…" which implies in-flight work. Per RT doctrine §3 we
    // never silently substitute a heuristic — "unavailable" is the correct
    // signal.
    const requestLabel = requestTokens > 0
        ? `Full request ${formatApproxCorpusTokens(requestTokens)}`
        : requestEstimateMethod === 'unavailable'
            ? 'Full request unavailable'
            : 'Full request Estimating…';
    return [
        requestLabel,
        estimate.estimatedTokens > 0
            ? `Corpus ${formatApproxCorpusTokens(estimate.estimatedTokens)}`
            : 'Corpus estimating…',
        `Scenes ${formatApproxCorpusTokens(estimate.breakdown.scenesTokens)}`,
        outlineLabel,
        referenceLabel
    ].join(' · ');
}
