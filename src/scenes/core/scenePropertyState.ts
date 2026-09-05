import type { RadialTimelineSettings } from '../../types/settings';
import { buildScenePropertyDefinitions } from '../../sceneProperties/scenePropertyAdapter';
import { resolveScenePropertyPolicy } from '../../sceneProperties/scenePropertyPolicy';
import type { ScenePropertyDefinitions, ScenePropertyPolicy } from '../../sceneProperties/types';

export type AdvancedMode = 'enabled' | 'disabled';

export interface ScenePropertyState {
    hasAdvanced: boolean;
    coreFields: Record<string, unknown>;
    advancedFields: Record<string, unknown>;
}

type ScenePropertyStateParams = {
    frontmatter: Record<string, unknown>;
    settings: RadialTimelineSettings;
    definitions?: ScenePropertyDefinitions;
    policy?: ScenePropertyPolicy;
};

function resolveDefinitions(
    settings: RadialTimelineSettings,
    definitions?: ScenePropertyDefinitions
): ScenePropertyDefinitions {
    return definitions ?? buildScenePropertyDefinitions(settings);
}

export function getAdvancedMode(settings: RadialTimelineSettings): AdvancedMode {
    return resolveScenePropertyPolicy(settings).advancedEnabled ? 'enabled' : 'disabled';
}

export function getScenePropertyState(params: ScenePropertyStateParams): ScenePropertyState {
    const definitions = resolveDefinitions(params.settings, params.definitions);
    const coreKeySet = new Set(definitions.core.map((definition) => definition.key));
    const advancedKeySet = new Set(definitions.advanced.map((definition) => definition.key));
    const coreFields: Record<string, unknown> = {};
    const advancedFields: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params.frontmatter)) {
        if (key === 'position') continue;
        if (key.toLowerCase() === 'id' || coreKeySet.has(key)) {
            coreFields[key] = value;
            continue;
        }
        if (advancedKeySet.has(key)) {
            advancedFields[key] = value;
        }
    }

    return {
        hasAdvanced: Object.keys(advancedFields).length > 0,
        coreFields,
        advancedFields,
    };
}

export function hasAdvancedFields(params: ScenePropertyStateParams): boolean {
    return getScenePropertyState(params).hasAdvanced;
}

export function shouldEnableRemoveAdvanced(params: {
    settings: RadialTimelineSettings;
    scenes: Array<Record<string, unknown>>;
    definitions?: ScenePropertyDefinitions;
}): boolean {
    if (getAdvancedMode(params.settings) === 'enabled') return false;
    const definitions = resolveDefinitions(params.settings, params.definitions);
    return params.scenes.some((frontmatter) => hasAdvancedFields({
        frontmatter,
        settings: params.settings,
        definitions,
    }));
}
