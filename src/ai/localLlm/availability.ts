/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * "Is there a local model I can actually use right now?"
 *
 * A lightweight probe for UI affordances — it lists models and stops. The deep
 * checks in `diagnostics.ts` run one real structured completion, which is right
 * for a settings panel the author is staring at and far too slow for a control
 * that has to resolve while a search box is opening.
 *
 * The two are not independent: `runLocalLlmDiagnostics` calls this first and
 * continues from its result, so Settings → AI and the search panel cannot
 * report contradictory connection states.
 */

import type RadialTimelinePlugin from '../../main';
import { getCredential } from '../credentials/credentials';
import { getLocalLlmBackend } from './backends';
import {
    buildLocalLlmModelIdentity,
    getCanonicalLocalLlmSettings,
    LOCAL_LLM_BACKEND_LABELS
} from './settings';
import type { LocalLlmSettings } from '../types';

export interface LocalLlmAvailability {
    available: boolean;
    /**
     * Why not — rendered verbatim to the author. Always specific enough to act
     * on: which server, which model. Never a bare "unavailable".
     */
    reason?: string;
    /** The configured model, when it is actually present on the server. */
    modelId?: string;
    /** Every model the server offers, for a "did you mean" style hint. */
    availableModelIds?: string[];
    checkedAt: number;
}

interface CacheEntry {
    key: string;
    checkedAt: number;
    value: LocalLlmAvailability;
}

/**
 * A working setup rarely stops working mid-session, so a positive answer can
 * be trusted for a while.
 */
const AVAILABLE_MAX_AGE_MS = 60_000;

/**
 * A negative answer expires quickly: the author who just saw "server not
 * reachable" is likely starting their server right now and coming straight
 * back. Making them wait a minute to be told the truth would read as broken.
 * Failed probes are cheap — a refused connection returns immediately.
 */
const UNAVAILABLE_MAX_AGE_MS = 5_000;

let cached: CacheEntry | null = null;

/**
 * Cache identity: the configuration the answer is about.
 *
 * Keyed on settings rather than time alone because `runLocalLlmDiagnostics`
 * accepts unsaved overrides — a Settings-side "test this other URL" must never
 * poison the panel's view of the saved configuration.
 */
function cacheKey(localLlm: LocalLlmSettings): string {
    return [
        localLlm.enabled ? 'on' : 'off',
        buildLocalLlmModelIdentity(localLlm.backend, localLlm.baseUrl, localLlm.defaultModelId)
    ].join('|');
}

/**
 * Record an answer derived elsewhere (the deep diagnostics path), so the two
 * surfaces share one result. Ignored when the run used unsaved overrides.
 */
export function primeLocalLlmAvailability(
    localLlm: LocalLlmSettings,
    value: LocalLlmAvailability
): void {
    cached = { key: cacheKey(localLlm), checkedAt: value.checkedAt, value };
}

/**
 * Reachability and model presence, without the enabled gate.
 *
 * Split out because `runLocalLlmDiagnostics` shares exactly these two checks
 * but has never gated on `enabled` — the author is in Settings deliberately
 * testing a server, and refusing to look would be unhelpful. Sharing the
 * implementation is what stops the two surfaces from drifting; sharing the
 * *policy* would change what Settings does.
 */
export async function probeLocalLlmServer(
    plugin: RadialTimelinePlugin,
    localLlm: LocalLlmSettings,
    now: number
): Promise<LocalLlmAvailability> {
    const backendLabel = LOCAL_LLM_BACKEND_LABELS[localLlm.backend];
    const backend = getLocalLlmBackend(localLlm.backend);
    const apiKey = await getCredential(plugin, 'ollama');

    let modelIds: string[];
    try {
        const models = await backend.listModels({
            baseUrl: localLlm.baseUrl,
            timeoutMs: localLlm.timeoutMs,
            apiKey
        });
        modelIds = models.map(model => model.id);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            available: false,
            reason: `${backendLabel} is not reachable at ${localLlm.baseUrl} — ${message}`,
            checkedAt: now
        };
    }

    if (!modelIds.includes(localLlm.defaultModelId)) {
        return {
            available: false,
            reason: `${backendLabel} is running, but the model "${localLlm.defaultModelId}" is not loaded.`,
            availableModelIds: modelIds,
            checkedAt: now
        };
    }

    return {
        available: true,
        modelId: localLlm.defaultModelId,
        availableModelIds: modelIds,
        checkedAt: now
    };
}

/**
 * Probe the configured local server, including whether local LLM is switched on.
 *
 * Checks in order, each producing its own reason: turned off in settings →
 * server unreachable → configured model missing from the server's list.
 */
export async function probeLocalLlmAvailability(
    plugin: RadialTimelinePlugin,
    localLlm: LocalLlmSettings,
    now: number
): Promise<LocalLlmAvailability> {
    if (!localLlm.enabled) {
        return {
            available: false,
            reason: 'Local LLM is turned off in Settings → AI.',
            checkedAt: now
        };
    }
    return probeLocalLlmServer(plugin, localLlm, now);
}

/**
 * Availability for the currently saved configuration, cached briefly.
 *
 * A settings change needs no explicit invalidation: the cache key *is* the
 * configuration, so a different backend, URL, model, or enabled flag simply
 * misses.
 *
 * @param opts.maxAgeMs override how stale an answer may be
 * @param opts.force ignore the cache — use when the author is about to commit
 *   to a run, where a stale "available" would fail confusingly
 */
export async function getLocalLlmAvailability(
    plugin: RadialTimelinePlugin,
    opts: { maxAgeMs?: number; force?: boolean } = {}
): Promise<LocalLlmAvailability> {
    const localLlm = getCanonicalLocalLlmSettings(plugin);
    const key = cacheKey(localLlm);
    const now = Date.now();

    if (!opts.force && cached && cached.key === key) {
        const maxAgeMs = opts.maxAgeMs
            ?? (cached.value.available ? AVAILABLE_MAX_AGE_MS : UNAVAILABLE_MAX_AGE_MS);
        if (now - cached.checkedAt < maxAgeMs) return cached.value;
    }

    const value = await probeLocalLlmAvailability(plugin, localLlm, now);
    cached = { key, checkedAt: now, value };
    return value;
}
