import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forecastOnboardingTokens, forecastOnboardingCost } from './costForecast';

// The Odyssey run this forecast was calibrated against: 699,512 chars of
// stripped prose, 24 chapters, 95 scenes, 118 characters + 140 places.
const ODYSSEY = {
    manuscriptChars: 699_512,
    chapterCount: 24,
    sceneCount: 95,
    promptChars: 6_000,
    entityCount: 258,
    generateSummaries: true
};

describe('forecastOnboardingTokens', () => {
    it('counts the manuscript once for splitting and once for extraction', () => {
        const f = forecastOnboardingTokens({ ...ODYSSEY, entityCount: 0, generateSummaries: false });
        // Both stages read all the prose; neither is a multiple of the other.
        expect(f.stages.splitting.inputTokens).toBeGreaterThan(0);
        expect(f.stages.extraction.inputTokens).toBeGreaterThan(f.stages.splitting.inputTokens);
        // Extraction carries more prompt overhead only because it makes more
        // calls (95 scenes vs 24 chapters) — not because it re-reads prose.
        const manuscriptOnly = f.stages.extraction.inputTokens - f.stages.splitting.inputTokens;
        expect(manuscriptOnly).toBe(Math.ceil(ODYSSEY.promptChars / 4) * (95 - 24));
    });

    it('charges nothing for profiles when summaries are off — those notes need no model', () => {
        const withSummaries = forecastOnboardingTokens(ODYSSEY);
        const without = forecastOnboardingTokens({ ...ODYSSEY, generateSummaries: false });
        expect(without.stages.entities.inputTokens).toBe(0);
        expect(without.stages.entities.outputTokens).toBe(0);
        expect(withSummaries.stages.entities.inputTokens).toBeGreaterThan(0);
    });

    it('scales the entity stage with entity count', () => {
        const all = forecastOnboardingTokens(ODYSSEY);
        const pruned = forecastOnboardingTokens({ ...ODYSSEY, entityCount: 73 });
        expect(pruned.stages.entities.inputTokens).toBeLessThan(all.stages.entities.inputTokens);
    });

    it('caps the subplot survey — it samples, it does not read the book', () => {
        const small = forecastOnboardingTokens({ ...ODYSSEY, manuscriptChars: 20_000 });
        const large = forecastOnboardingTokens({ ...ODYSSEY, manuscriptChars: 2_000_000 });
        // A 100x longer book does not make the survey 100x more expensive.
        expect(large.stages.survey.inputTokens).toBeLessThan(small.stages.survey.inputTokens * 20);
    });

    it('handles an empty manuscript without producing negative or NaN tokens', () => {
        const f = forecastOnboardingTokens({
            manuscriptChars: 0, chapterCount: 0, sceneCount: 0,
            promptChars: 0, entityCount: 0, generateSummaries: false
        });
        expect(f.inputTokens).toBe(0);
        expect(f.outputTokens).toBe(0);
    });
});

describe('forecastOnboardingCost — single-source discipline', () => {
    it('produces a real, bounded figure for a whole book on the economy model', () => {
        const f = forecastOnboardingTokens(ODYSSEY);
        const cost = forecastOnboardingCost('anthropic', 'claude-haiku-4-5', f);
        // Calibration guard, not a golden value: a 133k-word book on Haiku is
        // a couple of dollars. If this ever reads like a research bill, the
        // pass/reuse arguments have regressed.
        expect(cost.freshCostUSD).toBeGreaterThan(0.5);
        expect(cost.freshCostUSD).toBeLessThan(6);
    });

    it('prices the depth model above the economy model for identical work', () => {
        const f = forecastOnboardingTokens(ODYSSEY);
        const haiku = forecastOnboardingCost('anthropic', 'claude-haiku-4-5', f);
        const opus = forecastOnboardingCost('anthropic', 'claude-opus-5', f);
        expect(opus.freshCostUSD).toBeGreaterThan(haiku.freshCostUSD * 3);
    });

    it('assumes NO cache reuse — onboarding calls never share input', () => {
        const f = forecastOnboardingTokens(ODYSSEY);
        const cost = forecastOnboardingCost('anthropic', 'claude-opus-5', f);
        expect(cost.cacheReuseRatio).toBe(0);
        expect(cost.expectedPasses).toBe(1);
        // With no reuse there is no cache saving to claim, so the "cached"
        // scenario must not undercut the fresh one. This is the guard against
        // silently inheriting the 0.75 default, which would understate the
        // bill roughly threefold.
        expect(cost.cachedCostUSD).toBeCloseTo(cost.freshCostUSD, 6);
    });

    it('does not compute cost or convert chars itself — both are delegated', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/onboarding/costForecast.ts'), 'utf8');
        const body = source.slice(source.indexOf('export function forecastOnboardingTokens'));
        expect(body).not.toMatch(/\/\s*4\b/);          // no local chars→tokens
        expect(body).not.toMatch(/1_000_000|1e6/);      // no local per-million math
        expect(body).not.toMatch(/inputPer1M|outputPer1M/);
        expect(source).toContain("from '../ai/cost/estimateCorpusCost'");
        expect(source).toContain("from '../ai/estimates'");
    });
});
