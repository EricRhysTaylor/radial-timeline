/*
 * Gossamer provider-cache window — shared state + formatters.
 *
 * A Gossamer run scores ONE signal but caches the manuscript prefix (see
 * buildUnifiedBeatAnalysisCacheParts). The four signals share that cached
 * corpus, so after the first run completes there is a finite window during
 * which scoring the remaining signals reuses the manuscript instead of
 * re-billing it. This module models that window and is the single source of
 * truth every surface renders from (timeline pill, processing modal, settings
 * preview pill, settings AI table).
 *
 * Doctrine (truth-over-optimism): a window is only built when the provider
 * actually engaged the cache on the run that armed it — never speculatively.
 * Gemini reports the real cachedContent expiry; Anthropic/OpenAI don't, so the
 * window is derived from the configured provider TTL bound to creation time
 * (NOT extended on a later hit).
 *
 * Refusal interaction (empirical, claude-fable-5 smoke probe 2026-07-19):
 * a refused request (stop_reason 'refusal') does NOT persist a usable cache
 * entry — the probe saw the refused arming call write the prefix but the
 * follow-up re-wrote the full prefix with cache_read=0. Consequence: if
 * signal-1 of a Gossamer run is refused, signals 2–4 pay the full prefix
 * price (no window is armed, which this module already enforces by only
 * building on a real cache engagement). Fable's classifiers refuse
 * degenerate/repetitive input; real manuscript prose cached cleanly (11.7k
 * stable-prefix tokens, full reuse on call 2).
 */
import type { AIProviderId, AIRunAdvancedContext, AiSettingsV1 } from '../ai/types';
import { resolveProviderCacheWindowMs } from '../ai/settings/cacheWindows';
import { formatExactUsdCost } from '../ai/cost/estimateCorpusCost';

export type GossamerCacheProvider = 'anthropic' | 'openai' | 'google';

export interface GossamerCacheWindow {
  provider: GossamerCacheProvider;
  modelLabel: string;
  /** Epoch ms when the window was armed (run returned). */
  armedAt: number;
  /** Epoch ms when the provider cache resource lapses. */
  expiresAt: number;
  /** Estimated tokens held in the cached stable prefix, when known. */
  cachedStableTokens?: number;
  /** Whether the arming run created the cache or reused an existing one. */
  cacheStatus?: 'hit' | 'created';
  /**
   * Actual billed cost (USD) of the run that armed/refreshed this window,
   * derived from the provider's usage payload — a fact, not a projection.
   */
  lastRunCostUSD?: number;
}

const CACHE_PROVIDERS: readonly AIProviderId[] = ['anthropic', 'openai', 'google'];

/**
 * Build a cache window from a completed run's advanced context, or null when
 * the run did not engage a cacheable provider. `returnedAtMs` is the run's
 * return timestamp (creation time for the derived-TTL providers).
 */
export function buildGossamerCacheWindow(
  context: AIRunAdvancedContext | null | undefined,
  returnedAtMs: number,
  aiSettings: AiSettingsV1
): GossamerCacheWindow | null {
  if (!context) return null;
  // Armed only when the provider genuinely engaged the cache this run.
  if (!context.reuseState || context.reuseState === 'idle') return null;
  if (!CACHE_PROVIDERS.includes(context.provider)) return null;
  const provider = context.provider as GossamerCacheProvider;

  let expiresAt: number | null = null;
  if (typeof context.cacheExpiresAt === 'number' && context.cacheExpiresAt > returnedAtMs) {
    // Gemini: authoritative cachedContent resource expiry.
    expiresAt = context.cacheExpiresAt;
  } else {
    // Anthropic/OpenAI: no provider-reported expiry — derive from the
    // configured TTL bound to creation time.
    const ttlMs = resolveProviderCacheWindowMs(provider, aiSettings);
    expiresAt = ttlMs && ttlMs > 0 ? returnedAtMs + ttlMs : null;
  }
  if (!expiresAt || expiresAt <= returnedAtMs) return null;

  const cachedStableTokens = typeof context.cachedStableTokens === 'number'
    && Number.isFinite(context.cachedStableTokens) && context.cachedStableTokens > 0
    ? Math.floor(context.cachedStableTokens)
    : undefined;

  return {
    provider,
    modelLabel: context.modelLabel || '',
    armedAt: returnedAtMs,
    expiresAt,
    cachedStableTokens,
    cacheStatus: context.cacheStatus
  };
}

export function isGossamerCacheWindowOpen(
  window: GossamerCacheWindow | null | undefined,
  nowMs: number
): boolean {
  return !!window && window.expiresAt > nowMs;
}

/**
 * Countdown clock for a still-open window: `MM:SS` under an hour, `H:MM:SS`
 * at or above. Returns null once the window has closed. (Distinct from the
 * Inquiry HH:MM formatter — Gossamer windows are minute-scale, so seconds
 * matter for the "run the next signal now" nudge.)
 */
export function formatGossamerCacheClock(
  window: GossamerCacheWindow | null | undefined,
  nowMs: number
): string | null {
  if (!isGossamerCacheWindowOpen(window, nowMs)) return null;
  const totalSeconds = Math.max(0, Math.ceil((window!.expiresAt - nowMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Short pill label, e.g. `"Cache 10:00"`. Null when the window is closed. */
export function formatGossamerCachePillLabel(
  window: GossamerCacheWindow | null | undefined,
  nowMs: number
): string | null {
  const clock = formatGossamerCacheClock(window, nowMs);
  return clock ? `Cache ${clock}` : null;
}

/**
 * Factual cost report for the run that armed this window, e.g.
 * `"last run $0.157 · cache hit"`. Reports only the observed billed cost from
 * the usage payload — no projection of future runs. Null when no cost was
 * captured.
 */
export function formatGossamerCacheCostHint(
  window: GossamerCacheWindow | null | undefined
): string | null {
  if (typeof window?.lastRunCostUSD !== 'number' || !Number.isFinite(window.lastRunCostUSD)) {
    return null;
  }
  const cost = formatExactUsdCost(window.lastRunCostUSD);
  const status = window.cacheStatus ? ` · cache ${window.cacheStatus}` : '';
  return `last run ${cost}${status}`;
}
