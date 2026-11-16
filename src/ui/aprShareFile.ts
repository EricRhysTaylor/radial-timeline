/**
 * Author Progress Report share file — the published image, ready to hand off.
 *
 * Shows the file the Default Report or a campaign last published as a small
 * draggable card: drag it into a post composer (X, Bluesky, Patreon,
 * Kickstarter) or onto the desktop, copy it to paste, or reveal it in the
 * system file manager. Used by the Social settings tab and the publish modal,
 * so both show the same file the same way.
 */
import { App, FileSystemAdapter, Notice, arrayBufferToBase64, normalizePath, setIcon } from 'obsidian';
import * as path from 'path'; // SAFE: Node path builds the absolute path the system file manager needs
import { copyImageToClipboard } from '../utils/bugReport';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { t } from '../i18n';

const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    svg: 'image/svg+xml',
};

function mimeFor(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function absolutePathFor(app: App, vaultPath: string): string | null {
    const adapter = app.vault.adapter; // SAFE: the adapter base path is the only way to locate the file on disk for the file manager
    if (adapter instanceof FileSystemAdapter) {
        return path.join(adapter.getBasePath(), normalizePath(vaultPath));
    }
    return null;
}

function revealInFileManager(app: App, vaultPath: string): void {
    const absolute = absolutePathFor(app, vaultPath);
    if (!absolute) {
        new Notice(t('ui.aprShareFile.revealUnsupportedNotice'));
        return;
    }
    try {
        const electron = (window as unknown as { require?: (name: string) => { shell?: { showItemInFolder: (p: string) => void } } }).require?.('electron'); // SAFE: Electron shell reveal is the standard desktop-only way to open Finder/Explorer at a file.
        const shell = electron?.shell;
        if (!shell) {
            new Notice(t('ui.aprShareFile.revealUnsupportedNotice'));
            return;
        }
        shell.showItemInFolder(absolute);
    } catch {
        new Notice(t('ui.aprShareFile.revealFailedNotice'));
    }
}

/** True when the image's top-left pixel is not fully opaque (a transparent background). */
async function hasTransparentCorner(img: HTMLImageElement): Promise<boolean> {
    try {
        await img.decode();
        const canvas = img.ownerDocument.win.createEl('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
        return ctx.getImageData(0, 0, 1, 1).data[3] < 255;
    } catch {
        return false;
    }
}

export interface AprShareFileOptions {
    app: App;
    /** Vault path the report publishes to; null when there is no report yet. */
    vaultPath: string | null;
}

function renderEmpty(card: HTMLElement): void {
    card.empty();
    card.className = 'ert-apr-share is-empty';
    const placeholder = card.createDiv({ cls: 'ert-apr-share__thumb ert-apr-share__thumb--empty' });
    setIcon(placeholder, 'image');
    const body = card.createDiv({ cls: 'ert-apr-share__body' });
    body.createDiv({ cls: 'ert-apr-share__name', text: t('ui.aprShareFile.emptyTitle') });
    body.createDiv({ cls: 'ert-apr-share__hint', text: t('ui.aprShareFile.emptyHint') });
}

function renderReady(card: HTMLElement, app: App, filePath: string, bytes: ArrayBuffer): void {
    card.empty();
    card.className = 'ert-apr-share is-ready';
    const fileName = filePath.split('/').pop() ?? filePath;
    const mime = mimeFor(fileName);
    const isPng = mime === 'image/png';
    const dataUrl = `data:${mime};base64,${arrayBufferToBase64(bytes)}`;

    // The thumbnail drags as a native image (other apps get the picture
    // itself); the rest of the card drags the same file.
    const thumb = card.createEl('img', {
        cls: 'ert-apr-share__thumb',
        attr: { alt: fileName, src: dataUrl, draggable: 'true' },
    });
    const body = card.createDiv({ cls: 'ert-apr-share__body' });
    body.createDiv({ cls: 'ert-apr-share__name', text: fileName });
    body.createDiv({
        cls: 'ert-apr-share__hint',
        text: isPng ? t('ui.aprShareFile.dragHint') : t('ui.aprShareFile.svgHint'),
    });

    // Social sites re-encode uploads without transparency and fill the empty
    // background with black, so say so before the author posts it.
    if (isPng) {
        void hasTransparentCorner(thumb).then(transparent => {
            if (transparent && card.isConnected) {
                body.createDiv({ cls: 'ert-apr-share__warning', text: t('ui.aprShareFile.transparentWarning') });
            }
        });
    }

    card.setAttr('draggable', 'true');
    // SAFE: the card is rebuilt whenever its container is emptied; the listener dies with it
    card.addEventListener('dragstart', (evt: DragEvent) => {
        const transfer = evt.dataTransfer;
        if (!transfer) return;
        transfer.effectAllowed = 'copy';
        // Chromium turns DownloadURL into a real file when dropped on the
        // desktop or into another app; the File item serves web drop zones
        // that read dataTransfer.files.
        transfer.setData('DownloadURL', `${mime}:${fileName}:${dataUrl}`);
        try {
            transfer.items.add(new File([bytes], fileName, { type: mime }));
        } catch {
            // Some drag sources reject File items; DownloadURL still carries the file.
        }
        transfer.setDragImage(thumb, thumb.width / 2, thumb.height / 2);
    });

    const actions = card.createDiv({ cls: 'ert-apr-share__actions' });
    const copyBtn = actions.createEl('button', { cls: 'ert-iconBtn', attr: { type: 'button' } });
    setIcon(copyBtn, 'copy');
    setAccessibleLabel(copyBtn, t('ui.aprShareFile.copyLabel'));
    setTooltip(copyBtn, isPng ? t('ui.aprShareFile.copyLabel') : t('ui.aprShareFile.copyPngOnly'));
    copyBtn.disabled = !isPng;
    // SAFE: the card is rebuilt whenever its container is emptied; the listener dies with it
    copyBtn.addEventListener('click', () => { void (async () => {
        const ok = await copyImageToClipboard(new Blob([bytes], { type: mime }));
        new Notice(ok ? t('ui.aprShareFile.copiedNotice') : t('ui.aprShareFile.copyFailedNotice'));
    })(); });

    if (absolutePathFor(app, filePath)) {
        const revealBtn = actions.createEl('button', { cls: 'ert-iconBtn', attr: { type: 'button' } });
        setIcon(revealBtn, 'folder-open');
        setAccessibleLabel(revealBtn, t('ui.aprShareFile.revealLabel'));
        setTooltip(revealBtn, t('ui.aprShareFile.revealLabel'));
        // SAFE: the card is rebuilt whenever its container is emptied; the listener dies with it
        revealBtn.addEventListener('click', () => revealInFileManager(app, filePath));
    }
}

/**
 * Render the share card into `container` (emptied first). It shows the
 * "publish to create it" state until the file is read, and keeps it when
 * there is no file.
 */
export function renderAprShareFile(container: HTMLElement, { app, vaultPath }: AprShareFileOptions): void {
    container.empty();
    const card = container.createDiv();
    renderEmpty(card);
    if (!vaultPath) return;
    const filePath = normalizePath(vaultPath);

    // PNG reports are written straight through the adapter, so the vault index
    // can lag a fresh publish; read the exact path rather than wait for it.
    void (async () => {
        const adapter = app.vault.adapter; // SAFE: the report path is exact and may not be indexed yet right after publishing
        try {
            if (!(await adapter.exists(filePath))) return;
            const bytes = await adapter.readBinary(filePath);
            if (!card.isConnected) return;
            renderReady(card, app, filePath, bytes);
        } catch {
            // Unreadable file: keep the empty state, which points back to Publish.
        }
    })();
}
