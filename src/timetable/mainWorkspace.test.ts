import { describe, expect, it, vi } from 'vitest';
import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { applyMainWorkspace, planMainWorkspace } from './mainWorkspace';

const file = (path: string) => ({ path }) as TFile;
const leaf = (id: string, type: string, path?: string) => ({ id, type: 'leaf', state: { type, state: path ? { file: path } : {} } });
const sample = () => ({
    main: { id: 'root', type: 'split', direction: 'vertical', children: [
        { id: 'a', type: 'tabs', children: [leaf('table', 'bases', 'book.base'), leaf('note', 'markdown', 'other.md')] },
        { id: 'b', type: 'split', children: [{ id: 'c', type: 'tabs', children: [leaf('wheel', 'radial-timeline'), leaf('wheel2', 'radial-timeline'), leaf('canvas', 'canvas', 'map.canvas')] }] },
    ] },
    left: { unchanged: true }, right: { unchanged: true }, active: 'note',
});
const ids = () => { let n = 0; return () => `new-${++n}`; };
function allIds(node: { id: string; type: string; children?: unknown[] }): string[] {
    return node.type === 'leaf' ? [node.id] : (node.children ?? []).flatMap(child => allIds(child as typeof node));
}

describe('central Quick Workspace', () => {
    it('reuses the table and canvas, clears other central tabs, and preserves both sidebars', () => {
        const original = sample();
        const plan = planMainWorkspace(original, 'table', file('map.canvas'), 'canvas', ids());
        expect(plan.layout.left).toEqual(original.left);
        expect(plan.layout.right).toEqual(original.right);
        expect(plan.layout.main.children?.[0].direction).toBe('horizontal');
        expect(allIds(plan.layout.main).sort()).toEqual(['canvas', 'table']);
        expect(plan.referenceId).toBe('canvas');
        expect(plan.layout.active).toBe('table');
        expect(original.main.direction).toBe('vertical');
    });
    it('uses one existing timeline and creates a reference without duplicate views', () => {
        const plan = planMainWorkspace(sample(), 'table', file('reference.md'), 'timeline', ids());
        expect(plan.layout.main.direction).toBe('vertical');
        expect(plan.layout.main.children?.[1].direction).toBe('horizontal');
        expect(allIds(plan.layout.main).sort()).toEqual(['new-1', 'table', 'wheel']);
    });
    it('rejects an absent timetable', () => {
        expect(() => planMainWorkspace(sample(), 'missing', file('reference.md'), 'beside', ids())).toThrow();
    });

    it('restores the previous workspace if the requested layout fails', async () => {
        const oldLayout = sample();
        const table = {} as WorkspaceLeaf;
        const changeLayout = vi.fn().mockRejectedValueOnce(new Error('layout failed')).mockResolvedValueOnce(undefined);
        const workspace = { getLayout: () => oldLayout, getLeafById: (id: string) => id === 'table' ? table : null, changeLayout } as unknown as Workspace;
        await expect(applyMainWorkspace(workspace, table, file('map.canvas'), 'canvas')).rejects.toThrow('layout failed');
        expect(changeLayout).toHaveBeenCalledTimes(2);
        expect(changeLayout.mock.calls[1][0]).toBe(oldLayout);
    });
});
