import { describe, it, expect } from 'vitest';
import { formatShortUsd, formatCostHeadline, describeCostSource } from './costEstimate';

describe('formatShortUsd', () => {
    it('null/undefined/negative → em-dash (never $0.00)', () => {
        expect(formatShortUsd(null)).toBe('—');
        expect(formatShortUsd(undefined)).toBe('—');
        expect(formatShortUsd(-1)).toBe('—');
    });

    it('exactly 0 → $0.00 (a real observation)', () => {
        expect(formatShortUsd(0)).toBe('$0.00');
    });

    it('REGRESSION: tiny non-zero costs render as <$0.01, not $0.00', () => {
        // The Gemini bug: when countTokens failed, cost computed against 0
        // tokens produced ~$0.0001 which rendered as $0.01 via the legacy
        // floor — looked authoritative but was fake. We do NOT round these
        // up; either we have a real number we can show (<$0.01) or we
        // refuse upstream and never reach this formatter.
        expect(formatShortUsd(0.0001)).toBe('<$0.01');
        expect(formatShortUsd(0.005)).toBe('<$0.01');
    });

    it('always two decimals for values ≥ $0.01 (matches existing formatUsdCost convention)', () => {
        expect(formatShortUsd(0.85)).toBe('$0.85');
        expect(formatShortUsd(0.30)).toBe('$0.30');
        expect(formatShortUsd(1.24)).toBe('$1.24');
        expect(formatShortUsd(12.4)).toBe('$12.40');
    });
});

describe('formatCostHeadline', () => {
    it('unavailable → "Unavailable" (no fake $0.00)', () => {
        expect(formatCostHeadline({ source: 'unavailable' }, 'fresh')).toBe('Unavailable');
        expect(formatCostHeadline({ source: 'unavailable', reason: 'token_count_failed' }, 'cached'))
            .toBe('Unavailable');
    });

    it('pending → "Estimating…"', () => {
        expect(formatCostHeadline({ source: 'pending' }, 'fresh')).toBe('Estimating…');
    });

    it('prior_run → exact cost regardless of variant', () => {
        const est = { source: 'prior_run' as const, actualCostUSD: 1.24 };
        expect(formatCostHeadline(est, 'fresh')).toBe('$1.24');
        expect(formatCostHeadline(est, 'cached')).toBe('$1.24');
    });

    it('pricing_estimate fresh + cached', () => {
        const est = {
            source: 'pricing_estimate' as const,
            freshCostUSD: 0.85,
            cachedCostUSD: 0.30,
            inputEstimateSource: 'provider_count' as const
        };
        expect(formatCostHeadline(est, 'fresh')).toBe('$0.85');
        expect(formatCostHeadline(est, 'cached')).toBe('$0.30');
    });

    it('pricing_estimate without cached cost → "No active cache" for cached variant', () => {
        const est = {
            source: 'pricing_estimate' as const,
            freshCostUSD: 0.85,
            inputEstimateSource: 'provider_count' as const
        };
        expect(formatCostHeadline(est, 'cached')).toBe('No active cache');
    });
});

describe('describeCostSource', () => {
    it('discloses input-estimate source for pricing_estimate', () => {
        expect(describeCostSource({
            source: 'pricing_estimate', freshCostUSD: 1, inputEstimateSource: 'provider_count'
        })).toBe('pricing estimate');
        expect(describeCostSource({
            source: 'pricing_estimate', freshCostUSD: 1, inputEstimateSource: 'local_estimate'
        })).toContain('local input');
    });

    it('discloses prior_run, pending, and unavailable honestly', () => {
        expect(describeCostSource({ source: 'prior_run', actualCostUSD: 1 })).toBe('from prior run');
        expect(describeCostSource({ source: 'pending' })).toBe('pending');
        expect(describeCostSource({ source: 'unavailable' })).toBe('unavailable');
    });
});
