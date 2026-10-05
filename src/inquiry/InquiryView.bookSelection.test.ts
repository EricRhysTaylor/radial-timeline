import { describe, expect, it, vi } from 'vitest';
import { TFile, type MetadataCache, type Vault } from 'obsidian';
import { InquiryView } from './InquiryView';
import { InquiryCorpusSnapshotController } from './corpus/InquiryCorpusSnapshotController';
import type { InquiryCorpusSnapshot } from './services/InquiryCorpusResolver';
import { InquirySelectionState } from './session/inquirySelectionState';
import { InquiryActiveSessionState } from './session/inquiryActiveSessionState';
import { createDefaultInquiryState, type InquiryResult } from './state';

const folders = ['01 Scarlet', '02 Sign', '03 Hound', '04 Valley'];

function makeView(activeIndex = 0) {
    const state = createDefaultInquiryState();
    const settings = {
        activeBookId: `profile-${activeIndex}`,
        books: folders.map((sourceFolder, index) => ({
            id: `profile-${index}`, title: sourceFolder.slice(3), sourceFolder
        }))
    };
    const files = folders.map(folder => new TFile(`${folder}/1 Opening.md`));
    const vault = { getMarkdownFiles: () => files } as unknown as Vault; // SAFE: resolver only enumerates these deterministic files.
    const metadataCache = {
        getFileCache: (file: TFile) => ({ frontmatter: { Class: 'Scene', ID: file.path, Summary: 'Chapter summary' } })
    } as unknown as MetadataCache; // SAFE: resolver only reads these frontmatter records.
    const view = Object.assign(Object.create(InquiryView.prototype), {
        state,
        plugin: { settings },
        perfCounters: { refreshUICalls: 0, refreshCorpusCalls: 0, corpusRefreshMs: 0 },
        startupFreshMode: false,
        freshModeTouchedBookIds: new Set<string>(),
        briefingPurgeScanner: { invalidate: vi.fn() },
        settingsAccessor: { getSources: () => ({
            classScope: ['scene'], scanRoots: [], classes: [{
                className: 'scene', enabled: true, bookScope: 'full', sagaScope: 'full', referenceScope: 'excluded'
            }]
        }) },
        refreshPayloadStats: vi.fn(),
        refreshDerivedViewState: vi.fn(),
        refreshVisualChrome: vi.fn(),
        clearRehydrateState: vi.fn(),
        clearResultPreview: vi.fn(),
        unlockPromptPreview: vi.fn(),
        setApiStatus: vi.fn(),
        scheduleTargetPersist: vi.fn(),
        sessionStore: { getSessionCount: () => 1, getRecentSessions: () => [{
            key: 'scarlet-saved', scope: 'book', activeBookId: folders[0], result: { questionId: 'setup-core' }
        }] },
        isErrorResult: () => false,
    }) as { // SAFE: real view refresh/reconciliation methods with DOM and persistence seams replaced.
        state: typeof state;
        corpus?: InquiryCorpusSnapshot;
        selection: InquirySelectionState;
        activeSession: InquiryActiveSessionState;
        corpusSnapshot: InquiryCorpusSnapshotController;
        onBookSettingsChanged(): void;
        onPromptSettingsChanged(): void;
        refreshUI(options?: { skipCorpus?: boolean }): void;
        setFocusByIndex(index: number): void;
        findSavedSessionForQuestion(question: { id: string }): { key: string } | undefined;
        getDisplayText(): string;
        updateViewTitle(): void;
    };
    view.selection = new InquirySelectionState(view, {
        getPersistedLastMode: () => 'depth', setPersistedLastMode: vi.fn(),
        setTargetCache: vi.fn(), saveSettings: async () => {}
    });
    view.activeSession = new InquiryActiveSessionState(view);
    view.corpusSnapshot = new InquiryCorpusSnapshotController(view, vault, metadataCache, () => undefined);
    return { view, settings };
}

describe('Inquiry follows the timeline book selection', () => {
    it('refreshes the external tab title and tooltip when a hidden Inquiry view follows a book change', () => {
        const { view, settings } = makeView();
        const header = { textContent: '' };
        const tab = { textContent: 'Inquiry: Scarlet', tooltip: 'Inquiry: Scarlet' };
        // Obsidian keeps the tab bar outside the leaf's content subtree.
        const updateHeader = vi.fn(() => {
            tab.textContent = view.getDisplayText();
            tab.tooltip = view.getDisplayText();
        });
        Object.assign(view, {
            containerEl: {
                querySelector: () => header,
                closest: () => ({ querySelector: () => null })
            },
            leaf: { updateHeader },
            refreshVisualChrome: () => view.updateViewTitle()
        });
        view.refreshUI();
        expect(tab.textContent).toBe('Inquiry: Scarlet');
        settings.activeBookId = 'profile-1';
        view.onBookSettingsChanged();
        expect(header.textContent).toBe('Inquiry: Sign');
        expect(tab.textContent).toBe(header.textContent);
        expect(tab.tooltip).toBe(header.textContent);
        expect(updateHeader).toHaveBeenCalledTimes(2);
    });

    it('opens on the selected Book Manager profile, translating its ID into the manuscript folder', () => {
        const { view } = makeView(2);
        view.refreshUI();
        expect(view.state.activeBookId).toBe(folders[2]);
        expect(view.corpus?.scenes.map(scene => scene.filePath)).toEqual([`${folders[2]}/1 Opening.md`]);
    });

    it('switches the corpus and targets without offering a saved answer from the previous book', () => {
        const { view, settings } = makeView();
        view.refreshUI();
        view.selection.setTargetSceneIds([`${folders[0]}/1 Opening.md`]);
        view.selection.rememberTargetSceneIdsForBook(folders[0], view.state.targetSceneIds);
        view.state.activeResult = { questionId: 'setup-core' } as InquiryResult; // SAFE: result is only cleared, not rendered.
        expect(view.findSavedSessionForQuestion({ id: 'setup-core' })?.key).toBe('scarlet-saved');
        settings.activeBookId = 'profile-1';
        view.onBookSettingsChanged();
        expect(view.state.activeBookId).toBe(folders[1]);
        expect(view.corpus?.scenes.map(scene => scene.filePath)).toEqual([`${folders[1]}/1 Opening.md`]);
        expect(view.state.targetSceneIds).toEqual([]);
        expect(view.state.activeResult).toBeNull();
        expect(view.findSavedSessionForQuestion({ id: 'setup-core' })).toBeUndefined();
        settings.activeBookId = 'profile-0';
        view.onBookSettingsChanged();
        expect(view.state.targetSceneIds).toEqual([`${folders[0]}/1 Opening.md`]);
        expect(view.findSavedSessionForQuestion({ id: 'setup-core' })?.key).toBe('scarlet-saved');
    });

    it('holds the running corpus stable and applies the latest timeline selection on completion', () => {
        const { view, settings } = makeView();
        view.refreshUI();
        const runningCorpus = view.corpus;
        view.state.isRunning = true;
        settings.activeBookId = 'profile-1';
        view.onBookSettingsChanged();
        settings.activeBookId = 'profile-3';
        view.onBookSettingsChanged();
        expect(view.state.activeBookId).toBe(folders[0]);
        expect(view.corpus).toBe(runningCorpus);
        view.state.isRunning = false;
        view.refreshUI({ skipCorpus: true });
        expect(view.state.activeBookId).toBe(folders[3]);
        expect(view.corpus?.activeBookId).toBe(folders[3]);
    });

    it('preserves Inquiry navigation and saved results during unrelated settings refreshes', () => {
        const { view } = makeView();
        view.refreshUI();
        view.setFocusByIndex(2);
        const result = { questionId: 'setup-core' } as InquiryResult; // SAFE: sentinel result is not rendered by the fixture.
        view.state.activeResult = result;
        view.onPromptSettingsChanged();
        view.onBookSettingsChanged();
        expect(view.state.activeBookId).toBe(folders[1]);
        expect(view.state.activeResult).toBe(result);
    });

    it('keeps an explicit Saga scope when the timeline selects a novel', () => {
        const { view, settings } = makeView();
        view.state.scope = 'saga';
        view.refreshUI();
        settings.activeBookId = 'profile-2';
        view.onBookSettingsChanged();
        expect(view.state.scope).toBe('saga');
        expect(view.corpus?.books).toHaveLength(4);
    });

    it('uses the selected timeline book again after Inquiry clears its selection', () => {
        const { view } = makeView(3);
        view.refreshUI();
        view.selection.setActiveBookId(undefined);
        view.refreshUI();
        expect(view.state.activeBookId).toBe(folders[3]);
        expect(view.corpus?.activeBookId).toBe(folders[3]);
    });
});
