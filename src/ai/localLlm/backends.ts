import { LOCAL_LLM_BACKEND_LABELS } from './settings';
import {
    callOpenAiCompatibleLocalCompletion,
    fetchOpenAiCompatibleLocalModels,
    type LocalLlmCompletionResponse,
    type LocalLlmModelEntry,
    type LocalLlmTransportRequest,
    type LocalLlmWireResponseFormat
} from './transport';
import type { LocalLlmBackendId } from '../types';

/**
 * A request for JSON output. `schema` is optional so existing callers keep
 * their behaviour, but supplying it is what buys real server-side enforcement
 * on backends that support it.
 */
export interface LocalLlmJsonRequest {
    type: 'json_object';
    schema?: Record<string, unknown>;
    schemaName?: string;
}

export interface LocalLlmBackend {
    id: LocalLlmBackendId;
    label: string;
    listModels(request: LocalLlmTransportRequest): Promise<LocalLlmModelEntry[]>;
    complete(request: LocalLlmTransportRequest & {
        modelId: string;
        systemPrompt?: string | null;
        userPrompt: string;
        maxOutputTokens?: number;
        temperature?: number;
        topP?: number;
        responseFormat?: LocalLlmJsonRequest;
    }): Promise<LocalLlmCompletionResponse>;
}

export function toWireResponseFormat(
    id: LocalLlmBackendId,
    requested?: LocalLlmJsonRequest
): LocalLlmWireResponseFormat | undefined {
    if (!requested) return undefined;
    if (id === 'lmStudio') {
        // LM Studio's /v1/chat/completions rejects response_format type
        // 'json_object': it accepts only 'json_schema' or 'text'.
        //
        // When the caller supplies its real schema, send THAT. A permissive
        // `{type:'object'}` placeholder tells the server "any object will do",
        // which in practice lets a model emit structurally broken JSON — the
        // observed failure was a reply with a duplicated, half-closed `quotes`
        // key. Constraining generation to the actual shape is what makes the
        // reply parseable.
        return {
            type: 'json_schema',
            json_schema: requested.schema
                ? { name: requested.schemaName ?? 'response', strict: true, schema: requested.schema }
                : { name: 'response', schema: { type: 'object' } }
        };
    }
    return { type: 'json_object' };
}

function createOpenAiCompatibleBackend(id: LocalLlmBackendId): LocalLlmBackend {
    return {
        id,
        label: LOCAL_LLM_BACKEND_LABELS[id],
        listModels: fetchOpenAiCompatibleLocalModels,
        complete: request => callOpenAiCompatibleLocalCompletion({
            transport: {
                baseUrl: request.baseUrl,
                timeoutMs: request.timeoutMs,
                apiKey: request.apiKey,
                signal: request.signal
            },
            modelId: request.modelId,
            systemPrompt: request.systemPrompt,
            userPrompt: request.userPrompt,
            maxOutputTokens: request.maxOutputTokens,
            temperature: request.temperature,
            topP: request.topP,
            responseFormat: toWireResponseFormat(id, request.responseFormat)
        })
    };
}

const BACKENDS: Record<LocalLlmBackendId, LocalLlmBackend> = {
    ollama: createOpenAiCompatibleBackend('ollama'),
    lmStudio: createOpenAiCompatibleBackend('lmStudio'),
    openaiCompatible: createOpenAiCompatibleBackend('openaiCompatible')
};

export function getLocalLlmBackend(id: LocalLlmBackendId): LocalLlmBackend {
    return BACKENDS[id];
}
