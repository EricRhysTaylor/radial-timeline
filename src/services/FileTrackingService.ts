import type RadialTimelinePlugin from '../main';
import { TFile, TAbstractFile, MarkdownView } from 'obsidian';
import { bindToAllDocuments, getOpenDocuments } from '../utils/documents';

export class FileTrackingService {
    private modalStateObservers = new Map<Document, MutationObserver>();
    private modalStateSyncRaf?: number;

    constructor(private plugin: RadialTimelinePlugin) {}

    updateOpenFilesTracking(): boolean {
        const previousOpenFiles = new Set(this.plugin.openScenePaths);
        const openFilePaths = new Set<string>();

        const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
        leaves.forEach(leaf => {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file) {
                openFilePaths.add(view.file.path);
            } else {
                // Deferred/unactivated tab — read path from view state
                try {
                    const state = leaf.getViewState();
                    const filePath = (state?.state as Record<string, unknown>)?.file;
                    if (typeof filePath === 'string' && filePath.length > 0) {
                        openFilePaths.add(filePath);
                    }
                } catch { /* ignore */ }
            }
        });

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && !openFilePaths.has(activeFile.path)) {
            openFilePaths.add(activeFile.path);
        }

        let hasChanged = previousOpenFiles.size !== openFilePaths.size;
        if (!hasChanged) {
            for (const path of openFilePaths) {
                if (!previousOpenFiles.has(path)) {
                    hasChanged = true;
                    break;
                }
            }
        }

        if (!hasChanged) return false;

        this.plugin.openScenePaths = openFilePaths;
        this.plugin.getTimelineViews().forEach(v => v.refreshTimeline());
        return true;
    }

    registerWorkspaceListeners(): void {
        this.plugin.app.workspace.onLayoutReady(() => {
            this.installModalStateObservers();
            this.plugin.setCSSColorVariables();
            this.updateOpenFilesTracking();
        });

        this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
            // Avoid refreshing while a modal or the plugin settings tab is open (prevents flicker).
            if (this.isAnyModalOrSettingsOpen()) {
                window.setTimeout(() => {
                    if (!this.isAnyModalOrSettingsOpen()) {
                        const refreshedForOpenFiles = this.updateOpenFilesTracking();
                        if (!refreshedForOpenFiles) {
                            this.plugin.refreshTimelineIfNeeded(null);
                        }
                    }
                }, 200);
                return;
            }

            const refreshedForOpenFiles = this.updateOpenFilesTracking();
            if (!refreshedForOpenFiles) {
                this.plugin.refreshTimelineIfNeeded(null);
            }
        }));

        this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => this.plugin.refreshTimelineIfNeeded(file)));
        this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => this.handleFileRename(file, oldPath)));

        this.plugin.registerEvent(this.plugin.app.workspace.on('css-change', () => {
            this.plugin.setCSSColorVariables();
            try {
                const views = this.plugin.getTimelineViews();
                views.forEach(v => {
                    const svg = v.containerEl.querySelector('.radial-timeline-svg');
                    if (svg) {
                        // Pass null for currentSceneId if not available/relevant here, or fix signature
                        this.plugin.getRendererService().updateProgressAndTicks(v, null);
                        if (v.currentMode === 'gossamer') {
                            this.plugin.getRendererService().updateGossamerLayer(v);
                        }
                    }
                });
            } catch {
                this.plugin.refreshTimelineIfNeeded(null);
            }
        }));
    }

    private installModalStateObservers(): void {
        // Modals open in whichever window is active — observe every open
        // document (including popouts opened later) so the rt-modal-open
        // body class tracks the document the modal actually lives in.
        bindToAllDocuments(this.plugin, (doc) => this.observeModalState(doc));

        this.plugin.registerEvent(this.plugin.app.workspace.on('window-close', (win) => {
            this.modalStateObservers.get(win.doc)?.disconnect();
            this.modalStateObservers.delete(win.doc);
        }));

        this.plugin.register(() => {
            this.modalStateObservers.forEach((observer, doc) => {
                observer.disconnect();
                doc.body.classList.remove('rt-modal-open');
            });
            this.modalStateObservers.clear();
            if (this.modalStateSyncRaf) {
                window.cancelAnimationFrame(this.modalStateSyncRaf);
                this.modalStateSyncRaf = undefined;
            }
        });
    }

    private observeModalState(doc: Document): void {
        if (this.modalStateObservers.has(doc) || !doc.body) return;

        this.syncModalOpenBodyClass(doc);
        const observer = new MutationObserver(() => this.scheduleModalStateSync());
        observer.observe(doc.body, { childList: true, subtree: true });
        this.modalStateObservers.set(doc, observer);
    }

    private scheduleModalStateSync(): void {
        if (this.modalStateSyncRaf) return;
        this.modalStateSyncRaf = window.requestAnimationFrame(() => {
            this.modalStateSyncRaf = undefined;
            this.modalStateObservers.forEach((_observer, doc) => this.syncModalOpenBodyClass(doc));
        });
    }

    private syncModalOpenBodyClass(doc: Document): void {
        doc.body.classList.toggle('rt-modal-open', this.isModalOpen(doc));
    }

    private isAnyModalOrSettingsOpen(): boolean {
        return getOpenDocuments(this.plugin.app.workspace)
            .some((doc) => this.isModalOpen(doc) || this.isSettingsTabOpen(doc));
    }

    private handleFileRename(file: TAbstractFile, oldPath: string): void {
        if (this.plugin.openScenePaths.has(oldPath)) {
            this.plugin.openScenePaths.delete(oldPath);
            if (file instanceof TFile && this.plugin.isSceneFile(file.path)) {
                this.plugin.openScenePaths.add(file.path);
            }
        }
        this.plugin.refreshTimelineIfNeeded(file);
    }

    /**
     * Heuristic: detect if any Obsidian modal is currently mounted.
     * This prevents timeline refreshes while a modal is visible, which causes UI flicker.
     * Checks multiple selectors to catch settings modal, plugins modal, and standard modals.
     */
    private isModalOpen(doc: Document): boolean {
        try {
            // Check for standard modal container with content
            const modalContainer = doc.body.querySelector('.modal-container');
            if (modalContainer && modalContainer.childElementCount > 0) return true;

            // Check for modal background overlay (present when any modal is open)
            const modalBg = doc.body.querySelector('.modal-bg');
            if (modalBg) return true;

            // Check for the modal element itself
            const modal = doc.body.querySelector('.modal');
            if (modal) return true;
            
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Detect if the Radial Timeline settings tab is currently open.
     * Skips layout-change-driven refresh while the user is in settings to avoid panel flicker.
     */
    private isSettingsTabOpen(doc: Document): boolean {
        try {
            return doc.body.querySelector('.ert-settings-root') != null;
        } catch {
            return false;
        }
    }
}
