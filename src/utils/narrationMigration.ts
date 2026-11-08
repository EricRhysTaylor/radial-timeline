/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/*
 * The scene field POV is now Narration (refactor alert yaml-pov-to-narration-v8).
 *
 * POV never held the POV character (that is the first name in Character); it
 * held how a scene is narrated when the book departs from its default. Writers
 * put names there anyway, so the migration moves only what is a narration
 * value and never carries a name into Narration:
 *
 *   - a mode or count (first, third limited, omni, two, all, 3) → the field is
 *     renamed Narration in place, value, comment and position kept;
 *   - an empty POV, or one naming exactly the scene's first Character → removed;
 *   - anything else (another name, a list, a value beside an existing
 *     Narration) → left untouched under POV and listed for the writer.
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
import { isNarrationValue } from './pov';
import { stripWikiLinks } from './text';
import { isSceneClassFrontmatter } from './sceneIds';
import { removeTemplateFields } from './templateMerge';
import { isPathInFolderScope } from './pathScope';

export const POV_TO_NARRATION_ALERT_ID = 'yaml-pov-to-narration-v8';

export type PovFieldOutcome =
    | { action: 'move'; value: string }
    | { action: 'remove'; reason: 'empty' | 'firstCharacter' }
    | { action: 'keep'; value: string; reason: 'name' | 'narrationSet' };

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
 * What the migration does with a scene's POV field. Null when the scene has
 * none. `frontmatter` is keyed as the note spells it.
 */
export function classifyPovField(frontmatter: Record<string, unknown>, mappings?: Mappings): PovFieldOutcome | null {
    const povKey = noteKeyFor(frontmatter, LEGACY_SCENE_POV_KEY, mappings);
    if (povKey === undefined) return null;

    const values = textEntries(frontmatter[povKey]);
    if (values.length === 0) return { action: 'remove', reason: 'empty' };
    if (values.length > 1) return { action: 'keep', value: values.join(', '), reason: 'name' };

    const value = values[0];
    const characterKey = noteKeyFor(frontmatter, 'Character', mappings);
    const characters = characterKey === undefined ? [] : textEntries(frontmatter[characterKey]).map(stripWikiLinks);
    const named = stripWikiLinks(value);
    // A listed character is a name even when it starts like a mode ("Third Officer Ames").
    if (characters.length > 0 && named === characters[0]) return { action: 'remove', reason: 'firstCharacter' };
    if (characters.includes(named) || !isNarrationValue(value)) return { action: 'keep', value, reason: 'name' };

    const narrationKey = noteKeyFor(frontmatter, SCENE_NARRATION_KEY, mappings);
    if (narrationKey !== undefined && textEntries(frontmatter[narrationKey]).length > 0) {
        return { action: 'keep', value, reason: 'narrationSet' };
    }
    return { action: 'move', value };
}

/**
 * The text edits that migrate one note's POV field, and what they do. A move
 * respells the key in place (to the author's mapped name for Narration, if
 * any) and drops a blank Narration field beside it.
 */
export function povMigrationEdits(text: FrontmatterText, mappings?: Mappings): { edits: TextEdit[]; outcome: PovFieldOutcome | null } {
    const outcome = classifyPovField(frontmatterValues(text), mappings);
    if (!outcome || outcome.action === 'keep') return { edits: [], outcome };
    const fieldFor = (canonical: string) => text.fields.find(field => canonicalizeFrontmatterKey(field.key, mappings) === canonical);
    const povField = fieldFor(LEGACY_SCENE_POV_KEY);
    if (!povField) return { edits: [], outcome: null };
    if (outcome.action === 'remove') return { edits: [removeFieldEdit(povField, text.raw)], outcome };

    const edits: TextEdit[] = [{ start: povField.keyStart, end: povField.keyEnd, text: yamlKey(authorKeyFromMappings(SCENE_NARRATION_KEY, mappings)) }];
    const blankNarration = fieldFor(SCENE_NARRATION_KEY);
    if (blankNarration) edits.push(removeFieldEdit(blankNarration, text.raw));
    return { edits, outcome };
}

/** Migrate one note's text. Returns the note unchanged when there is nothing to do. */
export function migratePovInContent(content: string, mappings?: Mappings): { content: string; outcome: PovFieldOutcome | null } {
    const text = readFrontmatterText(content);
    if (!text) return { content, outcome: null };
    const { edits, outcome } = povMigrationEdits(text, mappings);
    return { content: edits.length > 0 ? applyFrontmatterEdits(text, edits) : content, outcome };
}

export interface PovMigrationPlan {
    /** Scenes the migration changes. */
    files: TFile[];
    moves: number;
    removals: number;
    /** Scenes whose POV stays for the writer to review, with what it says. */
    kept: Array<{ file: TFile; value: string }>;
}

/** Scene notes in any book folder, read from the metadata cache. */
function bookSceneNotes(app: App, settings: RadialTimelineSettings, mappings: Mappings): Array<{ file: TFile; frontmatter: Record<string, unknown> }> {
    const folders = settings.books.map(book => book.sourceFolder.trim()).filter(folder => folder.length > 0);
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
    const plan: PovMigrationPlan = { files: [], moves: 0, removals: 0, kept: [] };
    for (const { file, frontmatter } of bookSceneNotes(app, settings, mappings)) {
        const outcome = classifyPovField(frontmatter, mappings);
        if (!outcome) continue;
        if (outcome.action === 'keep') {
            plan.kept.push({ file, value: outcome.value });
            continue;
        }
        plan.files.push(file);
        if (outcome.action === 'move') plan.moves += 1;
        else plan.removals += 1;
    }
    return plan;
}

export interface PovMigrationResult {
    moved: number;
    removed: number;
    failed: number;
    errors: Array<{ file: TFile; error: string }>;
}

/** Apply the migration to the planned scenes, each note re-read as it is written. */
export async function runPovToNarration(app: App, files: TFile[], settings: RadialTimelineSettings): Promise<PovMigrationResult> {
    const mappings = getActiveFrontmatterMappings(settings);
    const result: PovMigrationResult = { moved: 0, removed: 0, failed: 0, errors: [] };
    for (const file of files) {
        try {
            const applied: { outcome: PovFieldOutcome | null } = { outcome: null };
            await app.vault.process(file, content => {
                const migrated = migratePovInContent(content, mappings);
                applied.outcome = migrated.outcome;
                return migrated.content;
            });
            if (applied.outcome?.action === 'move') result.moved += 1;
            else if (applied.outcome?.action === 'remove') result.removed += 1;
        } catch (error) {
            result.failed += 1;
            result.errors.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return result;
}

/** The scene templates without POV: a new scene gets Narration only when the writer adds it. */
export function withoutPovTemplateField(templates: { base: string; advanced: string }): { base: string; advanced: string } {
    return {
        base: removeTemplateFields(templates.base, [LEGACY_SCENE_POV_KEY]),
        advanced: removeTemplateFields(templates.advanced, [LEGACY_SCENE_POV_KEY]),
    };
}
