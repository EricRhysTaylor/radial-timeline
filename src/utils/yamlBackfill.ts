/**
 * YAML Backfill engine.
 *
 * Inserts missing fields into existing notes by editing the frontmatter text,
 * so the author's comments and formatting stay as they wrote them.
 *
 * Guarantees:
 * - Never overwrites existing key values
 * - Never duplicates a property the note has under another case or mapped name
 * - Writes an empty default as `Key:`, the way the templates do
 */
import type { App, TFile } from 'obsidian';
import type { FieldEntryValue } from './yamlTemplateNormalize';
import { authorKeyFromMappings, canonicalizeFrontmatterKey, findMissingTemplateKeys, normalizeFrontmatterKeys, type getActiveFrontmatterMappings } from './frontmatter';
import { applyFrontmatterEdits, formatYamlField, frontmatterValues, insertFieldEdits, isBlankFrontmatterValue, readFrontmatterText, replaceValueEdit, yamlScalar, type FrontmatterText, type TextEdit } from './frontmatterText';

// ─── Types ──────────────────────────────────────────────────────────────

export interface BackfillOptions {
    app: App;
    /** Pre-filtered target files (only notes that need backfill). */
    files: TFile[];
    /** Keys to insert → default values from template.  */
    fieldsToInsert: Record<string, FieldEntryValue>;
    /** Canonical key order. New fields go to their place in it; without one they go last. */
    order?: string[];
    /** The author's custom property names. */
    mappings?: Record<string, string>;
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}

export interface BackfillResult {
    /** Notes that had at least one missing field inserted. */
    updated: number;
    /** Notes that already had all fields (nothing to do). */
    skipped: number;
    /** Notes where processFrontMatter threw. */
    failed: number;
    errors: { file: TFile; error: string }[];
}

export interface FillEmptyValuesResult {
    /** Notes where at least one empty key received a default value. */
    updated: number;
    /** Total number of fields filled across all notes. */
    filledFields: number;
    /** Notes where no eligible empty keys were found. */
    skipped: number;
    /** Notes where processFrontMatter threw. */
    failed: number;
    errors: { file: TFile; error: string }[];
}

export interface BeatPurposeMigrationResult {
    /** Notes where at least one migration change was applied. */
    updated: number;
    /** Purpose values copied from legacy Description values. */
    movedToPurpose: number;
    /** Description keys removed after migration or when empty. */
    removedDescription: number;
    /** Notes with no applicable legacy change. */
    skipped: number;
    /** Notes where processFrontMatter threw. */
    failed: number;
    errors: { file: TFile; error: string }[];
}

export interface BackdropContextMigrationResult {
    /** Notes where at least one migration change was applied. */
    updated: number;
    /** Context values copied from legacy Synopsis values. */
    movedToContext: number;
    /** Synopsis keys removed after migration or when empty. */
    removedSynopsis: number;
    /** Notes with no applicable legacy change. */
    skipped: number;
    /** Notes where processFrontMatter threw. */
    failed: number;
    errors: { file: TFile; error: string }[];
}

interface LegacyFieldMigrationResult {
    updated: number;
    movedToCanonical: number;
    removedLegacy: number;
    skipped: number;
    failed: number;
    errors: { file: TFile; error: string }[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** A template placeholder such as `{{Character}}`, filled only when a scene is created. */
const TEMPLATE_PLACEHOLDER = /^\s*\{\{[^{}\n]+\}\}\s*$/;

/**
 * Normalize a default value so we never write `null`, `undefined`, or a raw
 * template placeholder into a note.
 * - `undefined` / `null` → `''`
 * - `{{Placeholder}}` strings → `''`; placeholder list items are dropped.
 * - Other strings and list items are preserved.
 */
export function normalizeDefault(value: FieldEntryValue | undefined | null): string | string[] {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.filter(item => !TEMPLATE_PLACEHOLDER.test(item));
    if (TEMPLATE_PLACEHOLDER.test(value)) return '';
    return value;
}

/** The audit does not accept the old names of these keys, so insert renames them. */
const RENAMED_WHEN_REQUESTED = ['Pulse Update', 'Summary Update'];

function deprecatedKeyEdits(text: FrontmatterText, requested: string[]): TextEdit[] {
    const compact = (key: string) => key.toLowerCase().replace(/[\s_-]/g, '');
    return text.fields.flatMap(field => {
        const canonical = canonicalizeFrontmatterKey(field.key);
        const deprecated = RENAMED_WHEN_REQUESTED.includes(canonical) && requested.includes(canonical)
            && compact(field.key) !== compact(canonical);
        return deprecated ? [{ start: field.keyStart, end: field.keyEnd, text: canonical }] : [];
    });
}

// ─── Main backfill function ─────────────────────────────────────────────

/**
 * Insert missing YAML fields into the supplied files.
 *
 * Each file is read and written atomically; keys from `fieldsToInsert` that the
 * note lacks are added and every existing byte stays.
 */
export async function runYamlBackfill(options: BackfillOptions): Promise<BackfillResult> {
    const { app, files, fieldsToInsert, order, mappings, onProgress, abortSignal } = options;

    const keysToInsert = Object.keys(fieldsToInsert);
    if (keysToInsert.length === 0) {
        return { updated: 0, skipped: files.length, failed: 0, errors: [] };
    }

    const result: BackfillResult = {
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [],
    };

    for (let i = 0; i < files.length; i++) {
        // Abort check
        if (abortSignal?.aborted) break;

        const file = files[i];
        onProgress?.(i + 1, files.length, file.basename);

        try {
            let didInsert = false;

            await app.vault.process(file, (content) => {
                const text = readFrontmatterText(content);
                if (!text) return content;
                const missing = findMissingTemplateKeys(keysToInsert, frontmatterValues(text), mappings);
                const renames = deprecatedKeyEdits(text, keysToInsert);
                if (missing.length === 0 && renames.length === 0) return content;
                didInsert = true;
                const additions = missing.map(key => ({
                    key,
                    lines: formatYamlField(authorKeyFromMappings(key, mappings), normalizeDefault(fieldsToInsert[key])),
                }));
                return applyFrontmatterEdits(text, [...renames, ...insertFieldEdits(text, additions, order
                    ? { order, canonicalOf: key => canonicalizeFrontmatterKey(key, mappings) }
                    : undefined)]);
            });

            if (didInsert) {
                result.updated++;
            } else {
                result.skipped++;
            }
        } catch (error) {
            result.failed++;
            result.errors.push({
                file,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return result;
}

/**
 * Beat legacy migration helper:
 * - If Purpose is missing/empty and Description has content, move content to Purpose.
 * - Remove empty Description keys (and remove moved Description keys).
 */
export async function runBeatDescriptionToPurposeMigration(options: {
    app: App;
    files: TFile[];
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}): Promise<BeatPurposeMigrationResult> {
    const migrated = await runLegacyFieldMigration({
        app: options.app,
        files: options.files,
        legacyKey: 'Description',
        canonicalKey: 'Purpose',
        onProgress: options.onProgress,
        abortSignal: options.abortSignal,
    });
    return {
        updated: migrated.updated,
        movedToPurpose: migrated.movedToCanonical,
        removedDescription: migrated.removedLegacy,
        skipped: migrated.skipped,
        failed: migrated.failed,
        errors: migrated.errors,
    };
}

/**
 * Backdrop legacy migration helper:
 * - If Context is missing/empty and Synopsis has content, move content to Context.
 * - Remove empty Synopsis keys (and remove moved Synopsis keys).
 */
export async function runBackdropSynopsisToContextMigration(options: {
    app: App;
    files: TFile[];
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}): Promise<BackdropContextMigrationResult> {
    const migrated = await runLegacyFieldMigration({
        app: options.app,
        files: options.files,
        legacyKey: 'Synopsis',
        canonicalKey: 'Context',
        onProgress: options.onProgress,
        abortSignal: options.abortSignal,
    });
    return {
        updated: migrated.updated,
        movedToContext: migrated.movedToCanonical,
        removedSynopsis: migrated.removedLegacy,
        skipped: migrated.skipped,
        failed: migrated.failed,
        errors: migrated.errors,
    };
}

async function runLegacyFieldMigration(options: {
    app: App;
    files: TFile[];
    legacyKey: string;
    canonicalKey: string;
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}): Promise<LegacyFieldMigrationResult> {
    const { app, files, legacyKey, canonicalKey, onProgress, abortSignal } = options;
    const result: LegacyFieldMigrationResult = {
        updated: 0,
        movedToCanonical: 0,
        removedLegacy: 0,
        skipped: 0,
        failed: 0,
        errors: [],
    };

    for (let i = 0; i < files.length; i++) {
        if (abortSignal?.aborted) break;

        const file = files[i];
        onProgress?.(i + 1, files.length, file.basename);

        try {
            let didChange = false;

            await app.fileManager.processFrontMatter(file, (fm) => {
                const fmObj = fm as Record<string, unknown>;
                const hasLegacy = Object.prototype.hasOwnProperty.call(fmObj, legacyKey);
                const legacyRaw = typeof fmObj[legacyKey] === 'string' ? String(fmObj[legacyKey]) : undefined;
                const legacyValue = (legacyRaw ?? '').trim();
                const canonicalRaw = typeof fmObj[canonicalKey] === 'string' ? String(fmObj[canonicalKey]) : undefined;
                const hasCanonicalValue = typeof canonicalRaw === 'string' && canonicalRaw.trim().length > 0;

                if (!hasCanonicalValue && legacyValue.length > 0) {
                    fmObj[canonicalKey] = legacyRaw;
                    delete fmObj[legacyKey];
                    result.movedToCanonical += 1;
                    result.removedLegacy += 1;
                    didChange = true;
                    return;
                }

                if (hasLegacy && legacyValue.length === 0) {
                    delete fmObj[legacyKey];
                    result.removedLegacy += 1;
                    didChange = true;
                }
            });

            if (didChange) {
                result.updated += 1;
            } else {
                result.skipped += 1;
            }
        } catch (error) {
            result.failed += 1;
            result.errors.push({
                file,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return result;
}

/**
 * Fill empty existing frontmatter keys with defaults.
 *
 * Safety guarantees:
 * - Never creates missing keys
 * - Never overwrites non-empty values
 * - Never deletes keys
 */
export async function runYamlFillEmptyValues(options: BackfillOptions): Promise<FillEmptyValuesResult> {
    const { app, files, fieldsToInsert, onProgress, abortSignal } = options;
    const keysToConsider = Object.keys(fieldsToInsert);

    if (keysToConsider.length === 0) {
        return { updated: 0, filledFields: 0, skipped: files.length, failed: 0, errors: [] };
    }

    const result: FillEmptyValuesResult = {
        updated: 0,
        filledFields: 0,
        skipped: 0,
        failed: 0,
        errors: [],
    };

    for (let i = 0; i < files.length; i++) {
        if (abortSignal?.aborted) break;

        const file = files[i];
        onProgress?.(i + 1, files.length, file.basename);

        try {
            let fileFilledCount = 0;

            await app.vault.process(file, (content) => {
                const text = readFrontmatterText(content);
                if (!text) return content;
                const edits: TextEdit[] = [];
                for (const key of keysToConsider) {
                    // Only mutate keys that already exist and are truly empty
                    const field = text.fields.find(candidate => candidate.key === key);
                    if (!field || !isBlankFrontmatterValue(field.value)) continue;
                    if (!hasDefaultValue(fieldsToInsert[key])) continue;
                    const defaultValue = normalizeDefault(fieldsToInsert[key]);
                    edits.push(replaceValueEdit(text, field, Array.isArray(defaultValue)
                        ? JSON.stringify(defaultValue)
                        : yamlScalar(defaultValue)));
                }
                fileFilledCount = edits.length;
                return applyFrontmatterEdits(text, edits);
            });

            if (fileFilledCount > 0) {
                result.updated++;
                result.filledFields += fileFilledCount;
            } else {
                result.skipped++;
            }
        } catch (error) {
            result.failed++;
            result.errors.push({
                file,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return result;
}

// ─── Plans: what a fill or migration would touch, before any write ────────

export interface FillEmptyPlan {
    files: TFile[];
    entries: Array<{ file: TFile; emptyKeys: string[] }>;
    fieldsToInsert: Record<string, FieldEntryValue>;
    filledFields: number;
    touchedKeys: string[];
    sourcePath: string;
}

function hasDefaultValue(value: FieldEntryValue): boolean {
    const normalized = normalizeDefault(value);
    if (Array.isArray(normalized)) return normalized.length > 0;
    return normalized.trim().length > 0;
}

/**
 * Which notes under the book folder have empty custom keys that the template
 * gives a default for. Only existing empty keys count: nothing is added or
 * overwritten. Null when there is nothing to fill.
 */
export function planFillEmptyValues(options: {
    app: App;
    files: TFile[];
    sourcePath: string;
    customKeys: string[];
    defaults: Record<string, FieldEntryValue>;
}): FillEmptyPlan | null {
    const sourcePath = options.sourcePath;
    if (!sourcePath) return null;
    const prefix = sourcePath.endsWith('/') ? sourcePath : `${sourcePath}/`;
    const scopedFiles = options.files.filter(file => file.path === sourcePath || file.path.startsWith(prefix));
    if (scopedFiles.length === 0 || options.customKeys.length === 0) return null;

    const fieldsToInsert: Record<string, FieldEntryValue> = {};
    for (const key of options.customKeys) {
        const value = options.defaults[key] ?? '';
        if (hasDefaultValue(value)) fieldsToInsert[key] = normalizeDefault(value);
    }
    const keys = Object.keys(fieldsToInsert);
    if (keys.length === 0) return null;

    const files: TFile[] = [];
    const entries: Array<{ file: TFile; emptyKeys: string[] }> = [];
    const touchedKeys = new Set<string>();
    let filledFields = 0;
    for (const file of scopedFiles) {
        const fm = options.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm) continue;
        const emptyKeys = keys.filter(key => key in fm && isBlankFrontmatterValue(fm[key]));
        if (emptyKeys.length === 0) continue;
        filledFields += emptyKeys.length;
        emptyKeys.forEach(key => touchedKeys.add(key));
        files.push(file);
        entries.push({ file, emptyKeys });
    }
    if (files.length === 0) return null;
    return { files, entries, fieldsToInsert, filledFields, touchedKeys: [...touchedKeys].sort(), sourcePath };
}

export interface DeprecatedMigrationPlan {
    legacyKey: 'Description' | 'Synopsis';
    canonicalKey: 'Purpose' | 'Context';
    files: TFile[];
    /** Notes whose legacy value moves into the canonical key. */
    moveCount: number;
    /** Notes whose legacy key is empty and simply goes. */
    removeEmptyCount: number;
    /** Notes that keep their legacy value because the canonical key already has content. */
    preservedCount: number;
}

/**
 * Beat notes still carrying Description (now Purpose) or Backdrop notes
 * carrying Synopsis (now Context). Null when nothing would change.
 */
export function planDeprecatedFieldMigration(options: {
    app: App;
    files: TFile[];
    noteType: 'Beat' | 'Backdrop';
    mappings: ReturnType<typeof getActiveFrontmatterMappings> | null;
}): DeprecatedMigrationPlan | null {
    const legacyKey = options.noteType === 'Beat' ? 'Description' : 'Synopsis';
    const canonicalKey = options.noteType === 'Beat' ? 'Purpose' : 'Context';
    const files: TFile[] = [];
    let moveCount = 0;
    let removeEmptyCount = 0;
    let preservedCount = 0;
    for (const file of options.files) {
        const raw = options.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!raw) continue;
        const normalized = options.mappings ? normalizeFrontmatterKeys(raw, options.mappings) : raw;
        if (!Object.prototype.hasOwnProperty.call(normalized, legacyKey)) continue;
        const legacy = typeof normalized[legacyKey] === 'string' ? String(normalized[legacyKey]).trim() : '';
        const canonical = typeof normalized[canonicalKey] === 'string' ? String(normalized[canonicalKey]).trim() : '';
        files.push(file);
        if (legacy.length === 0) removeEmptyCount += 1;
        else if (canonical.length === 0) moveCount += 1;
        else preservedCount += 1;
    }
    if (moveCount === 0 && removeEmptyCount === 0) return null;
    return { legacyKey, canonicalKey, files, moveCount, removeEmptyCount, preservedCount };
}
