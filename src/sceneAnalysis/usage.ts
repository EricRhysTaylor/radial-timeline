import type { AIRunResult } from '../ai/types';
import { buildUsageCostBreakdown, extractTokenUsage, formatCacheStatusLine } from '../ai/log';
import { t } from '../i18n';

export type PulseUsageReport = {
    provider: string | null;
    model: string | null;
    costUSD: number | null;
    /** AIClient exposes the final response, not usage for earlier retries/passes. */
    partial: boolean;
    cache: 'hit' | 'created' | 'none' | 'unavailable' | 'local';
    cacheDetail: string;
};

export function buildPulseUsageReport(result: AIRunResult | null): PulseUsageReport {
    const provider = result ? result.provider : null;
    const model = result ? result.modelResolved || result.modelRequested : null;
    if (result?.servedFromCache) {
        return {
            provider, model, costUSD: 0, partial: false, cache: 'local',
            cacheDetail: t('sceneAnalysis.processingModal.usage.localCache')
        };
    }
    const usage = result ? extractTokenUsage(provider, result.responseData) : null;
    const provenance = result?.advancedContext?.cacheStatus;
    const cost = usage?.inputTokens !== undefined && usage.outputTokens !== undefined
        ? buildUsageCostBreakdown(provider, model, usage, provenance)?.totalCostUSD
        : undefined;
    const costUSD = typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
    const hasCacheCounters = usage && [usage.cacheReadInputTokens, usage.cacheCreationInputTokens,
        usage.cacheCreation5mInputTokens, usage.cacheCreation1hInputTokens].some(value => value !== undefined);
    let cache: PulseUsageReport['cache'] = 'unavailable';
    if (provenance === 'created') cache = 'created';
    else if (provenance === 'hit' || (usage?.cacheReadInputTokens !== undefined && usage.cacheReadInputTokens > 0)) cache = 'hit';
    else if (usage && [usage.cacheCreationInputTokens, usage.cacheCreation5mInputTokens,
        usage.cacheCreation1hInputTokens].some(value => value !== undefined && value > 0)) cache = 'created';
    else if (hasCacheCounters) cache = 'none';
    const cacheDetail = provenance
        ? t(`sceneAnalysis.processingModal.usage.cache${provenance === 'hit' ? 'Hit' : 'Created'}`)
        : cache === 'unavailable'
            ? t('sceneAnalysis.processingModal.usage.unavailable')
            : formatCacheStatusLine(usage);
    return {
        provider, model, costUSD,
        partial: costUSD === null || (result?.retryCount !== undefined && result.retryCount > 0)
            || (result?.advancedContext?.executionPassCount !== undefined && result.advancedContext.executionPassCount > 1),
        cache, cacheDetail
    };
}

/** Each entry is one invocation, not one scene ID: repeated calls can incur new charges. */
export function summarizePulseUsage(reports: readonly PulseUsageReport[]) {
    const priced = reports.filter(report => report.costUSD !== null);
    return {
        costUSD: priced.length ? priced.reduce((sum, report) => sum + report.costUSD!, 0) : null,
        partial: reports.some(report => report.partial),
        count: reports.length,
        hits: reports.filter(report => report.cache === 'hit').length,
        created: reports.filter(report => report.cache === 'created').length,
        none: reports.filter(report => report.cache === 'none').length,
        unavailable: reports.filter(report => report.cache === 'unavailable').length,
        local: reports.filter(report => report.cache === 'local').length
    };
}
