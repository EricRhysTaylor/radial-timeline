/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Canonical AI estimate contracts — shared across every AI-facing UI
 * surface. See doctrine in `./tokenEstimate.ts` and `./costEstimate.ts`.
 */

export {
    type TokenEstimate,
    TOKEN_ESTIMATE_SOURCE_LABEL,
    TOKEN_ESTIMATE_DISCLOSURE,
    pickBestTokenEstimate,
    tokenEstimateFromMethod,
    formatTokenShorthand,
    formatTokenHeadline,
    estimateTokensFromChars
} from './tokenEstimate';

export {
    type CostEstimate,
    COST_ESTIMATE_DISCLOSURE,
    formatShortUsd,
    formatCostHeadline,
    describeCostSource
} from './costEstimate';
