import { describe, expect, it, vi } from 'vitest';
import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { openCanvasBelow } from './canvasWorkspace';

function fixture() {
    const leaves: WorkspaceLeaf[] = [];
    const table = {} as WorkspaceLeaf;
    const createLeafBySplit = vi.fn(() => {
        const pane = {
            view: { file: null as TFile | null }, pinned: false,
            getViewState() { return { pinned: this.pinned }; },
            async openFile(file: TFile) { this.view.file = file; },
            detach() { leaves.splice(leaves.indexOf(pane as unknown as WorkspaceLeaf), 1); },
        };
        leaves.push(pane as unknown as WorkspaceLeaf);
        return pane as unknown as WorkspaceLeaf;
    });
    const workspace = { createLeafBySplit, getLeavesOfType: () => leaves, revealLeaf: vi.fn() } as unknown as Workspace;
    return { leaves, table, createLeafBySplit, workspace };
}
const file = (path: string) => ({ path }) as TFile;

describe('Canvas workspace', () => {
    it('opens below the timetable and reuses its own pane for rapid selections', async () => {
        const f = fixture();
        const [first, second] = await Promise.all([openCanvasBelow(f.workspace, f.table, file('one.canvas')), openCanvasBelow(f.workspace, f.table, file('two.canvas'))]);
        expect(first).toBe(second);
        expect(f.createLeafBySplit).toHaveBeenCalledOnce();
        expect(f.createLeafBySplit).toHaveBeenCalledWith(f.table, 'horizontal');
        expect((second.view as { file: TFile }).file.path).toBe('two.canvas');
    });
    it('preserves a pinned or repurposed pane', async () => {
        const f = fixture();
        const first = await openCanvasBelow(f.workspace, f.table, file('one.canvas'));
        (first as unknown as { pinned: boolean }).pinned = true;
        const second = await openCanvasBelow(f.workspace, f.table, file('two.canvas'));
        (second.view as { file: TFile }).file = file('author.canvas');
        const third = await openCanvasBelow(f.workspace, f.table, file('three.canvas'));
        expect(f.leaves).toEqual([first, second, third]);
    });
    it('detaches a new pane when opening fails', async () => {
        const f = fixture();
        const failed = { openFile: vi.fn().mockRejectedValue(new Error('open failed')), detach: vi.fn() };
        f.createLeafBySplit.mockReturnValueOnce(failed as unknown as WorkspaceLeaf);
        await expect(openCanvasBelow(f.workspace, f.table, file('one.canvas'))).rejects.toThrow('open failed');
        expect(failed.detach).toHaveBeenCalledOnce();
    });
});
