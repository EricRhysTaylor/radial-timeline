/** Ephemeral shared selection; no plugin state is written into author notes. */
export interface ReferenceSelection { path: string; key: string; ring?: string; reveal?: boolean }
let hovered: ReferenceSelection | null = null;
let pinned: ReferenceSelection | null = null;
const listeners = new Set<(selection: ReferenceSelection | null) => void>();
export const currentReferenceSelection = (): ReferenceSelection | null => hovered ?? pinned;
function publish(selection = currentReferenceSelection()): void { listeners.forEach(listener => listener(selection)); }
export function hoverTimeReference(selection: ReferenceSelection | null): void { hovered = selection; publish(); }
export function pinTimeReference(selection: ReferenceSelection | null): void {
    pinned = selection;
    // Reveal once on activation; restoring a pin after hover must not reopen a collapsed row.
    publish(pinned ? { ...pinned, reveal: true } : null);
}
export function onReferenceSelection(listener: (selection: ReferenceSelection | null) => void): () => void {
    listeners.add(listener); listener(currentReferenceSelection());
    return () => { listeners.delete(listener); };
}

/** Array locators are valid only while their captured declarations still exist. */
export function reconcileReferenceSelection(path: string, validKeys: ReadonlySet<string>): void {
    let changed = false;
    if (hovered?.path === path && !validKeys.has(hovered.key)) { hovered = null; changed = true; }
    if (pinned?.path === path && !validKeys.has(pinned.key)) { pinned = null; changed = true; }
    if (changed) publish();
}
