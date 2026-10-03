/** Delimiter injected before volatile question section for provider prompt caching (Anthropic, Gemini, OpenAI). */
export const CACHE_BREAK_DELIMITER = '<<<CACHE_BREAK>>>';

export interface CacheBreakSplit {
    /** Everything before the delimiter: the reusable prefix the provider caches. */
    stable: string;
    /** Everything after the delimiter: the per-call text sent after the cache point. */
    volatile: string;
}

/**
 * The one place a provider adapter splits a composed user prompt at the cache
 * break. Returns null when the prompt carries no delimiter (or nothing precedes
 * it). The delimiter itself is internal: it never reaches a model.
 */
export function splitAtCacheBreak(userPrompt: string): CacheBreakSplit | null {
    const delimIndex = userPrompt.indexOf(CACHE_BREAK_DELIMITER);
    if (delimIndex <= 0) return null;
    return {
        stable: userPrompt.slice(0, delimIndex).trimEnd(),
        volatile: userPrompt.slice(delimIndex + CACHE_BREAK_DELIMITER.length).trimStart()
    };
}

export interface EnvelopeInput {
    roleTemplateName: string;
    roleTemplateText: string;
    projectContext: string;
    featureModeInstructions: string;
    userInput: string;
    userQuestion?: string;
    outputRules: string;
    placeUserQuestionLast?: boolean;
    /** When set, inserted before the volatile question section so the provider adapter can split stable/volatile content. */
    cacheBreakDelimiter?: string;
}

export interface ComposedEnvelope {
    systemPrompt: string;
    userPrompt: string;
    finalPrompt: string;
}

function section(title: string, body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return `${title}:\n(none)`;
    return `${title}:\n${trimmed}`;
}

export function composeEnvelope(input: EnvelopeInput): ComposedEnvelope {
    const parts: string[] = [];
    parts.push(section('Project Context', input.projectContext));
    parts.push(section('Feature Mode Instructions', input.featureModeInstructions));

    const includeQuestion = typeof input.userQuestion === 'string' && input.userQuestion.trim().length > 0;
    const userInputBody = includeQuestion
        ? input.userInput
        : (input.userInput || input.userQuestion || '');
    parts.push(section('User Input', userInputBody));

    if (input.placeUserQuestionLast && includeQuestion) {
        parts.push(section('Output Schema / Formatting Rules', input.outputRules));
        if (input.cacheBreakDelimiter) {
            parts.push(input.cacheBreakDelimiter);
        }
        parts.push(section('User Question (highest priority)', input.userQuestion || ''));
    } else {
        if (includeQuestion) {
            parts.push(section('User Question (highest priority)', input.userQuestion || ''));
        }
        parts.push(section('Output Schema / Formatting Rules', input.outputRules));
    }

    const systemPrompt = section(
        'System Role Template',
        `Template: ${input.roleTemplateName}\n${input.roleTemplateText}`
    );
    const userPrompt = parts.join('\n\n');
    return {
        systemPrompt,
        userPrompt,
        finalPrompt: `${systemPrompt}\n\n${userPrompt}`
    };
}
