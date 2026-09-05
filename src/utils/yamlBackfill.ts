/**
 * YAML Backfill engine.
 *
 * Inserts missing custom YAML fields into existing notes using
 * Obsidian's processFrontMatter() for safe, atomic updates.
 *
 * Guarantees:
 * - Never overwrites existing key values
 * - Normalizes undefined/null defaults to '' to prevent `key: null` writes
 */
import type { App, TFile } from 'obsidian';
import type { FieldEntryValue } from './yamlTemplateNormalize';
import { normalizeFrontmatterKeys, type getActiveFrontmatterMappings } from './frontmatter';

// ─── Types ──────────────────────────────────────────────────────────────

export interface BackfillOptions {
    app: App;
    /** Pre-filtered target files (only notes that need backfill). */
    files: TFile[];
    /** Keys to insert → default values from template.  */
    fieldsToInsert: Record<string, FieldEntryValue>;
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

/**
 * Normalize a default value so we never write `null` or `undefined`.
 * - `undefined` / `null` → `''`
 * - Arrays are preserved (empty arrays stay empty).
 * - Strings are preserved.
 */
function normalizeDefault(value: FieldEntryValue | undefined | null): string | string[] {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value;
    return value;
}

function isTrulyEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

// ─── Main backfill function ─────────────────────────────────────────────

/**
 * Insert missing YAML fields into the supplied files.
 *
 * For each file, uses `app.fileManager.processFrontMatter()` to inspect
 * the live frontmatter and add any keys from `fieldsToInsert` that are
 * absent. Existing values are never touched.
 */
export async function runYamlBackfill(options: BackfillOptions): Promise<BackfillResult> {
    const { app, files, fieldsToInsert, onProgress, abortSignal } = options;

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

            await app.fileManager.processFrontMatter(file, (fm) => {
                const fmObj = fm as Record<string, unknown>;

                for (const key of keysToInsert) {
                    // Only insert if the key is truly absent
                    if (!(key in fmObj)) {
                        fmObj[key] = normalizeDefault(fieldsToInsert[key]);
                        didInsert = true;
                    }
                }
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

            await app.fileManager.processFrontMatter(file, (fm) => {
                const fmObj = fm as Record<string, unknown>;

                for (const key of keysToConsider) {
                    // Only mutate keys that already exist and are truly empty
                    if (!(key in fmObj)) continue;
                    if (!isTrulyEmpty(fmObj[key])) continue;

                    const defaultValue = normalizeDefault(fieldsToInsert[key]);
                    // Skip no-op defaults (empty string or empty list)
                    if (
                        (typeof defaultValue === 'string' && defaultValue.trim().length === 0)
                        || (Array.isArray(defaultValue) && defaultValue.length === 0)
                    ) {
                        continue;
                    }

                    fmObj[key] = defaultValue;
                    fileFilledCount++;
                }
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

function isEmptyFrontmatterValue(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

function hasDefaultValue(value: FieldEntryValue): boolean {
    if (Array.isArray(value)) return value.length > 0;
    return value.trim().length > 0;
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
        if (hasDefaultValue(value)) fieldsToInsert[key] = value;
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
        const emptyKeys = keys.filter(key => key in fm && isEmptyFrontmatterValue(fm[key]));
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
