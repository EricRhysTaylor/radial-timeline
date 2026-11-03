import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { applyAttachedSketchMove } from './sketchSceneMove';

function setup() {
    const a = new TFile('Book/A.md');
    const b = new TFile('Book/B.md');
    const fields: Record<string, Record<string, unknown>> = {
        [a.path]: { Class: 'Sketch', Act: 1, 'Place after scene': 'scn_a', 'Sketch order': 10 },
        [b.path]: { Class: 'Sketch', Act: 1, 'Place after scene': 'scn_a', 'Sketch order': 20 },
    };
    const app = { fileManager: { processFrontMatter: async (file: TFile, cb: (fm: Record<string, unknown>) => void) => cb(fields[file.path]) } } as unknown as App;
    return { a, b, fields, app };
}

describe('attached sketches after a scene changes act', () => {
    it('moves them with their scene while preserving order', async () => {
        const { a, b, fields, app } = setup();
        await applyAttachedSketchMove(app, { files: [a, b], anchorId: 'scn_a', destinationAct: 2, follow: true, actKey: 'Act' });
        expect(fields[a.path]).toMatchObject({ Act: 2, 'Place after scene': 'scn_a', 'Sketch order': 10 });
        expect(fields[b.path]).toMatchObject({ Act: 2, 'Place after scene': 'scn_a', 'Sketch order': 20 });
    });
    it('leaves them in their old act when detached', async () => {
        const { a, b, fields, app } = setup();
        await applyAttachedSketchMove(app, { files: [a, b], anchorId: 'scn_a', destinationAct: 2, follow: false, actKey: 'Act' });
        expect(fields[a.path]).toEqual({ Class: 'Sketch', Act: 1 });
        expect(fields[b.path]).toEqual({ Class: 'Sketch', Act: 1 });
    });
    it('does not overwrite a changed anchor', async () => {
        const { a, fields, app } = setup();
        fields[a.path]['Place after scene'] = 'scn_other';
        await expect(applyAttachedSketchMove(app, { files: [a], anchorId: 'scn_a', destinationAct: 2, follow: true, actKey: 'Act' })).rejects.toThrow('Sketch anchor changed');
        expect(fields[a.path].Act).toBe(1);
    });
});
