/*
 * Radial Timeline Plugin for Obsidian — Bug Report Modal
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent, Notice, Platform, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import {
    buildIssueUrl,
    buildMailtoUrl,
    captureScreenshot,
    copyImageToClipboard,
    gatherEnv,
    type BugReportSource,
} from '../utils/bugReport';

const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export class BugReportModal extends ErtModal {
    private readonly plugin: RadialTimelinePlugin;
    private readonly source: BugReportSource;

    private descriptionEl?: HTMLTextAreaElement;
    private errorEl?: HTMLTextAreaElement;
    private previewEl?: HTMLDivElement;
    private statusEl?: HTMLDivElement;
    private sendButton?: ButtonComponent;
    private dragbarEl?: HTMLDivElement;
    private screenshotBlob: Blob | null = null;
    private screenshotPreviewUrl: string | null = null;
    private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
    private dragTranslate: { x: number; y: number } = { x: 0, y: 0 };
    private dragHandlers: { move: (e: MouseEvent) => void; up: () => void } | null = null;

    constructor(app: App, plugin: RadialTimelinePlugin, source: BugReportSource) {
        super(app);
        this.plugin = plugin;
        this.source = source;
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({
            width: 'min(520px, 94vw)',
            shellClasses: ['ert-bug-report-shell'],
            containerClasses: ['ert-bug-report'],
        });

        this.mountDragbar();
        this.mountHeaderText();
        this.mountBody();
        this.mountActions();

        this.contentEl.ownerDocument.addEventListener('paste', this.handlePaste);
    }

    onClose(): void {
        this.contentEl.ownerDocument.removeEventListener('paste', this.handlePaste);
        this.teardownDrag();
        this.dragbarEl?.remove();
        this.dragbarEl = undefined;
        if (this.screenshotPreviewUrl) {
            URL.revokeObjectURL(this.screenshotPreviewUrl);
            this.screenshotPreviewUrl = null;
        }
        this.screenshotBlob = null;
        this.contentEl.empty();
    }

    private mountDragbar(): void {
        // Full-width drag strip on the outer modal shell (above the dark body).
        const bar = this.modalEl.createDiv({ cls: 'ert-bug-report-dragbar' });
        const grip = bar.createSpan({ cls: 'ert-bug-report-dragbar-grip' });
        setIcon(grip, 'grip-horizontal');
        bar.addEventListener('mousedown', this.handleHeaderMouseDown);
        this.modalEl.prepend(bar);
        this.dragbarEl = bar;
    }

    private mountHeaderText(): void {
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header ert-bug-report-header' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Report a bug' });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'The more specific, the easier it is to track down. Mention what you were doing right before, anything that looked off, and steps to reproduce.',
        });
    }

    private mountBody(): void {
        const body = this.contentEl.createDiv({ cls: 'ert-bug-report-body ert-stack' });

        body.createDiv({ cls: 'ert-bug-report-label', text: 'What went wrong? (required)' });
        const description = body.createEl('textarea', {
            cls: 'ert-bug-report-textarea',
            attr: { rows: '3', placeholder: 'Briefly describe the problem and what you were doing.' },
        });
        this.descriptionEl = description;
        description.addEventListener('input', () => this.updateSendEnabled());

        body.createDiv({ cls: 'ert-bug-report-label', text: 'Error text or log (optional)' });
        const errorBox = body.createEl('textarea', {
            cls: 'ert-bug-report-textarea ert-bug-report-textarea--mono',
            attr: { rows: '4', placeholder: 'Paste any error message, stack trace, or console output here.' },
        });
        this.errorEl = errorBox;

        const screenshotRow = body.createDiv({ cls: 'ert-bug-report-row' });
        const captureBtn = new ButtonComponent(screenshotRow)
            .setButtonText('Capture window')
            .onClick(() => void this.handleCapture());
        captureBtn.buttonEl.addClass('ert-btn', 'ert-btn--standard-pro');
        const captureIcon = captureBtn.buttonEl.createSpan({ cls: 'ert-bug-report-btn-icon' });
        setIcon(captureIcon, 'camera');
        captureBtn.buttonEl.prepend(captureIcon);
        if (Platform.isMobile) {
            captureBtn.buttonEl.disabled = true;
            captureBtn.buttonEl.setAttr('title', 'Window capture is desktop-only. Use Attach image.');
        }

        const attachBtn = new ButtonComponent(screenshotRow)
            .setButtonText('Attach image')
            .onClick(() => fileInput.click());
        attachBtn.buttonEl.addClass('ert-btn', 'ert-btn--standard-pro');
        const attachIcon = attachBtn.buttonEl.createSpan({ cls: 'ert-bug-report-btn-icon' });
        setIcon(attachIcon, 'paperclip');
        attachBtn.buttonEl.prepend(attachIcon);

        const fileInput = screenshotRow.createEl('input', {
            cls: 'ert-bug-report-file',
            attr: { type: 'file', accept: 'image/*' },
        });
        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            if (file.size > PREVIEW_MAX_BYTES) {
                this.setStatus('Image is larger than 8 MB — try a smaller capture.', 'error');
                fileInput.value = '';
                return;
            }
            void this.setScreenshot(file);
            fileInput.value = '';
        });

        this.previewEl = body.createDiv({ cls: 'ert-bug-report-preview' });
        this.previewEl.toggleClass('ert-bug-report-preview--empty', true);
        this.previewEl.setText('No screenshot attached. Capture, attach, or paste an image with ⌘V.');

        this.statusEl = body.createDiv({ cls: 'ert-bug-report-status' });
    }

    protected mountActions(): HTMLElement {
        const actions = this.contentEl.createDiv({ cls: 'ert-modal-actions ert-bug-report-actions' });

        const send = new ButtonComponent(actions)
            .setButtonText('Post on GitHub')
            .setCta()
            .onClick(() => void this.handleSend('github'));
        this.sendButton = send;
        this.updateSendEnabled();

        const emailBtn = new ButtonComponent(actions)
            .setButtonText('Email client')
            .setTooltip('Open your default mail app with the report prefilled — no GitHub account needed.')
            .onClick(() => void this.handleSend('email'));
        emailBtn.buttonEl.addClass('ert-btn', 'ert-btn--standard-pro', 'ert-bug-report-secondary');

        const cancelBtn = new ButtonComponent(actions)
            .setButtonText('Close')
            .onClick(() => this.close());
        cancelBtn.buttonEl.addClass('ert-btn', 'ert-btn--standard-pro');

        return actions;
    }

    private updateSendEnabled(): void {
        const hasText = (this.descriptionEl?.value.trim().length ?? 0) > 0;
        if (this.sendButton) {
            this.sendButton.buttonEl.disabled = !hasText;
        }
    }

    private async handleCapture(): Promise<void> {
        this.setStatus('Capturing the Obsidian window…', 'info');
        const result = await captureScreenshot();
        if (!result.blob) {
            const message = result.failure === 'cancelled'
                ? 'Capture cancelled.'
                : result.failure === 'unavailable'
                    ? 'Window capture is not available in this build of Obsidian. Take a screenshot with your OS (⌘⇧4 / Win+Shift+S) and paste it here with ⌘V.'
                    : 'Capture failed. Take a screenshot with your OS shortcut and paste it here with ⌘V instead.';
            this.setStatus(message, 'error');
            return;
        }
        await this.setScreenshot(result.blob);
        this.setStatus('Screenshot ready.', 'success');
    }

    private async setScreenshot(blob: Blob): Promise<void> {
        if (this.screenshotPreviewUrl) {
            URL.revokeObjectURL(this.screenshotPreviewUrl);
            this.screenshotPreviewUrl = null;
        }
        this.screenshotBlob = blob;
        this.screenshotPreviewUrl = URL.createObjectURL(blob);
        if (this.previewEl) {
            this.previewEl.empty();
            this.previewEl.toggleClass('ert-bug-report-preview--empty', false);
            const img = this.previewEl.createEl('img', {
                cls: 'ert-bug-report-preview-img',
                attr: { src: this.screenshotPreviewUrl, alt: 'Bug report screenshot preview' },
            });
            void img;
            const clear = this.previewEl.createEl('button', {
                cls: 'ert-bug-report-preview-clear',
                text: 'Remove',
            });
            clear.addEventListener('click', () => this.clearScreenshot());
        }
    }

    private clearScreenshot(): void {
        if (this.screenshotPreviewUrl) {
            URL.revokeObjectURL(this.screenshotPreviewUrl);
            this.screenshotPreviewUrl = null;
        }
        this.screenshotBlob = null;
        if (this.previewEl) {
            this.previewEl.empty();
            this.previewEl.toggleClass('ert-bug-report-preview--empty', true);
            this.previewEl.setText('No screenshot attached.');
        }
        this.setStatus('Screenshot removed.', 'info');
    }

    private handlePaste = (ev: ClipboardEvent): void => {
        const items = ev.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    ev.preventDefault();
                    if (file.size > PREVIEW_MAX_BYTES) {
                        this.setStatus('Pasted image is larger than 8 MB.', 'error');
                        return;
                    }
                    void this.setScreenshot(file);
                    this.setStatus('Pasted image attached.', 'success');
                }
                return;
            }
        }
    };

    private async handleSend(transport: 'github' | 'email'): Promise<void> {
        const description = this.descriptionEl?.value ?? '';
        const errorText = this.errorEl?.value ?? '';
        if (!description.trim()) {
            this.setStatus('Please describe the problem first.', 'error');
            return;
        }

        let clipboardOk = false;
        if (this.screenshotBlob) {
            clipboardOk = await copyImageToClipboard(this.screenshotBlob);
        }

        const env = gatherEnv(this.app, this.plugin.manifest.version, this.source);
        const payload = {
            description,
            errorText,
            env,
            hasScreenshot: !!this.screenshotBlob && clipboardOk,
        };

        const url = transport === 'email' ? buildMailtoUrl(payload) : buildIssueUrl(payload);
        const destLabel = transport === 'email' ? 'Email' : 'GitHub';
        window.open(url, '_blank');

        if (this.screenshotBlob) {
            if (clipboardOk) {
                new Notice(`${destLabel} opened. Paste your screenshot with ⌘V / Ctrl+V.`);
                this.setStatus(`Sent. Screenshot is on your clipboard — paste it into the ${destLabel.toLowerCase()} window.`, 'success');
            } else {
                new Notice(`${destLabel} opened. Drag the image from this modal into the window.`);
                this.setStatus(`Sent. Clipboard write failed — drag the preview image into ${destLabel.toLowerCase()}.`, 'info');
            }
        } else {
            new Notice(`${destLabel} opened with your report prefilled.`);
            this.setStatus('Sent.', 'success');
        }
    }

    private setStatus(message: string, kind: 'info' | 'success' | 'error'): void {
        if (!this.statusEl) return;
        this.statusEl.setText(message);
        this.statusEl.removeClass('ert-bug-report-status--info', 'ert-bug-report-status--success', 'ert-bug-report-status--error');
        this.statusEl.addClass(`ert-bug-report-status--${kind}`);
    }

    private readonly handleHeaderMouseDown = (ev: MouseEvent): void => {
        if (ev.button !== 0) return;
        const target = ev.target as HTMLElement | null;
        if (target?.closest('button, input, textarea, a')) return;
        const rect = this.modalEl.getBoundingClientRect();
        this.dragOffset = {
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
        };
        const move = (e: MouseEvent) => this.handleDragMove(e);
        const up = () => this.teardownDrag();
        this.dragHandlers = { move, up };
        const doc = this.modalEl.ownerDocument;
        doc.addEventListener('mousemove', move);
        doc.addEventListener('mouseup', up);
        this.modalEl.classList.add('ert-bug-report-shell--dragging');
        ev.preventDefault();
    };

    private handleDragMove(ev: MouseEvent): void {
        const left = ev.clientX - this.dragOffset.x;
        const top = ev.clientY - this.dragOffset.y;
        const rect = this.modalEl.getBoundingClientRect();
        // Center-anchored: translate is delta from natural centered position.
        const centerX = (window.innerWidth - rect.width) / 2;
        const centerY = (window.innerHeight - rect.height) / 2;
        const clampedLeft = Math.max(0, Math.min(window.innerWidth - rect.width, left));
        const clampedTop = Math.max(0, Math.min(window.innerHeight - rect.height, top));
        this.dragTranslate = {
            x: clampedLeft - centerX,
            y: clampedTop - centerY,
        };
        this.modalEl.style.transform = `translate(${this.dragTranslate.x}px, ${this.dragTranslate.y}px)`; // SAFE: drag position via inline transform
    }

    private teardownDrag(): void {
        if (!this.dragHandlers) return;
        const doc = this.modalEl.ownerDocument;
        doc.removeEventListener('mousemove', this.dragHandlers.move);
        doc.removeEventListener('mouseup', this.dragHandlers.up);
        this.dragHandlers = null;
        this.modalEl.classList.remove('ert-bug-report-shell--dragging');
    }
}
