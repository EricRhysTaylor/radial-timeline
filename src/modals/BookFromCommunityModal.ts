/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * New book from Community: the preview of a book whose timeline was made on
 * the website, and the one button that writes it into the vault.
 *
 * Opened from the Book from Community card (Settings → Community) and from the
 * website's link, `obsidian://radial-timeline-transfer?id=<transfer id>`. It
 * reads the book from Community, shows the folder that will be created, how
 * many scene notes and how many carry released text, and writes nothing until
 * Create book. A book already on its way continues from its record
 * (bookTransferWriter.ts) with Continue.
 */

import { App, ButtonComponent, Notice, TextComponent } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
    BOOK_TRANSFER_FAILED,
    CommunityShareError,
    readBookTransfer,
} from '../communityShare/communityShareClient';
import { bookTransferFor, normalizeCommunityShareSettings } from '../communityShare/communityShareSettings';
import type { BookTransferRead } from '../communityShare/bookTransferDocument';
import {
    checkTransferFolder,
    planBookTransfer,
    suggestTransferFolder,
    transferActCounts,
    transferSubplotCount,
    type BookTransferPlan,
    type TransferFolderProblem,
} from '../communityShare/bookTransferPlan';
import {
    obsidianBookTransferDeps,
    runBookTransfer,
    settleUnreadableTransfer,
    takenInVault,
    type BookTransferProgress,
} from '../communityShare/bookTransferWriter';
import { t, tCount } from '../i18n';
import { ERT_CLASSES } from '../ui/classes';
import { ErtModal } from '../ui/ErtModal';
import { getOverlappingBook } from '../utils/books';

export interface BookFromCommunityOptions {
    /** The card or the link: called when the book was made, or its record changed. */
    onChanged?: () => void;
}

/** The Folder field, named by its label. */
const FOLDER_FIELD_ID = 'ert-bookFromCommunity-folder';

function errorText(error: unknown, fallback: string): string {
    if (error instanceof CommunityShareError && error.code !== BOOK_TRANSFER_FAILED) return error.message;
    return fallback;
}

function folderProblemText(folder: string, problem: TransferFolderProblem): string {
    switch (problem.kind) {
        case 'empty': return t('ui.bookFromCommunity.folderEmpty');
        case 'invalid': return t('ui.bookFromCommunity.folderInvalid');
        case 'trailing': return t('ui.bookFromCommunity.folderTrailing', { name: problem.name });
        case 'reserved': return t('ui.bookFromCommunity.folderReserved', { name: problem.name });
        case 'exists': return t('ui.bookFromCommunity.folderExists', { folder });
        case 'overlap': return t('ui.bookFromCommunity.folderOverlapsBook', { folder, book: problem.book });
        case 'parent': return t('ui.bookFromCommunity.folderParentMissing', { parent: problem.parent });
    }
}

function progressText(progress: BookTransferProgress): string {
    if (progress.step === 'writing') return t('ui.bookFromCommunity.progressWriting', { done: progress.written, total: progress.total });
    return t(progress.step === 'checking' ? 'ui.bookFromCommunity.progressChecking' : 'ui.bookFromCommunity.progressTelling');
}

export class BookFromCommunityModal extends ErtModal {
    private read: BookTransferRead | null = null;
    private plan: BookTransferPlan | null = null;
    private loading = true;
    private loadError: string | null = null;
    private stopped: string | null = null;
    private running = false;
    private closed = false;
    private folder = '';
    private progressEl: HTMLElement | null = null;

    constructor(
        app: App,
        private readonly plugin: RadialTimelinePlugin,
        private readonly transferId: string,
        private readonly options: BookFromCommunityOptions = {}
    ) {
        super(app);
    }

    onOpen(): void {
        this.applyShell({ width: 'min(620px, 92vw)', containerClasses: ['ert-bookFromCommunity'] });
        this.render();
        void this.load();
    }

    onClose(): void {
        this.closed = true;
        this.contentEl.empty();
    }

    /** This transfer's record, read fresh: the writer saves it after every note. */
    private record() {
        return bookTransferFor(normalizeCommunityShareSettings(this.plugin.settings.communityShare), this.transferId);
    }

    private async load(): Promise<void> {
        const record = this.record();
        // A book already written and checked needs nothing more from Community but its answer.
        if (!record || record.phase === 'writing') {
            try {
                this.read = await readBookTransfer(this.plugin, this.transferId);
                this.plan = await planBookTransfer({ document: this.read.document, releasedText: this.read.releasedText, settings: this.plugin.settings });
                this.folder = this.suggestFolder(this.plan.title);
            } catch (error) {
                this.loadError = errorText(error, t('ui.communityShareClient.bookTransferFailed'));
                if (record) await this.settleEndedTransfer(error);
            }
        }
        this.loading = false;
        this.render();
    }

    /** The book can no longer be read: when Community ended it, or no longer has it, the record says so. */
    private async settleEndedTransfer(readError: unknown): Promise<void> {
        try {
            if (!await settleUnreadableTransfer(obsidianBookTransferDeps(this.plugin), this.transferId, readError)) return;
            this.loadError = null;
            this.options.onChanged?.();
        } catch (error) {
            // Plugin data could not be saved; the read's own sentence stays on screen.
            console.error('Book from Community could not save its record:', error);
        }
    }

    private suggestFolder(title: string): string {
        const books = this.plugin.settings.books ?? []; // SAFE: a vault with no books suggests a folder at the vault root
        const active = books.find(book => book.id === this.plugin.settings.activeBookId);
        return suggestTransferFolder(title, active?.sourceFolder, folder => takenInVault(this.app, folder) || !!getOverlappingBook(books, folder));
    }

    private checkFolder() {
        return checkTransferFolder(this.folder, {
            exists: path => takenInVault(this.app, path),
            isFolder: path => this.app.vault.getFolderByPath(path) !== null,
        }, this.plugin.settings.books);
    }

    private render(): void {
        if (this.closed) return;
        const { contentEl } = this;
        contentEl.empty();
        this.progressEl = null;
        const record = this.record();
        // The book's name rides in the pill, as other modals name their subject there.
        const title = this.plan?.title ?? record?.title;
        this.mountHeader({
            badge: { text: title ? t('ui.bookFromCommunity.modalBadgeTitled', { title }) : t('ui.bookFromCommunity.modalBadge') },
            title: t('ui.bookFromCommunity.modalTitle'),
            subtitle: t('ui.bookFromCommunity.modalSubtitle'),
        });

        if (this.loading) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.bookFromCommunity.loading') });
            return;
        }
        if (record?.phase === 'cancelled') {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.bookFromCommunity.cancelled', { folder: record.folder }) });
            new ButtonComponent(this.mountActions())
                .setButtonText(t('ui.bookFromCommunity.cardCancelledButton'))
                .setCta()
                .onClick(async () => {
                    try {
                        await obsidianBookTransferDeps(this.plugin).store.remove(this.transferId);
                    } catch (error) {
                        // Plugin data could not be saved; the record stays and the modal stays open.
                        console.error('Book from Community could not save its record:', error);
                        return;
                    }
                    this.options.onChanged?.();
                    this.close();
                });
            return;
        }
        if (this.loadError) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: this.loadError });
            this.mountClose();
            return;
        }

        if (record) this.renderContinue(record.folder, Object.keys(record.notes).length);
        else this.renderPreview();
    }

    /** The key figures, label over number, in one row. */
    private mountFigures(figures: Array<[label: string, value: number]>): void {
        const row = this.contentEl.createDiv({ cls: 'ert-gossamer-proc-stats ert-bookFromCommunity__figures' });
        for (const [label, value] of figures) {
            const cell = row.createDiv({ cls: 'ert-gossamer-proc-stat-item' });
            cell.createDiv({ cls: 'ert-gossamer-proc-stat-label', text: label });
            cell.createDiv({ cls: 'ert-gossamer-proc-stat-value', text: value.toLocaleString() });
        }
    }

    /** The Folder block: its label, then the field or the folder's path, then one line under it. */
    private mountFolder<T>(fill: (block: HTMLElement) => T): { value: T; note: HTMLElement } {
        const block = this.contentEl.createDiv({ cls: 'ert-bookFromCommunity__folder' });
        block.createEl('label', { cls: 'ert-bookFromCommunity__label', text: t('ui.bookFromCommunity.folderName'), attr: { for: FOLDER_FIELD_ID } });
        const value = fill(block);
        return { value, note: block.createDiv({ cls: `${ERT_CLASSES.FIELD_NOTE} ert-bookFromCommunity__folderNote` }) };
    }

    /** A sentence the author must act on, or should know before Create book. */
    private mountAttention(text: string): void {
        this.contentEl.createDiv({ cls: 'ert-bookFromCommunity__attention', text });
    }

    private renderContinue(folder: string, written: number): void {
        const { contentEl } = this;
        const total = this.plan?.notes.length;
        const { note } = this.mountFolder(block => block.createDiv({ cls: 'ert-bookFromCommunity__path', text: folder }));
        note.setText(t('ui.bookFromCommunity.folderContinues'));
        if (total !== undefined) {
            contentEl.createDiv({ text: t('ui.bookFromCommunity.notesWritten', { written, notes: tCount('sceneNote', total) }) });
        }
        this.mountProgressAndStop();
        const actions = this.mountActions();
        new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => this.close());
        new ButtonComponent(actions)
            .setButtonText(t('ui.bookFromCommunity.continueButton'))
            .setCta()
            .setDisabled(this.running)
            .onClick(() => this.run());
    }

    private renderPreview(): void {
        const plan = this.plan;
        const read = this.read;
        if (!plan || !read) return;
        const { contentEl } = this;
        const acts = transferActCounts(read.document, this.plugin.settings);

        // Acts: the count the book takes in this vault; a book this vault cannot hold shows its own.
        const figures: Array<[string, number]> = [
            [t('ui.bookFromCommunity.figureScenes'), plan.notes.length],
            [t('ui.bookFromCommunity.figureActs'), acts.blocked ? acts.book : acts.vault],
            [t('ui.bookFromCommunity.figureSubplots'), transferSubplotCount(read.document)],
        ];
        if (plan.releasedTextCount > 0) figures.push([t('ui.bookFromCommunity.figureReleased'), plan.releasedTextCount]);
        this.mountFigures(figures);

        const { value: field, note: folderNote } = this.mountFolder(block => {
            const text = new TextComponent(block);
            text.inputEl.addClass('ert-input');
            text.inputEl.id = FOLDER_FIELD_ID;
            return text;
        });
        let create: ButtonComponent | null = null;
        const syncFolder = (): void => {
            const { folder, problem } = this.checkFolder();
            folderNote.setText(problem ? folderProblemText(folder, problem) : t('ui.bookFromCommunity.folderHelp'));
            folderNote.toggleClass('is-problem', problem !== null);
            create?.setDisabled(this.running || acts.blocked || problem !== null);
        };
        field.setValue(this.folder).onChange(value => {
            this.folder = value;
            this.stopped = null;
            syncFolder();
        });

        contentEl.createDiv({ cls: 'ert-bookFromCommunity__summary', text: t('ui.bookFromCommunity.summary') });
        if (acts.blocked) this.mountAttention(t('ui.bookFromCommunity.actsBlocked', { book: acts.book, vault: acts.vault }));
        if (plan.textDiffersCount > 0) this.mountAttention(t('ui.bookFromCommunity.textDiffers', { notes: tCount('sceneNote', plan.textDiffersCount) }));
        if (plan.detailsKeptCount > 0) this.mountAttention(t('ui.bookFromCommunity.detailsKept', { notes: tCount('sceneNote', plan.detailsKeptCount) }));

        this.mountProgressAndStop();
        const actions = this.mountActions();
        new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => this.close());
        create = new ButtonComponent(actions)
            .setButtonText(t('ui.bookFromCommunity.createButton'))
            .setCta()
            .onClick(() => this.run());
        syncFolder();
    }

    private mountProgressAndStop(): void {
        this.progressEl = this.contentEl.createDiv({ cls: `${ERT_CLASSES.FIELD_NOTE} ert-bookFromCommunity__progress` });
        if (this.stopped) this.progressEl.setText(this.stopped);
    }

    private mountClose(): void {
        new ButtonComponent(this.mountActions())
            .setButtonText(t('ui.bookFromCommunity.close'))
            .onClick(() => this.close());
    }

    /** Create book and Continue: the one place notes are written from. */
    private async run(): Promise<void> {
        if (this.running) return;
        const record = this.record();
        const connection = normalizeCommunityShareSettings(this.plugin.settings.communityShare).connection;
        if (!connection.profileId || !connection.connectionId) {
            this.stopped = t('ui.communityShareClient.connectBeforeSync');
            this.render();
            return;
        }
        const title = record?.title ?? this.plan?.title;
        if (!title) return;
        let folder = record?.folder ?? this.folder;
        if (!record) {
            const check = this.checkFolder();
            if (check.problem) {
                this.stopped = folderProblemText(check.folder, check.problem);
                this.render();
                return;
            }
            folder = check.folder;
        }

        this.running = true;
        this.stopped = null;
        this.render();
        try {
            const outcome = await runBookTransfer(obsidianBookTransferDeps(this.plugin), {
                transferId: this.transferId,
                notes: this.plan?.notes,
                folder,
                title,
                profileId: connection.profileId,
                connectionId: connection.connectionId,
            }, progress => { this.progressEl?.setText(progressText(progress)); });
            this.running = false;
            if (outcome.kind === 'done') {
                new Notice(t('ui.bookFromCommunity.doneNotice', { title: outcome.title }));
                this.options.onChanged?.();
                if (!this.closed) this.close();
                return;
            }
            if (outcome.kind === 'stopped') this.stopped = outcome.message;
            this.options.onChanged?.();
        } catch (error) {
            // Plugin data or the vault failed mid-step. The record holds what was done; Continue picks up from it.
            console.error('Book from Community stopped:', error);
            this.running = false;
            this.stopped = error instanceof CommunityShareError ? error.message : t('ui.bookFromCommunity.writeFailed');
        }
        this.render();
    }
}
