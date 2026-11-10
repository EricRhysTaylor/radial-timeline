/**
 * Ephemeral shared selection; no plugin state is written into author notes. A null key selects every reference the
 * scene declares (hovering its source circle on the timeline).
 */
export interface ReferenceSelection { path: string; key: string | null; reveal?: boolean }

/** Whether a selection covers one reference: that reference, or its whole scene. */
export function selectsReference(selection: ReferenceSelection | null, path: string | undefined, key: string | undefined): boolean {
    return !!selection && selection.path === path && (selection.key === null || selection.key === key);
}
let hovered: ReferenceSelection | null = null;
let pinned: ReferenceSelection | null = null;
const listeners = new Set<(selection: ReferenceSelection | null) => void>();
export const currentReferenceSelection = (): ReferenceSelection | null => pinned ?? hovered;
function publish(selection = currentReferenceSelection()): void { listeners.forEach(listener => listener(selection)); }
export function hoverTimeReference(selection: ReferenceSelection | null): void {
    if (pinned) return;
    hovered = selection; publish();
}
export function pinTimeReference(selection: ReferenceSelection | null): void {
    pinned = selection;
    hovered = null;
    // Reveal once on activation; pointer movement must not reopen a collapsed row.
    publish(pinned ? { ...pinned, reveal: true } : null);
}
export function onReferenceSelection(listener: (selection: ReferenceSelection | null) => void): () => void {
    listeners.add(listener); listener(currentReferenceSelection());
    return () => { listeners.delete(listener); };
}

/** Array locators are valid only while their captured declarations still exist. */
export function reconcileReferenceSelection(path: string, validKeys: ReadonlySet<string>): void {
    let changed = false;
    const stale = (selection: ReferenceSelection | null): boolean =>
        selection?.path === path && (selection.key === null ? validKeys.size === 0 : !validKeys.has(selection.key));
    if (stale(hovered)) { hovered = null; changed = true; }
    if (stale(pinned)) { pinned = null; changed = true; }
    if (changed) publish();
}
