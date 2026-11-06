/**
 * YAML Manager engine.
 *
 * Destructive operations on frontmatter: delete fields and canonical reorder.
 * All operations are safety-gated by the yamlSafety scanner.
 *
 * Both edit the frontmatter text in place, so comments, formatting and the
 * note body stay exactly as the author wrote them.
 *
 * Follows the same patterns as yamlBackfill.ts:
 * - Atomic per-file updates
 * - Per-file try/catch (never abort batch on single failure)
 * - Abort signal support
 * - Progress callbacks
 * - Structured result objects
 */
import type { App, TFile } from 'obsidian';
import {
    type FrontmatterSafetyResult,
    scanFrontmatterSafety,
} from './yamlSafety';
import { canonicalizeFrontmatterKey, findCanonicalAliasConflicts, frontmatterValueToText } from './frontmatter';
import { formatAliasConflictMessage } from './frontmatterWriteSafety';
import {
    applyFrontmatterEdits,
    frontmatterValues,
    isBlankFrontmatterValue,
    readFrontmatterText,
    removeFieldEdit,
    reorderFrontmatterFields,
} from './frontmatterText';

// ─── Types ──────────────────────────────────────────────────────────────

export interface DeleteFieldsOptions {
    app: App;
    /** Pre-filtered target files. */
    files: TFile[];
    /** Field names to delete. */
    fieldsToDelete: string[];
    /** Known template + dynamic keys — these are protected from deletion. */
    protectedKeys?: Set<string>;
    /** When true, only delete fields that are truly empty. Default: false. */
    onlyEmpty?: boolean;
    /** Pre-computed safety results per file (avoids re-scanning). */
    safetyResults?: Map<TFile, FrontmatterSafetyResult>;
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}

export interface DeleteResult {
    /** Notes that had at least one field deleted. */
    deleted: number;
    /** Notes skipped (nothing to delete, or safety-blocked). */
    skipped: number;
    /** Notes where processFrontMatter threw. */
    failed: number;
    /** Per-file detail of which fields were actually removed. */
    deletedFields: { file: TFile; fields: string[] }[];
    /** Notes skipped specifically because the safety scanner flagged them. */
    safetySkipped: number;
    errors: { file: TFile; error: string }[];
}

export interface ReorderOptions {
    app: App;
    files: TFile[];
    /** Canonical key order (base + custom keys in template order). */
    canonicalOrder: string[];
    /**
     * Predicate identifying RT-known dynamic keys (Gossamer, scene analysis,
     * Pulse timestamps, etc.) — keys RT manages but does not place in
     * `canonicalOrder`. Required to distinguish RT-known dynamic keys from
     * foreign / unmanaged keys, which anchor to their preceding key.
     */
    isDynamic: (key: string) => boolean;
    /** The author's custom property names, so a mapped key sorts as its canonical key. */
    mappings?: Record<string, string>;
    /** Pre-computed safety results per file. */
    safetyResults?: Map<TFile, FrontmatterSafetyResult>;
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}

export interface ReorderResult {
    /** Notes whose frontmatter was reordered. */
    reordered: number;
    /** Notes skipped (already in order, no frontmatter, or safety-blocked). */
    skipped: number;
    /** Notes where the raw rewrite failed. */
    failed: number;
    /** Notes skipped specifically because the safety scanner flagged them. */
    safetySkipped: number;
    errors: { file: TFile; error: string }[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Check if a file's safety result allows destructive operations.
 * Returns true if the file is safe to modify; false if it should be skipped.
 */
function isSafeForModification(
    safetyResult: FrontmatterSafetyResult | undefined
): boolean {
    if (!safetyResult) return true;
    return safetyResult.status !== 'dangerous';
}

// ─── Delete operations ──────────────────────────────────────────────────

/**
 * Delete specified frontmatter fields from the supplied files.
 *
 * Safety guarantees:
 * - Never deletes fields in `protectedKeys` (template-defined keys).
 *   Callers MUST populate protectedKeys with at least the merged schema keys
 *   (from `getTemplateParts().merged`) and RESERVED_OBSIDIAN_KEYS.
 * - Dynamic suffix zone keys (Gossamer, Pulse timestamps, scene analysis, etc.)
 *   should be filtered out by the caller using `getExcludeKeyPredicate()` before
 *   passing `fieldsToDelete`.
 * - Skips files flagged as dangerous by the safety scanner
 * - When `onlyEmpty` is true, only removes fields with empty values
 * - Each file is read and written atomically; only the deleted lines change
 */
export async function runYamlDeleteFields(
    options: DeleteFieldsOptions
): Promise<DeleteResult> {
    const {
        app,
        files,
        fieldsToDelete,
        protectedKeys,
        onlyEmpty = false,
        safetyResults,
        onProgress,
        abortSignal,
    } = options;

    if (fieldsToDelete.length === 0) {
        return {
            deleted: 0,
            skipped: files.length,
            failed: 0,
            deletedFields: [],
            safetySkipped: 0,
            errors: [],
        };
    }

    const result: DeleteResult = {
        deleted: 0,
        skipped: 0,
        failed: 0,
        deletedFields: [],
        safetySkipped: 0,
        errors: [],
    };

    const deleteSet = new Set(fieldsToDelete);

    for (let i = 0; i < files.length; i++) {
        if (abortSignal?.aborted) break;

        const file = files[i];
        onProgress?.(i + 1, files.length, file.basename);

        // Safety gate
        const safety = safetyResults?.get(file);
        if (safety && !isSafeForModification(safety)) {
            result.safetySkipped++;
            result.skipped++;
            continue;
        }

        // If no pre-computed safety, do a quick scan
        if (!safetyResults) {
            const cache = app.metadataCache.getFileCache(file);
            const liveResult = await scanFrontmatterSafety({
                app,
                file,
                cache,
                checkBrokenYaml: true,
            });
            if (!isSafeForModification(liveResult)) {
                result.safetySkipped++;
                result.skipped++;
                continue;
            }
        }

        try {
            const removedFields: string[] = [];

            await app.vault.process(file, (content) => {
                const text = readFrontmatterText(content);
                if (!text) return content;
                const removing = text.fields.filter(field => deleteSet.has(field.key)
                    && !protectedKeys?.has(field.key)
                    && (!onlyEmpty || isBlankFrontmatterValue(field.value)));
                removedFields.splice(0, removedFields.length, ...removing.map(field => field.key));
                return applyFrontmatterEdits(text, removing.map(field => removeFieldEdit(field, text.raw)));
            });

            if (removedFields.length > 0) {
                result.deleted++;
                result.deletedFields.push({ file, fields: removedFields });
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

// ─── Canonical reorder ──────────────────────────────────────────────────

/**
 * Reorder frontmatter fields in the supplied files to match canonical order.
 *
 * Key ordering strategy:
 * 1. Template keys in canonical order
 * 2. Remaining known keys (not in canonical order) in their original order
 * 3. Unknown/extra keys last, in their original order
 *
 * Safety guarantees:
 * - Skips files flagged as dangerous by the safety scanner
 * - Moves each field with its comments; values are never rewritten
 * - Respells a managed key to its canonical name; other keys keep their spelling
 * - A rewrite that would change any value throws and leaves the note unchanged
 */
export async function runYamlReorder(
    options: ReorderOptions
): Promise<ReorderResult> {
    const {
        app,
        files,
        canonicalOrder,
        isDynamic,
        mappings,
        safetyResults,
        onProgress,
        abortSignal,
    } = options;

    const result: ReorderResult = {
        reordered: 0,
        skipped: 0,
        failed: 0,
        safetySkipped: 0,
        errors: [],
    };

    for (let i = 0; i < files.length; i++) {
        if (abortSignal?.aborted) break;

        const file = files[i];
        onProgress?.(i + 1, files.length, file.basename);

        // Safety gate
        const safety = safetyResults?.get(file);
        if (safety && !isSafeForModification(safety)) {
            result.safetySkipped++;
            result.skipped++;
            continue;
        }

        if (!safetyResults) {
            const cache = app.metadataCache.getFileCache(file);
            const liveResult = await scanFrontmatterSafety({
                app,
                file,
                cache,
                checkBrokenYaml: true,
            });
            if (!isSafeForModification(liveResult)) {
                result.safetySkipped++;
                result.skipped++;
                continue;
            }
        }

        try {
            const didReorder = await reorderSingleFile(app, file, canonicalOrder, isDynamic, mappings);
            if (didReorder) {
                result.reordered++;
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

interface ReorderPlan {
    /** The note's keys, as it spells them, in their new order. */
    keys: string[];
    /** Managed keys to respell to their canonical name. */
    renames: Map<string, string>;
    changed: boolean;
}

function planReorder(
    noteKeys: string[],
    canonicalOrder: string[],
    isDynamic: (key: string) => boolean,
    mappings?: Record<string, string>
): ReorderPlan {
    const noteKeyFor = new Map(noteKeys.map(key => [canonicalizeFrontmatterKey(key, mappings), key]));
    const keys = buildOrderedKeyList([...noteKeyFor.keys()], canonicalOrder, isDynamic)
        .map(key => noteKeyFor.get(key)!); // SAFE: buildOrderedKeyList only returns keys it was given
    const canonicalSet = new Set(canonicalOrder);
    const renames = new Map<string, string>();
    for (const key of noteKeys) {
        const canonical = canonicalizeFrontmatterKey(key);
        if (canonical !== key && canonicalSet.has(canonical)) renames.set(key, canonical);
    }
    return { keys, renames, changed: renames.size > 0 || !arraysEqual(noteKeys, keys) };
}

/**
 * Reorder frontmatter in a single file. Returns true if the file was modified.
 */
async function reorderSingleFile(
    app: App,
    file: TFile,
    canonicalOrder: string[],
    isDynamic: (key: string) => boolean,
    mappings?: Record<string, string>
): Promise<boolean> {
    let changed = false;
    await app.vault.process(file, (content) => {
        const text = readFrontmatterText(content);
        if (!text) return content;
        const conflicts = findCanonicalAliasConflicts(frontmatterValues(text), mappings);
        if (conflicts.length > 0) {
            throw new Error(`Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(conflicts)}`);
        }
        const plan = planReorder(text.fields.map(field => field.key), canonicalOrder, isDynamic, mappings);
        if (!plan.changed) return content;
        const reordered = reorderFrontmatterFields(text, plan.keys, plan.renames);
        changed = true;
        return reordered;
    });
    return changed;
}

/**
 * Build the final key list given the current keys and the canonical order.
 *
 * Each input key is classified as one of three kinds:
 *
 * - **canonical** — appears in `canonicalOrder` (RT template-defined).
 * - **dynamic** — `isDynamic(key)` is true. RT-known but not template-ordered
 *   (Gossamer, scene analysis, repair metadata, etc.). Preserved in original
 *   relative order and placed after the canonical zone.
 * - **foreign** — neither canonical nor dynamic. Keys owned by other plugins
 *   or casual author additions. RT does not own them, so they MUST NOT be
 *   moved to a global "end" zone — instead they anchor to the immediately
 *   preceding non-foreign key in the input and travel with it. Foreign keys
 *   appearing before any non-foreign key form the "head" zone and remain at
 *   the top of the document.
 *
 * Layout:
 *   [head foreigns]
 *   [canonical key A]  [foreigns whose anchor was A]
 *   [canonical key B]  [foreigns whose anchor was B]
 *   ...
 *   [dynamic key X]    [foreigns whose anchor was X]
 *   [dynamic key Y]    [foreigns whose anchor was Y]
 */
export function buildOrderedKeyList(
    currentKeys: string[],
    canonicalOrder: string[],
    isDynamic: (key: string) => boolean
): string[] {
    const canonicalSet = new Set(canonicalOrder);
    const isForeign = (key: string) => !canonicalSet.has(key) && !isDynamic(key);

    const headForeigns: string[] = [];
    const trailingForeigns = new Map<string, string[]>();
    let lastNonForeign: string | null = null;

    for (const key of currentKeys) {
        if (isForeign(key)) {
            if (lastNonForeign === null) {
                headForeigns.push(key);
            } else {
                const list = trailingForeigns.get(lastNonForeign) ?? [];
                list.push(key);
                trailingForeigns.set(lastNonForeign, list);
            }
        } else {
            lastNonForeign = key;
        }
    }

    const ordered: string[] = [...headForeigns];
    const currentSet = new Set(currentKeys);

    for (const key of canonicalOrder) {
        if (!currentSet.has(key)) continue;
        ordered.push(key);
        const trailing = trailingForeigns.get(key);
        if (trailing) ordered.push(...trailing);
    }

    for (const key of currentKeys) {
        if (canonicalSet.has(key) || isForeign(key)) continue;
        ordered.push(key);
        const trailing = trailingForeigns.get(key);
        if (trailing) ordered.push(...trailing);
    }

    return ordered;
}

/** Whether a note's keys are already where a reorder would leave them. */
export function sceneOrderIsCanonical(noteKeys: string[], canonicalOrder: string[], isDynamic: (key: string) => boolean): boolean {
    return arraysEqual(noteKeys, buildOrderedKeyList(noteKeys, canonicalOrder, isDynamic));
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// ─── Dry-run helpers ────────────────────────────────────────────────────

/**
 * Preview what a delete operation would do without actually modifying files.
 * Returns a map of file → fields that would be deleted.
 */
export function previewDeleteFields(
    app: App,
    files: TFile[],
    fieldsToDelete: string[],
    protectedKeys?: Set<string>,
    onlyEmpty = false
): Map<TFile, { fields: string[]; values: Record<string, unknown> }> {
    const deleteSet = new Set(fieldsToDelete);
    const preview = new Map<TFile, { fields: string[]; values: Record<string, unknown> }>();

    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) continue;

        const fm = cache.frontmatter as Record<string, unknown>;
        const fields: string[] = [];
        const values: Record<string, unknown> = {};

        for (const key of Object.keys(fm)) {
            if (key === 'position') continue;
            if (!deleteSet.has(key)) continue;
            if (protectedKeys?.has(key)) continue;
            if (onlyEmpty && !isBlankFrontmatterValue(fm[key])) continue;

            fields.push(key);
            values[key] = fm[key];
        }

        if (fields.length > 0) {
            preview.set(file, { fields, values });
        }
    }

    return preview;
}

/**
 * Preview what a reorder operation would produce for a single file.
 * Returns null if no reorder is needed, or the before/after key lists.
 */
export function previewReorder(
    app: App,
    file: TFile,
    canonicalOrder: string[],
    isDynamic: (key: string) => boolean,
    mappings?: Record<string, string>
): { before: string[]; after: string[] } | null {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return null;

    const before = Object.keys(cache.frontmatter as Record<string, unknown>).filter(k => k !== 'position');
    const plan = planReorder(before, canonicalOrder, isDynamic, mappings);
    if (!plan.changed) return null;
    return { before, after: plan.keys.map(key => plan.renames.get(key) ?? key) };
}

export interface DeletePreviewSummary {
    emptyFieldCount: number;
    valuedFieldCount: number;
    /** The first few valued fields, for the confirmation dialog. Values are shortened for display. */
    samples: Array<{ key: string; value: string }>;
}

/** Split a delete preview into fields that are empty (no data loss) and fields that hold values. */
export function summarizeDeletePreview(
    preview: Map<TFile, { fields: string[]; values: Record<string, unknown> }>,
    sampleLimit = 8
): DeletePreviewSummary {
    const summary: DeletePreviewSummary = { emptyFieldCount: 0, valuedFieldCount: 0, samples: [] };
    for (const detail of preview.values()) {
        for (const field of detail.fields) {
            const value = detail.values[field];
            if (isBlankFrontmatterValue(value)) {
                summary.emptyFieldCount++;
                continue;
            }
            summary.valuedFieldCount++;
            if (summary.samples.length < sampleLimit) {
                const text = Array.isArray(value) ? value.join(', ') : frontmatterValueToText(value);
                summary.samples.push({ key: field, value: text.length > 60 ? text.slice(0, 57) + '...' : text });
            }
        }
    }
    return summary;
}
