import { App, stringifyYaml, TFile } from 'obsidian';
import type { NoteType } from './yamlTemplateNormalize';
import { ensureReferenceIdFrontmatter, generateSceneId, readReferenceId } from './sceneIds';
import { buildFrontmatterDocument } from './frontmatterDocument';
import {
    formatAliasConflictMessage,
    prepareFrontmatterRewrite,
    verifyFrontmatterRewrite,
} from './frontmatterWriteSafety';

export interface ReferenceIdBackfillOptions {
    app: App;
    files: TFile[];
    noteType?: NoteType;
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}

export interface ReferenceIdBackfillResult {
    updated: number;
    skipped: number;
    failed: number;
    errors: { file: TFile; error: string }[];
}

export interface ReferenceIdDuplicateRepairResult {
    updated: number;
    skipped: number;
    failed: number;
    errors: { file: TFile; error: string }[];
}

function classFallbackForNoteType(noteType: NoteType | undefined): string | undefined {
    if (noteType === 'Scene') return 'Scene';
    if (noteType === 'Beat') return 'Beat';
    if (noteType === 'Backdrop') return 'Backdrop';
    return undefined;
}

export async function runReferenceIdBackfill(options: ReferenceIdBackfillOptions): Promise<ReferenceIdBackfillResult> {
    const { app, files, noteType, onProgress, abortSignal } = options;
    const classFallback = classFallbackForNoteType(noteType);
    const result: ReferenceIdBackfillResult = {
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };

    for (let idx = 0; idx < files.length; idx += 1) {
        if (abortSignal?.aborted) break;
        const file = files[idx];
        onProgress?.(idx + 1, files.length, file.basename);

        try {
            // Cheap pre-check on a cached snapshot to classify skip/fail
            // without an unnecessary atomic write.
            const snapshot = await app.vault.cachedRead(file);
            const pre = prepareFrontmatterRewrite(snapshot);
            if (!pre) {
                result.skipped += 1;
                continue;
            }
            if (pre.aliasConflicts.length > 0) {
                result.failed += 1;
                result.errors.push({
                    file,
                    error: `Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(pre.aliasConflicts)}`
                });
                continue;
            }
            if (!ensureReferenceIdFrontmatter(pre.parsed, { classFallback }).changed) {
                result.skipped += 1;
                continue;
            }

            // Atomic read-modify-write. Frontmatter and body are derived from
            // the authoritative content inside the callback so a concurrent
            // edit cannot be clobbered, and verification runs on the exact
            // bytes about to be written — throwing aborts the write entirely.
            let changed = false;
            await app.vault.process(file, (content) => {
                const prepared = prepareFrontmatterRewrite(content);
                if (!prepared) return content;
                if (prepared.aliasConflicts.length > 0) {
                    throw new Error(`Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(prepared.aliasConflicts)}`);
                }
                const normalized = ensureReferenceIdFrontmatter(prepared.parsed, { classFallback });
                if (!normalized.changed) return content;
                const rebuiltYaml = stringifyYaml(normalized.frontmatter);
                const updatedContent = buildFrontmatterDocument(rebuiltYaml, prepared.body);
                const verification = verifyFrontmatterRewrite(updatedContent, {
                    originalBody: prepared.body,
                    verifyParsed: (verifiedFrontmatter) => readReferenceId(verifiedFrontmatter) === normalized.id
                });
                if (!verification.ok) {
                    throw new Error(verification.reason ?? 'Reference ID backfill verification failed.');
                }
                changed = true;
                return updatedContent;
            });
            if (changed) result.updated += 1;
            else result.skipped += 1;
        } catch (error) {
            result.failed += 1;
            result.errors.push({
                file,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return result;
}

export async function runReferenceIdDuplicateRepair(options: ReferenceIdBackfillOptions): Promise<ReferenceIdDuplicateRepairResult> {
    const { app, files, noteType, onProgress, abortSignal } = options;
    const classFallback = classFallbackForNoteType(noteType);
    const result: ReferenceIdDuplicateRepairResult = {
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };

    type ParsedRecord = {
        file: TFile;
        referenceId?: string;
    };

    const parsedRecords: ParsedRecord[] = [];

    for (let idx = 0; idx < files.length; idx += 1) {
        if (abortSignal?.aborted) break;
        const file = files[idx];
        onProgress?.(idx + 1, files.length, file.basename);

        try {
            // Detection is read-only; cachedRead avoids redundant disk reads.
            const snapshot = await app.vault.cachedRead(file);
            const prepared = prepareFrontmatterRewrite(snapshot);
            if (!prepared) {
                result.skipped += 1;
                continue;
            }
            if (prepared.aliasConflicts.length > 0) {
                result.failed += 1;
                result.errors.push({
                    file,
                    error: `Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(prepared.aliasConflicts)}`
                });
                continue;
            }

            parsedRecords.push({
                file,
                referenceId: readReferenceId(prepared.parsed)
            });
        } catch (error) {
            result.failed += 1;
            result.errors.push({
                file,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    const grouped = new Map<string, ParsedRecord[]>();
    const usedIds = new Set<string>();

    for (const record of parsedRecords) {
        if (!record.referenceId) continue;
        usedIds.add(record.referenceId);
        const list = grouped.get(record.referenceId) ?? [];
        list.push(record);
        grouped.set(record.referenceId, list);
    }

    const duplicates = [...grouped.values()].filter(group => group.length > 1);
    if (duplicates.length === 0) {
        return result;
    }

    for (const group of duplicates) {
        const orderedGroup = [...group].sort((a, b) => a.file.path.localeCompare(b.file.path));
        // Keep the first path stable; reassign ids for the rest.
        const reassignTargets = orderedGroup.slice(1);

        for (const target of reassignTargets) {
            if (abortSignal?.aborted) return result;
            try {
                let nextId = generateSceneId();
                while (usedIds.has(nextId)) {
                    nextId = generateSceneId();
                }
                usedIds.add(nextId);

                // Atomic read-modify-write. Frontmatter and body are derived
                // from the authoritative content inside the callback — closing
                // the long read→write gap that previously spanned the whole
                // batch. Verification runs on the exact bytes to be written.
                let changed = false;
                await app.vault.process(target.file, (content) => {
                    const prepared = prepareFrontmatterRewrite(content);
                    if (!prepared) return content;
                    if (prepared.aliasConflicts.length > 0) {
                        throw new Error(`Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(prepared.aliasConflicts)}`);
                    }
                    // If the on-disk Reference ID no longer matches the
                    // duplicate we grouped on, another process already changed
                    // it — leave it alone.
                    if (readReferenceId(prepared.parsed) !== target.referenceId) return content;
                    const normalized = ensureReferenceIdFrontmatter(prepared.parsed, {
                        classFallback,
                        forceId: nextId
                    });
                    if (!normalized.changed) return content;
                    const rebuiltYaml = stringifyYaml(normalized.frontmatter);
                    const updatedContent = buildFrontmatterDocument(rebuiltYaml, prepared.body);
                    const verification = verifyFrontmatterRewrite(updatedContent, {
                        originalBody: prepared.body,
                        verifyParsed: (verifiedFrontmatter) => readReferenceId(verifiedFrontmatter) === nextId
                    });
                    if (!verification.ok) {
                        throw new Error(verification.reason ?? 'Duplicate Reference ID repair verification failed.');
                    }
                    changed = true;
                    return updatedContent;
                });
                if (changed) result.updated += 1;
                else result.skipped += 1;
            } catch (error) {
                result.failed += 1;
                result.errors.push({
                    file: target.file,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    return result;
}
