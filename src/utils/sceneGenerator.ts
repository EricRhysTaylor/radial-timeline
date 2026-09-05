/* global __RT_DEV__ -- build-time flags injected by esbuild define; see esbuild.config.mjs */
/*
 * Utility for generating scene content from templates
 */

import { mergeTemplateParts } from './templateMerge';

/**
 * @deprecated Use getTemplateParts().merged (yamlTemplateNormalize.ts).
 */
export function mergeTemplates(baseTemplate: string, advancedFields: string): string {
    if (__RT_DEV__) {
        console.warn('[Sanitation] Deprecated template merge helper called. Use getTemplateParts().');
    }
    return mergeTemplateParts(baseTemplate, advancedFields);
}

export interface SceneCreationData {
    act: number;
    when: string;
    due?: string;
    sceneNumber: number | string;
    subplots: string[];
    character: string;
    place: string;
    characterList?: string[];
    placeList?: string[];
}

/**
 * Generates the content of a scene note by replacing placeholders in the template.
 * @param template The template string with {{Placeholders}}
 * @param data Data to populate the template
 * @returns The final note content
 */
export function generateSceneContent(template: string, data: SceneCreationData): string {
    let content = template;

    // Helper to escape characters for YAML if needed, though strictly we might just paste
    // For now, simple string replacement

    // {{Act}}
    content = content.replace(/{{Act}}/g, data.act.toString());

    // {{When}}
    content = content.replace(/{{When}}/g, data.when);

    // {{Due}}
    content = content.replace(/{{Due}}/g, data.due ?? data.when);

    // {{SceneNumber}}
    content = content.replace(/{{SceneNumber}}/g, data.sceneNumber.toString());

    // {{Subplot}} - inline YAML (string for 1, array for >1)
    const yamlEscapeDoubleQuoted = (value: string) =>
        value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const yamlInlineArray = (values: string[]) =>
        `[${values.map(v => `"${yamlEscapeDoubleQuoted(v)}"`).join(', ')}]`;
    const subplotInline =
        data.subplots.length <= 1 ? (data.subplots[0] ?? '') : yamlInlineArray(data.subplots);
    content = content.replace(/{{Subplot}}/g, subplotInline);

    // {{SubplotList}} - YAML array format
    // Indent with 2 spaces for nested list
    const subplotListString = data.subplots.map(s => `  - "${s}"`).join('\n');
    content = content.replace(/{{SubplotList}}/g, subplotListString);

    // {{Character}}
    content = content.replace(/{{Character}}/g, data.character);

    // {{Place}}
    content = content.replace(/{{Place}}/g, data.place);

    // {{CharacterList}} - YAML array format (list)
    const characterListString = (data.characterList && data.characterList.length > 0
        ? data.characterList
        : [data.character].filter(Boolean)
    ).map(c => `  - "${c}"`).join('\n');
    content = content.replace(/{{CharacterList}}/g, characterListString);

    // {{PlaceList}} - YAML array format (list)
    const placeListString = (data.placeList && data.placeList.length > 0
        ? data.placeList
        : [data.place].filter(Boolean)
    ).map(p => `  - "${p}"`).join('\n');
    content = content.replace(/{{PlaceList}}/g, placeListString);

    return content;
}
