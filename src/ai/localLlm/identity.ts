import type { LocalLlmBackendId } from '../types';

/**
 * Identity helpers for a local model, kept dependency-free so both the settings
 * layer and the settings *validator* can use them without a circular import.
 *
 * A capability declaration ("this model holds a manuscript-sized prompt") is only
 * true of one model on one server. The identity built here is what scopes those
 * declarations, so switching backend, URL, or model cannot silently carry the
 * previous model's claims onto the new one.
 */

export function normalizeLocalLlmServerBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '');
}

export function buildLocalLlmServerKey(backend: LocalLlmBackendId, baseUrl: string): string {
    return `${backend}|${normalizeLocalLlmServerBaseUrl(baseUrl)}`;
}

export function buildLocalLlmModelIdentity(
    backend: LocalLlmBackendId,
    baseUrl: string,
    modelId: string
): string {
    return `${buildLocalLlmServerKey(backend, baseUrl)}::${modelId.trim()}`;
}
