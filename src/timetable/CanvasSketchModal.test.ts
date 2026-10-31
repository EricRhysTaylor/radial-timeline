import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { CanvasSketchModal, type OpenCanvas } from './CanvasSketchModal';
import type { StoryCanvasData } from './canvasSketches';

function setup(changeDuringCreate = false) {
    let data: StoryCanvasData = { nodes: [
        { id: '1', type: 'text', text: 'A scene\n\nSome ideas', x: 1, y: 2 },
        { id: '2', type: 'text', text: 'Other idea' },
    ], edges: [{ id: 'edge', fromNode: '1', toNode: '2' }] };
    const saved = new Map<string, string>();
    const create = vi.fn(async (path: string, text: string) => {
        saved.set(path, text);
        if (changeDuringCreate) data = { ...data, extra: 'edited by author' };
    });
    const app = { vault: { getFolderByPath: () => ({}), getAbstractFileByPath: (path: string) => path === 'Book/A scene.md' ? {} : null, create } } as unknown as App;
    const plugin = { settings: {}, refreshTimelineIfNeeded: vi.fn() } as unknown as RadialTimelinePlugin;
    const setData = vi.fn((next: StoryCanvasData) => { data = next; });
    const requestSave = vi.fn();
    const canvas: OpenCanvas = { getData: () => data, setData, requestSave };
    const book = { id: 'book', title: 'Book', sourceFolder: 'Book' } as BookProfile;
    const modal = new CanvasSketchModal(app, plugin, canvas, [book], book, () => true);
    (Reflect.get(modal, 'selected') as Set<string>).add('1');
    return { modal, saved, setData, requestSave, getData: () => data };
}

describe('Canvas sketch conversion', () => {
    it('creates a distinct sketch preserving the card body and replaces only that card', async () => {
        const test = setup();
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.get('Book/A scene 2.md')).toContain('A scene\n\nSome ideas');
        expect(test.saved.get('Book/A scene 2.md')).toContain('Sketch');
        expect(test.getData().nodes?.[0]).toMatchObject({ type: 'file', file: 'Book/A scene 2.md', x: 1, y: 2 });
        expect(test.getData().nodes?.[1]).toMatchObject({ id: '2', type: 'text', text: 'Other idea' });
        expect(test.getData().edges).toEqual([{ id: 'edge', fromNode: test.getData().nodes?.[0].id, toNode: '2' }]);
        expect(test.getData().nodes?.[0].id).not.toBe('1');
        expect(test.requestSave).toHaveBeenCalledOnce();
        expect(test.requestSave).toHaveBeenCalledWith(false);
    });

    it('keeps created notes but refuses to overwrite a Canvas changed during creation', async () => {
        const test = setup(true);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Reflect.get(test.modal, 'convert').call(test.modal);
        expect(test.saved.size).toBe(1);
        expect(test.setData).not.toHaveBeenCalled();
        expect(test.requestSave).not.toHaveBeenCalled();
        expect(test.getData().nodes?.[0]).toMatchObject({ type: 'text', text: 'A scene\n\nSome ideas' });
        error.mockRestore();
    });
});
