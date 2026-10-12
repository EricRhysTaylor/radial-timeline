import type { ModelTier } from '../types';

/**
 * Retired catalog aliases and the model that took their place on the SAME
 * lane. A pin is an author's choice of lane as much as of model: someone who
 * pinned Haiku to control cost must land on the current Haiku when Haiku
 * retires, not on the latest-stable default (Opus, the most expensive model
 * on the provider).
 *
 * Only lanes whose latest-stable fallback is a DIFFERENT lane need an entry.
 * A retired default-lane model (an old Opus or GPT Sol) already falls back to
 * its own lane's successor through latest-stable.
 *
 * `tier` is the retired model's tier. retiredModels.test.ts holds every entry
 * to it: the resolved successor must be in the catalog at the same tier, so a
 * mapping can never move a pin to a pricier lane. When a successor itself
 * retires, add its own entry; chains resolve to the newest model.
 */
export const RETIRED_MODEL_SUCCESSORS: Readonly<Record<string, { successor: string; tier: ModelTier }>> = {
    'claude-haiku-4-5': { successor: 'claude-haiku-5-5', tier: 'FAST' },
    'claude-sonnet-5': { successor: 'claude-sonnet-5-5', tier: 'BALANCED' },
    'claude-fable-5': { successor: 'claude-fable-5-1', tier: 'DEEP' },
    'gpt-5.6-luna': { successor: 'gpt-6-luna', tier: 'FAST' },
    'gemini-3.5-flash': { successor: 'gemini-3.8-flash', tier: 'FAST' }
};

/**
 * The current alias that replaced a retired one, following chains. Undefined
 * when the alias was never mapped — the caller's ordinary fallback applies.
 */
export function resolveRetiredAlias(alias: string | undefined): string | undefined {
    if (!alias) return undefined;
    let current = alias;
    const seen = new Set<string>();
    while (RETIRED_MODEL_SUCCESSORS[current] && !seen.has(current)) {
        seen.add(current);
        current = RETIRED_MODEL_SUCCESSORS[current].successor;
    }
    return current === alias ? undefined : current;
}
