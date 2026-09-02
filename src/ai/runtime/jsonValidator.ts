import { MalformedJsonError } from '../errors';
import { unwrapStructuredEnvelope } from '../structuredResponseUnwrap';

export interface JsonValidationResult<T = unknown> {
    ok: boolean;
    parsed?: T;
    error?: Error;
    normalizedRaw?: string;
    normalizationWarnings?: string[];
}

function getRequired(schema?: Record<string, unknown>): string[] {
    if (!schema) return [];
    const required = schema.required;
    if (!Array.isArray(required)) return [];
    return required.filter((item): item is string => typeof item === 'string');
}

/**
 * Pull the JSON payload out of a model response.
 *
 * Anthropic's text-mode JSON path (used when citations are enabled — citations
 * are incompatible with forced tool_use) sometimes returns the JSON wrapped in
 * a markdown code fence or with a leading "Here is the JSON:" line. The legacy
 * tool_use path always returned bare JSON, so this function is a no-op for it.
 *
 * Strategy:
 *   1. Strip a fenced ```json … ``` block if present (use its inner contents).
 *   2. Otherwise slice from the first `{` to the last `}` — handles both
 *      bare JSON and JSON with leading/trailing prose.
 *   3. Fall back to the raw string for the parser to surface the original error.
 */
function extractJsonPayload(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
}

export function validateJsonResponse<T = unknown>(
    raw: string,
    schema?: Record<string, unknown>,
    provider?: string
): JsonValidationResult<T> {
    const payload = extractJsonPayload(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: new MalformedJsonError(`Invalid JSON: ${message}`, { provider })
        };
    }

    const requiredKeys = getRequired(schema);
    if (requiredKeys.length && parsed && typeof parsed === 'object') {
        const unwrapWarnings: string[] = [];
        const unwrap = unwrapStructuredEnvelope(parsed, requiredKeys, {
            onUnwrap: key => {
                unwrapWarnings.push(`Unwrapped structured response envelope key "${key}" before JSON schema validation`);
            }
        });
        parsed = unwrap.value;

        const record = parsed as Record<string, unknown>;
        const missing = requiredKeys.filter(key => !(key in record));
        if (missing.length) {
            return {
                ok: false,
                error: new MalformedJsonError(`JSON missing required keys: ${missing.join(', ')}`, { provider })
            };
        }
        if (unwrap.unwrappedKey) {
            return {
                ok: true,
                parsed: parsed as T,
                normalizedRaw: JSON.stringify(parsed),
                normalizationWarnings: unwrapWarnings
            };
        }
    }

    return { ok: true, parsed: parsed as T };
}
