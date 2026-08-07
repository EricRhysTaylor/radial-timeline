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

    const structured = await runStructuredJsonPipeline({
        providerLabel: LOCAL_LLM_BACKEND_LABELS[localLlm.backend],
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string' }
            },
            required: ['status']
        },
        jsonMode: localLlm.jsonMode,
        maxRetries: localLlm.maxRetries,
        runner: {
            run: ({ systemPrompt, userPrompt, useResponseFormat }) => backend.complete({
                ...transport,
                modelId: localLlm.defaultModelId,
                systemPrompt,
                userPrompt,
                maxOutputTokens: 64,
                responseFormat: useResponseFormat ? { type: 'json_object' } : undefined
            })
        },
        systemPrompt: 'Return only JSON.',
        userPrompt: 'Return {"status":"ok"} as valid JSON.'
    });
    structuredJson = structured.ok
        ? { ok: true, message: 'Structured JSON path succeeded without fallback repair.' }
        : { ok: false, message: structured.error };

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
