#!/usr/bin/env node
/**
 * Provider model introspection script.
 * Fetches model catalogs from OpenAI, Anthropic, and Google Gemini and writes
 * a canonical, diffable JSON payload.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... npm run update-models
 *   npm run update-models -- --diff
 *   npm run update-models -- --check
 */
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import {
    PROVIDERS,
    buildSummary,
    coerceExistingToCanonicalModels,
    computeDiff,
    groupByProvider,
    normalizeAnthropicModels,
    normalizeGoogleModels,
    normalizeOpenAiModels,
    sortCanonicalModels,
} from './modelSnapshotUtils.mjs';

const OUTPUT_PATH = path.resolve('scripts/models/latest-models.json');
const CONCURRENCY_LIMIT = 2;
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30000;
const PROVIDER_ORDER = {
    openai: 0,
    anthropic: 1,
    google: 2,
};

class FetchAttemptError extends Error {
    constructor(message, { retryable = false } = {}) {
        super(message);
        this.name = 'FetchAttemptError';
        this.retryable = retryable;
    }
}

function hasFlag(flag) {
    return process.argv.slice(2).includes(flag);
}

function createLimiter(limit) {
    let active = 0;
    const queue = [];

    const runNext = () => {
        if (active >= limit || queue.length === 0) return;
        const next = queue.shift();
        if (!next) return;
        active += 1;
        next.fn()
            .then(next.resolve, next.reject)
            .finally(() => {
                active -= 1;
                runNext();
            });
    };

    return function limitRun(fn) {
        return new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            runNext();
        });
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has('key')) {
            parsed.searchParams.set('key', '***');
        }
        return parsed.toString();
    } catch {
        return String(url);
    }
}

function parseRetryAfterMs(headerValue) {
    if (!headerValue) return null;
    const asNumber = Number(headerValue);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
        return asNumber * 1000;
    }
    const parsedDate = Date.parse(headerValue);
    if (!Number.isNaN(parsedDate)) {
        return Math.max(0, parsedDate - Date.now());
    }
    return null;
}

function backoffMs(attempt, retryAfterMs) {
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return Math.min(retryAfterMs, 60000);
    }
    const base = 500 * (2 ** attempt);
    const jitter = Math.floor(Math.random() * 300);
    return Math.min(base + jitter, 15000);
}

async function fetchJsonWithRetry(url, options = {}, context = 'request') {
    const sanitized = sanitizeUrl(url);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const shouldRetry = response.status === 429 || response.status === 503;
                if (shouldRetry && attempt < MAX_RETRIES) {
                    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
                    const delay = backoffMs(attempt, retryAfterMs);
                    console.warn(`[update-models] ${context} throttled (${response.status}). Retrying in ${delay}ms...`);
                    await sleep(delay);
                    continue;
                }

                const text = await response.text();
                throw new FetchAttemptError(
                    `${sanitized} failed (${response.status}): ${text}`,
                    { retryable: shouldRetry }
                );
            }

            return response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof FetchAttemptError && !error.retryable) {
                throw error;
            }
            if (attempt >= MAX_RETRIES) {
                throw new Error(`${context} failed after retries: ${error instanceof Error ? error.message : String(error)}`);
            }
            const delay = backoffMs(attempt, null);
            console.warn(`[update-models] ${context} transient error. Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }

    throw new Error(`${context} exhausted retries.`);
}

function printDiff(diff) {
    for (const provider of PROVIDERS) {
        const { added, removed } = diff[provider];
        if (!added.length && !removed.length) continue;
        console.log(`[update-models] ${provider}: +${added.length} -${removed.length}`);
        for (const id of added) console.log(`  + ${id}`);
        for (const id of removed) console.log(`  - ${id}`);
    }
}

async function fetchPagedModels({ provider, context, initialUrl, requestOptions, extractItems, getNextCursor, buildNextUrl, limiter }) {
    let cursor = null;
    const items = [];
    let pages = 0;

    while (true) {
        pages += 1;
        if (pages > 200) {
            throw new Error(`${provider} pagination exceeded safety limit.`);
        }

        const url = cursor ? buildNextUrl(cursor) : initialUrl;
        const data = await limiter(() => fetchJsonWithRetry(url, requestOptions, context));
        const pageItems = extractItems(data);
        if (Array.isArray(pageItems)) {
            items.push(...pageItems);
        }

        const nextCursor = getNextCursor(data);
        if (!nextCursor) break;
        if (nextCursor === cursor) {
            throw new Error(`${provider} pagination cursor stalled.`);
        }
        cursor = nextCursor;
    }

    return items;
}

async function fetchOpenAiModels(apiKey, limiter) {
    if (!apiKey) {
        console.warn('[update-models] OPENAI_API_KEY missing; using previous OpenAI cache.');
        return { ok: false, skipped: true, models: [] };
    }

    const data = await limiter(() => fetchJsonWithRetry('https://api.openai.com/v1/models', {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    }, 'openai:listModels'));

    return { ok: true, skipped: false, models: normalizeOpenAiModels(data.data || []) };
}

async function fetchAnthropicModels(apiKey, limiter) {
    if (!apiKey) {
        console.warn('[update-models] ANTHROPIC_API_KEY missing; using previous Anthropic cache.');
        return { ok: false, skipped: true, models: [] };
    }

    const initialUrl = new URL('https://api.anthropic.com/v1/models');
    initialUrl.searchParams.set('limit', '100');

    const requestOptions = {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
    };

    const items = await fetchPagedModels({
        provider: 'anthropic',
        context: 'anthropic:listModels',
        initialUrl: initialUrl.toString(),
        requestOptions,
        limiter,
        extractItems: data => data.data || data.models || [],
        getNextCursor: data => {
            const hasMore = Boolean(data?.has_more ?? data?.hasMore);
            if (!hasMore) return null;
            const cursor = data?.last_id || data?.lastId || null;
            if (!cursor) {
                throw new Error('anthropic pagination indicated more pages but did not return last_id/lastId.');
            }
            return cursor;
        },
        buildNextUrl: cursor => {
            const pageUrl = new URL('https://api.anthropic.com/v1/models');
            pageUrl.searchParams.set('limit', '100');
            pageUrl.searchParams.set('after_id', cursor);
            return pageUrl.toString();
        },
    });

    return { ok: true, skipped: false, models: normalizeAnthropicModels(items) };
}

async function fetchGoogleModels(apiKey, limiter) {
    if (!apiKey) {
        console.warn('[update-models] GEMINI_API_KEY/GOOGLE_API_KEY missing; using previous Google cache.');
        return { ok: false, skipped: true, models: [] };
    }

    const items = await fetchPagedModels({
        provider: 'google',
        context: 'google:listModels',
        initialUrl: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`,
        requestOptions: {},
        limiter,
        extractItems: data => data.models || [],
        getNextCursor: data => data.nextPageToken || null,
        buildNextUrl: cursor => (
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000&pageToken=${encodeURIComponent(cursor)}`
        ),
    });

    return { ok: true, skipped: false, models: normalizeGoogleModels(items) };
}

async function loadExistingData() {
    try {
        const fileContent = await fs.readFile(OUTPUT_PATH, 'utf8');
        return JSON.parse(fileContent);
    } catch {
        return {};
    }
}

function mergeWithFallback(currentByProvider, previousByProvider, fetchStatusByProvider) {
    const merged = {
        openai: currentByProvider.openai,
        anthropic: currentByProvider.anthropic,
        google: currentByProvider.google,
    };

    for (const provider of PROVIDERS) {
        const status = fetchStatusByProvider[provider];
        if (status.ok) continue;
        if (previousByProvider[provider]?.length) {
            merged[provider] = previousByProvider[provider];
        } else if (status.skipped) {
            merged[provider] = [];
        }
    }

    return merged;
}

async function main() {
    const showDiff = hasFlag('--diff');
    const checkOnly = hasFlag('--check');
    const limiter = createLimiter(CONCURRENCY_LIMIT);

    const existingData = await loadExistingData();
    const previousModels = sortCanonicalModels(coerceExistingToCanonicalModels(existingData));
    const previousByProvider = groupByProvider(previousModels);

    const googleApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    const [openaiResult, anthropicResult, googleResult] = await Promise.all([
        fetchOpenAiModels(process.env.OPENAI_API_KEY, limiter).catch(error => ({
            ok: false,
            skipped: false,
            models: [],
            error: error instanceof Error ? error.message : String(error),
        })),
        fetchAnthropicModels(process.env.ANTHROPIC_API_KEY, limiter).catch(error => ({
            ok: false,
            skipped: false,
            models: [],
            error: error instanceof Error ? error.message : String(error),
        })),
        fetchGoogleModels(googleApiKey, limiter).catch(error => ({
            ok: false,
            skipped: false,
            models: [],
            error: error instanceof Error ? error.message : String(error),
        })),
    ]);

    const fetchStatusByProvider = {
        openai: openaiResult,
        anthropic: anthropicResult,
        google: googleResult,
    };

    for (const provider of PROVIDERS) {
        const status = fetchStatusByProvider[provider];
        if (!status.ok && status.error) {
            console.warn(`[update-models] ${provider} fetch failed: ${status.error}`);
        }
    }

    const currentByProvider = {
        openai: openaiResult.models || [],
        anthropic: anthropicResult.models || [],
        google: googleResult.models || [],
    };

    const mergedByProvider = mergeWithFallback(currentByProvider, previousByProvider, fetchStatusByProvider);
    const models = sortCanonicalModels([
        ...mergedByProvider.openai,
        ...mergedByProvider.anthropic,
        ...mergedByProvider.google,
    ]);

    const payload = {
        generatedAt: new Date().toISOString(),
        summary: buildSummary(models),
        models,
    };

    const diff = computeDiff(previousModels, models);
    const changed = PROVIDERS.some(provider => diff[provider].added.length || diff[provider].removed.length);
    if (showDiff || checkOnly) {
        printDiff(diff);
        if (!changed) {
            console.log('[update-models] No model ID changes detected.');
        }
    }

    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[update-models] Wrote ${OUTPUT_PATH}`);

    if (checkOnly && changed) {
        console.error('[update-models] Changes detected (--check).');
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('[update-models] Failed:', error);
    process.exitCode = 1;
});
