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

import { App, ButtonComponent, Notice, Setting } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
    BOOK_TRANSFER_FAILED,
    CommunityShareError,
    fetchBookTransferState,
    readBookTransfer,
} from '../communityShare/communityShareClient';
import { bookTransferFor, normalizeCommunityShareSettings } from '../communityShare/communityShareSettings';
import type { BookTransferRead } from '../communityShare/bookTransferDocument';
import {
    checkTransferFolder,
    planBookTransfer,
    suggestTransferFolder,
    transferActCounts,
    type BookTransferPlan,
    type TransferFolderProblem,
} from '../communityShare/bookTransferPlan';
import {
    obsidianBookTransferDeps,
    runBookTransfer,
    takenInVault,
    type BookTransferProgress,
} from '../communityShare/bookTransferWriter';
import { t, tCount } from '../i18n';
import { formatCommunityDate } from '../settings/sections/CommunityTimelineBlock';
import { ERT_CLASSES } from '../ui/classes';
import { ErtModal } from '../ui/ErtModal';
import { getOverlappingBook } from '../utils/books';

export interface BookFromCommunityOptions {
    /** The card or the link: called when the book was made, or its record changed. */
    onChanged?: () => void;
}

function errorText(error: unknown, fallback: string): string {
    if (error instanceof CommunityShareError && error.code !== BOOK_TRANSFER_FAILED) return error.message;
    return fallback;
}

function folderProblemText(folder: string, problem: TransferFolderProblem): string {
    switch (problem.kind) {
        case 'empty': return t('ui.bookFromCommunity.folderEmpty');
        case 'invalid': return t('ui.bookFromCommunity.folderInvalid');
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
        this.applyShell({ width: 'min(620px, 92vw)' });
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
                if (record) await this.settleEndedTransfer();
            }
        }
        this.loading = false;
        this.render();
    }

    /** The book can no longer be read: when Community ended it after notes were written, the record says so. */
    private async settleEndedTransfer(): Promise<void> {
        const record = this.record();
        if (!record) return;
        try {
            const state = await fetchBookTransferState(this.plugin, this.transferId);
            if (state.state === 'open' || (state.state === 'done' && state.pluginBookKey === record.bookId)) return;
            await obsidianBookTransferDeps(this.plugin).store.put(this.transferId, { ...record, phase: 'cancelled' });
            this.loadError = null;
            this.options.onChanged?.();
        } catch {
            // The read's own sentence stays on screen.
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
        this.mountHeader({
            badge: { text: t('ui.bookFromCommunity.modalBadge') },
            title: t('ui.bookFromCommunity.modalTitle'),
            subtitle: this.plan?.title ?? record?.title,
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
                    await obsidianBookTransferDeps(this.plugin).store.remove(this.transferId);
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

    private renderContinue(folder: string, written: number): void {
        const { contentEl } = this;
        const total = this.plan?.notes.length;
        const row = new Setting(contentEl).setName(t('ui.bookFromCommunity.folderName')).setDesc(t('ui.bookFromCommunity.folderContinues'));
        row.controlEl.createSpan({ text: folder });
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

        const folderRow = new Setting(contentEl)
            .setName(t('ui.bookFromCommunity.folderName'))
            .setDesc(t('ui.bookFromCommunity.folderDesc'));
        const folderNote = folderRow.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE });
        let create: ButtonComponent | null = null;
        const syncFolder = (): void => {
            const { folder, problem } = this.checkFolder();
            folderNote.setText(problem ? folderProblemText(folder, problem) : '');
            create?.setDisabled(this.running || acts.blocked || problem !== null);
        };
        folderRow.addText(text => {
            text.inputEl.addClass('ert-input');
            text.setValue(this.folder).onChange(value => {
                this.folder = value;
                this.stopped = null;
                syncFolder();
            });
        });

        contentEl.createDiv({
            text: plan.releasedTextCount > 0
                ? t('ui.bookFromCommunity.notesCountWithText', { notes: tCount('sceneNote', plan.notes.length), released: plan.releasedTextCount })
                : t('ui.bookFromCommunity.notesCount', { notes: tCount('sceneNote', plan.notes.length) }),
        });
        const note = (text: string): void => { contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text }); };
        if (acts.blocked) note(t('ui.bookFromCommunity.actsBlocked', { book: acts.book, vault: acts.vault }));
        else if (acts.book !== acts.vault) note(t('ui.bookFromCommunity.actsFollowVault', { vault: acts.vault }));
        if (plan.textDiffersCount > 0) note(t('ui.bookFromCommunity.textDiffers', { notes: tCount('sceneNote', plan.textDiffersCount) }));
        if (plan.detailsKeptCount > 0) note(t('ui.bookFromCommunity.detailsKept', { notes: tCount('sceneNote', plan.detailsKeptCount) }));
        note(t('ui.bookFromCommunity.afterNote'));
        note(t('ui.bookFromCommunity.expiresNote', { date: formatCommunityDate(read.expiresAt) }));

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
        this.progressEl = this.contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE });
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
