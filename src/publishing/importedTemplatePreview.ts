/*
 * The picture of an imported template: a page of its test PDF.
 *
 * It is the real page, drawn from the PDF that Pandoc and LaTeX built on this
 * computer, never an invented one: the page where the sample manuscript
 * starts (the check record's `samplePage`), which shows the template's text
 * page where page 1 is often a title page. The import dialog draws it on screen; a
 * copy is kept as a PNG beside Radial Timeline's copy of the template
 * (`imported/<name>.png`) so the layout's row in Settings → Publish can show
 * it. The image is the plugin's own file and is replaced each time the
 * template passes a check.
 */
import { normalizePath, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate } from '../types';
import { ManuscriptProofPreview } from './ManuscriptProofPreview';

/** Width, in CSS pixels, the saved image is drawn at (doubled for sharp display). */
const PREVIEW_WIDTH = 300;

/** Draw one page of `pdf` on `canvas`. PDF.js needs the document that owns the canvas. */
export async function drawPdfPage(pdf: Uint8Array, page: number, canvas: HTMLCanvasElement, width = PREVIEW_WIDTH): Promise<void> {
    const viewer = new ManuscriptProofPreview();
    try {
        await viewer.loadData(pdf, canvas.ownerDocument);
        await viewer.renderPage(page, canvas, { width, pixelRatio: 2 });
    } finally { await viewer.destroy(); }
}

/** One page of `pdf` as PNG bytes, drawn in the given window. */
export async function renderPdfPagePng(pdf: Uint8Array, page: number, ownerDocument: Document): Promise<ArrayBuffer> {
    const canvas = ownerDocument.win.createEl('canvas');
    await drawPdfPage(pdf, page, canvas);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The page of the test PDF could not be saved as an image.');
    return blob.arrayBuffer();
}

/**
 * Where the first-page image of a layout's template lives, or null for a
 * layout whose template is outside the vault (one imported before Radial
 * Timeline kept its own copy).
 */
export function getImportedTemplatePreviewPath(layout: Pick<PandocLayoutTemplate, 'path'>): string | null {
    const path = layout.path.trim();
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || !/\.tex$/i.test(path)) return null;
    return normalizePath(path.replace(/\.tex$/i, '.png'));
}

/** Save or replace the first-page image after a passed check. */
export async function writeImportedTemplatePreview(plugin: RadialTimelinePlugin, layout: PandocLayoutTemplate, png: ArrayBuffer): Promise<void> {
    const path = getImportedTemplatePreviewPath(layout);
    if (!path) return;
    const existing = plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await plugin.app.vault.modifyBinary(existing, png);
    else await plugin.app.vault.createBinary(path, png);
}

/** What the layout's row shows: the saved image and the page of the test PDF it is, or null when there is none. */
export function getImportedTemplatePreview(plugin: RadialTimelinePlugin, layout: PandocLayoutTemplate): { src: string; page: number } | null {
    const path = getImportedTemplatePreviewPath(layout);
    const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile) || !layout.importCheck) return null;
    return { src: plugin.app.vault.getResourcePath(file), page: layout.importCheck.samplePage };
}
