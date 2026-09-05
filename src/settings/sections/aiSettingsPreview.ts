/**
 * Pure preview / cost-breakdown helpers for `renderAiSection` —
 * lifted from inline closures inside the settings tab so each piece is
 * independently testable and the orchestration reads as DOM assembly.
 *
 * Byte-identical to the original inline logic: copy wording, number
 * formatting, ordering, and the cache-pill merge rules are preserved
 * verbatim. Doctrine reminder — `CACHE_ARMED_PILL_TEXT` is a
 * static capability statement, NOT a claim of realized reuse.
 *
 * No DOM, no timers, no plugin/state access, no i18n, no Obsidian APIs.
 */

/**
 * Author-facing pill text for "the active model's provider supports
 * prompt caching." DOCTRINE: this must NOT promise a realized benefit
 * ("armed", "second run benefits") — payload-proven reuse is surfaced
 * separately via the "Observed cache hit · N% reused" pill.
 */
export const CACHE_ARMED_PILL_TEXT = 'Provider cache supported';

export type PreviewSignalType =
    | 'citation'
    | 'reuse'
    | 'passBehavior';

export interface PreviewPill {
    text: string;
    extraCls?: string;
}

export interface PreviewSignal {
    type: PreviewSignalType;
    pill: PreviewPill;
}

export const PREVIEW_SIGNAL_PRIORITY: readonly PreviewSignalType[] = [
    'citation',
    'reuse',
    'passBehavior'
] as const;

export const MAX_PREVIEW_SIGNALS = 4;

/** Inquiry-count formatter: `'?'` for null, locale-formatted integer otherwise. */
export const formatInquiryCount = (count: number | null): string =>
    count === null ? '?' : count.toLocaleString();

/**
 * Corpus token shorthand: `'—'` for null, else `~Nk` (one-decimal,
 * trailing `.0` stripped). Non-finite tokens are treated as 0 before
 * scaling.
 */
export const formatCorpusBreakdownToken = (tokens: number | null): string => (
    tokens === null
        ? '—'
        : `~${(Math.round((Number.isFinite(tokens) ? tokens : 0) / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
);

// Canonical home is src/ai/estimates/tokenEstimate.ts — re-exported here so
// existing settings call sites keep their import path. Do not re-implement.
export { estimateTokensFromChars } from '../../ai/estimates';

/**
 * Prompt token formatter: `'—'` for null, locale-formatted integer
 * (prefixed `~`) below 1000, else corpus-shorthand for >=1000.
 */
export const formatPromptToken = (tokens: number | null): string => (
    tokens === null
        ? '—'
        : tokens >= 1000
            ? formatCorpusBreakdownToken(tokens)
            : `~${tokens.toLocaleString()}`
);

/** `${label} (${formatPromptToken(tokens)})` */
export const buildTokenCapacityLine = (label: string, tokens: number | null): string =>
    `${label} (${formatPromptToken(tokens)})`;

/** `Scenes (<count>) — full text (<tokens-shorthand>)` */
export const buildScenesCapacityLine = (sceneCount: number | null, scenesTokens: number | null): string =>
    `Scenes (${formatInquiryCount(sceneCount)}) — full text (${formatCorpusBreakdownToken(scenesTokens)})`;

/**
 * Outline line: `Outline (?) — unavailable (...)` for null count;
 * `Outline (N) — full text (...)` when >0; `Outline — none` when 0.
 */
export const buildOutlineCapacityLine = (outlineCount: number | null, outlineTokens: number | null): string => (
    outlineCount === null
        ? `Outline (?) — unavailable (${formatCorpusBreakdownToken(outlineTokens)})`
        : outlineCount > 0
            ? `Outline (${formatInquiryCount(outlineCount)}) — full text (${formatCorpusBreakdownToken(outlineTokens)})`
            : 'Outline — none'
);

/**
 * References line: `References (?) — unavailable (...)` for null
 * count; `References (N) — included (...)` when >0; `References — none`
 * when 0.
 */
export const buildReferenceCapacityLine = (referenceCount: number | null, referenceTokens: number | null): string => (
    referenceCount === null
        ? `References (?) — unavailable (${formatCorpusBreakdownToken(referenceTokens)})`
        : referenceCount > 0
            ? `References (${formatInquiryCount(referenceCount)}) — included (${formatCorpusBreakdownToken(referenceTokens)})`
            : 'References — none'
);

/**
 * Approximate-token cost-table formatter: `'n/a'` for non-finite or
 * non-positive; `~Math.round(value)` below 1000; `~Nk` (one decimal at
 * >=10M, two decimals below) for millions; `~Nk` (integer thousands)
 * otherwise.
 */
export const formatApproxTokens = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return 'n/a';
    if (value >= 1_000_000) {
        const millions = value / 1_000_000;
        const formatted = millions >= 10 ? millions.toFixed(1) : millions.toFixed(2);
        return `~${formatted}M`;
    }
    if (value < 1000) return `~${Math.round(value)}`;
    const rounded = Math.round(value / 1000);
    return `~${rounded}k`;
};

/**
 * Corpus structure summary: pluralizes scenes/outlines and joins with
 * `' + '`. Suppresses the scenes part only when the outline count is
 * positive AND there are no scenes. `'No scenes or outlines'` when both
 * are zero.
 */
export const formatCorpusStructureSummary = (sceneCount: number, outlineCount: number): string => {
    const parts: string[] = [];
    if (sceneCount > 0 || outlineCount <= 0) {
        parts.push(`${sceneCount} ${sceneCount === 1 ? 'scene' : 'scenes'}`);
    }
    if (outlineCount > 0) {
        parts.push(`${outlineCount} ${outlineCount === 1 ? 'outline' : 'outlines'}`);
    }
    return parts.length ? parts.join(' + ') : 'No scenes or outlines';
};

/** `${formatCorpusBreakdownToken(tokens)} tokens` */
export const formatCorpusTokenSummary = (tokens: number): string =>
    `${formatCorpusBreakdownToken(tokens)} tokens`;

/**
 * Preview-failure reason label. Special-cases `quota_exceeded` and
 * `spend_cap`; otherwise normalizes underscores → spaces, collapses
 * whitespace, and Title-cases the first character. Falls back to
 * `'issue detected'` when both reason and status are empty.
 */
export const formatPreviewReasonLabel = (status?: string, reason?: string): string => {
    if (reason === 'quota_exceeded') return 'Quota exceeded';
    if (reason === 'spend_cap') return 'Spend cap reached';
    const normalizedReason = (reason ?? status ?? '')
        .trim()
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ');
    if (!normalizedReason) return 'issue detected';
    return normalizedReason.charAt(0).toUpperCase() + normalizedReason.slice(1);
};

/**
 * Human-readable cache TTL: at least 1 minute (ceiled from ms); past
 * 60 minutes splits into `Xh Ym remaining` or `Xh remaining` when no
 * trailing minutes.
 */
export const formatPreviewCacheRemaining = (remainingMs: number): string => {
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return minutes > 0 ? `${hours}h ${minutes}m remaining` : `${hours}h remaining`;
    }
    return `${totalMinutes}m remaining`;
};

/**
 * Observed-cache-hit pill text: `'Observed cache hit · N% reused'` for
 * positive finite ratios in [0,1]; `null` for missing / non-finite /
 * non-positive ratios. Ratios above 1 clamp to 100%.
 */
export const formatPreviewCacheObservedLabel = (ratio?: number): string | null => {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return null;
    return `Observed cache hit · ${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}% reused`;
};

/**
 * Collapses cache-related pills into a single merged pill with hyphen-
 * separated segments. Recognized base pills:
 * - `CACHE_ARMED_PILL_TEXT` / `'Cache enabled'` / `'Provider cache enabled'` → base armed (active)
 * - `/^Cache off\b/` → muted base
 * - `'Cache window expired'` → adds `'window expired'` segment + muted tone
 * - `/^Observed cache hit\b/` → strips `'Observed cache hit · '` prefix into a segment
 * All other pills pass through unchanged. Returns the merged pill last
 * if any base/segment present; otherwise returns `otherPills` as-is.
 */
export const mergePreviewCachePills = (pills: PreviewPill[]): PreviewPill[] => {
    let cacheBase: PreviewPill | null = null;
    const cacheSegments: string[] = [];
    let cacheTone: string | undefined;
    const otherPills: PreviewPill[] = [];

    for (const pill of pills) {
        if (pill.text === CACHE_ARMED_PILL_TEXT || pill.text === 'Cache enabled' || pill.text === 'Provider cache enabled') {
            cacheBase = { text: CACHE_ARMED_PILL_TEXT, extraCls: pill.extraCls };
            cacheTone = pill.extraCls;
            continue;
        }
        if (/^Cache off\b/i.test(pill.text)) {
            cacheBase = pill;
            cacheTone = pill.extraCls;
            continue;
        }
        if (pill.text === 'Cache window expired') {
            cacheSegments.push('window expired');
            cacheTone = 'ert-ai-pill--muted';
            continue;
        }
        if (/^Observed cache hit\b/i.test(pill.text)) {
            cacheSegments.push(pill.text.replace(/^Observed cache hit\s*·\s*/i, ''));
            if (!cacheTone) cacheTone = pill.extraCls;
            continue;
        }
        otherPills.push(pill);
    }

    if (!cacheBase && cacheSegments.length <= 0) {
        return otherPills;
    }
    const baseText = cacheBase?.text ?? CACHE_ARMED_PILL_TEXT;
    const mergedText = [baseText, ...cacheSegments].join(' — ');
    return [
        ...otherPills,
        {
            text: mergedText,
            extraCls: cacheTone
        }
    ];
};

/**
 * Build the ordered preview-signal pill list from candidate state
 * inputs. Drops null inputs, keeps only signals in PREVIEW_SIGNAL_PRIORITY,
 * sorts by that priority, caps at MAX_PREVIEW_SIGNALS, and returns the
 * pills themselves (signal-type metadata stripped).
 */
export const resolvePreviewSignals = (state: {
    citationLabel: PreviewPill | null;
    reuseLabel: PreviewPill | null;
    passBehaviorLabel: PreviewPill | null;
}): PreviewPill[] => {
    const candidates: PreviewSignal[] = [];

    if (state.citationLabel) {
        candidates.push({
            type: 'citation',
            pill: state.citationLabel
        });
    }

    if (state.reuseLabel) {
        candidates.push({
            type: 'reuse',
            pill: state.reuseLabel
        });
    }

    if (state.passBehaviorLabel) {
        candidates.push({
            type: 'passBehavior',
            pill: state.passBehaviorLabel
        });
    }

    const allowed = new Set<PreviewSignalType>(PREVIEW_SIGNAL_PRIORITY);
    const sorted = candidates
        .filter(signal => allowed.has(signal.type))
        .sort((left, right) => PREVIEW_SIGNAL_PRIORITY.indexOf(left.type) - PREVIEW_SIGNAL_PRIORITY.indexOf(right.type))
        .slice(0, MAX_PREVIEW_SIGNALS)
        .map(signal => signal.pill);
    return sorted;
};
