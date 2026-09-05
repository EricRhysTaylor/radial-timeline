/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Pure typed model + view-model builder for the AI Settings "What gets sent
 * to the AI" transparency panel.
 *
 * Doctrine note (no silent fallbacks):
 *   - 0 must NOT mean "unknown". Every token field carries an explicit
 *     `source` so 0 means "actually zero" and any unavailable provider count
 *     is represented as `{ source: 'unavailable' }` — never as 0.
 *   - When the provider count fails but the deterministic local chars/4
 *     estimate exists, the panel may show that with the explicit
 *     `local_estimate` provenance and the caller renders a "Provider count
 *     unavailable." disclosure.
 *   - When nothing trustworthy exists, the panel renders an honest
 *     `unavailable` state with no token unit and no fabricated passes/cost.
 */

import type { AIProviderId } from '../../ai/types';
import {
    type TokenEstimate,
    TOKEN_ESTIMATE_DISCLOSURE,
    pickBestTokenEstimate,
    formatTokenShorthand
} from '../../ai/estimates';

// ── Types ───────────────────────────────────────────────────────────

/**
 * The panel view-model consumes the canonical `TokenEstimate` contract
 * from `src/ai/estimates/`. `PanelTokenEstimate` is kept as a re-export
 * alias for back-compat with existing call sites; new code should use
 * `TokenEstimate` directly.
 */
export type PanelTokenEstimate = TokenEstimate;

export interface PanelRowItem {
    label: string;
    /** Token count with provenance. When the source is `unavailable`, the row hides the token figure. */
    estimate: PanelTokenEstimate;
    /** Optional left-side count, e.g. `Scenes (56)` — when present, rendered before the dash. */
    leadCount?: number;
}

export interface PanelSection {
    title: string;
    items: PanelSectionItem[];
}

/** A section item is either a structured token row or a plain text line (no token). */
export type PanelSectionItem =
    | { kind: 'token_row'; row: PanelRowItem }
    | { kind: 'plain_text'; text: string }
    | { kind: 'total_row'; estimate: PanelTokenEstimate };

export interface PanelHeader {
    /** Headline token figure — always carries provenance. */
    headline: PanelTokenEstimate;
    /** Pass-count line — discloses source or renders unavailable. */
    expectedPasses: ExpectedPassesLabel;
    /** Provider input subhead — renders honestly. */
    providerInputSummary: ProviderInputSummary;
    /** Optional one-line disclosure under the headline when source is not provider_count. */
    headlineDisclosure: string | null;
}

export type ExpectedPassesLabel =
    | { kind: 'known'; passes: number; source: PanelTokenEstimate['source'] }
    | { kind: 'unavailable' };

export type ProviderInputSummary =
    | { kind: 'known'; tokens: number; source: PanelTokenEstimate['source'] }
    | { kind: 'unavailable' };

export interface PanelViewModel {
    header: PanelHeader;
    sections: PanelSection[];
}

// ── Builder inputs ──────────────────────────────────────────────────

export interface CorpusBreakdownInput {
    scenesTokens: number;
    outlineTokens: number;
    referenceTokens: number;
}

export interface PromptBreakdownInput {
    requestTokens: number;
    roleTemplateTokens: number;
    instructionTokens: number;
    outputContractTokens: number;
    transformTokens: number;
}

/**
 * Either the feature is fully available (counts + breakdown known) or it is
 * a known-pending state (e.g. Inquiry corpus context not yet loaded). The
 * latter renders an explicit pending header instead of a make-believe zero.
 */
export type FeatureForecastInput =
    | {
          kind: 'available';
          /**
           * Provider-count outcome for the executed estimate, including
           * its source. `unavailable` here means the provider count call
           * failed or was not attempted.
           */
          providerCount: PanelTokenEstimate;
          corpusBreakdown: CorpusBreakdownInput;
          promptBreakdown: PromptBreakdownInput;
          sceneCount: number;
          outlineCount: number;
          referenceCount: number;
          /**
           * Safe input budget (effectiveInputCeiling) for expected-passes
           * arithmetic. When > 0 we can compute passes from any positive
           * estimate; when 0/undefined we cannot.
           */
          safeInputBudget?: number;
          /**
           * Expected pass count from the runner's chunk planner, when the
           * provider count succeeded. Carries through `provider_count`
           * provenance when present.
           */
          providerKnownPassCount?: number;
      }
    | { kind: 'pending'; reason: string };

export type FeatureKind = 'inquiry' | 'gossamer';

export interface BuildPanelInput {
    feature: FeatureKind;
    provider?: AIProviderId;
    modelId?: string;
    forecast: FeatureForecastInput;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Sum positive tokens across rows; result is always non-negative. */
export function sumLocalEstimateTokens(...parts: number[]): number {
    return parts.reduce((sum, part) => sum + (part > 0 && Number.isFinite(part) ? part : 0), 0);
}

function makeRow(label: string, tokens: number, source: 'provider_count' | 'local_estimate', leadCount?: number): PanelRowItem {
    if (tokens > 0 && Number.isFinite(tokens)) {
        return { label, estimate: { source, tokens }, leadCount };
    }
    return { label, estimate: { source: 'unavailable' }, leadCount };
}

// ── Section builders ────────────────────────────────────────────────

function buildCorpusSection(
    input: Extract<FeatureForecastInput, { kind: 'available' }>,
    feature: FeatureKind
): PanelSection {
    const { corpusBreakdown, sceneCount, outlineCount, referenceCount } = input;
    const items: PanelSectionItem[] = [
        {
            kind: 'token_row',
            row: makeRow(
                `Scenes (${sceneCount}) — full text`,
                corpusBreakdown.scenesTokens,
                'local_estimate'
            )
        }
    ];
    // Outline / References use the same wording on both panels. When the
    // count is 0 we render a single "none" line (no token figure).
    items.push(
        outlineCount > 0
            ? {
                  kind: 'token_row',
                  row: makeRow(
                      `Outline (${outlineCount}) — full text`,
                      corpusBreakdown.outlineTokens,
                      'local_estimate'
                  )
              }
            : { kind: 'plain_text', text: 'Outline — none' }
    );
    items.push(
        referenceCount > 0
            ? {
                  kind: 'token_row',
                  row: makeRow(
                      `References (${referenceCount}) — included`,
                      corpusBreakdown.referenceTokens,
                      'local_estimate'
                  )
              }
            : { kind: 'plain_text', text: 'References — none' }
    );
    // Gossamer doesn't compute outline/reference participation, but render
    // the "none" lines consistently so the two panels match. (Caller can
    // ensure counts are 0 for Gossamer.)
    void feature;
    return { title: 'Corpus', items };
}

function buildPromptSection(
    input: Extract<FeatureForecastInput, { kind: 'available' }>,
    feature: FeatureKind
): PanelSection {
    const { promptBreakdown } = input;
    if (feature === 'gossamer') {
        return {
            title: 'Prompt',
            items: [
                { kind: 'token_row', row: makeRow('Beat scoring request', promptBreakdown.requestTokens, 'local_estimate') },
                { kind: 'token_row', row: makeRow('AI role template (author-defined)', promptBreakdown.roleTemplateTokens, 'local_estimate') },
                { kind: 'token_row', row: makeRow('Beat scoring instructions', promptBreakdown.instructionTokens, 'local_estimate') }
            ]
        };
    }
    return {
        title: 'Prompt',
        items: [
            { kind: 'token_row', row: makeRow('Zone question', promptBreakdown.requestTokens, 'local_estimate') },
            { kind: 'token_row', row: makeRow('AI role template (author-defined)', promptBreakdown.roleTemplateTokens, 'local_estimate') },
            { kind: 'token_row', row: makeRow('Editorial analysis instructions', promptBreakdown.instructionTokens, 'local_estimate') }
        ]
    };
}

function buildTransformSection(
    input: Extract<FeatureForecastInput, { kind: 'available' }>
): PanelSection | null {
    const tokens = input.promptBreakdown.transformTokens;
    if (tokens <= 0) return null;
    return {
        title: 'Transform',
        items: [{ kind: 'token_row', row: makeRow('Beat overlay (ordered sequence)', tokens, 'local_estimate') }]
    };
}

function buildOutputSection(
    input: Extract<FeatureForecastInput, { kind: 'available' }>,
    feature: FeatureKind
): PanelSection {
    const { promptBreakdown } = input;
    const finalLabel = feature === 'gossamer' ? 'Per-beat scores' : 'Scene-linked findings';
    return {
        title: 'Output',
        items: [
            { kind: 'plain_text', text: finalLabel },
            { kind: 'token_row', row: makeRow('Strict JSON structure', promptBreakdown.outputContractTokens, 'local_estimate') }
        ]
    };
}

/**
 * Build the Processing section: execution-passes line, optional overhead
 * row, and the Total row.
 *
 * Invariants (not "Total === headline" as a literal eternal constraint):
 *   1. The Total row carries the same `source` as the headline — header and
 *      footer never disagree on provenance.
 *   2. When the headline is known, the headline tokens are at least the
 *      visible local sum. The non-negative difference, if any, surfaces as
 *      the Provider overhead row in the same source.
 *   3. When the headline is `unavailable`, the Total row formats as
 *      "Total · unavailable" — never as `~0k`.
 *
 * This does NOT preclude a future "Visible parts" row alongside Total once
 * provider-measured wrappers/overhead become genuinely available per
 * provider. At that point the view-model can grow a `visibleSumEstimate`
 * field and render both rows; the overhead row already represents the
 * delta when it is known, so the structure is forward-compatible.
 */
function buildProcessingSection(
    input: Extract<FeatureForecastInput, { kind: 'available' }>,
    headline: PanelTokenEstimate,
    visibleSum: number
): PanelSection {
    const passes = computePassesFromHeadline(headline, input.safeInputBudget, input.providerKnownPassCount);
    const passesText = passes.kind === 'known'
        ? `Execution: ${passes.passes} ${passes.passes === 1 ? 'pass' : 'passes'}`
        : 'Execution: unavailable';
    const items: PanelSectionItem[] = [{ kind: 'plain_text', text: passesText }];
    // Overhead row only when the headline is known AND the headline exceeds
    // the visible local sum (i.e. provider wrappers/overhead are genuinely
    // measurable on this run). No em-dash placeholders.
    if (headline.source !== 'unavailable' && headline.source !== 'pending') {
        const overhead = headline.tokens - visibleSum;
        if (overhead > 0 && Number.isFinite(overhead)) {
            items.push({
                kind: 'token_row',
                row: { label: 'Provider overhead', estimate: { source: headline.source, tokens: overhead } }
            });
        }
    }
    items.push({ kind: 'total_row', estimate: headline });
    return { title: 'Processing', items };
}

function computePassesFromHeadline(
    headline: PanelTokenEstimate,
    safeInputBudget: number | undefined,
    providerKnownPassCount: number | undefined
): ExpectedPassesLabel {
    if (typeof providerKnownPassCount === 'number' && providerKnownPassCount > 0) {
        return { kind: 'known', passes: providerKnownPassCount, source: 'provider_count' };
    }
    if (headline.source === 'unavailable' || headline.source === 'pending') return { kind: 'unavailable' };
    if (!safeInputBudget || safeInputBudget <= 0) return { kind: 'unavailable' };
    if (headline.tokens <= 0) return { kind: 'unavailable' };
    const passes = headline.tokens <= safeInputBudget
        ? 1
        : Math.max(2, Math.ceil(headline.tokens / safeInputBudget));
    return { kind: 'known', passes, source: headline.source };
}

// ── Top-level builder ───────────────────────────────────────────────

export function buildPanelViewModel(input: BuildPanelInput): PanelViewModel {
    if (input.forecast.kind === 'pending') {
        return {
            header: {
                headline: { source: 'unavailable' },
                expectedPasses: { kind: 'unavailable' },
                providerInputSummary: { kind: 'unavailable' },
                headlineDisclosure: input.forecast.reason
            },
            sections: []
        };
    }
    const fc = input.forecast;
    const localTotal = sumLocalEstimateTokens(
        fc.corpusBreakdown.scenesTokens,
        fc.corpusBreakdown.outlineTokens,
        fc.corpusBreakdown.referenceTokens,
        fc.promptBreakdown.requestTokens,
        fc.promptBreakdown.roleTemplateTokens,
        fc.promptBreakdown.instructionTokens,
        fc.promptBreakdown.outputContractTokens,
        fc.promptBreakdown.transformTokens
    );
    const localEstimate: PanelTokenEstimate = localTotal > 0
        ? { source: 'local_estimate', tokens: localTotal }
        : { source: 'unavailable' };
    const headline = pickBestTokenEstimate(fc.providerCount, localEstimate);

    const sections: PanelSection[] = [];
    sections.push(buildCorpusSection(fc, input.feature));
    const transform = buildTransformSection(fc);
    if (transform) sections.push(transform);
    sections.push(buildPromptSection(fc, input.feature));
    sections.push(buildOutputSection(fc, input.feature));
    sections.push(buildProcessingSection(fc, headline, localTotal));

    const expectedPasses = computePassesFromHeadline(headline, fc.safeInputBudget, fc.providerKnownPassCount);
    const providerInputSummary: ProviderInputSummary = (headline.source === 'unavailable' || headline.source === 'pending')
        ? { kind: 'unavailable' }
        : { kind: 'known', tokens: headline.tokens, source: headline.source };

    return {
        header: {
            headline,
            expectedPasses,
            providerInputSummary,
            headlineDisclosure: TOKEN_ESTIMATE_DISCLOSURE[headline.source]
        },
        sections
    };
}

// ── Render helpers (string-level, still pure) ───────────────────────

export function formatExpectedPassesLabel(label: ExpectedPassesLabel): string {
    if (label.kind === 'unavailable') return 'Expected structured passes · unavailable';
    if (label.source === 'provider_count') {
        return `Expected structured passes · ${label.passes}`;
    }
    return `Expected structured passes · ${label.passes} (local estimate)`;
}

export function formatProviderInputSummary(summary: ProviderInputSummary): string {
    if (summary.kind === 'unavailable') return 'Estimated provider input · unavailable';
    const tokens = formatTokenShorthand({ source: summary.source, tokens: summary.tokens });
    if (summary.source === 'provider_count') {
        return `Estimated provider input · ${tokens}`;
    }
    return `Estimated provider input · ${tokens} (local estimate)`;
}

/**
 * Render a token row's display line — `Label (~Nk)` when known, just
 * `Label` when unavailable (no em-dash padding).
 */
export function formatTokenRowText(row: PanelRowItem): string {
    if (row.estimate.source === 'unavailable') {
        return row.label;
    }
    const shorthand = formatTokenShorthand(row.estimate);
    return `${row.label} (${shorthand})`;
}

export function formatTotalRowText(estimate: PanelTokenEstimate): string {
    if (estimate.source === 'unavailable') return 'Total · unavailable';
    return `Total ${formatTokenShorthand(estimate)}`;
}
