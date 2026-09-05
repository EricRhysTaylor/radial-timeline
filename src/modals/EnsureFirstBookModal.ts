/*
 * EnsureFirstBookModal
 * First-run prompt for users with no configured book. Asks for a name,
 * registers a BookProfile, sets it active, and creates the matching folder.
 */
import { App, ButtonComponent, Notice, TFolder, normalizePath } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types/settings';
import { DEFAULT_BOOK_TITLE, createBookId, getActiveBook, normalizeBookProfile } from '../utils/books';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { ErtModal } from '../ui/ErtModal';

class FirstBookSetupModal extends ErtModal {
    private resolvePromise: (book: BookProfile | null) => void = () => undefined;
    private settled = false;
    private result: BookProfile | null = null;
    private readonly initialName: string;

    constructor(app: App, private readonly plugin: RadialTimelinePlugin, initialName: string) {
        super(app);
        this.initialName = initialName;
    }

    promise(): Promise<BookProfile | null> {
        return new Promise(resolve => { this.resolvePromise = resolve; });
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.applyShell({ width: '460px' });
        if (this.modalEl) {
            this.modalEl.setCssStyles({ maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Setup' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Create your first book' });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Choose a name. A folder of the same name will be created in your vault to hold this book’s scenes. You can rename either later in Settings.'
        });

        const inputContainer = contentEl.createDiv({ cls: 'ert-search-input-container' });
        const inputEl = inputContainer.createEl('input', {
            type: 'text',
            value: this.initialName,
            cls: 'ert-input ert-input--full'
        });
        inputEl.setAttr('placeholder', DEFAULT_BOOK_TITLE);

        const preview = contentEl.createDiv({ cls: 'setting-item-description' });
        const updatePreview = () => {
            const name = inputEl.value.trim();
            preview.setText(name ? `Folder: ${name}` : 'Enter a name to continue.');
        };
        updatePreview();
        inputEl.addEventListener('input', updatePreview); // SAFE: direct addEventListener; Modal lifecycle manages cleanup

        scheduleFocusAfterPaint(inputEl, { selectText: true });

        const submit = async () => {
            const name = inputEl.value.trim();
            if (!name) {
                new Notice('Please enter a book name.');
                return;
            }
            const book = await this.applyAndCreate(name);
            if (!book) return;
            this.result = book;
            this.close();
        };

        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(buttonRow).setButtonText('Create book').setCta().onClick(() => { void submit(); });
        new ButtonComponent(buttonRow).setButtonText('Cancel').onClick(() => this.close());

        inputEl.addEventListener('keydown', (evt: KeyboardEvent) => { // SAFE: direct addEventListener; Modal lifecycle manages cleanup
            if (evt.key === 'Enter') { evt.preventDefault(); void submit(); }
        });
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.settled) {
            this.settled = true;
            this.resolvePromise(this.result);
        }
    }

    private async applyAndCreate(name: string): Promise<BookProfile | null> {
        try {
            const folderPath = normalizePath(name);
            const fileOrFolder = this.app.vault.getAbstractFileByPath(folderPath);
            if (fileOrFolder && !(fileOrFolder instanceof TFolder)) {
                new Notice(`A file already exists at "${folderPath}". Please choose a different name.`);
                return null;
            }

            const existing = getActiveBook(this.plugin.settings);
            const reuseExisting = !!(existing && !(existing.sourceFolder || '').trim());
            const id = reuseExisting && existing ? existing.id : createBookId();
            const next = normalizeBookProfile({ id, title: name, sourceFolder: folderPath });

            const books = this.plugin.settings.books || [];
            this.plugin.settings.books = reuseExisting && existing
                ? books.map(b => b.id === existing.id ? next : b)
                : [...books, next];
            this.plugin.settings.activeBookId = next.id;
            await this.plugin.persistBookSettings();

            if (!fileOrFolder) {
                await this.app.vault.createFolder(folderPath);
            }
            return next;
        } catch (error) {
            const msg = (error as { message?: string } | undefined)?.message || String(error);
            new Notice(`Failed to create book: ${msg}`);
            return null;
        }
    }
}

/**
 * Returns the active book if one is configured with a folder, otherwise prompts
 * the user to create their first book. Resolves to null if the user cancels.
 */
export async function ensureActiveBookFolder(plugin: RadialTimelinePlugin): Promise<BookProfile | null> {
    const existing = getActiveBook(plugin.settings);
    const sourceFolder = (existing?.sourceFolder || '').trim();
    if (existing && sourceFolder) {
        const normalized = normalizePath(sourceFolder);
        const node = plugin.app.vault.getAbstractFileByPath(normalized);
        if (!node) {
            try { await plugin.app.vault.createFolder(normalized); } catch { /* folder creation is best-effort */ }
        }
        return existing;
    }

    const initialName = (existing?.title || '').trim();
    const seed = initialName && initialName !== DEFAULT_BOOK_TITLE ? initialName : '';
    const modal = new FirstBookSetupModal(plugin.app, plugin, seed);
    const promise = modal.promise();
    modal.open();
    return promise;
}
