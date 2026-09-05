import { describe, expect, it } from 'vitest';
import { computeCitationIntegritySummary, type InquiryResult } from './state';

function baseResult(): InquiryResult {
    return {
        runId: 'run-1',
        scope: 'book',
        scopeLabel: 'B1',
        mode: 'flow',
        selectionMode: 'discover',
        roleValidation: 'ok',
        questionId: 'q',
        summary: '',
        verdict: { flow: 0, depth: 0 },
        findings: []
    };
}

describe('computeCitationIntegritySummary', () => {
    it('returns zeroed counts and evidenceCompromised=false on a clean result with no findings', () => {
        const summary = computeCitationIntegritySummary(baseResult());
        expect(summary).toEqual({
            verifiedCount: 0,
            rescuedCount: 0,
            unverifiedCount: 0,
            mismatchCount: 0,
            evidenceCompromised: false
        });
    });

    it('counts verified, rescued, and mismatch cases correctly', () => {
        const result: InquiryResult = {
            ...baseResult(),
            findings: [
                { refId: 'scn_aaaaaaaa', kind: 'unclear', headline: 'clean', bullets: [], related: [], evidenceType: 'mixed' },
                { refId: 'scn_bbbbbbbb', kind: 'unclear', headline: 'rescued', bullets: [], related: [], evidenceType: 'mixed', rawRef: { refId: 'scn_fakefake' } }
            ],
            citationIntegrityWarnings: [
                { stage: 'ref_label_mismatch', message: 'x' },
                { stage: 'unresolved_ref', message: 'y' }
            ]
        };
        const summary = computeCitationIntegritySummary(result);
        expect(summary.verifiedCount).toBe(2);
        expect(summary.rescuedCount).toBe(1);
        expect(summary.mismatchCount).toBe(1);
        expect(summary.unverifiedCount).toBe(0);
        expect(summary.evidenceCompromised).toBe(false);
    });

    it('flags evidenceCompromised when every citation was unverified', () => {
        const result: InquiryResult = {
            ...baseResult(),
            findings: [],
            unverifiedFindings: [
                { kind: 'unclear', headline: 'ghost-a', bullets: [], warning: 'w' },
                { kind: 'unclear', headline: 'ghost-b', bullets: [], warning: 'w' }
            ]
        };
        const summary = computeCitationIntegritySummary(result);
        expect(summary.verifiedCount).toBe(0);
        expect(summary.unverifiedCount).toBe(2);
        expect(summary.evidenceCompromised).toBe(true);
    });

    it('does NOT flag evidenceCompromised when there is at least one verified finding', () => {
        const result: InquiryResult = {
            ...baseResult(),
            findings: [
                { refId: 'scn_aaaaaaaa', kind: 'unclear', headline: 'one clean', bullets: [], related: [], evidenceType: 'mixed' }
            ],
            unverifiedFindings: [
                { kind: 'unclear', headline: 'ghost', bullets: [], warning: 'w' }
            ]
        };
        const summary = computeCitationIntegritySummary(result);
        expect(summary.evidenceCompromised).toBe(false);
    });

    it('is safe on legacy-shaped results that lack the new integrity arrays entirely', () => {
        const legacy: Partial<InquiryResult> = {
            findings: [
                { refId: 'scn_aaaaaaaa', kind: 'unclear', headline: 'legacy', bullets: [], related: [], evidenceType: 'mixed' }
            ]
        };
        const summary = computeCitationIntegritySummary(legacy as InquiryResult);
        expect(summary.verifiedCount).toBe(1);
        expect(summary.unverifiedCount).toBe(0);
        expect(summary.mismatchCount).toBe(0);
        expect(summary.rescuedCount).toBe(0);
        expect(summary.evidenceCompromised).toBe(false);
    });

    it('is safe on a fully empty legacy result (no findings array at all)', () => {
        const legacy = {} as InquiryResult;
        const summary = computeCitationIntegritySummary(legacy);
        expect(summary).toEqual({
            verifiedCount: 0,
            rescuedCount: 0,
            unverifiedCount: 0,
            mismatchCount: 0,
            evidenceCompromised: false
        });
    });
});
