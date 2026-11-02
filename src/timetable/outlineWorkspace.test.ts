import { describe, expect, it, vi } from 'vitest';
import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { currentOutlineReference, openOutlineReference } from './outlineWorkspace';

function fixture() {
    const leaves: WorkspaceLeaf[] = [];
    const table = {} as WorkspaceLeaf;
    const createLeafBySplit = vi.fn(() => {
        const pane = {
            view: { file: null as TFile | null },
            type: 'markdown',
            pinned: false,
            getViewState() { return { pinned: this.pinned }; },
            async openFile(file: TFile) { this.view.file = file; },
            async setViewState(state: { type: string }) { this.type = state.type; },
            detach() { leaves.splice(leaves.indexOf(pane as unknown as WorkspaceLeaf), 1); },
        };
        leaves.push(pane as unknown as WorkspaceLeaf);
        return pane as unknown as WorkspaceLeaf;
    });
    const workspace = { createLeafBySplit, getLeavesOfType: (type: string) => leaves.filter(leaf => (leaf as unknown as { type: string }).type === type), revealLeaf: vi.fn() } as unknown as Workspace;
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

    it('builds and reuses a timeline alongside a stacked outline and reference', async () => {
        const f = fixture();
        await openOutlineReference(f.workspace, f.table, file('one.md'), 'vertical');
        const reference = await openOutlineReference(f.workspace, f.table, file('one.md'), 'horizontal', true);
        expect(f.createLeafBySplit).toHaveBeenLastCalledWith(f.table, 'horizontal');
        expect(f.createLeafBySplit).toHaveBeenCalledWith(f.table, 'vertical', true);
        expect(f.workspace.getLeavesOfType('radial-timeline')).toHaveLength(1);
        const same = await openOutlineReference(f.workspace, f.table, file('two.md'), 'horizontal');
        expect(same).toBe(reference);
        expect(f.workspace.getLeavesOfType('radial-timeline')).toHaveLength(1);
        await openOutlineReference(f.workspace, f.table, file('two.md'), 'vertical', false);
        expect(f.workspace.getLeavesOfType('radial-timeline')).toHaveLength(0);
        expect(f.workspace.getLeavesOfType('markdown')).toHaveLength(1);
    });

    it('does not close a pinned timeline when switching layouts', async () => {
        const f = fixture();
        await openOutlineReference(f.workspace, f.table, file('one.md'), 'horizontal', true);
        const timeline = f.workspace.getLeavesOfType('radial-timeline')[0];
        (timeline as unknown as { pinned: boolean }).pinned = true;
        await openOutlineReference(f.workspace, f.table, file('one.md'), 'vertical', false);
        expect(f.workspace.getLeavesOfType('radial-timeline')).toEqual([timeline]);
    });

    it('keeps the existing timeline and reference if switching layouts fails', async () => {
        const f = fixture();
        const reference = await openOutlineReference(f.workspace, f.table, file('original.md'), 'horizontal', true);
        const timeline = f.workspace.getLeavesOfType('radial-timeline')[0];
        const failed = { openFile: vi.fn().mockRejectedValue(new Error('open failed')), detach: vi.fn() };
        f.createLeafBySplit.mockReturnValueOnce(failed as unknown as WorkspaceLeaf);
        await expect(openOutlineReference(f.workspace, f.table, file('other.md'), 'vertical', false)).rejects.toThrow('open failed');
        expect(f.workspace.getLeavesOfType('radial-timeline')).toEqual([timeline]);
        expect(f.workspace.getLeavesOfType('markdown')).toEqual([reference]);
        expect(currentOutlineReference(f.workspace, f.table)?.path).toBe('original.md');
    });

    it('restores the reference if the timeline fails to open', async () => {
        const f = fixture();
        await openOutlineReference(f.workspace, f.table, file('original.md'), 'vertical');
        const failed = { setViewState: vi.fn().mockRejectedValue(new Error('timeline failed')), detach: vi.fn() };
        f.createLeafBySplit.mockReturnValueOnce(failed as unknown as WorkspaceLeaf);
        await expect(openOutlineReference(f.workspace, f.table, file('other.md'), 'horizontal', true)).rejects.toThrow('timeline failed');
        expect(failed.detach).toHaveBeenCalled();
        expect(currentOutlineReference(f.workspace, f.table)?.path).toBe('original.md');
    });

    it('removes the new timeline and restores the reference if its new pane fails', async () => {
        const f = fixture();
        await openOutlineReference(f.workspace, f.table, file('original.md'), 'vertical');
        const create = f.createLeafBySplit.getMockImplementation()!;
        f.createLeafBySplit.mockImplementationOnce(create).mockImplementationOnce(() => ({
            openFile: vi.fn().mockRejectedValue(new Error('reference failed')), detach: vi.fn(),
        }) as unknown as WorkspaceLeaf);
        await expect(openOutlineReference(f.workspace, f.table, file('other.md'), 'horizontal', true)).rejects.toThrow('reference failed');
        expect(f.workspace.getLeavesOfType('radial-timeline')).toHaveLength(0);
        expect(currentOutlineReference(f.workspace, f.table)?.path).toBe('original.md');
    });
});
