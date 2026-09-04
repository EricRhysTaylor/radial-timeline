/*
 * Manuscript Options Modal
 */
import { App, ButtonComponent, DropdownComponent, FileSystemAdapter, Modal, Notice, Platform, setIcon, TAbstractFile, TFile, ToggleComponent, normalizePath } from 'obsidian';
import * as path from 'path'; // SAFE: Node path needed to build absolute paths for native Finder reveal
import type RadialTimelinePlugin from '../main';
import { getSceneFilesByOrder, ManuscriptOrder, TocMode, type ManuscriptSceneHeadingMode } from '../utils/manuscript';
import { t } from '../i18n';
import { clearFontAvailabilityCache, ExportFormat, ExportType, ManuscriptPreset, OutlinePreset, getAutoPdfEngineSelection, resolveTemplatePath, validatePandocLayout, getTemplateFontDiagnostics, getStructuredFontDiagnostic } from '../utils/exportFormats';
import { ensureBundledLayoutInstalledForExport } from '../utils/pandocBundledLayouts';
import { getActiveBook, getActiveBookTitle, getActiveBookSourceFolder, DEFAULT_BOOK_TITLE } from '../utils/books';
import { chunkScenesIntoParts } from '../utils/splitOutput';
import { cleanupFormatForOutputFormat, getDefaultManuscriptCleanupOptions, normalizeManuscriptCleanupOptions } from '../utils/manuscriptSanitize';
import { categorizeExportError } from '../utils/exportErrors';
import {
    adaptPandocLayoutsToPublishingModel,
    buildLegacyTemplateFromModalExportProfile,
    buildPersistedExportProfileFromModalExportProfile,
    buildModalExportProfile,
    buildModalExportProfileFromLegacyTemplate,
    buildTransientModalExportProfile,
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
import type {
    BookProfile,
    BookPublishingPreferences,
    ExportProfile,
    ManuscriptExportCleanupOptions,
    ManuscriptExportTemplate,
    PandocLayoutTemplate,
    PublishingValidationSnapshot,
    TemplateProfile,
} from '../types';

const OPEN_SCENES_FILTER = '__open_scenes__';

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
    exportCleanup?: ManuscriptExportCleanupOptions;
    exportProfileId?: string;
    exportProfileTemplateId?: string;
    selectedLayoutId?: string;
    splitMode?: 'single' | 'parts';
    splitParts?: number;
}

export interface ManuscriptExportOutcome {
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
        hero.createDiv({ cls: 'ert-modal-title', text: 'Save export preset' });
        hero.createDiv({ cls: 'ert-modal-subtitle', text: 'Name this manuscript export setup for reuse.' });

        const body = contentEl.createDiv({ cls: 'ert-template-dialog-panel' });
        let currentName = this.defaultName;
        const input = body.createEl('input', {
            cls: 'ert-input ert-input--full',
            attr: { type: 'text', placeholder: 'Preset name', value: this.defaultName }
        });
        input.addEventListener('input', () => {
            currentName = input.value;
        });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText('Create preset')
            .setCta()
            .onClick(() => {
                const trimmed = currentName.trim();
                if (!trimmed) {
                    new Notice('Preset name is required.');
                    return;
                }
                this.onSave(trimmed);
                this.close();
            });
        new ButtonComponent(actions)
            .setButtonText('Cancel')
            .onClick(() => this.close());
    }
}

class DeleteExportTemplateModal extends Modal {
    private readonly templateName: string;
    private readonly onConfirm: () => void;

    constructor(app: App, templateName: string, onConfirm: () => void) {
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
        hero.createDiv({ cls: 'ert-modal-title', text: 'Delete export preset' });
        hero.createDiv({ cls: 'ert-modal-subtitle', text: `Delete "${this.templateName}"? This cannot be undone.` });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText('Delete')
            .setDestructive()
            .onClick(() => {
                this.onConfirm();
                this.close();
            });
        new ButtonComponent(actions)
            .setButtonText('Cancel')
            .onClick(() => this.close());
    }
}

export class ManuscriptOptionsModal extends Modal {
    private readonly plugin: RadialTimelinePlugin;
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
    private cleanupCommentsToggle?: ToggleComponent;
    private cleanupAiCommentsToggle?: ToggleComponent;
    private cleanupLinksToggle?: ToggleComponent;
    private cleanupCalloutsToggle?: ToggleComponent;
    private cleanupBlockIdsToggle?: ToggleComponent;
    private templateWarningEl?: HTMLElement;
    /**
     * Strict font policy (Phase 1): true when PDF format is selected and the
     * spec-driven font diagnostic reports the required font is missing. The
     * Export button is disabled in this state — see updateActionButtonDisabledState.
     */
    private isPdfFontBlocked: boolean = false;
    private layoutHeaderEl?: HTMLElement;
    private layoutContainerEl?: HTMLElement;
    private selectedLayoutId?: string;
    private bundledFontInstallAttempted: Set<string> = new Set();
    private manuscriptPresetDescEl?: HTMLElement;
    private manuscriptPresetGridEl?: HTMLElement;
    private outlinePresetDescEl?: HTMLElement;
    private manuscriptPreviewToggle?: HTMLElement;
    private manuscriptPreviewPanel?: HTMLElement;
    private manuscriptPreviewIcon?: HTMLElement;
    private outlinePreviewToggle?: HTMLElement;
    private outlinePreviewPanel?: HTMLElement;
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
    private deleteTemplateButton?: ButtonComponent;
    private templateSummaryEl?: HTMLElement;
    private templateHintEl?: HTMLElement;
    private selectedExportProfileId: string | null = null;
    private defaultExportProfileId: string | null = null;
    private lastUsedExportProfileId: string | null = null;
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
        showExportCleanup: boolean;
        showSavePrecompile: boolean;
        showSplit: boolean;
        showScope: boolean;
        showOrdering: boolean;
        showSubplotFilter: boolean;
        showManagePdfLayouts: boolean;
        chronoMessage: string | null;
        lockSceneSelectionToFullBook: boolean;
    } {
        const isOutline = this.exportType === 'outline';
        const isManuscript = !isOutline;
        const isPdfManuscript = isManuscript && this.outputFormat === 'pdf';
        const isDocxManuscript = isManuscript && this.outputFormat === 'docx';
        const isMarkdownManuscript = isManuscript && this.outputFormat === 'markdown';
        const lockSceneSelectionToFullBook = isPdfManuscript;
        const showScope = !lockSceneSelectionToFullBook;

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
            showExportCleanup: isManuscript,
            showSavePrecompile: isPdfManuscript,
            showSplit: isManuscript,
            showScope,
            showOrdering: showScope,
            showSubplotFilter: showScope,
            showManagePdfLayouts: isPdfManuscript,
            chronoMessage: showScope && !this.hasWhenDates ? 'No When dates found.' : null,
            lockSceneSelectionToFullBook
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
    }

    async onOpen(): Promise<void> {
        // Re-ask about font availability on every open: fonts can be installed
        // or deactivated between exports, and a stale "Ready" here means the
        // export fails after the user has already committed to it.
        clearFontAvailabilityCache();
        const { contentEl, modalEl } = this;
        contentEl.empty();
        const sourceFolder = getActiveBookSourceFolder(this.plugin.settings);
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

        this.renderSkeleton(contentEl);
        await this.loadSubplots();
        await this.loadScenesForOrder();
        await this.restoreLastUsedTemplate();
    }

    onClose(): void {
        void this.persistCurrentSnapshot();
        this.detachPointerEvents();
        this.contentEl.empty();
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
        const bookTitle = getActiveBookTitle(this.plugin.settings, DEFAULT_BOOK_TITLE);
        this.badgeEl = hero.createSpan({ cls: 'ert-modal-badge', text: `EXPORT — ${bookTitle}` });

        hero.createDiv({
            cls: 'ert-modal-title',
            text: 'Export manuscript'
        });
        const description = hero.createDiv({ cls: 'ert-modal-subtitle ert-manuscript-modal-description' });
        t('manuscriptModal.description').split('\n\n').forEach((paragraph) => {
            description.createEl('p', { text: paragraph });
        });
        const bookContextRow = hero.createDiv({ cls: 'ert-modal-meta' });
        const manageBooksLink = bookContextRow.createEl('a', {
            cls: 'ert-modal-meta-item',
            text: 'Manage books\u2026',
            attr: { href: '#' }
        });
        manageBooksLink.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
            this.plugin.settingsTab?.revealSettingsSection('core', 'general');
            // @ts-ignore - Obsidian API
            this.app.setting.open();
            // @ts-ignore - Obsidian API
            this.app.setting.openTabById('radial-timeline');
        });
        this.managePdfLayoutsLinkEl = bookContextRow.createEl('a', {
            cls: 'ert-modal-meta-item ert-hidden',
            text: 'Manage PDF layouts…',
            attr: { href: '#' }
        });
        this.managePdfLayoutsLinkEl.addEventListener('click', (e) => {
            e.preventDefault();
            this.openPublishingSettings();
        });

        // A) OUTPUT
        const outputCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(outputCard, 'Output', 'file-output');
        const outputGrid = outputCard.createDiv({ cls: 'ert-manuscript-output-grid' });

        const exportTypeCol = outputGrid.createDiv({ cls: 'ert-manuscript-output-col' });
        exportTypeCol.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'What are you exporting?' });
        const exportRow = exportTypeCol.createDiv({ cls: 'ert-manuscript-pill-row ert-manuscript-pill-row--single' });
        this.createExportTypePill(exportRow, t('manuscriptModal.exportTypeManuscript'), 'manuscript');
        this.createExportTypePill(exportRow, t('manuscriptModal.exportTypeOutline'), 'outline');

        const formatCol = outputGrid.createDiv({ cls: 'ert-manuscript-output-col' });
        formatCol.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Output format' });
        this.formatPillRowEl = formatCol.createDiv({ cls: 'ert-manuscript-pill-row ert-manuscript-pill-row--single' });
        this.createOutputFormatPill(this.formatPillRowEl, t('manuscriptModal.formatMarkdown'), 'markdown', false, 'both');
        this.createOutputFormatPill(this.formatPillRowEl, t('manuscriptModal.formatPdf'), 'pdf', false, 'manuscript');
        this.createOutputFormatPill(this.formatPillRowEl, t('manuscriptModal.formatDocx'), 'docx', false, 'manuscript');
        this.formatStaticEl = formatCol.createDiv({ cls: 'ert-sub-card-note ert-hidden', text: 'Format: Markdown' });
        this.documentTypeDescEl = outputGrid.createDiv({ cls: 'ert-sub-card-note ert-manuscript-output-desc' });

        // B) PRESETS
        this.manuscriptOptionsCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        const manuscriptPresetGrid = this.manuscriptOptionsCard.createDiv({ cls: 'ert-manuscript-preset-grid' });
        this.manuscriptPresetGridEl = manuscriptPresetGrid;

        const presetHeaderCol = manuscriptPresetGrid.createDiv({ cls: 'ert-manuscript-preset-col ert-manuscript-preset-col--header' });
        this.createSectionHeading(presetHeaderCol, t('manuscriptModal.manuscriptPresetHeading'), 'book-open');
        this.layoutHeaderEl = manuscriptPresetGrid.createDiv({ cls: 'ert-manuscript-preset-col ert-manuscript-preset-col--header' });
        this.createSectionHeading(this.layoutHeaderEl, 'Layout', 'layout-template');

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
        this.createSectionHeading(this.splitCard, 'Split output', 'split');
        this.splitCard.createDiv({
            cls: 'ert-sub-card-note',
            text: 'Export as one file or split into multiple equal-sized files.'
        });
        const splitModeRow = this.splitCard.createDiv({ cls: 'ert-manuscript-split-grid' });
        const splitModeGroup = `ert-manuscript-split-${Date.now()}`;
        const singleCol = splitModeRow.createDiv({ cls: 'ert-manuscript-split-col ert-manuscript-split-col--single' });
        const singleOption = singleCol.createEl('label', { cls: 'ert-manuscript-split-option' });
        this.splitSingleInputEl = singleOption.createEl('input', {
            attr: { type: 'radio', name: splitModeGroup, value: 'single' }
        });
        singleOption.createSpan({ cls: 'ert-manuscript-split-option-label', text: 'Single file' });

        const partsCol = splitModeRow.createDiv({ cls: 'ert-manuscript-split-col ert-manuscript-split-col--parts' });
        const partsOption = partsCol.createEl('label', { cls: 'ert-manuscript-split-option ert-manuscript-split-option--parts' });
        this.splitPartsRadioInputEl = partsOption.createEl('input', {
            attr: { type: 'radio', name: splitModeGroup, value: 'parts' }
        });
        partsOption.createSpan({ cls: 'ert-manuscript-split-option-label', text: 'Split into parts' });
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
            this.splitParts = this.clampSplitParts(next);
            if (this.splitPartsInputEl) this.splitPartsInputEl.value = String(this.splitParts);
            if (this.splitPartsRadioInputEl) this.splitPartsRadioInputEl.checked = true;
            this.splitMode = 'parts';
            this.updateSplitUi();
        });
        this.splitPartsContainerEl = this.splitCard.createDiv({ cls: 'ert-manuscript-split-parts ert-hidden' });
        this.splitHelperEl = this.splitPartsContainerEl.createDiv({
            cls: 'ert-sub-card-note',
            text: 'Scenes are divided evenly across files.'
        });
        this.splitErrorEl = this.splitPartsContainerEl.createDiv({ cls: 'ert-sub-card-note ert-manuscript-split-error ert-hidden' });
        this.splitPreviewEl = this.splitPartsContainerEl.createDiv({ cls: 'ert-manuscript-split-preview' });

        // D) SCOPE
        this.scopeCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.scopeCard, 'Scope', 'filter');

        this.filterCard = this.scopeCard.createDiv({ cls: 'ert-manuscript-scope-row' });
        this.filterCard.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Scene filter' });
        const filterContainer = this.filterCard.createDiv({ cls: 'ert-manuscript-input-container ert-manuscript-scope-input' });
        this.subplotDropdown = new DropdownComponent(filterContainer)
            .addOption('All Subplots', 'All subplots')
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
        this.startHandleEl = this.trackEl.createDiv({ cls: 'ert-manuscript-range-handle', attr: { 'data-handle': 'start', 'aria-label': 'Start of range' } });
        this.endHandleEl = this.trackEl.createDiv({ cls: 'ert-manuscript-range-handle', attr: { 'data-handle': 'end', 'aria-label': 'End of range' } });
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
            text: 'No When dates found.'
        });
        this.orderingCard.createDiv({
            cls: 'ert-sub-card-note',
            text: t('manuscriptModal.orderNote')
        });

        // F) MANUSCRIPT OPTIONS
        this.manuscriptRulesCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        this.createSectionHeading(this.manuscriptRulesCard, 'Table of contents', 'list-checks');

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
        const publishingHeading = this.createSectionHeading(this.publishingCard, 'Manuscript options', 'settings');
        this.publishingHeadingTextEl = publishingHeading.querySelector('.ert-sub-card-head-text') || undefined;
        const publishingBody = this.publishingCard.createDiv({ cls: 'ert-manuscript-advanced-body' });

        this.pdfSettingsCard = publishingBody.createDiv({ cls: 'ert-manuscript-rule-block' });

        this.includeMatterCard = this.pdfSettingsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        this.includeMatterCard.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Include front & back matter' });
        this.includeMatterToggle = new ToggleComponent(this.includeMatterCard)
            .setValue(this.includeMatterUserChoice)
            .onChange((value) => {
                this.hasTouchedMatterToggle = true;
                this.includeMatterUserChoice = value;
                this.includeMatter = value;
                this.updateTemplateActionButtonState();
            });

        this.artifactRowEl = this.pdfSettingsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        this.artifactRowEl.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Save compiled + Pandoc-ready Markdown files' });
        this.markdownArtifactToggle = new ToggleComponent(this.artifactRowEl)
            .setValue(this.saveMarkdownArtifact)
            .onChange((value) => {
                this.saveMarkdownArtifact = value;
                this.updateTemplateActionButtonState();
            });
        this.artifactHelperEl = this.pdfSettingsCard.createDiv({
            cls: 'ert-sub-card-note',
            text: 'Saves the assembled source and the cleaned Markdown sent to Pandoc. Cleanup settings below decide what gets removed.'
        });

        // Print binding gutter — persisted directly on settings (not per-profile):
        // it describes the physical output target (screen vs paperback), which is
        // stable across export profiles. PDF-only; hidden for DOCX in syncExportUi.
        this.gutterRowEl = this.pdfSettingsCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        this.gutterRowEl.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Print binding gutter (paperback inner margin)' });
        new ToggleComponent(this.gutterRowEl)
            .setValue(this.plugin.settings.pdfBindingGutter === true)
            .onChange(async (value) => {
                this.plugin.settings.pdfBindingGutter = value;
                await this.plugin.saveSettings();
            });
        this.gutterHelperEl = this.pdfSettingsCard.createDiv({
            cls: 'ert-sub-card-note',
            text: 'Adds 0.25" to the inner margin so text clears the spine when printed and bound (KDP/IngramSpark). Leave off for screen-reading PDFs.'
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
        this.createSectionHeading(sceneIdCard, 'Scene ID');
        sceneIdCard.createDiv({
            cls: 'ert-sub-card-note',
            text: 'Controls inclusion of SceneID to identify scenes. Helpful for various AI-assisted editorial workflows.'
        });
        this.renderEditorialistPlug(sceneIdCard);
        const sceneIdRow = sceneIdCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        sceneIdRow.createSpan({
            cls: 'ert-manuscript-toggle-label',
            text: 'Append SceneID to TOC entries and scene headings',
        });
        this.sceneIdToggle = new ToggleComponent(sceneIdRow)
            .setValue(this.includeSceneId)
            .onChange((value) => {
                this.includeSceneId = value;
                this.updateTemplateActionButtonState();
            });

        this.exportCleanupCard = publishingBody.createDiv({ cls: 'ert-manuscript-rule-block ert-manuscript-rule-block--separated' });
        this.createSectionHeading(this.exportCleanupCard, 'Export cleanup');
        this.exportCleanupCard.createDiv({
            cls: 'ert-sub-card-note',
            text: 'Controls how draft-only elements are removed before final output, including wikilinks, web links, comments, callouts, and block anchors.'
        });

        // Each cleanup toggle: plain-language label on the toggle row, then a
        // muted one-line example in monofont chips beneath it.
        const addCleanupExample = (text: string): void => {
            const note = this.exportCleanupCard?.createDiv({ cls: 'ert-sub-card-note ert-manuscript-cleanup-example' });
            if (note) this.appendInlineCodeText(note, text);
        };

        const linksRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        linksRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Strip links — keeps the display text, removes the link' });
        this.cleanupLinksToggle = new ToggleComponent(linksRow).onChange((value) => {
            this.setActiveCleanupOption('stripLinks', value);
        });
        addCleanupExample('`[[Scene name|alias]]` → alias · `[label](https://…)` → label');

        const aiCommentsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        aiCommentsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Strip author queries — off keeps them for Editorialist review' });
        this.cleanupAiCommentsToggle = new ToggleComponent(aiCommentsRow).onChange((value) => {
            this.setActiveCleanupOption('stripAiComments', value);
        });
        addCleanupExample('`%%ai: Is this scene too slow?%%`');

        const commentsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        commentsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Strip comments — author queries follow the toggle above' });
        this.cleanupCommentsToggle = new ToggleComponent(commentsRow).onChange((value) => {
            this.setActiveCleanupOption('stripComments', value);
        });
        addCleanupExample('`%%draft note%%` · `<!-- hidden note -->`');

        const calloutsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        calloutsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Strip callouts — removes the whole callout block' });
        this.cleanupCalloutsToggle = new ToggleComponent(calloutsRow).onChange((value) => {
            this.setActiveCleanupOption('stripCallouts', value);
        });
        addCleanupExample('`> [!note] Research`');

        const blockIdsRow = this.exportCleanupCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        blockIdsRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: 'Strip block IDs / anchors — removes trailing reference markers' });
        this.cleanupBlockIdsToggle = new ToggleComponent(blockIdsRow).onChange((value) => {
            this.setActiveCleanupOption('stripBlockIds', value);
        });
        addCleanupExample('`^scene-end`');

        const yamlFrontmatterNote = this.exportCleanupCard.createDiv({ cls: 'ert-sub-card-note' });
        this.appendInlineCodeText(yamlFrontmatterNote, '`YAML` blocks are always removed. To pass document metadata to Pandoc instead, use Settings → Publish → Advanced Pandoc (Pro).');
        const protectedNote = this.exportCleanupCard.createDiv({ cls: 'ert-sub-card-note' });
        this.appendInlineCodeText(protectedNote, 'Fenced code blocks, raw `LaTeX` environments, and display math are never modified by cleanup.');

        // H) EXPORT TEMPLATES
        this.templateCard = container.createDiv({ cls: 'ert-glass-card ert-sub-card ert-layout-templates-card' });
        this.createSectionHeading(this.templateCard, 'Saved export presets', 'bookmark');
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
                return;
            }
            void this.applyTemplateById(value);
        });
        const templateActions = this.templateCard.createDiv({ cls: 'ert-template-actions' });
        this.saveTemplateButton = new ButtonComponent(templateActions)
            .setButtonText('Create preset')
            .onClick(() => {
                void this.saveOrUpdateTemplate();
            });
        this.deleteTemplateButton = new ButtonComponent(templateActions)
            .setButtonText('Delete preset')
            .setDestructive()
            .setDisabled(true)
            .onClick(() => {
                const selectedId = this.getCurrentTemplateSelection();
                if (!selectedId) return;
                const template = this.getTemplateList().find(item => item.id === selectedId);
                if (!template) return;
                new DeleteExportTemplateModal(this.app, template.name, () => {
                    void this.deleteTemplate(selectedId);
                }).open();
            });
        this.refreshTemplateDropdown();

        // I) FOOTER
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
            .setButtonText('Open file')
            .onClick(() => this.openOutcomeFile());
        this.openFileButton.buttonEl.addClass('ert-hidden');

        this.cancelButton = new ButtonComponent(actions)
            .setButtonText(t('manuscriptModal.actionCancel'))
            .onClick(() => {
                void this.persistCurrentSnapshot().finally(() => this.close());
            });

        this.outputStatusEl = container.createDiv({ cls: 'ert-manuscript-output-status ert-sub-card-note ert-hidden' });

        this.syncExportUi();
    }

    private updateBadgeSceneCount(): void {
        if (!this.badgeEl) return;
        const bookTitle = getActiveBookTitle(this.plugin.settings, DEFAULT_BOOK_TITLE);
        const count = this.getSelectedSceneCount();
        const words = this.getSelectedWordCount();
        this.badgeEl.setText(`EXPORT — ${bookTitle} • ${count} scenes selected • ${words.toLocaleString()} words`);
    }

    private refreshExportProfileState(): void {
        this.templateProfiles = adaptPandocLayoutsToPublishingModel(this.plugin.settings.pandocLayouts).profiles;
        const storedProfiles = this.getStoredExportProfiles();
        this.exportProfiles = storedProfiles.length > 0
            ? storedProfiles.map(profile => buildModalExportProfile(profile, this.templateProfiles))
            : this.getLegacyTemplateList().map(template => buildModalExportProfileFromLegacyTemplate(template, this.templateProfiles));

        const transientDefault = buildTransientModalExportProfile({
            name: 'Current settings',
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
            cleanup: this.getActiveCleanupOptions(),
            splitMode: this.splitMode,
            splitParts: this.splitParts,
            selectedLayoutId: this.selectedLayoutId,
            templateProfiles: this.templateProfiles,
        });
        this.defaultExportProfile = transientDefault;
        this.defaultExportProfileId = transientDefault.id;

        const activePreferences = this.getActiveBookPublishingPreferences();
        const lastUsedId = activePreferences?.lastUsedExportProfileId
            || this.plugin.settings.lastUsedExportProfileId
            || this.plugin.settings.lastUsedManuscriptExportTemplateId
            || null;
        this.lastUsedExportProfileId = lastUsedId;
        this.lastUsedExportProfile = lastUsedId ? this.exportProfiles.find(profile => profile.id === lastUsedId) : undefined;

        this.selectedExportProfileId = this.lastUsedExportProfile?.id
            || activePreferences?.defaultExportProfileId
            || this.defaultExportProfile?.id
            || this.exportProfiles[0]?.id
            || null;
        this.selectedExportProfile = this.findExportProfileById(this.selectedExportProfileId) || this.defaultExportProfile;
        this.selectedLayoutId = this.resolveLayoutIdForProfile(this.selectedExportProfile);
        this.updateExportProfileSummary();
    }

    private updateExportProfileSummary(): void {
        if (!this.templateSummaryEl) return;
        this.templateSummaryEl.empty();

        const { selectedTemplate, isCreateMode, hasChanges } = this.getSelectedTemplateState();
        const isPandoc = this.exportType === 'manuscript' && this.outputFormat === 'pdf';
        this.templateSummaryEl.toggleClass('ert-hidden', !isPandoc);

        if (isPandoc) {
            const summaryProfile = selectedTemplate
                ? this.createTemplateSnapshot(selectedTemplate.name, selectedTemplate.id)
                : this.createTemplateSnapshot('Current settings');
            const templateProfile = this.templateProfiles.find(item => item.id === summaryProfile.templateProfileId);
            const templateName = templateProfile
                ? this.formatTemplateProfileName(templateProfile)
                : 'Unknown template';

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
                text: isCreateMode ? 'Draft' : hasChanges ? 'Modified' : 'Saved'
            });

            this.templateSummaryEl.createSpan({
                cls: 'ert-export-preset-summary-text',
                text: ` ${summaryProfile.usageContext} · ${templateName}`
            });
        }

        if (this.templateHintEl) {
            this.templateHintEl.setText(
                isCreateMode
                    ? 'Current settings are not saved as a preset yet.'
                    : hasChanges
                        ? 'Current settings differ from this preset. Update preset to save changes.'
                        : 'Preset matches current settings.'
            );
            this.templateHintEl.toggleClass('ert-export-preset-hint--warning', hasChanges);
            this.templateHintEl.toggleClass('ert-export-preset-hint--muted', !hasChanges);
        }

        this.exportTemplateDropdown?.toggleClass('ert-input--warning', hasChanges);
    }

    private getSelectedTemplateState(): {
        selectedTemplate?: ModalExportProfile;
        isCreateMode: boolean;
        hasChanges: boolean;
    } {
        const selectedId = this.getCurrentTemplateSelection();
        const selectedTemplate = selectedId
            ? this.getTemplateList().find(item => item.id === selectedId)
            : undefined;
        const isCreateMode = !selectedTemplate;
        return {
            selectedTemplate,
            isCreateMode,
            hasChanges: selectedTemplate ? this.hasSelectedTemplateChanges(selectedTemplate) : false
        };
    }

    private findExportProfileById(id: string | null | undefined): ModalExportProfile | undefined {
        const normalized = (id || '').trim();
        if (!normalized) return undefined;
        return this.exportProfiles.find(profile => profile.id === normalized)
            || (this.defaultExportProfile?.id === normalized ? this.defaultExportProfile : undefined);
    }

    private resolveLayoutIdForProfile(profile: ModalExportProfile | undefined): string | undefined {
        if (!profile) return undefined;
        return profile.templateProfileId || profile.selectedLayoutId;
    }

    private openPublishingSettings(sectionKey: string = 'pdf-style'): void {
        this.close();
        this.plugin.settingsTab?.revealSettingsSection('publishing', sectionKey);
        // @ts-ignore - Obsidian API
        this.app.setting.open();
        // @ts-ignore - Obsidian API
        this.app.setting.openTabById('radial-timeline');
    }

    private refreshValidationSnapshot(): void {
        const activeBook = getActiveBook(this.plugin.settings);
        const selectedProfile = this.selectedExportProfile || this.defaultExportProfile;
        this.validationSnapshot = this.plugin.getPublishingValidationService().collect(activeBook?.id, {
            exportType: this.exportType,
            outputFormat: this.exportType === 'outline' ? 'markdown' : this.outputFormat,
            manuscriptPreset: this.manuscriptPreset,
            selectedLayoutId: this.selectedLayoutId || this.resolveLayoutIdForProfile(selectedProfile),
        });
    }

    private getTemplateList(): ModalExportProfile[] {
        return Array.isArray(this.exportProfiles) ? this.exportProfiles : [];
    }

    private getStoredExportProfiles(): ExportProfile[] {
        const profiles = this.plugin.settings.exportProfiles;
        return Array.isArray(profiles) ? profiles : [];
    }

    private getLegacyTemplateList(): ManuscriptExportTemplate[] {
        const templates = this.plugin.settings.manuscriptExportTemplates;
        return Array.isArray(templates) ? templates : [];
    }

    private getActiveBookPublishingPreferences(): BookPublishingPreferences | null {
        const activeBook = getActiveBook(this.plugin.settings);
        if (!activeBook) return null;
        const preferences = this.plugin.settings.bookPublishingPreferences;
        if (!Array.isArray(preferences)) return null;
        return preferences.find(entry => entry.bookId === activeBook.id) || null;
    }

    private async persistTemplateList(list: ModalExportProfile[]): Promise<void> {
        this.exportProfiles = list;
        const storedProfiles = list.map(profile => buildPersistedExportProfileFromModalExportProfile(profile));
        this.plugin.settings.exportProfiles = storedProfiles;
        this.plugin.settings.manuscriptExportTemplates = list.map(profile => buildLegacyTemplateFromModalExportProfile(profile, {
            order: profile.order,
            subplot: profile.subplot,
            selectedLayoutId: profile.selectedLayoutId,
            createdAt: profile.createdAt,
        }));
        await this.plugin.saveSettings();
    }

    private getCurrentTemplateSelection(): string | null {
        const dropdownValue = (this.exportTemplateDropdown?.value || '').trim();
        const selectedValue = (this.selectedExportProfileId || '').trim();
        const value = dropdownValue || selectedValue;
        const trimmed = value.trim();
        if (!trimmed) return null;
        return this.getTemplateList().some(template => template.id === trimmed) ? trimmed : null;
    }

    private async rememberLastUsedTemplate(templateId: string | null): Promise<void> {
        this.plugin.settings.lastUsedExportProfileId = templateId || undefined;
        this.plugin.settings.lastUsedManuscriptExportTemplateId = templateId || undefined;
        const activeBook = getActiveBook(this.plugin.settings);
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
        placeholder.text = 'Create new preset';
        placeholder.disabled = false;
        placeholder.selected = !this.selectedExportProfileId;
        this.exportTemplateDropdown.appendChild(placeholder);

        templates.forEach(template => {
            const option = doc.win.createEl('option');
            option.value = template.id;
            option.text = template.name;
            if (this.selectedExportProfileId && this.selectedExportProfileId === template.id) {
                option.selected = true;
                placeholder.selected = false;
            }
            this.exportTemplateDropdown?.appendChild(option);
        });

        const hasActiveTemplate = !!this.selectedExportProfileId
            && templates.some(template => template.id === this.selectedExportProfileId);
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
            cleanup: mode.isManuscript
                ? this.getActiveCleanupOptions()
                : getDefaultManuscriptCleanupOptions('markdown'),
            splitMode: mode.showSplit ? this.splitMode : 'single',
            splitParts: mode.showSplit && this.splitMode === 'parts' ? this.splitParts : 1,
            selectionPolicy: mode.isPdfManuscript ? 'full-book' : 'manual-range',
            order: this.order,
            subplot: this.subplot,
            selectedLayoutId: mode.isPdfManuscript ? selectedLayoutId : undefined,
            createdAt: new Date().toISOString(),
        };
    }

    private createComparableTemplatePayload(template: ModalExportProfile): ModalExportProfile {
        return {
            order: template.order,
            subplot: template.subplot,
            cleanup: this.getNormalizedCleanupOptions(template.cleanup, template.outputFormat),
            selectionPolicy: template.selectionPolicy,
            id: template.id,
            name: template.name,
            templateProfileId: template.templateProfileId,
            usageContext: template.usageContext,
            outputFormat: template.outputFormat,
            exportType: template.exportType,
            outlinePreset: template.outlinePreset,
            tocMode: template.tocMode,
            includeSceneIdInToc: template.includeSceneIdInToc,
            includeSceneIdInHeading: template.includeSceneIdInHeading,
            includeMatter: template.includeMatter,
            includeSynopsis: template.includeSynopsis,
            updateWordCounts: template.updateWordCounts,
            saveMarkdownArtifact: template.saveMarkdownArtifact,
            splitMode: template.splitMode,
            splitParts: template.splitParts,
            selectedLayoutId: template.selectedLayoutId
        };
    }

    private createComparablePayloadFromCurrent(template: ModalExportProfile): ReturnType<ManuscriptOptionsModal['createComparableTemplatePayload']> {
        const current = this.createTemplateSnapshot(template.name, template.id);
        return this.createComparableTemplatePayload(current);
    }

    private createComparablePayloadFromSavedTemplate(template: ModalExportProfile): ReturnType<ManuscriptOptionsModal['createComparableTemplatePayload']> {
        const isOutline = template.exportType === 'outline';
        const outputFormat: ExportFormat = isOutline ? 'markdown' : template.outputFormat;
        const isPdfManuscript = !isOutline && outputFormat === 'pdf';
        const normalizedCleanup = isOutline
            ? getDefaultManuscriptCleanupOptions('markdown')
            : this.getNormalizedCleanupOptions(template.cleanup, outputFormat);
        const normalized: ModalExportProfile = {
            ...template,
            cleanup: normalizedCleanup,
            outputFormat,
            tocMode: !isOutline && outputFormat === 'markdown' ? template.tocMode : 'none',
            updateWordCounts: !isOutline ? !!template.updateWordCounts : false,
            includeSynopsis: isOutline ? !!template.includeSynopsis : false,
            includeMatter: !isOutline ? !!template.includeMatter : false,
            saveMarkdownArtifact: isPdfManuscript ? !!template.saveMarkdownArtifact : false,
            splitMode: !isOutline && template.splitMode === 'parts' ? 'parts' : 'single',
            splitParts: !isOutline && template.splitMode === 'parts'
                ? this.clampSplitParts(template.splitParts ?? 1)
                : 1,
            selectedLayoutId: isPdfManuscript ? template.selectedLayoutId : undefined
        };
        return this.createComparableTemplatePayload(normalized);
    }

    private hasSelectedTemplateChanges(template: ModalExportProfile): boolean {
        const currentPayload = this.createComparablePayloadFromCurrent(template);
        const savedPayload = this.createComparablePayloadFromSavedTemplate(template);
        return JSON.stringify(currentPayload) !== JSON.stringify(savedPayload);
    }

    private updateTemplateActionButtonState(): void {
        const { selectedTemplate, isCreateMode, hasChanges } = this.getSelectedTemplateState();

        if (this.saveTemplateButton) {
            if (isCreateMode) {
                this.saveTemplateButton.setButtonText('Create preset');
                this.saveTemplateButton.setDisabled(false);
            } else {
                this.saveTemplateButton.setButtonText(hasChanges ? 'Update preset' : 'Preset up to date');
                this.saveTemplateButton.setDisabled(!hasChanges);
            }
        }

        this.deleteTemplateButton?.setDisabled(!selectedTemplate);
        this.updateExportProfileSummary();
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
        new Notice(`Preset "${template.name}" ${existingId ? 'updated' : 'saved'}.`);
    }

    private async saveOrUpdateTemplate(): Promise<void> {
        const selectedId = this.getCurrentTemplateSelection();
        if (selectedId) {
            const existing = this.getTemplateList().find(item => item.id === selectedId);
            if (!existing) return;
            if (!this.hasSelectedTemplateChanges(existing)) {
                this.updateTemplateActionButtonState();
                return;
            }
            await this.saveTemplate(existing.name, existing.id);
            return;
        }
        const defaultName = `Manuscript Export ${new Date().toLocaleDateString()}`;
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
        if (this.plugin.settings.lastUsedManuscriptExportTemplateId === templateId) {
            await this.rememberLastUsedTemplate(null);
        }
        this.refreshTemplateDropdown();
        this.updateExportProfileSummary();
        new Notice('Preset deleted.');
    }

    private async applyTemplateById(templateId: string): Promise<void> {
        const template = this.getTemplateList().find(item => item.id === templateId);
        if (!template) {
            new Notice('Preset not found.');
            return;
        }
        await this.applyTemplate(template);
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
        // Saved presets may store either flag (legacy two-toggle UI) or both.
        // Either being true implies the consolidated SceneId toggle is on.
        const fromTemplate = template.includeSceneIdInToc ?? template.includeSceneIdInHeading;
        if (typeof fromTemplate === 'boolean') {
            this.includeSceneId = fromTemplate;
        }
        this.sceneIdToggle?.setValue(this.includeSceneId);
        this.order = template.order;
        this.subplot = template.subplot || 'All Subplots';
        this.updateWordCounts = !!template.updateWordCounts;
        this.includeSynopsisUserChoice = !!template.includeSynopsis;
        this.includeMatterUserChoice = !!template.includeMatter;
        this.includeMatter = this.includeMatterUserChoice;
        this.hasTouchedMatterToggle = true;
        this.saveMarkdownArtifact = !!template.saveMarkdownArtifact;
        const templateCleanup = this.getNormalizedCleanupOptions(template.cleanup, template.outputFormat);
        if (this.getCleanupFormatForState(template.outputFormat) === 'pdf') {
            this.pdfCleanupOptions = templateCleanup;
        } else {
            this.markdownCleanupOptions = templateCleanup;
        }
        this.splitMode = template.splitMode === 'parts' ? 'parts' : 'single';
        this.splitParts = this.clampSplitParts(template.splitParts ?? this.splitParts);
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
        const restoreSavedRange = !requestedOpenScenes;
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
            new Notice(`Applied preset "${template.name}".`);
        }
    }

    private async restoreLastUsedTemplate(): Promise<void> {
        const activePreferences = this.getActiveBookPublishingPreferences();
        const snapshot = activePreferences?.lastUsedExportProfileSnapshot;
        if (snapshot) {
            const modalSnapshot = buildModalExportProfile(snapshot, this.templateProfiles);
            await this.applyTemplate(modalSnapshot, { showNotice: false });
            return;
        }
        const lastUsed = this.lastUsedExportProfileId || this.plugin.settings.lastUsedManuscriptExportTemplateId;
        if (!lastUsed) {
            this.refreshTemplateDropdown();
            this.updateExportProfileSummary();
            return;
        }
        const template = this.getTemplateList().find(item => item.id === lastUsed);
        if (!template) {
            this.lastUsedExportProfileId = null;
            this.refreshTemplateDropdown();
            this.updateExportProfileSummary();
            return;
        }
        await this.applyTemplate(template, { showNotice: false });
    }

    private buildCurrentSnapshot(): ExportProfile {
        const persistRange = !this.isOpenScenesMode();
        const transient = buildTransientModalExportProfile({
            id: '__last_used_snapshot__',
            name: 'Last used',
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
            cleanup: this.getActiveCleanupOptions(),
            splitMode: this.splitMode,
            splitParts: this.splitParts,
            selectedLayoutId: this.selectedLayoutId,
            templateProfiles: this.templateProfiles,
            rangeStart: persistRange ? this.rangeStart : undefined,
            rangeEnd: persistRange ? this.rangeEnd : undefined,
        });
        return buildPersistedExportProfileFromModalExportProfile(transient);
    }

    private async persistCurrentSnapshot(): Promise<void> {
        const activeBook = getActiveBook(this.plugin.settings);
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
        text.appendText('See companion app ');
        const link = text.createEl('a', {
            cls: 'ert-link-accent',
            text: 'Editorialist',
        });
        link.setAttribute('href', 'https://community.obsidian.md/plugins/editorialist');
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
        text.appendText('.');
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
                new Notice('This export option is not available.');
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
                new Notice('This output format is not available.');
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
        this.normalizeOutputFormatForOutline();
        const mode = this.getUiMode();
        this.sanitizeStateForMode(mode);
        const shouldLockSelection = mode.lockSceneSelectionToFullBook;
        const showSceneSelectionCards = !shouldLockSelection;

        this.manuscriptOptionsCard?.toggleClass('ert-hidden', !mode.showManuscriptPreset);
        this.outlineOptionsCard?.toggleClass('ert-hidden', !mode.showOutlinePreset);
        this.manuscriptRulesCard?.toggleClass('ert-hidden', !mode.showToc);
        this.tocCard?.toggleClass('ert-hidden', !mode.showToc);
        this.publishingCard?.toggleClass('ert-hidden', !mode.showPublishing);
        this.pdfSettingsCard?.toggleClass('ert-hidden', !mode.showIncludeMatter && !mode.showSavePrecompile);
        this.wordCountCard?.toggleClass('ert-hidden', !mode.showWordCount);
        this.wordCountCard?.toggleClass('ert-manuscript-rule-block--separated', mode.showIncludeMatter || mode.showSavePrecompile);
        this.includeMatterCard?.toggleClass('ert-hidden', !mode.showIncludeMatter);
        this.includeMatterToggle?.setValue(this.includeMatterUserChoice);
        this.exportCleanupCard?.toggleClass('ert-hidden', !mode.showExportCleanup);
        this.synopsisRow?.toggleClass('ert-hidden', !mode.showOutlinePreset);
        this.scopeCard?.toggleClass('ert-hidden', !showSceneSelectionCards || !mode.showScope);
        this.orderingCard?.toggleClass('ert-hidden', !showSceneSelectionCards || !mode.showOrdering);
        this.filterCard?.toggleClass('ert-hidden', !mode.showSubplotFilter);
        this.splitCard?.toggleClass('ert-hidden', !mode.showSplit);
        this.formatPillRowEl?.toggleClass('ert-hidden', !mode.showFormatPills);
        this.formatStaticEl?.toggleClass('ert-hidden', !mode.showFormatStatic);
        this.managePdfLayoutsLinkEl?.toggleClass('ert-hidden', !mode.showManagePdfLayouts);
        this.chronoHelperEl?.toggleClass('ert-hidden', !mode.chronoMessage);

        if (this.documentTypeDescEl) {
            this.documentTypeDescEl.setText(mode.isManuscript
                ? 'A formatted document of your scenes in reading order.'
                : 'A structural summary based on scene metadata and beats.');
        }

        if (this.publishingHeadingTextEl) {
            this.publishingHeadingTextEl.setText(mode.isPdfManuscript ? 'PDF options' : 'Manuscript options');
        }

        let shouldReloadScenes = false;
        if (!mode.showSubplotFilter && this.subplot !== 'All Subplots') {
            this.subplot = 'All Subplots';
            this.subplotDropdown?.setValue('All Subplots');
            shouldReloadScenes = true;
        }
        if (shouldLockSelection && this.order !== 'narrative') {
            this.order = 'narrative';
            shouldReloadScenes = true;
        }
        if (shouldLockSelection) {
            this.rangeStart = 1;
            this.rangeEnd = Math.max(1, this.totalScenes);
            this.updateRangeUI();
        }
        if (shouldReloadScenes) {
            void this.loadScenesForOrder();
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
        this.updateActionButtonLabel();
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
            emptyRow.createSpan({ text: `No layouts for ${this.manuscriptPreset}. ` });
            const link = emptyRow.createEl('a', {
                text: 'Manage layouts\u2026',
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
            desc.createDiv({ cls: 'ert-manuscript-layout-summary-detail', text: 'Choose a PDF layout to continue.' });
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
            proPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: 'Pro' });
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
        const activeBook = getActiveBook(this.plugin.settings);
        const mode = activeBook?.layoutOptions?.[layout.id]?.sceneHeadingMode;
        return mode === 'scene-number' || mode === 'scene-number-title' || mode === 'title-only'
            ? mode
            : 'scene-number-title';
    }

    private getActiveBookReference(): BookProfile | null {
        const active = getActiveBook(this.plugin.settings);
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
            return 'Book styling with part pages, epigraph support, and chapter treatments.';
        }
        if (sourceLayout?.hasSceneOpenerHeadingOptions) {
            return 'Literary styling with scene opener controls and polished running heads.';
        }
        if (profile.id === 'bundled-fiction-contemporary-literary') {
            return 'A polished reading draft style with clean headers and comfortable book-page spacing.';
        }
        return 'A clean manuscript format for reliable PDF export.';
    }

    private formatTemplateIdName(templateId: string, fallbackName: string): string {
        const profile = this.templateProfiles.find(item => item.id === templateId || item.legacyLayoutId === templateId);
        return this.formatTemplateProfileName(profile) || fallbackName;
    }

    private getRttsLevelLabel(level: NonNullable<PublishingValidationSnapshot['templateCompatibility']>['level']): string {
        switch (level) {
            case 'invalid':
                return 'Invalid';
            case 'compatible':
                return 'Compatible';
            case 'legacy':
            default:
                return 'Legacy';
        }
    }

    private formatValidationIssue(issue: NonNullable<PublishingValidationSnapshot['templateCompatibilityIssues']>[number]): string {
        const prefix = issue.level === 'error'
            ? 'ERROR'
            : issue.level === 'warning'
                ? 'WARNING'
                : 'INFO';
        return `${prefix}: ${issue.message}`;
    }

    private collectTemplateTechnicalLines(): string[] {
        const lines: string[] = [];
        const compatibility = this.validationSnapshot?.templateCompatibility;
        if (compatibility) {
            lines.push(`Template: ${this.formatTemplateIdName(compatibility.templateId, compatibility.templateName)}`);
            lines.push(`RTTS level: ${this.getRttsLevelLabel(compatibility.level)}`);
            lines.push(compatibility.variables.hasBody ? '$body$: Ready' : '$body$: Missing');
            lines.push(compatibility.variables.hasTitle ? '$title$: Available' : '$title$: Not exposed');
            lines.push(compatibility.variables.hasAuthor ? '$author$: Available' : '$author$: Not exposed');
            for (const [hook, present] of Object.entries(compatibility.variables.hooks)) {
                lines.push(`$${hook}$: ${present ? 'Available' : 'Not exposed'}`);
            }
        }
        for (const issue of this.validationSnapshot?.templateCompatibilityIssues || []) {
            lines.push(`Compatibility ${this.formatValidationIssue(issue)}`);
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
        // Reset font-block flag at the top of every render. The block is only
        // re-asserted when the spec-driven diagnostic reports state !== 'ok'
        // for the currently-selected PDF layout.
        const previousBlocked = this.isPdfFontBlocked;
        this.isPdfFontBlocked = false;

        if (!this.templateWarningEl || this.exportType !== 'manuscript') {
            if (this.templateWarningEl) {
                this.templateWarningEl.empty();
                this.templateWarningEl.addClass('ert-manuscript-preset-status--hidden');
            }
            if (previousBlocked) this.updateActionButtonDisabledState();
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
            if (previousBlocked) this.updateActionButtonDisabledState();
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
            text.createDiv({ cls: 'ert-pdf-output-title', text: 'PDF output' });
            text.createDiv({ cls: 'ert-pdf-output-line', text: validation.error || 'Layout template not found.' });
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
        // STRICT FONT POLICY (Phase 1): when the spec-driven diagnostic reports
        // a missing font for the selected PDF layout, hard-block the Export
        // button. The action-button disabled-state code consumes this flag.
        // (We're guaranteed to be in PDF format here — the markdown branch
        // returned above.)
        this.isPdfFontBlocked = structuredFontDiag.state !== 'ok';
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
        const fontSummaryLine = `Font: ${displayRequestedFont || resolvedFont || 'Default serif'}`;
        const layoutDesc = this.formatTemplateProfileName(selectedProfile) || selectedLayout.name || 'Custom';
        const willEmbed = fontDiagnostics.usesFontspec;

        // ── Build technical details (hidden by default) ──────────────
        const technicalLines: string[] = [];
        if (displayRequestedFont) {
            const requestedType = this.getFontFamilyType(displayRequestedFont);
            technicalLines.push(`Requested font: ${displayRequestedFont} (${requestedType})`);
        }
        if (useLegacyFontProbe && hasPrimaryMissing && fallbackFont && fallbackFont !== primaryRequested) {
            const fallbackType = this.getFontFamilyType(fallbackFont);
            technicalLines.push(`Fallback: ${fallbackFont} (${fallbackType})`);
        }
        technicalLines.push(`Engine: ${engineSelection.engine}`);
        if (willEmbed) {
            technicalLines.push('Font embedding: enabled');
        }
        technicalLines.push(`Resolved font: ${resolvedFont}`);
        technicalLines.push(`Page layout: ${layoutDesc}`);
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
            readyLine.createSpan({ text: 'Export checks · Ready' });
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
                details.createEl('summary', { text: 'View technical details' });
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
        titleRow.createSpan({ text: 'Export checks' });
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
                        || 'Required bundled font files are missing from Radial Timeline/Pandoc/fonts. Click Install fonts in Settings > Publish.'
                    );
                } else {
                    // Missing system font — render the required-font message,
                    // followed by the OS-tailored install hint, an inline
                    // download link when applicable, and short install steps.
                    const primaryName = structuredFontDiag.primaryFontName;
                    line.appendText(`Font: ${primaryName} is not installed. Install it before exporting.`);
                    const hint = structuredFontDiag.installHint;
                    if (hint) {
                        const hintLine = content.createDiv({ cls: 'ert-pdf-output-line' });
                        hintLine.appendText(`${hint.message} `);
                        if (hint.url) {
                            const a = hintLine.createEl('a', {
                                cls: 'ert-link-accent',
                                text: 'Open Google Fonts download page',
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
                    text: `Font: Using ${fallbackFont} — install ${primaryRequested} for the intended look.`
                });
            } else if (useLegacyFontProbe && hasPrimaryMissing && primaryRequested) {
                content.createDiv({
                    cls: 'ert-pdf-output-line',
                    text: `Font: ${primaryRequested} is not installed. Install it before exporting.`
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
            details.createEl('summary', { text: 'View technical details' });
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
        if (!primaryRequested) return 'Default serif';
        if (!canVerifyFonts) return primaryRequested;
        if (hasPrimaryMissing && fallbackFont && fallbackFont !== primaryRequested) return fallbackFont;
        if (hasPrimaryMissing) return `${primaryRequested} (not found)`;
        return primaryRequested;
    }

    /**
     * Update manuscript preset description
     */
    private updateManuscriptPresetDescription(): void {
        if (!this.manuscriptPresetDescEl) return;
        this.manuscriptPresetDescEl.textContent = 'Formats your scenes into a readable manuscript.';
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

    /**
     * Update manuscript preset preview content
     */
    private updateManuscriptPreview(): void {
        if (!this.manuscriptPreviewPanel) return;
        this.manuscriptPreviewPanel.empty();

        const previewContent = this.manuscriptPreviewPanel.createDiv({ cls: 'ert-manuscript-preview-content' });
        
        const sample = `## Scene 1: Opening

The morning sun cast long shadows across the empty street.
Sarah stood at the window, watching the world wake up.`;
        previewContent.createEl('pre', { 
            text: sample,
            cls: 'ert-manuscript-preview-sample'
        });
    }

    /**
     * Update outline preset preview content
     */
    private updateOutlinePreview(): void {
        if (!this.outlinePreviewPanel) return;
        this.outlinePreviewPanel.empty();

        const previewContent = this.outlinePreviewPanel.createDiv({ cls: 'ert-manuscript-preview-content' });
        
        const samples: Record<OutlinePreset, string> = {
            'beat-sheet': `1. Opening Image
2. Theme Stated
3. Setup
4. Catalyst
5. Debate`,
            'episode-rundown': `1. Cold Open · Jan 1 [2:30]
2. Theme Song [0:15]
3. Act One · Jan 1 [8:45]
4. Act Two · Jan 2 [12:20]
5. Closing [1:00]`,
            'shooting-schedule': `Scene | Location      | Time  | Subplot
------|---------------|-------|----------
1     | Apartment     | 2:30  | Main Plot
2     | Street        | 5:15  | Main Plot
3     | Office        | 8:45  | Subplot A`,
            'index-cards-csv': `Scene,Title,When,Runtime,Words,Subplot
1,Opening,2024-01-01,2:30,450,Main Plot
2,Confrontation,2024-01-02,5:15,820,Main Plot`,
            'index-cards-json': `{
  "scenes": [
    {"scene": 1, "title": "Opening", 
     "when": "2024-01-01", "runtime": "2:30"},
    {"scene": 2, "title": "Confrontation",
     "when": "2024-01-02", "runtime": "5:15"}
  ]
}`
        };

        const sample = samples[this.outlinePreset] || '';
        previewContent.createEl('pre', { 
            text: sample,
            cls: 'ert-manuscript-preview-sample'
        });
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

    private clampSplitParts(value: number): number {
        if (!Number.isFinite(value)) return 2;
        return Math.max(2, Math.min(20, Math.floor(value)));
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
        // STRICT FONT POLICY (Phase 1): block Export when PDF format is
        // selected and the layout's required font is not installed.
        // The export-checks panel renders an "Install" affordance with
        // platform-specific instructions; the user must resolve the missing
        // font (or pick a different layout) before the button re-enables.
        const fontBlocked = this.isPdfFontBlocked && this.outputFormat === 'pdf';
        this.actionButton.setDisabled(
            this.totalScenes === 0 || splitInvalid || fontBlocked
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
                this.splitErrorEl.setText(`Not enough scenes selected to split into ${this.splitParts} parts.`);
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
                this.splitPreviewEl.createDiv({ text: `Will generate ${this.splitParts} files:` });
                preview.ranges.forEach(range => {
                    const globalStartPosition = this.rangeStart + range.start - 1;
                    const globalEndPosition = this.rangeStart + range.end - 1;
                    const displayStart = this.getSceneNumberAt(globalStartPosition);
                    const displayEnd = this.getSceneNumberAt(globalEndPosition);
                    this.splitPreviewEl?.createDiv({
                        cls: 'ert-sub-card-note',
                        text: `Part ${range.part} (Scenes ${displayStart}–${displayEnd})`
                    });
                });
            }
        }

        this.updateActionButtonDisabledState();
        this.updateTemplateActionButtonState();
    }

    private getPrimaryActionLabel(): string {
        if (this.exportCompleted) return 'Done';
        const mode = this.getUiMode();
        const base = mode.isOutline
            ? 'Generate Outline'
            : mode.isPdfManuscript
                ? 'Generate PDF'
                : mode.isDocxManuscript
                    ? 'Generate Word'
                    : 'Generate Markdown';
        const files = mode.showSplit ? this.getPlannedOutputCount() : 1;
        return files > 1 ? `${base} (${files} files)` : base;
    }

    private getOpenFolderButtonLabel(): string {
        if (Platform?.isMacOS) return 'Reveal in Finder';
        if (Platform?.isWin) return 'Open in Explorer';
        return 'Open folder';
    }

    private updateActionButtonLabel(): void {
        this.actionButton?.setButtonText(this.getPrimaryActionLabel());
    }

    private renderStatusPathGroup(label: 'Saved' | 'Rendered', paths: string[]): void {
        if (!this.outputStatusEl || paths.length === 0) return;

        const summary = this.outputStatusEl.createDiv();
        summary.createSpan({ text: `${label}: ` });
        const firstLink = summary.createEl('a', { text: paths[0], attr: { href: '#' } });
        firstLink.addEventListener('click', (evt) => {
            evt.preventDefault();
            void this.openVaultPath(paths[0]);
        });
        if (paths.length > 1) {
            summary.createSpan({ text: ` (${paths.length} files)` });
        }

        if (paths.length > 1) {
            const second = this.outputStatusEl.createDiv({ cls: 'ert-sub-card-note' });
            const secondLink = second.createEl('a', { text: paths[1], attr: { href: '#' } });
            secondLink.addEventListener('click', (evt) => {
                evt.preventDefault();
                void this.openVaultPath(paths[1]);
            });
        }

        if (paths.length > 2) {
            this.outputStatusEl.createDiv({ cls: 'ert-sub-card-note', text: `+${paths.length - 2} more` });
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

        this.renderStatusPathGroup('Saved', savedPaths);
        this.renderStatusPathGroup('Rendered', renderedPaths);
        if (outcome.messages && outcome.messages.length > 0) {
            outcome.messages.forEach(message => {
                this.outputStatusEl?.createDiv({ text: message });
            });
        }
        this.outputStatusEl.toggleClass('ert-hidden', savedPaths.length === 0 && renderedPaths.length === 0 && !(outcome.messages && outcome.messages.length > 0));
    }

    private showExportFailure(error: unknown): void {
        if (!this.outputStatusEl) return;
        const failure = categorizeExportError(error);
        this.outputStatusEl.empty();
        this.outputStatusEl.removeClass('ert-hidden');
        this.outputStatusEl.createDiv({ text: failure.message });
        if (failure.detail) {
            const detailsEl = this.outputStatusEl.createEl('details', { cls: 'ert-sub-card-note' });
            detailsEl.createEl('summary', { text: 'Details' });
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
        new Notice(`Unable to open: ${vaultPath}`);
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
            new Notice('No output to reveal yet.');
            return;
        }

        if (filePath && await this.revealInSystemFileManager(filePath, 'file')) return;
        if (folderPath && await this.revealInSystemFileManager(folderPath, 'folder')) return;

        // Fallback: in-app file explorer (mobile / no electron)
        const target = folderPath || filePath;
        if (!target) return;
        const abstract = this.app.vault.getAbstractFileByPath(target);
        if (!abstract) {
            new Notice(`Path not found: ${target}`);
            return;
        }
        if (!this.revealInFileExplorer(abstract)) {
            new Notice('Unable to reveal in file explorer.');
        }
    }

    private getOutcomeFilePath(): string | null {
        return this.lastOutcome?.renderedPath
            || this.lastOutcome?.savedPath
            || this.lastOutcome?.renderedPaths?.[0]
            || this.lastOutcome?.savedPaths?.[0]
            || null;
    }

    private openOutcomeFile(): void {
        const filePath = this.getOutcomeFilePath();
        if (!filePath) {
            new Notice('No output file to open yet.');
            return;
        }
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            new Notice(`File not found: ${filePath}`);
            return;
        }
        void this.app.workspace.openLinkText(filePath, '', 'tab');
        this.close();
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

        const attach = (handle: HTMLElement, handleType: DragHandle) => {
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

    // Data loading -----------------------------------------------------------
    private async loadSubplots(): Promise<void> {
        if (!this.subplotDropdown) return;
        
        try {
            const scenes = await this.plugin.getSceneData();
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
            this.subplotDropdown.addOption('All Subplots', 'All subplots');
            const openCount = this.openScenePathsSnapshot.size;
            if (openCount > 0) {
                this.subplotDropdown.addOption(OPEN_SCENES_FILTER, `Open Scenes (${openCount})`);
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
        try {
            const isPdfManuscript = this.isPdfManuscriptExport();
            const effectiveOrder: ManuscriptOrder = isPdfManuscript ? 'narrative' : this.order;
            const isOpenScenes = this.isOpenScenesMode();
            const effectiveSubplot = isPdfManuscript || this.subplot === 'All Subplots' || isOpenScenes ? undefined : this.subplot;
            const result = await getSceneFilesByOrder(this.app, this.plugin, effectiveOrder, effectiveSubplot);
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

            this.updateBadgeSceneCount();

            this.loadingEl?.remove();
            this.updateRangeUI();
            this.syncRangeAvailability();
            this.updateOrderPillsState();
            this.syncExportUi();
        } catch (err) {
            console.error(err);
            this.loadingEl?.setText(t('manuscriptModal.loadError'));
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
        this.rangeStatusEl?.setText(`${count} scenes selected`);
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

        this.startHandleEl.style.left = `${startPercent}%`;
        this.endHandleEl.style.left = `${endPercent}%`;
        this.rangeFillEl.style.left = `${startPercent}%`;
        this.rangeFillEl.style.width = `${Math.max(endPercent - startPercent, 1)}%`; // SAFE: inline style used for live drag track sizing

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
                chip.createDiv({ cls: 'ert-manuscript-scene-chip-num', text: `Scene ${num}` });
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

    // Submission -------------------------------------------------------------
    private async submit(): Promise<void> {
        if (this.totalScenes === 0) {
            new Notice(t('manuscriptModal.emptyNotice'));
            return;
        }
        if (!this.isSplitSelectionValid()) {
            new Notice(`Not enough scenes selected to split into ${this.splitParts} parts.`);
            this.updateActionButtonDisabledState();
            return;
        }
        this.normalizeOutputFormatForOutline();
        const mode = this.getUiMode();
        this.sanitizeStateForMode(mode);
        const tocMode: TocMode = mode.showToc ? this.tocMode : 'none';
        const includeMatter = mode.showIncludeMatter ? this.includeMatterUserChoice : false;
        const includeSynopsis = mode.isOutline ? this.includeSynopsisUserChoice : false;
        const lockSceneSelection = mode.lockSceneSelectionToFullBook;
        const submissionOrder: ManuscriptOrder = lockSceneSelection ? 'narrative' : this.order;
        const submissionRangeStart = lockSceneSelection ? undefined : this.rangeStart;
        const submissionRangeEnd = lockSceneSelection ? undefined : this.rangeEnd;
        const isOpenScenes = this.isOpenScenesMode();
        const submissionSubplot = lockSceneSelection || isOpenScenes
            ? undefined
            : this.subplot === 'All Subplots'
                ? undefined
                : this.subplot;
        const submissionScenePathFilter = !lockSceneSelection && isOpenScenes
            ? this.getSelectedScenePaths()
            : undefined;

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
            const selectedProfile = this.selectedExportProfile || this.defaultExportProfile || this.getTemplateList()[0];
            const selectedLayoutId = this.resolveLayoutIdForProfile(selectedProfile);
            if (selectedProfile?.id && selectedProfile.id !== this.defaultExportProfile?.id) {
                await this.rememberLastUsedTemplate(selectedProfile.id);
            }
            const outcome = await this.onSubmit({
                order: submissionOrder,
                tocMode,
                includeSceneIdInToc: tocMode !== 'none' ? this.includeSceneId : false,
                includeSceneIdInHeading: this.includeSceneId,
                rangeStart: submissionRangeStart,
                rangeEnd: submissionRangeEnd,
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
                exportCleanup: mode.isManuscript ? this.getActiveCleanupOptions() : undefined,
                exportProfileId: selectedProfile?.id,
                exportProfileTemplateId: selectedLayoutId,
                selectedLayoutId: mode.isPdfManuscript ? selectedLayoutId : undefined,
                splitMode: mode.showSplit ? this.splitMode : 'single',
                splitParts: mode.showSplit && this.isSplitEnabled() ? this.splitParts : 1
            });
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
            this.exportCompleted = true;
            this.lastOutcome = outcome;
            this.showOutputStatus(outcome);
            this.actionButton?.setDisabled(false);
            this.openFolderButton?.buttonEl.toggleClass('ert-hidden', !this.getOutcomeFolderPath());
            this.openFileButton?.buttonEl.toggleClass('ert-hidden', !this.getOutcomeFilePath());
            this.cancelButton?.buttonEl.addClass('ert-hidden');
            this.updateActionButtonLabel();
        } catch (err) {
            console.error(err);
            const failure = categorizeExportError(err);
            new Notice(failure.message);
            this.showExportFailure(failure);
            this.exportCompleted = false;
            this.updateActionButtonDisabledState();
            this.updateActionButtonLabel();
        }
    }
}
