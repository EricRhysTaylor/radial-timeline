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
        responseFormat?: { type: 'json_object' };
    }): Promise<LocalLlmCompletionResponse>;
}

export function toWireResponseFormat(
    id: LocalLlmBackendId,
    requested?: { type: 'json_object' }
): LocalLlmWireResponseFormat | undefined {
    if (!requested) return undefined;
    if (id === 'lmStudio') {
        // LM Studio's /v1/chat/completions rejects response_format type 'json_object':
        // it only accepts 'json_schema' or 'text'. A permissive object schema keeps
        // server-side JSON enforcement equivalent to json_object.
        return {
            type: 'json_schema',
            json_schema: { name: 'response', schema: { type: 'object' } }
        };
    }
    return requested;
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
                apiKey: request.apiKey
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
