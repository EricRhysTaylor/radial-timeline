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
    promptChars: { split: 3_000, scene: 4_000, survey: 2_500, entity: 2_000 },
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
        // Splitting and extraction carry DIFFERENT instruction blocks, so the
        // gap is not one prompt times a scene delta — assert the composition
        // directly instead.
        const perStage = ODYSSEY.promptChars;
        expect(f.stages.splitting.inputTokens - f.stages.extraction.inputTokens).toBe(
            Math.ceil(perStage.split / 4) * 24 - Math.ceil(perStage.scene / 4) * 95
        );
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

    it('prices the survey at what it actually samples: 30 openings x 40 words', () => {
        const large = forecastOnboardingTokens({ ...ODYSSEY, manuscriptChars: 2_000_000 });
        // Runtime does sampleEvenly(scenes, 30) + openingWords(text, 40).
        // That is ~6.6k chars (~1.7k tokens) plus the survey instructions —
        // NOT a fraction of the manuscript. A regression here would restore
        // the 160k-char ceiling that overstated this stage twenty-fold.
        const promptTokens = Math.ceil(ODYSSEY.promptChars.survey / 4);
        expect(large.stages.survey.inputTokens - promptTokens).toBeLessThan(2_500);
        // And it must not scale with book length at all.
        const small = forecastOnboardingTokens({ ...ODYSSEY, manuscriptChars: 500_000 });
        expect(large.stages.survey.inputTokens).toBe(small.stages.survey.inputTokens);
    });

    it('handles an empty manuscript without producing negative or NaN tokens', () => {
        const f = forecastOnboardingTokens({
            manuscriptChars: 0, chapterCount: 0, sceneCount: 0,
            promptChars: { split: 0, scene: 0, survey: 0, entity: 0 },
            entityCount: 0, generateSummaries: false
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

    it('assumes NO cache reuse — onboarding sends no cache breakpoint', () => {
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
