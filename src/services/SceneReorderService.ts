import { TFile, App, getFrontMatterInfo, parseYaml } from 'obsidian';
import type { TimelineItem } from '../types';
import { filterBeatsBySystem } from '../utils/gossamer';
import {
    comparePrefixTokens,
    extractPrefixToken,
    formatBeatDecimalPrefix,
    formatIntegerPrefix
} from '../utils/prefixOrder';
import { readReferenceId } from '../utils/sceneIds';

export interface SceneUpdate {
    path: string;
    newNumber: string;
    actNumber?: number;
    /** New subplot(s) to assign. If provided, replaces existing subplots. */
    subplots?: string[];
}

export interface RippleRenamePlan {
    updates: SceneUpdate[];
    checked: number;
    needRename: number;
    orderedPaths: string[];
    expectedNumbersByPath: Record<string, string>;
}

export interface RippleRenamePlanOptions {
    beatModel?: string;
}

export type SceneReorderProgressPhase = 'scan' | 'stage' | 'rename' | 'done';

export interface SceneReorderProgress {
    phase: SceneReorderProgressPhase;
    totalFiles: number;
    stagedFiles: number;
    renamedFiles: number;
}

export interface ApplySceneNumberUpdatesOptions {
    onProgress?: (progress: SceneReorderProgress) => void;
    verification?: {
        expectedOrderedPaths: string[];
        expectedNumbersByPath: Record<string, string>;
        movedItemPath?: string;
        expectedMovedIndex?: number;
    };
    onWarning?: (message: string) => void;
}

export class SceneReorderVerificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SceneReorderVerificationError';
    }
}

interface RenameOp {
    originalPath: string;
    tempPath: string;
    finalBasename: string;
    finalPath: string;
}

function reportProgress(
    options: ApplySceneNumberUpdatesOptions | undefined,
    progress: SceneReorderProgress
): void {
    try {
        options?.onProgress?.(progress);
    } catch {
        // Progress listeners are UI-only; never block rename work.
    }
}

/**
 * Apply scene updates - updates frontmatter and renames files.
 * Uses two-phase rename: ALL files go through temp namespace first.
 * This is the safest approach - never rename directly from old to new.
 */
export async function applySceneNumberUpdates(
    app: App,
    updates: SceneUpdate[],
    options?: ApplySceneNumberUpdatesOptions
): Promise<void> {
    const renameOps: RenameOp[] = [];
    const expectedReferenceIds = new Map<string, string>();
    
    // First pass: Update frontmatter and collect rename operations
    for (const update of updates) {
        const file = app.vault.getAbstractFileByPath(update.path);
        if (!(file instanceof TFile)) continue;
        const referenceId = await readReferenceIdFromFile(app, file);
        if (referenceId) {
            expectedReferenceIds.set(update.path, referenceId);
        }
        
        // Update frontmatter only when explicitly requested.
        // Ripple rename passes number-only updates and should not touch file contents.
        const needsFrontmatterUpdate = update.actNumber !== undefined || update.subplots !== undefined;
        if (needsFrontmatterUpdate) {
            await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                if (update.actNumber !== undefined) {
                    fm['Act'] = update.actNumber;
                }
                if (update.subplots !== undefined) {
                    if (update.subplots.length === 1) {
                        fm['Subplot'] = update.subplots[0];
                    } else if (update.subplots.length > 1) {
                        fm['Subplot'] = update.subplots;
                    }
                }
            });
        }

        // Check if rename is needed
        const currentBasename = file.basename;
        const finalBasename = buildRenamedBasename(currentBasename, update.newNumber);
        
        if (finalBasename !== currentBasename) {
            const parentPath = file.parent?.path ?? '';
            const prefix = parentPath ? `${parentPath}/` : '';
            // Simple temp name: z + final basename (sorts to end, easy to spot)
            const tempBasename = `z${finalBasename}`;
            
            renameOps.push({ 
                originalPath: file.path,
                tempPath: `${prefix}${tempBasename}.${file.extension}`,
                finalBasename,
                finalPath: `${prefix}${finalBasename}.${file.extension}`
            });
        }
    }

    const totalFiles = renameOps.length;
    reportProgress(options, { phase: 'scan', totalFiles, stagedFiles: 0, renamedFiles: 0 });
    if (totalFiles === 0) {
        reportProgress(options, { phase: 'done', totalFiles, stagedFiles: 0, renamedFiles: 0 });
        return;
    }
    
    // Phase 1: Rename ALL files to temp namespace
    // This clears ALL original positions
    let stagedFiles = 0;
    for (const op of renameOps) {
        const file = app.vault.getAbstractFileByPath(op.originalPath);
        if (file instanceof TFile) {
            await app.fileManager.renameFile(file, op.tempPath);
            stagedFiles += 1;
            reportProgress(options, { phase: 'stage', totalFiles, stagedFiles, renamedFiles: 0 });
        }
    }
    
    // Phase 2: Rename ALL files from temp to final
    // All target positions are now guaranteed free
    let renamedFiles = 0;
    for (const op of renameOps) {
        const file = app.vault.getAbstractFileByPath(op.tempPath);
        if (file instanceof TFile) {
            await app.fileManager.renameFile(file, op.finalPath);
            renamedFiles += 1;
            reportProgress(options, { phase: 'rename', totalFiles, stagedFiles: totalFiles, renamedFiles });
        }
    }

    reportProgress(options, { phase: 'done', totalFiles, stagedFiles: totalFiles, renamedFiles: totalFiles });

    if (options?.verification) {
        const verificationFailure = await verifySceneReorderResult(app, renameOps, expectedReferenceIds, options.verification);
        if (verificationFailure) {
            options.onWarning?.(verificationFailure);
            throw new SceneReorderVerificationError(verificationFailure);
        }
    }
}

function buildRenamedBasename(basename: string, newNumber: string): string {
    const match = basename.match(/^\s*(\d+(?:\.\d+)?)\s+(.*)$/);
    if (match) {
        const rest = match[2]?.trim() ?? '';
        return `${newNumber} ${rest}`.trim();
    }
    return `${newNumber} ${basename}`.trim();
}

interface RippleCandidate {
    path: string;
    itemType: 'Scene' | 'Beat';
    basename: string;
    actNumber: number;
    sourceIndex: number;
}

function extractBasename(path: string): string {
    const fileName = path.split('/').pop() ?? path;
    const extensionMatch = fileName.match(/\.([^.]+)$/);
    return extensionMatch ? fileName.slice(0, -(extensionMatch[0].length)) : fileName;
}

function getActiveBeatPaths(items: TimelineItem[], options?: RippleRenamePlanOptions): Set<string> | undefined {
    const beats = items.filter((item): item is TimelineItem & { path: string } =>
        item.itemType === 'Beat' && typeof item.path === 'string' && item.path.length > 0
    );
    if (beats.length === 0) return undefined;

    const filteredBeats = filterBeatsBySystem(
        beats.map((item) => ({
            path: item.path,
            "Beat Model": typeof item["Beat Model"] === 'string' ? item["Beat Model"] : undefined
        })),
        options?.beatModel
    );

    return new Set(filteredBeats.map(beat => beat.path));
}

function dedupeAndCollectEligible(items: TimelineItem[], activeBeatPaths?: Set<string>): RippleCandidate[] {
    const byPath = new Map<string, RippleCandidate>();
    items.forEach((item, sourceIndex) => {
        const path = item.path;
        if (!path) return;
        if (item.itemType !== 'Scene' && item.itemType !== 'Beat') return;
        if (item.itemType === 'Beat' && activeBeatPaths && !activeBeatPaths.has(path)) return;
        if (byPath.has(path)) return;
        const actFromNumber = item.actNumber;
        const parsedAct = Number(item.act ?? 1);
        const actNumber = Number.isFinite(actFromNumber) && (actFromNumber as number) > 0
            ? (actFromNumber as number)
            : (Number.isFinite(parsedAct) && parsedAct > 0 ? parsedAct : 1);
        byPath.set(path, {
            path,
            itemType: item.itemType,
            basename: extractBasename(path),
            actNumber,
            sourceIndex
        });
    });
    return Array.from(byPath.values());
}

function buildCanonicalOrder(candidates: RippleCandidate[]): RippleCandidate[] {
    const byAct = new Map<number, RippleCandidate[]>();
    for (const candidate of candidates) {
        if (!byAct.has(candidate.actNumber)) byAct.set(candidate.actNumber, []);
        byAct.get(candidate.actNumber)!.push(candidate);
    }

    const orderedActs = Array.from(byAct.keys()).sort((a, b) => a - b);
    const ordered: RippleCandidate[] = [];
    for (const act of orderedActs) {
        const actItems = byAct.get(act) ?? [];
        actItems.sort((a, b) => {
            const aPos = extractPrefixToken(a.basename);
            const bPos = extractPrefixToken(b.basename);
            const prefixCmp = comparePrefixTokens(aPos, bPos);
            if (prefixCmp !== 0) return prefixCmp;

            const basenameCmp = a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' });
            if (basenameCmp !== 0) return basenameCmp;

            const pathCmp = a.path.localeCompare(b.path);
            if (pathCmp !== 0) return pathCmp;

            return a.sourceIndex - b.sourceIndex;
        });
        ordered.push(...actItems);
    }
    return ordered;
}

/**
 * Build a targeted manuscript-wide ripple rename plan.
 * Expects input already filtered to the active beat set.
 */
export function buildRippleRenamePlan(items: TimelineItem[], options?: RippleRenamePlanOptions): RippleRenamePlan {
    const activeBeatPaths = getActiveBeatPaths(items, options);
    const candidates = dedupeAndCollectEligible(items, activeBeatPaths);
    const ordered = buildCanonicalOrder(candidates);
    const updates: SceneUpdate[] = [];
    const expectedNumbersByPath: Record<string, string> = {};
    const beatMinorByMajor = new Map<string, number>();
    let nextSceneNumber = 1;
    let currentScenePrefix = '0';

    ordered.forEach((entry) => {
        const currentBasename = entry.basename;
        const newNumber = entry.itemType === 'Scene'
            ? (() => {
                const prefix = formatIntegerPrefix(nextSceneNumber);
                currentScenePrefix = prefix;
                beatMinorByMajor.set(prefix, 0);
                nextSceneNumber += 1;
                return prefix;
            })()
            : (() => {
                const major = currentScenePrefix || '0';
                const nextMinor = (beatMinorByMajor.get(major) ?? 0) + 1;
                beatMinorByMajor.set(major, nextMinor);
                return formatBeatDecimalPrefix(major, nextMinor, 2);
            })();
        expectedNumbersByPath[entry.path] = newNumber;
        const finalBasename = buildRenamedBasename(currentBasename, newNumber);
        if (finalBasename !== currentBasename) {
            updates.push({ path: entry.path, newNumber });
        }
    });

    return {
        updates,
        checked: ordered.length,
        needRename: updates.length,
        orderedPaths: ordered.map(entry => entry.path),
        expectedNumbersByPath,
    };
}

async function readReferenceIdFromFile(app: App, file: TFile): Promise<string | undefined> {
    try {
        const content = await app.vault.read(file);
        const info = getFrontMatterInfo(content);
        if (!info.frontmatter) return undefined;
        const parsed = parseYaml(info.frontmatter);
        if (!parsed || typeof parsed !== 'object') return undefined;
        return readReferenceId(parsed as Record<string, unknown>);
    } catch {
        return undefined;
    }
}

async function verifySceneReorderResult(
    app: App,
    renameOps: RenameOp[],
    expectedReferenceIds: Map<string, string>,
    options: NonNullable<ApplySceneNumberUpdatesOptions['verification']>
): Promise<string | null> {
    const finalPathByOriginal = new Map<string, string>();
    renameOps.forEach((op) => finalPathByOriginal.set(op.originalPath, op.finalPath));
    const resolvePath = (originalPath: string): string => finalPathByOriginal.get(originalPath) ?? originalPath;
    const resolvedPaths = options.expectedOrderedPaths.map(resolvePath);

    if (new Set(resolvedPaths).size !== resolvedPaths.length) {
        return 'RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.';
    }

    for (const path of resolvedPaths) {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            return 'RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.';
        }
    }

    for (const originalPath of options.expectedOrderedPaths) {
        const expectedPrefix = options.expectedNumbersByPath[originalPath];
        if (!expectedPrefix) continue;
        const finalPath = resolvePath(originalPath);
        const file = app.vault.getAbstractFileByPath(finalPath);
        if (!(file instanceof TFile)) {
            return 'RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.';
        }
        if (extractPrefixToken(file.basename) !== expectedPrefix) {
            return 'RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.';
        }
    }

    for (const [originalPath, expectedId] of expectedReferenceIds.entries()) {
        const finalPath = resolvePath(originalPath);
        const file = app.vault.getAbstractFileByPath(finalPath);
        if (!(file instanceof TFile)) {
            return 'RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.';
        }
        const actualId = await readReferenceIdFromFile(app, file);
        if (actualId !== expectedId) {
            return 'RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.';
        }
    }

    if (typeof options.expectedMovedIndex === 'number' && options.movedItemPath) {
        const resolvedMovedPath = resolvePath(options.movedItemPath);
        if (resolvedPaths[options.expectedMovedIndex] !== resolvedMovedPath) {
            return 'RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.';
        }
    }

    return null;
}
