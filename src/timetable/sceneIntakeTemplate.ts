/*
 * Scene intake
 * ------------
 * Turns an existing note into a scene without disturbing what the author wrote.
 * Every path that brings a note in (Timetable drops, Timeline drops, promotion)
 * ends here, so they all add the same fields as a new scene: the template the
 * settings select, filled by the same generator, placed in template order.
 */

import type { RadialTimelineSettings } from '../types';
import { computeCanonicalOrder, getSceneTemplate } from '../utils/yamlTemplateNormalize';
import { splitTemplateFields } from '../utils/templateMerge';
import { authorKeyFromMappings, canonicalizeFrontmatterKey, findMissingTemplateKeys, getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { formatLocalDateKey } from '../utils/date';
import { generateSceneContent } from '../utils/sceneGenerator';
import { generateSceneId } from '../utils/sceneIds';
import { applyFrontmatterEdits, frontmatterValues, insertFieldEdits, isBlankFrontmatterValue, readFrontmatterText, replaceValueEdit, yamlKey, type FrontmatterField, type FrontmatterText, type TextEdit } from '../utils/frontmatterText';
import { reorderFrontmatterContent } from '../utils/yamlManager';
import { buildScenePropertyDefinitions } from '../sceneProperties/scenePropertyAdapter';
import { resolveSceneExpectedKeys, resolveScenePropertyPolicy, sceneDynamicKeys } from '../sceneProperties/scenePropertyPolicy';
import { t } from '../i18n';

export interface SceneIntakeContext {
    /** Include Advanced fields. Defaults to the setting. */
    advanced?: boolean;
    /** Act for a note that has none, from the scene it follows. */
    act?: number;
    /** When for a note that has none, from the scene it follows. */
    when?: string;
    /** Add each missing field empty instead of with its template default. */
    blank?: boolean;
}

function findField(text: FrontmatterText, canonical: string, mappings: Record<string, string> | undefined): FrontmatterField | undefined {
    return text.fields.find(field => canonicalizeFrontmatterKey(field.key, mappings) === canonical);
}

function hasDuplicateProperty(text: FrontmatterText, mappings: Record<string, string> | undefined): boolean {
    const keys = text.fields.map(field => canonicalizeFrontmatterKey(field.key, mappings).toLowerCase());
    return new Set(keys).size !== keys.length;
}

/**
 * Finish a scene written by manuscript import: the configured fields it lacks,
 * left empty, and everything in template order so it arrives with nothing for
 * the audit to flag. Empty because import never invents a Duration or a Due. A
 * note carrying one property twice (`status` beside `Status`, from its source)
 * keeps both and keeps its order: which one the author meant is theirs to say.
 */
export function completeImportedScene(content: string, settings: RadialTimelineSettings): string {
    const filled = addSceneIntakeTemplate(content, settings, { blank: true });
    const mappings = getActiveFrontmatterMappings(settings);
    const text = readFrontmatterText(filled);
    if (!text || hasDuplicateProperty(text, mappings)) return filled;
    const expected = resolveSceneExpectedKeys(settings, buildScenePropertyDefinitions(settings), resolveScenePropertyPolicy(settings));
    return reorderFrontmatterContent(filled, expected.canonicalOrder, sceneDynamicKeys(settings, expected), mappings);
}

/** Add missing configured scene fields without reserializing the original note. */
export function addSceneIntakeTemplate(content: string, settings: RadialTimelineSettings, context: SceneIntakeContext = {}): string {
    const text = readFrontmatterText(content);
    if (!text) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const mappings = getActiveFrontmatterMappings(settings);
    const frontmatter = frontmatterValues(text);
    if (!context.blank && hasDuplicateProperty(text, mappings)) throw new Error(t('ui.timetable.noteDropInvalidYaml'));

    const normalized = normalizeFrontmatterKeys(frontmatter, mappings);
    const noteAct = Number(normalized.Act);
    const rendered = generateSceneContent(getSceneTemplate(settings, context.advanced), {
        act: Number.isFinite(noteAct) && noteAct > 0 ? noteAct : context.act ?? 1,
        when: typeof normalized.When === 'string' ? normalized.When : context.when ?? '',
        due: formatLocalDateKey(),
        sceneNumber: '',
        subplots: [],
        character: '',
        place: '',
    });

    const edits: TextEdit[] = [];
    const idField = findField(text, 'ID', mappings);
    if (idField && isBlankFrontmatterValue(idField.value)) edits.push(replaceValueEdit(text, idField, generateSceneId()));

    const templateFields = splitTemplateFields(rendered);
    const missing = new Set(findMissingTemplateKeys(templateFields.map(field => field.key), frontmatter, mappings));
    const additions = templateFields
        .filter(field => missing.has(field.key) && field.key.toLowerCase() !== 'id')
        .map(field => {
            const author = authorKeyFromMappings(field.key, mappings);
            return { key: field.key, lines: yamlKey(author) + (context.blank ? ':' : field.rest) };
        });
    if (!idField) additions.unshift({ key: 'ID', lines: `ID: ${generateSceneId()}` });

    edits.push(...insertFieldEdits(text, additions, {
        order: computeCanonicalOrder('Scene', settings),
        canonicalOf: key => canonicalizeFrontmatterKey(key, mappings),
    }));
    return applyFrontmatterEdits(text, edits);
}

/** Promote without reserializing unrelated frontmatter or the note body. */
export function promoteSceneContent(content: string, settings: RadialTimelineSettings, context: SceneIntakeContext & { expectedSketch?: boolean }): string {
    const text = readFrontmatterText(content);
    if (!text) {
        if (context.expectedSketch) throw new Error(t('ui.timetable.timelineDropChanged'));
        return addSceneIntakeTemplate(`---\nClass: Scene\n---\n\n${content}`, settings, context);
    }
    const mappings = getActiveFrontmatterMappings(settings);
    const classField = findField(text, 'Class', mappings);
    const blankClass = !classField || isBlankFrontmatterValue(classField.value);
    if (context.expectedSketch !== undefined && context.expectedSketch === blankClass) throw new Error(t('ui.timetable.timelineDropChanged'));

    const edits: TextEdit[] = [];
    if (!classField) {
        edits.push({ start: 0, end: 0, text: `${yamlKey(authorKeyFromMappings('Class', mappings))}: Scene${text.newline}` });
    } else {
        if (!blankClass) {
            const value = Array.isArray(classField.value) && classField.value.length === 1 ? classField.value[0] as unknown : classField.value;
            if (typeof value !== 'string' || value.trim().toLowerCase() !== 'sketch') throw new Error(t('ui.timetable.timelineDropChanged'));
        }
        edits.push(replaceValueEdit(text, classField, 'Scene'));
    }
    return addSceneIntakeTemplate(applyFrontmatterEdits(text, edits), settings, context);
}
