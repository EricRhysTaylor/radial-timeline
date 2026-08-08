import type RadialTimelinePlugin from '../../main';
import { getCredential } from '../credentials/credentials';
import { getLocalLlmBackend } from './backends';
import { getCanonicalLocalLlmSettings, LOCAL_LLM_BACKEND_LABELS } from './settings';
import { runStructuredJsonPipeline } from './structuredJson';
import { primeLocalLlmAvailability, probeLocalLlmServer } from './availability';
import type { LocalLlmSettings } from '../types';

export interface LocalLlmDiagnosticCheck {
    ok: boolean;
    message: string;
}

export interface LocalLlmDiagnosticsReport {
    backend: string;
    baseUrl: string;
    modelId: string;
    reachable: LocalLlmDiagnosticCheck;
    modelAvailable: LocalLlmDiagnosticCheck;
    basicCompletion: LocalLlmDiagnosticCheck;
    structuredJson: LocalLlmDiagnosticCheck;
    /** Compatibility field: RT no longer auto-repairs malformed JSON at runtime. */
    repairPath: LocalLlmDiagnosticCheck;
}

function resolveSettings(
    plugin: RadialTimelinePlugin,
    overrides?: Partial<LocalLlmSettings>
): LocalLlmSettings {
    return {
        ...getCanonicalLocalLlmSettings(plugin),
        ...(overrides || {})
    };
}

export async function runLocalLlmDiagnostics(
    plugin: RadialTimelinePlugin,
    overrides?: Partial<LocalLlmSettings>
): Promise<LocalLlmDiagnosticsReport> {
    const localLlm = resolveSettings(plugin, overrides);
    const backend = getLocalLlmBackend(localLlm.backend);
    const apiKey = await getCredential(plugin, 'ollama');
    const transport = {
        baseUrl: localLlm.baseUrl,
        timeoutMs: localLlm.timeoutMs,
        apiKey
    };

    let reachable: LocalLlmDiagnosticCheck = { ok: false, message: 'Connection not tested.' };
    let modelAvailable: LocalLlmDiagnosticCheck = { ok: false, message: 'Model availability not tested.' };
    let basicCompletion: LocalLlmDiagnosticCheck = { ok: false, message: 'Basic completion not tested.' };
    let structuredJson: LocalLlmDiagnosticCheck = { ok: false, message: 'Structured JSON path not tested.' };

    // Reachability and model presence come from the shared probe, so this panel
    // and the timeline search panel can never disagree about whether a local
    // model is usable. The deep checks below are this function's own.
    const probe = await probeLocalLlmServer(plugin, localLlm, Date.now());

    // Only a run against the SAVED configuration may seed the shared cache — a
    // "test this other URL" here must not change what the rest of the plugin
    // believes about the configured server.
    if (!overrides || Object.keys(overrides).length === 0) {
        primeLocalLlmAvailability(localLlm, probe);
    }

    if (probe.availableModelIds) {
        const models = probe.availableModelIds;
        reachable = { ok: true, message: `${LOCAL_LLM_BACKEND_LABELS[localLlm.backend]} responded with ${models.length} models.` };
        modelAvailable = probe.available
            ? { ok: true, message: `Model "${localLlm.defaultModelId}" is available.` }
            : { ok: false, message: `Model "${localLlm.defaultModelId}" is not available.` };
    } else {
        reachable = { ok: false, message: probe.reason ?? 'Connection failed.' };
        modelAvailable = { ok: false, message: 'Model check skipped because backend is unreachable.' };
        return {
            backend: LOCAL_LLM_BACKEND_LABELS[localLlm.backend],
            baseUrl: localLlm.baseUrl,
            modelId: localLlm.defaultModelId,
            reachable,
            modelAvailable,
            basicCompletion,
            structuredJson,
            repairPath: {
                ok: true,
                message: 'No runtime JSON repair fallback is enabled; malformed JSON fails explicitly.'
            }
        };
    }

    const basic = await backend.complete({
        ...transport,
        modelId: localLlm.defaultModelId,
        systemPrompt: 'Reply with the single word READY.',
        userPrompt: 'Return READY.',
        maxOutputTokens: 16
    });
    basicCompletion = basic.success && basic.content?.toUpperCase().includes('READY')
        ? { ok: true, message: 'Basic completion succeeded.' }
        : { ok: false, message: basic.error || 'Backend did not return the expected READY response.' };

    // Both JSON modes are measured, not assumed. Server-side enforcement is
    // several times slower than prompting on some servers — an author choosing
    // between them deserves a number from their own machine rather than advice
    // that may not hold there.
    const schema = {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status']
    };
    const tryMode = async (jsonMode: 'response_format' | 'prompt_only') => {
        const startedAt = Date.now();
        const result = await runStructuredJsonPipeline({
            providerLabel: LOCAL_LLM_BACKEND_LABELS[localLlm.backend],
            schema,
            jsonMode,
            maxRetries: localLlm.maxRetries,
            runner: {
                run: ({ systemPrompt, userPrompt, useResponseFormat }) => backend.complete({
                    ...transport,
                    modelId: localLlm.defaultModelId,
                    systemPrompt,
                    userPrompt,
                    maxOutputTokens: 64,
                    responseFormat: useResponseFormat
                        ? { type: 'json_object', schema, schemaName: 'diagnostic' }
                        : undefined
                })
            },
            systemPrompt: 'Return only JSON.',
            userPrompt: 'Return {"status":"ok"} as valid JSON, with no other keys.'
        });
        return { ok: result.ok, error: result.ok ? undefined : result.error, ms: Date.now() - startedAt };
    };

    const active = localLlm.jsonMode;
    const other = active === 'response_format' ? 'prompt_only' : 'response_format';
    const activeResult = await tryMode(active);
    const otherResult = await tryMode(other);

    const label = (mode: 'response_format' | 'prompt_only') =>
        mode === 'response_format' ? 'Response format' : 'Prompt only';
    const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

    if (!activeResult.ok) {
        structuredJson = {
            ok: false,
            message: otherResult.ok
                ? `${label(active)} failed: ${activeResult.error} — ${label(other)} succeeded in ${seconds(otherResult.ms)}, so switching Structured JSON mode should fix this.`
                : `${label(active)} failed: ${activeResult.error}`
        };
    } else if (!otherResult.ok) {
        structuredJson = {
            ok: true,
            message: `${label(active)} succeeded in ${seconds(activeResult.ms)}. ${label(other)} did not return valid JSON, so keep the current mode.`
        };
    } else {
        // Both work: the only remaining question is speed, and a small
        // difference is not worth acting on.
        const ratio = activeResult.ms > 0 ? otherResult.ms / activeResult.ms : 1;
        structuredJson = ratio < 0.6
            ? {
                ok: true,
                message: `${label(active)} succeeded in ${seconds(activeResult.ms)}, but ${label(other)} also returned valid JSON in ${seconds(otherResult.ms)} — about ${(1 / ratio).toFixed(1)}x faster. Consider switching Structured JSON mode.`
            }
            : {
                ok: true,
                message: `${label(active)} succeeded in ${seconds(activeResult.ms)}; ${label(other)} took ${seconds(otherResult.ms)}. Current mode is a good choice.`
            };
    }

    const repairPath: LocalLlmDiagnosticCheck = {
        ok: true,
        message: 'No runtime JSON repair fallback is enabled; malformed JSON fails explicitly.'
    };

    return {
        backend: LOCAL_LLM_BACKEND_LABELS[localLlm.backend],
        baseUrl: localLlm.baseUrl,
        modelId: localLlm.defaultModelId,
        reachable,
        modelAvailable,
        basicCompletion,
        structuredJson,
        repairPath
    };
}
