import { parseYaml } from 'obsidian';
import { normalizeFrontmatterKeys } from '../utils/frontmatter';
import { generateSceneContent } from '../utils/sceneGenerator';

const CLASS_KEY = 'Class';

/**
 * Template keys (other than Class) that the note does not have. A key counts as
 * present under any letter case and under any custom name the author mapped to
 * it, so promotion never adds a duplicate of a property the author renamed.
 */
export function findMissingTemplateKeys(
    templateKeys: string[],
    frontmatter: Record<string, unknown> | undefined,
    mappings: Record<string, string> | undefined
): string[] {
    const present = new Set<string>();
    if (frontmatter) {
        for (const key of Object.keys(frontmatter)) present.add(key.toLowerCase());
        // Built-in aliases apply even without custom mappings.
        for (const key of Object.keys(normalizeFrontmatterKeys(frontmatter, mappings))) present.add(key.toLowerCase());
    }
    return templateKeys.filter(key =>
        key.toLowerCase() !== CLASS_KEY.toLowerCase() && !present.has(key.toLowerCase()));
}

/** The keys a template defines, in template order. */
export function templateKeysOf(template: string): string[] {
    const keys: string[] = [];
    for (const line of template.split('\n')) {
        const match = line.match(/^([^\s#:][^:]*):/);
        if (match) keys.push(match[1].trim());
    }
    return keys;
}

/**
 * The values promotion would insert for the given template, using the note's
 * own Act and the anchor scene's Act and When where the note has none.
 */
export function buildTemplateValues(
    template: string,
    context: { act: number; when: string; due: string }
): Record<string, unknown> {
    const content = generateSceneContent(template, {
        act: context.act,
        when: context.when,
        due: context.due,
        sceneNumber: '',
        subplots: [],
        character: '',
        place: '',
        characterList: [],
        placeList: [],
    });
    const parsed: unknown = parseYaml(content);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

