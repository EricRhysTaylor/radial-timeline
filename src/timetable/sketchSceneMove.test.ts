import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { applyAttachedSketchMove, runSceneMoveWithSketches } from './sketchSceneMove';
import { SceneReorderVerificationError } from '../services/SceneReorderService';
import { memoryPlacements } from '../../tests/helpers/sketchPlacements';

describe('a scene move with attached sketches', () => {
    it('moves the sketches after a clean scene move', async () => {
        const order: string[] = [];
        await runSceneMoveWithSketches(async () => { order.push('scene'); }, async () => { order.push('sketches'); }, () => order.push('applied'));
        expect(order).toEqual(['scene', 'applied', 'sketches']);
    });
    it('still moves the sketches when the move ends with a verification warning, then reports it', async () => {
        const warning = new SceneReorderVerificationError('Order differs');
        const sketches = vi.fn().mockResolvedValue(undefined);
        const applied = vi.fn();
        await expect(runSceneMoveWithSketches(async () => { throw warning; }, sketches, applied)).rejects.toBe(warning);
        expect(sketches).toHaveBeenCalledTimes(1);
        expect(applied).toHaveBeenCalledTimes(1);
    });
    it('leaves the sketches alone when the scene move itself fails', async () => {
        const sketches = vi.fn();
        const applied = vi.fn();
        await expect(runSceneMoveWithSketches(async () => { throw new Error('rename failed'); }, sketches, applied)).rejects.toThrow('rename failed');
        expect(sketches).not.toHaveBeenCalled();
        expect(applied).not.toHaveBeenCalled();
    });
});

async function setup() {
    const a = new TFile('Book/A.md');
    const b = new TFile('Book/B.md');
    const fields: Record<string, Record<string, unknown>> = {
        [a.path]: { Class: 'Sketch', Act: 1 },
        [b.path]: { Class: 'Sketch', Act: 1 },
    };
    const { store } = memoryPlacements();
    await store.set([[a.path, { after: 'scn_a', order: 10 }], [b.path, { after: 'scn_a', order: 20 }]]);
    const app = { fileManager: { processFrontMatter: async (file: TFile, cb: (fm: Record<string, unknown>) => void) => cb(fields[file.path]) } } as unknown as App;
    return { a, b, fields, app, store };
}

describe('attached sketches after a scene changes act', () => {
    it('moves them with their scene while preserving order', async () => {
        const { a, b, fields, app, store } = await setup();
        await applyAttachedSketchMove(app, store, { files: [a, b], anchorId: 'scn_a', destinationAct: 2, follow: true, actKey: 'Act' });
        expect(fields[a.path]).toEqual({ Class: 'Sketch', Act: 2 });
        expect(fields[b.path]).toEqual({ Class: 'Sketch', Act: 2 });
        expect(store.get(a.path)).toEqual({ after: 'scn_a', order: 10 });
        expect(store.get(b.path)).toEqual({ after: 'scn_a', order: 20 });
    });
    it('leaves them in their old act when detached, clearing only their sidecar place', async () => {
        const { a, b, fields, app, store } = await setup();
        await applyAttachedSketchMove(app, store, { files: [a, b], anchorId: 'scn_a', destinationAct: 2, follow: false, actKey: 'Act' });
        expect(fields[a.path]).toEqual({ Class: 'Sketch', Act: 1 });
        expect(fields[b.path]).toEqual({ Class: 'Sketch', Act: 1 });
        expect(store.get(a.path)).toBeUndefined();
        expect(store.get(b.path)).toBeUndefined();
    });
    it('does not overwrite a changed anchor', async () => {
        const { a, fields, app, store } = await setup();
        await store.set([[a.path, { after: 'scn_other', order: 10 }]]);
        await expect(applyAttachedSketchMove(app, store, { files: [a], anchorId: 'scn_a', destinationAct: 2, follow: true, actKey: 'Act' })).rejects.toThrow('Sketch anchor changed');
        expect(fields[a.path].Act).toBe(1);
    });
});
