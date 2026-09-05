/**
 * Pure field-level helpers for `buildInquiryLogContent` — lifted from
 * inline closures inside the builder so each piece is independently
 * testable and the main builder reads as orchestration.
 *
 * All helpers are byte-identical to the original inline logic:
 * preserving log wording is doctrine (Audit-2 payload-truth applies
 * to cache diagnostics; this module touches none of that).
 *
 * No DOM, no timers, no plugin/state access, no I/O.
 */
import type { InquiryResult } from '../state';
import type { CorpusManifest, InquiryRunTrace } from '../runner/types';
import type { TokenUsage } from '../../ai/usage/providerUsage';
import type { SceneInclusion } from '../../types/settings';
import type { AiLogStatus } from '../../ai/log';
import type { buildInquirySourcesViewModel } from '../services/inquirySources';

type SourcesVM = ReturnType<typeof buildInquirySourcesViewModel>;

/** Provider key → human display name; unknown providers pass through verbatim. */
export const PROVIDER_LABELS = {
    anthropic: 'Anthropic',
    google: 'Google',
    openai: 'OpenAI',
    ollama: 'Ollama'
} as const;

/**
 * Token-count formatter for log lines. `1000+` collapses to `Nk`
 * (`scaled.toFixed(0)` past 100, `scaled.toFixed(1)` below — trailing
 * `.0` stripped). Sub-1000 rounds to an integer. `approximate` prepends
 * `~`. Non-finite / non-number → `'unknown'`.
 */
export function formatLogTokenCount(value: number | null | undefined, approximate = false): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
    const prefix = approximate ? '~' : '';
    if (value >= 1000) {
        const scaled = value / 1000;
        const fixed = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
        return `${prefix}${fixed.replace(/\.0$/, '')}k`;
    }
    return `${prefix}${Math.round(value)}`;
}

/** Token-usage metric formatter — same as formatLogTokenCount but `'unavailable'` for missing. */
export function formatLogUsageMetric(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
    return formatLogTokenCount(value);
}

/**
 * Provider label for the run-summary line: `'Simulation'` for stub
 * runs, the canonical PROVIDER_LABELS entry for known providers,
 * verbatim trimmed string for unknowns, `'Unknown'` for empty.
 */
export function resolveLogProviderLabel(providerRaw: string, isSimulated: boolean): string {
    if (isSimulated) return 'Simulation';
    if (!providerRaw) return 'Unknown';
    return ['anthropic', 'google', 'openai', 'ollama'].includes(providerRaw)
        ? PROVIDER_LABELS[providerRaw as keyof typeof PROVIDER_LABELS]
        : providerRaw;
}

/**
 * Model label for the run-summary line: `'No provider call'` for
 * simulated runs; else `briefModelLabel` (when truthy) →
 * `aiModelResolved` → `aiModelRequested` → `'unknown'`.
 */
export function resolveLogModelLabel(
    result: InquiryResult,
    briefModelLabel: string | null,
    isSimulated: boolean
): string {
    if (isSimulated) return 'No provider call';
    return briefModelLabel
        || result.aiModelResolved
        || result.aiModelRequested
        || 'unknown';
}

/**
 * Status label: `'Degraded'` overrides status; else success/error/
 * simulated mapping to `'Success'` / `'Failed'` / `'Simulated'`.
 */
export function resolveLogStatusLabel(status: AiLogStatus, degraded: boolean): string {
    if (degraded) return 'Degraded';
    return status === 'success' ? 'Success' : status === 'error' ? 'Failed' : 'Simulated';
}

/**
 * Status detail suffix: `' (aiReason)'` when present; else
 * `' (aiStatus)'` when aiStatus is non-empty and not success/degraded;
 * else empty string.
 */
export function resolveLogStatusDetail(result: InquiryResult): string {
    if (result.aiReason) return ` (${result.aiReason})`;
    if (result.aiStatus && result.aiStatus !== 'success' && result.aiStatus !== 'degraded') {
        return ` (${result.aiStatus})`;
    }
    return '';
}

/**
 * Overrides label: `'On (classes: N, items: M)'` when an override
 * summary is present; `'On'` when overrides active but no summary;
 * `'None'` otherwise.
 */
export function buildLogOverrideLabel(
    overrideSummary: { classCount: number; itemCount: number } | null,
    corpusOverridesActive: boolean
): string {
    if (overrideSummary) {
        return `On (classes: ${overrideSummary.classCount}, items: ${overrideSummary.itemCount})`;
    }
    return corpusOverridesActive ? 'On' : 'None';
}

/**
 * Source-result detail: `'none surfaced'` when no content; else
 * `'<total> item[s] · <class>=<count>, ...'` ordered by descending
 * count, then class label ascending. Class labels are lowercased
 * in the joined output.
 */
export function buildLogSourceResultDetail(sourcesVM: SourcesVM): string {
    if (!sourcesVM.hasContent) return 'none surfaced';
    const counts = new Map<string, number>();
    for (const item of sourcesVM.items) {
        counts.set(item.classLabel, (counts.get(item.classLabel) ?? 0) + 1);
    }
    const ordered = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, count]) => `${label.toLowerCase()}=${count}`);
    return `${sourcesVM.totalCount} item${sourcesVM.totalCount === 1 ? '' : 's'} · ${ordered.join(', ')}`;
}

/**
 * Usage-detail parts (the `- Usage detail: raw input=..., cache read=...`
 * line). Only includes fields that are actually present on `usage` as
 * finite numbers.
 */
export function buildLogUsageDetailParts(usage: TokenUsage | null | undefined): string[] {
    if (!usage) return [];
    return [
        typeof usage.rawInputTokens === 'number' ? `raw input=${formatLogTokenCount(usage.rawInputTokens)}` : null,
        typeof usage.cacheReadInputTokens === 'number' ? `cache read=${formatLogTokenCount(usage.cacheReadInputTokens)}` : null,
        typeof usage.cacheCreationInputTokens === 'number' ? `cache write=${formatLogTokenCount(usage.cacheCreationInputTokens)}` : null
    ].filter((value): value is string => !!value);
}

/**
 * Usage text: `input=..., output=..., total=...` with each component
 * via formatLogUsageMetric; `'not available'` when usage is null.
 */
export function buildLogUsageText(usage: TokenUsage | null | undefined): string {
    if (!usage) return 'not available';
    return `input=${formatLogUsageMetric(usage.inputTokens)}, output=${formatLogUsageMetric(usage.outputTokens)}, total=${formatLogUsageMetric(usage.totalTokens)}`;
}

/**
 * Describe the corpus mode for a given class, derived from manifest
 * entries with the caller-supplied normalizer. Returns:
 * - `'Summary'` if all non-excluded entries are summary,
 * - `'Full Scene'` if all non-excluded entries are full,
 * - `'Mixed'` if both,
 * - `null` if no non-excluded entries (or no manifest).
 */
export function describeLogCorpusMode(
    manifest: CorpusManifest | null,
    className: string,
    normalizeEvidenceMode: (mode: SceneInclusion | undefined) => 'excluded' | 'summary' | 'full'
): string | null {
    if (!manifest) return null;
    const modes = new Set(
        manifest.entries
            .filter(entry => entry.class === className)
            .map(entry => normalizeEvidenceMode(entry.mode))
            .filter(mode => mode !== 'excluded')
    );
    if (modes.size === 1) {
        return modes.has('summary') ? 'Summary' : 'Full Scene';
    }
    if (modes.size > 1) {
        return 'Mixed';
    }
    return null;
}

/**
 * Resolve a human failure reason for error results — falls through:
 * trace.response.error → first trace.notes entry → result.summary →
 * `'Response exceeded maximum output tokens before completion.'`
 * (for `aiReason === 'truncated'`) → `'AI request failed (REASON).'` →
 * `'Unknown failure.'`. Returns null for non-error results.
 */
export function resolveLogFailureReason(
    result: InquiryResult,
    trace: InquiryRunTrace,
    isErrorResult: (result: InquiryResult) => boolean
): string | null {
    if (!isErrorResult(result)) return null;
    const errorMessage = trace.response?.error;
    if (errorMessage && String(errorMessage).trim().length > 0) {
        return String(errorMessage);
    }
    if (trace.notes && trace.notes.length) {
        return trace.notes[0];
    }
    if (result.summary && result.summary.trim().length > 0) {
        return result.summary;
    }
    if (result.aiReason === 'truncated') {
        return 'Response exceeded maximum output tokens before completion.';
    }
    return result.aiReason ? `AI request failed (${result.aiReason}).` : 'Unknown failure.';
}

/**
 * Suggested-fix list for error results — drives the `## Suggested
 * Fixes` block. Returns `['None.']` for non-error results. The exact
 * suggestion text and the condition ladder are preserved verbatim.
 */
export function buildLogSuggestedFixes(
    result: InquiryResult,
    trace: InquiryRunTrace,
    isErrorResult: (result: InquiryResult) => boolean,
    resolveFailureReason: () => string | null
): string[] {
    if (!isErrorResult(result)) return ['None.'];
    const suggestions: string[] = [];
    const reason = result.aiReason ?? '';
    const reasonLower = reason.toLowerCase();
    const failureReason = resolveFailureReason() ?? '';
    const failureLower = failureReason.toLowerCase();
    const isPackagingFailure = reasonLower === 'multi_pass_failed'
        || trace.failureStage === 'chunk_execution'
        || trace.failureStage === 'synthesis'
        || trace.failureStage === 'preflight';
    const isInvalidStructuredOutput = reasonLower === 'invalid_response'
        || failureLower.includes('invalid_response')
        || failureLower.includes('malformed json')
        || failureLower.includes('structured output');
    const isTruncated = reasonLower === 'truncated'
        || failureLower.includes('truncated')
        || failureLower.includes('max tokens')
        || failureLower.includes('token limit')
        || failureLower.includes('context length')
        || failureLower.includes('length exceeded');

    if (isPackagingFailure) {
        suggestions.push('Run failed during multi-pass analysis. Open Inquiry Log for exact chunk/synthesis failure details.');
        suggestions.push('Retry once with the same settings after reviewing the log.');
    } else if (isInvalidStructuredOutput) {
        suggestions.push('Run failed because Inquiry did not receive valid structured output.');
        suggestions.push('Open Inquiry Log for the exact parser failure detail, then retry once.');
    } else if (isTruncated) {
        suggestions.push('Reduce corpus scope and rerun.');
    } else if (reasonLower === 'rate_limit') {
        suggestions.push('Retry later.');
    } else if (reasonLower === 'auth') {
        suggestions.push('Verify API key and provider access.');
    } else if (reasonLower === 'timeout'
        || reasonLower === 'unavailable'
        || reasonLower === 'unsupported_param') {
        suggestions.push('Retry and review Inquiry Log for provider error details.');
    }

    if (!suggestions.length) {
        suggestions.push('Open Inquiry Log for details, then retry.');
    }
    return suggestions;
}
