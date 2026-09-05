import type RadialTimelinePlugin from '../../main';
import { getCredential } from '../credentials/credentials';
import { getLocalLlmBackend } from './backends';
import { getCanonicalLocalLlmSettings, LOCAL_LLM_BACKEND_LABELS } from './settings';
import { runStructuredJsonPipeline } from './structuredJson';
import { primeLocalLlmAvailability, probeLocalLlmServer } from './availability';
import type { LocalLlmJsonMode, LocalLlmSettings } from '../types';

/** Above this, server-enforced JSON is slow enough to be worth mentioning. */
const SLOW_STRUCTURED_MS = 2_500;

/**
 * Validation doubles as the first cold-model warm-up. Large MLX models can spend
 * longer compiling that first request than their normal configured request
 * timeout, even though the same probe completes in seconds once warm.
 */
export const MIN_LOCAL_LLM_DIAGNOSTIC_TIMEOUT_MS = 90_000;

export function getLocalLlmDiagnosticTimeoutMs(configuredTimeoutMs: number): number {
    return Math.max(configuredTimeoutMs, MIN_LOCAL_LLM_DIAGNOSTIC_TIMEOUT_MS);
}

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
    /**
     * Set when the configured JSON mode was measurably slow on this machine.
     *
     * Structured rather than prose because it has to survive into the healthy
     * rollup: this is the one finding that matters *because* nothing is broken,
     * so it cannot live only in the detail the panel collapses when green.
     */
    jsonModeTiming?: {
        label: string;
        alternateLabel: string;
        ms: number;
    };
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

    // Two budgets, deliberately different.
    //
    // The settings panel passes a short timeout so the CHEAP checks (reachability,
    // model list) cannot hang the UI. A generation needs a larger cold-start
    // allowance, and LocalLlmClient serializes diagnostics so two settings-panel
    // instances cannot launch competing model work.
    //
    // The generation probe therefore uses a cold-start allowance of at least 90s.
    // Runtime requests retain the author's configured timeout; this larger budget
    // is specific to the diagnostic that warms and validates the loaded model.
    const configuredTimeoutMs = getCanonicalLocalLlmSettings(plugin).timeoutMs;
    const transport = {
        baseUrl: localLlm.baseUrl,
        timeoutMs: getLocalLlmDiagnosticTimeoutMs(Math.max(localLlm.timeoutMs, configuredTimeoutMs)),
        apiKey
    };

    let reachable: LocalLlmDiagnosticCheck = { ok: false, message: 'Connection not tested.' };
    let modelAvailable: LocalLlmDiagnosticCheck = { ok: false, message: 'Model availability not tested.' };
    let basicCompletion: LocalLlmDiagnosticCheck = { ok: false, message: 'Basic completion not tested.' };
    let structuredJson: LocalLlmDiagnosticCheck = { ok: false, message: 'Structured JSON path not tested.' };
    let jsonModeTiming: LocalLlmDiagnosticsReport['jsonModeTiming'];

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
            structuredJson
        };
    }

    // One structured generation proves both basic completion and the configured
    // structured path. The former two-probe sequence doubled the opportunity for
    // queued work and made the outer validation budget contradict the inner ones.
    //
    // An earlier version also probed the alternate JSON mode so it could report
    // which was faster. That guaranteed a second slow model job per validation;
    // a settings hint is not worth doubling work on a serialized local runtime.
    const schema = {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status']
    };
    const startedAt = Date.now();
    const generation = {
        attempt: null as Awaited<ReturnType<typeof backend.complete>> | null
    };
    const structured = await runStructuredJsonPipeline({
        providerLabel: LOCAL_LLM_BACKEND_LABELS[localLlm.backend],
        schema,
        jsonMode: localLlm.jsonMode,
        maxRetries: localLlm.maxRetries,
        runner: {
            run: async ({ systemPrompt, userPrompt, useResponseFormat }) => {
                generation.attempt = await backend.complete({
                    ...transport,
                    modelId: localLlm.defaultModelId,
                    systemPrompt,
                    userPrompt,
                    maxOutputTokens: 64,
                    responseFormat: useResponseFormat
                        ? { type: 'json_object', schema, schemaName: 'diagnostic' }
                        : undefined
                });
                return generation.attempt;
            }
        },
        systemPrompt: 'Return only JSON.',
        userPrompt: 'Return {"status":"ok"} as valid JSON, with no other keys.'
    });
    const elapsedMs = Date.now() - startedAt;

    const generationAttempt = generation.attempt;
    basicCompletion = generationAttempt && !generationAttempt.error && generationAttempt.content
        ? { ok: true, message: 'Basic completion succeeded.' }
        : {
            ok: false,
            message: generationAttempt?.error || 'Backend did not return completion content.'
        };

    const modeLabel = (mode: LocalLlmJsonMode) =>
        mode === 'response_format' ? 'Response format' : 'Prompt only';
    const alternate: LocalLlmJsonMode =
        localLlm.jsonMode === 'response_format' ? 'prompt_only' : 'response_format';

    structuredJson = structured.ok
        ? {
            ok: true,
            message: `Structured JSON path succeeded in ${(elapsedMs / 1000).toFixed(1)}s using ${modeLabel(localLlm.jsonMode)}.`
        }
        : { ok: false, message: structured.error };

    // Reported from the one measurement taken, never from a second probe.
    // Server-enforced JSON is the mode that tends to be slow, so a suggestion
    // is only ever offered in that direction.
    if (structured.ok && localLlm.jsonMode === 'response_format' && elapsedMs > SLOW_STRUCTURED_MS) {
        jsonModeTiming = {
            label: modeLabel(localLlm.jsonMode),
            alternateLabel: modeLabel(alternate),
            ms: elapsedMs
        };
    }

    return {
        backend: LOCAL_LLM_BACKEND_LABELS[localLlm.backend],
        baseUrl: localLlm.baseUrl,
        modelId: localLlm.defaultModelId,
        reachable,
        modelAvailable,
        basicCompletion,
        structuredJson,
        jsonModeTiming
    };
}
