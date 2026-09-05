import { validateJsonResponse } from '../runtime/jsonValidator';

export interface StructuredJsonAttempt {
    content: string | null;
    responseData: unknown;
    requestPayload?: unknown;
    error?: string;
}

export interface StructuredJsonRunner {
    run(input: {
        systemPrompt?: string | null;
        userPrompt: string;
        useResponseFormat: boolean;
    }): Promise<StructuredJsonAttempt>;
}

export interface StructuredJsonSuccess {
    ok: true;
    content: string;
    responseData: unknown;
    requestPayload?: unknown;
    repairCount: number;
}

export interface StructuredJsonFailure {
    ok: false;
    error: string;
    content: string | null;
    initialContent: string | null;
    repairedContent?: string | null;
    responseData: unknown;
    requestPayload?: unknown;
    stage: 'initial' | 'repair';
    repairCount: number;
}

export type StructuredJsonResult = StructuredJsonSuccess | StructuredJsonFailure;

function stripCodeFence(input: string): string {
    const trimmed = input.trim();
    if (!trimmed.startsWith('```')) return trimmed;
    const withoutStart = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/u, '');
    return withoutStart.endsWith('```')
        ? withoutStart.slice(0, -3).trim()
        : withoutStart.trim();
}

function extractBalancedObject(raw: string): string | null {
    const input = stripCodeFence(raw);
    const start = input.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < input.length; index += 1) {
        const char = input[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return input.slice(start, index + 1).trim();
            }
        }
    }
    return input.trim().startsWith('{') ? input.trim() : null;
}

function validateStructuredJson(
    content: string | null,
    schema: Record<string, unknown>,
    providerLabel: string
): { ok: true; normalized: string } | { ok: false; error: string } {
    const extracted = content ? extractBalancedObject(content) : null;
    if (!extracted) {
        return { ok: false, error: `${providerLabel} returned no JSON object to validate.` };
    }
    const validation = validateJsonResponse(extracted, schema, providerLabel);
    if (!validation.ok) {
        return {
            ok: false,
            error: validation.error instanceof Error ? validation.error.message : 'Invalid JSON response.'
        };
    }
    return { ok: true, normalized: extracted };
}

export async function runStructuredJsonPipeline(input: {
    providerLabel: string;
    schema: Record<string, unknown>;
    jsonMode: 'response_format' | 'prompt_only';
    maxRetries: number;
    runner: StructuredJsonRunner;
    systemPrompt?: string | null;
    userPrompt: string;
}): Promise<StructuredJsonResult> {
    const initial = await input.runner.run({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        useResponseFormat: input.jsonMode === 'response_format'
    });
    if (initial.error) {
        return {
            ok: false,
            error: initial.error,
            content: initial.content,
            initialContent: initial.content,
            responseData: initial.responseData,
            requestPayload: initial.requestPayload,
            stage: 'initial',
            repairCount: 0
        };
    }

    const validated = validateStructuredJson(initial.content, input.schema, input.providerLabel);
    if (validated.ok) {
        return {
            ok: true,
            content: validated.normalized,
            responseData: initial.responseData,
            requestPayload: initial.requestPayload,
            repairCount: 0
        };
    }

    return {
        ok: false,
        error: validated.error,
        content: initial.content,
        initialContent: initial.content,
        repairedContent: undefined,
        responseData: initial.responseData,
        requestPayload: initial.requestPayload,
        stage: 'initial',
        repairCount: 0
    };
}
