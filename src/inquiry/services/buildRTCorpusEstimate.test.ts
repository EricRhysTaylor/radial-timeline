import { describe, expect, it } from 'vitest';
import { buildRTCorpusEstimate, buildRTCorpusEstimateFromChars } from './buildRTCorpusEstimate';
import type { InquiryPayloadStats } from '../types';

function makeStats(overrides: Partial<InquiryPayloadStats> = {}): InquiryPayloadStats {
    return {
        scope: 'book',
        activeBookId: 'Book 1',
        sceneTotal: 53,
        sceneSynopsisUsed: 0,
        sceneSynopsisAvailable: 0,
        sceneFullTextCount: 53,
        sceneChars: 572410,
        bookOutlineCount: 1,
        bookOutlineSummaryCount: 0,
        bookOutlineFullCount: 1,
        sagaOutlineCount: 0,
        sagaOutlineSummaryCount: 0,
        sagaOutlineFullCount: 0,
        outlineChars: 8935,
        referenceCounts: { character: 2, place: 1, power: 0, other: 1, total: 4 },
        referenceByClass: { character: 2, place: 1, other: 1 },
        referenceChars: 7620,
        evidenceChars: 588965,
        resolvedRoots: [],
        manifestFingerprint: 'fp',
        ...overrides
    };
}

describe('buildRTCorpusEstimate', () => {
    it('returns deterministic corpus estimate without prompt overhead', () => {
        const estimate = buildRTCorpusEstimate(makeStats());
        expect(estimate.sceneCount).toBe(53);
        expect(estimate.outlineCount).toBe(1);
        expect(estimate.referenceCount).toBe(4);
        expect(estimate.evidenceChars).toBe(588965);
        expect(estimate.breakdown).toEqual({
            scenesTokens: Math.ceil(572410 / 4),
            outlineTokens: Math.ceil(8935 / 4),
            referenceTokens: Math.ceil(7620 / 4)
        });
        expect(estimate.estimatedTokens).toBe(
            estimate.breakdown.scenesTokens
            + estimate.breakdown.outlineTokens
            + estimate.breakdown.referenceTokens
        );
        expect(estimate.method).toBe('rt_chars_heuristic');
    });

    it('normalizes invalid values to zero', () => {
        const estimate = buildRTCorpusEstimate(makeStats({
            sceneTotal: Number.NaN as unknown as number,
            sceneChars: Number.NaN as unknown as number,
            bookOutlineCount: -1,
            sagaOutlineCount: Number.NaN as unknown as number,
            outlineChars: -10,
            referenceCounts: { character: 0, place: 0, power: 0, other: 0, total: -3 },
            referenceChars: Number.NaN as unknown as number,
            evidenceChars: Number.NaN as unknown as number
        }));
        expect(estimate.sceneCount).toBe(0);
        expect(estimate.outlineCount).toBe(0);
        expect(estimate.referenceCount).toBe(0);
        expect(estimate.evidenceChars).toBe(0);
        expect(estimate.estimatedTokens).toBe(0);
        expect(estimate.breakdown).toEqual({
            scenesTokens: 0,
            outlineTokens: 0,
            referenceTokens: 0
        });
    });

    it('keeps total aligned with the breakdown for Book B1', () => {
        const estimate = buildRTCorpusEstimate(makeStats());
        const breakdownTotal = estimate.breakdown.scenesTokens
            + estimate.breakdown.outlineTokens
            + estimate.breakdown.referenceTokens;
        expect(estimate.estimatedTokens).toBe(breakdownTotal);
    });
});

describe('buildRTCorpusEstimateFromChars', () => {
    it('is the arithmetic the payload-stats path runs on', () => {
        const fromStats = buildRTCorpusEstimate(makeStats());
        const fromChars = buildRTCorpusEstimateFromChars({
            sceneCount: 53, outlineCount: 1, referenceCount: 4,
            sceneChars: 572410, outlineChars: 8935, referenceChars: 7620
        });
        expect(fromChars).toEqual(fromStats);
        expect(fromChars.method).toBe('rt_chars_heuristic');
        expect(fromChars.evidenceChars).toBe(572410 + 8935 + 7620);
    });
});
