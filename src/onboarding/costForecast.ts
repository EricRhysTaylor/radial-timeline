/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Onboarding cost forecast — what a cloud onboarding run will cost, before it runs.
 *
 * Single-source discipline (read before editing):
 *
 *   - RATES come from `src/ai/cost/providerPricing.ts`. Never inline a price.
 *   - COST ARITHMETIC comes from `estimateCorpusCost`. Never multiply
 *     tokens by a rate here.
 *   - CHARS → TOKENS comes from `estimateTokensFromChars`. Never divide by 4
 *     here.
 *
 * What IS onboarding-specific, and therefore lives here, is the *shape of the
 * work*: how many calls a run makes and what each one carries. No existing
 * estimator knows that shape, because onboarding is unlike every other AI
 * surface in the plugin:
 *
 *   Inquiry and Gossamer send ONE corpus repeatedly — so their cost is
 *   (corpus + output) x passes, and a cache-reuse ratio is meaningful because
 *   the same bytes recur.
 *
 *   Onboarding sends the manuscript ONCE PER STAGE, split across many calls
 *   that each carry DIFFERENT text. Scene 12's call shares nothing with scene
 *   13's.
 *
 * That difference is why `expectedPasses` must be 1 and `cacheReuseRatio` must
 * be an explicit 0. Passing the scene count as `passes` would bill the whole
 * manuscript once per scene (~95x too high). Leaving the ratio to default
 * would apply 0.75 — pricing three quarters of the input at the cache-read
 * rate and understating the bill roughly 3x. Both are wrong in ways an author
 * only discovers on an invoice, so the values are pinned and explained rather
 * than inherited.
 *
 * Where the estimate is deliberately conservative, it errs HIGH. A spend
 * forecast that undershoots is worse than useless.
 */

import { estimateTokensFromChars } from '../ai/estimates';
import { estimateCorpusCost } from '../ai/cost/estimateCorpusCost';
import type { CorpusCostEstimate } from '../ai/cost/estimateCorpusCost';
import type { AIProviderId } from '../ai/types';

/** Which stage of the run a token figure belongs to. */
export type OnboardingStageKey = 'splitting' | 'extraction' | 'survey' | 'entities';

export interface OnboardingStageTokens {
    inputTokens: number;
    outputTokens: number;
}

export interface OnboardingWorkVolume {
    /** Total characters of manuscript prose the run will read. */
    manuscriptChars: number;
    /** Chapters the splitter will consider. */
    chapterCount: number;
    /** Scenes the extractor will describe. */
    sceneCount: number;
    /**
     * Length of the canonical instruction block, measured at call time rather
     * than assumed — the prompt is remote-syncable, so a constant here would
     * silently drift out of date.
     */
    promptChars: number;
    /** Entities that will get profile notes (0 when both profile boxes are off). */
    entityCount: number;
    /** Whether the slow per-entity grounded summary pass will run. */
    generateSummaries: boolean;
}

export interface OnboardingTokenForecast {
    stages: Record<OnboardingStageKey, OnboardingStageTokens>;
    inputTokens: number;
    outputTokens: number;
}

/**
 * Output sizes are bounded by the JSON contracts each step returns, so they
 * are estimated per unit of work rather than as a fraction of input.
 */
const OUTPUT_TOKENS_PER_CHAPTER_SPLIT = 400;
const OUTPUT_TOKENS_PER_SCENE = 350;
const OUTPUT_TOKENS_PER_ENTITY = 250;
const SURVEY_OUTPUT_TOKENS = 2_000;

/**
 * The subplot survey reads a sample, not the book. Held as a flat ceiling
 * because the sampler's exact draw is not knowable before the run.
 */
const SURVEY_SAMPLE_CHARS = 160_000;

/**
 * Grounding text fed to one entity-summary call. `ENTITY_GROUNDING_CHAR_BUDGET`
 * in OnboardingService caps this at 12k chars; most entities carry far less,
 * so half the cap is the honest central figure for a forecast.
 */
const ENTITY_GROUNDING_CHARS = 6_000;

export function forecastOnboardingTokens(volume: OnboardingWorkVolume): OnboardingTokenForecast {
    const manuscriptTokens = estimateTokensFromChars(Math.max(0, volume.manuscriptChars));
    const promptTokens = estimateTokensFromChars(Math.max(0, volume.promptChars));
    const chapters = Math.max(0, Math.floor(volume.chapterCount));
    const scenes = Math.max(0, Math.floor(volume.sceneCount));
    const entities = Math.max(0, Math.floor(volume.entityCount));

    // Splitting reads every chapter once; the instruction block rides along on
    // each call.
    const splitting: OnboardingStageTokens = {
        inputTokens: manuscriptTokens + promptTokens * chapters,
        outputTokens: OUTPUT_TOKENS_PER_CHAPTER_SPLIT * chapters
    };

    // Extraction reads every scene once — the same prose again, now divided
    // differently, so the manuscript is counted a second time on purpose.
    const extraction: OnboardingStageTokens = {
        inputTokens: manuscriptTokens + promptTokens * scenes,
        outputTokens: OUTPUT_TOKENS_PER_SCENE * scenes
    };

    // Nothing to survey means no survey call — and therefore no output tokens.
    // A flat output constant emitted for absent work is a fabricated cost, the
    // exact failure the estimate doctrine forbids ("0 must mean actually zero").
    const surveyRuns = manuscriptTokens > 0;
    const survey: OnboardingStageTokens = surveyRuns
        ? {
            inputTokens: estimateTokensFromChars(Math.min(volume.manuscriptChars, SURVEY_SAMPLE_CHARS)) + promptTokens,
            outputTokens: SURVEY_OUTPUT_TOKENS
        }
        : { inputTokens: 0, outputTokens: 0 };

    // Profiles without summaries need no model at all — the notes are written
    // from data already extracted, so this stage is genuinely free.
    const entityCalls = volume.generateSummaries ? entities : 0;
    const entities_: OnboardingStageTokens = {
        inputTokens: entityCalls * (estimateTokensFromChars(ENTITY_GROUNDING_CHARS) + promptTokens),
        outputTokens: entityCalls * OUTPUT_TOKENS_PER_ENTITY
    };

    const stages: Record<OnboardingStageKey, OnboardingStageTokens> = {
        splitting,
        extraction,
        survey,
        entities: entities_
    };

    return {
        stages,
        inputTokens: splitting.inputTokens + extraction.inputTokens + survey.inputTokens + entities_.inputTokens,
        outputTokens: splitting.outputTokens + extraction.outputTokens + survey.outputTokens + entities_.outputTokens
    };
}

/**
 * Cost for a forecast, delegated whole to the shared estimator.
 *
 * `expectedPasses: 1` and `cacheReuseRatio: 0` are the load-bearing arguments
 * — see the module header for why neither may be left to default.
 */
export function forecastOnboardingCost(
    provider: AIProviderId,
    modelId: string,
    forecast: OnboardingTokenForecast
): CorpusCostEstimate {
    return estimateCorpusCost(
        provider,
        modelId,
        forecast.inputTokens,
        forecast.outputTokens,
        1,
        { cacheReuseRatio: 0 }
    );
}
