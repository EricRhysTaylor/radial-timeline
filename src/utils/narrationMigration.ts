/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/*
 * The scene field POV is now Narration (refactor alert yaml-pov-to-narration-v8).
 *
 * The update is a rename: nothing the writer wrote is lost.
 *
 *   - a scene without Narration (or with an empty Narration line) → POV is
 *     renamed Narration in place, its value, comment and position kept exactly,
 *     whatever it holds. An empty POV becomes an empty Narration. A name stays
 *     the writer's text under Narration: the timeline reads only a mode or
 *     count there and otherwise follows the book's narration;
 *   - a scene that already has a Narration value → an empty POV, or one that
 *     says exactly what Narration says, is removed (nothing is lost); a POV
 *     that says something else stays untouched and is listed for the writer.
 *
 * Nothing runs until the writer applies the alert. Until then, and for any
 * POV left in place, the timeline keeps reading POV (readSceneNarration).
 */

import type { App, TFile } from 'obsidian';
import type { RadialTimelineSettings } from '../types/settings';
import {
    authorKeyFromMappings,
    canonicalizeFrontmatterKey,
    frontmatterValueToText,
    getActiveFrontmatterMappings,
    LEGACY_SCENE_POV_KEY,
    normalizeFrontmatterKeys,
    SCENE_NARRATION_KEY,
} from './frontmatter';
import { applyFrontmatterEdits, frontmatterValues, readFrontmatterText, removeFieldEdit, yamlKey, type FrontmatterText, type TextEdit } from './frontmatterText';
import { isSceneClassFrontmatter } from './sceneIds';
import { splitTemplateFields, templateFieldKey } from './templateMerge';
import { isPathInFolderScope } from './pathScope';

export const POV_TO_NARRATION_ALERT_ID = 'yaml-pov-to-narration-v8';

export type PovFieldOutcome =
    | { action: 'rename'; value: string }
    | { action: 'remove'; reason: 'empty' | 'sameAsNarration' }
    /** The scene's Narration says something else; both lines stay as written. */
    | { action: 'keep'; value: string; narration: string };

type Mappings = Record<string, string> | undefined;

/** A field's non-empty entries as text: a scalar gives one, a YAML list one per item. */
function textEntries(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw : [raw];
    return values.map(value => frontmatterValueToText(value).trim()).filter(value => value.length > 0);
}

/** The note's own spelling of a canonical key, under the author's mappings. */
function noteKeyFor(frontmatter: Record<string, unknown>, canonical: string, mappings: Mappings): string | undefined {
    return Object.keys(frontmatter).find(key => canonicalizeFrontmatterKey(key, mappings) === canonical);
}

/**
 * What the update does with a scene's POV field. Null when the scene has
 * none. `frontmatter` is keyed as the note spells it.
 */
export function classifyPovField(frontmatter: Record<string, unknown>, mappings?: Mappings): PovFieldOutcome | null {
    const povKey = noteKeyFor(frontmatter, LEGACY_SCENE_POV_KEY, mappings);
    if (povKey === undefined) return null;
    const pov = textEntries(frontmatter[povKey]);
    const narrationKey = noteKeyFor(frontmatter, SCENE_NARRATION_KEY, mappings);
    const narration = narrationKey === undefined ? [] : textEntries(frontmatter[narrationKey]);

    // No Narration to keep: POV takes its name, value as written.
    if (narration.length === 0) return { action: 'rename', value: pov.join(', ') };
    if (pov.length === 0) return { action: 'remove', reason: 'empty' };
    if (pov.length === narration.length && pov.every((value, index) => value === narration[index])) {
        return { action: 'remove', reason: 'sameAsNarration' };
    }
    return { action: 'keep', value: pov.join(', '), narration: narration.join(', ') };
}

/**
 * The text edits that update one note's POV field, and what they do. A rename
 * respells the key in place (to the author's mapped name for Narration, if
 * any) and drops an empty Narration line beside it.
 */
export function povMigrationEdits(text: FrontmatterText, mappings?: Mappings): { edits: TextEdit[]; outcome: PovFieldOutcome | null } {
    const outcome = classifyPovField(frontmatterValues(text), mappings);
    if (!outcome || outcome.action === 'keep') return { edits: [], outcome };
    const fieldFor = (canonical: string) => text.fields.find(field => canonicalizeFrontmatterKey(field.key, mappings) === canonical);
    const povField = fieldFor(LEGACY_SCENE_POV_KEY);
    if (!povField) return { edits: [], outcome: null };
    if (outcome.action === 'remove') return { edits: [removeFieldEdit(povField, text.raw)], outcome };

    const edits: TextEdit[] = [{ start: povField.keyStart, end: povField.keyEnd, text: yamlKey(authorKeyFromMappings(SCENE_NARRATION_KEY, mappings)) }];
    const emptyNarration = fieldFor(SCENE_NARRATION_KEY);
    if (emptyNarration) edits.push(removeFieldEdit(emptyNarration, text.raw));
    return { edits, outcome };
}

/** Update one note's text. Returns the note unchanged when there is nothing to do. */
export function migratePovInContent(content: string, mappings?: Mappings): { content: string; outcome: PovFieldOutcome | null } {
    const text = readFrontmatterText(content);
    if (!text) return { content, outcome: null };
    const { edits, outcome } = povMigrationEdits(text, mappings);
    return { content: edits.length > 0 ? applyFrontmatterEdits(text, edits) : content, outcome };
}

export interface PovMigrationPlan {
    /** Scenes the update changes. */
    files: TFile[];
    renames: number;
    removals: number;
    /** Scenes whose POV stays beside a Narration that says something else, for the writer to review. */
    kept: Array<{ file: TFile; value: string; narration: string }>;
}

/**
 * Whether these scenes still have a POV the update would rename or remove.
 * A POV it would only list for review is no reason to offer the update.
 * Frontmatter may be keyed as the note spells it or canonically.
 */
export function scenesNeedPovMigration(frontmatters: Iterable<Record<string, unknown> | undefined>, mappings?: Mappings): boolean {
    for (const frontmatter of frontmatters) {
        if (!frontmatter) continue;
        const outcome = classifyPovField(frontmatter, mappings);
        if (outcome && outcome.action !== 'keep') return true;
    }
    return false;
}

/**
 * Whether any book's scenes still carry a POV the update would change: the same
 * scope as planPovToNarration, so the alert is offered exactly when applying it
 * has something to do. This offers the alert in a vault whose templates never
 * had POV, such as a fresh vault with a Story Vault edition whose scenes still
 * use it, whichever book is active.
 */
export function booksNeedPovMigration(app: App, settings: RadialTimelineSettings): boolean {
    const mappings = getActiveFrontmatterMappings(settings);
    return scenesNeedPovMigration(bookSceneNotes(app, settings.books.map(book => book.sourceFolder), mappings).map(note => note.frontmatter), mappings);
}

/**
 * The note migrations still pending in this vault, for refactor alerts. The
 * timeline's SETTINGS ALERT badge and the alert list in Settings both read
 * this, so the badge never points at a Settings page with nothing on it.
 */
export function pendingNoteMigrations(app: App, settings: RadialTimelineSettings): Set<string> {
    return new Set(booksNeedPovMigration(app, settings) ? [POV_TO_NARRATION_ALERT_ID] : []);
}

/** Scene notes in the given book folders, read from the metadata cache. */
function bookSceneNotes(app: App, sourceFolders: string[], mappings: Mappings): Array<{ file: TFile; frontmatter: Record<string, unknown> }> {
    const folders = sourceFolders.map(folder => folder.trim()).filter(folder => folder.length > 0);
    return app.vault.getMarkdownFiles().flatMap(file => {
        if (!folders.some(folder => isPathInFolderScope(file.path, folder))) return [];
        const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter || !isSceneClassFrontmatter(normalizeFrontmatterKeys(frontmatter, mappings))) return [];
        return [{ file, frontmatter }];
    });
}

/** What applying the alert would do to the writer's scenes. Reads only. */
export function planPovToNarration(app: App, settings: RadialTimelineSettings): PovMigrationPlan {
    const mappings = getActiveFrontmatterMappings(settings);
    const plan: PovMigrationPlan = { files: [], renames: 0, removals: 0, kept: [] };
    for (const { file, frontmatter } of bookSceneNotes(app, settings.books.map(book => book.sourceFolder), mappings)) {
        const outcome = classifyPovField(frontmatter, mappings);
        if (!outcome) continue;
        if (outcome.action === 'keep') {
            plan.kept.push({ file, value: outcome.value, narration: outcome.narration });
            continue;
        }
        plan.files.push(file);
        if (outcome.action === 'rename') plan.renames += 1;
        else plan.removals += 1;
    }
    return plan;
}

export interface PovMigrationResult {
    renamed: number;
    removed: number;
    failed: number;
    errors: Array<{ file: TFile; error: string }>;
}

/** Apply the update to the planned scenes, each note re-read as it is written. */
export async function runPovToNarration(app: App, files: TFile[], settings: RadialTimelineSettings): Promise<PovMigrationResult> {
    const mappings = getActiveFrontmatterMappings(settings);
    const result: PovMigrationResult = { renamed: 0, removed: 0, failed: 0, errors: [] };
    for (const file of files) {
        try {
            const applied: { outcome: PovFieldOutcome | null } = { outcome: null };
            await app.vault.process(file, content => {
                const migrated = migratePovInContent(content, mappings);
                applied.outcome = migrated.outcome;
                return migrated.content;
            });
            if (applied.outcome?.action === 'rename') result.renamed += 1;
            else if (applied.outcome?.action === 'remove') result.removed += 1;
            else {
                // Planned, but the note no longer reads as the plan saw it (edited
                // since, or its frontmatter does not parse as text): nothing was
                // written, and the update is not done.
                result.failed += 1;
                result.errors.push({ file, error: 'The scene changed after the update was planned; nothing was written.' });
            }
        } catch (error) {
            result.failed += 1;
            result.errors.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return result;
}

/**
 * The scene templates with Narration where they had POV: the field is renamed
 * in place, keeping its default value. A template that already has Narration
 * just loses POV. One with neither gains an empty Narration after Character,
 * so every new scene carries the field the writer fills in by hand.
 */
export function withNarrationTemplateField(templates: { base: string; advanced: string }): { base: string; advanced: string } {
    const hasField = (template: string, key: string) => splitTemplateFields(template).some(field => field.key === key);
    let narrationPlaced = hasField(templates.base, SCENE_NARRATION_KEY) || hasField(templates.advanced, SCENE_NARRATION_KEY);
    const rename = (template: string): string => splitTemplateFields(template).flatMap(field => {
        if (field.key !== LEGACY_SCENE_POV_KEY) return [field.lines];
        if (narrationPlaced) return [];
        narrationPlaced = true;
        return [`${SCENE_NARRATION_KEY}${field.rest}`];
    }).join('\n');
    const base = rename(templates.base);
    const advanced = rename(templates.advanced);
    if (narrationPlaced) return { base, advanced };
    const lines = base.split('\n');
    const character = lines.findIndex(line => templateFieldKey(line) === 'Character');
    // The Character field may run on over continuation lines; Narration follows all of them.
    let after = character;
    while (after >= 0 && after + 1 < lines.length && templateFieldKey(lines[after + 1]) === null) after++;
    lines.splice(after >= 0 ? after + 1 : lines.length, 0, `${SCENE_NARRATION_KEY}:`);
    return { base: lines.join('\n'), advanced };
}
