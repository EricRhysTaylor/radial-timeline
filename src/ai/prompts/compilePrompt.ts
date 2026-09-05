import { PROMPT_TEMPLATES } from './templates';

export interface CompiledPrompt {
    systemPrompt?: string;
    userPrompt: string;
}

export function compilePrompt(
    templateId: string,
    vars: Record<string, unknown>
): CompiledPrompt {
    const template = PROMPT_TEMPLATES[templateId];
    if (!template) {
        return {
            systemPrompt: typeof vars.systemPrompt === 'string' ? vars.systemPrompt : undefined,
            userPrompt: typeof vars.userPrompt === 'string' ? vars.userPrompt : ''
        };
    }
    return template(vars);
}
