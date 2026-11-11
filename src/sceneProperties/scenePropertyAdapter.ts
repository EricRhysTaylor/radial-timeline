import type { HoverMetadataField, RadialTimelineSettings } from '../types/settings';
import {
    getBaseKeys,
    getCustomKeys,
    getTemplateParts,
    safeParseYaml,
    type FieldEntryValue
} from '../utils/yamlTemplateNormalize';
import { splitTemplateFields, templateFieldKey } from '../utils/templateMerge';
import { formatYamlField, yamlKey } from '../utils/frontmatterText';
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

/** One row of the Advanced editor. `lines` is the template text it writes back. */
export interface AdvancedTemplateEntry {
    key: string;
    value: FieldEntryValue;
    lines: string;
}

/** The Advanced template as editor rows. Rows keep their template text, comments and placeholders included. */
export function parseAdvancedEntries(template: string): AdvancedTemplateEntry[] {
    return splitTemplateFields(template).map(({ key, lines }) => ({
        key,
        value: safeParseYaml(lines)[key] ?? '', // SAFE: a property with no value parses to undefined; it reads as empty
        lines,
    }));
}

/** Write rows back. Rows the author did not edit are byte-for-byte what they were. */
export function serializeAdvancedEntries(entries: AdvancedTemplateEntry[]): string {
    return entries.map(entry => entry.lines).join('\n');
}

/** A row with a new value, written as valid YAML whatever the author typed. */
export function withEntryValue(entry: AdvancedTemplateEntry, value: FieldEntryValue): AdvancedTemplateEntry {
    return { ...entry, value, lines: formatYamlField(entry.key, value) };
}

/** A row under a new name; its value and comment stay as written. */
export function withEntryKey(entry: AdvancedTemplateEntry, key: string): AdvancedTemplateEntry {
    return { ...entry, key, lines: yamlKey(key) + splitTemplateFields(entry.lines)[0].rest };
}

export function newAdvancedEntry(key: string, value: string): AdvancedTemplateEntry {
    return { key, value, lines: formatYamlField(key, value) };
}

/** Whether a name can be a YAML property the rest of the plugin will read back. */
export function isValidPropertyName(key: string): boolean {
    return !key.includes('{{')
        && templateFieldKey(`${key}:`) === key
        && templateFieldKey(`${yamlKey(key)}:`) === key;
}
