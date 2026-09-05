/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Matter repair — plans and applies Class / Role / BodyMode repairs on the
 * active book's front- and back-matter notes.
 *
 * `planMatterRepairForNote` is pure: normalized frontmatter in, repair issue
 * (or null) out. `buildMatterRepairPlan` walks the vault to collect those
 * issues; `applyMatterRepairPlan` writes the repairable ones back through
 * `processFrontMatter`.
 */

import type { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getActiveBookExportContext } from '../utils/exportContext';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { isPathInFolderScope } from '../utils/pathScope';
import { normalizeMatterClassValue } from '../utils/matterMeta';

export type MatterRepairReason = 'missing-class' | 'legacy-matter' | 'invalid-role' | 'invalid-bodymode';

export interface MatterRepairChange {
    reasons: MatterRepairReason[];
    nextClass?: 'Frontmatter' | 'Backmatter';
    clearRole?: boolean;
    nextBodyMode?: 'plain';
}

export interface MatterRepairIssue extends MatterRepairChange {
    file: TFile;
}

export interface MatterRepairPlan {
    sourceFolder: string;
    issues: MatterRepairIssue[];
    repairableIssues: MatterRepairIssue[];
    unresolvedIssues: MatterRepairIssue[];
}

export interface MatterRepairResult {
    updated: number;
    attempted: number;
    unresolved: number;
    sourceFolder: string;
    repairedPaths: string[];
}

const VALID_MATTER_ROLES = new Set([
    'title-page',
    'copyright',
    'dedication',
    'epigraph',
    'acknowledgments',
    'about-author',
]);

function normalizeLookupKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getField(source: Record<string, unknown>, aliases: string[]): { key: string; value: unknown } | null {
    const aliasSet = new Set(aliases.map(normalizeLookupKey));
    for (const [key, value] of Object.entries(source)) {
        if (aliasSet.has(normalizeLookupKey(key))) return { key, value };
    }
    return null;
}

function deleteAliases(frontmatter: Record<string, unknown>, aliases: string[]): void {
    const aliasSet = new Set(aliases.map(normalizeLookupKey));
    for (const key of Object.keys(frontmatter)) {
        if (aliasSet.has(normalizeLookupKey(key))) delete frontmatter[key];
    }
}

function normalizeSideToken(value: unknown): 'front' | 'back' | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (normalized === 'front' || normalized === 'frontmatter') return 'front';
    if (normalized === 'back' || normalized === 'backmatter') return 'back';
    return null;
}

function resolveLegacySide(normalized: Record<string, unknown>, legacyMatterValue: unknown): 'front' | 'back' | null {
    const directSide = normalizeSideToken(getField(normalized, ['Side'])?.value);
    if (directSide) return directSide;
    const directClass = normalizeSideToken(getField(normalized, ['MatterClass'])?.value);
    if (directClass) return directClass;
    if (!legacyMatterValue || typeof legacyMatterValue !== 'object' || Array.isArray(legacyMatterValue)) {
        return normalizeSideToken(legacyMatterValue);
    }
    const legacy = legacyMatterValue as Record<string, unknown>;
    return normalizeSideToken(legacy.side)
        || normalizeSideToken(legacy.Side)
        || normalizeSideToken(legacy.class)
        || normalizeSideToken(legacy.Class);
}

function roleRepair(value: unknown): { invalid: boolean; clearRole?: boolean } {
    if (value === undefined || value === null) return { invalid: false };
    if (typeof value !== 'string') return { invalid: true, clearRole: true };
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return { invalid: true, clearRole: true };
    return VALID_MATTER_ROLES.has(normalized) ? { invalid: false } : { invalid: true, clearRole: true };
}

function bodyModeRepair(value: unknown): { invalid: boolean; nextBodyMode?: 'plain' } {
    if (value === undefined || value === null) return { invalid: false };
    if (typeof value !== 'string') return { invalid: true, nextBodyMode: 'plain' };
    const normalized = value.trim().toLowerCase();
    return normalized === 'plain' || normalized === 'latex' ? { invalid: false } : { invalid: true, nextBodyMode: 'plain' };
}

/**
 * Decide what, if anything, needs repairing on one note's normalized
 * frontmatter. Returns null when the note carries no matter signal at all or
 * is already well-formed.
 */
export function planMatterRepairForNote(normalized: Record<string, unknown>): MatterRepairChange | null {
    const classValue = normalizeMatterClassValue(normalized.Class);
    const legacyMatterValue = getField(normalized, ['Matter', 'matter'])?.value;
    const roleValue = normalized.Role;
    const bodyModeValue = normalized.BodyMode;
    const useBookMetaValue = normalized.UseBookMeta;

    const hasMatterSignal = !!classValue
        || legacyMatterValue !== undefined
        || roleValue !== undefined
        || bodyModeValue !== undefined
        || useBookMetaValue !== undefined;
    if (!hasMatterSignal) return null;

    const reasons: MatterRepairReason[] = [];
    let nextClass: MatterRepairChange['nextClass'];
    if (classValue === 'frontmatter') {
        nextClass = 'Frontmatter';
    } else if (classValue === 'backmatter') {
        nextClass = 'Backmatter';
    } else {
        reasons.push('missing-class');
        const side = resolveLegacySide(normalized, legacyMatterValue);
        if (side === 'front') nextClass = 'Frontmatter';
        if (side === 'back') nextClass = 'Backmatter';
    }
    if (legacyMatterValue !== undefined) reasons.push('legacy-matter');

    const role = roleRepair(roleValue);
    if (role.invalid) reasons.push('invalid-role');
    const bodyMode = bodyModeRepair(bodyModeValue);
    if (bodyMode.invalid) reasons.push('invalid-bodymode');

    if (reasons.length === 0) return null;
    return { reasons, nextClass, clearRole: role.clearRole, nextBodyMode: bodyMode.nextBodyMode };
}

export function buildMatterRepairPlan(plugin: RadialTimelinePlugin): MatterRepairPlan {
    const sourceFolder = getActiveBookExportContext(plugin).sourceFolder.trim();
    if (!sourceFolder) {
        return { sourceFolder: '', issues: [], repairableIssues: [], unresolvedIssues: [] };
    }
    const mappings = getActiveFrontmatterMappings(plugin.settings);
    const issues: MatterRepairIssue[] = [];
    for (const file of plugin.app.vault.getMarkdownFiles()) {
        if (!isPathInFolderScope(file.path, sourceFolder)) continue;
        const raw = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!raw) continue;
        const change = planMatterRepairForNote(normalizeFrontmatterKeys(raw, mappings));
        if (change) issues.push({ file, ...change });
    }
    return {
        sourceFolder,
        issues,
        repairableIssues: issues.filter(issue => !!issue.nextClass),
        unresolvedIssues: issues.filter(issue => !issue.nextClass)
    };
}

/** Apply one repair to a raw frontmatter object in place. Returns true when anything changed. */
export function applyMatterRepairToFrontmatter(frontmatter: Record<string, unknown>, change: MatterRepairChange): boolean {
    if (!change.nextClass) return false;
    const before = JSON.stringify(frontmatter);
    deleteAliases(frontmatter, ['Class']);
    frontmatter.Class = change.nextClass;
    if (change.clearRole) deleteAliases(frontmatter, ['Role']);
    if (change.nextBodyMode) {
        deleteAliases(frontmatter, ['BodyMode']);
        frontmatter.BodyMode = change.nextBodyMode;
    }
    deleteAliases(frontmatter, ['Matter', 'matter']);
    return before !== JSON.stringify(frontmatter);
}

export async function applyMatterRepairPlan(plugin: RadialTimelinePlugin, plan: MatterRepairPlan): Promise<MatterRepairResult> {
    let updated = 0;
    const repairedPaths: string[] = [];
    for (const issue of plan.repairableIssues) {
        let changed = false;
        await plugin.app.fileManager.processFrontMatter(issue.file, (frontmatter) => {
            changed = applyMatterRepairToFrontmatter(frontmatter as Record<string, unknown>, issue);
        });
        if (changed) {
            updated += 1;
            repairedPaths.push(issue.file.path);
        }
    }
    return {
        updated,
        attempted: plan.repairableIssues.length,
        unresolved: plan.unresolvedIssues.length,
        sourceFolder: plan.sourceFolder,
        repairedPaths
    };
}
