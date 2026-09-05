/**
 * YAML Manager engine.
 *
 * Destructive operations on frontmatter: delete fields and canonical reorder.
 * All operations are safety-gated by the yamlSafety scanner.
 *
 * Uses Obsidian's processFrontMatter() for delete operations and raw
 * file rewrite (vault.read/modify) for reorder (key order control).
 *
 * Follows the same patterns as yamlBackfill.ts:
 * - Atomic per-file updates
 * - Per-file try/catch (never abort batch on single failure)
 * - Abort signal support
 * - Progress callbacks
 * - Structured result objects
 */
import { type App, type TFile, stringifyYaml } from 'obsidian';
import {
    type FrontmatterSafetyResult,
    scanFrontmatterSafety,
} from './yamlSafety';
import { frontmatterValueToText, normalizeFrontmatterKeys } from './frontmatter';
import { buildFrontmatterDocument } from './frontmatterDocument';
import {
    formatAliasConflictMessage,
    prepareFrontmatterRewrite,
    verifyFrontmatterRewrite,
} from './frontmatterWriteSafety';

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

function isTrulyEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

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
 * - Uses processFrontMatter() for atomic updates
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

            await app.fileManager.processFrontMatter(file, (fm) => {
                const fmObj = fm as Record<string, unknown>;

                for (const key of Object.keys(fmObj)) {
                    if (!deleteSet.has(key)) continue;
                    if (protectedKeys?.has(key)) continue;
                    if (onlyEmpty && !isTrulyEmpty(fmObj[key])) continue;

                    delete fmObj[key];
                    removedFields.push(key);
                }
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
 * Uses raw file read/write because Obsidian's processFrontMatter() does
 * not guarantee key order.
 *
 * Key ordering strategy:
 * 1. Template keys in canonical order
 * 2. Remaining known keys (not in canonical order) in their original order
 * 3. Unknown/extra keys last, in their original order
 *
 * Safety guarantees:
 * - Skips files flagged as dangerous by the safety scanner
 * - Preserves all values exactly (only key order changes)
 * - Falls back gracefully on parse/write errors
 */
export async function runYamlReorder(
    options: ReorderOptions
): Promise<ReorderResult> {
    const {
        app,
        files,
        canonicalOrder,
        isDynamic,
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
            const didReorder = await reorderSingleFile(app, file, canonicalOrder, isDynamic);
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

/**
 * Reorder frontmatter in a single file. Returns true if the file was modified.
 */
async function reorderSingleFile(
    app: App,
    file: TFile,
    canonicalOrder: string[],
    isDynamic: (key: string) => boolean
): Promise<boolean> {
    // Cheap pre-check on a cached snapshot to decide whether a rewrite is
    // needed at all (avoids a no-op atomic write when order is already canonical).
    const snapshot = await app.vault.cachedRead(file);
    const pre = prepareFrontmatterRewrite(snapshot);
    if (!pre) {
        return false;
    }
    if (pre.aliasConflicts.length > 0) {
        throw new Error(`Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(pre.aliasConflicts)}`);
    }
    const preNormalized = normalizeFrontmatterKeys(pre.parsed);
    const preOrdered = buildOrderedKeyList(Object.keys(preNormalized), canonicalOrder, isDynamic);
    if (arraysEqual(Object.keys(pre.parsed), preOrdered)) {
        return false;
    }

    // Atomic read-modify-write. Frontmatter and body are derived from the
    // authoritative content inside the callback so a concurrent edit to the
    // note body cannot be clobbered, and verification runs on the exact bytes
    // about to be written — throwing aborts the write entirely.
    let changed = false;
    await app.vault.process(file, (content) => {
        const prepared = prepareFrontmatterRewrite(content);
        if (!prepared) return content;
        if (prepared.aliasConflicts.length > 0) {
            throw new Error(`Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(prepared.aliasConflicts)}`);
        }

        const rawFrontmatter = prepared.parsed;
        const normalizedFrontmatter = normalizeFrontmatterKeys(rawFrontmatter);
        const currentKeys = Object.keys(rawFrontmatter);
        const normalizedCurrentKeys = Object.keys(normalizedFrontmatter);
        const orderedKeys = buildOrderedKeyList(normalizedCurrentKeys, canonicalOrder, isDynamic);

        // Order/casing already canonical on disk (race) — no-op.
        if (arraysEqual(currentKeys, orderedKeys)) return content;

        // Rebuild frontmatter in the new order
        const reorderedObj: Record<string, unknown> = {};
        for (const key of orderedKeys) {
            reorderedObj[key] = normalizedFrontmatter[key];
        }

        const newYamlStr = stringifyYaml(reorderedObj);
        const newContent = buildFrontmatterDocument(newYamlStr, prepared.body);
        const verification = verifyFrontmatterRewrite(newContent, {
            originalBody: prepared.body,
            verifyParsed: (verifiedFrontmatter) => {
                const normalizedVerified = normalizeFrontmatterKeys(verifiedFrontmatter);
                return arraysEqual(Object.keys(normalizedVerified), orderedKeys);
            }
        });
        if (!verification.ok) {
            throw new Error(verification.reason ?? 'Frontmatter reorder verification failed.');
        }
        changed = true;
        return newContent;
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
            if (onlyEmpty && !isTrulyEmpty(fm[key])) continue;

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
    isDynamic: (key: string) => boolean
): { before: string[]; after: string[] } | null {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return null;

    const fm = cache.frontmatter as Record<string, unknown>;
    const currentKeys = Object.keys(fm).filter(k => k !== 'position');
    const normalizedFrontmatter = normalizeFrontmatterKeys(
        Object.fromEntries(Object.entries(fm).filter(([key]) => key !== 'position'))
    );
    const orderedKeys = buildOrderedKeyList(Object.keys(normalizedFrontmatter), canonicalOrder, isDynamic);

    if (arraysEqual(currentKeys, orderedKeys)) return null;
    return { before: currentKeys, after: orderedKeys };
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
            if (isTrulyEmpty(value)) {
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
