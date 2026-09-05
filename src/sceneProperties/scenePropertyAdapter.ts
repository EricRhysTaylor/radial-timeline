import type { HoverMetadataField, RadialTimelineSettings } from '../types/settings';
import {
    getBaseKeys,
    getCustomKeys,
    getTemplateParts,
    safeParseYaml
} from '../utils/yamlTemplateNormalize';
import type {
    ScenePropertyDefinition,
    ScenePropertyDefinitions,
    SerializedAdvancedSceneProperties,
} from './types';

const DEFAULT_HOVER_ICON = 'align-vertical-space-around';

function buildYamlFromDefinitions(definitions: ScenePropertyDefinition[]): string {
    const lines: string[] = [];
    for (const definition of definitions) {
        if (Array.isArray(definition.defaultValue)) {
            lines.push(`${definition.key}:`);
            for (const value of definition.defaultValue) {
                lines.push(`  - ${value}`);
            }
            continue;
        }
        const value = definition.defaultValue ?? '';
        lines.push(`${definition.key}: ${value}`);
    }
    return lines.join('\n');
}

export function buildScenePropertyDefinitions(
    settings: RadialTimelineSettings
): ScenePropertyDefinitions {
    const parts = getTemplateParts('Scene', settings);
    const hoverByKey = new Map(
        (settings.hoverMetadataFields ?? []).map((field) => [field.key, field])
    );
    const baseDefaults = safeParseYaml(parts.base);
    const advancedDefaults = safeParseYaml(parts.advanced);

    const core = getBaseKeys('Scene', settings).map((key) => ({
        key,
        defaultValue: baseDefaults[key] ?? '',
        required: true,
        source: 'core' as const,
        revealInHover: false,
        hoverLabel: key,
    }));

    const advanced = getCustomKeys('Scene', settings).map((key) => {
        const hover = hoverByKey.get(key);
        return {
            key,
            defaultValue: advancedDefaults[key] ?? '',
            required: false,
            source: 'advanced' as const,
            revealInHover: hover?.enabled ?? false,
            hoverIcon: hover?.icon,
            hoverLabel: hover?.label ?? key,
        };
    });

    return { core, advanced };
}

export function serializeAdvancedSceneProperties(
    advanced: ScenePropertyDefinition[],
    previousHoverMetadataFields: HoverMetadataField[] = []
): SerializedAdvancedSceneProperties {
    const advancedTemplate = buildYamlFromDefinitions(
        advanced.map((definition) => ({ ...definition, source: 'advanced' }))
    );
    const advancedKeySet = new Set(advanced.map((definition) => definition.key));
    const preservedLegacyEntries = previousHoverMetadataFields.filter(
        (field) => !advancedKeySet.has(field.key)
    );
    const advancedHoverEntries: HoverMetadataField[] = advanced.map((definition) => ({
        key: definition.key,
        label: definition.hoverLabel ?? definition.key,
        icon: definition.hoverIcon ?? DEFAULT_HOVER_ICON,
        enabled: definition.revealInHover,
    }));

    return {
        advancedTemplate,
        hoverMetadataFields: [...advancedHoverEntries, ...preservedLegacyEntries],
    };
}

