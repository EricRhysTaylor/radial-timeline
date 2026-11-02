import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';

type Direction = 'vertical' | 'horizontal';
type Entry = { pane: WorkspaceLeaf | null; path: string; direction: Direction; pending: Promise<void> };

// A Bases view can be recreated while its leaf remains open. Keep ownership on
// the leaf, and serialize requests so rapid selections cannot create duplicates.
const entries = new WeakMap<WorkspaceLeaf, Entry>();

export function currentOutlineReference(workspace: Workspace, table: WorkspaceLeaf): TFile | null {
    const entry = entries.get(table);
    const pane = entry?.pane;
    if (!entry || !pane || !workspace.getLeavesOfType('markdown').includes(pane) || pane.getViewState().pinned) return null;
    const file = (pane.view as { file?: TFile | null }).file;
    return file?.path === entry.path ? file : null;
}

export async function openOutlineReference(workspace: Workspace, table: WorkspaceLeaf, file: TFile, direction: Direction): Promise<WorkspaceLeaf> {
    let entry = entries.get(table);
    if (!entry) {
        entry = { pane: null, path: '', direction, pending: Promise.resolve() };
        entries.set(table, entry);
    }
    const state = entry;
    let result: WorkspaceLeaf | undefined;
    const request = state.pending.catch(() => {}).then(async () => {
        const current = state.pane;
        const owned = current && workspace.getLeavesOfType('markdown').includes(current)
            && !current.getViewState().pinned && (current.view as { file?: TFile | null }).file?.path === state.path;
        if (owned && state.direction === direction) {
            if (state.path !== file.path) await current.openFile(file, { active: true });
            state.path = file.path;
            await workspace.revealLeaf(current);
            result = current;
            return;
        }
        const pane = workspace.createLeafBySplit(table, direction);
        try {
            await pane.openFile(file, { active: true });
        } catch (error) {
            pane.detach();
            throw error;
        }
        if (owned) current.detach();
        state.pane = pane;
        state.path = file.path;
        state.direction = direction;
        result = pane;
    });
    state.pending = request;
    await request;
    if (!result) throw new Error('Could not open outline reference');
    return result;
}
