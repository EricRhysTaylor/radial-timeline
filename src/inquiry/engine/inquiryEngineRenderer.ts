import { setTooltip } from '../../utils/domTooltip';
import type { InquiryAdvisoryContext } from '../services/inquiryAdvisory';
import type { InquiryEnginePopoverState, InquiryReadinessUiState, PassPlanResult } from '../types';
import type { TokenUsage } from '../../ai/usage/providerUsage';
import { formatExactUsdCost } from '../../ai/cost/estimateCorpusCost';
import { t, tCount } from '../../i18n';

export type EngineRecentRunSnapshot = {
    /** Whether the last run requested citation anchors. */
    citationsRequested: boolean;
    /** Number of citation blocks the provider returned. Zero with citations on = mismatch. */
    citationCount: number;
    /** Token usage from the provider's response, including cache breakdown. */
    tokenUsage?: TokenUsage;
    /** Usage-based provider cost once the run returns token usage. */
    actualCostUSD?: number;
    /**
     * Cache provenance from the cache manager (NOT inferred from
     * response usage). Required for Gemini, where the response payload
     * cannot distinguish create-vs-reuse. `'hit'` means a prior resource
     * was reused; `'created'` means a new resource was armed this run.
     */
    cacheStatus?: 'hit' | 'created';
};

export type EngineCacheWindowSnapshot = {
    /** Wall-clock ms when the provider cache window expires. */
    expiresAt: number;
    /** Tokens primed in the cache (so the user knows how much reuse is at stake). */
    cachedTokens?: number;
};

export function renderInquiryEngineAdvisoryCard(
    container: HTMLElement,
    advisory: InquiryAdvisoryContext
): void {
    container.empty();

    const card = container.createDiv({ cls: 'ert-inquiry-engine-advisor-card' });
    card.createDiv({ cls: 'ert-inquiry-engine-advisor-title', text: t('ui.inquiryEngineRenderer.advisorTitle') });
    card.createDiv({
        cls: 'ert-inquiry-engine-advisor-message',
        text: advisory.recommendation.message
    });
    advisory.recommendation.options.forEach(option => {
        card.createDiv({
            cls: 'ert-inquiry-engine-advisor-suggestion',
            text: `${option.providerLabel} · ${option.modelLabel}`
        });
    });
}

export function renderInquiryEngineReadinessStrip(args: {
    readinessEl?: HTMLDivElement;
    readinessStatusEl?: HTMLDivElement;
    readinessCorpusEl?: HTMLDivElement;
    readinessMessageEl?: HTMLDivElement;
    readinessActionsEl?: HTMLDivElement;
    readinessScopeEl?: HTMLDivElement;
    providerLabel: string;
    popoverState: InquiryEnginePopoverState;
    blocked: boolean;
    corpusSummary: string;
    passPlan: PassPlanResult;
    readinessCause?: InquiryReadinessUiState['readiness']['cause'];
    readinessReason: string;
    runScopeLabel: string;
    cacheTtlLabel?: string;
    /** Citations toggle state from settings — drives the static "Citations" pill. */
    citationsRequested: boolean;
    /** Whether the active provider can return inline document citations at all.
     *  When false, citationsRequested becomes "Citations unavailable" rather than
     *  the post-run "missing" warning — the limit is structural, not a failure. */
    providerSupportsCitations?: boolean;
    /** Outcome data from the most recent run; drives dynamic pill states. */
    recentRun?: EngineRecentRunSnapshot;
    /** Active provider cache window for the current corpus, if any. Drives the TTL countdown pill. */
    cacheWindow?: EngineCacheWindowSnapshot;
    /** AI off or unavailable: saved results remain accessible without run alerts. */
    readOnly?: boolean;
    /** Why new analysis requires setup or explicit AI permission. */
    readOnlyReason: string;
    /** Saved briefings present (demo vault) — tunes the read-only message. */
    hasSavedBriefings?: boolean;
    /** Wall-clock for testability. Defaults to Date.now() when omitted. */
    now?: number;
}): void {
    if (!args.readinessEl
        || !args.readinessStatusEl
        || !args.readinessCorpusEl
        || !args.readinessMessageEl
        || !args.readinessActionsEl
        || !args.readinessScopeEl) {
        return;
    }

    const stateClass = args.readOnly
        ? 'is-readonly'
        : args.popoverState === 'ready'
            ? 'is-ready'
            : args.popoverState === 'multi-pass'
                ? 'is-amber'
                : 'is-error';
    args.readinessEl.classList.remove('is-ready', 'is-amber', 'is-error', 'is-readonly');
    args.readinessEl.classList.add(stateClass);

    // Browsing has no run cost/cache status. Explain the separate opt-in/setup
    // requirement while keeping saved results available.
    if (args.readOnly) {
        args.readinessStatusEl.setText(t('ui.inquiryEngineRenderer.statusReadOnly'));
        args.readinessCorpusEl.setText(args.corpusSummary);
        args.readinessMessageEl.setText(args.hasSavedBriefings
            ? t('ui.inquiryEngineRenderer.savedBriefingsReady', { reason: args.readOnlyReason })
            : args.readOnlyReason);
        args.readinessScopeEl.setText(args.runScopeLabel);
        args.readinessActionsEl.empty();
        return;
    }

    const isLocalLlm = args.providerLabel === 'Ollama' || args.providerLabel === 'Local LLM';
    const statusText = args.blocked
        ? t('ui.inquiryEngineRenderer.statusNoEligibleModel')
        : args.popoverState === 'ready'
            ? t('ui.inquiryEngineRenderer.statusReady')
            : args.popoverState === 'multi-pass'
                ? t('ui.inquiryEngineRenderer.statusMultiPass')
                : t('ui.inquiryEngineRenderer.statusExceedsLimits');
    args.readinessStatusEl.setText(statusText);
    args.readinessCorpusEl.setText(args.corpusSummary);

    const cacheSuffix = args.cacheTtlLabel ? ` ${t('ui.inquiryEngineRenderer.providerCacheTtl', { ttl: args.cacheTtlLabel })}` : '';

    if (args.blocked && isLocalLlm) {
        args.readinessCorpusEl.setText(t('ui.inquiryEngineRenderer.localLlmConnected'));
        args.readinessMessageEl.setText(t('ui.inquiryEngineRenderer.localLlmBasicValidation'));
        args.readinessScopeEl.setText(t('ui.inquiryEngineRenderer.localLlmNotEligible'));
    } else if (args.popoverState === 'ready') {
        args.readinessMessageEl.setText(`${t('ui.inquiryEngineRenderer.executionOnePass')}${cacheSuffix}`);
        args.readinessScopeEl.setText(args.runScopeLabel);
    } else if (args.popoverState === 'multi-pass') {
        const estimateLabel = args.passPlan.estimatedPassCount ?? args.passPlan.displayPassCount;
        const recentRunSuffix = args.passPlan.recentExactPassCount
            ? ` ${t('ui.inquiryEngineRenderer.recentRunPasses', { passes: tCount('pass', args.passPlan.recentExactPassCount) })}`
            : '';
        const reason = args.passPlan.multiPassTriggerReason
            ?? t('ui.inquiryEngineRenderer.multiPassDefaultReason');
        const estimatedExecution = t('ui.inquiryEngineRenderer.estimatedExecution', {
            passes: tCount('pass', estimateLabel),
            reason: reason.replace(/\.$/, '')
        });
        args.readinessMessageEl.setText(`${estimatedExecution}${recentRunSuffix}${cacheSuffix}`);
        args.readinessScopeEl.setText(args.runScopeLabel);
    } else {
        args.readinessMessageEl.setText(args.readinessReason);
        args.readinessScopeEl.setText(args.runScopeLabel);
    }
    args.readinessActionsEl.empty();
    renderEnginePostRunPills(args.readinessActionsEl, {
        citationsRequested: args.citationsRequested,
        providerSupportsCitations: args.providerSupportsCitations,
        recentRun: args.recentRun,
        cacheWindow: args.cacheWindow,
        now: args.now ?? Date.now()
    });
}

type CachePillState = {
    label: string;
    /** CSS modifier suffix; renderer maps to `.is-{state}`. */
    state: 'none' | 'primed' | 'confirmed' | 'miss';
    tooltip: string;
};

type CitationPillState = {
    label: string;
    state: 'off' | 'on-pending' | 'on-confirmed' | 'on-missing' | 'on-unavailable';
    tooltip: string;
};

type TtlPillState = {
    label: string;
    /** 'fresh' for >2m, 'soon' for 30s..2m, 'expiring' for <30s. */
    state: 'fresh' | 'soon' | 'expiring';
    tooltip: string;
};

type ActualCostPillState = {
    label: string;
    tooltip: string;
};

/**
 * Compute the cache pill from the most recent run's token usage AND the
 * cache-manager-derived cacheStatus.
 *
 * DOCTRINE: Truth beats optimism. The two facts the pill represents are:
 *   - "Was a prior cache resource REUSED on this run?" (true hit)
 *   - "Was a new cache resource CREATED/armed on this run?" (eligible
 *     for next run, NOT reuse)
 *
 * For Anthropic, response usage alone distinguishes these:
 *   cache_creation > 0 → created; cache_read > 0 → reused.
 * For Gemini, `cachedContentTokenCount > 0` on EVERY call that supplies
 * cachedContent — including the call that created the resource. So
 * response usage alone cannot tell create from reuse. We need
 * `cacheStatus` from the cache manager (carried through
 * AIRunAdvancedContext + InquiryRunTrace).
 *
 * Rules:
 *   - No usage AND no cacheStatus → no pill (idle / no info)
 *   - cacheStatus === 'hit' → confirmed reuse, sized by usage cache_read
 *   - cacheStatus === 'created' → cache armed (not reused), neutral pill
 *   - cacheStatus undefined + payload-only signals:
 *       * cache_read > 0 → confirmed reuse (Anthropic / OpenAI;
 *         Gemini never reaches this branch because its cacheStatus is
 *         always set when cachedContent was supplied)
 *       * cache_creation > 0 → confirmed creation (Anthropic only)
 *       * otherwise → "No cache reuse" (neutral)
 *
 * Pure: no DOM access, fully testable.
 */
export function computeCachePillState(
    usage: TokenUsage | undefined,
    cacheStatus?: 'hit' | 'created'
): CachePillState | null {
    const cacheRead = usage?.cacheReadInputTokens ?? 0;
    const cacheCreation = usage?.cacheCreationInputTokens ?? 0;
    const reportedInput = usage?.inputTokens ?? 0;
    const totalInput = reportedInput >= (cacheRead + cacheCreation)
        ? reportedInput
        : reportedInput + cacheRead + cacheCreation;

    // cacheStatus is the authoritative source when present — overrides
    // payload heuristics. This is required for Gemini, where the response
    // payload cannot distinguish create-vs-reuse.
    if (cacheStatus === 'hit') {
        const reusePct = totalInput > 0 && cacheRead > 0
            ? Math.round((cacheRead / totalInput) * 100)
            : 0;
        return {
            label: cacheRead > 0
                ? t('ui.inquiryEngineRenderer.cacheReusedPct', { pct: reusePct })
                : t('ui.inquiryEngineRenderer.cacheReused'),
            state: 'confirmed',
            tooltip: cacheRead > 0
                ? t('ui.inquiryEngineRenderer.cacheReusedManagerTooltip', { tokens: cacheRead.toLocaleString(), pct: reusePct })
                : t('ui.inquiryEngineRenderer.cacheReusedManagerNoReadTooltip')
        };
    }
    if (cacheStatus === 'created') {
        return {
            label: t('ui.inquiryEngineRenderer.cacheArmed'),
            state: 'primed',
            tooltip: t('ui.inquiryEngineRenderer.cacheArmedTooltip')
        };
    }

    // No cacheStatus carried — fall back to payload-only derivation. This
    // path applies to providers that don't surface a clientCacheStatus
    // (or to runs that bypassed the cache manager). Same rules as before.
    if (!usage) return null;
    if (cacheRead > 0) {
        const reusePct = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;
        return {
            label: t('ui.inquiryEngineRenderer.cacheReusedPct', { pct: reusePct }),
            state: 'confirmed',
            tooltip: t('ui.inquiryEngineRenderer.cacheReusedPayloadTooltip', { tokens: cacheRead.toLocaleString(), pct: reusePct })
        };
    }
    if (cacheCreation > 0) {
        return {
            label: t('ui.inquiryEngineRenderer.cacheCreated'),
            state: 'primed',
            tooltip: t('ui.inquiryEngineRenderer.cacheCreatedTooltip', { tokens: cacheCreation.toLocaleString() })
        };
    }
    if (totalInput > 0) {
        return {
            label: t('ui.inquiryEngineRenderer.noCacheReuse'),
            state: 'none',
            tooltip: t('ui.inquiryEngineRenderer.noCacheReuseTooltip')
        };
    }
    return null;
}

export function computeActualCostPillState(actualCostUSD: number | undefined): ActualCostPillState | null {
    if (typeof actualCostUSD !== 'number' || !Number.isFinite(actualCostUSD) || actualCostUSD < 0) return null;
    return {
        label: t('ui.inquiryEngineRenderer.lastRunCost', { cost: formatExactUsdCost(actualCostUSD) }),
        tooltip: t('ui.inquiryEngineRenderer.lastRunCostTooltip')
    };
}

/**
 * Compute the citations pill from settings + last run outcome.
 *
 * Rules:
 *   - toggle off → "Citations off" muted (informational)
 *   - toggle on, provider can't deliver them → "Citations unavailable" muted
 *     (informational — distinguishes a provider limit from a runtime failure;
 *     the advisor card already nudges the user toward a citation-capable model)
 *   - toggle on, no run yet → "Citations on" pending
 *   - toggle on, last run had citations → "Citations · N" confirmed
 *   - toggle on, last run had ZERO citations → "Citations missing" warning
 *     (catches misconfiguration, model regressions, or wrong content type)
 */
export function computeCitationPillState(
    citationsRequested: boolean,
    recentRun: EngineRecentRunSnapshot | undefined,
    providerSupportsCitations: boolean = true
): CitationPillState {
    if (!citationsRequested) {
        return {
            label: t('ui.inquiryEngineRenderer.citationsOff'),
            state: 'off',
            tooltip: t('ui.inquiryEngineRenderer.citationsOffTooltip')
        };
    }
    if (!providerSupportsCitations) {
        return {
            label: t('ui.inquiryEngineRenderer.citationsUnavailable'),
            state: 'on-unavailable',
            tooltip: t('ui.inquiryEngineRenderer.citationsUnavailableTooltip')
        };
    }
    if (!recentRun) {
        return {
            label: t('ui.inquiryEngineRenderer.citationsOn'),
            state: 'on-pending',
            tooltip: t('ui.inquiryEngineRenderer.citationsOnTooltip')
        };
    }
    if (recentRun.citationCount > 0) {
        return {
            label: t('ui.inquiryEngineRenderer.citationsCount', { count: recentRun.citationCount }),
            state: 'on-confirmed',
            tooltip: t('ui.inquiryEngineRenderer.citationsCountTooltip', { sources: tCount('anchoredSource', recentRun.citationCount) })
        };
    }
    return {
        label: t('ui.inquiryEngineRenderer.citationsMissing'),
        state: 'on-missing',
        tooltip: t('ui.inquiryEngineRenderer.citationsMissingTooltip')
    };
}

/**
 * Compute the TTL countdown pill from an active cache window.
 *
 * Returns null when:
 *   - no active cache window exists for this corpus
 *   - the window already expired (in which case the cache pill on the next
 *     run will report "miss" — no need for a stale countdown)
 *
 * Coarse buckets (s / m / h) match the rendering cadence — the engine panel
 * re-renders on state changes, not on a per-second timer, so finer
 * granularity would just lie about precision.
 */
export function computeTtlPillState(
    cacheWindow: EngineCacheWindowSnapshot | undefined,
    now: number
): TtlPillState | null {
    if (!cacheWindow) return null;
    const remainingMs = cacheWindow.expiresAt - now;
    if (remainingMs <= 0) return null;

    const remainingSeconds = Math.floor(remainingMs / 1000);
    let duration: string;
    let state: TtlPillState['state'];

    if (remainingSeconds < 30) {
        duration = `${remainingSeconds}s`;
        state = 'expiring';
    } else if (remainingSeconds < 120) {
        duration = `${remainingSeconds}s`;
        state = 'soon';
    } else if (remainingSeconds < 3600) {
        const minutes = Math.floor(remainingSeconds / 60);
        duration = `${minutes}m`;
        state = 'fresh';
    } else {
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        duration = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
        state = 'fresh';
    }

    const label = t('ui.inquiryEngineRenderer.cacheTimeLeft', { duration });
    const tooltip = cacheWindow.cachedTokens && cacheWindow.cachedTokens > 0
        ? t('ui.inquiryEngineRenderer.ttlTooltipPrimed', { duration, tokens: cacheWindow.cachedTokens.toLocaleString() })
        : t('ui.inquiryEngineRenderer.ttlTooltip', { duration });

    return { label, state, tooltip };
}

function renderEnginePostRunPills(
    container: HTMLElement,
    args: {
        citationsRequested: boolean;
        providerSupportsCitations?: boolean;
        recentRun?: EngineRecentRunSnapshot;
        cacheWindow?: EngineCacheWindowSnapshot;
        now: number;
    }
): void {
    const pillRow = container.createDiv({ cls: 'ert-inquiry-engine-pill-row' });

    const cachePill = computeCachePillState(args.recentRun?.tokenUsage, args.recentRun?.cacheStatus);
    if (cachePill) {
        const el = pillRow.createSpan({
            cls: `ert-inquiry-engine-pill ert-inquiry-engine-pill--cache is-${cachePill.state}`,
            text: cachePill.label
        });
        setTooltip(el, cachePill.tooltip);
    }

    // DOCTRINE: the TTL countdown is only honest once the provider payload
    // has proven a cache actually exists for this engine+corpus. A cache
    // window timestamp alone (cacheWindowExpiresAt) is optimism, not proof —
    // OpenAI/Gemini runs with cached_tokens === 0 must NOT show "23h left".
    const provenUsage = args.recentRun?.tokenUsage;
    const cacheProven = !!provenUsage
        && ((provenUsage.cacheReadInputTokens ?? 0) > 0
            || (provenUsage.cacheCreationInputTokens ?? 0) > 0);
    const ttlPill = cacheProven ? computeTtlPillState(args.cacheWindow, args.now) : null;
    if (ttlPill) {
        const el = pillRow.createSpan({
            cls: `ert-inquiry-engine-pill ert-inquiry-engine-pill--ttl is-ttl-${ttlPill.state}`,
            text: ttlPill.label
        });
        setTooltip(el, ttlPill.tooltip);
    }

    const actualCostPill = computeActualCostPillState(args.recentRun?.actualCostUSD);
    if (actualCostPill) {
        const el = pillRow.createSpan({
            cls: 'ert-inquiry-engine-pill ert-inquiry-engine-pill--actual-cost is-confirmed',
            text: actualCostPill.label
        });
        setTooltip(el, actualCostPill.tooltip);
    }

    // Citation pill is hard-disabled while inline provider citations are
    // paused (see resolveCitationsEnabled in computeCaps.ts). The pill cannot
    // be derived from `citationsRequested` alone because that field reads the
    // persisted user toggle — which may still be `true` for users who had it
    // on before the pause. The runtime resolver always returns false, but the
    // pill render runs from settings, not from resolved caps. Hard-flip until
    // the resolver is restored. computeCitationPillState() is preserved (with
    // its full state machine) for direct callers, tests, and future restore.
    const RENDER_CITATION_PILL = false;
    if (RENDER_CITATION_PILL) {
        const citationPill = computeCitationPillState(
            args.citationsRequested,
            args.recentRun,
            args.providerSupportsCitations ?? true
        );
        const citationEl = pillRow.createSpan({
            cls: `ert-inquiry-engine-pill ert-inquiry-engine-pill--citations is-${citationPill.state}`,
            text: citationPill.label
        });
        setTooltip(citationEl, citationPill.tooltip);
    }
}
