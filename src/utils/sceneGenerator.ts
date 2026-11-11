/*
 * Utility for generating scene content from templates
 */

import { yamlScalar } from './frontmatterText';
import { templateValueStart } from './templateMerge';

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

const PLACEHOLDER = /{{([^{}\n]+)}}/g;

const inlineValues = (values: string[]): string => values.length <= 1
    ? yamlScalar(values[0] ?? '') // SAFE: an empty list writes an empty value
    : `[${values.map(value => JSON.stringify(value)).join(', ')}]`;

const listLines = (values: string[]): string => values.map(value => `  - ${JSON.stringify(value)}`).join('\n');

interface PlaceholderValues {
    /** Each placeholder as plain text. */
    text: Record<string, string>;
    /** What a placeholder writes when it is the entire value, where that is more than quoted text. */
    whole: Record<string, string>;
}

/**
 * Fill one YAML value. What a placeholder may write depends on where it sits:
 * text inside quotes is escaped for those quotes, a list element is quoted on
 * its own, and a plain value is quoted as a whole once its text is known.
 */
function fillValue(value: string, { text, whole }: PlaceholderValues): string {
    if (!value.includes('{{')) return value;
    const textOf = (_match: string, name: string): string => text[name] ?? ''; // SAFE: a placeholder with no value writes an empty field, never the placeholder
    const quoted = /^(["'])(.*?)\1(\s+#.*)?$/.exec(value);
    if (quoted) {
        const [, quote, body, comment = ''] = quoted;
        const escape = quote === '"'
            ? (item: string) => JSON.stringify(item).slice(1, -1)
            : (item: string) => item.replace(/'/g, "''");
        return quote + body.replace(PLACEHOLDER, (match, name: string) => escape(textOf(match, name))) + quote + comment.replace(PLACEHOLDER, '');
    }
    const [, body, comment = ''] = /^(.*?)(\s+#.*)?$/.exec(value) ?? []; // SAFE: the pattern matches any line; the types say exec can return null
    const tail = comment.replace(PLACEHOLDER, '');
    const only = /^{{([^{}\n]+)}}$/.exec(body)?.[1];
    if (only !== undefined) return (whole[only] ?? yamlScalar(text[only] ?? '')) + tail; // SAFE: a placeholder with no value writes an empty field, never the placeholder
    if (body.startsWith('[')) {
        return body.replace(/(["']?){{([^{}\n]+)}}\1/g, (_match, _quote, name: string) => JSON.stringify(text[name] ?? '')) + tail; // SAFE: a placeholder with no value writes an empty field, never the placeholder
    }
    return yamlScalar(body.replace(PLACEHOLDER, textOf)) + tail;
}

/**
 * Fill a scene template. Values are written as valid YAML whatever they contain
 * and wherever the template puts them. A placeholder this function does not
 * know resolves to nothing, and a list placeholder with no values leaves no
 * blank line behind.
 */
export function generateSceneContent(template: string, data: SceneCreationData): string {
    const characters = data.characterList?.length ? data.characterList : [data.character].filter(Boolean);
    const places = data.placeList?.length ? data.placeList : [data.place].filter(Boolean);
    const values: PlaceholderValues = {
        text: {
            Act: data.act.toString(),
            When: data.when,
            Due: data.due ?? '', // SAFE: a scene created without a due date leaves Due empty
            SceneNumber: data.sceneNumber.toString(),
            Subplot: data.subplots.join(', '),
            Character: characters.join(', '),
            Place: data.place,
        },
        whole: {
            Act: data.act.toString(),
            SceneNumber: data.sceneNumber.toString(),
            Subplot: inlineValues(data.subplots),
            Character: inlineValues(characters),
        },
    };
    const lists: Record<string, string> = {
        SubplotList: listLines(data.subplots),
        CharacterList: listLines(characters),
        PlaceList: listLines(places),
    };
    return template
        // Keep an empty canonical character list a list, including in the
        // merged Advanced template. Do not alter author-written values.
        .replace(/^(Character\s*:)\s*\n[ \t]*{{CharacterList}}[ \t]*$/gm,
            characters.length ? '$1\n{{CharacterList}}' : '$1 []')
        .split('\n')
        .flatMap(line => {
            // A bare Character field is always a list; keep other uses of the
            // same placeholder (such as a custom text field) unchanged.
            const characterField = /^(\s*Character\s*:\s*){{Character}}(\s*(?:#.*)?)$/.exec(line);
            if (characterField) return [`${characterField[1]}[${characters.map(value => JSON.stringify(value)).join(', ')}]${characterField[2]}`];
            const alone = /^\s*{{([^{}\n]+)}}\s*$/.exec(line)?.[1];
            if (alone !== undefined) {
                const filled = lists[alone] ?? values.text[alone];
                return filled ? [filled] : [];
            }
            const valueStart = /^\s*-\s+/.exec(line)?.[0].length ?? templateValueStart(line);
            if (valueStart === null) return [line.replace(PLACEHOLDER, (_match, name: string) => values.text[name] ?? '')]; // SAFE: a placeholder with no value writes an empty field, never the placeholder
            return [line.slice(0, valueStart) + fillValue(line.slice(valueStart), values)];
        })
        .join('\n')
        .replace(/[ \t]+$/gm, '');
}
