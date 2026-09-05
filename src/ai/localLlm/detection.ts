/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Local LLM server discovery: which servers to probe, what a healthy probe
 * yields, and the auto-mode choice of server and model. The transport is
 * injected so this module stays free of plugin state.
 */

import type { LocalLlmBackendId } from '../types';
import type { LocalLlmModelEntry } from './transport';
import { buildLocalLlmServerKey, normalizeLocalLlmServerBaseUrl } from './identity';
import { LOCAL_LLM_BACKEND_LABELS } from './settings';

export type DetectedLocalServer = {
    serverKey: string;
    label: string;
    backend: LocalLlmBackendId;
    baseUrl: string;
    models: LocalLlmModelEntry[];
    detectedAt: string;
};

export type LocalServerCandidate = {
    backend: LocalLlmBackendId;
    baseUrl: string;
    label: string;
};

/** The well-known local servers, probed on every detection. mlx_lm.server (Apple MLX) is OpenAI-compatible on :8080. */
export const DEFAULT_LOCAL_SERVER_PROBES: ReadonlyArray<{ backend: LocalLlmBackendId; baseUrl: string }> = [
    { backend: 'ollama', baseUrl: 'http://localhost:11434/v1' },
    { backend: 'lmStudio', baseUrl: 'http://localhost:1234/v1' },
    { backend: 'openaiCompatible', baseUrl: 'http://localhost:8080/v1' }
];

export function buildLocalServerOptionLabel(backend: LocalLlmBackendId, baseUrl: string): string {
    const normalizedUrl = normalizeLocalLlmServerBaseUrl(baseUrl);
    try {
        const parsed = new URL(normalizedUrl);
        return `${LOCAL_LLM_BACKEND_LABELS[backend]} · ${parsed.host}`;
    } catch {
        return `${LOCAL_LLM_BACKEND_LABELS[backend]} · ${normalizedUrl}`;
    }
}

/** The default probes plus the configured server, de-duplicated by server key. */
export function listLocalServerCandidates(configured: { backend: LocalLlmBackendId; baseUrl: string }): LocalServerCandidate[] {
    const candidates: LocalServerCandidate[] = DEFAULT_LOCAL_SERVER_PROBES.map(probe => ({
        ...probe,
        label: buildLocalServerOptionLabel(probe.backend, probe.baseUrl)
    }));
    const configuredBaseUrl = configured.baseUrl.trim();
    if (configuredBaseUrl) {
        candidates.push({
            backend: configured.backend,
            baseUrl: configuredBaseUrl,
            label: buildLocalServerOptionLabel(configured.backend, configured.baseUrl)
        });
    }
    const seen = new Set<string>();
    return candidates.filter(candidate => {
        const serverKey = buildLocalLlmServerKey(candidate.backend, candidate.baseUrl);
        if (seen.has(serverKey)) return false;
        seen.add(serverKey);
        return true;
    });
}

/**
 * Probe every candidate at once and keep the ones that answered with at
 * least one model. A server that answers with an empty list is not healthy.
 */
export async function probeLocalServers(
    candidates: LocalServerCandidate[],
    listModels: (candidate: LocalServerCandidate) => Promise<LocalLlmModelEntry[]>
): Promise<DetectedLocalServer[]> {
    const settled = await Promise.allSettled(candidates.map(async candidate => {
        const models = await listModels(candidate);
        if (!models.length) {
            throw new Error('No models reported by this local server.');
        }
        return {
            serverKey: buildLocalLlmServerKey(candidate.backend, candidate.baseUrl),
            label: candidate.label,
            backend: candidate.backend,
            baseUrl: normalizeLocalLlmServerBaseUrl(candidate.baseUrl),
            models: [...models].sort((left, right) => left.id.localeCompare(right.id)),
            detectedAt: new Date().toISOString()
        } satisfies DetectedLocalServer;
    }));
    return settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
}

/** Auto mode: a lone healthy server wins; otherwise the configured one if it is healthy, else the first. */
export function chooseAutoLocalServer(detected: DetectedLocalServer[], configuredServerKey: string): DetectedLocalServer | null {
    if (detected.length === 1) return detected[0];
    return detected.find(server => server.serverKey === configuredServerKey) ?? detected[0] ?? null;
}

/** The most capable model (highest tier), tie-broken by the larger context window. */
export function pickBestLocalModel(
    models: LocalLlmModelEntry[],
    assessTier: (model: LocalLlmModelEntry) => number
): LocalLlmModelEntry | null {
    if (!models.length) return null;
    return models.slice().sort((a, b) => {
        const tierDelta = assessTier(b) - assessTier(a);
        if (tierDelta !== 0) return tierDelta;
        return (b.contextWindow ?? 0) - (a.contextWindow ?? 0); // SAFE: sort comparator; models with no published context window sort last
    })[0];
}

/**
 * Auto mode's hands-off model pick: null when the current model is among the
 * loaded ones (nothing to change), otherwise the best loaded model.
 */
export function chooseAutoLocalModel(
    models: LocalLlmModelEntry[],
    currentModelId: string,
    assessTier: (model: LocalLlmModelEntry) => number
): LocalLlmModelEntry | null {
    const hasCurrentModel = currentModelId.length > 0 && models.some(model => model.id === currentModelId);
    if (hasCurrentModel) return null;
    const best = pickBestLocalModel(models, assessTier);
    return best && best.id !== currentModelId ? best : null;
}
