import type RadialTimelinePlugin from '../main';
import type { AiSettingsV1 } from './types';

export type ActiveRoleTemplate = {
    id: string;
    name: string;
    prompt: string;
};

export function resolveActiveRoleTemplate(
    _plugin: RadialTimelinePlugin,
    aiSettings: AiSettingsV1
): ActiveRoleTemplate {
    const templates = aiSettings.roleTemplates || [];
    const preferredId = (aiSettings.roleTemplateId || '').trim();
    const selected = templates.find(entry => entry.id === preferredId) || templates[0];
    if (selected) {
        return {
            id: selected.id,
            name: selected.name || selected.id || 'Role Template',
            prompt: selected.prompt || 'You are an editorial analysis assistant.'
        };
    }
    return {
        id: 'default',
        name: 'Default Role Template',
        prompt: 'You are an editorial analysis assistant.'
    };
}

/**
 * Feature-named neutral scoring template. Used when AIRunRequest.bypassRoleTemplate
 * is true so technical scoring (Gossamer, etc.) is not biased by the user's
 * normal writing-assist persona. Surfaces in logs as e.g. "Gossamer Neutral
 * Scoring" so the audit trail shows the bypass plainly.
 */
export function buildNeutralRoleTemplate(feature: string): ActiveRoleTemplate {
    const featureLabel = feature.trim() || 'AI';
    return {
        id: `neutral:${featureLabel.toLowerCase()}`,
        name: `${featureLabel} Neutral Scoring`,
        prompt:
            `You are performing the ${featureLabel} task. ` +
            `Score or analyze using only the provided manuscript/inputs and the explicit task rubric. ` +
            `Do not optimize for genre, style, commercial appeal, or any external editorial preference. ` +
            `Output exactly the structured schema requested — no commentary, no editorial framing.`
    };
}
