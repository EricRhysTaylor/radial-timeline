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
 * A scene left with no membership returns to Main Plot.
 */

import { Notice, type App, type TFile } from 'obsidian';
import { canonicalizeFrontmatterKey, frontmatterValueToText } from '../utils/frontmatter';

export const MAIN_PLOT = 'Main Plot';

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
 * holds the scene's explicit memberships; an empty list is the implicit Main
 * Plot of a scene with no Subplot field.
 */
export function planSubplotMembership(current: string[], change: SubplotMembershipChange): string[] | null {
    const before = normalizeMemberships(current);
    let after: string[];
    if (change.kind === 'add') {
        if (before.includes(change.to)) return null;
        after = [...before, change.to];
    } else if (change.kind === 'move') {
        if (change.from === change.to) return null;
        after = before.filter(name => name !== change.from);
        if (!after.includes(change.to)) after.push(change.to);
    } else {
        after = before.filter(name => name !== change.from);
    }
    if (after.length === 0) after = [MAIN_PLOT];
    const unchanged = after.length === before.length && after.every((name, index) => name === before[index]);
    // An implicit Main Plot scene asked to stay in Main Plot is no change either.
    const stillImplicitMainPlot = before.length === 0 && after.length === 1 && after[0] === MAIN_PLOT;
    return unchanged || stillImplicitMainPlot ? null : after;
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
}

function cloneValue(value: unknown): unknown {
    return Array.isArray(value) ? [...(value as unknown[])] : value;
}

/**
 * Write memberships to the scene's Subplot field (its mapped key, else
 * "Subplot"): one name as a string, several as a list. Returns what was there.
 */
export async function writeSubplotMemberships(
    app: App,
    file: TFile,
    memberships: string[],
    mappings?: Record<string, string>
): Promise<SubplotFieldSnapshot> {
    const names = normalizeMemberships(memberships);
    let snapshot: SubplotFieldSnapshot = { key: 'Subplot', existed: false, value: undefined };
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const key = findSubplotKey(fm, mappings) ?? 'Subplot';
        snapshot = { key, existed: key in fm, value: cloneValue(fm[key]) };
        fm[key] = names.length === 1 ? names[0] : names;
    });
    return snapshot;
}

export async function restoreSubplotField(app: App, file: TFile, snapshot: SubplotFieldSnapshot): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (snapshot.existed) fm[snapshot.key] = cloneValue(snapshot.value);
        else delete fm[snapshot.key];
    });
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
    const before = readSubplotMemberships(app, file, options.mappings);
    const after = planSubplotMembership(before, change);
    if (!after) return null;
    const snapshot = await writeSubplotMemberships(app, file, after, options.mappings);
    options.onChanged?.();

    const fragment = activeWindow.createFragment();
    fragment.createSpan({ text: `${options.itemLabel}: ${formatMemberships(before)} → ${formatMemberships(after)}. ` });
    const undo = fragment.createEl('a', { text: 'Undo', href: '#' });
    const notice = new Notice(fragment, 8000);
    undo.onClickEvent((event) => {
        event.preventDefault();
        notice.hide();
        void restoreSubplotField(app, file, snapshot).then(() => {
            options.onChanged?.();
            new Notice(`${options.itemLabel}: back to ${formatMemberships(before)}.`, 3000);
        });
    });
    return after;
}
