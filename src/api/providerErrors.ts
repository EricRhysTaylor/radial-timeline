// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.
export type AiStatus = 'success' | 'rejected' | 'unavailable' | 'timeout' | 'auth' | 'rate_limit';

export interface ProviderErrorClassification {
    aiStatus: AiStatus;
    aiReason?: string;
}

type ErrorEnvelope = {
    error?: string;
    message?: string;
    responseData?: unknown;
    status?: number;
};

const extractStatus = (input: ErrorEnvelope): number | null => {
    if (typeof input.status === 'number') return input.status;
    const responseData = input.responseData as Record<string, unknown> | undefined;
    const nestedError = responseData?.error;
    const nestedStatus = typeof nestedError === 'object' && nestedError !== null
        ? (nestedError as Record<string, unknown>).status
        : undefined;
    const status = responseData?.status ?? nestedStatus;
    return typeof status === 'number' ? status : null;
};

const extractMessage = (err: unknown): string => {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (typeof err === 'object') {
        const record = err as Record<string, unknown>;
        if (typeof record.error === 'string') return record.error;
        if (typeof record.message === 'string') return record.message;
        if (typeof record.responseData === 'object' && record.responseData) {
            const response = record.responseData as Record<string, unknown>;
            const responseError = response.error as Record<string, unknown> | undefined;
            if (responseError && typeof responseError.message === 'string') {
                return responseError.message;
            }
            if (typeof response.message === 'string') return response.message;
        }
    }
    return '';
};

const isUnsupportedParamMessage = (normalized: string): boolean => {
    if (!normalized) return false;
    if (normalized.includes('only accepts its default temperature')) return true;

    const hasUnsupported = /(unsupported|unrecognized|unknown|invalid)/.test(normalized);
    const hasParamWord = /(parameter|field|argument|value)/.test(normalized);
    const mentionsParam = /(temperature|top_p|top p|response_format|response schema|response_schema|json_schema|json mode)/.test(normalized);

    if (hasUnsupported && (hasParamWord || mentionsParam)) return true;
    if (mentionsParam && normalized.includes('not supported')) return true;
    return false;
};

const isTruncationMessage = (normalized: string): boolean => {
    if (!normalized) return false;
    if (normalized.includes('truncated')) return true;
    if (normalized.includes('max tokens') || normalized.includes('maximum token')) return true;
    if (normalized.includes('maximum context') || normalized.includes('context length')) return true;
    if (normalized.includes('token limit') || normalized.includes('too many tokens')) return true;
    if (normalized.includes('length exceeded')) return true;
    return false;
};

// Anthropic returns this exact phrasing when the author's self-configured monthly
// spend cap (Console → Limits → Spend limits) is hit. It is NOT an Anthropic-side
// tier rate limit; surfacing it as "rate_limit" panics authors who have Tier 4 keys.
const isSpendCapMessage = (normalized: string): boolean => {
    if (!normalized) return false;
    if (normalized.includes('specified api usage limits')) return true;
    if (normalized.includes('reached your specified') && normalized.includes('usage limit')) return true;
    return false;
};

const isQuotaExceededMessage = (normalized: string): boolean => {
    if (!normalized) return false;
    if (normalized.includes('insufficient_quota')) return true;
    if (normalized.includes('exceeded your current quota')) return true;
    if (normalized.includes('check your plan and billing')) return true;
    if (normalized.includes('quota') && normalized.includes('billing')) return true;
    if (normalized.includes('quota') && normalized.includes('credits')) return true;
    return false;
};

const RATE_LIMIT_MARKERS = ['rate limit', 'too many requests', 'overloaded'] as const;
const AUTH_MARKERS = ['unauthorized', 'authentication', 'invalid api key', 'api key', 'permission'] as const;
const TIMEOUT_MARKERS = ['timeout', 'timed out', 'deadline exceeded', 'etimedout', 'econnaborted'] as const;

const includesAnyMarker = (normalized: string, markers: readonly string[]): boolean =>
    markers.some(marker => normalized.includes(marker));

export function classifyProviderError(err: unknown): ProviderErrorClassification {
    const envelope: ErrorEnvelope = typeof err === 'object' && err !== null
        ? err
        : { error: typeof err === 'string' ? err : undefined };

    const message = extractMessage(err);
    const normalized = message.toLowerCase();
    const status = extractStatus(envelope);

    if (isSpendCapMessage(normalized)) {
        return { aiStatus: 'rejected', aiReason: 'spend_cap' };
    }

    if (isQuotaExceededMessage(normalized)) {
        return { aiStatus: 'rejected', aiReason: 'quota_exceeded' };
    }

    if (status === 429 || includesAnyMarker(normalized, RATE_LIMIT_MARKERS)) {
        return { aiStatus: 'rate_limit' };
    }

    if (status === 401 || status === 403 || includesAnyMarker(normalized, AUTH_MARKERS)) {
        return { aiStatus: 'auth' };
    }

    if (status === 408 || status === 504 || includesAnyMarker(normalized, TIMEOUT_MARKERS)) {
        return { aiStatus: 'timeout' };
    }

    if (status !== null && status >= 500) {
        return { aiStatus: 'unavailable' };
    }

    if (normalized.includes('connection refused') || normalized.includes('network') ||
        normalized.includes('could not connect') || normalized.includes('enotfound') || normalized.includes('econnrefused')) {
        return { aiStatus: 'unavailable' };
    }

    if (isUnsupportedParamMessage(normalized)) {
        return { aiStatus: 'rejected', aiReason: 'unsupported_param' };
    }

    if (isTruncationMessage(normalized)) {
        return { aiStatus: 'rejected', aiReason: 'truncated' };
    }

    return { aiStatus: 'rejected' };
}
