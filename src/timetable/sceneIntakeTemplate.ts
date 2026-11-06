import { stringifyYaml } from 'obsidian';
import type { RadialTimelineSettings } from '../types';
import { getTemplateParts } from '../utils/yamlTemplateNormalize';
import { canonicalizeFrontmatterKey, getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { formatLocalDateKey } from '../utils/date';
import { buildTemplateValues, findMissingTemplateKeys, templateKeysOf } from '../services/sceneTemplateFields';
import { generateSceneId } from '../utils/sceneIds';
import { isMap, isScalar, parseDocument } from 'yaml';
import { SKETCH_AFTER_SCENE, SKETCH_ORDER } from './sketchPlacementFields';
import { t } from '../i18n';

/** Add missing configured scene fields without reserializing the original note. */
export function addSceneIntakeTemplate(content: string, settings: RadialTimelineSettings, context?: { advanced?: boolean; act?: number; when?: string }): string {
    const start = content.match(/^---\s*\r?\n/);
    if (!start) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const tail = content.slice(start[0].length);
    const end = /^---\s*$/m.exec(tail);
    if (!end) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    let raw = tail.slice(0, end.index);
    const document = parseDocument(raw);
    if (document.errors.length || !isMap(document.contents) || document.contents.flow) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const parsed: unknown = document.toJS();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const fm = parsed as Record<string, unknown>;
    const mappings = getActiveFrontmatterMappings(settings);
    const keys = Object.keys(fm).map(key => canonicalizeFrontmatterKey(key, mappings).toLowerCase());
    if (new Set(keys).size !== keys.length) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const normalized = normalizeFrontmatterKeys(fm, mappings);
    const parts = getTemplateParts('Scene', settings);
    const template = (context?.advanced ?? settings.sceneAdvancedPropertiesEnabled ?? true) ? parts.merged : parts.base;
    const act = Number(normalized.Act);
    const when = typeof normalized.When === 'string' ? normalized.When : context?.when ?? '';
    const values = buildTemplateValues(template, { act: Number.isFinite(act) && act > 0 ? act : context?.act ?? 1, when, due: formatLocalDateKey() });
    const additions: Record<string, unknown> = {};
    const idKey = Object.keys(normalized).find(key => key.toLowerCase() === 'id');
    if (!idKey) additions.ID = generateSceneId();
    else if (normalized[idKey] === null || normalized[idKey] === '') {
        const idPair = document.contents.items.find(pair => isScalar(pair.key) && typeof pair.key.value === 'string' && canonicalizeFrontmatterKey(pair.key.value, mappings).toLowerCase() === 'id');
        const value = idPair?.value;
        if (!isScalar(value) || !value.range || value.anchor) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
        const space = value.range[0] === value.range[1] && raw[value.range[0] - 1] === ':' ? ' ' : '';
        const commentSpace = raw[value.range[1]] === '#' ? ' ' : '';
        raw = raw.slice(0, value.range[0]) + space + generateSceneId() + commentSpace + raw.slice(value.range[1]);
    }
    for (const key of findMissingTemplateKeys(templateKeysOf(template), fm, mappings)) {
        const value = values[key];
        const authorKey = Object.entries(mappings ?? {}).find(([, canonical]) => canonical === key)?.[0] ?? key;
        additions[authorKey] = value === undefined || value === '' ? null : value;
    }
    if (!Object.keys(additions).length) return start[0] + raw + tail.slice(end.index);
    const newline = start[0].endsWith('\r\n') ? '\r\n' : '\n';
    const serialized = stringifyYaml(additions).replace(/\r?\n/g, newline);
    const added = serialized.endsWith(newline) ? serialized : serialized + newline;
    return start[0] + added + raw + tail.slice(end.index);
}

/** Promote without reserializing unrelated frontmatter or the note body. */
export function promoteSceneContent(content: string, settings: RadialTimelineSettings, context: { advanced: boolean; act: number; when: string; expectedSketch?: boolean }): string {
    const start = content.match(/^---\s*\r?\n/);
    if (!start) {
        if (context.expectedSketch) throw new Error(t('ui.timetable.timelineDropChanged'));
        return addSceneIntakeTemplate(`---\nClass: Scene\n---\n\n${content}`, settings, context);
    }
    const newline = start[0].endsWith('\r\n') ? '\r\n' : '\n';
    const tail = content.slice(start[0].length);
    const end = /^---\s*$/m.exec(tail);
    if (!end) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const raw = tail.slice(0, end.index);
    const doc = parseDocument(raw);
    if (doc.errors.length || (doc.contents && !isMap(doc.contents))) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    if (isMap(doc.contents) && doc.contents.flow) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
    const edits: Array<{ start: number; end: number; value: string }> = [];
    let hasClass = false;
    if (isMap(doc.contents)) for (const pair of doc.contents.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
        const key = pair.key.value.toLowerCase();
        if (key === 'class') {
            if (hasClass || !pair.value?.range) throw new Error(t('ui.timetable.timelineDropChanged'));
            hasClass = true;
            const value = isScalar(pair.value) ? pair.value.value : pair.value.toJSON();
            const name = Array.isArray(value) && value.length === 1 ? value[0] : value;
            if (typeof name !== 'string' || name.trim().toLowerCase() !== 'sketch') throw new Error(t('ui.timetable.timelineDropChanged'));
            if ('anchor' in pair.value && pair.value.anchor) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
            edits.push({ start: pair.value.range[0], end: pair.value.range[1], value: 'Scene' });
        }
    }
    if (context.expectedSketch !== undefined && hasClass !== context.expectedSketch) throw new Error(t('ui.timetable.timelineDropChanged'));
    if (hasClass && isMap(doc.contents)) for (const pair of doc.contents.items) {
        if (isScalar(pair.key) && typeof pair.key.value === 'string' && [SKETCH_AFTER_SCENE.toLowerCase(), SKETCH_ORDER.toLowerCase()].includes(pair.key.value.toLowerCase())) {
            if (!pair.key.range || !pair.value?.range || ('anchor' in pair.value && pair.value.anchor)) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
            if (/(?:^|[\s\[{,])&[\w-]+/.test(raw.slice(pair.value.range[0], pair.value.range[1]))) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
            edits.push({ start: pair.key.range[0], end: pair.value.range[2], value: '' });
        }
    }
    let updated = raw;
    for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end);
    if (!hasClass) updated = `Class: Scene${newline}${updated}`;
    return addSceneIntakeTemplate(start[0] + updated + tail.slice(end.index), settings, context);
}

/** Reanchor a following sketch without reformatting its other YAML. */
export function replaceSketchAnchor(content: string, expected: string, next: string): string {
    const start = content.match(/^---\s*\r?\n/);
    if (!start) throw new Error(t('ui.timetable.sketchPromotionAnchorProblem'));
    const tail = content.slice(start[0].length);
    const end = /^---\s*$/m.exec(tail);
    if (!end) throw new Error(t('ui.timetable.sketchPromotionAnchorProblem'));
    const raw = tail.slice(0, end.index);
    const doc = parseDocument(raw);
    if (doc.errors.length || !isMap(doc.contents)) throw new Error(t('ui.timetable.sketchPromotionAnchorProblem'));
    const matches = doc.contents.items.filter(pair => isScalar(pair.key) && typeof pair.key.value === 'string' && pair.key.value.toLowerCase() === SKETCH_AFTER_SCENE.toLowerCase());
    const value = matches[0]?.value;
    if (matches.length !== 1 || !isScalar(value) || value.value !== expected || !value.range || value.anchor) throw new Error(t('ui.timetable.sketchPromotionAnchorProblem'));
    return start[0] + raw.slice(0, value.range[0]) + JSON.stringify(next) + raw.slice(value.range[1]) + tail.slice(end.index);
}
