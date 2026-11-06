/*
 * Utility for generating scene content from templates
 */

import { yamlScalar } from './frontmatterText';

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

const inlineValues = (values: string[]): string => values.length <= 1
    ? yamlScalar(values[0] ?? '')
    : `[${values.map(value => JSON.stringify(value)).join(', ')}]`;

const listLines = (values: string[]): string => values.map(value => `  - ${JSON.stringify(value)}`).join('\n');

/**
 * Fill a scene template. Values are written as valid YAML whatever they contain.
 * A placeholder this function does not know resolves to nothing, and a list
 * placeholder with no values leaves no blank line behind.
 */
export function generateSceneContent(template: string, data: SceneCreationData): string {
    const characters = data.characterList?.length ? data.characterList : [data.character].filter(Boolean);
    const places = data.placeList?.length ? data.placeList : [data.place].filter(Boolean);
    const values: Record<string, string> = {
        Act: data.act.toString(),
        When: yamlScalar(data.when),
        Due: data.due ?? '',
        SceneNumber: data.sceneNumber.toString(),
        Subplot: inlineValues(data.subplots),
        SubplotList: listLines(data.subplots),
        Character: inlineValues(characters),
        CharacterList: listLines(characters),
        Place: yamlScalar(data.place),
        PlaceList: listLines(places),
    };
    return template
        .split('\n')
        .filter(line => {
            const onlyPlaceholder = /^\s*{{([^{}\n]+)}}\s*$/.exec(line);
            return !onlyPlaceholder || !!values[onlyPlaceholder[1]];
        })
        .join('\n')
        .replace(/{{([^{}\n]+)}}/g, (_match, name: string) => values[name] ?? '')
        .replace(/[ \t]+$/gm, '');
}
