import { describe, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import { ManuscriptProofPreview } from './ManuscriptProofPreview';


function fixture() {
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 400 * scale, height: 600 * scale }), render };
    const document = { numPages: 3, getPage: vi.fn(async (_page: number) => page) };
    const destroy = vi.fn(async () => {});
    const task = { promise: Promise.resolve(document), destroy };
    vi.spyOn(obsidian, 'loadPdfJs').mockResolvedValue({ getDocument: vi.fn(() => task) });
    const app = { vault: { adapter: { readBinary: async () => new ArrayBuffer(10) } } } as unknown as App;
    const canvas = { width: 0, height: 0, getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return { app, canvas, render, document, destroy };
}

describe('actual PDF page preview', () => {
    it('uses the real document page count and renders the requested page', async () => {
        const { app, canvas, render, document, destroy } = fixture();
        const viewer = new ManuscriptProofPreview();
        expect(await viewer.load(app, 'Proof.pdf')).toBe(3);
        expect(await viewer.renderPage(2, canvas, { width: 600, pixelRatio: 1 })).toBe(true);
        expect(document.getPage).toHaveBeenCalledWith(2);
        expect(render).toHaveBeenCalledWith(expect.objectContaining({ viewport: { width: 600, height: 900 } }));
        expect([canvas.width, canvas.height]).toEqual([600, 900]);
        await viewer.destroy();
        expect(destroy).toHaveBeenCalledOnce();
    });
    it('renders at the display pixel density with bounded canvas memory', async () => {
        const { app, canvas } = fixture();
        const viewer = new ManuscriptProofPreview();
        await viewer.load(app, 'Proof.pdf');
        await viewer.renderPage(1, canvas, { width: 600, pixelRatio: 2 });
        expect([canvas.width, canvas.height]).toEqual([1200, 1800]);
        await viewer.renderPage(1, canvas, { width: 8000, pixelRatio: 2 });
        expect([canvas.width, canvas.height]).toEqual([2048, 3072]);
        await viewer.destroy();
    });

    it('does not draw a page that resolves after the viewer is closed', async () => {
        const { app, canvas, document, render } = fixture();
        let release!: (value: Awaited<ReturnType<typeof document.getPage>>) => void;
        document.getPage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const viewer = new ManuscriptProofPreview();
        await viewer.load(app, 'Proof.pdf');
        const drawing = viewer.renderPage(1, canvas, { width: 600, pixelRatio: 1 });
        await viewer.destroy();
        release({ getViewport: () => ({ width: 10, height: 10 }), render });
        expect(await drawing).toBe(false);
        expect(render).not.toHaveBeenCalled();
    });
});
