import { setAccessibleLabel, setTooltip, withAccessibleLabel, withTooltip } from '../../utils/domTooltip';
import type { App } from 'obsidian';
import { Setting as ObsidianSetting, normalizePath, Notice, Modal, ButtonComponent, ExtraButtonComponent, TextComponent, setIcon, TFile, TFolder } from 'obsidian';
import { OnboardingModal, candidateParts } from '../../modals/OnboardingModal';
import { OnboardingService } from '../../onboarding/OnboardingService';
import { basename } from '../../onboarding/paths';
import { countSceneNotes, discoverOnboardingCandidates, holdsManuscriptExport } from '../../onboarding/discovery';
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
import { t, tCount } from '../../i18n';

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
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.generalSection.metadataBadge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.generalSection.metadataTitle') });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('ui.generalSection.metadataSubtitle')
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

        addText(t('ui.generalSection.genreName'), t('ui.generalSection.genreDesc'), genre, value => { genre = value; });
        addText(t('ui.generalSection.projectStageName'), t('ui.generalSection.projectStageDesc'), projectStage, value => { projectStage = value; });
        addText(t('ui.generalSection.publicLabelName'), t('ui.generalSection.publicLabelDesc'), publicLabel, value => { publicLabel = value; });

        new ObsidianSetting(form)
            .setName(t('ui.generalSection.descriptionName'))
            .setDesc(t('ui.generalSection.descriptionDesc'))
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
        new ButtonComponent(actions).setButtonText(t('common.save')).setCta().onClick(() => { void save(); });
        new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => this.close());
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
        .setName(t('ui.generalSection.booksName'))
        .setDesc(t('ui.generalSection.booksDesc'))
        .setHeading();
    addHeadingIcon(booksHeading, 'library-big');
    applyErtHeaderLayout(booksHeading);
    // Stable scroll target for deep-links (e.g. the Welcome "Book Manager" link).
    booksHeading.settingEl.addClass('ert-books-heading');

    // "+" add-book button in the setting row's control column (far right)
    const addBookBtn = withAccessibleLabel(booksHeading.controlEl.createEl('button', {
        cls: 'ert-iconBtn ert-mod-cta ert-books-add-btn',
        attr: { type: 'button' }
    }), t('ui.generalSection.addBook'));
    setIcon(addBookBtn, 'plus');

    // Existing books and manuscripts: a folder of scene notes is added as it
    // is; a Scrivener or Word export goes through the import. Keeping the two
    // apart is the point: importing a book folder would only copy it.
    const discoveryPanel = containerEl.createDiv({ cls: 'ert-panel ert-stack' });
    const scanSetting = new ObsidianSetting(discoveryPanel)
        .setName(t('ui.generalSection.importName'))
        .setDesc(t('ui.generalSection.importDesc'))
        .addButton(button => button.setButtonText(t('commands.onboardManuscript')).onClick(() => openImport()));
    const candidatesEl = discoveryPanel.createDiv({ cls: 'ert-stack' });
    let scanned = false;
    const scan = async () => {
        scanned = true;
        candidatesEl.setText(t('ui.generalSection.scanningVault'));
        try {
            const candidates = await discoverOnboardingCandidates(app, (plugin.settings.books ?? []).map(book => book.sourceFolder)); // SAFE: a new vault has no registered books
            if (!candidatesEl.isConnected) return;
            candidatesEl.empty();
            if (candidates.length === 0) candidatesEl.createDiv({ cls: 'ert-section-desc', text: t('ui.generalSection.noExportsFound') });
            for (const candidate of candidates) {
                const row = new ObsidianSetting(candidatesEl)
                    .setName(candidate.folder)
                    .setDesc(candidateParts(candidate).map(part => part.value).join(' · '));
                if (candidate.kind === 'book') {
                    row.addButton(button => button.setButtonText(t('ui.generalSection.addBook')).setCta().onClick(async () => {
                        await new OnboardingService(plugin).addBook({ title: basename(candidate.folder), sourceFolder: candidate.folder });
                        renderBooksManager();
                        void scan();
                    }));
                } else {
                    row.addButton(button => button.setButtonText(t('ui.generalSection.importAction')).onClick(() => openImport(candidate.folder)));
                }
            }
        } catch (error) {
            if (candidatesEl.isConnected) candidatesEl.setText(t('ui.onboardingModal.cannotScanVault', { message: error instanceof Error ? error.message : String(error) }));
        }
    };
    /** Import a manuscript; afterwards Book Manager and any scan results redraw. */
    const openImport = (folder?: string, onImported?: () => void) => {
        const before = (plugin.settings.books ?? []).length; // SAFE: a new vault has no books
        new OnboardingModal(app, plugin, {
            folder,
            onClosed: () => {
                if ((plugin.settings.books ?? []).length > before) onImported?.(); // SAFE: a new vault has no books
                renderBooksManager();
                if (scanned) void scan();
            },
        }).open();
    };
    scanSetting.addButton(button => button.setButtonText(t('ui.generalSection.scanVault')).onClick(() => void scan()));
    if (!(plugin.settings.books ?? []).some(book => book.sourceFolder && app.vault.getAbstractFileByPath(book.sourceFolder) instanceof TFolder)) void scan(); // SAFE: only first-run or unconfigured vaults scan automatically

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

    /** Each card's folder input, so "+" can take the author straight to it. */
    const folderInputs = new Map<string, HTMLInputElement>();

    /**
     * "+" opens a card for a book's folder. It never switches the timeline: a
     * book shows once its folder holds scenes. One blank card at a time, so
     * "+" returns to the one still waiting for its folder.
     */
    const addNewBook = async () => {
        const books = plugin.settings.books ?? []; // SAFE: a new vault has no books
        let blank = books.find(book => !book.sourceFolder.trim());
        if (!blank) {
            blank = normalizeBookProfile({ id: createBookId(), title: DEFAULT_BOOK_TITLE, sourceFolder: '' });
            plugin.settings.books = [...books, blank];
            if (books.length === 0) plugin.settings.activeBookId = blank.id;
            await plugin.persistBookSettings();
        }
        renderBooksManager();
        const input = folderInputs.get(blank.id);
        input?.scrollIntoView({ block: 'center' });
        input?.focus();
    };

    addBookBtn.addEventListener('click', () => { void addNewBook(); }); // SAFE: direct addEventListener; Settings lifecycle manages cleanup

    const renderBooksManager = () => {
        booksPanel.empty();
        folderInputs.clear();

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
            empty.createDiv({ cls: 'ert-bookmeta-preview-empty-title', text: t('ui.generalSection.noBooksTitle') });
            empty.createDiv({
                cls: 'ert-bookmeta-preview-empty-desc',
                text: t('ui.generalSection.noBooksDesc')
            });
            const actions = empty.createDiv({ cls: 'ert-bookmeta-preview-empty-actions' });
            new ButtonComponent(actions)
                .setButtonText(t('ui.generalSection.addBook'))
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
            let sceneStatText = t('ui.generalSection.noFolder');
            let sceneStatWarn = true;
            const sceneFiles: TFile[] = [];
            if (hasBrokenFolderLink) {
                sceneStatText = t('ui.generalSection.folderMissing');
            } else if (hasResolvedFolder) {
                const children = abstractFolder.children;
                for (const child of children) {
                    if (!child.path.endsWith('.md')) continue;
                    const tfile = app.vault.getAbstractFileByPath(child.path);
                    if (!(tfile instanceof TFile)) continue;
                    const fm = app.metadataCache.getFileCache(tfile)?.frontmatter;
                    if (fm && (fm.Class === 'Scene' || fm.class === 'Scene')) {
                        sceneFiles.push(tfile);
                    }
                }
                const sceneCount = sceneFiles.length;
                sceneStatText = tCount('scene', sceneCount);
                sceneStatWarn = false;
            }

            // ── Book card: title + controls on row 1, folder + trash on row 2 ──
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
            setTooltip(dragHandle, t('ui.generalSection.dragToReorder'));
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
                    ? t('ui.generalSection.folderNotFound', { folder: normalizedFolder })
                    : hasResolvedFolder
                        ? t('ui.generalSection.linkedFolder', { folder: normalizedFolder })
                        : t('ui.generalSection.noFolderLinked')
            );

            const titleSpan = nameEl.createSpan({
                text: label,
                cls: 'ert-book-name ert-book-name--clickable'
            });
            titleSpan.setAttr('role', 'button');
            titleSpan.setAttr('tabindex', '0');
            setAccessibleLabel(titleSpan, t('ui.generalSection.renameAria', { title: label }));
            const openRename = () => {
                new NamePromptModal(app, {
                    badge: t('ui.generalSection.renameBadge'),
                    title: t('ui.generalSection.renameTitle'),
                    subtitle: t('ui.generalSection.renameSubtitle'),
                    initialValue: label,
                    placeholder: DEFAULT_BOOK_TITLE,
                    actionLabel: t('ui.generalSection.renameAction'),
                    emptyNotice: t('ui.generalSection.renameEmptyNotice'),
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
                nameEl.createSpan({ cls: ERT_CLASSES.BADGE_PILL, text: book.copy.kind === 'submission-snapshot' ? t('ui.generalSection.submissionSnapshot') : t('ui.generalSection.workingDraft') });
            }
            row.controlEl.createSpan({ cls: 'setting-item-description', text: t('ui.generalSection.includeInSaga') });
            row.addToggle(toggle => {
                toggle.setValue(isBookIncludedInSaga(book));
                setAccessibleLabel(toggle.toggleEl, t('ui.generalSection.includeInSagaAria', { title: label }));
                toggle.onChange(async value => {
                    book.includeInSaga = value;
                    await plugin.persistBookSettings();
                    renderBooksManager();
                });
            });

            // Desc: scene count stat
            row.setDesc(t('ui.generalSection.bookMeta', { number: sequenceNumber, stat: sceneStatText }));
            row.descEl.addClass('ert-book-card__meta');
            if (book.id === autoloadHighlightedBookId) {
                row.descEl.setText(t('ui.generalSection.bookMetaAutoloaded', { number: sequenceNumber, stat: sceneStatText }));
            }
            if (hasResolvedFolder) {
                const description = row.descEl.textContent;
                row.descEl.setText(t('ui.generalSection.countingWords', { desc: description }));
                void (async () => {
                    try {
                        let totalWords = 0;
                        for (const file of sceneFiles) {
                            totalWords += countWords(extractCountableBodyText(await app.vault.cachedRead(file)));
                        }
                        const wordCountText = totalWords < 1000
                            ? tCount('word', totalWords)
                            : t('ui.generalSection.thousandsOfWords', { count: Math.round(totalWords / 1000) });
                        row.descEl.setText(t('ui.generalSection.wordCountMeta', { desc: description, words: wordCountText }));
                        setTooltip(row.descEl, t('ui.generalSection.wordCountTooltip', { count: totalWords.toLocaleString() }));
                    } catch (error) {
                        row.descEl.setText(t('ui.generalSection.wordCountUnavailable', { desc: description }));
                        console.error('[Radial Timeline] Could not count book words', error);
                    }
                })();
            }
            if (hasBrokenFolderLink) {
                row.descEl.addClass('ert-book-card__stat--invalid');
            } else if (sceneStatWarn) {
                row.descEl.addClass('ert-book-card__stat--warn');
            }

            // Row 2 holds the source folder input + trash, spanning under title and controls
            const folderRow = row.settingEl.createDiv({ cls: 'ert-book-card__folder' });

            // Activate: click the row (title stopPropagation prevents conflict).
            // Only a book whose folder exists can become the timeline's book; a
            // card still waiting for its folder, or with a missing one, cannot.
            if (!isActive && hasResolvedFolder) {
                row.settingEl.addClass('ert-book-card--clickable');
                row.settingEl.addEventListener('click', () => { void (async () => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                    if (dragState.index !== null) return;
                    await plugin.setActiveBookId(book.id);
                    renderBooksManager();
                })(); });
                // Prevent control/input/trash clicks from activating
                for (const controlArea of [row.controlEl, folderRow]) {
                    controlArea.addEventListener('mousedown', (e) => e.stopPropagation()); // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                    controlArea.addEventListener('click', (e) => e.stopPropagation()); // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                }
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

            // Row 1 controls: saga toggle (above) + book copy + metadata
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
                setAccessibleLabel(button.buttonEl, t('ui.generalSection.createCopyAria'));
                setIcon(button.buttonEl, 'book-dashed');
                withTooltip(button, t('ui.generalSection.createCopyTooltip'));
                button.onClick(() => {
                    if (creatingDraft) return;

                    const sourceFolder = (book.sourceFolder || '').trim();
                    if (isFolderPathMissingOrRoot(sourceFolder)) {
                        new Notice(t('ui.generalSection.copyNeedsFolderNotice'));
                        return;
                    }

                    const normalizedSource = normalizePath(sourceFolder);
                    const sourceAbstract = app.vault.getAbstractFileByPath(normalizedSource);
                    if (!isValidBookSourceFolder(sourceAbstract)) {
                        new Notice(t('ui.generalSection.sourceFolderNotFoundNotice', { folder: normalizedSource }));
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
                                    throw new Error(t('ui.generalSection.sourceChangedError'));
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
                            new Notice(t('ui.generalSection.copyCreatedNotice', { path: destinationPath }));
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
                            new Notice(destinationPath
                                ? t('ui.generalSection.copyFailedRetainedNotice', { error: msg, path: destinationPath })
                                : t('ui.generalSection.copyFailedNotice', { error: msg }));
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
                setAccessibleLabel(button.buttonEl, t('ui.generalSection.metadataTitle'));
                setIcon(button.buttonEl, 'tags');
                withTooltip(button, t('ui.generalSection.metadataTooltip'));
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

            const text = new TextComponent(folderRow);
            text.setPlaceholder(t('ui.generalSection.sourceFolderPlaceholder')).setValue(book.sourceFolder || '');
            text.inputEl.addClass('ert-input--full');

            const inputEl = text.inputEl;
            folderInputs.set(book.id, inputEl);
            // A sceneless folder holding .txt or .docx files may be an export:
            // the hint offers the import.
            const exportHint = row.settingEl.createDiv({ cls: 'ert-book-card__hint' });
            const showExportHint = (folder: string) => {
                exportHint.empty();
                exportHint.createSpan({ cls: 'ert-section-desc ert-section-desc--alert', text: t('ui.generalSection.folderHoldsExport') });
                new ButtonComponent(exportHint).setButtonText(t('ui.generalSection.importAction')).onClick(() => openImport(folder, () => {
                    // The import made the book this card was waiting for (beside the export).
                    if (book.sourceFolder.trim() && countSceneNotes(app, book.sourceFolder) > 0) return;
                    plugin.settings.books = (plugin.settings.books ?? []).filter(candidate => candidate.id !== book.id); // SAFE: the list holds at least the imported book
                    void plugin.persistBookSettings();
                }));
            };
            if (hasResolvedFolder && sceneFiles.length === 0 && countSceneNotes(app, normalizedFolder) === 0 && holdsManuscriptExport(app, normalizedFolder)) showExportHint(normalizedFolder);
            let blurCommitTimer: number | null = null;
            const resetState = () => {
                inputEl.removeClass('ert-setting-input-success');
                inputEl.removeClass('ert-setting-input-error');
            };

            const handleBlur = async (overrideValue?: string) => {
                resetState();
                const raw = (overrideValue ?? text.getValue()).trim();
                const normalizedValue = raw ? normalizePath(raw) : '';

                exportHint.empty();
                if (raw) {
                    const isValid = await plugin.validateAndRememberPath(normalizedValue);
                    const sceneCount = isValid ? countSceneNotes(app, normalizedValue) : 0;
                    if (isValid) {
                        const firstFolder = !book.sourceFolder.trim();
                        book.sourceFolder = normalizedValue;
                        await plugin.persistBookSettings();
                        // A new book shows on the timeline once its folder holds scenes.
                        if (firstFolder && sceneCount > 0) await plugin.setActiveBookId(book.id);
                        updateAddBtnPulse();
                        // A loose .txt or .docx may be research or an export: the folder is
                        // kept, and the hint offers the import for the author to decide.
                        if (sceneCount === 0 && holdsManuscriptExport(app, normalizedValue)) showExportHint(normalizedValue);
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

            const trashButton = new ExtraButtonComponent(folderRow);
            trashButton.setIcon('trash-2');
            withTooltip(trashButton, t('ui.generalSection.removeProfileTooltip'));
            trashButton.extraSettingsEl.addClass('ert-book-card__trash');
            trashButton.onClick(async () => {
                plugin.settings.books = books.filter(b => b.id !== book.id);
                if (book.id === plugin.settings.activeBookId) {
                    plugin.settings.activeBookId = plugin.settings.books[0]?.id;
                }
                await plugin.persistBookSettings();
                renderBooksManager();
            });
        });

        // Update pulse state after render
        updateAddBtnPulse();
    };

    renderBooksManager();
}
