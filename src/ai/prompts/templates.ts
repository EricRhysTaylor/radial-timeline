export type PromptTemplateRenderer = (vars: Record<string, unknown>) => { systemPrompt?: string; userPrompt: string };

const toText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return ''; // SAFE: unserializable template var (circular reference/BigInt) renders as an empty string, matching how toText treats every other non-textual value
        }
    }
    return '';
};

export const PROMPT_TEMPLATES: Record<string, PromptTemplateRenderer> = {
    'inquiry.default': (vars) => ({
        systemPrompt: toText(vars.systemPrompt),
        userPrompt: toText(vars.userPrompt)
    }),
    'inquiry.omnibus': (vars) => ({
        systemPrompt: toText(vars.systemPrompt),
        userPrompt: toText(vars.userPrompt)
    }),
    'generic.text': (vars) => ({
        systemPrompt: toText(vars.systemPrompt),
        userPrompt: toText(vars.userPrompt)
    })
};
