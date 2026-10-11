import { loadPdfJs, type App } from 'obsidian';

interface PdfViewport { width: number; height: number }
interface PdfRenderTask { promise: Promise<void>; cancel(): void }
interface PdfPage {
    getViewport(options: { scale: number }): PdfViewport;
    render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): PdfRenderTask;
}
interface PdfDocument { numPages: number; getPage(number: number): Promise<PdfPage> }
interface PdfLoadingTask { promise: Promise<PdfDocument>; destroy(): Promise<void> }
interface PdfJs { getDocument(options: { data: Uint8Array; isEvalSupported: boolean }): PdfLoadingTask }

async function loadLocalPdf(data: Uint8Array): Promise<PdfLoadingTask> {
    const pdfJs = await loadPdfJs() as PdfJs; // SAFE: typed public PDF.js facade; local document bytes only.
    return pdfJs.getDocument({ data: data.slice(), isEvalSupported: false });
}

/** Parse actual PDF bytes; page count does not come from export options or metadata. */
export async function readPdfPageCount(data: Uint8Array): Promise<number> {
    const task = await loadLocalPdf(data);
    try {
        const document = await task.promise;
        if (!Number.isInteger(document.numPages) || document.numPages < 1) throw new Error('The PDF has no readable pages.');
        return document.numPages;
    } finally { await task.destroy(); }
}

/** Owns one local PDF document and one page render; UI state stays in the export modal. */
export class ManuscriptProofPreview {
    private loadingTask?: PdfLoadingTask;
    private document?: PdfDocument;
    private renderTask?: PdfRenderTask;
    private revision = 0;

    async load(app: App, proofPath: string): Promise<number | null> {
        const revision = this.revision + 1;
        await this.destroy();
        if (revision !== this.revision) return null;
        const data = new Uint8Array(await app.vault.adapter.readBinary(proofPath)); // SAFE: proof byte reads and sidecar writes use exact local job paths, including PDFs not yet indexed by Obsidian.
        if (revision !== this.revision) return null;
        const loadingTask = await loadLocalPdf(data);
        if (revision !== this.revision) { await loadingTask.destroy(); return null; }
        this.loadingTask = loadingTask;
        const document = await loadingTask.promise;
        if (revision !== this.revision) return null;
        this.document = document;
        return document.numPages;
    }

    async renderPage(number: number, canvas: HTMLCanvasElement, size: { width: number; pixelRatio: number }): Promise<boolean> {
        const document = this.document;
        if (!document) throw new Error('No PDF proof is loaded.');
        const revision = ++this.revision;
        this.renderTask?.cancel();
        const page = await document.getPage(number);
        if (revision !== this.revision) return false;
        const base = page.getViewport({ scale: 1 });
        const pixels = Math.min(2048, size.width * size.pixelRatio);
        if (pixels <= 0 || !Number.isFinite(pixels)) throw new Error('PDF preview has no visible page area.');
        const viewport = page.getViewport({ scale: pixels / base.width });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PDF page preview is unavailable in this window.');
        const task = page.render({ canvasContext: context, viewport });
        this.renderTask = task;
        try {
            await task.promise;
            return revision === this.revision;
        } catch (error) {
            if (revision !== this.revision) return false;
            throw error;
        }
    }

    async destroy(): Promise<void> {
        this.revision += 1;
        this.renderTask?.cancel();
        this.renderTask = undefined;
        this.document = undefined;
        const task = this.loadingTask;
        this.loadingTask = undefined;
        if (task) await task.destroy();
    }
}
