/*
 * Manuscript Options Modal
 */
import { openSettingsTab } from '../utils/obsidianInternals';
import { App, ButtonComponent, DropdownComponent, FileSystemAdapter, FuzzySuggestModal, Modal, Notice, Platform, setIcon, TAbstractFile, TFile, TFolder, ToggleComponent, getFrontMatterInfo, normalizePath } from 'obsidian';
import * as path from 'path'; // SAFE: Node path needed to build absolute paths for native Finder reveal
import type RadialTimelinePlugin from '../main';
import { getSceneFilesByOrder, extractCountableBodyText, ManuscriptOrder, TocMode, type ManuscriptSceneHeadingMode } from '../utils/manuscript';
import { t, tCount } from '../i18n';
import { getManuscriptSourceFiles, getReviewedManuscriptSelection, type ManuscriptSource } from '../utils/exportContext';
import { countWords } from '../utils/text';
import { getManuscriptProofConfigurationKey, getManuscriptProofStaleReason, type ManuscriptProofReceipt } from '../publishing/manuscriptProof';
import { ManuscriptProofPreview } from '../publishing/ManuscriptProofPreview';
import { readSavedManuscripts, restoreSavedManuscript, saveManuscriptRecord } from '../publishing/savedManuscripts';
import { randomUUID } from 'crypto'; // SAFE: local saved manuscript identities, never credentials.
import { deliveryFormat, readDeliveryReceipt, validateExportDestination, type ExportDeliveryReceipt } from '../publishing/exportDelivery';
import { ExportDeliveryReviewModal } from './ExportDeliveryReviewModal';
import { RecentExportsModal } from './RecentExportsModal';
import { openExportedFile } from '../publishing/openExportedFile';
import { ModalFolderSuggest } from '../settings/FolderSuggest';
import { resolveExportOutputFolder } from '../utils/aiOutput';
import { clearFontAvailabilityCache, ExportFormat, ExportType, ManuscriptPreset, OutlinePreset, getAutoPdfEngineSelection, resolveTemplatePath, validatePandocLayout, getTemplateFontDiagnostics, getStructuredFontDiagnostic } from '../utils/exportFormats';
import { ensureBundledLayoutInstalledForExport } from '../utils/pandocBundledLayouts';
import { getActiveBook, DEFAULT_BOOK_TITLE } from '../utils/books';
import { chunkScenesIntoParts } from '../utils/splitOutput';
import { cleanupFormatForOutputFormat, countManuscriptComments, getDefaultManuscriptCleanupOptions, normalizeManuscriptCleanupOptions, type ManuscriptCommentCounts } from '../utils/manuscriptSanitize';
import { EXPORT_PURPOSES, buildPurposeProfile, builtInPresetId, getExportPurposeForPresetId, type ExportPurpose } from '../utils/exportPurposes';
import { readSceneId } from '../utils/sceneIds';
import { categorizeExportError, ExportFailure } from '../utils/exportErrors';
import {
    adaptPandocLayoutsToPublishingModel,
    buildPersistedExportProfileFromModalExportProfile,
    buildModalExportProfile,
    buildTransientModalExportProfile,
    clampSplitParts,
    exportProfilesMatch,
    resolveIncludeSceneId,
    type ModalExportProfile,
} from '../utils/exportProfileModel';
import { getPandocLayoutSortRank, getPandocLayoutTier } from '../publishing/templateTiering';
import { EDITORIALIST_LOGO_PATHS, EDITORIALIST_LOGO_VIEWBOX } from '../branding/editorialistLogo';
import {
    applySpreadValidation,
    collectSpreadStatuses,
    getFictionVariantForLayout,
    getLayoutPictogramRows,
    renderLayoutPictograms,
    type FictionLayoutVariant,
    type SpreadStatus,
    type SpreadValidationContext,
} from '../publishing/layoutVisuals';
import { buildSpreadValidationContext, collectSpreadWarningTooltips } from '../publishing/spreadValidationContext';
import { ERT_CLASSES } from '../ui/classes';
import { getExportValidationIssues } from '../services/PublishingValidationService';
import type {
    BookProfile,
    BookPublishingPreferences,
    ExportProfile,
    ManuscriptExportCleanupOptions,
    PandocLayoutTemplate,
    PublishingValidationSnapshot,
    TemplateProfile,
    SavedManuscriptSource,
} from '../types';

const OPEN_SCENES_FILTER = '__open_scenes__';

type ReadbackPart = { text: string; warn: boolean };
type SceneMarkers = ManuscriptCommentCounts & { hasSceneId: boolean };

// Layout variant detection, pictogram data, and DOM rendering live in
// src/publishing/layoutVisuals so the settings panel and this modal stay
// in sync. The thin renderModalLayoutPreview wrapper below adds the
// modal-only `ert-layout-visual--cards-only` modifier.
function renderModalLayoutPreview(
    parent: HTMLElement,
    variant: FictionLayoutVariant,
    activeSceneMode?: ManuscriptSceneHeadingMode,
    ctx?: SpreadValidationContext,
    layout?: PandocLayoutTemplate,
    onSceneModeSelect?: (mode: ManuscriptSceneHeadingMode) => void,
): void {
    const visual = parent.createDiv({ cls: 'ert-layout-visual ert-layout-visual--cards-only' });
    const baseRows = getLayoutPictogramRows(variant, layout);
    const rows = ctx ? applySpreadValidation(baseRows, ctx) : baseRows;
    renderLayoutPictograms(visual, rows, activeSceneMode, { onSceneModeSelect });
}

export interface ManuscriptModalResult {
    outputFolder?: string;
    reviewedSourcePaths?: string[];
    intent?: 'proof';
    source?: ManuscriptSource;
    order: ManuscriptOrder;
    tocMode: TocMode;
    includeSceneIdInToc?: boolean;
    includeSceneIdInHeading?: boolean;
    rangeStart?: number;
    rangeEnd?: number;
    subplot?: string;
    scenePathFilter?: string[];
    exportType: ExportType;
    manuscriptPreset?: ManuscriptPreset;
    outlinePreset?: OutlinePreset;
    outputFormat: ExportFormat;
    updateWordCounts?: boolean;
    includeSynopsis?: boolean;
    includeMatter?: boolean;
    saveMarkdownArtifact?: boolean;
    lineBreaksAsParagraphs?: boolean;
    exportCleanup?: ManuscriptExportCleanupOptions;
    exportProfileId?: string;
    exportProfileTemplateId?: string;
    selectedLayoutId?: string;
    splitMode?: 'single' | 'parts';
    splitParts?: number;
}

export interface ManuscriptExportOutcome {
    delivery?: ExportDeliveryReceipt;
    proof?: ManuscriptProofReceipt;
    savedPath?: string;
    renderedPath?: string;
    savedPaths?: string[];
    renderedPaths?: string[];
    outputFolder?: string;
    messages?: string[];
}

type DragHandle = 'start' | 'end' | null;

class SaveExportTemplateModal extends Modal {
    private readonly onSave: (name: string) => void;
    private readonly defaultName: string;

    constructor(app: App, onSave: (name: string) => void, defaultName: string) {
        super(app);
        this.onSave = onSave;
        this.defaultName = defaultName;
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-template-dialog');

        const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
        hero.createDiv({ cls: 'ert-modal-title', text: t('ui.manuscriptOptionsModal.savePresetTitle') });
        hero.createDiv({ cls: 'ert-modal-subtitle', text: t('ui.manuscriptOptionsModal.savePresetSubtitle') });

        const body = contentEl.createDiv({ cls: 'ert-template-dialog-panel' });
        let currentName = this.defaultName;
        const input = body.createEl('input', {
            cls: 'ert-input ert-input--full',
            attr: { type: 'text', placeholder: t('ui.manuscriptOptionsModal.presetNamePlaceholder'), value: this.defaultName }
        });
        input.addEventListener('input', () => {
            currentName = input.value;
        });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText(t('ui.manuscriptOptionsModal.createPreset'))
            .setCta()
            .onClick(() => {
                const trimmed = currentName.trim();
                if (!trimmed) {
                    new Notice(t('ui.manuscriptOptionsModal.presetNameRequired'));
                    return;
                }
                this.onSave(trimmed);
                this.close();
            });
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
    }
}

class DeletePublishingItemModal extends Modal {
    private readonly templateName: string;
    private readonly onConfirm: () => void;

    constructor(app: App, templateName: string, onConfirm: () => void, private readonly itemLabel: 'export preset' | 'saved manuscript' = 'export preset') {
        super(app);
        this.templateName = templateName;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--sm');
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-template-dialog');

        const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
        const isSavedManuscript = this.itemLabel === 'saved manuscript';
        hero.createDiv({ cls: 'ert-modal-title', text: isSavedManuscript ? t('ui.manuscriptOptionsModal.deleteSavedManuscriptTitle') : t('ui.manuscriptOptionsModal.deleteExportPresetTitle') });
        hero.createDiv({ cls: 'ert-modal-subtitle', text: isSavedManuscript
            ? t('ui.manuscriptOptionsModal.deleteSavedManuscriptSubtitle', { name: this.templateName })
            : t('ui.manuscriptOptionsModal.deleteExportPresetSubtitle', { name: this.templateName }) });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText(t('ui.manuscriptOptionsModal.delete'))
            .setDestructive()
            .onClick(() => {
                this.onConfirm();
                this.close();
            });
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
    }
}

class ManuscriptSourcePicker extends FuzzySuggestModal<TAbstractFile> {
    constructor(app: App, private readonly kind: 'folder' | 'file', private readonly onChoose: (path: string) => void) {
        super(app);
        this.setPlaceholder(kind === 'folder' ? t('ui.manuscriptOptionsModal.chooseFolderPlaceholder') : t('ui.manuscriptOptionsModal.chooseFilePlaceholder'));
    }
    getItems(): TAbstractFile[] {
        return this.app.vault.getAllLoadedFiles().filter(entry => this.kind === 'folder'
            ? entry instanceof TFolder && entry.path.length > 0
            : entry instanceof TFile && entry.extension === 'md');
    }
    getItemText(entry: TAbstractFile): string { return entry.path; }
    onChooseItem(entry: TAbstractFile): void { this.onChoose(entry.path); }
}

export class ManuscriptOptionsModal extends Modal {
    private readonly plugin: RadialTimelinePlugin;
    private source?: ManuscriptSource;
    private sourceCard?: HTMLElement;
    private destination = '';
    private destinationError: string | null = null;
    private destinationInput?: HTMLInputElement;
    private destinationSummaryEl?: HTMLElement;
    private destinationErrorEl?: HTMLElement;
    private recentExportsButton?: ButtonComponent;
    private destinationSuggest?: ModalFolderSuggest;
    private savedManuscripts: SavedManuscriptSource[] = [];
    private savedSourceId?: string;
    private savedSourceName = '';
    private savedSourceNotice = '';
    private savedSourceNoticeEl?: HTMLElement;
    private savedSourceStorageError: string | null = null;
    private sourceSaving = false;
    private sourceReviewButton?: ButtonComponent;
    private sourceSaveButton?: ButtonComponent;
    private sourceSaveAsButton?: ButtonComponent;
    private controlsEl?: HTMLElement;
    private outputGridEl?: HTMLElement;
    private exportTypeColEl?: HTMLElement;
    private proofPane?: HTMLElement;
    private proofStatusEl?: HTMLElement;
    private proofFrame?: HTMLElement;
    private proofButton?: ButtonComponent;
    private proofOpenButton?: ButtonComponent;
    private proofFileDropdown?: DropdownComponent;
    private proofFileRow?: HTMLElement;
    private proofPrevious?: ButtonComponent;
    private proofNext?: ButtonComponent;
    private proofPageInput?: HTMLInputElement;
    private proofPageCountEl?: HTMLElement;
    private proofReceipt?: ManuscriptProofReceipt;
    private proofStaleReason: string | null = null;
    private proofLoading = false;
    private proofPage = 1;
    private proofPages = 0;
    private proofFileIndex = 0;
    private proofEpoch = 0;
    private proofClosed = false;
    private readonly proofViewer = new ManuscriptProofPreview();
    private detachProofEvents?: () => void;
    private sourceReviewed = true;
    private sourceCandidates: string[] = [];
    private sourceLoadId = 0;
    private sourceLoading = false;
    private sourceError: string | null = null;
    private sourceErrorEl?: HTMLElement;
    private readonly onSubmit: (result: ManuscriptModalResult) => Promise<ManuscriptExportOutcome>;

    private order: ManuscriptOrder = 'narrative';
    private tocMode: TocMode = 'markdown';
    private includeSceneId: boolean = true;
    private subplot: string = 'All Subplots';
    private exportType: ExportType = 'manuscript';
    private manuscriptPreset: ManuscriptPreset = 'novel';
    private outlinePreset: OutlinePreset = 'beat-sheet';
    private outputFormat: ExportFormat = 'markdown';
    private updateWordCounts: boolean = true;
    private includeSynopsis: boolean = true;
    private includeMatter: boolean = true;
    private saveMarkdownArtifact: boolean = true;
    private lineBreaksAsParagraphs: boolean = false;
    private markdownCleanupOptions: ManuscriptExportCleanupOptions = getDefaultManuscriptCleanupOptions('markdown');
    private pdfCleanupOptions: ManuscriptExportCleanupOptions = getDefaultManuscriptCleanupOptions('pdf');
    private hasWhenDates: boolean = false;
    private includeMatterUserChoice: boolean = true;
    private includeSynopsisUserChoice: boolean = true;
    private hasTouchedMatterToggle: boolean = false;
    private splitMode: 'single' | 'parts' = 'single';
    private splitParts: number = 3;

    private sceneTitles: string[] = [];
    private scenePaths: string[] = [];
    private sceneWhenDates: (string | null)[] = [];
    private sceneNumbers: number[] = [];
    private sceneWordCounts: (number | null)[] = [];
    private sceneActs: (number | null)[] = [];
    private chapterMarkersByScenePath: Record<string, unknown[]> = {};
    private totalScenes = 0;
    private rangeStart = 1;
    private rangeEnd = 1;
    private openScenePathsSnapshot: Set<string> = new Set();

    private trackEl?: HTMLElement;
    private startHandleEl?: HTMLElement;
    private endHandleEl?: HTMLElement;
    private rangeFillEl?: HTMLElement;
    private badgeEl?: HTMLElement;
    private rangeStatusEl?: HTMLElement;
    private rangeDecimalWarningEl?: HTMLElement;
    private rangeCardContainer?: HTMLElement;
    private loadingEl?: HTMLElement;
    private actionButton?: ButtonComponent;
    private openFolderButton?: ButtonComponent;
    private openFileButton?: ButtonComponent;
    private markdownArtifactToggle?: ToggleComponent;
    private subplotDropdown?: DropdownComponent;
    private chronoHelperEl?: HTMLElement;
    private outputStatusEl?: HTMLElement;
    private orderPills: { el: HTMLElement, order: ManuscriptOrder }[] = [];
    private exportTypePills: { el: HTMLElement, type: ExportType }[] = [];
    private outputFormatPills: { el: HTMLElement, format: ExportFormat }[] = [];
    private tocActionsEl?: HTMLElement;
    private formatPillRowEl?: HTMLElement;
    private formatStaticEl?: HTMLElement;
    private managePdfLayoutsLinkEl?: HTMLElement;
    private documentTypeDescEl?: HTMLElement;
    private manuscriptPresetDropdown?: DropdownComponent;
    private outlinePresetDropdown?: DropdownComponent;
    private tocCard?: HTMLElement;
    private sceneIdToggle?: ToggleComponent;
    private sceneIdCard?: HTMLElement;
    private manuscriptOptionsCard?: HTMLElement;
    private outlineOptionsCard?: HTMLElement;
    private wordCountCard?: HTMLElement;
    private scopeCard?: HTMLElement;
    private orderingCard?: HTMLElement;
    private filterCard?: HTMLElement;
    private splitCard?: HTMLElement;
    private manuscriptRulesCard?: HTMLElement;
    private publishingCard?: HTMLElement;
    private publishingHeadingTextEl?: HTMLElement;
    private pdfSettingsCard?: HTMLElement;
    private artifactRowEl?: HTMLElement;
    private artifactHelperEl?: HTMLElement;
    private gutterRowEl?: HTMLElement;
    private gutterHelperEl?: HTMLElement;
    private includeMatterCard?: HTMLElement;
    private includeMatterToggle?: ToggleComponent;
    private exportCleanupCard?: HTMLElement;
    private synopsisRow?: HTMLElement;
    private synopsisToggle?: ToggleComponent;
    private updateWordCountsToggle?: ToggleComponent;
    private lineBreaksToggle?: ToggleComponent;
    private cleanupCommentsToggle?: ToggleComponent;
    private cleanupAiCommentsToggle?: ToggleComponent;
    private cleanupLinksToggle?: ToggleComponent;
    private cleanupCalloutsToggle?: ToggleComponent;
    private cleanupBlockIdsToggle?: ToggleComponent;
    private templateWarningEl?: HTMLElement;
    private exportReadinessEl?: HTMLElement;
    private exportBlocked = false;
    private exportInFlight = false;
    private layoutHeaderEl?: HTMLElement;
    private layoutContainerEl?: HTMLElement;
    private selectedLayoutId?: string;
    private bundledFontInstallAttempted: Set<string> = new Set();
    private manuscriptPresetDescEl?: HTMLElement;
    private manuscriptPresetGridEl?: HTMLElement;
    private outlinePresetDescEl?: HTMLElement;
    private manuscriptPreviewToggle?: HTMLElement;
    private manuscriptPreviewIcon?: HTMLElement;
    private outlinePreviewToggle?: HTMLElement;
    private outlinePreviewIcon?: HTMLElement;
    private manuscriptPreviewExpanded: boolean = false;
    private outlinePreviewExpanded: boolean = false;
    private splitPartsInputEl?: HTMLInputElement;
    private splitPartsContainerEl?: HTMLElement;
    private splitPreviewEl?: HTMLElement;
    private splitErrorEl?: HTMLElement;
    private splitHelperEl?: HTMLElement;
    private splitSingleInputEl?: HTMLInputElement;
    private splitPartsRadioInputEl?: HTMLInputElement;
    private cancelButton?: ButtonComponent;
    private templateCard?: HTMLElement;
    private exportTemplateDropdown?: HTMLSelectElement;
    private saveTemplateButton?: ButtonComponent;
    private reloadTemplateButton?: ButtonComponent;
    private deleteTemplateButton?: ButtonComponent;
    private templateSummaryEl?: HTMLElement;
    private templateHintEl?: HTMLElement;
    private selectedExportProfileId: string | null = null;
    private lastUsedPresetId: string | null = null;
    private purposeCard?: HTMLElement;
    private purposeNoteEl?: HTMLElement;
    private purposePills: { el: HTMLElement; purpose: ExportPurpose }[] = [];
    private readbackEl?: HTMLElement;
    /** Per-scene comment counts and SceneId presence for the export summary, by path. */
    private sceneMarkers = new Map<string, SceneMarkers>();
    private defaultExportProfileId: string | null = null;
    private exportProfiles: ModalExportProfile[] = [];
    private templateProfiles: TemplateProfile[] = [];
    private selectedExportProfile?: ModalExportProfile;
    private defaultExportProfile?: ModalExportProfile;
    private lastUsedExportProfile?: ModalExportProfile;
    private validationSnapshot: PublishingValidationSnapshot | null = null;

    private activeHandle: DragHandle = null;
    private detachEvents?: () => void;
    private exportCompleted: boolean = false;
    private lastOutcome: ManuscriptExportOutcome | null = null;

    private getUiMode(): {
        isManuscript: boolean;
        isOutline: boolean;
        isPdfManuscript: boolean;
        isDocxManuscript: boolean;
        isMarkdownManuscript: boolean;
        showFormatPills: boolean;
        showFormatStatic: boolean;
        showManuscriptPreset: boolean;
        showOutlinePreset: boolean;
        showToc: boolean;
        showPublishing: boolean;
        showWordCount: boolean;
        showIncludeMatter: boolean;
        showLineBreaksAsParagraphs: boolean;
        showExportCleanup: boolean;
        showSavePrecompile: boolean;
        showSplit: boolean;
        showManagePdfLayouts: boolean;
        chronoMessage: string | null;
    } {
        const isOutline = this.exportType === 'outline';
        const isManuscript = !isOutline;
        const isPdfManuscript = isManuscript && this.outputFormat === 'pdf';
        const isDocxManuscript = isManuscript && this.outputFormat === 'docx';
        const isMarkdownManuscript = isManuscript && this.outputFormat === 'markdown';

        return {
            isManuscript,
            isOutline,
            isPdfManuscript,
            isDocxManuscript,
            isMarkdownManuscript,
            showFormatPills: isManuscript,
            showFormatStatic: isOutline,
            showManuscriptPreset: isManuscript,
            showOutlinePreset: isOutline,
            showToc: isMarkdownManuscript,
            showPublishing: isManuscript,
            showWordCount: isManuscript,
            showIncludeMatter: isPdfManuscript || isDocxManuscript,
            showLineBreaksAsParagraphs: isPdfManuscript || isDocxManuscript,
            showExportCleanup: isManuscript,
            showSavePrecompile: isPdfManuscript,
            showSplit: isManuscript,
            showManagePdfLayouts: isPdfManuscript,
            chronoMessage: !this.hasWhenDates ? t('ui.manuscriptOptionsModal.noWhenDates') : null,
        };
    }

    private sanitizeStateForMode(mode: ReturnType<ManuscriptOptionsModal['getUiMode']>): void {
        if (mode.isOutline) {
            this.outputFormat = 'markdown';
            this.includeMatter = false;
            this.selectedLayoutId = undefined;
            this.splitMode = 'single';
            this.includeSynopsis = this.includeSynopsisUserChoice;
        } else {
            this.includeSynopsis = false;
            const matterCapable = mode.isPdfManuscript || mode.isDocxManuscript;
            if (matterCapable && !this.hasTouchedMatterToggle) {
                this.includeMatterUserChoice = false;
            }
            this.includeMatter = matterCapable ? this.includeMatterUserChoice : false;
            if (!mode.isPdfManuscript) {
                this.selectedLayoutId = undefined;
            }
        }
    }

    constructor(
        app: App,
        plugin: RadialTimelinePlugin,
        onSubmit: (result: ManuscriptModalResult) => Promise<ManuscriptExportOutcome>
    ) {
        super(app);
        this.plugin = plugin;
        this.onSubmit = onSubmit;
        this.destination = plugin.settings.manuscriptOutputFolder || resolveExportOutputFolder(plugin);
        const book = getActiveBook(plugin.settings);
        if (book) this.source = { kind: 'book', bookId: book.id };
        try {
            this.savedManuscripts = readSavedManuscripts(plugin.settings.savedManuscriptSources);
        } catch (error) {
            this.savedSourceStorageError = error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.savedManuscriptsLoadFailed');
        }
    }

    async onOpen(): Promise<void> {
        // Re-ask about font availability on every open: fonts can be installed
        // or deactivated between exports, and a stale "Ready" here means the
        // export fails after the user has already committed to it.
        clearFontAvailabilityCache();
        const { contentEl, modalEl } = this;
        contentEl.empty();
        const lastSource = this.savedManuscripts.find(record => record.id === this.plugin.settings.lastUsedManuscriptSourceId);
        if (lastSource) this.restoreSavedSourceState(lastSource);
        const sourceFolder = this.getSourceBook()?.sourceFolder || "";
        this.openScenePathsSnapshot = new Set(
            [...this.plugin.openScenePaths].filter(p =>
                p.endsWith('.md') && sourceFolder.length > 0 && p.startsWith(sourceFolder + '/')
            )
        );
        this.refreshExportProfileState();

        // Apply generic modal shell + modal-specific class
        if (modalEl) {
            modalEl.setCssStyles({ width: '800px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
        }
        contentEl.classList.add('ert-modal-container', 'ert-stack', 'ert-manuscript-modal');

        const workspace = contentEl.createDiv({ cls: 'ert-manuscript-workspace' });
        this.controlsEl = workspace.createDiv({ cls: 'ert-stack ert-manuscript-controls' });
        this.renderSkeleton(this.controlsEl);
        this.renderProofPane(workspace);
        const onSourceChange = (file: TAbstractFile) => {
            const receipt = this.proofReceipt;
            if (!receipt) return;
            if (receipt.dependencies.some(dependency => dependency.kind === 'vault' && dependency.path === file.path)
                || (receipt.bookSourceFolder && file.path.startsWith(receipt.bookSourceFolder + '/'))) {
                this.proofStaleReason = t('ui.manuscriptOptionsModal.staleContentChanged');
                this.updateProofUi();
                if (file instanceof TFile && this.scenePaths.includes(file.path)) {
                    this.sceneMarkers.delete(file.path);
                    void this.app.vault.cachedRead(file).then(content => {
                        const index = this.scenePaths.indexOf(file.path);
                        if (index < 0 || this.proofClosed) return;
                        this.sceneWordCounts[index] = countWords(extractCountableBodyText(content));
                        this.updateBadgeSceneCount();
                        return this.loadSceneMarkers();
                    }).catch(error => console.error('[RT Proof] Source summary refresh failed:', error));
                }
            }
        };
        const refs = [
            this.app.vault.on('modify', onSourceChange),
            this.app.vault.on('create', file => { if (!this.proofReceipt?.renderedPaths.includes(file.path)) onSourceChange(file); }),
            this.app.vault.on('delete', onSourceChange),
            this.app.vault.on('rename', (file, oldPath) => {
                onSourceChange(file);
                if (this.proofReceipt?.dependencies.some(dependency => dependency.kind === 'vault' && dependency.path === oldPath)) {
                    this.proofStaleReason = t('ui.manuscriptOptionsModal.staleRenamed');
                    this.updateProofUi();
                }
            }),
        ];
        const metadataRef = this.app.metadataCache.on('changed', onSourceChange);
        this.detachProofEvents = () => { refs.forEach(ref => this.app.vault.offref(ref)); this.app.metadataCache.offref(metadataRef); };
        await this.loadSubplots();
        await this.loadScenesForOrder();
        await this.restoreLastUsedTemplate();
    }

    onClose(): void {
        this.destinationSuggest?.close();
        this.sourceLoadId += 1;
        this.proofEpoch += 1;
        this.proofClosed = true;
        this.detachProofEvents?.();
        void this.proofViewer.destroy().catch(error => console.error('[RT Proof] PDF cleanup failed:', error));
        void this.persistCurrentSnapshot();
        this.detachPointerEvents();
        this.contentEl.empty();
    }

    private renderProofPane(parent: HTMLElement): void {
        const pane = parent.createDiv({ cls: 'ert-panel ert-stack ert-manuscript-proof-pane' });
        this.proofPane = pane;
        pane.createEl('h4', { cls: 'ert-section-title', text: t('ui.manuscriptOptionsModal.proofTitle') });
        pane.createDiv({ cls: 'ert-section-desc', text: t('ui.manuscriptOptionsModal.proofDesc') });
        this.proofStatusEl = pane.createDiv({ cls: 'ert-section-desc', attr: { role: 'status', 'aria-live': 'polite' } });
        const actions = pane.createDiv({ cls: 'ert-manuscript-pill-row' });
        this.proofButton = new ButtonComponent(actions).setButtonText(t('ui.manuscriptOptionsModal.generateProof')).onClick(() => { void this.generateProof(); });
        this.proofOpenButton = new ButtonComponent(actions).setButtonText(t('ui.manuscriptOptionsModal.openProof')).onClick(() => {
            const proofPath = this.proofReceipt?.renderedPaths[this.proofFileIndex];
            if (!proofPath) return;
            void this.app.workspace.openLinkText(proofPath, '', 'tab');
            this.close();
        });
        this.proofFileRow = pane.createDiv({ cls: 'ert-row' });
        this.proofFileRow.createSpan({ text: t('ui.manuscriptOptionsModal.proofFile') });
        this.proofFileDropdown = new DropdownComponent(this.proofFileRow).onChange(value => {
            this.proofFileIndex = Number(value);
            void this.loadProofFile();
        });
        const nav = pane.createDiv({ cls: 'ert-manuscript-proof-nav' });
        this.proofPrevious = new ButtonComponent(nav).setButtonText(t('ui.manuscriptOptionsModal.previous')).onClick(() => { void this.renderProofPage(this.proofPage - 1); });
        const label = nav.createEl('label');
        label.createSpan({ text: `${t('ui.manuscriptOptionsModal.proofPageLabel')} ` });
        this.proofPageInput = label.createEl('input', { cls: 'ert-input', attr: { type: 'number', min: '1', step: '1', 'aria-label': t('ui.manuscriptOptionsModal.proofPageAria') } });
        this.proofPageInput.addEventListener('change', () => {
            const number = Number(this.proofPageInput?.value);
            if (!Number.isInteger(number) || number < 1 || number > this.proofPages) {
                new Notice(t('ui.manuscriptOptionsModal.choosePageBetween', { max: this.proofPages }));
                this.updateProofUi();
                return;
            }
            void this.renderProofPage(number);
        });
        this.proofPageCountEl = label.createSpan();
        this.proofNext = new ButtonComponent(nav).setButtonText(t('ui.manuscriptOptionsModal.next')).onClick(() => { void this.renderProofPage(this.proofPage + 1); });
        this.proofFrame = pane.createDiv({ cls: 'ert-previewFrame ert-manuscript-proof-pages' });
        pane.createDiv({ cls: 'ert-section-desc', text: t('ui.manuscriptOptionsModal.proofSavedNote') });
        this.updateProofUi();
    }

    private updateProofUi(): void {
        if (!this.proofPane) return;
        const enabled = this.exportType === 'manuscript' && this.outputFormat === 'pdf';
        this.proofPane.toggleClass('ert-hidden', !enabled);
        this.controlsEl?.parentElement?.toggleClass('is-proof-enabled', enabled);
        this.modalEl.setCssStyles({ width: enabled ? '1440px' : '800px' }); // SAFE: Obsidian modal sizing; shared ERT shell remains unchanged.
        if (this.proofReceipt && this.destinationError) this.proofStaleReason = t('ui.manuscriptOptionsModal.staleDestination');
        if (this.proofReceipt && !this.destinationError && getManuscriptProofConfigurationKey(this.plugin, this.buildSubmissionResult()) !== this.proofReceipt.configurationKey) {
            this.proofStaleReason = t('ui.manuscriptOptionsModal.staleSettingsChanged');
        }
        this.proofPane.toggleClass('is-stale', !!this.proofStaleReason);
        this.proofStatusEl?.setText(this.proofLoading ? t('ui.manuscriptOptionsModal.proofLoading')
            : this.proofStaleReason ? t('ui.manuscriptOptionsModal.proofNeedsRefresh', { reason: this.proofStaleReason })
            : this.proofReceipt && this.proofPages > 0 ? t('ui.manuscriptOptionsModal.proofCurrent', { style: this.proofReceipt.styleName, pages: tCount('page', this.proofPages) })
            : t('ui.manuscriptOptionsModal.proofNone'));
        if (this.proofReceipt?.notices.length) this.proofStatusEl?.appendText(` ${this.proofReceipt.notices.join(' ')}`);
        this.proofButton?.setButtonText(this.proofReceipt ? t('ui.manuscriptOptionsModal.refreshProof') : t('ui.manuscriptOptionsModal.generateProof'));
        this.proofButton?.setDisabled(!enabled || this.exportBlocked || !!this.destinationError || this.proofLoading || this.exportInFlight || this.sourceLoading || this.sourceSaving || !!this.sourceError || !this.sourceReviewed || !this.isSplitSelectionValid() || this.totalScenes === 0);
        this.proofOpenButton?.setDisabled(!this.proofReceipt || this.proofLoading);
        this.proofFileRow?.toggleClass('ert-hidden', !this.proofReceipt || this.proofReceipt.renderedPaths.length <= 1);
        this.proofFileDropdown?.setDisabled(this.proofLoading);
        this.proofPrevious?.setDisabled(this.proofLoading || this.proofPages === 0 || this.proofPage <= 1);
        this.proofNext?.setDisabled(this.proofLoading || this.proofPages === 0 || this.proofPage >= this.proofPages);
        if (this.proofPageInput) {
            this.proofPageInput.disabled = this.proofLoading || this.proofPages === 0;
            this.proofPageInput.value = String(this.proofPage);
            this.proofPageInput.max = String(this.proofPages);
        }
        this.proofPageCountEl?.setText(this.proofPages > 0 ? ` ${t('ui.manuscriptOptionsModal.proofPageOfTotal', { total: this.proofPages })}` : '');
    }

    private async checkProofFreshness(): Promise<void> {
        if (!this.proofReceipt) return;
        this.proofStaleReason = await getManuscriptProofStaleReason(this.plugin, this.proofReceipt, this.buildSubmissionResult());
        this.updateProofUi();
    }

    private async generateProof(): Promise<void> {
        if (this.proofLoading || this.exportInFlight || this.exportBlocked || this.destinationError || this.sourceLoading || this.sourceSaving || this.sourceError || !this.sourceReviewed || !this.isSplitSelectionValid() || this.outputFormat !== 'pdf') return;
        const epoch = ++this.proofEpoch;
        this.proofLoading = true;
        if (this.controlsEl) this.controlsEl.inert = true;
        this.updateProofUi();
        this.updateActionButtonDisabledState();
        try {
            const outcome = await this.onSubmit({ ...this.buildSubmissionResult(), intent: 'proof' });
            if (this.proofClosed || epoch !== this.proofEpoch) return;
            if (!outcome.proof) throw new Error(t('ui.manuscriptOptionsModal.noProofProduced'));
            this.proofReceipt = outcome.proof;
            this.scenePaths.forEach((sourcePath, index) => {
                const words = outcome.proof?.sourceWordCounts[sourcePath];
                if (typeof words === 'number') this.sceneWordCounts[index] = words;
            });
            this.sceneMarkers.clear();
            await this.loadSceneMarkers();
            this.updateBadgeSceneCount();
            this.proofStaleReason = null;
            this.proofFileIndex = 0;
            if (this.proofFileDropdown) {
                this.proofFileDropdown.selectEl.empty();
                outcome.proof.renderedPaths.forEach((proofPath, index) => { this.proofFileDropdown?.addOption(String(index), proofPath.split('/').pop() || proofPath); });
                this.proofFileDropdown.setValue('0');
            }
            await this.checkProofFreshness();
            await this.loadProofFile();
        } catch (error) {
            if (!this.proofClosed) {
                this.proofStaleReason = error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.proofGenerationFailed');
                if (error instanceof ExportFailure) this.showExportFailure(error);
                this.updateProofUi();
                new Notice(this.proofStaleReason);
            }
        } finally {
            if (!this.proofClosed) {
                this.proofLoading = false;
                if (this.controlsEl) this.controlsEl.inert = false;
                this.updateProofUi();
                this.updateActionButtonDisabledState();
            }
        }
    }

    private async loadProofFile(): Promise<void> {
        const proofPath = this.proofReceipt?.renderedPaths[this.proofFileIndex];
        if (!proofPath || this.proofClosed) return;
        const epoch = ++this.proofEpoch;
        this.proofLoading = true;
        this.proofPages = 0;
        this.proofFrame?.empty();
        this.updateProofUi();
        try {
            await this.checkProofFreshness();
            const pages = await this.proofViewer.load(this.app, proofPath);
            if (pages === null || this.proofClosed || epoch !== this.proofEpoch) return;
            this.proofPages = pages;
            await this.renderProofPage(1);
        } catch (error) {
            if (!this.proofClosed) this.proofStaleReason = error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.proofLoadFailed');
        } finally {
            if (!this.proofClosed) { this.proofLoading = false; this.updateProofUi(); }
        }
    }

    private async renderProofPage(number: number): Promise<void> {
        if (!this.proofFrame || number < 1 || number > this.proofPages || this.proofClosed) return;
        const epoch = ++this.proofEpoch;
        this.proofLoading = true;
        this.updateProofUi();
        const canvas = this.proofFrame.ownerDocument.win.createEl('canvas');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', t('ui.manuscriptOptionsModal.proofCanvasAria', { page: number, total: this.proofPages }));
        try {
            await this.checkProofFreshness();
            if (await this.proofViewer.renderPage(number, canvas, { width: this.proofFrame.clientWidth, pixelRatio: this.proofFrame.ownerDocument.win.devicePixelRatio }) && !this.proofClosed && epoch === this.proofEpoch) {
                this.proofPage = number;
                this.proofFrame.empty();
                this.proofFrame.appendChild(canvas);
            }
        } catch (error) {
            if (!this.proofClosed) this.proofStaleReason = error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.proofPageRenderFailed');
        } finally {
            if (!this.proofClosed && epoch === this.proofEpoch) { this.proofLoading = false; this.updateProofUi(); }
        }
    }

    private getSourceBook(): BookProfile | null {
        const source = this.source;
        return source?.kind === 'book'
            ? this.plugin.settings.books.find(book => book.id === source.bookId) || null
            : null;
    }

    private captureOpenScenes(folder: string): void {
        this.openScenePathsSnapshot = new Set([...this.plugin.openScenePaths].filter(sourcePath => folder.length > 0 && sourcePath.startsWith(folder + '/')));
    }

    private getSourceTitle(): string {
        return this.source && this.source.kind !== 'book'
            ? this.source.title || this.source.path
            : this.getSourceBook()?.title || DEFAULT_BOOK_TITLE;
    }

    private restoreSavedSourceState(record: SavedManuscriptSource): void {
        this.savedSourceId = record.id;
        this.savedSourceName = record.name;
        this.source = structuredClone(record.source);
        this.sourceCandidates = [...record.candidatePaths];
        this.order = 'narrative';
        this.subplot = 'All Subplots';
        this.exportType = 'manuscript';
        this.sourceReviewed = false;
        try {
            const restored = restoreSavedManuscript(this.app, record);
            this.source = restored.source;
            this.sourceCandidates = restored.candidatePaths;
            this.sourceReviewed = restored.addedPaths.length === 0 && restored.missingPaths.length === 0;
            this.savedSourceNotice = restored.addedPaths.length || restored.missingPaths.length
                ? t('ui.manuscriptOptionsModal.restoredChanges', { newNotes: tCount('newNote', restored.addedPaths.length), missingPaths: tCount('savedPath', restored.missingPaths.length) })
                : '';
        } catch (error) {
            this.savedSourceNotice = error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.savedSourceUnavailable');
        }
    }

    private async loadSavedSource(id: string): Promise<void> {
        const record = this.savedManuscripts.find(item => item.id === id);
        if (!record) return;
        this.restoreSavedSourceState(record);
        this.renderSourceCard();
        const loadId = this.sourceLoadId + 1;
        await this.loadScenesForOrder();
        if (loadId !== this.sourceLoadId) return;
        this.plugin.settings.lastUsedManuscriptSourceId = id;
        try { await this.plugin.saveSettings(); }
        catch (error) { new Notice(t('ui.manuscriptOptionsModal.rememberManuscriptFailed', { message: error instanceof Error ? error.message : String(error) })); }
    }

    private clearSavedSourceSelection(): void {
        this.savedSourceId = undefined;
        this.savedSourceName = '';
        this.savedSourceNotice = '';
        this.plugin.settings.lastUsedManuscriptSourceId = undefined;
        void this.plugin.saveSettings().catch(error => new Notice(t('ui.manuscriptOptionsModal.rememberSourceFailed', { message: error instanceof Error ? error.message : String(error) })));
    }

    private async saveSource(asNew: boolean): Promise<void> {
        const source = this.source;
        if (!source || source.kind === 'book' || this.sourceSaving || this.sourceLoading || this.sourceError || !this.sourceReviewed || this.savedSourceStorageError) return;
        this.sourceSaving = true;
        if (this.sourceCard) this.sourceCard.inert = true;
        this.updateActionButtonDisabledState();
        this.updateProofUi();
        const previousRecords = this.plugin.settings.savedManuscriptSources;
        const previousLast = this.plugin.settings.lastUsedManuscriptSourceId;
        try {
            if (this.plugin.isSettingsPersistenceBlocked()) throw new Error(t('ui.manuscriptOptionsModal.savedWriteBlocked'));
            getReviewedManuscriptSelection(this.app, source);
            const name = this.savedSourceName.trim();
            if (!name) throw new Error(t('ui.manuscriptOptionsModal.enterSavedName'));
            const id = !asNew && this.savedSourceId ? this.savedSourceId : randomUUID();
            const record: SavedManuscriptSource = { schemaVersion: 1, id, name, source: structuredClone(source), candidatePaths: [...this.sourceCandidates] };
            const records = saveManuscriptRecord(readSavedManuscripts(previousRecords), record, !asNew && !!this.savedSourceId);
            this.plugin.settings.savedManuscriptSources = records;
            this.plugin.settings.lastUsedManuscriptSourceId = id;
            try { await this.plugin.saveSettings(); }
            catch (error) {
                if (this.plugin.settings.savedManuscriptSources === records) this.plugin.settings.savedManuscriptSources = previousRecords;
                if (this.plugin.settings.lastUsedManuscriptSourceId === id) this.plugin.settings.lastUsedManuscriptSourceId = previousLast;
                throw error;
            }
            this.savedManuscripts = records;
            this.savedSourceId = id;
            this.savedSourceName = name;
            this.savedSourceNotice = t('ui.manuscriptOptionsModal.savedSourceSaved');
            new Notice(t('ui.manuscriptOptionsModal.savedManuscriptNotice', { name }));
        } catch (error) {
            new Notice(error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.saveManuscriptFailed'));
        } finally {
            this.sourceSaving = false;
            if (this.sourceCard) this.sourceCard.inert = false;
            if (!this.proofClosed) { this.renderSourceCard(); this.syncExportUi(); }
        }
    }

    private async deleteSavedSource(id: string): Promise<void> {
        if (this.sourceSaving) return;
        this.sourceSaving = true;
        if (this.sourceCard) this.sourceCard.inert = true;
        this.updateActionButtonDisabledState();
        this.updateProofUi();
        const previousRecords = this.plugin.settings.savedManuscriptSources;
        const previousLast = this.plugin.settings.lastUsedManuscriptSourceId;
        try {
            if (this.plugin.isSettingsPersistenceBlocked()) throw new Error(t('ui.manuscriptOptionsModal.savedRemoveBlocked'));
            const records = readSavedManuscripts(previousRecords).filter(record => record.id !== id);
            this.plugin.settings.savedManuscriptSources = records;
            if (previousLast === id) this.plugin.settings.lastUsedManuscriptSourceId = undefined;
            try { await this.plugin.saveSettings(); }
            catch (error) {
                if (this.plugin.settings.savedManuscriptSources === records) {
                    this.plugin.settings.savedManuscriptSources = previousRecords;
                    if (this.plugin.settings.lastUsedManuscriptSourceId === undefined) this.plugin.settings.lastUsedManuscriptSourceId = previousLast;
                }
                throw error;
            }
            this.savedManuscripts = records;
            if (this.savedSourceId === id) { this.savedSourceId = undefined; this.savedSourceNotice = t('ui.manuscriptOptionsModal.savedSourceRemoved'); }
        } catch (error) { new Notice(error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.removeManuscriptFailed')); }
        finally { this.sourceSaving = false; if (this.sourceCard) this.sourceCard.inert = false; if (!this.proofClosed) { this.renderSourceCard(); this.syncExportUi(); } }
    }

    private updateSourceActions(): void {
        this.sourceErrorEl?.toggleClass('ert-hidden', !this.sourceError);
        this.sourceErrorEl?.setText(this.sourceError || '');
        const source = this.source;
        const unavailable = this.sourceSaving || this.sourceLoading || !!this.sourceError;
        this.sourceReviewButton?.setDisabled(unavailable || this.sourceReviewed || !source || source.kind === 'book' || source.paths.length === 0);
        const saveBlocked = unavailable || !this.sourceReviewed || !!this.savedSourceStorageError || this.plugin.isSettingsPersistenceBlocked() || !this.savedSourceName.trim() || !source || source.kind === 'book' || source.paths.length === 0;
        this.sourceSaveButton?.setDisabled(saveBlocked);
        this.sourceSaveAsButton?.setDisabled(saveBlocked);
    }

    private markSourceChanged(): void {
        if (!this.savedSourceId) return;
        this.savedSourceNotice = t('ui.manuscriptOptionsModal.unsavedChanges');
        this.savedSourceNoticeEl?.setText(this.savedSourceNotice);
        this.savedSourceNoticeEl?.removeClass('ert-hidden');
    }

    private async chooseSource(kind: 'folder' | 'file', sourcePath: string): Promise<void> {
        try {
            const files = getManuscriptSourceFiles(this.app, kind, sourcePath);
            const entry = this.app.vault.getAbstractFileByPath(sourcePath);
            this.source = { kind, path: sourcePath, paths: files.map(file => file.path), title: entry instanceof TFile ? entry.basename : entry?.name || '', author: '' };
            this.sourceCandidates = files.map(file => file.path);
            if (!this.savedSourceId) this.savedSourceName = this.source.title;
            this.savedSourceNotice = '';
            this.markSourceChanged();
            this.sourceReviewed = kind === 'file';
            this.sourceError = null;
            this.order = 'narrative';
            this.subplot = 'All Subplots';
            this.exportType = 'manuscript';
            this.renderSourceCard();
            await this.loadScenesForOrder();
        } catch (error) {
            new Notice(error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.selectManuscriptFailed'));
        }
    }

    private renderSourceCard(): void {
        const card = this.sourceCard;
        if (!card) return;
        card.empty();
        this.sourceReviewButton = undefined;
        this.sourceSaveButton = undefined;
        this.sourceSaveAsButton = undefined;
        this.savedSourceNoticeEl = undefined;
        this.sourceErrorEl = undefined;
        card.createEl('h4', { cls: 'ert-section-title', text: t('manuscriptModal.exportTypeManuscript') });
        if (this.savedSourceStorageError) card.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: this.savedSourceStorageError });
        if (this.plugin.isSettingsPersistenceBlocked()) card.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: t('ui.manuscriptOptionsModal.settingsUnreadable') });
        if (this.savedManuscripts.length) {
            const savedRow = card.createDiv({ cls: 'ert-row ert-manuscript-source-field' });
            savedRow.createSpan({ text: t('ui.manuscriptOptionsModal.savedManuscriptLabel') });
            new DropdownComponent(savedRow).addOption('', t('ui.manuscriptOptionsModal.unsavedManuscript'))
                .addOptions(Object.fromEntries(this.savedManuscripts.map(record => [record.id, record.name])))
                .setValue(this.savedSourceId || '').onChange(id => {
                    if (id) void this.loadSavedSource(id);
                    else { this.clearSavedSourceSelection(); this.renderSourceCard(); }
                });
        }
        const choices = card.createDiv({ cls: 'ert-manuscript-pill-row' });
        const bookButton = new ButtonComponent(choices).setButtonText(t('ui.manuscriptOptionsModal.rtBook')).onClick(() => {
            const book = getActiveBook(this.plugin.settings);
            if (!book) { new Notice(t('ui.manuscriptOptionsModal.addBookNotice')); return; }
            this.clearSavedSourceSelection();
            this.source = { kind: 'book', bookId: book.id };
            this.captureOpenScenes(book.sourceFolder);
            this.sourceReviewed = true;
            this.subplot = 'All Subplots';
            this.renderSourceCard();
            void this.loadSubplots().then(() => this.loadScenesForOrder());
        });
        bookButton.buttonEl.setAttribute('data-ert-toggle', '');
        bookButton.buttonEl.setAttribute('aria-pressed', String(this.source?.kind === 'book'));
        bookButton.buttonEl.toggleClass('is-active', this.source?.kind === 'book');
        for (const kind of ['folder', 'file'] as const) {
            const button = new ButtonComponent(choices).setButtonText(kind === 'folder' ? t('ui.manuscriptOptionsModal.folder') : t('ui.manuscriptOptionsModal.singleFile')).onClick(() => {
                new ManuscriptSourcePicker(this.app, kind, selectedPath => { void this.chooseSource(kind, selectedPath); }).open();
            });
            button.buttonEl.setAttribute('data-ert-toggle', '');
            button.buttonEl.setAttribute('aria-pressed', String(this.source?.kind === kind));
            button.buttonEl.toggleClass('is-active', this.source?.kind === kind);
        }
        const source = this.source;
        if (!source) { card.createDiv({ cls: 'ert-section-desc', text: t('ui.manuscriptOptionsModal.chooseSourcePrompt') }); return; }
        const sourceDetails = card.createDiv({ cls: 'ert-stack ert-manuscript-source-details' });
        if (this.savedSourceId || this.savedSourceNotice) {
            this.savedSourceNoticeEl = sourceDetails.createDiv({ cls: 'ert-section-desc', text: this.savedSourceNotice });
            this.savedSourceNoticeEl.toggleClass('ert-hidden', !this.savedSourceNotice);
        }
        if (source.kind === 'book') {
            const row = sourceDetails.createDiv({ cls: 'ert-row ert-manuscript-source-field' });
            row.createSpan({ text: t('ui.manuscriptOptionsModal.book') });
            new DropdownComponent(row).addOptions(Object.fromEntries(this.plugin.settings.books.map(book => [book.id, book.title])))
                .setValue(source.bookId).onChange(id => {
                    this.source = { kind: 'book', bookId: id };
                    this.captureOpenScenes(this.getSourceBook()?.sourceFolder || '');
                    this.subplot = 'All Subplots';
                    this.renderSourceCard();
                    void this.loadSubplots().then(() => this.loadScenesForOrder());
                });
        }
        const location = sourceDetails.createDiv({ cls: 'ert-row ert-manuscript-source-field ert-manuscript-source-location' });
        location.createSpan({ text: source.kind === 'file' ? t('ui.manuscriptOptionsModal.singleFile') : t('ui.manuscriptOptionsModal.folder') });
        location.createDiv({ cls: 'ert-section-desc', text: source.kind === 'book'
            ? this.getSourceBook()?.sourceFolder || t('ui.manuscriptOptionsModal.noSourceFolder')
            : source.path });
        if (source.kind === 'book') return;
        sourceDetails.createDiv({ cls: 'ert-section-desc', text: t('ui.manuscriptOptionsModal.plainSourceNote') });
        for (const field of ['title', 'author'] as const) {
            const label = sourceDetails.createEl('label', { cls: 'ert-row ert-manuscript-source-field' });
            label.createSpan({ text: field === 'title' ? t('ui.manuscriptOptionsModal.title') : t('ui.manuscriptOptionsModal.author') });
            const input = label.createEl('input', { cls: 'ert-input', attr: { type: 'text' } });
            input.value = source[field];
            input.addEventListener('input', () => {
                source[field] = input.value;
                this.markSourceChanged();
                this.syncExportUi();
                this.updateBadgeSceneCount();
            });
        }
        if (source.kind === 'folder') {
            const details = sourceDetails.createEl('details');
            details.open = !this.sourceReviewed;
            details.createEl('summary', { text: t('ui.manuscriptOptionsModal.reviewContentsSummary', { included: source.paths.length, total: this.sourceCandidates.length }) });
            const list = details.createDiv({ cls: 'ert-stack ert-manuscript-source-list' });
            this.sourceCandidates.forEach((sourcePath, index) => {
                const row = list.createDiv({ cls: 'ert-row' });
                const label = row.createEl('label');
                const check = label.createEl('input', { attr: { type: 'checkbox' } });
                check.checked = source.paths.includes(sourcePath);
                const available = this.app.vault.getAbstractFileByPath(sourcePath) instanceof TFile;
                const itemVars = { index: index + 1, path: sourcePath.slice(source.path.length + 1) };
                label.appendText(` ${available ? t('ui.manuscriptOptionsModal.sourceListItem', itemVars) : t('ui.manuscriptOptionsModal.sourceListItemMissing', itemVars)}`);
                check.addEventListener('change', () => {
                    const included = new Set(source.paths);
                    if (check.checked) included.add(sourcePath); else included.delete(sourcePath);
                    source.paths = this.sourceCandidates.filter(candidate => included.has(candidate));
                    this.sourceReviewed = false;
                    this.markSourceChanged();
                    this.renderSourceCard();
                    void this.loadScenesForOrder();
                });
                const actions = row.createDiv({ cls: 'ert-control' });
                for (const direction of [-1, 1]) {
                    new ButtonComponent(actions).setIcon(direction < 0 ? 'arrow-up' : 'arrow-down')
                        .setTooltip(direction < 0 ? t('ui.manuscriptOptionsModal.moveNoteEarlier') : t('ui.manuscriptOptionsModal.moveNoteLater'))
                        .setDisabled(index + direction < 0 || index + direction >= this.sourceCandidates.length)
                        .onClick(() => {
                            const included = new Set(source.paths);
                            const other = index + direction;
                            [this.sourceCandidates[index], this.sourceCandidates[other]] = [this.sourceCandidates[other], this.sourceCandidates[index]];
                            source.paths = this.sourceCandidates.filter(candidate => included.has(candidate));
                            this.sourceReviewed = false;
                            this.markSourceChanged();
                            this.renderSourceCard();
                            void this.loadScenesForOrder();
                        });
                }
                if (!available) new ButtonComponent(actions).setButtonText(t('ui.manuscriptOptionsModal.removeMissing')).onClick(() => {
                    this.sourceCandidates = this.sourceCandidates.filter(candidate => candidate !== sourcePath);
                    source.paths = source.paths.filter(path => path !== sourcePath);
                    this.sourceReviewed = false;
                    this.markSourceChanged();
                    this.renderSourceCard();
                    void this.loadScenesForOrder();
                });
            });
            this.sourceReviewButton = new ButtonComponent(details).setButtonText(this.sourceReviewed ? t('ui.manuscriptOptionsModal.contentsReviewed') : t('ui.manuscriptOptionsModal.useThisOrder'))
                .setDisabled(this.sourceReviewed || source.paths.length === 0)
                .onClick(() => { this.sourceReviewed = true; this.renderSourceCard(); this.syncExportUi(); });
        }
        const saveGroup = sourceDetails.createDiv({ cls: 'ert-manuscript-source-save', attr: { role: 'group', 'aria-label': t('ui.manuscriptOptionsModal.savedManuscriptNameAria') } });
        const nameRow = saveGroup.createEl('label', { cls: 'ert-row ert-manuscript-source-field' });
        nameRow.createSpan({ text: t('ui.manuscriptOptionsModal.saveAs') });
        const nameInput = nameRow.createEl('input', { cls: 'ert-input', attr: { type: 'text', 'aria-label': t('ui.manuscriptOptionsModal.savedManuscriptNameAria') } });
        nameInput.value = this.savedSourceName;
        nameInput.addEventListener('input', () => { this.savedSourceName = nameInput.value; this.markSourceChanged(); this.updateSourceActions(); });
        const saveActions = saveGroup.createDiv({ cls: 'ert-manuscript-pill-row ert-manuscript-source-save-actions' });
        this.sourceSaveButton = new ButtonComponent(saveActions).setButtonText(this.savedSourceId ? t('ui.manuscriptOptionsModal.updateSavedManuscript') : t('ui.manuscriptOptionsModal.saveManuscript')).onClick(() => { void this.saveSource(false); });
        if (this.savedSourceId) {
            this.sourceSaveAsButton = new ButtonComponent(saveActions).setButtonText(t('ui.manuscriptOptionsModal.saveManuscript')).setTooltip(t('ui.manuscriptOptionsModal.saveAsNew')).onClick(() => { void this.saveSource(true); });
            const id = this.savedSourceId;
            new ButtonComponent(saveActions).setButtonText(t('ui.manuscriptOptionsModal.removeSavedManuscript')).onClick(() => {
                const record = this.savedManuscripts.find(item => item.id === id);
                if (record) new DeletePublishingItemModal(this.app, record.name, () => { void this.deleteSavedSource(id); }, 'saved manuscript').open();
            });
        }
        saveGroup.createDiv({ cls: 'ert-section-desc ert-manuscript-source-save-note', text: t('ui.manuscriptOptionsModal.saveSourceNote') });
        this.sourceErrorEl = sourceDetails.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: this.sourceError || '' });
        this.updateSourceActions();
    }

    // Layout -----------------------------------------------------------------
    /**
     * Create a section heading with optional icon
     */
    private createSectionHeading(parent: HTMLElement, text: string, iconName?: string): HTMLElement {
        const heading = parent.createDiv({ cls: 'ert-sub-card-head' });
        if (iconName) {
            const icon = heading.createSpan({ cls: 'ert-sub-card-head-icon' });
            setIcon(icon, iconName);
        }
        heading.createSpan({ cls: 'ert-sub-card-head-text', text });
        return heading;
    }

    private renderSkeleton(container: HTMLElement): void {
        const hero = container.createDiv({ cls: 'ert-modal-header' });
        const bookTitle = this.getSourceTitle();
        this.badgeEl = hero.createSpan({ cls: 'ert-modal-badge', text: t('ui.manuscriptOptionsModal.badge', { title: bookTitle }) });

        hero.createDiv({
            cls: 'ert-modal-title',
            text: t('ui.manuscriptOptionsModal.modalTitle')
        });
        const description = hero.createDiv({ cls: 'ert-modal-subtitle ert-manuscript-modal-description' });
        description.createEl('p', { text: t('ui.manuscriptOptionsModal.subtitle') });
        const bookContextRow = hero.createDiv({ cls: 'ert-modal-meta' });
        const manageBooksLink = bookContextRow.createEl('a', {
            cls: 'ert-modal-meta-item',
            text: t('ui.manuscriptOptionsModal.manageBooks'),
            attr: { href: '#' }
        });
        manageBooksLink.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
            this.plugin.settingsTab?.revealSettingsSection('core', 'general');
            openSettingsTab(this.app);
        });
        this.managePdfLayoutsLinkEl = bookContextRow.createEl('a', {
            cls: 'ert-modal-meta-item ert-hidden',
            text: t('ui.manuscriptOptionsModal.managePdfLayouts'),
            attr: { href: '#' }
        });
        this.managePdfLayoutsLinkEl.addEventListener('click', (e) => {
            e.preventDefault();
            this.openPublishingSettings();
        });

        const recentLink = bookContextRow.createEl('a', {
            cls: 'ert-modal-meta-item', text: t('ui.exportDeliveryReviewModal.recentExports'), attr: { href: '#' }
        });
        recentLink.addEventListener('click', event => { event.preventDefault(); this.openRecentExports(); });

        this.sourceCard = container.createDiv({ cls: 'ert-panel ert-stack' });
        this.renderSourceCard();

        // WHO IS IT FOR — built-in presets, one per purpose
        this.purposeCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.purposeCard, t('ui.manuscriptOptionsModal.whoIsItFor'), 'users');
        const purposeRow = this.purposeCard.createDiv({ cls: 'ert-manuscript-pill-row ert-manuscript-pill-row--single' });
        for (const purpose of EXPORT_PURPOSES) {
            const pill = purposeRow.createEl('button', { text: purpose.label, attr: { 'data-ert-toggle': '' } });
            pill.onClickEvent(() => {
                void this.applyTemplateById(builtInPresetId(purpose.id));
            });
            this.purposePills.push({ el: pill, purpose });
        }
        this.purposeNoteEl = this.purposeCard.createDiv({ cls: 'ert-sub-card-note' });

        // A) OUTPUT
        const outputCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(outputCard, t('ui.manuscriptOptionsModal.output'), 'file-output');
        const outputGrid = outputCard.createDiv({ cls: 'ert-manuscript-output-grid' });
        this.outputGridEl = outputGrid;

        const exportTypeCol = outputGrid.createDiv({ cls: 'ert-manuscript-output-col' });
        this.exportTypeColEl = exportTypeCol;
        exportTypeCol.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.whatExporting') });
        const exportRow = exportTypeCol.createDiv({ cls: 'ert-manuscript-pill-row ert-manuscript-pill-row--single' });
        this.createExportTypePill(exportRow, t('manuscriptModal.exportTypeManuscript'), 'manuscript');
        this.createExportTypePill(exportRow, t('manuscriptModal.exportTypeOutline'), 'outline');

        const formatCol = outputGrid.createDiv({ cls: 'ert-manuscript-output-col' });
        formatCol.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.outputFormat') });
        this.formatPillRowEl = formatCol.createDiv({ cls: 'ert-manuscript-pill-row ert-manuscript-pill-row--single' });
        this.createOutputFormatPill(this.formatPillRowEl, t('manuscriptModal.formatMarkdown'), 'markdown', false, 'both');
        this.createOutputFormatPill(this.formatPillRowEl, t('manuscriptModal.formatPdf'), 'pdf', false, 'manuscript');
        this.createOutputFormatPill(this.formatPillRowEl, t('manuscriptModal.formatDocx'), 'docx', false, 'manuscript');
        this.formatStaticEl = formatCol.createDiv({ cls: 'ert-sub-card-note ert-hidden', text: t('ui.manuscriptOptionsModal.formatMarkdownStatic') });
        this.documentTypeDescEl = outputGrid.createDiv({ cls: 'ert-sub-card-note ert-manuscript-output-desc' });

        // B) PRESETS
        this.manuscriptOptionsCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        const manuscriptPresetGrid = this.manuscriptOptionsCard.createDiv({ cls: 'ert-manuscript-preset-grid' });
        this.manuscriptPresetGridEl = manuscriptPresetGrid;

        const presetHeaderCol = manuscriptPresetGrid.createDiv({ cls: 'ert-manuscript-preset-col ert-manuscript-preset-col--header' });
        this.createSectionHeading(presetHeaderCol, t('manuscriptModal.manuscriptPresetHeading'), 'book-open');
        this.layoutHeaderEl = manuscriptPresetGrid.createDiv({ cls: 'ert-manuscript-preset-col ert-manuscript-preset-col--header' });
        this.createSectionHeading(this.layoutHeaderEl, t('ui.manuscriptOptionsModal.layout'), 'layout-template');

        const presetCol = manuscriptPresetGrid.createDiv({ cls: 'ert-manuscript-preset-col ert-manuscript-preset-col--preset' });
        const presetRow = presetCol.createDiv({ cls: 'ert-manuscript-input-container' });
        this.manuscriptPresetDropdown = new DropdownComponent(presetRow)
            .addOption('novel', t('manuscriptModal.presetNovel'))
            .addOption('screenplay', t('manuscriptModal.presetScreenplay'))
            .addOption('podcast', t('manuscriptModal.presetPodcast'))
            .setValue(this.manuscriptPreset)
            .onChange((value) => {
                this.manuscriptPreset = value as ManuscriptPreset;
                this.syncExportUi();
                this.updateManuscriptPresetDescription();
            });
        this.manuscriptPresetDescEl = presetCol.createDiv({ cls: 'ert-sub-card-note' });
        this.updateManuscriptPresetDescription();
        // Export checks panel lives inside the left preset column so it
        // visually aligns with the Layout column on the right (which holds the
        // pictogram cards). Width is constrained to the preset column.
        this.templateWarningEl = presetCol.createDiv({ cls: 'ert-manuscript-template-warning ert-manuscript-preset-status' });
        this.layoutContainerEl = manuscriptPresetGrid.createDiv({ cls: 'ert-manuscript-layout-picker ert-manuscript-preset-col ert-manuscript-preset-col--layout' });

        this.outlineOptionsCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.outlineOptionsCard, t('manuscriptModal.outlinePresetHeading'), 'layout-list');
        const outlinePresetRow = this.outlineOptionsCard.createDiv({ cls: 'ert-manuscript-input-container' });
        this.outlinePresetDropdown = new DropdownComponent(outlinePresetRow)
            .addOption('beat-sheet', t('manuscriptModal.outlineBeatSheet'))
            .addOption('episode-rundown', t('manuscriptModal.outlineEpisodeRundown'))
            .addOption('shooting-schedule', t('manuscriptModal.outlineShootingSchedule'))
            .setValue(this.outlinePreset)
            .onChange((value) => {
                this.outlinePreset = value as OutlinePreset;
                this.syncExportUi();
                this.updateOutlinePresetDescription();
            });
        this.outlinePresetDescEl = this.outlineOptionsCard.createDiv({ cls: 'ert-sub-card-note' });
        this.updateOutlinePresetDescription();
        this.synopsisRow = this.outlineOptionsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        this.synopsisRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('manuscriptModal.includeSynopsis') });
        this.synopsisToggle = new ToggleComponent(this.synopsisRow)
            .setValue(this.includeSynopsisUserChoice)
            .onChange((value) => {
                this.includeSynopsisUserChoice = value;
                this.includeSynopsis = value;
            });
        this.outlineOptionsCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('manuscriptModal.includeSynopsisNote')
        });

        // C) SPLIT OUTPUT
        this.splitCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.splitCard, t('ui.manuscriptOptionsModal.splitOutput'), 'split');
        const splitModeRow = this.splitCard.createDiv({ cls: 'ert-manuscript-split-grid' });
        const splitModeGroup = `ert-manuscript-split-${Date.now()}`;
        const singleCol = splitModeRow.createDiv({ cls: 'ert-manuscript-split-col ert-manuscript-split-col--single' });
        const singleOption = singleCol.createEl('label', { cls: 'ert-manuscript-split-option' });
        this.splitSingleInputEl = singleOption.createEl('input', {
            attr: { type: 'radio', name: splitModeGroup, value: 'single' }
        });
        singleOption.createSpan({ cls: 'ert-manuscript-split-option-label', text: t('ui.manuscriptOptionsModal.singleFile') });

        const partsCol = splitModeRow.createDiv({ cls: 'ert-manuscript-split-col ert-manuscript-split-col--parts' });
        const partsOption = partsCol.createEl('label', { cls: 'ert-manuscript-split-option ert-manuscript-split-option--parts' });
        this.splitPartsRadioInputEl = partsOption.createEl('input', {
            attr: { type: 'radio', name: splitModeGroup, value: 'parts' }
        });
        partsOption.createSpan({ cls: 'ert-manuscript-split-option-label', text: t('ui.manuscriptOptionsModal.splitIntoParts') });
        this.splitPartsInputEl = partsOption.createEl('input', {
            cls: 'ert-input ert-input--xs ert-manuscript-split-parts-input',
            attr: { type: 'number', min: '2', max: '20', step: '1', value: String(this.splitParts) }
        });

        this.splitSingleInputEl.checked = true;
        this.splitSingleInputEl.addEventListener('change', () => {
            if (!this.splitSingleInputEl?.checked) return;
            this.splitMode = 'single';
            this.updateSplitUi();
        });
        this.splitPartsRadioInputEl.addEventListener('change', () => {
            if (!this.splitPartsRadioInputEl?.checked) return;
            this.splitMode = 'parts';
            this.updateSplitUi();
        });
        this.splitPartsInputEl.addEventListener('input', () => {
            const next = Number.parseInt(this.splitPartsInputEl?.value || '', 10);
            this.splitParts = clampSplitParts(next);
            if (this.splitPartsInputEl) this.splitPartsInputEl.value = String(this.splitParts);
            if (this.splitPartsRadioInputEl) this.splitPartsRadioInputEl.checked = true;
            this.splitMode = 'parts';
            this.updateSplitUi();
        });
        this.splitPartsContainerEl = this.splitCard.createDiv({ cls: 'ert-manuscript-split-parts ert-hidden' });
        this.splitHelperEl = this.splitPartsContainerEl.createDiv({
            cls: 'ert-sub-card-note',
            text: t('ui.manuscriptOptionsModal.splitHelper')
        });
        this.splitErrorEl = this.splitPartsContainerEl.createDiv({ cls: 'ert-sub-card-note ert-manuscript-split-error ert-hidden' });
        this.splitPreviewEl = this.splitPartsContainerEl.createDiv({ cls: 'ert-manuscript-split-preview' });

        // D) SCOPE
        this.scopeCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.scopeCard, t('ui.manuscriptOptionsModal.scope'), 'filter');

        this.filterCard = this.scopeCard.createDiv({ cls: 'ert-manuscript-scope-row' });
        this.filterCard.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.sceneFilter') });
        const filterContainer = this.filterCard.createDiv({ cls: 'ert-manuscript-input-container ert-manuscript-scope-input' });
        this.subplotDropdown = new DropdownComponent(filterContainer)
            .addOption('All Subplots', t('ui.manuscriptOptionsModal.allSubplots'))
            .setValue('All Subplots')
            .onChange(async (value) => {
                this.subplot = value;
                await this.loadScenesForOrder();
            });

        this.createSectionHeading(this.scopeCard, t('manuscriptModal.rangeHeading'), 'sliders-horizontal');
        this.rangeStatusEl = this.scopeCard.createDiv({ cls: 'ert-manuscript-range-status', text: t('manuscriptModal.rangeLoading') });
        this.rangeDecimalWarningEl = this.scopeCard.createDiv({
            cls: 'ert-manuscript-range-warning ert-hidden',
            text: t('manuscriptModal.rangeDecimalWarning')
        });
        const rangeShell = this.scopeCard.createDiv({ cls: 'ert-manuscript-range-shell' });
        this.rangeCardContainer = rangeShell.createDiv({ cls: 'ert-manuscript-range-cards' });
        const trackWrap = rangeShell.createDiv({ cls: 'ert-manuscript-range-track-wrap' });
        this.trackEl = trackWrap.createDiv({ cls: 'ert-manuscript-range-track' });
        this.rangeFillEl = this.trackEl.createDiv({ cls: 'ert-manuscript-range-fill' });
        this.startHandleEl = this.trackEl.createDiv({ cls: 'ert-manuscript-range-handle', attr: { 'data-handle': 'start', 'aria-label': t('ui.manuscriptOptionsModal.rangeStartAria') } });
        this.endHandleEl = this.trackEl.createDiv({ cls: 'ert-manuscript-range-handle', attr: { 'data-handle': 'end', 'aria-label': t('ui.manuscriptOptionsModal.rangeEndAria') } });
        this.registerPointerEvents();
        this.loadingEl = this.scopeCard.createDiv({ cls: 'ert-manuscript-loading', text: t('manuscriptModal.rangeLoading') });

        // E) ORDERING
        this.orderingCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.orderingCard, t('manuscriptModal.orderHeading'), 'arrow-down-up');
        const orderRow = this.orderingCard.createDiv({ cls: 'ert-manuscript-pill-row' });
        this.createOrderPill(orderRow, t('manuscriptModal.orderNarrative'), 'narrative');
        this.createOrderPill(orderRow, t('manuscriptModal.orderReverseNarrative'), 'reverse-narrative');
        this.createOrderPill(orderRow, t('manuscriptModal.orderChronological'), 'chronological');
        this.createOrderPill(orderRow, t('manuscriptModal.orderReverseChronological'), 'reverse-chronological');
        this.chronoHelperEl = this.orderingCard.createDiv({
            cls: 'ert-sub-card-note ert-hidden',
            text: t('ui.manuscriptOptionsModal.noWhenDates')
        });
        this.orderingCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('manuscriptModal.orderNote')
        });

        // F) MANUSCRIPT OPTIONS
        this.manuscriptRulesCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.manuscriptRulesCard, t('manuscriptModal.tocHeading'), 'list-checks');

        this.tocCard = this.manuscriptRulesCard.createDiv({ cls: 'ert-manuscript-rule-block' });
        this.tocCard.createDiv({ cls: 'ert-manuscript-toggle-label', text: t('manuscriptModal.tocHeading') });
        const tocActions = this.tocCard.createDiv({ cls: 'ert-manuscript-pill-row' });
        this.tocActionsEl = tocActions;
        this.createPill(tocActions, t('manuscriptModal.tocMarkdown'), this.tocMode === 'markdown', () => {
            this.tocMode = 'markdown';
            this.updatePills(tocActions, 0);
        });
        this.createPill(tocActions, t('manuscriptModal.tocPlain'), this.tocMode === 'plain', () => {
            this.tocMode = 'plain';
            this.updatePills(tocActions, 1);
        });
        this.createPill(tocActions, t('manuscriptModal.tocNone'), this.tocMode === 'none', () => {
            this.tocMode = 'none';
            this.updatePills(tocActions, 2);
        });
        this.tocCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('manuscriptModal.tocNote')
        });

        this.syncTocPills();

        // G) MANUSCRIPT OPTIONS
        this.publishingCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        const publishingHeading = this.createSectionHeading(this.publishingCard, t('ui.manuscriptOptionsModal.manuscriptOptions'), 'settings');
        this.publishingHeadingTextEl = publishingHeading.querySelector('.ert-sub-card-head-text') || undefined;
        const publishingBody = this.publishingCard.createDiv({ cls: 'ert-manuscript-advanced-body' });

        this.pdfSettingsCard = publishingBody.createDiv({ cls: 'ert-manuscript-rule-block' });

        this.includeMatterCard = this.pdfSettingsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        this.includeMatterCard.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.includeMatter') });
        this.includeMatterToggle = new ToggleComponent(this.includeMatterCard)
            .setValue(this.includeMatterUserChoice)
            .onChange((value) => {
                this.hasTouchedMatterToggle = true;
                this.includeMatterUserChoice = value;
                this.includeMatter = value;
                this.updateTemplateActionButtonState();
            });

        const lineBreaksRow = this.pdfSettingsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        lineBreaksRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.lineBreaksAsParagraphs') });
        this.lineBreaksToggle = new ToggleComponent(lineBreaksRow)
            .setValue(this.lineBreaksAsParagraphs)
            .onChange((value) => {
                this.lineBreaksAsParagraphs = value;
                this.updateTemplateActionButtonState();
            });
        this.pdfSettingsCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('ui.manuscriptOptionsModal.lineBreaksNote')
        });

        this.artifactRowEl = this.pdfSettingsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        this.artifactRowEl.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.saveArtifact') });
        this.markdownArtifactToggle = new ToggleComponent(this.artifactRowEl)
            .setValue(this.saveMarkdownArtifact)
            .onChange((value) => {
                this.saveMarkdownArtifact = value;
                this.updateTemplateActionButtonState();
            });
        this.artifactHelperEl = this.pdfSettingsCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('ui.manuscriptOptionsModal.saveArtifactNote')
        });

        // Print binding gutter — persisted directly on settings (not per-profile):
        // it describes the physical output target (screen vs paperback), which is
        // stable across export profiles. PDF-only; hidden for DOCX in syncExportUi.
        this.gutterRowEl = this.pdfSettingsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        this.gutterRowEl.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.bindingGutter') });
        new ToggleComponent(this.gutterRowEl)
            .setValue(this.plugin.settings.pdfBindingGutter === true)
            .onChange(async (value) => {
                this.plugin.settings.pdfBindingGutter = value;
                await this.plugin.saveSettings();
            });
        this.gutterHelperEl = this.pdfSettingsCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('ui.manuscriptOptionsModal.bindingGutterNote')
        });

        this.wordCountCard = publishingBody.createDiv({ cls: 'ert-manuscript-rule-block ert-manuscript-rule-block--separated' });
        const wordCountRow = this.wordCountCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        const wordCountLabel = wordCountRow.createSpan({ cls: 'ert-manuscript-toggle-label' });
        this.appendInlineCodeText(wordCountLabel, t('manuscriptModal.wordCountToggle'));
        this.updateWordCountsToggle = new ToggleComponent(wordCountRow)
            .setValue(this.updateWordCounts)
            .onChange((value) => {
                this.updateWordCounts = value;
                this.updateTemplateActionButtonState();
            });

        const sceneIdCard = publishingBody.createDiv({ cls: 'ert-manuscript-rule-block ert-manuscript-rule-block--separated' });
        this.sceneIdCard = sceneIdCard;
        this.createSectionHeading(sceneIdCard, t('ui.manuscriptOptionsModal.sceneId'));
        sceneIdCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('ui.manuscriptOptionsModal.sceneIdNote')
        });
        this.renderEditorialistPlug(sceneIdCard);
        const sceneIdRow = sceneIdCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        sceneIdRow.createSpan({
            cls: 'ert-manuscript-toggle-label',
            text: t('ui.manuscriptOptionsModal.appendSceneId'),
        });
        this.sceneIdToggle = new ToggleComponent(sceneIdRow)
            .setValue(this.includeSceneId)
            .onChange((value) => {
                this.includeSceneId = value;
                this.updateTemplateActionButtonState();
            });

        this.exportCleanupCard = publishingBody.createDiv({ cls: 'ert-manuscript-rule-block ert-manuscript-rule-block--separated' });
        this.createSectionHeading(this.exportCleanupCard, t('ui.manuscriptOptionsModal.exportCleanup'));
        this.exportCleanupCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('ui.manuscriptOptionsModal.exportCleanupNote')
        });

        // Each cleanup toggle: plain-language label on the toggle row, then a
        // muted one-line example in monofont chips beneath it.
        const addCleanupExample = (text: string): void => {
            const note = this.exportCleanupCard?.createDiv({ cls: 'ert-sub-card-note ert-manuscript-cleanup-example' });
            if (note) this.appendInlineCodeText(note, text);
        };

        const linksRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        linksRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.stripLinks') });
        this.cleanupLinksToggle = new ToggleComponent(linksRow).onChange((value) => {
            this.setActiveCleanupOption('stripLinks', value);
        });
        addCleanupExample(t('ui.manuscriptOptionsModal.stripLinksExample'));

        const aiCommentsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        aiCommentsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.stripAuthorQueries') });
        this.cleanupAiCommentsToggle = new ToggleComponent(aiCommentsRow).onChange((value) => {
            this.setActiveCleanupOption('stripAiComments', value);
        });
        addCleanupExample(t('ui.manuscriptOptionsModal.stripAuthorQueriesExample'));

        const commentsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        commentsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.stripComments') });
        this.cleanupCommentsToggle = new ToggleComponent(commentsRow).onChange((value) => {
            this.setActiveCleanupOption('stripComments', value);
        });
        addCleanupExample(t('ui.manuscriptOptionsModal.stripCommentsExample'));

        const calloutsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        calloutsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.stripCallouts') });
        this.cleanupCalloutsToggle = new ToggleComponent(calloutsRow).onChange((value) => {
            this.setActiveCleanupOption('stripCallouts', value);
        });
        addCleanupExample(t('ui.manuscriptOptionsModal.stripCalloutsExample'));

        const blockIdsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        blockIdsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('ui.manuscriptOptionsModal.stripBlockIds') });
        this.cleanupBlockIdsToggle = new ToggleComponent(blockIdsRow).onChange((value) => {
            this.setActiveCleanupOption('stripBlockIds', value);
        });
        addCleanupExample('`^scene-end`');

        const yamlFrontmatterNote = this.exportCleanupCard.createDiv({ cls: 'ert-sub-card-note' });
        this.appendInlineCodeText(yamlFrontmatterNote, t('ui.manuscriptOptionsModal.yamlRemovedNote'));
        const protectedNote = this.exportCleanupCard.createDiv({ cls: 'ert-sub-card-note' });
        this.appendInlineCodeText(protectedNote, t('ui.manuscriptOptionsModal.protectedNote'));

        // H) EXPORT TEMPLATES
        this.templateCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card ert-layout-templates-card' });
        this.createSectionHeading(this.templateCard, t('ui.manuscriptOptionsModal.savedPresets'), 'bookmark');
        const presetTopRow = this.templateCard.createDiv({ cls: 'ert-export-preset-toprow' });
        const presetSummaryStack = presetTopRow.createDiv({ cls: 'ert-export-preset-summary-stack' });
        this.templateSummaryEl = presetSummaryStack.createDiv({ cls: 'ert-sub-card-note ert-export-preset-summary' });
        this.templateHintEl = presetSummaryStack.createDiv({ cls: 'ert-sub-card-note ert-export-preset-hint' });
        const dropdownRow = presetTopRow.createDiv({ cls: 'ert-template-dropdown-row' });
        const templateSetting = new DropdownComponent(dropdownRow.createDiv({ cls: 'ert-manuscript-input-container' }));
        templateSetting.selectEl.addClass('ert-input', 'ert-input--lg');
        this.exportTemplateDropdown = templateSetting.selectEl;
        templateSetting.onChange((value) => {
            if (!value) {
                this.selectedExportProfileId = null;
                this.selectedExportProfile = this.defaultExportProfile;
                this.selectedLayoutId = this.resolveLayoutIdForProfile(this.selectedExportProfile);
                this.syncExportUi();
                this.updateTemplateActionButtonState();
                this.updateExportProfileSummary();
                void this.rememberLastUsedTemplate(null);
                return;
            }
            void this.applyTemplateById(value);
        });
        const templateActions = this.templateCard.createDiv({ cls: 'ert-template-actions' });
        // Re-selecting the same option in a <select> fires no change event, so
        // discarding edits needs its own control.
        this.reloadTemplateButton = new ButtonComponent(templateActions)
            .setButtonText(t('ui.manuscriptOptionsModal.reloadPreset'))
            .onClick(() => {
                const selectedId = this.getCurrentTemplateSelection();
                if (!selectedId) return;
                void this.applyTemplateById(selectedId);
            });
        this.saveTemplateButton = new ButtonComponent(templateActions)
            .setButtonText(t('ui.manuscriptOptionsModal.createPreset'))
            .onClick(() => {
                void this.saveOrUpdateTemplate();
            });
        this.deleteTemplateButton = new ButtonComponent(templateActions)
            .setButtonText(t('ui.manuscriptOptionsModal.deletePreset'))
            .setDestructive()
            .setDisabled(true)
            .onClick(() => {
                const selectedId = this.getCurrentTemplateSelection();
                if (!selectedId) return;
                const template = this.getTemplateList().find(item => item.id === selectedId);
                if (!template) return;
                new DeletePublishingItemModal(this.app, template.name, () => {
                    void this.deleteTemplate(selectedId);
                }).open();
            });
        this.refreshTemplateDropdown();

        this.renderDestination(container);
        // I) FOOTER — one-line read-back of what the file will contain
        this.exportReadinessEl = container.createDiv({ cls: 'ert-panel ert-stack ert-hidden', attr: { role: 'status', 'aria-live': 'polite' } });
        this.readbackEl = container.createDiv({ cls: 'ert-sub-card-note ert-hidden' });
        const actions = container.createDiv({ cls: 'ert-modal-actions' });
        this.actionButton = new ButtonComponent(actions)
            .setButtonText(this.getPrimaryActionLabel())
            .setCta()
            .onClick(() => {
                if (this.exportCompleted) {
                    this.close();
                    return;
                }
                void this.submit();
            });

        this.openFolderButton = new ButtonComponent(actions)
            .setButtonText(this.getOpenFolderButtonLabel())
            .onClick(() => this.openOutcomeFolder());
        this.openFolderButton.buttonEl.addClass('ert-hidden');

        this.openFileButton = new ButtonComponent(actions)
            .setButtonText(t('ui.manuscriptOptionsModal.openFile'))
            .onClick(() => { void this.openOutcomeFile(); });
        this.openFileButton.buttonEl.addClass('ert-hidden');

        this.cancelButton = new ButtonComponent(actions)
            .setButtonText(t('manuscriptModal.actionCancel'))
            .onClick(() => {
                void this.persistCurrentSnapshot().finally(() => this.close());
            });

        this.outputStatusEl = container.createDiv({ cls: 'ert-manuscript-output-status ert-sub-card-note ert-hidden' });

        this.syncExportUi();
    }

    /** "3 scenes" for an RT book, "3 notes" for a folder or file source. */
    private countItems(count: number): string {
        return this.source?.kind === 'book' ? tCount('scene', count) : tCount('note', count);
    }

    private updateBadgeSceneCount(): void {
        if (!this.badgeEl) return;
        const bookTitle = this.getSourceTitle();
        const count = this.getSelectedSceneCount();
        const words = this.getSelectedWordCount();
        const wordsLabel = words === 1
            ? t('ui.manuscriptOptionsModal.wordsOne', { count: words.toLocaleString() })
            : t('ui.manuscriptOptionsModal.wordsOther', { count: words.toLocaleString() });
        this.badgeEl.setText(t('ui.manuscriptOptionsModal.badgeSummary', { title: bookTitle, items: this.countItems(count), words: wordsLabel }));
        this.updateReadback();
        this.updateProofUi();
    }

    private refreshExportProfileState(): void {
        this.templateProfiles = adaptPandocLayoutsToPublishingModel(this.plugin.settings.pandocLayouts).profiles;
        this.exportProfiles = this.getStoredExportProfiles().map(profile => buildModalExportProfile(profile, this.templateProfiles));

        const transientDefault = this.buildLiveProfile(undefined, 'Current settings', false);
        this.defaultExportProfile = transientDefault;
        this.defaultExportProfileId = transientDefault.id;

        const activePreferences = this.getActiveBookPublishingPreferences();
        const lastUsedId = activePreferences?.lastUsedExportProfileId
            || this.plugin.settings.lastUsedExportProfileId
            || null;
        this.lastUsedPresetId = lastUsedId;
        this.lastUsedExportProfile = lastUsedId ? this.exportProfiles.find(profile => profile.id === lastUsedId) : undefined;

        // Start as a draft; restoreLastUsedTemplate() picks and applies the
        // preset (or last ad-hoc settings) once the UI exists.
        this.selectedExportProfileId = null;
        this.selectedExportProfile = this.defaultExportProfile;
        this.selectedLayoutId = this.resolveLayoutIdForProfile(this.selectedExportProfile);
        this.updateExportProfileSummary();
    }

    private updateExportProfileSummary(): void {
        if (!this.templateSummaryEl) return;
        this.templateSummaryEl.empty();

        const { selectedTemplate, isCreateMode, isBuiltIn, hasChanges } = this.getSelectedTemplateState();
        const isPandoc = this.exportType === 'manuscript' && this.outputFormat === 'pdf';
        this.templateSummaryEl.toggleClass('ert-hidden', !isPandoc);

        if (isPandoc) {
            const summaryProfile = selectedTemplate
                ? this.createTemplateSnapshot(selectedTemplate.name, selectedTemplate.id)
                : this.createTemplateSnapshot('Current settings');
            const templateProfile = this.templateProfiles.find(item => item.id === summaryProfile.templateProfileId);
            const templateName = templateProfile
                ? this.formatTemplateProfileName(templateProfile)
                : t('ui.manuscriptOptionsModal.unknownTemplate');

            const badgeVariant = isCreateMode
                ? 'ert-badgePill--muted'
                : hasChanges
                    ? 'ert-badgePill--warning'
                    : 'ert-badgePill--success';
            const badge = this.templateSummaryEl.createSpan({
                cls: `ert-badgePill ert-badgePill--sm ${badgeVariant}`
            });
            badge.createSpan({
                cls: 'ert-badgePill__text',
                text: isCreateMode ? t('ui.manuscriptOptionsModal.presetBadgeDraft') : hasChanges ? t('ui.manuscriptOptionsModal.presetBadgeModified') : isBuiltIn ? t('ui.manuscriptOptionsModal.builtIn') : t('ui.manuscriptOptionsModal.presetBadgeSaved')
            });

            this.templateSummaryEl.createSpan({
                cls: 'ert-export-preset-summary-text',
                text: ` ${summaryProfile.usageContext} · ${templateName}`
            });
        }

        if (this.templateHintEl) {
            this.templateHintEl.setText(
                isCreateMode
                    ? t('ui.manuscriptOptionsModal.hintNotSaved')
                    : isBuiltIn
                        ? hasChanges
                            ? t('ui.manuscriptOptionsModal.hintBuiltInChanged')
                            : t('ui.manuscriptOptionsModal.hintBuiltIn')
                        : hasChanges
                            ? t('ui.manuscriptOptionsModal.hintChanged')
                            : t('ui.manuscriptOptionsModal.hintMatches')
            );
            this.templateHintEl.toggleClass('ert-export-preset-hint--warning', hasChanges);
            this.templateHintEl.toggleClass('ert-export-preset-hint--muted', !hasChanges);
        }

        this.exportTemplateDropdown?.toggleClass('ert-input--warning', hasChanges);
    }

    private getSelectedTemplateState(): {
        selectedTemplate?: ModalExportProfile;
        isCreateMode: boolean;
        isBuiltIn: boolean;
        hasChanges: boolean;
    } {
        const selectedId = this.getCurrentTemplateSelection();
        const selectedTemplate = this.findTemplateById(selectedId);
        const isCreateMode = !selectedTemplate;
        return {
            selectedTemplate,
            isCreateMode,
            isBuiltIn: !!getExportPurposeForPresetId(selectedId),
            hasChanges: selectedTemplate ? this.hasSelectedTemplateChanges(selectedTemplate) : false
        };
    }

    /**
     * A saved preset, or a built-in purpose preset laid over the export as it
     * stands, so a built-in only ever differs in the settings it owns.
     */
    private findTemplateById(id: string | null | undefined): ModalExportProfile | undefined {
        const purpose = getExportPurposeForPresetId(id);
        if (purpose) return buildPurposeProfile(purpose, this.buildLiveProfile(undefined, 'Current settings', true));
        return this.getTemplateList().find(item => item.id === id);
    }

    /** The export as the modal holds it right now, before any format gating. */
    private buildLiveProfile(id: string | undefined, name: string, includeRange: boolean): ModalExportProfile {
        return buildTransientModalExportProfile({
            id,
            name,
            usageContext: this.manuscriptPreset,
            exportType: this.exportType,
            outputFormat: this.outputFormat,
            order: this.order,
            subplot: this.subplot,
            outlinePreset: this.outlinePreset,
            tocMode: this.tocMode,
            includeSceneIdInToc: this.includeSceneId,
            includeSceneIdInHeading: this.includeSceneId,
            includeMatter: this.includeMatterUserChoice,
            includeSynopsis: this.includeSynopsisUserChoice,
            updateWordCounts: this.updateWordCounts,
            saveMarkdownArtifact: this.saveMarkdownArtifact,
            lineBreaksAsParagraphs: this.lineBreaksAsParagraphs,
            cleanup: this.getActiveCleanupOptions(),
            splitMode: this.splitMode,
            splitParts: this.splitParts,
            // Non-PDF modes clear selectedLayoutId; keep the selected preset's layout then.
            selectedLayoutId: this.selectedLayoutId ?? this.resolveLayoutIdForProfile(this.selectedExportProfile),
            templateProfiles: this.templateProfiles,
            rangeStart: includeRange ? this.rangeStart : undefined,
            rangeEnd: includeRange ? this.rangeEnd : undefined,
        });
    }

    private resolveLayoutIdForProfile(profile: ModalExportProfile | undefined): string | undefined {
        if (!profile) return undefined;
        return profile.templateProfileId || profile.selectedLayoutId;
    }

    private openPublishingSettings(sectionKey: string = 'pdf-style'): void {
        this.close();
        this.plugin.settingsTab?.revealSettingsSection('publishing', sectionKey);
        openSettingsTab(this.app);
    }

    private refreshValidationSnapshot(): void {
        const activeBook = this.getSourceBook();
        const selectedProfile = this.selectedExportProfile || this.defaultExportProfile;
        const context = {
            exportType: this.exportType,
            outputFormat: this.exportType === 'outline' ? 'markdown' : this.outputFormat,
            manuscriptPreset: this.manuscriptPreset,
            selectedLayoutId: this.selectedLayoutId || this.resolveLayoutIdForProfile(selectedProfile),
            includeMatter: this.includeMatter,
            manuscriptMetadata: this.source && this.source.kind !== 'book' ? { title: this.source.title, author: this.source.author } : undefined,
        } as const;
        this.validationSnapshot = this.plugin.getPublishingValidationService().collect(activeBook?.id, context);
        const issues = getExportValidationIssues(this.validationSnapshot, context);
        const sourceIssue = this.sourceError || (this.sourceLoading ? t('ui.manuscriptOptionsModal.sourceLoadingIssue')
            : !this.sourceReviewed ? t('ui.manuscriptOptionsModal.sourceNotReviewedIssue')
            : this.totalScenes === 0 ? t('ui.manuscriptOptionsModal.sourceEmptyIssue') : null);
        this.exportBlocked = !!sourceIssue || issues.some(issue => issue.level === 'error');
        const readiness = this.exportReadinessEl;
        if (readiness) {
            readiness.empty();
            readiness.toggleClass('ert-hidden', this.exportType === 'outline' || (this.outputFormat === 'markdown' && issues.length === 0 && !sourceIssue));
            readiness.createEl('h4', { cls: 'ert-section-title', text: this.exportBlocked ? t('ui.manuscriptOptionsModal.exportChecksNeedAttention') : t('ui.manuscriptOptionsModal.exportChecksReady') });
            if (sourceIssue) readiness.createDiv({ text: sourceIssue });
            for (const issue of issues.filter(issue => issue.level !== 'info')) {
                readiness.createDiv({ text: issue.message });
            }
            const blocker = issues.find(issue => issue.level === 'error');
            if (blocker && !(blocker.scope === 'book-meta' && this.source?.kind !== 'book')) {
                const needsStyle = blocker.code.includes('font') || blocker.code.includes('template') || blocker.code.includes('layout') || blocker.code.includes('profile');
                const target = blocker.scope === 'book-meta' ? 'book-details' : needsStyle ? 'pdf-style' : 'export-check';
                new ButtonComponent(readiness)
                    .setButtonText(blocker.scope === 'book-meta' ? t('ui.manuscriptOptionsModal.editBookDetails') : needsStyle ? t('ui.manuscriptOptionsModal.reviewPdfStyle') : t('ui.manuscriptOptionsModal.openExportTools'))
                    .onClick(() => this.openPublishingSettings(target));
            }
        }
        this.updateActionButtonDisabledState();
        this.updateProofUi();
        this.updateSourceActions();
        this.updateDestinationUi();
    }

    private getTemplateList(): ModalExportProfile[] {
        return Array.isArray(this.exportProfiles) ? this.exportProfiles : [];
    }

    private getStoredExportProfiles(): ExportProfile[] {
        const profiles = this.plugin.settings.exportProfiles;
        return Array.isArray(profiles) ? profiles : [];
    }

    private getActiveBookPublishingPreferences(): BookPublishingPreferences | null {
        const activeBook = this.getSourceBook();
        if (!activeBook) return null;
        const preferences = this.plugin.settings.bookPublishingPreferences;
        if (!Array.isArray(preferences)) return null;
        return preferences.find(entry => entry.bookId === activeBook.id) || null;
    }

    private async persistTemplateList(list: ModalExportProfile[]): Promise<void> {
        this.exportProfiles = list;
        this.plugin.settings.exportProfiles = list.map(profile => buildPersistedExportProfileFromModalExportProfile(profile));
        await this.plugin.saveSettings();
    }

    private getCurrentTemplateSelection(): string | null {
        const dropdownValue = (this.exportTemplateDropdown?.value || '').trim();
        const selectedValue = (this.selectedExportProfileId || '').trim();
        const value = dropdownValue || selectedValue;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const isKnown = !!getExportPurposeForPresetId(trimmed) || this.getTemplateList().some(template => template.id === trimmed);
        return isKnown ? trimmed : null;
    }

    private async rememberLastUsedTemplate(templateId: string | null): Promise<void> {
        this.plugin.settings.lastUsedExportProfileId = templateId || undefined;
        const activeBook = this.getSourceBook();
        if (activeBook) {
            const preferences = Array.isArray(this.plugin.settings.bookPublishingPreferences)
                ? [...this.plugin.settings.bookPublishingPreferences]
                : [];
            const index = preferences.findIndex(entry => entry.bookId === activeBook.id);
            if (index >= 0) {
                preferences[index] = {
                    ...preferences[index],
                    lastUsedExportProfileId: templateId || undefined,
                };
            } else if (templateId) {
                preferences.push({
                    bookId: activeBook.id,
                    lastUsedExportProfileId: templateId,
                });
            }
            this.plugin.settings.bookPublishingPreferences = preferences;
        }
        await this.plugin.saveSettings();
    }

    private refreshTemplateDropdown(): void {
        if (!this.exportTemplateDropdown) return;
        this.exportTemplateDropdown.empty();

        const templates = this.getTemplateList();
        const doc = this.exportTemplateDropdown.ownerDocument;
        const placeholder = doc.win.createEl('option');
        placeholder.value = '';
        placeholder.text = t('ui.manuscriptOptionsModal.createNewPreset');
        placeholder.disabled = false;
        placeholder.selected = !this.selectedExportProfileId;
        this.exportTemplateDropdown.appendChild(placeholder);

        const addGroup = (label: string, entries: { id: string; name: string }[]): void => {
            if (entries.length === 0) return;
            const group = doc.win.createEl('optgroup');
            group.label = label;
            entries.forEach(entry => {
                const option = doc.win.createEl('option');
                option.value = entry.id;
                option.text = entry.name;
                if (this.selectedExportProfileId === entry.id) {
                    option.selected = true;
                    placeholder.selected = false;
                }
                group.appendChild(option);
            });
            this.exportTemplateDropdown?.appendChild(group);
        };
        addGroup(t('ui.manuscriptOptionsModal.builtIn'), EXPORT_PURPOSES.map(purpose => ({ id: builtInPresetId(purpose.id), name: purpose.label })));
        addGroup(t('ui.manuscriptOptionsModal.yourPresets'), templates);

        const hasActiveTemplate = !!this.selectedExportProfileId
            && (!!getExportPurposeForPresetId(this.selectedExportProfileId)
                || templates.some(template => template.id === this.selectedExportProfileId));
        this.exportTemplateDropdown.value = hasActiveTemplate ? this.selectedExportProfileId! : '';
        this.exportTemplateDropdown.disabled = false;
        const hasTransientProfile = !!this.selectedExportProfile
            && !!this.selectedExportProfileId
            && this.selectedExportProfile.id === this.selectedExportProfileId;
        if (!hasActiveTemplate && !hasTransientProfile) {
            this.selectedExportProfileId = null;
            this.selectedExportProfile = this.defaultExportProfile;
            this.selectedLayoutId = this.resolveLayoutIdForProfile(this.selectedExportProfile);
        } else if (!hasActiveTemplate && hasTransientProfile) {
            placeholder.selected = true;
        }
        this.updateTemplateActionButtonState();
    }

    private getFontFamilyType(fontName?: string | null): 'serif' | 'sans-serif' | 'monospace' | 'script' | 'display' {
        const source = (fontName || '').trim().toLowerCase();
        if (!source) return 'serif';
        if (/(mono|courier|consolas|menlo|typewriter)/.test(source)) return 'monospace';
        if (/(sans|helvetica|arial|inter|gothic|futura|avenir|verdana|tahoma|grotesk)/.test(source)) return 'sans-serif';
        if (/(script|hand|cursive|calligraphy)/.test(source)) return 'script';
        if (/(display|decorative|blackletter)/.test(source)) return 'display';
        return 'serif';
    }

    private getCleanupFormatForState(outputFormat: ExportFormat): 'markdown' | 'pdf' {
        return cleanupFormatForOutputFormat(outputFormat);
    }

    private getActiveCleanupOptions(): ManuscriptExportCleanupOptions {
        return this.getCleanupFormatForState(this.outputFormat) === 'pdf'
            ? { ...this.pdfCleanupOptions }
            : { ...this.markdownCleanupOptions };
    }

    private getNormalizedCleanupOptions(
        options: Partial<ManuscriptExportCleanupOptions> | undefined,
        outputFormat: ExportFormat
    ): ManuscriptExportCleanupOptions {
        return normalizeManuscriptCleanupOptions(options, this.getCleanupFormatForState(outputFormat));
    }

    private setActiveCleanupOption(key: keyof ManuscriptExportCleanupOptions, value: boolean): void {
        const target = this.getCleanupFormatForState(this.outputFormat) === 'pdf'
            ? this.pdfCleanupOptions
            : this.markdownCleanupOptions;
        target[key] = value;
        this.updateTemplateActionButtonState();
    }

    private updateCleanupToggleState(): void {
        const options = this.getActiveCleanupOptions();
        this.cleanupCommentsToggle?.setValue(options.stripComments);
        this.cleanupAiCommentsToggle?.setValue(options.stripAiComments);
        this.cleanupLinksToggle?.setValue(options.stripLinks);
        this.cleanupCalloutsToggle?.setValue(options.stripCallouts);
        this.cleanupBlockIdsToggle?.setValue(options.stripBlockIds);
    }

    private createTemplateSnapshot(name: string, existingId?: string): ModalExportProfile {
        const mode = this.getUiMode();
        const selectedLayoutId = this.resolveLayoutIdForProfile(this.selectedExportProfile);
        return {
            id: existingId ?? `${Date.now()}`,
            name,
            templateProfileId: selectedLayoutId || '',
            usageContext: this.exportType === 'outline' ? this.manuscriptPreset : this.manuscriptPreset,
            outputFormat: mode.isOutline ? 'markdown' : this.outputFormat,
            exportType: this.exportType,
            outlinePreset: this.outlinePreset,
            tocMode: mode.showToc ? this.tocMode : 'none',
            includeSceneIdInToc: mode.showToc ? this.includeSceneId : false,
            includeSceneIdInHeading: this.includeSceneId,
            includeMatter: mode.showIncludeMatter ? this.includeMatterUserChoice : false,
            includeSynopsis: mode.isOutline ? this.includeSynopsisUserChoice : false,
            updateWordCounts: mode.showWordCount ? this.updateWordCounts : false,
            saveMarkdownArtifact: mode.showSavePrecompile ? this.saveMarkdownArtifact : false,
            lineBreaksAsParagraphs: mode.showLineBreaksAsParagraphs ? this.lineBreaksAsParagraphs : false,
            cleanup: mode.isManuscript
                ? this.getActiveCleanupOptions()
                : getDefaultManuscriptCleanupOptions('markdown'),
            splitMode: mode.showSplit ? this.splitMode : 'single',
            splitParts: mode.showSplit && this.splitMode === 'parts' ? this.splitParts : 1,
            selectionPolicy: 'manual-range',
            order: this.order,
            subplot: this.subplot,
            selectedLayoutId: mode.isPdfManuscript ? selectedLayoutId : undefined,
        };
    }

    private hasSelectedTemplateChanges(template: ModalExportProfile): boolean {
        return !exportProfilesMatch(this.createTemplateSnapshot(template.name, template.id), template);
    }

    private updateTemplateActionButtonState(): void {
        if (this.exportCompleted) this.resetPostExportState();
        this.outputStatusEl?.empty();
        this.outputStatusEl?.addClass('ert-hidden');
        this.refreshValidationSnapshot();
        const { selectedTemplate, isCreateMode, isBuiltIn, hasChanges } = this.getSelectedTemplateState();

        if (this.saveTemplateButton) {
            if (isCreateMode) {
                this.saveTemplateButton.setButtonText(t('ui.manuscriptOptionsModal.createPreset'));
                this.saveTemplateButton.setDisabled(false);
            } else if (isBuiltIn) {
                this.saveTemplateButton.setButtonText(t('ui.manuscriptOptionsModal.saveAsPreset'));
                this.saveTemplateButton.setDisabled(false);
            } else {
                this.saveTemplateButton.setButtonText(hasChanges ? t('ui.manuscriptOptionsModal.updatePreset') : t('ui.manuscriptOptionsModal.presetUpToDate'));
                this.saveTemplateButton.setDisabled(!hasChanges);
            }
        }

        this.reloadTemplateButton?.buttonEl.toggleClass('ert-hidden', !(selectedTemplate && hasChanges));
        this.deleteTemplateButton?.setDisabled(!selectedTemplate || isBuiltIn);
        this.syncPurposeUi(hasChanges);
        this.updateReadback();
        this.updateExportProfileSummary();
    }

    private syncPurposeUi(hasChanges: boolean): void {
        const active = getExportPurposeForPresetId(this.getCurrentTemplateSelection());
        this.purposePills.forEach(({ el, purpose }) => el.toggleClass('is-active', purpose.id === active?.id));
        this.purposeNoteEl?.setText(
            !active
                ? t('ui.manuscriptOptionsModal.purposeNoteNone')
                : hasChanges
                    ? t('ui.manuscriptOptionsModal.purposeNoteChanged', { description: active.description })
                    : active.description
        );
    }

    /**
     * One line above the Export button saying what the file will carry, so a
     * leaked note or a lost question shows before the file exists. Counts come
     * from the sanitizer's own comment classification.
     */
    private updateReadback(): void {
        const el = this.readbackEl;
        if (!el) return;
        el.empty();
        const paths = this.getSelectedScenePaths();
        const visible = this.exportType === 'manuscript' && paths.length > 0;
        el.toggleClass('ert-hidden', !visible);
        if (!visible) return;

        const forReaders = getExportPurposeForPresetId(this.getCurrentTemplateSelection())?.id === 'readers';
        const cleanup = this.getActiveCleanupOptions();
        const markers = paths
            .map(path => this.sceneMarkers.get(path))
            .filter((marker): marker is SceneMarkers => marker !== undefined);
        const counted = markers.length === paths.length;
        const parts: ReadbackPart[] = [];

        const scenes = this.countItems(paths.length);
        if (!this.includeSceneId) {
            parts.push({ text: scenes, warn: false });
        } else if (forReaders) {
            parts.push({ text: scenes, warn: false }, { text: t('ui.manuscriptOptionsModal.readbackIdsOn'), warn: true });
        } else if (!counted) {
            parts.push({ text: t('ui.manuscriptOptionsModal.readbackCheckingIds', { items: scenes }), warn: false });
        } else {
            const missing = markers.filter(marker => !marker.hasSceneId).length;
            parts.push(missing > 0
                ? { text: t('ui.manuscriptOptionsModal.readbackMissingIds', { items: scenes, present: markers.length - missing, missing }), warn: true }
                : { text: t('ui.manuscriptOptionsModal.readbackWithIds', { items: scenes }), warn: false });
        }

        if (!counted) {
            parts.push({ text: t('ui.manuscriptOptionsModal.readbackCounting'), warn: false });
        } else {
            const queries = markers.reduce((sum, marker) => sum + marker.authorQueries, 0);
            const notes = markers.reduce((sum, marker) => sum + marker.privateNotes, 0);
            if (queries > 0) parts.push(this.describeAuthorQueries(queries, cleanup.stripAiComments, forReaders));
            if (notes > 0) {
                parts.push(cleanup.stripComments
                    ? { text: t('ui.manuscriptOptionsModal.readbackNotesStripped'), warn: false }
                    : { text: t('ui.manuscriptOptionsModal.readbackWillAppear', { items: tCount('privateNote', notes) }), warn: true });
            }
        }

        parts.forEach((part, index) => {
            if (index > 0) el.appendText(' · ');
            el.createSpan({ text: part.text, cls: part.warn ? 'ert-export-preset-hint--warning' : undefined });
        });
    }

    private describeAuthorQueries(count: number, stripped: boolean, forReaders: boolean): ReadbackPart {
        const questions = tCount('question', count);
        if (stripped) return { text: t('ui.manuscriptOptionsModal.readbackQuestionsStripped', { questions }), warn: false };
        const queries = tCount('authorQuery', count);
        if (this.outputFormat === 'pdf') return { text: t('ui.manuscriptOptionsModal.readbackQueriesPrint', { queries }), warn: true };
        if (forReaders) {
            return {
                text: this.outputFormat === 'docx'
                    ? t('ui.manuscriptOptionsModal.readbackQueriesAsComments', { queries })
                    : t('ui.manuscriptOptionsModal.readbackWillAppear', { items: queries }),
                warn: true,
            };
        }
        return this.outputFormat === 'docx'
            ? { text: t('ui.manuscriptOptionsModal.readbackQuestionsMargin', { questions }), warn: false }
            : { text: t('ui.manuscriptOptionsModal.readbackQuestionsKept', { questions }), warn: false };
    }

    private async loadSceneMarkers(): Promise<void> {
        for (const path of this.scenePaths) {
            if (this.sceneMarkers.has(path)) continue;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;
            const content = await this.app.vault.cachedRead(file);
            this.sceneMarkers.set(path, {
                ...countManuscriptComments(content.slice(getFrontMatterInfo(content).contentStart)),
                hasSceneId: !!readSceneId(this.app.metadataCache.getFileCache(file)?.frontmatter),
            });
        }
        this.updateReadback();
    }

    private async saveTemplate(name: string, existingId?: string): Promise<void> {
        const template = this.createTemplateSnapshot(name, existingId);
        const current = this.getTemplateList().filter(item => item.id !== template.id);
        current.unshift(template);
        await this.persistTemplateList(current);
        this.selectedExportProfileId = template.id;
        this.selectedExportProfile = template;
        await this.rememberLastUsedTemplate(template.id);
        this.refreshTemplateDropdown();
        this.updateExportProfileSummary();
        new Notice(existingId
            ? t('ui.manuscriptOptionsModal.presetUpdatedNotice', { name: template.name })
            : t('ui.manuscriptOptionsModal.presetSavedNotice', { name: template.name }));
    }

    private async saveOrUpdateTemplate(): Promise<void> {
        const selectedId = this.getCurrentTemplateSelection();
        const purpose = getExportPurposeForPresetId(selectedId);
        if (selectedId && !purpose) {
            const existing = this.getTemplateList().find(item => item.id === selectedId);
            if (!existing) return;
            if (!this.hasSelectedTemplateChanges(existing)) {
                this.updateTemplateActionButtonState();
                return;
            }
            await this.saveTemplate(existing.name, existing.id);
            return;
        }
        // Built-ins are never overwritten; saving one makes a preset of your own.
        const defaultName = purpose ? purpose.label : t('ui.manuscriptOptionsModal.defaultPresetName', { date: new Date().toLocaleDateString() });
        new SaveExportTemplateModal(this.app, (name) => {
            void this.saveTemplate(name);
        }, defaultName).open();
    }

    private async deleteTemplate(templateId: string): Promise<void> {
        const filtered = this.getTemplateList().filter(item => item.id !== templateId);
        await this.persistTemplateList(filtered);
        if (this.selectedExportProfileId === templateId) {
            this.selectedExportProfileId = null;
            this.selectedExportProfile = this.defaultExportProfile;
        }
        if (this.plugin.settings.lastUsedExportProfileId === templateId) {
            await this.rememberLastUsedTemplate(null);
        }
        this.refreshTemplateDropdown();
        this.updateExportProfileSummary();
        new Notice(t('ui.manuscriptOptionsModal.presetDeleted'));
    }

    private async applyTemplateById(templateId: string): Promise<void> {
        const template = this.findTemplateById(templateId);
        if (!template) {
            new Notice(t('ui.manuscriptOptionsModal.presetNotFound'));
            return;
        }
        await this.applyTemplate(template);
        await this.rememberLastUsedTemplate(template.id);
    }

    private async applyTemplate(
        template: ModalExportProfile,
        options?: { showNotice?: boolean }
    ): Promise<void> {
        const showNotice = options?.showNotice ?? true;

        this.exportType = template.exportType;
        this.manuscriptPreset = template.usageContext;
        this.outlinePreset = template.outlinePreset || 'beat-sheet';
        this.outputFormat = template.outputFormat;
        this.tocMode = template.tocMode || 'none';
        this.includeSceneId = resolveIncludeSceneId(template);
        this.sceneIdToggle?.setValue(this.includeSceneId);
        this.order = template.order;
        this.subplot = template.subplot || 'All Subplots';
        this.updateWordCounts = !!template.updateWordCounts;
        this.includeSynopsisUserChoice = !!template.includeSynopsis;
        this.includeMatterUserChoice = !!template.includeMatter;
        this.includeMatter = this.includeMatterUserChoice;
        this.hasTouchedMatterToggle = true;
        this.saveMarkdownArtifact = !!template.saveMarkdownArtifact;
        this.lineBreaksAsParagraphs = template.lineBreaksAsParagraphs === true;
        this.lineBreaksToggle?.setValue(this.lineBreaksAsParagraphs);
        const templateCleanup = this.getNormalizedCleanupOptions(template.cleanup, template.outputFormat);
        if (this.getCleanupFormatForState(template.outputFormat) === 'pdf') {
            this.pdfCleanupOptions = templateCleanup;
        } else {
            this.markdownCleanupOptions = templateCleanup;
        }
        this.splitMode = template.splitMode === 'parts' ? 'parts' : 'single';
        this.splitParts = clampSplitParts(template.splitParts ?? this.splitParts);
        this.selectedLayoutId = this.resolveLayoutIdForProfile(template);
        this.selectedExportProfileId = template.id;
        this.selectedExportProfile = { ...template };

        this.manuscriptPresetDropdown?.setValue(this.manuscriptPreset);
        this.outlinePresetDropdown?.setValue(this.outlinePreset);
        this.synopsisToggle?.setValue(this.includeSynopsisUserChoice);
        this.updateWordCountsToggle?.setValue(this.updateWordCounts);
        this.syncExportTypePills();

        const requestedOpenScenes = this.subplot === OPEN_SCENES_FILTER;
        const subplotOptions = Array.from(this.subplotDropdown?.selectEl.options || []);
        const subplotExists = subplotOptions.some(option => option.value === this.subplot);
        if (!subplotExists) {
            this.subplot = 'All Subplots';
        }
        this.subplotDropdown?.setValue(this.subplot);

        this.syncExportUi();
        await this.loadScenesForOrder();
        // loadScenesForOrder resets range to the full book; restore the
        // template's saved range (if any), clamped to the current scene count.
        const restoreSavedRange = this.source?.kind === 'book' && !requestedOpenScenes;
        if (restoreSavedRange && typeof template.rangeStart === 'number' && typeof template.rangeEnd === 'number' && this.totalScenes > 0) {
            const total = Math.max(1, this.totalScenes);
            const savedStart = Math.max(1, Math.min(Math.floor(template.rangeStart), total));
            const savedEnd = Math.max(savedStart, Math.min(Math.floor(template.rangeEnd), total));
            this.rangeStart = savedStart;
            this.rangeEnd = savedEnd;
            this.updateRangeUI();
            this.updateBadgeSceneCount();
        }
        this.refreshTemplateDropdown();
        this.updateExportProfileSummary();

        if (showNotice) {
            new Notice(t('ui.manuscriptOptionsModal.presetApplied', { name: template.name }));
        }
    }

    /**
     * Open on the preset the author last chose, loaded exactly as saved so it
     * reads as matching. Without one, restore their last ad-hoc settings
     * (draft), then the book's default preset. The scene range is not part of
     * a preset, so it carries over from the last session when that session
     * used the same order and subplot.
     */
    private async restoreLastUsedTemplate(): Promise<void> {
        const activePreferences = this.getActiveBookPublishingPreferences();
        const snapshot = activePreferences?.lastUsedExportProfileSnapshot;
        const lastUsedPurpose = getExportPurposeForPresetId(this.lastUsedPresetId);
        if (lastUsedPurpose) {
            // A built-in follows the book: lay it over the last session's settings.
            const base = snapshot
                ? buildModalExportProfile(snapshot, this.templateProfiles)
                : this.buildLiveProfile(undefined, 'Current settings', false);
            await this.applyTemplate(buildPurposeProfile(lastUsedPurpose, base), { showNotice: false });
            return;
        }
        const lastUsedPreset = this.lastUsedExportProfile;
        if (lastUsedPreset) {
            const rangeMatches = !!snapshot
                && snapshot.order === lastUsedPreset.order
                && (snapshot.subplot || 'All Subplots') === lastUsedPreset.subplot;
            await this.applyTemplate({
                ...lastUsedPreset,
                rangeStart: rangeMatches ? snapshot.rangeStart : undefined,
                rangeEnd: rangeMatches ? snapshot.rangeEnd : undefined,
            }, { showNotice: false });
            return;
        }
        if (snapshot) {
            await this.applyTemplate(buildModalExportProfile(snapshot, this.templateProfiles), { showNotice: false });
            return;
        }
        const defaultPreset = this.getTemplateList().find(item => item.id === activePreferences?.defaultExportProfileId);
        if (defaultPreset) {
            await this.applyTemplate(defaultPreset, { showNotice: false });
            return;
        }
        this.refreshTemplateDropdown();
        this.updateExportProfileSummary();
    }

    private buildCurrentSnapshot(): ExportProfile {
        return buildPersistedExportProfileFromModalExportProfile(
            this.buildLiveProfile('__last_used_snapshot__', 'Last used', !this.isOpenScenesMode())
        );
    }

    private async persistCurrentSnapshot(): Promise<void> {
        const activeBook = this.getSourceBook();
        if (!activeBook) return;
        const snapshot = this.buildCurrentSnapshot();
        const preferences = Array.isArray(this.plugin.settings.bookPublishingPreferences)
            ? [...this.plugin.settings.bookPublishingPreferences]
            : [];
        const index = preferences.findIndex(entry => entry.bookId === activeBook.id);
        if (index >= 0) {
            preferences[index] = {
                ...preferences[index],
                lastUsedExportProfileSnapshot: snapshot,
            };
        } else {
            preferences.push({
                bookId: activeBook.id,
                lastUsedExportProfileSnapshot: snapshot,
            });
        }
        this.plugin.settings.bookPublishingPreferences = preferences;
        await this.plugin.saveSettings();
    }

    // Interaction helpers ----------------------------------------------------
    private appendInlineCodeText(target: HTMLElement, text: string): void {
        text.split(/(`[^`]+`)/g).filter(Boolean).forEach(part => {
            if (part.startsWith('`') && part.endsWith('`')) {
                target.createEl('code', { text: part.slice(1, -1) });
            } else {
                target.appendText(part);
            }
        });
    }

    private renderEditorialistPlug(target: HTMLElement): void {
        const plug = target.createDiv({ cls: 'ert-editorialist-plug' });

        const SVG_NS = 'http://www.w3.org/2000/svg';
        const svg = plug.ownerDocument.createElementNS(SVG_NS, 'svg');
        svg.addClass('ert-editorialist-plug__logo');
        svg.setAttr('viewBox', `${EDITORIALIST_LOGO_VIEWBOX.x} ${EDITORIALIST_LOGO_VIEWBOX.y} ${EDITORIALIST_LOGO_VIEWBOX.width} ${EDITORIALIST_LOGO_VIEWBOX.height}`);
        svg.setAttr('aria-hidden', 'true');
        EDITORIALIST_LOGO_PATHS.forEach((pathData) => {
            const path = plug.ownerDocument.createElementNS(SVG_NS, 'path');
            path.setAttr('d', pathData);
            path.setAttr('fill', 'currentColor');
            svg.append(path);
        });
        plug.append(svg);

        const text = plug.createSpan({ cls: 'ert-editorialist-plug__text' });
        // One translatable sentence; the link sits where {{plugin}} appears.
        const [plugBefore, plugAfter = ''] = t('ui.manuscriptOptionsModal.editorialistPlug').split('{{plugin}}');
        text.appendText(plugBefore);
        const link = text.createEl('a', {
            cls: 'ert-link-accent',
            text: 'Editorialist',
        });
        // Counted redirect to the Editorialist listing (slug rt-export-editorialist).
        link.setAttribute('href', 'https://community.radialtimeline.com/go/rt-export-editorialist');
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
        text.appendText(plugAfter);
    }

    private createPill(parent: HTMLElement, label: string, active: boolean, onClick: () => void): void {
        const pill = parent.createEl('button', { attr: { 'data-ert-toggle': '' } });
        pill.setText(label);
        if (active) pill.addClass('is-active');
        pill.onClickEvent(() => {
            parent.querySelectorAll('[data-ert-toggle]').forEach(el => el.removeClass('is-active'));
            pill.addClass('is-active');
            onClick();
            this.updateTemplateActionButtonState();
        });
    }

    private updatePills(parent: HTMLElement, activeIndex: number): void {
        const pills = Array.from(parent.querySelectorAll('[data-ert-toggle]'));
        pills.forEach((el, idx) => {
            if (idx === activeIndex) {
                el.classList.add('is-active');
            } else {
                el.removeClass('is-active');
            }
        });
    }

    private syncTocPills(): void {
        if (!this.tocActionsEl) return;
        const activeIndex = this.tocMode === 'markdown'
            ? 0
            : this.tocMode === 'plain'
                ? 1
                : 2;
        this.updatePills(this.tocActionsEl, activeIndex);
    }


    private createOrderPill(parent: HTMLElement, label: string, order: ManuscriptOrder): void {
        const pill = parent.createEl('button', { attr: { 'data-ert-toggle': '' } });
        pill.setText(label);
        this.orderPills.push({ el: pill, order });

        if (this.order === order) pill.addClass('is-active');

        pill.onClickEvent(async () => {
            if (pill.disabled) return;

            this.orderPills.forEach(p => p.el.removeClass('is-active'));
            pill.addClass('is-active');
            this.order = order;
            await this.loadScenesForOrder();
        });
    }

    /** Re-apply `is-active` to whichever pill matches `this.exportType`. Used after applyTemplate restores state. */
    private syncExportTypePills(): void {
        this.exportTypePills.forEach(p => {
            p.el.toggleClass('is-active', p.type === this.exportType);
        });
    }

    private createExportTypePill(parent: HTMLElement, label: string, type: ExportType, disabled = false): void {
        const pill = parent.createEl('button', { attr: { 'data-ert-toggle': '' } });
        pill.setText(label);
        if (this.exportType === type) pill.addClass('is-active');
        if (disabled) {
            pill.disabled = true;
        }
        this.exportTypePills.push({ el: pill, type });

        pill.onClickEvent(() => {
            if (disabled) {
                new Notice(t('manuscriptModal.proRequired'));
                return;
            }
            this.exportTypePills.forEach(p => p.el.removeClass('is-active'));
            pill.addClass('is-active');
            this.exportType = type;
            this.normalizeOutputFormatForOutline();
            this.syncExportUi();
        });
    }

    private createOutputFormatPill(parent: HTMLElement, label: string, format: ExportFormat, disabled = false, scope: ExportType | 'both' = 'both'): void {
        const pill = parent.createEl('button', {
            cls: 'ert-manuscript-output-format-pill',
            attr: { 'data-scope': scope, 'data-ert-toggle': '' }
        });

        // Add icon based on format
        const iconMap: Record<ExportFormat, string> = {
            'markdown': 'file-text',
            'pdf': 'file-text',
            'docx': 'file-type',
            'csv': 'table',
            'json': 'code'
        };
        const iconName = iconMap[format];
        if (iconName) {
            const icon = pill.createSpan({ cls: 'ert-export-pill-icon' });
            setIcon(icon, iconName);
        }
        pill.createSpan({ text: label });

        const isActive = this.outputFormat === format;
        if (isActive) pill.addClass('is-active');
        if (disabled) {
            pill.disabled = true;
        }
        this.outputFormatPills.push({ el: pill, format });

        pill.onClickEvent(() => {
            if (disabled) {
                new Notice(t('ui.manuscriptOptionsModal.formatUnavailable'));
                return;
            }
            const scopeMatch = scope === 'both' || scope === this.exportType;
            if (!scopeMatch) return;
            this.outputFormatPills
                .filter(p => {
                    const pillScope = p.el.getAttribute('data-scope') as ExportType | 'both' | null;
                    return pillScope === 'both' || pillScope === this.exportType;
                })
                .forEach(p => p.el.removeClass('is-active'));
            pill.addClass('is-active');
            this.outputFormat = format;
            this.normalizeOutputFormatForOutline();
            this.syncExportUi();
        });
    }

    private normalizeOutputFormatForOutline(): void {
        if (this.exportType !== 'outline') return;
        if (this.outputFormat !== 'markdown') {
            this.outputFormat = 'markdown';
        }
    }

    private syncOutputFormatPills(): void {
        this.outputFormatPills.forEach(p => {
            const scope = p.el.getAttribute('data-scope') as ExportType | 'both' | null;
            const scopeMatch = scope === 'both' || scope === this.exportType;
            const shouldHide = this.exportType === 'outline';
            p.el.toggleClass('ert-hidden', shouldHide);
            p.el.toggleClass('is-active', scopeMatch && this.outputFormat === p.format);
            if (!scopeMatch) {
                p.el.removeClass('is-active');
            }
        });
    }

    private isPdfManuscriptExport(): boolean {
        return this.exportType === 'manuscript' && this.outputFormat === 'pdf';
    }

    private syncExportUi(): void {
        // If a previous export has completed and the user is now changing
        // settings, restore the pre-export UI (Generate PDF + Cancel) so they
        // can export again with the new settings without closing and reopening
        // the modal. The success-state buttons (Reveal in Finder / Open file)
        // are hidden because their `lastOutcome` would describe a stale file
        // that no longer matches the current settings.
        if (this.exportCompleted) {
            this.resetPostExportState();
        }
        this.outputStatusEl?.empty();
        this.outputStatusEl?.addClass('ert-hidden');
        this.normalizeOutputFormatForOutline();
        const plainSource = this.source?.kind !== 'book';
        if (plainSource) {
            this.exportType = 'manuscript';
            this.includeMatter = false;
            this.includeMatterUserChoice = false;
            this.updateWordCounts = false;
            this.includeSceneId = false;
            this.tocMode = 'none';
            this.order = 'narrative';
            this.subplot = 'All Subplots';
            this.rangeStart = 1;
            this.rangeEnd = Math.max(1, this.totalScenes);
        }
        const mode = this.getUiMode();
        this.sanitizeStateForMode(mode);
        this.scopeCard?.toggleClass('ert-hidden', plainSource);
        this.orderingCard?.toggleClass('ert-hidden', plainSource);
        this.exportTypeColEl?.toggleClass('ert-hidden', plainSource);
        this.outputGridEl?.toggleClass('ert-manuscript-output-grid--format-only', plainSource);
        this.exportTypePills.forEach(({ el, type }) => el.toggleClass('ert-hidden', plainSource && type === 'outline'));

        this.purposeCard?.toggleClass('ert-hidden', !mode.isManuscript);
        this.manuscriptOptionsCard?.toggleClass('ert-hidden', !mode.showManuscriptPreset);
        this.outlineOptionsCard?.toggleClass('ert-hidden', !mode.showOutlinePreset);
        this.manuscriptRulesCard?.toggleClass('ert-hidden', !mode.showToc || plainSource);
        this.tocCard?.toggleClass('ert-hidden', !mode.showToc || plainSource);
        this.publishingCard?.toggleClass('ert-hidden', !mode.showPublishing);
        this.pdfSettingsCard?.toggleClass('ert-hidden', !mode.showIncludeMatter && !mode.showLineBreaksAsParagraphs && !mode.showSavePrecompile);
        this.wordCountCard?.toggleClass('ert-hidden', !mode.showWordCount || plainSource);
        this.sceneIdCard?.toggleClass('ert-hidden', plainSource);
        this.wordCountCard?.toggleClass('ert-manuscript-rule-block--separated', mode.showIncludeMatter || mode.showSavePrecompile);
        this.includeMatterCard?.toggleClass('ert-hidden', !mode.showIncludeMatter || plainSource);
        this.includeMatterToggle?.setValue(this.includeMatterUserChoice);
        this.exportCleanupCard?.toggleClass('ert-hidden', !mode.showExportCleanup);
        this.synopsisRow?.toggleClass('ert-hidden', !mode.showOutlinePreset);
        this.splitCard?.toggleClass('ert-hidden', !mode.showSplit);
        this.formatPillRowEl?.toggleClass('ert-hidden', !mode.showFormatPills);
        this.formatStaticEl?.toggleClass('ert-hidden', !mode.showFormatStatic);
        this.managePdfLayoutsLinkEl?.toggleClass('ert-hidden', !mode.showManagePdfLayouts);
        this.chronoHelperEl?.toggleClass('ert-hidden', !mode.chronoMessage);

        if (this.documentTypeDescEl) {
            this.documentTypeDescEl.toggleClass('ert-hidden', mode.isManuscript);
            this.documentTypeDescEl.setText(mode.isManuscript
                ? plainSource ? t('ui.manuscriptOptionsModal.docTypeNotes') : t('ui.manuscriptOptionsModal.docTypeScenes')
                : t('ui.manuscriptOptionsModal.docTypeOutline'));
        }

        if (this.publishingHeadingTextEl) {
            this.publishingHeadingTextEl.setText(mode.isPdfManuscript ? t('ui.manuscriptOptionsModal.pdfOptions') : t('ui.manuscriptOptionsModal.manuscriptOptions'));
        }

        if (!mode.showSavePrecompile) this.saveMarkdownArtifact = false;
        this.markdownArtifactToggle?.setValue(this.saveMarkdownArtifact);
        this.markdownArtifactToggle?.setDisabled(!mode.showSavePrecompile);
        this.artifactRowEl?.toggleClass('ert-hidden', !mode.showSavePrecompile);
        this.artifactHelperEl?.toggleClass('ert-hidden', !mode.showSavePrecompile);
        // Binding gutter is LaTeX page geometry — PDF only, never DOCX.
        this.gutterRowEl?.toggleClass('ert-hidden', !mode.isPdfManuscript);
        this.gutterHelperEl?.toggleClass('ert-hidden', !mode.isPdfManuscript);

        this.syncOutputFormatPills();
        this.updateLayoutPicker();
        this.refreshValidationSnapshot();
        this.updateTemplateWarning();
        this.syncTocPills();
        this.updateCleanupToggleState();
        this.updateOrderPillsState();
        this.updateSplitUi();
        this.updateTemplateActionButtonState();
        this.updateExportProfileSummary();
    }

    /**
     * Render the layout picker in manuscript preset column 2.
     * Visible only for manuscript PDF exports.
     */
    private updateLayoutPicker(): void {
        if (!this.layoutContainerEl) return;
        this.layoutContainerEl.empty();

        const isPdfManuscript = this.exportType === 'manuscript' && this.outputFormat === 'pdf';
        this.manuscriptPresetGridEl?.toggleClass('ert-manuscript-preset-grid--single', !isPdfManuscript);
        this.layoutHeaderEl?.toggleClass('ert-manuscript-preset-col--hidden', !isPdfManuscript);
        this.templateWarningEl?.toggleClass('ert-manuscript-preset-status--hidden', !isPdfManuscript);
        this.layoutContainerEl.toggleClass('ert-manuscript-preset-col--hidden', !isPdfManuscript);
        if (!isPdfManuscript) {
            return;
        }

        const layouts = this.templateProfiles
            .filter(profile => profile.usageContexts.includes(this.manuscriptPreset))
            .sort((a, b) => {
                const aLayout = this.plugin.settings.pandocLayouts?.find(layout => layout.id === a.legacyLayoutId || layout.id === a.id);
                const bLayout = this.plugin.settings.pandocLayouts?.find(layout => layout.id === b.legacyLayoutId || layout.id === b.id);
                const aRank = aLayout ? getPandocLayoutSortRank(aLayout) : 99;
                const bRank = bLayout ? getPandocLayoutSortRank(bLayout) : 99;
                return aRank - bRank || a.name.localeCompare(b.name);
            });
        const activeProfileId = this.resolveLayoutIdForProfile(this.selectedExportProfile);
        let selectedLayoutProfile: TemplateProfile | undefined;

        if (layouts.length === 0) {
            // Empty state
            const emptyRow = this.layoutContainerEl.createDiv({ cls: 'ert-manuscript-layout-empty' });
            emptyRow.createSpan({ text: `${t('ui.manuscriptOptionsModal.noLayoutsFor', { preset: this.manuscriptPreset })} ` });
            const link = emptyRow.createEl('a', {
                text: t('ui.manuscriptOptionsModal.manageLayouts'),
                attr: { href: '#', style: 'text-decoration: underline;' }
            });
            link.addEventListener('click', (e) => { // SAFE: direct addEventListener; Modal lifecycle manages cleanup
                e.preventDefault();
                this.openPublishingSettings();
            });
            this.selectedLayoutId = undefined;
            selectedLayoutProfile = undefined;
        } else if (layouts.length === 1) {
            // Single layout — static text
            this.layoutContainerEl.createDiv({
                cls: 'ert-sub-card-note',
                text: this.formatTemplateProfileName(layouts[0])
            });
            this.selectedLayoutId = activeProfileId || layouts[0].id;
            void this.rememberSelectedLayoutForTimeline(this.selectedLayoutId);
            selectedLayoutProfile = layouts[0];
        } else {
            // Multiple layouts — dropdown
            const ddContainer = this.layoutContainerEl.createDiv({ cls: 'ert-manuscript-input-container' });
            const dd = new DropdownComponent(ddContainer);
            dd.selectEl.addClass('ert-input', 'ert-input--full');
            for (const l of layouts) {
                dd.addOption(l.id, this.formatTemplateProfileNameForDropdown(l) || l.name);
                const option = dd.selectEl.querySelector<HTMLOptionElement>(`option[value="${CSS.escape(l.id)}"]`);
                if (option) {
                    option.setAttribute('aria-label', l.name);
                }
            }
            const hasTemplateSelection = activeProfileId && layouts.some(l => l.id === activeProfileId);
            const defaultId = hasTemplateSelection
                ? activeProfileId
                : layouts[0].id;
            dd.setValue(defaultId);
            this.selectedLayoutId = defaultId;
            void this.rememberSelectedLayoutForTimeline(defaultId);
            selectedLayoutProfile = layouts.find(l => l.id === defaultId);
            dd.onChange((val) => {
                this.selectedLayoutId = val;
                void this.rememberSelectedLayoutForTimeline(val);
                if (this.selectedExportProfile) {
                    this.selectedExportProfile = { ...this.selectedExportProfile, templateProfileId: val, selectedLayoutId: val };
                    this.selectedExportProfileId = this.selectedExportProfile.id;
                }
                const selected = layouts.find(l => l.id === val);
                this.renderLayoutDescription(selected);
                this.updateExportProfileSummary();
                this.updateTemplateWarning();
                this.updateTemplateActionButtonState();
                // Switching templates after a successful export must restore the
                // pre-export footer (Generate PDF + Cancel) so the user can
                // re-export with the new template without closing the modal.
                // applyTemplate() does this for saved-preset switches; the layout
                // dropdown is the other entry point and was missing the call.
                this.syncExportUi();
            });
        }

        this.renderLayoutDescription(selectedLayoutProfile);

    }

    private renderLayoutDescription(profile?: TemplateProfile): void {
        if (!this.layoutContainerEl) return;
        this.layoutContainerEl.querySelector('.ert-manuscript-layout-desc')?.remove();
        const desc = this.layoutContainerEl.createDiv({ cls: 'ert-manuscript-layout-desc ert-manuscript-layout-preview' });
        if (!profile) {
            desc.createDiv({ cls: 'ert-manuscript-layout-summary-detail', text: t('ui.manuscriptOptionsModal.choosePdfLayout') });
            return;
        }
        const sourceLayout = this.findLayoutForTemplateProfile(profile);
        const variant = getFictionVariantForLayout(sourceLayout);
        const summary = desc.createDiv({ cls: 'ert-manuscript-layout-summary' });
        const titleRow = summary.createDiv({ cls: 'ert-manuscript-layout-summary-titleRow' });
        if (sourceLayout && getPandocLayoutTier(sourceLayout) === 'pro') {
            const proPill = titleRow.createSpan({
                cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ${ERT_CLASSES.BADGE_PILL_PRO} ert-pro-pill`,
            });
            proPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: t('ui.manuscriptOptionsModal.proPill') });
        }
        titleRow.createDiv({
            cls: 'ert-manuscript-layout-summary-title',
            text: profile.name,
        });
        summary.createDiv({
            cls: 'ert-manuscript-layout-summary-detail',
            text: this.getTemplateProfileSummary(profile),
        });

        if (variant !== 'generic') {
            const ctx = this.buildSpreadValidationContext(sourceLayout);
            renderModalLayoutPreview(
                desc,
                variant,
                this.resolveActiveSceneHeadingMode(sourceLayout),
                ctx,
                sourceLayout,
                sourceLayout?.hasSceneOpenerHeadingOptions
                    ? (sceneHeadingMode) => {
                        void this.setActiveSceneHeadingMode(sourceLayout, sceneHeadingMode, profile);
                    }
                    : undefined
            );
        }
    }

    private resolveActiveSceneHeadingMode(layout?: PandocLayoutTemplate): ManuscriptSceneHeadingMode | undefined {
        if (!layout) return undefined;
        const activeBook = this.getSourceBook();
        const mode = activeBook?.layoutOptions?.[layout.id]?.sceneHeadingMode;
        return mode === 'scene-number' || mode === 'scene-number-title' || mode === 'title-only'
            ? mode
            : 'scene-number-title';
    }

    private getActiveBookReference(): BookProfile | null {
        const active = this.getSourceBook();
        if (!active) return null;
        const index = (this.plugin.settings.books || []).findIndex(book => book.id === active.id);
        return index >= 0 ? this.plugin.settings.books[index] : null;
    }

    private async rememberSelectedLayoutForTimeline(layoutId?: string): Promise<void> {
        if (!layoutId || this.manuscriptPreset !== 'novel') return;
        const activeBook = this.getActiveBookReference();
        if (!activeBook) return;
        if (!activeBook.lastUsedPandocLayoutByPreset) {
            activeBook.lastUsedPandocLayoutByPreset = {};
        }
        if (activeBook.lastUsedPandocLayoutByPreset.novel === layoutId) return;
        activeBook.lastUsedPandocLayoutByPreset.novel = layoutId;
        await this.plugin.saveSettings();
        this.plugin.refreshTimelineIfNeeded(null);
    }

    private async setActiveSceneHeadingMode(
        layout: PandocLayoutTemplate,
        sceneHeadingMode: ManuscriptSceneHeadingMode,
        profile: TemplateProfile
    ): Promise<void> {
        const activeBook = this.getActiveBookReference();
        if (!activeBook) return;

        if (!activeBook.layoutOptions) activeBook.layoutOptions = {};
        const scoped = activeBook.layoutOptions[layout.id] || {};
        const next = { ...scoped };

        if (sceneHeadingMode === 'scene-number-title') {
            delete next.sceneHeadingMode;
        } else {
            next.sceneHeadingMode = sceneHeadingMode;
        }

        const hasEpigraphText = (next.partEpigraphs || []).some(value => value.trim().length > 0);
        const hasAttributionText = (next.partEpigraphAttributions || []).some(value => value.trim().length > 0);
        if (!next.sceneHeadingMode && !hasEpigraphText && !hasAttributionText) {
            delete activeBook.layoutOptions[layout.id];
            if (Object.keys(activeBook.layoutOptions).length === 0) {
                delete activeBook.layoutOptions;
            }
        } else {
            activeBook.layoutOptions[layout.id] = next;
        }

        await this.plugin.saveSettings();
        this.renderLayoutDescription(profile);
        this.updateExportProfileSummary();
        this.updateTemplateWarning();
        this.updateTemplateActionButtonState();
    }

    private findLayoutForTemplateProfile(profile?: TemplateProfile): PandocLayoutTemplate | undefined {
        if (!profile) return undefined;
        return this.plugin.settings.pandocLayouts?.find(layout => layout.id === profile.legacyLayoutId || layout.id === profile.id);
    }

    private formatTemplateProfileName(profile?: TemplateProfile): string | undefined {
        if (!profile) return undefined;
        return profile.name;
    }

    private formatTemplateProfileNameForDropdown(profile?: TemplateProfile): string | undefined {
        if (!profile) return undefined;
        return profile.name;
    }

    private getTemplateProfileSummary(profile: TemplateProfile): string {
        const sourceLayout = this.findLayoutForTemplateProfile(profile);
        if (sourceLayout?.usesModernClassicStructure) {
            return t('ui.manuscriptOptionsModal.layoutSummaryBook');
        }
        if (sourceLayout?.hasSceneOpenerHeadingOptions) {
            return t('ui.manuscriptOptionsModal.layoutSummaryLiterary');
        }
        if (profile.id === 'bundled-fiction-contemporary-literary') {
            return t('ui.manuscriptOptionsModal.layoutSummaryReadingDraft');
        }
        return t('ui.manuscriptOptionsModal.layoutSummaryManuscript');
    }

    private formatTemplateIdName(templateId: string, fallbackName: string): string {
        const profile = this.templateProfiles.find(item => item.id === templateId || item.legacyLayoutId === templateId);
        return this.formatTemplateProfileName(profile) || fallbackName;
    }

    private getRttsLevelLabel(level: NonNullable<PublishingValidationSnapshot['templateCompatibility']>['level']): string {
        switch (level) {
            case 'invalid':
                return t('ui.manuscriptOptionsModal.rttsInvalid');
            case 'compatible':
                return t('ui.manuscriptOptionsModal.rttsCompatible');
            case 'legacy':
            default:
                return t('ui.manuscriptOptionsModal.rttsLegacy');
        }
    }

    private formatCompatibilityIssue(issue: NonNullable<PublishingValidationSnapshot['templateCompatibilityIssues']>[number]): string {
        const vars = { message: issue.message };
        return issue.level === 'error'
            ? t('ui.manuscriptOptionsModal.techCompatibilityError', vars)
            : issue.level === 'warning'
                ? t('ui.manuscriptOptionsModal.techCompatibilityWarning', vars)
                : t('ui.manuscriptOptionsModal.techCompatibilityInfo', vars);
    }

    private collectTemplateTechnicalLines(): string[] {
        const lines: string[] = [];
        const compatibility = this.validationSnapshot?.templateCompatibility;
        if (compatibility) {
            lines.push(t('ui.manuscriptOptionsModal.techTemplate', { name: this.formatTemplateIdName(compatibility.templateId, compatibility.templateName) }));
            lines.push(t('ui.manuscriptOptionsModal.techRttsLevel', { level: this.getRttsLevelLabel(compatibility.level) }));
            lines.push(compatibility.variables.hasBody ? t('ui.manuscriptOptionsModal.techBodyReady') : t('ui.manuscriptOptionsModal.techBodyMissing'));
            lines.push(compatibility.variables.hasTitle ? t('ui.manuscriptOptionsModal.techTitleAvailable') : t('ui.manuscriptOptionsModal.techTitleNotExposed'));
            lines.push(compatibility.variables.hasAuthor ? t('ui.manuscriptOptionsModal.techAuthorAvailable') : t('ui.manuscriptOptionsModal.techAuthorNotExposed'));
            for (const [hook, present] of Object.entries(compatibility.variables.hooks)) {
                lines.push(present
                    ? t('ui.manuscriptOptionsModal.techHookAvailable', { hook })
                    : t('ui.manuscriptOptionsModal.techHookNotExposed', { hook }));
            }
        }
        for (const issue of this.validationSnapshot?.templateCompatibilityIssues || []) {
            lines.push(this.formatCompatibilityIssue(issue));
        }
        return lines;
    }

    private ensureBundledFontsForLayout(layout: PandocLayoutTemplate, state: string): void {
        if (!layout.bundled || state !== 'missing-bundled') return;
        if (this.bundledFontInstallAttempted.has(layout.id)) return;
        this.bundledFontInstallAttempted.add(layout.id);

        void ensureBundledLayoutInstalledForExport(this.plugin, layout).then(() => {
            if (
                this.selectedLayoutId === layout.id
                && this.exportType === 'manuscript'
                && this.outputFormat === 'pdf'
            ) {
                this.updateTemplateWarning();
            }
        });
    }

    /**
     * Update PDF Output summary based on current preset and format
     */
    private updateTemplateWarning(): void {
        if (!this.templateWarningEl || this.exportType !== 'manuscript') {
            if (this.templateWarningEl) {
                this.templateWarningEl.empty();
                this.templateWarningEl.addClass('ert-manuscript-preset-status--hidden');
            }
            return;
        }

        this.templateWarningEl.empty();
        this.templateWarningEl.removeClass('ert-warning-error');
        this.templateWarningEl.removeClass('ert-warning-warning');
        this.templateWarningEl.removeClass('ert-warning-info');
        this.templateWarningEl.removeClass('ert-pdf-output-summary');
        this.templateWarningEl.removeClass('ert-pdf-output-summary--compact');
        this.templateWarningEl.removeClass('ert-pdf-output-summary--ready');

        // Only check templates for PDF format — markdown and Word need no
        // LaTeX layout, so template/font validation must not block them.
        if (this.outputFormat !== 'pdf') {
            this.templateWarningEl.addClass('ert-manuscript-preset-status--hidden');
            return;
        }
        this.templateWarningEl.removeClass('ert-manuscript-preset-status--hidden');
        this.refreshValidationSnapshot();

        // ── Profile-aware validation ──────────────────────────────────
        const layouts = this.templateProfiles.filter(profile => profile.usageContexts.includes(this.manuscriptPreset));

        if (layouts.length === 0) {
            // No layouts for this preset — the layout picker already shows the empty state
            return;
        }

        const selectedProfile = this.selectedLayoutId
            ? layouts.find(profile => profile.id === this.selectedLayoutId || profile.legacyLayoutId === this.selectedLayoutId)
            : this.selectedExportProfile?.templateProfileId
                ? layouts.find(profile => profile.id === this.selectedExportProfile?.templateProfileId)
            : layouts[0];

        const selectedLayout = this.findLayoutForTemplateProfile(selectedProfile);

        if (!selectedProfile || !selectedLayout) return;

        const validation = validatePandocLayout(this.plugin, selectedLayout);
        const compatibilityIssues = this.validationSnapshot?.templateCompatibilityIssues || [];
        const hasCompatibilityError = compatibilityIssues.some(issue => issue.level === 'error');
        const hasCompatibilityWarning = compatibilityIssues.some(issue => issue.level === 'warning');

        if (!validation.valid) {
            this.templateWarningEl.addClass('ert-pdf-output-summary');
            this.templateWarningEl.addClass('ert-warning-error');
            const icon = this.templateWarningEl.createSpan({ cls: 'ert-warning-icon' });
            setIcon(icon, 'alert-circle');
            const text = this.templateWarningEl.createDiv({ cls: 'ert-pdf-output-text' });
            text.createDiv({ cls: 'ert-pdf-output-title', text: t('ui.manuscriptOptionsModal.pdfOutput') });
            text.createDiv({ cls: 'ert-pdf-output-line', text: validation.error || t('ui.manuscriptOptionsModal.layoutTemplateNotFound') });
            return;
        }

        const templatePath = resolveTemplatePath(this.plugin, selectedLayout.path);
        const engineSelection = getAutoPdfEngineSelection(templatePath);
        const fontDiagnostics = getTemplateFontDiagnostics(templatePath);
        const canVerifyFonts = fontDiagnostics.canVerifySystemFonts;
        // Structured, spec-driven diagnostic. When the layout carries a spec
        // (bundled fiction or `origin === 'designed'`) this is the
        // authoritative font-state summary — it correctly handles the Latin
        // Modern (lmodern) and bundled-Sorts-Mill-Goudy special cases.
        const structuredFontDiag = getStructuredFontDiagnostic(selectedLayout);
        this.ensureBundledFontsForLayout(selectedLayout, structuredFontDiag.state);
        const primaryRequested = fontDiagnostics.optionalFonts[0] || fontDiagnostics.requiredFonts[0] || null;
        const hasPrimaryMissing = canVerifyFonts && primaryRequested
            ? fontDiagnostics.missingOptionalFonts.includes(primaryRequested) || fontDiagnostics.missingRequiredFonts.includes(primaryRequested)
            : false;
        const fallbackFont = canVerifyFonts
            ? fontDiagnostics.requiredFonts.find(font => !fontDiagnostics.missingRequiredFonts.includes(font)) || null
            : null;
        // When the layout has a spec, the structured diagnostic is the ONLY
        // voice. The legacy probe scans the .tex for font names and asks the OS
        // whether each is installed system-wide — a question that stopped
        // mattering once bundled fonts load from the vault via `Path =`. Left
        // ungated it reports "Source Serif 4 is not installed" immediately
        // after that font was installed successfully, contradicting the
        // structured verdict in the same panel.
        const useLegacyFontProbe = !structuredFontDiag.specDriven;
        const hasFontRisk = structuredFontDiag.state !== 'ok'
            || (useLegacyFontProbe && canVerifyFonts
                && (fontDiagnostics.missingRequiredFonts.length > 0 || hasPrimaryMissing));

        // ── Build user-facing summary ────────────────────────────────
        const displayRequestedFont = primaryRequested || structuredFontDiag.primaryFontName || null;
        // A spec-driven verdict already names the font XeLaTeX will load, from
        // whichever tier resolved it. Routing it through buildFontDisplayName
        // would re-ask the system-font question and append "(not found)" to a
        // font that resolves perfectly well from the vault or the TeX tree.
        const resolvedFont = structuredFontDiag.specDriven && structuredFontDiag.resolvedFontName
            ? structuredFontDiag.resolvedFontName
            : this.buildFontDisplayName(displayRequestedFont, canVerifyFonts, hasPrimaryMissing, fallbackFont);
        const fontSummaryLine = t('ui.manuscriptOptionsModal.fontSummary', { font: displayRequestedFont || resolvedFont || t('ui.manuscriptOptionsModal.defaultSerif') });
        const layoutDesc = this.formatTemplateProfileName(selectedProfile) || selectedLayout.name || t('ui.manuscriptOptionsModal.customLayout');
        const willEmbed = fontDiagnostics.usesFontspec;

        // ── Build technical details (hidden by default) ──────────────
        const technicalLines: string[] = [];
        if (displayRequestedFont) {
            const requestedType = this.getFontFamilyType(displayRequestedFont);
            technicalLines.push(t('ui.manuscriptOptionsModal.techRequestedFont', { font: displayRequestedFont, type: requestedType }));
        }
        if (useLegacyFontProbe && hasPrimaryMissing && fallbackFont && fallbackFont !== primaryRequested) {
            const fallbackType = this.getFontFamilyType(fallbackFont);
            technicalLines.push(t('ui.manuscriptOptionsModal.techFallbackFont', { font: fallbackFont, type: fallbackType }));
        }
        technicalLines.push(t('ui.manuscriptOptionsModal.techEngine', { engine: engineSelection.engine }));
        if (willEmbed) {
            technicalLines.push(t('ui.manuscriptOptionsModal.techFontEmbedding'));
        }
        technicalLines.push(t('ui.manuscriptOptionsModal.techResolvedFont', { font: resolvedFont }));
        technicalLines.push(t('ui.manuscriptOptionsModal.techPageLayout', { layout: layoutDesc }));
        technicalLines.push(...this.collectTemplateTechnicalLines());

        // ── Spread-validation warnings + statuses ─────────────────────
        // Run the same validation pass the preview cards use, then collect
        // distinct warning tooltips so each unique advisory surfaces as a
        // line item below. Statuses are informational counts that always
        // render (even in "Ready"). Warnings are non-blocking — Generate
        // stays enabled regardless.
        const spreadVariant = getFictionVariantForLayout(selectedLayout);
        let spreadWarningTooltips: string[] = [];
        let spreadStatuses: SpreadStatus[] = [];
        if (spreadVariant !== 'generic') {
            const spreadCtx = this.buildSpreadValidationContext(selectedLayout);
            const validatedRows = applySpreadValidation(
                getLayoutPictogramRows(spreadVariant, selectedLayout),
                spreadCtx,
            );
            spreadWarningTooltips = collectSpreadWarningTooltips(validatedRows);
            spreadStatuses = collectSpreadStatuses(validatedRows, spreadCtx);
        }
        const hasSpreadWarning = spreadWarningTooltips.length > 0;

        // ── Severity classification ─────────────────────────────────
        // Three-state model for the export-checks panel:
        //   error   → blocking, red, alert-circle
        //   warning → non-blocking warning, orange, alert-triangle
        //   ready   → everything passes, green, check-circle-2 (compact form)
        const hasError = hasCompatibilityError || hasFontRisk;
        const hasWarning = !hasError && (hasCompatibilityWarning || hasSpreadWarning);
        const isReady = !hasError && !hasWarning;

        // ── Render ───────────────────────────────────────────────────
        this.templateWarningEl.addClass('ert-pdf-output-summary');
        this.templateWarningEl.addClass('ert-pdf-output-summary--compact');
        // Both branches below put the icon inline in the title row; the panel
        // modifier lets pulse.css widen the content block without :has().
        this.templateWarningEl.addClass('ert-pdf-output-summary--inline-icon');
        if (isReady) {
            this.templateWarningEl.addClass('ert-pdf-output-summary--ready');
        }
        this.templateWarningEl.addClass(
            hasError ? 'ert-warning-error'
            : hasWarning ? 'ert-warning-warning'
            : 'ert-warning-info'
        );
        // Icon now lives inline with the title row (inside the content block)
        // instead of as a left-rail sibling. This frees the technical-details
        // list to use the full panel width — important because the details
        // contain long lines like "$frontmatter_acknowledgments$: Not exposed"
        // that wrap awkwardly in a narrow column.
        const iconName = hasError ? 'alert-circle'
            : hasWarning ? 'alert-triangle'
            : 'check-circle-2';

        const content = this.templateWarningEl.createDiv({ cls: 'ert-pdf-output-text' });

        if (isReady) {
            // ── Compact ready form ───────────────────────────────────
            // Single row: small label "Export checks · Ready". No verbose
            // ACCESS / COMPATIBILITY rows (irrelevant when nothing is wrong).
            // Technical details remain available behind the expander for
            // power users who want to inspect the underlying state.
            const readyLine = content.createDiv({ cls: 'ert-pdf-output-ready-line' });
            const readyIcon = readyLine.createSpan({ cls: 'ert-warning-icon ert-warning-icon--inline' });
            setIcon(readyIcon, iconName);
            readyLine.createSpan({ text: t('ui.manuscriptOptionsModal.styleChecksReady') });
            content.createDiv({
                cls: 'ert-pdf-output-line is-status is-status-info',
                text: fontSummaryLine,
            });
            // Informational status rows (non-alarmist counts) — always render
            // even in Ready state. Visually distinct from warnings via the
            // is-status modifier on the existing line class.
            for (const status of spreadStatuses) {
                content.createDiv({
                    cls: `ert-pdf-output-line is-status is-status-${status.tone}`,
                    text: status.text,
                });
            }
            if (technicalLines.length > 0) {
                const details = content.createEl('details', { cls: 'ert-pdf-output-details' });
                details.createEl('summary', { text: t('ui.manuscriptOptionsModal.viewTechnicalDetails') });
                const detailsContent = details.createDiv({ cls: 'ert-pdf-output-details-content' });
                for (const line of technicalLines) {
                    detailsContent.createDiv({ text: line });
                }
            }
            return;
        }

        // ── Warning / error form ─────────────────────────────────
        const titleRow = content.createDiv({ cls: 'ert-pdf-output-title' });
        const titleIcon = titleRow.createSpan({ cls: 'ert-warning-icon ert-warning-icon--inline' });
        setIcon(titleIcon, iconName);
        titleRow.createSpan({ text: t('ui.manuscriptOptionsModal.styleChecks') });
        content.createDiv({
            cls: 'ert-pdf-output-line is-status is-status-info',
            text: fontSummaryLine,
        });

        if (hasCompatibilityError) {
            const firstError = compatibilityIssues.find(issue => issue.level === 'error');
            content.createDiv({
                cls: 'ert-pdf-output-line',
                text: firstError?.message
            });
        } else if (hasFontRisk) {
            // Prefer the structured (spec-driven) diagnostic — it correctly
            // models exact required fonts vs missing bundled assets and carries
            // an install hint with a URL where applicable.
            if (structuredFontDiag.state !== 'ok') {
                const line = content.createDiv({ cls: 'ert-pdf-output-line' });
                if (structuredFontDiag.state === 'missing-bundled') {
                    line.appendText(
                        structuredFontDiag.installHint?.message
                        || t('ui.manuscriptOptionsModal.bundledFontsMissing')
                    );
                } else {
                    // Missing system font — render the required-font message,
                    // followed by the OS-tailored install hint, an inline
                    // download link when applicable, and short install steps.
                    const primaryName = structuredFontDiag.primaryFontName;
                    line.appendText(t('ui.manuscriptOptionsModal.fontNotInstalled', { font: primaryName }));
                    const hint = structuredFontDiag.installHint;
                    if (hint) {
                        const hintLine = content.createDiv({ cls: 'ert-pdf-output-line' });
                        hintLine.appendText(`${hint.message} `);
                        if (hint.url) {
                            const a = hintLine.createEl('a', {
                                cls: 'ert-link-accent',
                                text: t('ui.manuscriptOptionsModal.openGoogleFonts'),
                            });
                            a.setAttribute('href', hint.url);
                            a.setAttribute('target', '_blank');
                            a.setAttribute('rel', 'noopener');
                        }
                        if (hint.steps && hint.steps.length > 0) {
                            const list = content.createEl('ul', { cls: 'ert-pdf-output-steps' });
                            for (const step of hint.steps) {
                                list.createEl('li', {
                                    cls: 'ert-pdf-output-line is-status',
                                    text: step,
                                });
                            }
                        }
                    }
                }
            } else if (useLegacyFontProbe && hasPrimaryMissing && fallbackFont && fallbackFont !== primaryRequested) {
                // Legacy fallback path — layout has no spec, so we lean on
                // the template-scan diagnostic for the message text.
                content.createDiv({
                    cls: 'ert-pdf-output-line',
                    text: t('ui.manuscriptOptionsModal.fontUsingFallback', { fallback: fallbackFont, font: String(primaryRequested) })
                });
            } else if (useLegacyFontProbe && hasPrimaryMissing && primaryRequested) {
                content.createDiv({
                    cls: 'ert-pdf-output-line',
                    text: t('ui.manuscriptOptionsModal.fontNotInstalled', { font: primaryRequested })
                });
            }
        } else if (hasCompatibilityWarning) {
            const firstWarning = compatibilityIssues.find(issue => issue.level === 'warning');
            content.createDiv({
                cls: 'ert-pdf-output-line',
                text: firstWarning?.message
            });
        }

        // Spread-validation advisories (non-blocking). Surfaced as additional
        // line items so a user with font risk + a missing-Acts spread sees
        // both. Order follows the canonical row iteration; tooltips are
        // already deduped by collectSpreadWarningTooltips.
        for (const tooltip of spreadWarningTooltips) {
            content.createDiv({ cls: 'ert-pdf-output-line', text: tooltip });
        }

        // Informational status rows (non-alarmist counts). Render in any
        // state, including alongside warnings, so a user with one warning
        // and one fully-populated feature sees both.
        for (const status of spreadStatuses) {
            content.createDiv({
                cls: `ert-pdf-output-line is-status is-status-${status.tone}`,
                text: status.text,
            });
        }

        // ACCESS / COMPATIBILITY status rows are intentionally omitted —
        // tier and template-flow are inferred from the layout selection
        // itself. This panel surfaces only actionable problems.

        // ── Technical details toggle ─────────────────────────────────
        if (technicalLines.length > 0) {
            const details = content.createEl('details', { cls: 'ert-pdf-output-details' });
            details.createEl('summary', { text: t('ui.manuscriptOptionsModal.viewTechnicalDetails') });
            const detailsContent = details.createDiv({ cls: 'ert-pdf-output-details-content' });
            for (const line of technicalLines) {
                detailsContent.createDiv({ text: line });
            }
        }

        // Re-evaluate action-button disabled state — the font-block flag may
        // have flipped this render. Cheap idempotent call when nothing changed.
        this.updateActionButtonDisabledState();
    }

    /**
     * Build a human-readable font name for the PDF Output summary
     */
    private buildFontDisplayName(
        primaryRequested: string | null,
        canVerifyFonts: boolean,
        hasPrimaryMissing: boolean,
        fallbackFont: string | null
    ): string {
        if (!primaryRequested) return t('ui.manuscriptOptionsModal.defaultSerif');
        if (!canVerifyFonts) return primaryRequested;
        if (hasPrimaryMissing && fallbackFont && fallbackFont !== primaryRequested) return fallbackFont;
        if (hasPrimaryMissing) return t('ui.manuscriptOptionsModal.fontNotFound', { font: primaryRequested });
        return primaryRequested;
    }

    /**
     * Update manuscript preset description
     */
    private updateManuscriptPresetDescription(): void {
        if (!this.manuscriptPresetDescEl) return;
        this.manuscriptPresetDescEl.textContent = t('manuscriptModal.presetNovelDesc');
    }

    /**
     * Update outline preset description
     */
    private updateOutlinePresetDescription(): void {
        if (!this.outlinePresetDescEl) return;
        const descriptions: Record<OutlinePreset, string> = {
            'beat-sheet': t('manuscriptModal.outlineBeatSheetDesc'),
            'episode-rundown': t('manuscriptModal.outlineEpisodeRundownDesc'),
            'shooting-schedule': t('manuscriptModal.outlineShootingScheduleDesc'),
            'index-cards-csv': t('manuscriptModal.outlineIndexCardsDesc'),
            'index-cards-json': t('manuscriptModal.outlineIndexCardsDesc')
        };
        this.outlinePresetDescEl.textContent = descriptions[this.outlinePreset] || '';
    }

    private updateOrderPillsState(): void {
        const disableChronological = !this.hasWhenDates;

        this.orderPills.forEach(p => {
            const isChronological = p.order === 'chronological' || p.order === 'reverse-chronological';
            const btn = p.el as HTMLButtonElement;
            if (isChronological && disableChronological) {
                btn.disabled = true;
                btn.removeClass('is-active');
            } else {
                btn.disabled = false;
            }
            btn.toggleClass('is-active', this.order === p.order && !(isChronological && disableChronological));
        });

        if (disableChronological && (this.order === 'chronological' || this.order === 'reverse-chronological')) {
            this.order = 'narrative';
            this.orderPills.forEach(p => p.el.toggleClass('is-active', p.order === this.order));
        }
    }

    private getSelectedSceneCount(): number {
        if (this.totalScenes === 0) return 0;
        return Math.max(0, this.rangeEnd - this.rangeStart + 1);
    }

    private getSelectedSceneTitles(): string[] {
        if (this.totalScenes === 0 || this.sceneTitles.length === 0) return [];
        const startIndex = Math.max(0, this.rangeStart - 1);
        const endIndexExclusive = Math.min(this.rangeEnd, this.sceneTitles.length);
        if (endIndexExclusive <= startIndex) return [];
        return this.sceneTitles.slice(startIndex, endIndexExclusive);
    }

    private getSelectedWordCount(): number {
        if (this.totalScenes === 0 || this.sceneWordCounts.length === 0) return 0;
        const startIndex = Math.max(0, this.rangeStart - 1);
        const endIndexExclusive = Math.min(this.rangeEnd, this.sceneWordCounts.length);
        if (endIndexExclusive <= startIndex) return 0;
        return this.sceneWordCounts
            .slice(startIndex, endIndexExclusive)
            .reduce<number>((sum, count) => sum + (typeof count === 'number' && Number.isFinite(count) ? count : 0), 0);
    }

    private getSelectedScenePaths(): string[] {
        if (this.totalScenes === 0 || this.scenePaths.length === 0) return [];
        const startIndex = Math.max(0, this.rangeStart - 1);
        const endIndexExclusive = Math.min(this.rangeEnd, this.scenePaths.length);
        if (endIndexExclusive <= startIndex) return [];
        return this.scenePaths.slice(startIndex, endIndexExclusive);
    }

    /**
     * Build a SpreadValidationContext for the current scene selection +
     * supplied layout. Delegates to the shared helper so the Settings → Publish
     * preview computes warnings from the same logic.
     */
    private buildSpreadValidationContext(layout?: PandocLayoutTemplate): SpreadValidationContext {
        const startIndex = Math.max(0, this.rangeStart - 1);
        const endIndexExclusive = Math.min(this.rangeEnd, this.totalScenes);
        const slice = <T>(arr: T[]): T[] => (
            this.totalScenes === 0 || arr.length === 0 || endIndexExclusive <= startIndex
                ? []
                : arr.slice(startIndex, Math.min(endIndexExclusive, arr.length))
        );
        return buildSpreadValidationContext(this.plugin, {
            layout,
            selectedScenePaths: slice(this.scenePaths),
            selectedSceneTitles: slice(this.sceneTitles),
            chapterMarkersByScenePath: this.chapterMarkersByScenePath,
        });
    }

    private isSplitEnabled(): boolean {
        return this.splitMode === 'parts';
    }

    private isSplitSelectionValid(): boolean {
        if (!this.isSplitEnabled()) return true;
        const selectedCount = this.getSelectedSceneCount();
        return selectedCount >= this.splitParts;
    }

    private getPlannedOutputCount(): number {
        return this.isSplitEnabled() ? this.splitParts : 1;
    }

    private updateActionButtonDisabledState(): void {
        if (!this.actionButton || this.exportCompleted) return;
        const splitInvalid = !this.isSplitSelectionValid();
        this.actionButton.setDisabled(
            this.exportInFlight || this.proofLoading || this.sourceLoading || this.sourceSaving || !!this.sourceError || !!this.destinationError || !this.sourceReviewed || this.totalScenes === 0 || splitInvalid || this.exportBlocked
        );
    }

    /**
     * Restore the modal's pre-export footer (Generate PDF + Cancel) and clear
     * the success-state buttons + outcome banner. Called by `syncExportUi` when
     * the user changes a setting after a completed export, so they can re-export
     * with the new settings without closing the modal first.
     */
    private resetPostExportState(): void {
        this.exportCompleted = false;
        this.lastOutcome = null;
        this.outputStatusEl?.addClass('ert-hidden');
        this.openFolderButton?.buttonEl.addClass('ert-hidden');
        this.openFileButton?.buttonEl.addClass('ert-hidden');
        this.cancelButton?.buttonEl.removeClass('ert-hidden');
        this.updateActionButtonLabel();
        this.updateActionButtonDisabledState();
    }

    private updateSplitUi(): void {
        const selectedCount = this.getSelectedSceneCount();
        const canSplit = selectedCount >= 2;

        if (!canSplit && this.splitMode === 'parts') {
            this.splitMode = 'single';
        }

        if (this.splitSingleInputEl) this.splitSingleInputEl.checked = this.splitMode === 'single';
        if (this.splitPartsRadioInputEl) {
            this.splitPartsRadioInputEl.checked = this.splitMode === 'parts';
            this.splitPartsRadioInputEl.disabled = !canSplit;
        }
        if (this.splitPartsInputEl) {
            this.splitPartsInputEl.disabled = !canSplit;
            this.splitPartsInputEl.value = String(this.splitParts);
        }

        const partsEnabled = this.splitMode === 'parts';
        this.splitPartsContainerEl?.toggleClass('ert-hidden', !partsEnabled);
        this.splitHelperEl?.toggleClass('ert-hidden', !partsEnabled);

        const splitInvalid = partsEnabled && !this.isSplitSelectionValid();
        if (this.splitErrorEl) {
            if (splitInvalid) {
                this.splitErrorEl.setText(t('ui.manuscriptOptionsModal.notEnoughScenesToSplit', { parts: this.splitParts }));
                this.splitErrorEl.removeClass('ert-hidden');
            } else {
                this.splitErrorEl.addClass('ert-hidden');
            }
        }

        if (this.splitPreviewEl) {
            this.splitPreviewEl.empty();
            if (partsEnabled && !splitInvalid) {
                const items = Array.from({ length: selectedCount }, (_unused, index) => index + 1);
                const preview = chunkScenesIntoParts(items, this.splitParts);
                this.splitPreviewEl.createDiv({ text: t('ui.manuscriptOptionsModal.willGenerateFiles', { count: this.splitParts }) });
                preview.ranges.forEach(range => {
                    const globalStartPosition = this.rangeStart + range.start - 1;
                    const globalEndPosition = this.rangeStart + range.end - 1;
                    const displayStart = this.getSceneNumberAt(globalStartPosition);
                    const displayEnd = this.getSceneNumberAt(globalEndPosition);
                    this.splitPreviewEl?.createDiv({
                        cls: 'ert-sub-card-note',
                        text: t('ui.manuscriptOptionsModal.splitPartRange', { part: range.part, start: displayStart, end: displayEnd })
                    });
                });
            }
        }

        this.updateActionButtonLabel();
        this.updateActionButtonDisabledState();
        this.updateTemplateActionButtonState();
    }

    private getPrimaryActionLabel(): string {
        if (this.exportCompleted) return t('ui.manuscriptOptionsModal.close');
        const mode = this.getUiMode();
        const base = mode.isOutline
            ? t('ui.manuscriptOptionsModal.generateOutline')
            : mode.isPdfManuscript
                ? t('ui.manuscriptOptionsModal.generatePdf')
                : mode.isDocxManuscript
                    ? t('ui.manuscriptOptionsModal.generateWord')
                    : t('ui.manuscriptOptionsModal.generateMarkdown');
        const files = mode.showSplit ? this.getPlannedOutputCount() : 1;
        return files > 1 ? t('ui.manuscriptOptionsModal.generateWithFiles', { action: base, count: files }) : base;
    }

    private getOpenFolderButtonLabel(): string {
        if (Platform?.isMacOS) return t('ui.manuscriptOptionsModal.revealInFinder');
        if (Platform?.isWin) return t('ui.manuscriptOptionsModal.openInExplorer');
        return t('ui.manuscriptOptionsModal.openFolder');
    }

    private updateActionButtonLabel(): void {
        this.actionButton?.setButtonText(this.getPrimaryActionLabel());
        if (this.exportCompleted) {
            this.actionButton?.removeCta();
            this.openFileButton?.setCta();
        } else {
            this.actionButton?.setCta();
            this.openFileButton?.removeCta();
        }
    }

    private renderStatusPathGroup(label: string, paths: string[]): void {
        if (!this.outputStatusEl || paths.length === 0) return;
        const group = this.outputStatusEl.createDiv();
        group.createDiv({ text: t('ui.manuscriptOptionsModal.statusPathGroup', { label, files: tCount('file', paths.length) }) });
        for (const path of paths) {
            const row = group.createDiv();
            const link = row.createEl('a', { text: path, attr: { href: '#' } });
            link.addEventListener('click', event => {
                event.preventDefault();
                void this.openVaultPath(path);
            });
        }
    }

    private showOutputStatus(outcome: ManuscriptExportOutcome): void {
        if (!this.outputStatusEl) return;
        this.outputStatusEl.empty();
        const savedPaths = outcome.savedPaths && outcome.savedPaths.length > 0
            ? outcome.savedPaths
            : outcome.savedPath ? [outcome.savedPath] : [];
        const renderedPaths = outcome.renderedPaths && outcome.renderedPaths.length > 0
            ? outcome.renderedPaths
            : outcome.renderedPath ? [outcome.renderedPath] : [];

        this.renderStatusPathGroup(t('ui.manuscriptOptionsModal.statusSaved'), savedPaths);
        this.renderStatusPathGroup(t('ui.manuscriptOptionsModal.statusRendered'), renderedPaths);
        if (outcome.delivery) this.renderDeliveryStatus(outcome.delivery);
        if (outcome.messages && outcome.messages.length > 0) {
            outcome.messages.forEach(message => {
                this.outputStatusEl?.createDiv({ text: message });
            });
        }
        this.outputStatusEl.toggleClass('ert-hidden', savedPaths.length === 0 && renderedPaths.length === 0 && !(outcome.messages && outcome.messages.length > 0));
    }

    private renderDestination(parent: HTMLElement): void {
        const card = parent.createDiv({ cls: 'ert-panel ert-stack ert-export-destination' });
        card.createEl('h4', { cls: 'ert-section-title', text: t('ui.manuscriptOptionsModal.destination') });
        const label = card.createEl('label', { cls: 'ert-row ert-manuscript-source-field' });
        label.createSpan({ text: t('ui.manuscriptOptionsModal.vaultFolder') });
        const input = label.createEl('input', { cls: 'ert-input', attr: { type: 'text', 'aria-label': t('ui.manuscriptOptionsModal.exportDestinationAria') } });
        input.value = this.destination;
        this.destinationInput = input;
        const choose = (value: string) => { this.destination = value; this.updateDestinationUi(); this.syncExportUi(); };
        input.addEventListener('input', () => choose(input.value));
        this.destinationSuggest = new ModalFolderSuggest(this.app, input, choose);
        this.destinationSummaryEl = card.createDiv({ cls: 'ert-section-desc' });
        this.destinationErrorEl = card.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', attr: { role: 'status' } });
        card.createDiv({ cls: 'ert-section-desc', text: t('ui.manuscriptOptionsModal.destinationNote') });
        const actions = card.createDiv({ cls: 'ert-manuscript-pill-row' });
        new ButtonComponent(actions).setButtonText(t('ui.manuscriptOptionsModal.useConfiguredDefault')).onClick(() => {
            this.destination = this.plugin.settings.manuscriptOutputFolder || resolveExportOutputFolder(this.plugin);
            input.value = this.destination;
            this.updateDestinationUi();
            this.syncExportUi();
        });
        this.recentExportsButton = new ButtonComponent(actions).setButtonText(t('ui.exportDeliveryReviewModal.recentExports')).onClick(() => this.openRecentExports());
        this.updateDestinationUi();
    }

    private updateDestinationUi(): void {
        try { validateExportDestination(this.destination, this.app); this.destinationError = null; }
        catch (error) { this.destinationError = error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.chooseDestination'); }
        this.destinationInput?.setAttribute('aria-invalid', String(!!this.destinationError));
        this.destinationErrorEl?.toggleClass('ert-hidden', !this.destinationError);
        this.destinationErrorEl?.setText(this.destinationError || '');
        const selectedFormat = deliveryFormat({ exportType: this.exportType, outputFormat: this.outputFormat, outlinePreset: this.outlinePreset });
        const format = selectedFormat === 'docx' ? t('manuscriptModal.formatDocx') : selectedFormat === 'markdown' ? t('manuscriptModal.formatMarkdown') : selectedFormat.toUpperCase();
        const plannedCount = this.getPlannedOutputCount();
        const plannedFiles = plannedCount === 1
            ? t('ui.manuscriptOptionsModal.formatFilesOne', { count: plannedCount, format })
            : t('ui.manuscriptOptionsModal.formatFilesOther', { count: plannedCount, format });
        const summaryVars = { items: this.countItems(this.getSelectedSceneCount()), files: plannedFiles };
        this.destinationSummaryEl?.setText(this.outputFormat === 'pdf' && this.saveMarkdownArtifact
            ? t('ui.manuscriptOptionsModal.destinationSummaryWorking', summaryVars)
            : t('ui.manuscriptOptionsModal.destinationSummary', summaryVars));
        this.recentExportsButton?.setDisabled(this.exportInFlight || this.proofLoading || this.sourceSaving);
        this.updateActionButtonDisabledState();
    }

    private renderDeliveryStatus(receipt: ExportDeliveryReceipt): void {
        if (!this.outputStatusEl) return;
        const passed = receipt.files.filter(file => file.primary && file.available && !file.error).length;
        const deliveryVars = { passed, expected: receipt.expectedFiles };
        this.outputStatusEl.createDiv({ text: receipt.problems.length
            ? t('ui.manuscriptOptionsModal.deliveryNeedsAttention', deliveryVars)
            : t('ui.manuscriptOptionsModal.deliveryPassed', deliveryVars) });
        for (const problem of receipt.problems) this.outputStatusEl.createDiv({ text: problem });
        new ButtonComponent(this.outputStatusEl).setButtonText(t('ui.exportDeliveryReviewModal.details')).onClick(() => { void this.openDeliveryReview(receipt.receiptPath); });
    }

    private openRecentExports(): void {
        if (this.exportInFlight || this.proofLoading || this.sourceSaving) return;
        new RecentExportsModal(this.plugin, this.destination, () => this.close()).open();
    }

    private async openDeliveryReview(receiptPath: string): Promise<void> {
        try {
            const receipt = await readDeliveryReceipt(this.app, receiptPath);
            this.close();
            new ExportDeliveryReviewModal(this.app, receipt).open();
        } catch (error) { new Notice(error instanceof Error ? error.message : t('ui.manuscriptOptionsModal.reviewRecordOpenFailed')); }
    }

    private showExportFailure(error: unknown): void {
        if (!this.outputStatusEl) return;
        const failure = categorizeExportError(error);
        this.outputStatusEl.empty();
        this.outputStatusEl.removeClass('ert-hidden');
        this.outputStatusEl.createDiv({ text: failure.message });
        if (failure.completedPaths.length > 0) {
            this.renderStatusPathGroup(t('ui.manuscriptOptionsModal.statusCreatedBeforeFailure'), failure.completedPaths);
        }
        if (failure.delivery) this.renderDeliveryStatus(failure.delivery);
        if (failure.category === 'missing_metadata' || failure.category === 'missing_dependency') {
            new ButtonComponent(this.outputStatusEl)
                .setButtonText(failure.category === 'missing_metadata' ? t('ui.manuscriptOptionsModal.editBookDetails') : t('ui.manuscriptOptionsModal.openExportTools'))
                .onClick(() => this.openPublishingSettings(failure.category === 'missing_metadata' ? 'book-details' : 'export-check'));
        }
        if (failure.detail) {
            const detailsEl = this.outputStatusEl.createEl('details', { cls: 'ert-sub-card-note' });
            detailsEl.createEl('summary', { text: t('ui.manuscriptOptionsModal.details') });
            detailsEl.createEl('pre', {
                cls: 'ert-manuscript-preview-sample',
                text: failure.detail,
            });
        }
    }

    private async openVaultPath(vaultPath: string): Promise<void> {
        const abstract = this.app.vault.getAbstractFileByPath(vaultPath);
        if (abstract instanceof TFile) {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(abstract);
            return;
        }
        new Notice(t('ui.manuscriptOptionsModal.unableToOpen', { path: vaultPath }));
    }

    private getOutcomeFolderPath(): string | null {
        if (this.lastOutcome?.outputFolder) {
            return this.lastOutcome.outputFolder;
        }
        const path = this.lastOutcome?.renderedPaths?.[0]
            || this.lastOutcome?.savedPaths?.[0]
            || this.lastOutcome?.renderedPath
            || this.lastOutcome?.savedPath;
        if (!path) return null;
        const idx = path.lastIndexOf('/');
        if (idx <= 0) return null;
        return path.slice(0, idx);
    }

    private revealInFileExplorer(target: TAbstractFile): boolean {
        const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
        if (!explorerLeaf) return false;

        const explorerView = explorerLeaf.view as unknown as { revealInFolder?: (node: TAbstractFile) => void };
        if (!explorerView.revealInFolder) return false;

        explorerView.revealInFolder(target);
        void this.app.workspace.revealLeaf(explorerLeaf);
        return true;
    }

    /**
     * Resolve a vault-relative path to an absolute filesystem path. Returns null
     * on platforms without filesystem access (mobile).
     */
    private resolveAbsolutePath(vaultPath: string): string | null {
        const adapter = this.app.vault.adapter; // SAFE: adapter required to compute absolute path for native Finder reveal
        if (adapter instanceof FileSystemAdapter) {
            return path.join(adapter.getBasePath(), normalizePath(vaultPath));
        }
        return null;
    }

    /**
     * Reveal a file (or folder) in the OS file manager (Finder on macOS, Explorer
     * on Windows, default file manager on Linux). Falls back to Obsidian's in-app
     * file explorer on mobile or when electron is unavailable.
     */
    private async revealInSystemFileManager(vaultPath: string, kind: 'file' | 'folder'): Promise<boolean> {
        const absolute = this.resolveAbsolutePath(vaultPath);
        if (!absolute) return false;
        try {
            // electron.shell is available in the desktop renderer process
            const electron = (window as unknown as { require?: (name: string) => { shell?: { showItemInFolder: (p: string) => void; openPath: (p: string) => Promise<string> } } }).require?.('electron');
            const shell = electron?.shell;
            if (!shell) return false;
            if (kind === 'file') {
                shell.showItemInFolder(absolute);
            } else {
                const result = await shell.openPath(absolute);
                if (typeof result === 'string' && result.length > 0) {
                    // openPath resolves to an error message string on failure
                    return false;
                }
            }
            return true;
        } catch {
            return false;
        }
    }

    private async openOutcomeFolder(): Promise<void> {
        // Prefer revealing the actual exported file (so Finder highlights it) and
        // fall back to opening just the folder if no file path is available.
        const filePath = this.getOutcomeFilePath();
        const folderPath = this.getOutcomeFolderPath();
        if (!filePath && !folderPath) {
            new Notice(t('ui.manuscriptOptionsModal.noOutputToReveal'));
            return;
        }

        if (filePath && await this.revealInSystemFileManager(filePath, 'file')) return;
        if (folderPath && await this.revealInSystemFileManager(folderPath, 'folder')) return;

        // Fallback: in-app file explorer (mobile / no electron)
        const target = folderPath || filePath;
        if (!target) return;
        const abstract = this.app.vault.getAbstractFileByPath(target);
        if (!abstract) {
            new Notice(t('ui.manuscriptOptionsModal.pathNotFound', { path: target }));
            return;
        }
        if (!this.revealInFileExplorer(abstract)) {
            new Notice(t('ui.manuscriptOptionsModal.unableToReveal'));
        }
    }

    private getOutcomeFilePath(): string | null {
        return this.lastOutcome?.renderedPath
            || this.lastOutcome?.savedPath
            || this.lastOutcome?.renderedPaths?.[0]
            || this.lastOutcome?.savedPaths?.[0]
            || null;
    }

    private async openOutcomeFile(): Promise<void> {
        const filePath = this.getOutcomeFilePath();
        if (!filePath) { new Notice(t('ui.manuscriptOptionsModal.noOutputFile')); return; }
        try {
            const format = this.lastOutcome?.delivery?.format || deliveryFormat(this.buildSubmissionResult());
            await openExportedFile(this.app, filePath, format);
            this.close();
        } catch (error) { new Notice(error instanceof Error ? error.message : t('ui.exportDeliveryReviewModal.fileNotOpened')); }
    }

    private registerPointerEvents(): void {
        if (!this.trackEl || !this.startHandleEl || !this.endHandleEl) return;

        const onPointerMove = (evt: PointerEvent) => {
            if (!this.trackEl || !this.activeHandle || this.totalScenes === 0) return;
            const rect = this.trackEl.getBoundingClientRect();
            let ratio = (evt.clientX - rect.left) / rect.width;
            ratio = Math.min(Math.max(ratio, 0), 1);
            const position = this.ratioToIndex(ratio);
            this.updateRangeFromDrag(this.activeHandle, position);
        };

        const onPointerUp = () => {
            this.activeHandle = null;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };

        const attach = (handle: HTMLElement, handleType: 'start' | 'end') => {
            handle.tabIndex = 0;
            handle.setAttribute('role', 'slider');
            handle.setAttribute('aria-orientation', 'horizontal');
            handle.addEventListener('keydown', evt => this.handleRangeKeyDown(handleType, evt));
            handle.onpointerdown = (evt: PointerEvent) => {
                const effectiveHandle = handleType;
                this.activeHandle = effectiveHandle;
                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp, { once: true });
                evt.preventDefault();
                evt.stopPropagation(); // Prevent track from also receiving this event
            };
        };

        attach(this.startHandleEl, 'start');
        attach(this.endHandleEl, 'end');

        this.trackEl.onpointerdown = (evt: PointerEvent) => {
            const rect = this.trackEl!.getBoundingClientRect();
            let ratio = (evt.clientX - rect.left) / rect.width;
            ratio = Math.min(Math.max(ratio, 0), 1);
            const position = this.ratioToIndex(ratio);
            const distStart = Math.abs(position - this.rangeStart);
            const distEnd = Math.abs(position - this.rangeEnd);
            const target: DragHandle = distStart <= distEnd ? 'start' : 'end';
            this.updateRangeFromDrag(target, position);
        };

        this.detachEvents = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };
    }

    private detachPointerEvents(): void {
        if (this.detachEvents) {
            this.detachEvents();
            this.detachEvents = undefined;
        }
    }

    private handleRangeKeyDown(handle: 'start' | 'end', evt: KeyboardEvent): void {
        if (this.totalScenes === 0) return;
        const current = handle === 'start' ? this.rangeStart : this.rangeEnd;
        let position: number;
        switch (evt.key) {
            case 'ArrowLeft':
            case 'ArrowDown': position = current - 1; break;
            case 'ArrowRight':
            case 'ArrowUp': position = current + 1; break;
            case 'Home': position = 1; break;
            case 'End': position = this.totalScenes; break;
            default: return;
        }
        evt.preventDefault();
        evt.stopPropagation();
        this.updateRangeFromDrag(handle, Math.max(1, Math.min(position, this.totalScenes)));
    }

    // Data loading -----------------------------------------------------------
    private async loadSubplots(): Promise<void> {
        if (this.source?.kind !== 'book') return;
        if (!this.subplotDropdown) return;
        
        try {
            const sourceBook = this.getSourceBook();
            if (!sourceBook) return;
            const scenes = await this.plugin.getSceneData({ sourcePath: sourceBook.sourceFolder });
            if (this.getSourceBook()?.id !== sourceBook.id) return;

            const subplotCounts = new Map<string, number>();
            
            scenes.forEach(scene => {
                if (scene.itemType !== 'Scene') return;
                const sub = scene.subplot && scene.subplot.trim() ? scene.subplot : 'Main Plot';
                subplotCounts.set(sub, (subplotCounts.get(sub) || 0) + 1);
            });

            const sortedSubplots = Array.from(subplotCounts.keys()).sort((a, b) => {
                if (a === 'Main Plot') return -1;
                if (b === 'Main Plot') return 1;
                const countA = subplotCounts.get(a) || 0;
                const countB = subplotCounts.get(b) || 0;
                if (countA !== countB) return countB - countA; // Descending count
                return a.localeCompare(b);
            });

            this.subplotDropdown.selectEl.textContent = '';
            this.subplotDropdown.addOption('All Subplots', t('ui.manuscriptOptionsModal.allSubplots'));
            const openCount = scenes.filter(scene => scene.itemType === 'Scene' && typeof scene.path === 'string' && this.openScenePathsSnapshot.has(scene.path)).length;
            if (openCount > 0) {
                this.subplotDropdown.addOption(OPEN_SCENES_FILTER, t('ui.manuscriptOptionsModal.openScenesOption', { count: openCount }));
            }
            sortedSubplots.forEach(sub => {
                this.subplotDropdown?.addOption(sub, sub);
            });
            this.subplotDropdown.setValue(this.subplot === OPEN_SCENES_FILTER ? OPEN_SCENES_FILTER : 'All Subplots');
        } catch (e) {
            console.error('Failed to load subplots', e);
        }
    }

    private isOpenScenesMode(): boolean {
        return this.subplot === OPEN_SCENES_FILTER;
    }

    private async loadScenesForOrder(): Promise<void> {
        const loadId = ++this.sourceLoadId;
        this.sourceLoading = true;
        this.sourceError = null;
        this.updateActionButtonDisabledState();
        this.updateProofUi();
        try {
            const isOpenScenes = this.isOpenScenesMode();
            const effectiveSubplot = this.subplot === 'All Subplots' || isOpenScenes ? undefined : this.subplot;
            const source = this.source;
            const result = source && source.kind !== 'book'
                ? source.paths.length ? getReviewedManuscriptSelection(this.app, source) : { files: [], titles: [], whenDates: [], sceneNumbers: [], wordCounts: [], acts: [], chapterMarkersByScenePath: {} }
                : await getSceneFilesByOrder(this.app, this.plugin, this.order, effectiveSubplot, false, this.getSourceBook()?.sourceFolder);
            if (source && source.kind !== 'book') {
                result.wordCounts = await Promise.all(result.files.map(async file => countWords(extractCountableBodyText(await this.app.vault.cachedRead(file)))));
            }
            if (loadId !== this.sourceLoadId) return;
            this.sourceLoading = false;
            let { titles, whenDates, sceneNumbers, wordCounts } = result;
            let acts = result.acts;
            const paths = result.files.map(f => f.path);

            if (isOpenScenes) {
                const indices = paths.map((p, i) => this.openScenePathsSnapshot.has(p) ? i : -1).filter(i => i !== -1);
                titles = indices.map(i => titles[i]);
                whenDates = indices.map(i => whenDates[i]);
                sceneNumbers = indices.map(i => sceneNumbers[i]);
                wordCounts = indices.map(i => wordCounts[i]);
                acts = indices.map(i => acts[i]);
                this.scenePaths = indices.map(i => paths[i]);
            } else {
                this.scenePaths = paths;
            }

            this.sceneTitles = titles;
            this.sceneWhenDates = whenDates;
            this.sceneNumbers = sceneNumbers;
            this.sceneWordCounts = wordCounts;
            this.sceneActs = acts;
            this.chapterMarkersByScenePath = (result.chapterMarkersByScenePath ?? {});
            this.totalScenes = titles.length;
            this.rangeStart = 1;
            this.rangeEnd = Math.max(1, this.totalScenes);
            this.hasWhenDates = whenDates.some((value) => !!value);
            this.loadSceneMarkers().catch(error => console.error('[Radial Timeline] Export summary could not read scenes:', error));

            this.updateBadgeSceneCount();

            this.loadingEl?.remove();
            this.updateRangeUI();
            this.syncRangeAvailability();
            this.updateOrderPillsState();
            this.syncExportUi();
        } catch (err) {
            if (loadId !== this.sourceLoadId) return;
            this.sourceLoading = false;
            this.sourceError = err instanceof Error ? err.message : t('ui.manuscriptOptionsModal.sourceReadFailed');
            this.scenePaths = [];
            this.sceneTitles = [];
            this.sceneWordCounts = [];
            this.totalScenes = 0;
            this.updateBadgeSceneCount();
            this.loadingEl?.setText(this.sourceError);
            this.renderSourceCard();
            this.syncExportUi();
        }
    }

    // Range rendering -------------------------------------------------------
    private ratioToIndex(ratio: number): number {
        if (this.totalScenes <= 1) return 1;
        const raw = Math.round(ratio * (this.totalScenes - 1)) + 1;
        return Math.min(Math.max(raw, 1), this.totalScenes);
    }

    private updateRangeFromDrag(handle: DragHandle, position: number): void {
        if (handle === 'start') {
            this.rangeStart = Math.min(position, this.rangeEnd);
        } else if (handle === 'end') {
            this.rangeEnd = Math.max(position, this.rangeStart);
        }
        this.updateRangeUI();
    }

    private isChronologicalOrder(): boolean {
        return this.order === 'chronological' || this.order === 'reverse-chronological';
    }

    private getSceneNumberAt(position: number): number {
        // Convert 1-based position to 0-based index and get scene number
        const index = Math.max(0, Math.min(position - 1, this.sceneNumbers.length - 1));
        return this.sceneNumbers[index] ?? position;
    }

    private syncRangeAvailability(): void {
        const count = this.getSelectedSceneCount();
        this.rangeStatusEl?.setText(t('ui.manuscriptOptionsModal.itemsSelected', { items: this.countItems(count) }));
        this.updateBadgeSceneCount();
        const hasDecimalScenes = this.getSelectedSceneTitles().some((title) => /^\d+\.\d+\s+/.test((title || '').trim()));
        if (this.rangeDecimalWarningEl) {
            this.rangeDecimalWarningEl.toggleClass('ert-hidden', !hasDecimalScenes);
        }
    }

    private updateRangeUI(): void {
        if (!this.trackEl || !this.startHandleEl || !this.endHandleEl || !this.rangeFillEl) return;
        if (this.totalScenes === 0) return;

        const startPercent = this.totalScenes === 1 ? 0 : ((this.rangeStart - 1) / (this.totalScenes - 1)) * 100;
        const endPercent = this.totalScenes === 1 ? 100 : ((this.rangeEnd - 1) / (this.totalScenes - 1)) * 100;

        this.startHandleEl.style.left = `${startPercent}%`; // SAFE: inline style used for live drag handle position
        this.endHandleEl.style.left = `${endPercent}%`; // SAFE: inline style used for live drag handle position
        this.rangeFillEl.style.left = `${startPercent}%`; // SAFE: inline style used for live drag track sizing
        this.rangeFillEl.style.width = `${Math.max(endPercent - startPercent, 1)}%`; // SAFE: inline style used for live drag track sizing

        this.startHandleEl.setAttribute('aria-valuemin', '1');
        this.startHandleEl.setAttribute('aria-valuemax', String(this.rangeEnd));
        this.startHandleEl.setAttribute('aria-valuenow', String(this.rangeStart));
        this.startHandleEl.setAttribute('aria-valuetext', this.formatCardTitle(this.rangeStart - 1));
        this.endHandleEl.setAttribute('aria-valuemin', String(this.rangeStart));
        this.endHandleEl.setAttribute('aria-valuemax', String(this.totalScenes));
        this.endHandleEl.setAttribute('aria-valuenow', String(this.rangeEnd));
        this.endHandleEl.setAttribute('aria-valuetext', this.formatCardTitle(this.rangeEnd - 1));

        this.renderRangeCards();
        this.syncRangeAvailability();
        this.updateSplitUi();
    }

    private formatCardTitle(index: number): string {
        const title = this.sceneTitles[index] ?? '—';
        if (this.isChronologicalOrder()) {
            const whenDate = this.sceneWhenDates[index];
            return whenDate ? `${title} · ${whenDate}` : title;
        }
        return title;
    }

    private renderRangeCards(): void {
        if (!this.rangeCardContainer) return;
        this.rangeCardContainer.empty();
        if (this.totalScenes === 0) return;

        if (this.isOpenScenesMode()) {
            this.rangeCardContainer.classList.add('ert-manuscript-scene-chips');
            this.rangeCardContainer.classList.remove('ert-manuscript-range-cards');
            for (let i = 0; i < this.totalScenes; i++) {
                const inRange = (i + 1) >= this.rangeStart && (i + 1) <= this.rangeEnd;
                const chip = this.rangeCardContainer.createDiv({ cls: 'ert-manuscript-scene-chip' });
                chip.toggleClass('is-muted', !inRange);
                const num = this.sceneNumbers[i] || (i + 1);
                chip.createDiv({ cls: 'ert-manuscript-scene-chip-num', text: t('ui.manuscriptOptionsModal.sceneNumber', { number: num }) });
                chip.createDiv({ cls: 'ert-manuscript-scene-chip-title', text: this.sceneTitles[i] || '—' });
            }
            return;
        }

        this.rangeCardContainer.classList.remove('ert-manuscript-scene-chips');
        this.rangeCardContainer.classList.add('ert-manuscript-range-cards');

        // Get actual scene numbers for range display
        const startSceneNum = this.getSceneNumberAt(this.rangeStart);
        const endSceneNum = this.getSceneNumberAt(this.rangeEnd);
        const displayStart = startSceneNum;
        const displayEnd = endSceneNum;

        const firstCard = this.rangeCardContainer.createDiv({ cls: 'ert-manuscript-range-card' });
        firstCard.toggleClass('is-muted', this.rangeStart > 1);
        firstCard.createDiv({ cls: 'ert-manuscript-range-label', text: t('manuscriptModal.rangeFirst') });
        firstCard.createDiv({ cls: 'ert-manuscript-range-title', text: this.formatCardTitle(this.rangeStart - 1) });

        const selectedCard = this.rangeCardContainer.createDiv({ cls: 'ert-manuscript-range-card ert-manuscript-range-card-active' });
        const isFullRange = this.rangeStart === 1 && this.rangeEnd === this.totalScenes;
        selectedCard.toggleClass('is-muted', isFullRange);
        const rangeLabel = isFullRange
            ? t('manuscriptModal.rangeAllLabel')
            : t('manuscriptModal.rangeSelectedLabel', { start: displayStart, end: displayEnd });
        selectedCard.createDiv({ cls: 'ert-manuscript-range-label', text: rangeLabel });
        const middleTitle = this.rangeStart === this.rangeEnd
            ? this.formatCardTitle(this.rangeStart - 1)
            : t('manuscriptModal.rangeCountLabel', { count: this.rangeEnd - this.rangeStart + 1 });
        selectedCard.createDiv({ cls: 'ert-manuscript-range-title', text: middleTitle });

        const lastCard = this.rangeCardContainer.createDiv({ cls: 'ert-manuscript-range-card' });
        lastCard.toggleClass('is-muted', this.rangeEnd < this.totalScenes);
        lastCard.createDiv({ cls: 'ert-manuscript-range-label', text: t('manuscriptModal.rangeLast') });
        lastCard.createDiv({ cls: 'ert-manuscript-range-title', text: this.formatCardTitle(this.rangeEnd - 1) });
    }

    private buildSubmissionResult(): ManuscriptModalResult {
        this.normalizeOutputFormatForOutline();
        const mode = this.getUiMode();
        this.sanitizeStateForMode(mode);
        const tocMode: TocMode = mode.showToc ? this.tocMode : 'none';
        const includeMatter = mode.showIncludeMatter ? this.includeMatterUserChoice : false;
        const includeSynopsis = mode.isOutline ? this.includeSynopsisUserChoice : false;
        const isOpenScenes = this.isOpenScenesMode();
        const submissionSubplot = isOpenScenes
            ? undefined
            : this.subplot === 'All Subplots'
            ? undefined
            : this.subplot;
        const submissionScenePathFilter = isOpenScenes
            ? this.getSelectedScenePaths()
            : undefined;

        const selectedProfile = this.selectedExportProfile || this.defaultExportProfile || this.getTemplateList()[0];
        const selectedLayoutId = this.resolveLayoutIdForProfile(selectedProfile);
        return {
            outputFolder: validateExportDestination(this.destination),
            reviewedSourcePaths: this.getSelectedScenePaths(),
            source: this.source ? structuredClone(this.source) : undefined,
            order: this.order,
            tocMode,
            includeSceneIdInToc: tocMode !== 'none' ? this.includeSceneId : false,
            includeSceneIdInHeading: this.includeSceneId,
            // Open-scene paths already contain the chosen range.
            rangeStart: isOpenScenes ? undefined : this.rangeStart,
            rangeEnd: isOpenScenes ? undefined : this.rangeEnd,
            subplot: submissionSubplot,
            scenePathFilter: submissionScenePathFilter,
            exportType: this.exportType,
            manuscriptPreset: this.exportType === 'manuscript' ? this.manuscriptPreset : undefined,
            outlinePreset: this.outlinePreset,
            outputFormat: mode.isOutline ? 'markdown' : this.outputFormat,
            updateWordCounts: mode.showWordCount ? this.updateWordCounts : false,
            includeSynopsis,
            includeMatter,
            saveMarkdownArtifact: mode.showSavePrecompile ? this.saveMarkdownArtifact : false,
            lineBreaksAsParagraphs: mode.showLineBreaksAsParagraphs ? this.lineBreaksAsParagraphs : false,
            exportCleanup: mode.isManuscript ? this.getActiveCleanupOptions() : undefined,
            // Only a saved preset may become "last used"; drafts and the
            // restored ad-hoc snapshot carry ids that match no preset.
            exportProfileId: this.getCurrentTemplateSelection() ?? undefined,
            exportProfileTemplateId: selectedLayoutId,
            selectedLayoutId: mode.isPdfManuscript ? selectedLayoutId : undefined,
            splitMode: mode.showSplit ? this.splitMode : 'single',
            splitParts: mode.showSplit && this.isSplitEnabled() ? this.splitParts : 1
        };
    }

    // Submission -------------------------------------------------------------
    private async submit(): Promise<void> {
        if (this.exportInFlight || this.proofLoading || this.sourceLoading || this.sourceSaving || this.sourceError || this.destinationError || !this.sourceReviewed) return;
        if (this.totalScenes === 0) {
            new Notice(t('manuscriptModal.emptyNotice'));
            return;
        }
        if (!this.isSplitSelectionValid()) {
            new Notice(t('ui.manuscriptOptionsModal.notEnoughScenesToSplit', { parts: this.splitParts }));
            this.updateActionButtonDisabledState();
            return;
        }
        const request = this.buildSubmissionResult();
        this.exportInFlight = true;
        if (this.controlsEl) this.controlsEl.inert = true;
        this.outputStatusEl?.addClass('ert-hidden');
        this.exportCompleted = false;
        this.lastOutcome = null;
        this.openFolderButton?.buttonEl.addClass('ert-hidden');
        this.openFileButton?.buttonEl.addClass('ert-hidden');
        this.cancelButton?.buttonEl.removeClass('ert-hidden');
        this.actionButton?.setDisabled(true);
        this.updateActionButtonLabel();
        this.refreshValidationSnapshot();

        try {
            if (this.proofReceipt) await this.checkProofFreshness();
            const outcome = await this.onSubmit(request);
            if (this.proofClosed) return;
            const hasOutcome = Boolean(
                outcome.savedPath
                || outcome.renderedPath
                || (outcome.savedPaths && outcome.savedPaths.length > 0)
                || (outcome.renderedPaths && outcome.renderedPaths.length > 0)
            );
            if (!hasOutcome) {
                this.exportCompleted = false;
                this.lastOutcome = null;
                this.updateActionButtonDisabledState();
                this.updateActionButtonLabel();
                return;
            }
            this.exportCompleted = !outcome.delivery?.problems.length;
            this.lastOutcome = outcome;
            this.showOutputStatus(outcome);
            this.actionButton?.setDisabled(false);
            this.openFolderButton?.buttonEl.toggleClass('ert-hidden', !this.getOutcomeFolderPath());
            this.openFileButton?.buttonEl.toggleClass('ert-hidden', !this.getOutcomeFilePath());
            this.cancelButton?.buttonEl.toggleClass('ert-hidden', this.exportCompleted);
            this.updateActionButtonLabel();
        } catch (err) {
            if (this.proofClosed) return;
            console.error(err);
            const failure = categorizeExportError(err);
            new Notice(failure.message);
            this.showExportFailure(failure);
            this.exportCompleted = false;
            this.updateActionButtonDisabledState();
            this.updateActionButtonLabel();
        } finally {
            this.exportInFlight = false;
            this.updateDestinationUi();
            this.updateProofUi();
            if (this.controlsEl) this.controlsEl.inert = false;
            this.updateActionButtonDisabledState();
        }
    }
}
