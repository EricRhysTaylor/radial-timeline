import { describe, it, expect } from 'vitest';
import {
    pickBestTokenEstimate,
    tokenEstimateFromMethod,
    formatTokenShorthand,
    formatTokenHeadline,
    type TokenEstimate
} from './tokenEstimate';

describe('TokenEstimate — invariants', () => {
    it('0 never means unknown — discriminated union forces source check', () => {
        const zero: TokenEstimate = { source: 'provider_count', tokens: 0 };
        // provider_count + 0 is a meaningful observation (actually zero input)
        // and is NOT the same as `unavailable`. Confirm the union enforces this.
        expect(zero.source).toBe('provider_count');
        const unavail: TokenEstimate = { source: 'unavailable' };
        expect(unavail.source).toBe('unavailable');
        // TypeScript prevents reading `.tokens` from an `unavailable` case
        // — verified at compile time.
    });

    it('formatTokenShorthand returns em-dash for unavailable/pending — never ~0k', () => {
        expect(formatTokenShorthand({ source: 'unavailable' })).toBe('—');
        expect(formatTokenShorthand({ source: 'pending' })).toBe('—');
    });

    it('formatTokenHeadline drops the unit pill for unavailable/pending', () => {
        expect(formatTokenHeadline({ source: 'unavailable' })).toEqual({ numericText: 'Unavailable', unitText: null });
        expect(formatTokenHeadline({ source: 'pending' })).toEqual({ numericText: 'Estimating…', unitText: null });
    });

    it('formatTokenHeadline shows the value + unit for known sources', () => {
        const h = formatTokenHeadline({ source: 'provider_count', tokens: 135_200 });
        expect(h.numericText).toMatch(/^~\d/);
        expect(h.unitText).toBe('tokens');
    });
});

describe('pickBestTokenEstimate — source precedence', () => {
    it('prior_run beats provider_count', () => {
        const result = pickBestTokenEstimate(
            { source: 'provider_count', tokens: 100 },
            { source: 'prior_run', tokens: 200 }
        );
        expect(result).toEqual({ source: 'prior_run', tokens: 200 });
    });

    it('provider_count beats local_estimate', () => {
        const result = pickBestTokenEstimate(
            { source: 'local_estimate', tokens: 100 },
            { source: 'provider_count', tokens: 200 }
        );
        expect(result).toEqual({ source: 'provider_count', tokens: 200 });
    });

    it('local_estimate with zero tokens is skipped (no-signal)', () => {
        const result = pickBestTokenEstimate(
            { source: 'local_estimate', tokens: 0 },
            { source: 'pending' }
        );
        expect(result).toEqual({ source: 'pending' });
    });

    it('returns unavailable when nothing has signal', () => {
        const result = pickBestTokenEstimate(null, undefined, { source: 'local_estimate', tokens: 0 });
        expect(result).toEqual({ source: 'unavailable' });
    });

    it('pending outranks unavailable so an in-flight snapshot does not report failure', () => {
        // Caller passes both pending and unavailable candidates — the
        // pending one wins.
        const result = pickBestTokenEstimate({ source: 'unavailable' }, { source: 'pending' });
        expect(result).toEqual({ source: 'pending' });
    });
});

describe('tokenEstimateFromMethod — canonical converter', () => {
    it('google_count with positive tokens → provider_count', () => {
        expect(tokenEstimateFromMethod('google_count', 264_606))
            .toEqual({ source: 'provider_count', tokens: 264_606 });
    });

    it('google_count with 0 tokens → unavailable (positive method, no usable value)', () => {
        expect(tokenEstimateFromMethod('google_count', 0)).toEqual({ source: 'unavailable' });
    });

    it('unavailable method → unavailable (regardless of token value)', () => {
        expect(tokenEstimateFromMethod('unavailable', 0)).toEqual({ source: 'unavailable' });
        expect(tokenEstimateFromMethod('unavailable', undefined)).toEqual({ source: 'unavailable' });
    });

    it('heuristic_chars with positive tokens → local_estimate', () => {
        expect(tokenEstimateFromMethod('heuristic_chars', 135_200))
            .toEqual({ source: 'local_estimate', tokens: 135_200 });
    });

    it('undefined method + undefined tokens → pending', () => {
        expect(tokenEstimateFromMethod(undefined, undefined)).toEqual({ source: 'pending' });
    });

    it('REGRESSION: Gemini countTokens failure scenario → unavailable, not provider_count of 0', () => {
        // This is the bug that produced the cascade: aiClient catches the
        // throw and sets method='unavailable', tokens=0. Without this
        // converter, downstream surfaces would see tokens=0 and treat it
        // as "actually zero" rather than failure.
        const result = tokenEstimateFromMethod('unavailable', 0);
        expect(result.source).toBe('unavailable');
        // The type system prevents `result.tokens` from being accessed in
        // the unavailable case — that's exactly what we want.
    });
});
