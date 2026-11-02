import { describe, expect, it, vi } from 'vitest';
import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { currentOutlineReference, openOutlineReference } from './outlineWorkspace';

function fixture() {
    const leaves: WorkspaceLeaf[] = [];
    const table = {} as WorkspaceLeaf;
    const createLeafBySplit = vi.fn(() => {
        const pane = {
            view: { file: null as TFile | null },
            pinned: false,
            getViewState() { return { pinned: this.pinned }; },
            async openFile(file: TFile) { this.view.file = file; },
            detach() { leaves.splice(leaves.indexOf(pane as unknown as WorkspaceLeaf), 1); },
        };
        leaves.push(pane as unknown as WorkspaceLeaf);
        return pane as unknown as WorkspaceLeaf;
    });
    const workspace = { createLeafBySplit, getLeavesOfType: () => leaves, revealLeaf: vi.fn() } as unknown as Workspace;
    return { table, leaves, workspace, createLeafBySplit };
}
const file = (path: string) => ({ path }) as TFile;

describe('outline workspace', () => {
    it('serializes rapid requests and reuses the reference pane', async () => {
        const f = fixture();
        const [first, second] = await Promise.all([
            openOutlineReference(f.workspace, f.table, file('one.md'), 'vertical'),
            openOutlineReference(f.workspace, f.table, file('two.md'), 'vertical'),
        ]);
        expect(first).toBe(second);
        expect(f.createLeafBySplit).toHaveBeenCalledTimes(1);
        expect((second.view as { file: TFile }).file.path).toBe('two.md');
    });

    it('replaces only its own unpinned reference when changing orientation', async () => {
        const f = fixture();
        const first = await openOutlineReference(f.workspace, f.table, file('one.md'), 'vertical');
        const second = await openOutlineReference(f.workspace, f.table, file('two.md'), 'horizontal');
        expect(f.leaves).toEqual([second]);
        expect(currentOutlineReference(f.workspace, f.table)?.path).toBe('two.md');
        (second.view as { file: TFile }).file = file('author-note.md');
        expect(currentOutlineReference(f.workspace, f.table)).toBeNull();
        const third = await openOutlineReference(f.workspace, f.table, file('one.md'), 'vertical');
        expect(f.leaves).toEqual([second, third]);
        expect(f.leaves).not.toContain(first);
    });

    it('leaves a pinned reference alone', async () => {
        const f = fixture();
        const first = await openOutlineReference(f.workspace, f.table, file('one.md'), 'vertical');
        (first as unknown as { pinned: boolean }).pinned = true;
        const second = await openOutlineReference(f.workspace, f.table, file('two.md'), 'vertical');
        expect(f.leaves).toEqual([first, second]);
    });

    it('can recover when opening a reference fails', async () => {
        const f = fixture();
        const first = await openOutlineReference(f.workspace, f.table, file('one.md'), 'vertical');
        f.createLeafBySplit.mockImplementationOnce(() => {
            const failed = { openFile: vi.fn().mockRejectedValue(new Error('open failed')), detach: vi.fn() };
            return failed as unknown as WorkspaceLeaf;
        });
        await expect(openOutlineReference(f.workspace, f.table, file('two.md'), 'horizontal')).rejects.toThrow('open failed');
        expect(f.leaves).toEqual([first]);
        const recovered = await openOutlineReference(f.workspace, f.table, file('three.md'), 'horizontal');
        expect(f.leaves).toEqual([recovered]);
    });
});
