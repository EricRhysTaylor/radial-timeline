import type { App, TextComponent, TFile } from 'obsidian';
import { Setting as ObsidianSetting, normalizePath, Notice, Modal, ButtonComponent, setIcon, setTooltip, TFolder } from 'obsidian';
import { NamePromptModal } from '../../ui/NamePromptModal';
import type RadialTimelinePlugin from '../../main';
import { CreateBookCopyModal } from '../../modals/CreateBookCopyModal';
import type { BookProfile } from '../../types/settings';
import { ModalFolderSuggest } from '../FolderSuggest';
import { DEFAULT_BOOK_TITLE, createBookId, getBookSequenceNumber, normalizeBookProfile, isBookIncludedInSaga } from '../../utils/books';
import {
    copyFolderRecursive,
    createBookCopyProfile,
    isFolderPathMissingOrRoot,
    isValidBookSourceFolder,
    resolveDraftTarget,
    suggestNextDraftLabel
} from '../../utils/draftBook';
import { ERT_CLASSES } from '../../ui/classes';
import { addHeadingIcon, applyErtHeaderLayout } from '../wikiLink';
import { consumeBookManagerAutoloadHighlight } from '../bookManagerAutoloadHighlight';
import { extractCountableBodyText } from '../../utils/manuscript';
import { countWords } from '../../utils/text';

class BookMetadataModal extends Modal {
    constructor(
        app: App,
        private book: BookProfile,
        private onSubmit: (metadata: Pick<BookProfile, 'genre' | 'projectStage' | 'publicLabel' | 'publicDescription'>) => Promise<void>
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '520px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Book' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Project metadata' });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Optional local metadata for future stats, cohorts, and public sharing.'
        });

        const form = contentEl.createDiv({ cls: 'ert-stack' });
        let genre = this.book.genre ?? '';
        let projectStage = this.book.projectStage ?? '';
        let publicLabel = this.book.publicLabel ?? '';
        let publicDescription = this.book.publicDescription ?? '';

        const addText = (name: string, desc: string, value: string, onChange: (value: string) => void) => {
            new ObsidianSetting(form)
                .setName(name)
                .setDesc(desc)
                .addText(text => {
                    text.setValue(value);
                    text.inputEl.addClass('ert-input--full');
                    text.onChange(onChange);
                });
        };

        addText('Genre', 'Optional grouping such as sci-fi, romance, mystery, or memoir.', genre, value => { genre = value; });
        addText('Project stage', 'Optional author-facing stage such as first book, querying, published, or revision.', projectStage, value => { projectStage = value; });
        addText('Public label', 'Optional public-facing label. Private book title remains separate.', publicLabel, value => { publicLabel = value; });

        new ObsidianSetting(form)
            .setName('Description')
            .setDesc('Optional author-facing or future public description.')
            .addTextArea(text => {
                text.setValue(publicDescription);
                text.inputEl.addClass('ert-input--full');
                text.inputEl.rows = 4;
                text.onChange(value => { publicDescription = value; });
            });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        const save = async () => {
            await this.onSubmit({ genre, projectStage, publicLabel, publicDescription });
            this.close();
        };
        new ButtonComponent(actions).setButtonText('Save').setCta().onClick(() => { void save(); });
        new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

export function renderGeneralSection(params: {
    app: App;
    plugin: RadialTimelinePlugin;
    attachFolderSuggest: (text: TextComponent) => void;
    containerEl: HTMLElement;
    addAiRelatedElement?: (el: HTMLElement) => void;
}): void {
    const { app, plugin, containerEl } = params;

    // --- Books Manager ---
    const booksHeading = new ObsidianSetting(containerEl)
        .setName('Books')
        .setDesc('The active book drives the timeline view, title and exports.')
        .setHeading();
    addHeadingIcon(booksHeading, 'library-big');
    applyErtHeaderLayout(booksHeading);
    // Stable scroll target for deep-links (e.g. the Welcome "Book Manager" link).
    booksHeading.settingEl.addClass('ert-books-heading');

    // "+" add-book button in the setting row's control column (far right)
    const addBookBtn = booksHeading.controlEl.createEl('button', {
        cls: 'ert-iconBtn ert-mod-cta ert-books-add-btn',
        attr: { 'aria-label': 'Add book', type: 'button' }
    });
    setIcon(addBookBtn, 'plus');

    const booksPanel = containerEl.createDiv({ cls: `${ERT_CLASSES.STACK} ert-books-panel` });
    const autoloadHighlightedBookId = consumeBookManagerAutoloadHighlight();

    /** Pulse the "+" button green when books need attention (no books, or missing source folder) */
    const updateAddBtnPulse = () => {
        const books = plugin.settings.books || [];
        const needsAttention = books.length === 0
            || books.some(b => {
                const rawFolder = (b.sourceFolder || '').trim();
                if (!rawFolder) return true;
                const normalizedFolder = normalizePath(rawFolder);
                return !(app.vault.getAbstractFileByPath(normalizedFolder) instanceof TFolder);
            });
        addBookBtn.toggleClass('ert-books-add-btn--pulse', needsAttention);
    };

    const addNewBook = async () => {
        const next = normalizeBookProfile({
            id: createBookId(),
            title: DEFAULT_BOOK_TITLE,
            sourceFolder: ''
        });
        plugin.settings.books = [...(plugin.settings.books || []), next];
        plugin.settings.activeBookId = next.id;
        await plugin.persistBookSettings();
        renderBooksManager();
    };

    addBookBtn.addEventListener('click', () => { void addNewBook(); }); // SAFE: direct addEventListener; Settings lifecycle manages cleanup

    const renderBooksManager = () => {
        booksPanel.empty();

        const books = plugin.settings.books || [];
        const activeId = plugin.settings.activeBookId;
        const dragState = { index: null as number | null };

        const createBookRowDragPreview = (event: DragEvent, rowEl: HTMLElement): (() => void) => {
            if (!event.dataTransfer) return () => undefined;
            const rect = rowEl.getBoundingClientRect();
            const preview = rowEl.cloneNode(true) as HTMLElement;
            preview.addClass('ert-book-card--dragPreview');
            preview.removeClass('is-dragging');
            preview.style.setProperty('--ert-book-drag-preview-width', `${Math.ceil(rect.width)}px`);
            preview.style.setProperty('--ert-book-drag-preview-height', `${Math.ceil(rect.height)}px`);
            rowEl.ownerDocument.body.appendChild(preview);

            const offsetX = event.clientX > 0 ? Math.max(20, event.clientX - rect.left) : 24;
            const offsetY = event.clientY > 0 ? Math.max(18, event.clientY - rect.top) : 24;
            event.dataTransfer.setDragImage(preview, offsetX, offsetY);

            return () => {
                window.setTimeout(() => preview.remove(), 0);
            };
        };

        const clearBookDragState = () => {
            booksPanel.removeClass('ert-books-panel--dragging');
            booksPanel.querySelectorAll('.ert-book-card.is-dragover').forEach(target => {
                target.removeClass('is-dragover');
            });
            booksPanel.querySelectorAll('.ert-book-card.is-dragging').forEach(source => {
                source.removeClass('is-dragging');
            });
            dragState.index = null;
        };

        const reorderBooks = async (fromIndex: number, toIndex: number) => {
            if (fromIndex === toIndex) return;
            if (fromIndex < 0 || fromIndex >= books.length || toIndex < 0 || toIndex >= books.length) return;
            const nextBooks = [...books];
            const [moved] = nextBooks.splice(fromIndex, 1);
            nextBooks.splice(toIndex, 0, moved);
            plugin.settings.books = nextBooks;
            await plugin.persistBookSettings();
            renderBooksManager();
        };

        if (books.length === 0) {
            const empty = booksPanel.createDiv({ cls: 'ert-bookmeta-preview-empty' });
            empty.createDiv({ cls: 'ert-bookmeta-preview-empty-title', text: 'No books configured' });
            empty.createDiv({
                cls: 'ert-bookmeta-preview-empty-desc',
                text: 'Add a book profile and set the title and folder.'
            });
            const actions = empty.createDiv({ cls: 'ert-bookmeta-preview-empty-actions' });
            new ButtonComponent(actions)
                .setButtonText('Add book')
                .setCta()
                .onClick(() => { void addNewBook(); });
            updateAddBtnPulse();
            return;
        }

        books.forEach((book, index) => {
            const isActive = book.id === activeId;
            const label = book.title?.trim() || DEFAULT_BOOK_TITLE;
            const sequenceNumber = getBookSequenceNumber(plugin.settings, book.id) ?? index + 1;
            const rawFolder = (book.sourceFolder || '').trim();
            const normalizedFolder = rawFolder ? normalizePath(rawFolder) : '';
            const abstractFolder = normalizedFolder
                ? app.vault.getAbstractFileByPath(normalizedFolder)
                : null;
            const hasConfiguredFolder = normalizedFolder.length > 0;
            const hasResolvedFolder = abstractFolder instanceof TFolder;
            const hasBrokenFolderLink = hasConfiguredFolder && !hasResolvedFolder;

            // ── Scene count (only Class: Scene files) ────────────────
            let sceneStatText = 'No folder';
            let sceneStatWarn = true;
            const sceneFiles: TFile[] = [];
            if (hasBrokenFolderLink) {
                sceneStatText = 'Folder missing';
            } else if (hasResolvedFolder) {
                const children = abstractFolder.children;
                for (const child of children) {
                    if (!child.path.endsWith('.md')) continue;
                    const tfile = app.vault.getAbstractFileByPath(child.path);
                    if (!tfile) continue;
                    const fm = app.metadataCache.getFileCache(tfile as import('obsidian').TFile)?.frontmatter;
                    if (fm && (fm.Class === 'Scene' || fm.class === 'Scene')) {
                        sceneFiles.push(tfile as TFile);
                    }
                }
                const sceneCount = sceneFiles.length;
                sceneStatText = sceneCount === 1 ? '1 scene' : `${sceneCount} scenes`;
                sceneStatWarn = false;
            }

            // ── Single-row book card (Setting row) ───────────────────
            const row = new ObsidianSetting(booksPanel);
            row.settingEl.addClass('ert-row', 'ert-book-card', isActive ? 'is-active' : 'is-inactive');
            if (book.id === autoloadHighlightedBookId) {
                row.settingEl.addClass('ert-book-card--autoloaded');
                row.settingEl.setAttr('aria-live', 'polite');
            }
            if (hasBrokenFolderLink) {
                row.settingEl.addClass('ert-book-card--link-broken');
            }
            row.settingEl.setAttribute('data-book-sequence', String(sequenceNumber));

            const dragHandle = row.settingEl.createDiv({ cls: 'ert-book-card__drag ert-drag-handle' });
            row.settingEl.insertBefore(dragHandle, row.infoEl);
            setIcon(dragHandle, 'grip-vertical');
            setTooltip(dragHandle, 'Drag to reorder books');
            dragHandle.draggable = books.length > 1;

            // Name: status icon + clickable title
            const nameEl = row.nameEl;
            nameEl.empty();
            nameEl.addClass('ert-book-card__name');

            const statusIcon = nameEl.createDiv({
                cls: `ert-book-card__status ${hasBrokenFolderLink ? 'ert-book-card__status--invalid' : isActive ? 'ert-book-card__status--active' : ''}`
            });
            setIcon(statusIcon, hasBrokenFolderLink ? 'x-circle' : 'check-circle');
            setTooltip(
                statusIcon,
                hasBrokenFolderLink
                    ? `Folder not found: ${normalizedFolder}`
                    : hasResolvedFolder
                        ? `Linked folder: ${normalizedFolder}`
                        : 'No folder linked'
            );

            const titleSpan = nameEl.createSpan({
                text: label,
                cls: 'ert-book-name ert-book-name--clickable'
            });
            titleSpan.setAttr('role', 'button');
            titleSpan.setAttr('tabindex', '0');
            titleSpan.setAttr('aria-label', `Rename "${label}"`);
            const openRename = () => {
                new NamePromptModal(app, {
                    badge: 'Edit',
                    title: 'Rename book',
                    subtitle: 'This name appears in the timeline header, tab, and exports.',
                    initialValue: label,
                    placeholder: DEFAULT_BOOK_TITLE,
                    actionLabel: 'Rename',
                    emptyNotice: 'Please enter a book title.',
                    onSubmit: async (newTitle) => {
                        const trimmed = newTitle.trim();
                        if (!trimmed) return false;
                        book.title = trimmed;
                        await plugin.persistBookSettings();
                        renderBooksManager();
                        return true;
                    }
                }).open();
            };
            titleSpan.addEventListener('click', (e) => { e.stopPropagation(); openRename(); }); // SAFE: direct addEventListener; Settings lifecycle manages cleanup
            titleSpan.addEventListener('keydown', (e: KeyboardEvent) => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRename(); }
            });

            if (book.copy) {
                nameEl.createSpan({ cls: ERT_CLASSES.BADGE_PILL, text: book.copy.kind === 'submission-snapshot' ? 'Submission snapshot' : 'Working draft' });
            }
            row.controlEl.createSpan({ cls: 'setting-item-description', text: 'Include in saga' });
            row.addToggle(toggle => {
                toggle.setValue(isBookIncludedInSaga(book));
                toggle.toggleEl.setAttr('aria-label', `Include ${label} in saga`);
                setTooltip(toggle.toggleEl, 'Include in saga');
                toggle.onChange(async value => {
                    book.includeInSaga = value;
                    await plugin.persistBookSettings();
                    renderBooksManager();
                });
            });

            // Desc: scene count stat
            row.setDesc(`BOOK ${sequenceNumber} — ${sceneStatText}`);
            row.descEl.addClass('ert-book-card__meta');
            if (book.id === autoloadHighlightedBookId) {
                row.descEl.setText(`BOOK ${sequenceNumber} — demo autoloaded · ${sceneStatText}`);
            }
            if (hasResolvedFolder) {
                const description = row.descEl.textContent;
                row.descEl.setText(`${description} — counting words…`);
                void (async () => {
                    try {
                        let totalWords = 0;
                        for (const file of sceneFiles) {
                            totalWords += countWords(extractCountableBodyText(await app.vault.cachedRead(file)));
                        }
                        const wordCountText = totalWords < 1000
                            ? String(totalWords)
                            : `${Math.round(totalWords / 1000)}k`;
                        row.descEl.setText(`${description} — ${wordCountText} ${totalWords === 1 ? 'word' : 'words'}`);
                        setTooltip(row.descEl, `${totalWords.toLocaleString()} words in scene bodies (excluding frontmatter and comments)`);
                    } catch (error) {
                        row.descEl.setText(`${description} — word count unavailable`);
                        console.error('[Radial Timeline] Could not count book words', error);
                    }
                })();
            }
            if (hasBrokenFolderLink) {
                row.descEl.addClass('ert-book-card__stat--invalid');
            } else if (sceneStatWarn) {
                row.descEl.addClass('ert-book-card__stat--warn');
            }

            // Activate: click the row (title stopPropagation prevents conflict)
            if (!isActive) {
                row.settingEl.addClass('ert-book-card--clickable');
                row.settingEl.addEventListener('click', () => { void (async () => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                    if (dragState.index !== null) return;
                    await plugin.setActiveBookId(book.id);
                    renderBooksManager();
                })(); });
                // Prevent input/trash clicks from activating
                row.controlEl.addEventListener('mousedown', (e) => e.stopPropagation()); // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                row.controlEl.addEventListener('click', (e) => e.stopPropagation()); // SAFE: direct addEventListener; Settings lifecycle manages cleanup
            }

            dragHandle.addEventListener('dragstart', (event: DragEvent) => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                dragState.index = index;
                booksPanel.addClass('ert-books-panel--dragging');
                row.settingEl.addClass('is-dragging');
                event.dataTransfer?.setData('text/plain', String(index));
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                    (dragHandle as HTMLElement & { __rtClearDragPreview?: () => void }).__rtClearDragPreview =
                        createBookRowDragPreview(event, row.settingEl);
                }
            });
            dragHandle.addEventListener('dragend', () => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                (dragHandle as HTMLElement & { __rtClearDragPreview?: () => void }).__rtClearDragPreview?.();
                delete (dragHandle as HTMLElement & { __rtClearDragPreview?: () => void }).__rtClearDragPreview;
                clearBookDragState();
            });
            row.settingEl.addEventListener('dragenter', (event: DragEvent) => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                event.preventDefault();
                row.settingEl.addClass('is-dragover');
            });
            row.settingEl.addEventListener('dragover', (event: DragEvent) => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                row.settingEl.addClass('is-dragover');
            });
            row.settingEl.addEventListener('dragleave', () => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                row.settingEl.removeClass('is-dragover');
            });
            row.settingEl.addEventListener('drop', (event: DragEvent) => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                event.preventDefault();
                row.settingEl.removeClass('is-dragover');
                const from = dragState.index ?? Number.parseInt(event.dataTransfer?.getData('text/plain') || '-1', 10);
                if (Number.isNaN(from) || from < 0 || from === index) {
                    clearBookDragState();
                    return;
                }
                clearBookDragState();
                void reorderBooks(from, index);
            });

            // Controls: source folder input + trash
            let creatingDraft = false;
            let draftButtonRef: ButtonComponent | null = null;
            const setDraftButtonState = (isBusy: boolean) => {
                creatingDraft = isBusy;
                if (!draftButtonRef) return;
                draftButtonRef.setDisabled(isBusy);
                setIcon(draftButtonRef.buttonEl, isBusy ? 'loader-2' : 'book-dashed');
            };

            row.addButton(button => {
                draftButtonRef = button;
                button.buttonEl.empty();
                button.buttonEl.addClass('ert-iconBtn');
                button.buttonEl.setAttr('aria-label', 'Create book copy…');
                setIcon(button.buttonEl, 'book-dashed');
                button.setTooltip('Create a submission snapshot or working draft in a sibling folder.');
                button.onClick(() => {
                    if (creatingDraft) return;

                    const sourceFolder = (book.sourceFolder || '').trim();
                    if (isFolderPathMissingOrRoot(sourceFolder)) {
                        new Notice('Book copy requires a book folder (vault root is not supported).');
                        return;
                    }

                    const normalizedSource = normalizePath(sourceFolder);
                    const sourceAbstract = app.vault.getAbstractFileByPath(normalizedSource);
                    if (!isValidBookSourceFolder(sourceAbstract)) {
                        new Notice(`Source folder not found: ${normalizedSource}`);
                        return;
                    }

                    const suggestedDraftName = suggestNextDraftLabel(app.vault, normalizedSource);
                    new CreateBookCopyModal(
                        app,
                        suggestedDraftName,
                        (candidateDraftName) => resolveDraftTarget(app.vault, normalizedSource, candidateDraftName).destinationPath,
                        async ({ name: draftName, kind, switchToCopy }) => {
                        if (creatingDraft) return false;
                        setDraftButtonState(true);
                        let previousActiveBookId = plugin.settings.activeBookId;
                        let previousScope = plugin.settings.timelineScope;
                        let previousSourcePath = plugin.settings.sourcePath;
                        let registeredBookId: string | undefined;
                        let destinationPath: string | undefined;
                        try {
                            const assertSourceUnchanged = () => {
                                if (!plugin.settings.books?.includes(book) || normalizePath(book.sourceFolder.trim()) !== normalizedSource) {
                                    throw new Error('The source book changed. Reopen Create book copy and try again.');
                                }
                            };
                            assertSourceUnchanged();
                            const target = resolveDraftTarget(app.vault, normalizedSource, draftName);
                            destinationPath = target.destinationPath;
                            const draftLabel = target.draftLabel;
                            await copyFolderRecursive(app.vault, normalizedSource, destinationPath);
                            assertSourceUnchanged();

                            const newBook = createBookCopyProfile(book, destinationPath, draftLabel, kind);

                            previousActiveBookId = plugin.settings.activeBookId;
                            previousScope = plugin.settings.timelineScope;
                            previousSourcePath = plugin.settings.sourcePath;
                            plugin.settings.books = [...(plugin.settings.books || []), newBook];
                            registeredBookId = newBook.id;
                            if (switchToCopy) {
                                plugin.settings.timelineScope = 'book';
                                plugin.settings.activeBookId = newBook.id;
                            }
                            await plugin.persistBookSettings();
                            renderBooksManager();
                            new Notice(`Book copy created: ${destinationPath}`);
                            return true;
                        } catch (error) {
                            if (registeredBookId) {
                                plugin.settings.books = plugin.settings.books?.filter(candidate => candidate.id !== registeredBookId);
                                if (plugin.settings.activeBookId === registeredBookId) {
                                    plugin.settings.activeBookId = previousActiveBookId;
                                    plugin.settings.timelineScope = previousScope;
                                    plugin.settings.sourcePath = previousSourcePath;
                                }
                            }
                            const msg = error instanceof Error ? error.message : String(error);
                            new Notice(`Book copy failed: ${msg}${destinationPath ? ` Inspect ${destinationPath} before retrying; copied files are retained.` : ''}`);
                            return false;
                        } finally {
                            setDraftButtonState(false);
                        }
                    }).open();
                });
            });

            row.addButton(button => {
                button.buttonEl.empty();
                button.buttonEl.addClass('ert-iconBtn');
                button.buttonEl.setAttr('aria-label', 'Project metadata');
                setIcon(button.buttonEl, 'tags');
                button.setTooltip('Edit optional genre, project stage, public label, and description.');
                button.onClick(() => {
                    new BookMetadataModal(app, book, async metadata => {
                        book.genre = metadata.genre?.trim() || undefined;
                        book.projectStage = metadata.projectStage?.trim() || undefined;
                        book.publicLabel = metadata.publicLabel?.trim() || undefined;
                        book.publicDescription = metadata.publicDescription?.trim() || undefined;
                        await plugin.persistBookSettings();
                        renderBooksManager();
                    }).open();
                });
            });

            row.addText(text => {
                text.setPlaceholder('Source folder').setValue(book.sourceFolder || '');
                text.inputEl.addClass('ert-input--full');

                const inputEl = text.inputEl;
                let blurCommitTimer: number | null = null;
                const resetState = () => {
                    inputEl.removeClass('ert-setting-input-success');
                    inputEl.removeClass('ert-setting-input-error');
                };

                const handleBlur = async (overrideValue?: string) => {
                    resetState();
                    const raw = (overrideValue ?? text.getValue()).trim();
                    const normalizedValue = raw ? normalizePath(raw) : '';

                    if (raw) {
                        const isValid = await plugin.validateAndRememberPath(normalizedValue);
                        if (isValid) {
                            book.sourceFolder = normalizedValue;
                            await plugin.persistBookSettings();
                            updateAddBtnPulse();
                            inputEl.addClass('ert-setting-input-success');
                            window.setTimeout(() => { inputEl.removeClass('ert-setting-input-success'); renderBooksManager(); }, 1000);
                        } else {
                            inputEl.addClass('ert-setting-input-error');
                            window.setTimeout(() => inputEl.removeClass('ert-setting-input-error'), 2000);
                        }
                    } else {
                        book.sourceFolder = '';
                        await plugin.persistBookSettings();
                        updateAddBtnPulse();
                        inputEl.addClass('ert-setting-input-success');
                        window.setTimeout(() => { inputEl.removeClass('ert-setting-input-success'); renderBooksManager(); }, 1000);
                    }
                };

                const folderSuggest = new ModalFolderSuggest(app, inputEl, (path) => {
                    text.setValue(path);
                    void handleBlur(path);
                });

                const openFolderSuggest = () => {
                    window.setTimeout(() => {
                        if (inputEl.ownerDocument.activeElement !== inputEl) return;
                        try { folderSuggest.open(); } catch { /* suggest popup is best-effort */ }
                    }, 0);
                };

                plugin.registerDomEvent(inputEl, 'keydown', (evt: KeyboardEvent) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        inputEl.blur();
                    }
                });

                plugin.registerDomEvent(inputEl, 'focus', openFolderSuggest);
                plugin.registerDomEvent(inputEl, 'click', openFolderSuggest);
                plugin.registerDomEvent(inputEl, 'blur', () => {
                    if (blurCommitTimer !== null) {
                        window.clearTimeout(blurCommitTimer);
                    }
                    blurCommitTimer = window.setTimeout(() => {
                        blurCommitTimer = null;
                        if (inputEl.ownerDocument.activeElement === inputEl) return;
                        void handleBlur();
                    }, 0);
                });
            });

            row.addExtraButton(button => {
                button.setIcon('trash-2');
                button.setTooltip('Remove profile (files are not deleted)');
                button.extraSettingsEl.addClass('ert-book-card__trash');
                button.onClick(async () => {
                    plugin.settings.books = books.filter(b => b.id !== book.id);
                    if (book.id === plugin.settings.activeBookId) {
                        plugin.settings.activeBookId = plugin.settings.books[0]?.id;
                    }
                    await plugin.persistBookSettings();
                    renderBooksManager();
                });
            });
        });

        // Update pulse state after render
        updateAddBtnPulse();
    };

    renderBooksManager();
}
