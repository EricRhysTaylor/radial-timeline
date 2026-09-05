import { classifyProviderError, type AiStatus } from '../api/providerErrors';

export class AIBaseError extends Error {
    aiStatus: AiStatus;
    aiReason?: string;
    provider?: string;

    constructor(message: string, options: { aiStatus: AiStatus; aiReason?: string; provider?: string }) {
        super(message);
        this.name = 'AIBaseError';
        this.aiStatus = options.aiStatus;
        this.aiReason = options.aiReason;
        this.provider = options.provider;
    }
}

export class InvalidKeyError extends AIBaseError {
    constructor(message: string, options: { aiReason?: string; provider?: string }) {
        super(message, { aiStatus: 'auth', aiReason: options.aiReason, provider: options.provider });
        this.name = 'InvalidKeyError';
    }
}

export class RateLimitError extends AIBaseError {
    constructor(message: string, options: { aiReason?: string; provider?: string }) {
        super(message, { aiStatus: 'rate_limit', aiReason: options.aiReason, provider: options.provider });
        this.name = 'RateLimitError';
    }
}

export class ContextTooLongError extends AIBaseError {
    constructor(message: string, options: { aiReason?: string; provider?: string }) {
        super(message, { aiStatus: 'rejected', aiReason: options.aiReason, provider: options.provider });
        this.name = 'ContextTooLongError';
    }
}

export class ProviderUnavailableError extends AIBaseError {
    constructor(message: string, options: { aiReason?: string; provider?: string; status?: AiStatus }) {
        super(message, { aiStatus: options.status ?? 'unavailable', aiReason: options.aiReason, provider: options.provider });
        this.name = 'ProviderUnavailableError';
    }
}

export class MalformedJsonError extends AIBaseError {
    constructor(message: string, options: { aiReason?: string; provider?: string }) {
        super(message, { aiStatus: 'rejected', aiReason: options.aiReason ?? 'invalid_response', provider: options.provider });
        this.name = 'MalformedJsonError';
    }
}

export function mapProviderFailureToError(input: {
    provider?: string;
    error?: unknown;
    aiStatus?: AiStatus;
    aiReason?: string;
}): Error {
    const classification = classifyProviderError({
        error: typeof input.error === 'string' ? input.error : undefined,
        responseData: typeof input.error === 'object' ? input.error : undefined
    });
    const aiStatus = input.aiStatus ?? classification.aiStatus;
    const aiReason = input.aiReason ?? classification.aiReason;
    const message = input.error instanceof Error
        ? input.error.message
        : (typeof input.error === 'string' ? input.error : 'AI request failed.');

    if (aiStatus === 'auth') return new InvalidKeyError(message, { aiReason, provider: input.provider });
    if (aiStatus === 'rate_limit') return new RateLimitError(message, { aiReason, provider: input.provider });
    if (aiReason === 'truncated') return new ContextTooLongError(message, { aiReason, provider: input.provider });
    if (aiStatus === 'timeout' || aiStatus === 'unavailable') {
        return new ProviderUnavailableError(message, { aiReason, provider: input.provider, status: aiStatus });
    }
    if (aiStatus === 'rejected' && aiReason === 'invalid_response') {
        return new MalformedJsonError(message, { aiReason, provider: input.provider });
    }
    return new AIBaseError(message, { aiStatus, aiReason, provider: input.provider });
}

export function mapErrorToUserMessage(error: unknown): string {
    if (error instanceof AIBaseError && error.aiReason === 'spend_cap') {
        return 'Monthly spend cap reached in the Anthropic Console (Limits → Spend limits). Raise the cap or wait for the reset date.';
    }
    if (error instanceof AIBaseError && error.aiReason === 'quota_exceeded') {
        return 'OpenAI API quota exceeded. Add credits or raise your API billing limit in the OpenAI dashboard, then retry.';
    }
    if (error instanceof InvalidKeyError) {
        return 'API key rejected. Open Settings > AI and verify the key for the selected provider.';
    }
    if (error instanceof RateLimitError) {
        return 'Rate limit reached. Try again shortly.';
    }
    if (error instanceof ProviderUnavailableError) {
        return 'Provider unavailable or network blocked. Check connectivity and provider status.';
    }
    if (error instanceof ContextTooLongError) {
        return 'Context too long for the selected model. Reduce corpus size or switch to a model with a larger context window.';
    }
    if (error instanceof MalformedJsonError) {
        return 'Model returned output that did not satisfy the required JSON structure. Retry and open the Inquiry Log for details.';
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'AI request failed.';
}
