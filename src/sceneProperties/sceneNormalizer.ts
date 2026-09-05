import type { TFile } from 'obsidian';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { collectFilesForAuditWithScope, runYamlAudit } from '../utils/yamlAudit';
import type { BackfillResult } from '../utils/yamlBackfill';
import { runYamlBackfill } from '../utils/yamlBackfill';
import type { DeleteResult, ReorderResult } from '../utils/yamlManager';
import { runYamlDeleteFields, runYamlReorder } from '../utils/yamlManager';
import {
    runReferenceIdBackfill,
    runReferenceIdDuplicateRepair,
    type ReferenceIdBackfillResult,
    type ReferenceIdDuplicateRepairResult,
} from '../utils/referenceIdBackfill';
import { getExcludeKeyPredicate, RESERVED_OBSIDIAN_KEYS } from '../utils/yamlTemplateNormalize';
import { readReferenceId } from '../utils/sceneIds';
import { buildScenePropertyDefinitions } from './scenePropertyAdapter';
import {
    computeSceneOrderDriftWhenAdvancedDisabled,
    resolveSceneExpectedKeys,
    resolveScenePropertyPolicy,
    splitSceneMissingKeys,
} from './scenePropertyPolicy';
import type {
    SceneNormalizationAudit,
    SceneNormalizationNote,
    SceneNormalizerContext,
} from './types';
import {
    getAdvancedMode,
    getScenePropertyState,
    hasAdvancedFields,
} from '../scenes/core/scenePropertyState';

function buildReason(note: SceneNormalizationNote): string {
    const reasons: string[] = [];
    if (note.missingCoreKeys.length > 0) {
        reasons.push(`missing core: ${note.missingCoreKeys.join(', ')}`);
    }
    if (note.missingAdvancedKeys.length > 0) {
        reasons.push(`missing advanced: ${note.missingAdvancedKeys.join(', ')}`);
    }
    if (note.missingSceneId) {
        reasons.push('missing scene id');
    }
    if (note.duplicateSceneId) {
        reasons.push(`duplicate scene id: ${note.duplicateSceneId}`);
    }
    if (note.extraKeys.length > 0) {
        reasons.push(`extra: ${note.extraKeys.join(', ')}`);
    }
    if (note.orderDrift) {
        reasons.push('field order differs from expected scene layout');
    }
    if (note.semanticWarnings.length > 0) {
        reasons.push(`warnings: ${note.semanticWarnings.join(' | ')}`);
    }
    if (note.safetyResult && note.safetyResult.status !== 'safe') {
        const label = note.safetyResult.status === 'dangerous' ? 'UNSAFE' : 'review';
        const issues = note.safetyResult.issues;
        const primary = issues[0]?.message ?? '';
        const extras = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
        reasons.push(primary ? `${label} — ${primary}${extras}` : `${label}`);
    }
    return reasons.join(' | ');
}

async function resolveSceneFiles(ctx: SceneNormalizerContext): Promise<TFile[]> {
    if (ctx.files) return ctx.files;
    return collectFilesForAuditWithScope(ctx.app, 'Scene', ctx.settings).files;
}

export async function analyzeScenes(
    ctx: SceneNormalizerContext
): Promise<SceneNormalizationAudit> {
    const files = await resolveSceneFiles(ctx);
    const rawAudit = await runYamlAudit({
        app: ctx.app,
        settings: ctx.settings,
        noteType: 'Scene',
        files,
        includeSafetyScan: ctx.includeSafetyScan ?? true,
    });

    const definitions = buildScenePropertyDefinitions(ctx.settings);
    const policy = resolveScenePropertyPolicy(ctx.settings);
    const expected = resolveSceneExpectedKeys(ctx.settings, definitions, policy);
    const rawNotesByPath = new Map(rawAudit.notes.map((note) => [note.file.path, note]));
    const mappings = getActiveFrontmatterMappings(ctx.settings);
    const notes: SceneNormalizationNote[] = [];

    for (const file of files) {
        if (rawAudit.unreadFiles.some((entry) => entry.path === file.path)) continue;

        const cache = ctx.app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) continue;

        const rawFrontmatter = cache.frontmatter as Record<string, unknown>;
        const normalizedFrontmatter = mappings
            ? normalizeFrontmatterKeys(rawFrontmatter, mappings)
            : rawFrontmatter;
        const noteKeys = Object.keys(normalizedFrontmatter).filter((key) => key !== 'position');
        const sceneState = getScenePropertyState({
            frontmatter: normalizedFrontmatter,
            settings: ctx.settings,
            definitions,
            policy,
        });
        const rawNote = rawNotesByPath.get(file.path);
        const splitMissing = splitSceneMissingKeys(rawNote?.missingFields ?? [], expected, policy);
        const toleratedInactiveAdvancedKeys = policy.advancedEnabled
            ? []
            : Object.keys(sceneState.advancedFields);
        const orderDrift = policy.advancedEnabled
            ? (rawNote?.orderDrift ?? false)
            : splitMissing.missingCoreKeys.length === 0
                ? computeSceneOrderDriftWhenAdvancedDisabled(noteKeys, expected)
                : false;
        const note: SceneNormalizationNote = {
            file,
            missingCoreKeys: splitMissing.missingCoreKeys,
            missingAdvancedKeys: splitMissing.missingAdvancedKeys,
            toleratedInactiveAdvancedKeys,
            extraKeys: rawNote?.extraKeys ?? [],
            orderDrift,
            missingSceneId: rawNote?.missingReferenceId ?? !readReferenceId(rawFrontmatter),
            duplicateSceneId: rawNote?.duplicateReferenceId,
            semanticWarnings: rawNote?.semanticWarnings ?? [],
            reason: '',
            safetyResult: rawNote?.safetyResult ?? rawAudit.safetyResults?.get(file),
        };
        note.reason = buildReason(note);

        const hasSchemaIssues = note.missingCoreKeys.length > 0
            || note.missingAdvancedKeys.length > 0
            || note.missingSceneId
            || !!note.duplicateSceneId
            || note.extraKeys.length > 0
            || note.orderDrift
            || note.semanticWarnings.length > 0;
        const hasSafetyIssues = note.safetyResult && note.safetyResult.status !== 'safe';
        if (hasSchemaIssues || hasSafetyIssues) {
            notes.push(note);
        }
    }

    return {
        notes,
        unreadFiles: rawAudit.unreadFiles,
        summary: {
            totalScenes: files.length,
            unreadScenes: rawAudit.unreadFiles.length,
            scenesWithMissingCore: notes.filter((note) => note.missingCoreKeys.length > 0).length,
            scenesWithMissingAdvanced: notes.filter((note) => note.missingAdvancedKeys.length > 0).length,
            scenesWithExtra: notes.filter((note) => note.extraKeys.length > 0).length,
            scenesWithDrift: notes.filter((note) => note.orderDrift).length,
            scenesMissingIds: notes.filter((note) => note.missingSceneId).length,
            scenesDuplicateIds: notes.filter((note) => !!note.duplicateSceneId).length,
            scenesWithWarnings: notes.filter((note) => note.semanticWarnings.length > 0).length,
            clean: Math.max(0, files.length - notes.length - rawAudit.unreadFiles.length),
            scenesUnsafe: notes.filter((note) => note.safetyResult?.status === 'dangerous').length,
            scenesSuspicious: notes.filter((note) => note.safetyResult?.status === 'suspicious').length,
        },
        rawAudit,
        safetyResults: rawAudit.safetyResults,
    };
}

export async function insertMissingCoreFields(
    ctx: SceneNormalizerContext & { audit?: SceneNormalizationAudit }
): Promise<BackfillResult> {
    const audit = ctx.audit ?? await analyzeScenes(ctx);
    const definitions = buildScenePropertyDefinitions(ctx.settings);
    const fieldsToInsert = Object.fromEntries(
        definitions.core.map((definition) => [definition.key, definition.defaultValue])
    );
    const files = audit.notes
        .filter((note) => note.missingCoreKeys.length > 0)
        .map((note) => note.file);
    const missingKeys = new Set(audit.notes.flatMap((note) => note.missingCoreKeys));
    const filteredFields = Object.fromEntries(
        [...missingKeys].map((key) => [key, fieldsToInsert[key] ?? ''])
    );
    return runYamlBackfill({
        app: ctx.app,
        files,
        fieldsToInsert: filteredFields,
        onProgress: ctx.onProgress,
        abortSignal: ctx.abortSignal,
    });
}

export async function insertMissingAdvancedFields(
    ctx: SceneNormalizerContext & { audit?: SceneNormalizationAudit }
): Promise<BackfillResult> {
    const policy = resolveScenePropertyPolicy(ctx.settings);
    const audit = ctx.audit ?? await analyzeScenes(ctx);
    if (!policy.advancedEnabled) {
        return { updated: 0, skipped: 0, failed: 0, errors: [] };
    }
    const definitions = buildScenePropertyDefinitions(ctx.settings);
    const defaults = Object.fromEntries(
        definitions.advanced.map((definition) => [definition.key, definition.defaultValue])
    );
    const files = audit.notes
        .filter((note) => note.missingAdvancedKeys.length > 0)
        .map((note) => note.file);
    const missingKeys = new Set(audit.notes.flatMap((note) => note.missingAdvancedKeys));
    const filteredFields = Object.fromEntries(
        [...missingKeys].map((key) => [key, defaults[key] ?? ''])
    );
    return runYamlBackfill({
        app: ctx.app,
        files,
        fieldsToInsert: filteredFields,
        onProgress: ctx.onProgress,
        abortSignal: ctx.abortSignal,
    });
}

export async function ensureSceneIds(
    ctx: SceneNormalizerContext
): Promise<ReferenceIdBackfillResult> {
    const files = await resolveSceneFiles(ctx);
    return runReferenceIdBackfill({
        app: ctx.app,
        files,
        noteType: 'Scene',
        onProgress: ctx.onProgress,
        abortSignal: ctx.abortSignal,
    });
}

export async function fixDuplicateSceneIds(
    ctx: SceneNormalizerContext
): Promise<ReferenceIdDuplicateRepairResult> {
    const files = await resolveSceneFiles(ctx);
    return runReferenceIdDuplicateRepair({
        app: ctx.app,
        files,
        noteType: 'Scene',
        onProgress: ctx.onProgress,
        abortSignal: ctx.abortSignal,
    });
}

export async function reorderSceneFields(
    ctx: SceneNormalizerContext & { audit?: SceneNormalizationAudit }
): Promise<ReorderResult> {
    const audit = ctx.audit ?? await analyzeScenes(ctx);
    const definitions = buildScenePropertyDefinitions(ctx.settings);
    const policy = resolveScenePropertyPolicy(ctx.settings);
    const expected = resolveSceneExpectedKeys(ctx.settings, definitions, policy);
    const files = audit.notes
        .filter((note) => note.orderDrift && note.safetyResult?.status !== 'dangerous')
        .map((note) => note.file);

    // RT authority for Scene reorder includes the standard exclude predicate
    // (id, scene analysis, repair metadata, etc.) plus any tolerated-inactive
    // advanced keys when advanced mode is disabled. These remain RT-managed
    // and are placed in the dynamic suffix zone — they are NOT foreign.
    const baseDynamic = getExcludeKeyPredicate('Scene', ctx.settings);
    const inactiveAdvancedSet = new Set(expected.toleratedInactiveKeys);
    const isDynamic = (key: string) => baseDynamic(key) || inactiveAdvancedSet.has(key);

    return runYamlReorder({
        app: ctx.app,
        files,
        canonicalOrder: expected.canonicalOrder,
        isDynamic,
        safetyResults: audit.safetyResults,
        onProgress: ctx.onProgress,
        abortSignal: ctx.abortSignal,
    });
}

export async function deleteAdvancedSceneFields(
    ctx: SceneNormalizerContext & { audit?: SceneNormalizationAudit }
): Promise<DeleteResult> {
    if (getAdvancedMode(ctx.settings) === 'enabled') {
        throw new Error('Advanced Properties are enabled. Disable them before removing advanced properties.');
    }
    const audit = ctx.audit ?? await analyzeScenes(ctx);
    const definitions = buildScenePropertyDefinitions(ctx.settings);
    const advancedKeys = definitions.advanced.map((definition) => definition.key);
    const protectedKeys = new Set([
        ...definitions.core.map((definition) => definition.key),
        ...RESERVED_OBSIDIAN_KEYS,
    ]);
    const excludeKey = getExcludeKeyPredicate('Scene', ctx.settings);
    const fieldsToDelete = advancedKeys.filter(
        (key) => !excludeKey(key) && !RESERVED_OBSIDIAN_KEYS.has(key)
    );
    const files = (await resolveSceneFiles(ctx))
        .filter((file) => {
            const note = audit.notes.find((entry) => entry.file.path === file.path);
            if (note?.safetyResult?.status === 'dangerous') return false;
            const cache = ctx.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter;
            if (!frontmatter) return false;
            return hasAdvancedFields({
                frontmatter,
                settings: ctx.settings,
                definitions,
            });
        });

    return runYamlDeleteFields({
        app: ctx.app,
        files,
        fieldsToDelete,
        protectedKeys,
        safetyResults: audit.safetyResults,
        onProgress: ctx.onProgress,
        abortSignal: ctx.abortSignal,
    });
}
