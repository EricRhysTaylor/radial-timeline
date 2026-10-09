/*
 * Subplot membership: move, add, or remove one subplot on a scene.
 *
 * One mutation path for the timeline's ring drag and the scene menu
 * (docs/engineering/plans/welcome-scrivener-and-subplot-ring-drag-plan.md,
 * Phase 3). A membership change edits only the scene's Subplot field: it never
 * renames a file, reorders the manuscript, or changes Act or When.
 *
 * For memberships A, B, C:
 *   move A to D: B, C, D        add D: A, B, C, D
 *   move A to C: B, C           add C: no change
 *   move A to A: no change      remove A: B, C
 * A scene with no Subplot field is in Main Plot, so dragging it moves Main
 * Plot and Shift-dragging keeps it. A scene left with no membership returns
 * to Main Plot.
 */

import { Notice, type App, type TFile } from 'obsidian';
import { canonicalizeFrontmatterKey, frontmatterValueToText } from '../utils/frontmatter';

export const MAIN_PLOT = 'Main Plot';

// Throwing from processFrontMatter aborts its YAML serialization/write.
const SKIP_SUBPLOT_WRITE = new Error('Subplot write not required');

export type SubplotMembershipChange =
    | { kind: 'move'; from: string; to: string }
    | { kind: 'add'; to: string }
    | { kind: 'remove'; from: string };

function normalizeMemberships(memberships: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of memberships) {
        const name = raw.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

/**
 * The memberships after the change, or null when nothing changes. `current`
 * holds the scene's explicit memberships; an empty list (no Subplot field)
 * means Main Plot.
 */
export function planSubplotMembership(current: string[], change: SubplotMembershipChange): string[] | null {
    const explicit = normalizeMemberships(current);
    const before = explicit.length > 0 ? explicit : [MAIN_PLOT];
    let after: string[];
    if (change.kind === 'add') {
        if (before.includes(change.to)) return null;
        after = [...before, change.to];
    } else if (change.kind === 'move') {
        if (change.from === change.to || !before.includes(change.from)) return null;
        after = before.filter(name => name !== change.from);
        if (!after.includes(change.to)) after.push(change.to);
    } else {
        after = before.filter(name => name !== change.from);
    }
    if (after.length === 0) after = [MAIN_PLOT];
    const unchanged = after.length === before.length && after.every((name, index) => name === before[index]);
    return unchanged ? null : after;
}

/** "Move The Shipwreck → The Keeper's Letters", "Add The Keeper's Letters", "Remove The Shipwreck". */
export function describeSubplotMembershipChange(change: SubplotMembershipChange): string {
    if (change.kind === 'move') return `Move ${change.from} → ${change.to}`;
    if (change.kind === 'add') return `Add ${change.to}`;
    return `Remove ${change.from}`;
}

export function formatMemberships(memberships: string[]): string {
    const names = normalizeMemberships(memberships);
    return names.length > 0 ? names.join(', ') : MAIN_PLOT;
}

/** The raw frontmatter key that holds Subplot under the active key mappings, if present. */
export function findSubplotKey(frontmatter: Record<string, unknown>, mappings?: Record<string, string>): string | undefined {
    return Object.keys(frontmatter).find(key => canonicalizeFrontmatterKey(key, mappings) === 'Subplot');
}

function subplotValueToList(value: unknown): string[] {
    if (value === null || value === undefined || value === '') return [];
    const values: unknown[] = Array.isArray(value) ? value : [value];
    return normalizeMemberships(values.map(entry => frontmatterValueToText(entry)));
}

/** The scene's explicit memberships from the metadata cache ([] = implicit Main Plot). */
export function readSubplotMemberships(app: App, file: TFile, mappings?: Record<string, string>): string[] {
    const frontmatter = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    const key = findSubplotKey(frontmatter, mappings);
    return key ? subplotValueToList(frontmatter[key]) : [];
}

/** The Subplot field as it was, so an undo puts back exactly that. */
export interface SubplotFieldSnapshot {
    key: string;
    existed: boolean;
    value: unknown;
    /** Value this operation wrote; Undo must not overwrite a later edit. */
    appliedValue: string | string[];
}

function cloneValue(value: unknown): unknown {
    return Array.isArray(value) ? [...(value as unknown[])] : value;
}

function writeMembershipsToFrontmatter(
    fm: Record<string, unknown>,
    memberships: string[],
    mappings?: Record<string, string>
): SubplotFieldSnapshot {
    const names = normalizeMemberships(memberships);
    const key = findSubplotKey(fm, mappings) ?? 'Subplot';
    const appliedValue = names.length === 1 ? names[0] : names;
    const snapshot = {
        key,
        existed: key in fm,
        value: cloneValue(fm[key]),
        appliedValue: Array.isArray(appliedValue) ? [...appliedValue] : appliedValue,
    };
    fm[key] = appliedValue;
    return snapshot;
}

/** Write only Subplot and remember both the original and applied values. */
export async function writeSubplotMemberships(
    app: App,
    file: TFile,
    memberships: string[],
    mappings?: Record<string, string>
): Promise<SubplotFieldSnapshot> {
    let snapshot!: SubplotFieldSnapshot;
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        snapshot = writeMembershipsToFrontmatter(fm, memberships, mappings);
    });
    return snapshot;
}

function equalsAppliedValue(value: unknown, applied: string | string[]): boolean {
    if (!Array.isArray(applied)) return value === applied;
    return Array.isArray(value) && value.length === applied.length && value.every((name, index) => name === applied[index]);
}

/** Return false if another operation or the author has since changed Subplot. */
export async function restoreSubplotField(app: App, file: TFile, snapshot: SubplotFieldSnapshot): Promise<boolean> {
    try {
        await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            if (!equalsAppliedValue(fm[snapshot.key], snapshot.appliedValue)) throw SKIP_SUBPLOT_WRITE;
            if (snapshot.existed) fm[snapshot.key] = cloneValue(snapshot.value);
            else delete fm[snapshot.key];
        });
        return true;
    } catch (error) {
        if (error !== SKIP_SUBPLOT_WRITE) throw error;
        return false;
    }
}

/**
 * Apply a membership change and offer Undo. Resolves to the new memberships,
 * or null when the change was a no-op.
 */
export async function applySubplotMembershipChange(
    app: App,
    file: TFile,
    change: SubplotMembershipChange,
    options: { mappings?: Record<string, string>; itemLabel: string; onChanged?: () => void }
): Promise<string[] | null> {
    // Plan and write against the same live frontmatter. The metadata cache
    // may still describe the previous edit while a drag confirmation is open.
    let before: string[] = [];
    let after!: string[];
    let undoSnapshot!: SubplotFieldSnapshot;
    try {
        await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            const key = findSubplotKey(fm, options.mappings);
            before = key ? subplotValueToList(fm[key]) : [];
            const planned = planSubplotMembership(before, change);
            if (!planned) throw SKIP_SUBPLOT_WRITE;
            after = planned;
            undoSnapshot = writeMembershipsToFrontmatter(fm, after, options.mappings);
        });
    } catch (error) {
        if (error !== SKIP_SUBPLOT_WRITE) throw error;
        return null;
    }
    options.onChanged?.();

    const fragment = activeWindow.createFragment();
    fragment.createSpan({ text: `${options.itemLabel}: ${formatMemberships(before)} → ${formatMemberships(after)}. ` });
    const undo = fragment.createEl('a', { text: 'Undo', href: '#' });
    const notice = new Notice(fragment, 8000);
    undo.onClickEvent((event) => {
        event.preventDefault();
        notice.hide();
        void restoreSubplotField(app, file, undoSnapshot).then((restored) => {
            if (!restored) {
                new Notice(`${options.itemLabel}: Undo skipped because its subplots changed after this operation.`, 5000);
                return;
            }
            options.onChanged?.();
            new Notice(`${options.itemLabel}: back to ${formatMemberships(before)}.`, 3000);
        }).catch((error: unknown) => {
            console.error('Subplot Undo failed:', error);
            new Notice(`${options.itemLabel}: Undo failed. Check the scene's subplots before continuing.`, 5000);
        });
    });
    return after;
}
