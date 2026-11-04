import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';

type Entry = { pane: WorkspaceLeaf | null; path: string; pending: Promise<void> };
const entries = new WeakMap<WorkspaceLeaf, Entry>();

/** Open or reuse only the unpinned Canvas pane created for this Timetable. */
export async function openCanvasBelow(workspace: Workspace, table: WorkspaceLeaf, file: TFile): Promise<WorkspaceLeaf> {
    let state = entries.get(table);
    if (!state) { state = { pane: null, path: '', pending: Promise.resolve() }; entries.set(table, state); }
    const entry = state;
    let result: WorkspaceLeaf | null = null;
    const request = entry.pending.catch(() => {}).then(async () => {
        const pane = entry.pane;
        const owned = pane && workspace.getLeavesOfType('canvas').includes(pane)
            && !pane.getViewState().pinned && (pane.view as { file?: TFile | null }).file?.path === entry.path;
        if (owned) {
            if (entry.path !== file.path) await pane.openFile(file, { active: true });
            entry.path = file.path;
            await workspace.revealLeaf(pane);
            result = pane;
            return;
        }
        const created = workspace.createLeafBySplit(table, 'horizontal');
        try { await created.openFile(file, { active: true }); }
        catch (error) { created.detach(); throw error; }
        entry.pane = created;
        entry.path = file.path;
        result = created;
    });
    entry.pending = request;
    await request;
    if (!result) throw new Error('Canvas pane could not be opened');
    return result;
}
