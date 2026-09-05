/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The one quick check of a cloud provider key: list the provider's models
 * and read the failure. Every settings surface that colours a key field or
 * a dropdown state goes through this.
 */

import { fetchAnthropicModels } from '../../api/anthropicApi';
import { fetchOpenAiModels } from '../../api/openaiApi';
import { fetchGeminiModels } from '../../api/geminiApi';

export type CloudProviderId = 'openai' | 'anthropic' | 'google';

export interface ProviderKeyValidationResult {
    state: 'ready' | 'rejected' | 'network_blocked';
    detail: string;
}

export function extractStatusCodeFromError(message: string): number | null {
    const wrapped = message.match(/\((\d{1,3})\)/);
    if (wrapped) return Number(wrapped[1]);
    const direct = message.match(/\b(?:status|http)\s*(\d{1,3})\b/i);
    if (direct) return Number(direct[1]);
    return null;
}

export function isAuthError(message: string, statusCode: number | null): boolean {
    if (statusCode === 400 || statusCode === 401 || statusCode === 403) return true;
    return /unauthorized|forbidden|invalid (?:api )?key|invalid auth|authentication/i.test(message);
}

export function buildProviderValidationDetail(message: string, statusCode: number | null): string {
    if (statusCode === 429) return 'Provider rate limit reached (HTTP 429). Wait briefly and retry.';
    if (statusCode !== null && statusCode >= 500) return `Provider service error (HTTP ${statusCode}). Try again shortly.`;
    if (statusCode !== null) return `Provider returned HTTP ${statusCode} while validating the key.`;
    return `No HTTP status returned during validation (${message}).`;
}

export async function validateProviderKeyQuick(provider: CloudProviderId, key: string): Promise<ProviderKeyValidationResult> {
    try {
        if (provider === 'anthropic') await fetchAnthropicModels(key);
        else if (provider === 'google') await fetchGeminiModels(key);
        else await fetchOpenAiModels(key);
        return { state: 'ready', detail: '' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = extractStatusCodeFromError(message);
        if (isAuthError(message, statusCode)) {
            return { state: 'rejected', detail: '' };
        }
        return { state: 'network_blocked', detail: buildProviderValidationDetail(message, statusCode) };
    }
}
