import { describe, expect, it, vi } from 'vitest';
import { MarkdownView, type App, type TFile } from 'obsidian';
import { openScenePopout, readerOffset, readerScale } from './sceneCardReader';

vi.mock('../utils/fileUtils', () => ({ revealHighlight: vi.fn() }));

describe('scene card navigation', () => {
    it('places the visible part proportionally along the scene scale', () => {
        expect(readerScale(100, 400, 0)).toEqual({ size: 25, top: 0 });
        expect(readerScale(100, 400, 150)).toEqual({ size: 25, top: 37.5 });
        expect(readerScale(100, 400, 300)).toEqual({ size: 25, top: 75 });
        expect(readerScale(100, 100, 0)).toBeNull();
        expect(readerScale(0, 100, 0)).toBeNull();
    });

    it('keeps long-scene markers visible and within the scale', () => {
        expect(readerScale(100, 10000, 9900)).toEqual({ size: 6, top: 94 });
        expect(readerScale(100, 400, -20)?.top).toBe(0);
        expect(readerScale(100, 400, 999)?.top).toBe(75);
    });
    it('does not open a stale snapshot', async () => {
        const getLeaf = vi.fn();
        const app = { vault: { read: async () => 'changed' }, workspace: { getLeaf } } as unknown as App;
        expect(await openScenePopout(app, {} as TFile, {} as Document, 'old', 4)).toBe(false);
        expect(getLeaf).not.toHaveBeenCalled();
    });

    it('opens an exact character position in a separate window', async () => {
        const content = 'one word and another word';
        const editor = { getValue: () => content, offsetToPos: vi.fn((offset: number) => ({ line: 0, ch: offset })),
            focus: vi.fn(), setCursor: vi.fn(), scrollIntoView: vi.fn() };
        const view = Object.assign(new MarkdownView(), { editor, containerEl: { ownerDocument: { defaultView: null } } });
        const leaf = { view, openFile: vi.fn(), getViewState: vi.fn() };
        const workspace = { getLeavesOfType: () => [], getLeaf: vi.fn(() => leaf), revealLeaf: vi.fn(), setActiveLeaf: vi.fn() };
        const app = { vault: { read: async () => content }, workspace } as unknown as App;
        expect(await openScenePopout(app, {} as TFile, {} as Document, content, 21)).toBe(true);
        expect(workspace.getLeaf).toHaveBeenCalledWith('window');
        expect(editor.offsetToPos).toHaveBeenCalledWith(21);
        expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 21 });
    });

    it('uses the clicked character location, not the first occurrence of a repeated word', () => {
        const node = {};
        const selection = { startContainer: node, startOffset: 18 };
        const before = { selectNodeContents: vi.fn(), setEnd: vi.fn(), toString: () => 'word and then word' };
        const reader = { contains: (value: unknown) => value === node, ownerDocument: {
            caretRangeFromPoint: () => selection, createRange: () => before,
        } } as unknown as HTMLElement;
        expect(readerOffset(reader, 10, 20)).toBe(18);
        expect(before.setEnd).toHaveBeenCalledWith(node, 18);
    });
});
