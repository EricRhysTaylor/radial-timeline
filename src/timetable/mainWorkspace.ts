import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';

type LayoutNode = { id: string; type: string; children?: LayoutNode[]; direction?: string; state?: { type?: string; state?: { file?: string } }; [key: string]: unknown };
type WorkspaceLayout = { main: LayoutNode; active?: string; [key: string]: unknown };
type LayoutKind = 'beside' | 'below' | 'timeline' | 'canvas';

function leaves(node: LayoutNode): LayoutNode[] {
    return node.type === 'leaf' ? [node] : (node.children ?? []).flatMap(leaves); // SAFE: a split without children has no leaves
}

/** Rebuild the main area, reusing views needed by the chosen layout. Pinned tabs stay, behind the Timetable. */
export function planMainWorkspace(layout: WorkspaceLayout, tableId: string, file: TFile, kind: LayoutKind, makeId: () => string, pinned: ReadonlySet<string> = new Set()): { layout: WorkspaceLayout; tableId: string; referenceId: string } {
    const all = leaves(layout.main);
    const table = all.find(node => node.id === tableId);
    if (!table || table.state?.type !== 'bases') throw new Error('Timetable is no longer in the main workspace.');
    const type = kind === 'canvas' ? 'canvas' : 'markdown';
    const target = all.find(node => node.id !== tableId && node.state?.type === type && node.state.state?.file === file.path)
        ?? { id: makeId(), type: 'leaf', state: { type, state: { file: file.path } } };
    const timeline = kind === 'timeline' ? all.find(node => node.state?.type === 'radial-timeline')
        ?? { id: makeId(), type: 'leaf', state: { type: 'radial-timeline', state: {} } } : null;
    const tabs = (children: LayoutNode[]): LayoutNode => ({ id: makeId(), type: 'tabs', children });
    const kept = all.filter(node => pinned.has(node.id) && node !== table && node !== target && node !== timeline);
    const tableTabs = tabs([table, ...kept]);
    const referenceTabs = tabs([target]);
    const pair: LayoutNode = { id: makeId(), type: 'split', direction: 'horizontal', children: [tableTabs, referenceTabs] };
    const main: LayoutNode = { id: layout.main.id, type: 'split', direction: 'vertical', children:
        kind === 'timeline' ? [tabs([timeline!]), pair] : kind === 'beside' ? [tableTabs, referenceTabs] : [pair] };
    return { layout: { ...layout, main, active: table.id }, tableId: table.id, referenceId: target.id };
}

const pending = new WeakMap<Workspace, Promise<void>>();

export async function applyMainWorkspace(workspace: Workspace, table: WorkspaceLeaf, file: TFile, kind: LayoutKind): Promise<{ table: WorkspaceLeaf; reference: WorkspaceLeaf }> {
    let result: { table: WorkspaceLeaf; reference: WorkspaceLeaf } | undefined;
    const request = (pending.get(workspace) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const original = workspace.getLayout() as WorkspaceLayout;
        const tableNode = leaves(original.main).find(node => workspace.getLeafById(node.id) === table);
        if (!tableNode) throw new Error('Timetable is no longer in the main workspace.');
        const pinned = new Set(leaves(original.main).filter(node => workspace.getLeafById(node.id)?.getViewState().pinned === true).map(node => node.id));
        const plan = planMainWorkspace(original, tableNode.id, file, kind, () => crypto.randomUUID().replace(/-/g, ''), pinned);
        try {
            await workspace.changeLayout(plan.layout);
            const newTable = workspace.getLeafById(plan.tableId);
            const reference = workspace.getLeafById(plan.referenceId);
            if (!newTable || !reference) throw new Error('The requested workspace could not be opened.');
            result = { table: newTable, reference };
        } catch (error) {
            await workspace.changeLayout(original);
            throw error;
        }
    });
    pending.set(workspace, request);
    await request;
    if (!result) throw new Error('The requested workspace could not be opened.');
    return result;
}
