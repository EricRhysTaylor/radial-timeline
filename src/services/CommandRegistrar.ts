/*
 * CommandRegistrar
 * Encapsulates all command+ribbon registration.
 */

import { App, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookLayoutOptions, BookMeta, ManuscriptExportCleanupOptions, PublishingValidationSnapshot } from '../types';
import { assembleManuscript, getSceneFilesByOrder, ManuscriptSceneSelection, type AssembledManuscript, type ManuscriptSceneHeadingMode, updateSceneWordCounts } from '../utils/manuscript';
import { openGossamerScoreEntry, runGossamerAiAnalysis } from '../GossamerCommands';
import { summarizePerfMeasurements, resetPerfMeasurements } from '../renderer/utils/Performance';
import { registerRuntimeCommands } from '../RuntimeCommands';
import type { SceneAnalysisService } from './SceneAnalysisService';
import { ManageSubplotsModal } from '../modals/ManageSubplotsModal';
import { ManuscriptOptionsModal, ManuscriptModalResult, type ManuscriptExportOutcome } from '../modals/ManuscriptOptionsModal';
import { PlanetaryTimeModal } from '../modals/PlanetaryTimeModal';
import { BookDesignerModal } from '../modals/BookDesignerModal';
import { OnboardingModal } from '../modals/OnboardingModal';
import { TimelineRepairModal } from '../modals/TimelineRepairModal';
import { TimelineAuditModal } from '../modals/TimelineAuditModal';
import { AuthorProgressModal } from '../modals/AuthorProgressModal';
import { TimelineImageExportModal } from '../modals/TimelineImageExportModal';
import { TimelineDataExportConsentModal } from '../modals/TimelineDataExportConsentModal';
import { TimelineExportService } from './export/TimelineExportService';
import { CreateRtNoteModal, type RtNoteSubtypeId } from '../modals/CreateRtNoteModal';
import { buildEntityNoteContent, entityFolderFor, type EntityKind } from '../utils/entityNotes';
import { ensureActiveBookFolder } from '../modals/EnsureFirstBookModal';
import { generateSceneContent } from '../utils/sceneGenerator';
import { sanitizeSourcePath, buildInitialSceneFilename, buildInitialBackdropFilename } from '../utils/sceneCreation';
import { getTemplateParts } from '../utils/yamlTemplateNormalize';
import { ensureManuscriptOutputFolder, ensureOutlineOutputFolder } from '../utils/aiOutput';
import { BINDING_GUTTER_LATEX, buildExportFilename, buildPrecursorFilename, buildOutlineExport, getExportFormatExtension, getLayoutById, getStructuredFontDiagnostic, getTemplateFontDiagnostics, getVaultAbsolutePath, parseCustomPandocMetadata, resolveTemplatePath, runPandocOnContent, stemToReadable, validatePandocLayout } from '../utils/exportFormats';
import { isProActive } from '../settings/proEntitlement';
import { ensureManuscriptReferenceDocxInstalled } from '../utils/pandocBundledLayouts';
import { getActiveBookExportContext } from '../utils/exportContext';
import { getActiveBook } from '../utils/books';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { isPathInFolderScope } from '../utils/pathScope';
import { ensureReferenceIdTemplateFrontmatter, ensureSceneTemplateFrontmatter } from '../utils/sceneIds';
import { chunkScenesIntoParts } from '../utils/splitOutput';
import { resolveBookPages, type MatterNoteSummary } from '../utils/bookPagesResolver';
import { ensureBundledLayoutInstalledForExport } from '../utils/pandocBundledLayouts';
import { getLayoutAbbreviation, resolveTemplateAccess, TEMPLATE_ACCESS_FALLBACK_MESSAGE } from '../publishing/templateTiering';
import { areBetaCommandsVisible, hasProFeatureAccess } from '../settings/featureGate';
import { cleanupFormatForOutputFormat, getDefaultManuscriptCleanupOptions, normalizeManuscriptCleanupOptions, sanitizeCompiledManuscript, sanitizeCompiledManuscriptForPdf } from '../utils/manuscriptSanitize';
import { getManuscriptLayoutExportBehavior } from '../utils/manuscriptLayoutExport';
import { ExportFailure, categorizeExportError } from '../utils/exportErrors';
import { getRuntimeSettings } from '../utils/runtimeEstimator';
import { t } from '../i18n';
import { writeManagedOutput } from '../utils/logVaultOps';

export class CommandRegistrar {
    private inquiryRibbonIcon: HTMLElement | null = null;

    constructor(private plugin: RadialTimelinePlugin, private app: App) { }

    // Single orchestration point for every command + ribbon registration.
    // All command paths (registrar-owned, scene-analysis, runtime) flow
    // through here so there is one canonical answer to "what does this
    // plugin register" — no parallel wiring in main.ts.
    registerAll(sceneAnalysisService: SceneAnalysisService): void {
        this.registerRibbon();
        this.registerCommands();
        sceneAnalysisService.registerCommands();
        registerRuntimeCommands(this.plugin);
    }

    public openManuscriptExportModal(): void {
        new ManuscriptOptionsModal(this.app, this.plugin, (result) => this.handleManuscriptExport(result)).open();
    }

    /** Hide or show the Inquiry ribbon icon based on AI enabled state. */
    setInquiryRibbonVisible(visible: boolean): void {
        if (this.inquiryRibbonIcon) {
            this.inquiryRibbonIcon.toggleClass('ert-hidden', !visible);
        }
    }

    private registerRibbon(): void {
        this.plugin.addRibbonIcon('rt-logo', t('commands.openTimeline'), () => {
            void this.plugin.getTimelineService().activateView();
        });
        this.inquiryRibbonIcon = this.plugin.addRibbonIcon('waves', t('commands.openInquiry'), () => {
            void this.plugin.getInquiryService().activateView();
        });
        // Hide Inquiry ribbon if AI is disabled on load
        if (!(this.plugin.settings.enableAiSceneAnalysis ?? true)) {
            this.inquiryRibbonIcon.toggleClass('ert-hidden', true);
        }
    }

    private registerCommands(): void {
        this.plugin.addCommand({
            id: 'open-radial-timeline-view',
            name: t('commands.openTimeline'),
            callback: () => {
                void this.plugin.getTimelineService().activateView();
            },
        });
        this.plugin.addCommand({
            id: 'open-inquiry-view',
            name: t('commands.openInquiry'),
            callback: () => {
                void this.plugin.getInquiryService().activateView();
            },
        });
        if (areBetaCommandsVisible()) {
            this.plugin.addCommand({
                id: 'inquiry-omnibus-pass',
                name: t('commands.inquiryOmnibusPass'),
                callback: async () => {
                    await this.plugin.getInquiryService().runOmnibusPass();
                },
            });
        }

        this.plugin.addCommand({
            id: 'search-timeline',
            name: t('commands.searchTimeline'),
            callback: () => {
                this.plugin.openSearchPrompt();
            }
        });

        // Dev-only diagnostics: dump hover/render timings + a DOM census so
        // performance work starts from evidence, not guesses. Never ships in
        // release builds.
        if (areBetaCommandsVisible()) {
            this.plugin.addCommand({
                id: 'copy-performance-report',
                name: 'Copy performance report (dev)',
                callback: async () => {
                    const rows = summarizePerfMeasurements(this.plugin);
                    const view = this.plugin.getTimelineViews()[0];
                    const svg = view?.contentEl.querySelector<SVGSVGElement>('.radial-timeline-svg') ?? null;
                    const lines: string[] = ['# Radial Timeline performance report', `- generated: ${new Date().toISOString()}`];
                    if (view) {
                        lines.push(`- mode: ${view.currentMode}`);
                        lines.push(`- timeline items: ${view.sceneData?.length ?? 0}`); // SAFE: diagnostic report line — no scene data loaded reads as 0 items
                    }
                    lines.push('', '## Timings (ms) — *.js = handler cost, *.frame = through the paint after the mutation');
                    if (rows.length === 0) {
                        lines.push('No samples yet — hover scenes on the timeline, then run this again.');
                    } else {
                        lines.push('| label | count | median | p95 | max |', '| --- | ---: | ---: | ---: | ---: |');
                        rows.forEach(r => lines.push(`| ${r.label} | ${r.count} | ${r.median.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.max.toFixed(1)} |`));
                    }
                    if (svg) {
                        const count = (selector: string) => svg.querySelectorAll(selector).length;
                        lines.push('', '## DOM census (active timeline SVG)');
                        lines.push(`- total elements: ${svg.getElementsByTagName('*').length}`);
                        lines.push(`- scene groups: ${count('.rt-scene-group')}`);
                        lines.push(`- scene paths: ${count('.rt-scene-path')}`);
                        lines.push(`- scene titles: ${count('.rt-scene-title')}`);
                        lines.push(`- curved text (textPath): ${count('textPath')}`);
                        lines.push(`- number squares: ${count('.rt-number-square')}`);
                        lines.push(`- number texts: ${count('.rt-number-text')}`);
                        lines.push(`- synopsis blocks: ${count('.rt-scene-info')}`);
                    }
                    await navigator.clipboard.writeText(lines.join('\n'));
                    resetPerfMeasurements(this.plugin);
                    new Notice('Performance report copied. Sample buffer reset for the next window.');
                },
            });
        }

        this.plugin.addCommand({
            id: 'create-note',
            name: t('commands.createNote'),
            callback: () => {
                this.openCreateNoteModal();
            }
        });

        this.plugin.addCommand({
            id: 'manage-subplots',
            name: t('commands.manageSubplots'),
            callback: () => {
                new ManageSubplotsModal(this.app, this.plugin).open();
            }
        });

        this.plugin.addCommand({
            id: 'book-designer',
            name: t('commands.bookDesigner'),
            callback: () => {
                new BookDesignerModal(this.app, this.plugin).open();
            }
        });

        // Beta (development/testing builds): structure-only or Local LLM-assisted import.
        if (areBetaCommandsVisible()) {
            this.plugin.addCommand({
                id: 'onboard-manuscript',
                name: 'Onboard existing manuscript (BETA)',
                callback: () => {
                    new OnboardingModal(this.app, this.plugin).open();
                }
            });
        }

        this.plugin.addCommand({
            id: 'timeline-order',
            name: t('commands.timelineOrder'),
            callback: () => {
                new TimelineRepairModal(this.app, this.plugin).open();
            }
        });

        this.plugin.addCommand({
            id: 'timeline-audit',
            name: t('commands.timelineAudit'),
            callback: () => {
                new TimelineAuditModal(this.app, this.plugin).open();
            }
        });

        this.plugin.addCommand({
            id: 'manuscript-export',
            name: t('commands.manuscriptExport'),
            callback: () => {
                this.openManuscriptExportModal();
            }
        });

        this.plugin.addCommand({
            id: 'planetary-time-settings',
            name: t('commands.planetaryTimeCalculator'),
            callback: () => {
                new PlanetaryTimeModal(this.app, this.plugin).open();
            }
        });

        this.plugin.addCommand({
            id: 'gossamer-score-manager',
            name: t('commands.gossamerScoreManager'),
            callback: () => {
                void openGossamerScoreEntry(this.plugin);
            }
        });

        this.plugin.addCommand({
            id: 'gossamer-analysis',
            name: t('commands.gossamerAnalysis'),
            callback: () => {
                void runGossamerAiAnalysis(this.plugin);
            }
        });

        // APR Command (Sentence case per Obsidian guidelines)
        this.plugin.addCommand({
            id: 'author-progress-report',
            name: t('commands.authorProgressReport'),
            callback: () => {
                new AuthorProgressModal(this.app, this.plugin).open();
            }
        });

        // Dev-only tooling: these two feed the web-engine fixture corpus and
        // have no use for authors, so they stay behind the same beta-command
        // gate as the other internal-testing commands above. Never ships in
        // release builds.
        if (areBetaCommandsVisible()) {
            // Export the currently rendered timeline as a self-contained image.
            this.plugin.addCommand({
                id: 'export-timeline-image',
                name: t('commands.exportTimelineImage'),
                callback: () => {
                    new TimelineImageExportModal(this.app, async (choice) => {
                        const service = new TimelineExportService(this.plugin, this.app);
                        await service.exportImage(choice.format, choice.scale);
                    }).open();
                }
            });

            // Export the timeline render input pipeline as schema-stamped JSON.
            // Gated behind a consent dialog (Amendment 1 §Consent flow, step 1
            // Export) that states what the file contains before anything is
            // written, and offers the generic-ring-names toggle.
            this.plugin.addCommand({
                id: 'export-timeline-data',
                name: t('commands.exportTimelineData'),
                callback: () => {
                    new TimelineDataExportConsentModal(this.app, async (choice) => {
                        const service = new TimelineExportService(this.plugin, this.app);
                        await service.exportDataJson({ genericSubplotNames: choice.genericSubplotNames });
                    }).open();
                }
            });
        }
    }

    private resolveCleanupOptions(result: ManuscriptModalResult): ManuscriptExportCleanupOptions {
        const format = cleanupFormatForOutputFormat(result.outputFormat);
        const defaults = getDefaultManuscriptCleanupOptions(format);
        return normalizeManuscriptCleanupOptions(result.exportCleanup ?? defaults, format);
    }

    private buildSanitizedArtifactNames(baseMarkdownName: string): { compiledName: string; sanitizedName: string } {
        if (baseMarkdownName.toLowerCase().endsWith('.md')) {
            const stem = baseMarkdownName.slice(0, -3);
            return {
                compiledName: `${stem}__compiled__.md`,
                sanitizedName: `${stem}__sanitized__.md`
            };
        }
        return {
            compiledName: `${baseMarkdownName}__compiled__.md`,
            sanitizedName: `${baseMarkdownName}__sanitized__.md`
        };
    }

    /**
     * Block an export whose assembly lost content. A note that failed to read
     * is missing from `assembled.text` entirely, so any artifact written from
     * here would be an incomplete manuscript presented as a finished one.
     * Called before word-count writes and before any output is produced.
     */
    private assertNoSceneReadFailures(assembled: AssembledManuscript): void {
        if (assembled.readFailures.length === 0) return;
        const paths = assembled.readFailures.map(failure => failure.path);
        throw new ExportFailure({
            category: 'missing_files',
            message: `Export blocked: ${paths.length} scene file(s) could not be read.`,
            detail: paths.join('\n'),
        });
    }

    private async handleManuscriptExport(result: ManuscriptModalResult): Promise<ManuscriptExportOutcome> {
        if (this.isUnsupportedExportConfig(result)) {
            new Notice('This export configuration is not available.');
            return {};
        }

        // ── Source-folder guardrail (applies to Markdown and PDF) ───────
        const ctx = getActiveBookExportContext(this.plugin);
        const folder = ctx.sourceFolder.trim();
        if (!folder || !this.app.vault.getAbstractFileByPath(folder)) {
            const activeBook = getActiveBook(this.plugin.settings);
            if (activeBook) {
                console.warn(`[RT Export] Source folder missing or invalid for book "${activeBook.title}" (id=${activeBook.id}), folder="${folder}"`);
            }
            new Notice('Active book has no valid source folder. Open Settings → Core → Books.');
            return {};
        }

        try {
            const templateAccess = result.exportType === 'manuscript' && result.outputFormat === 'pdf'
                ? resolveTemplateAccess({
                    layouts: this.plugin.settings.pandocLayouts || [],
                    selectedLayoutId: result.selectedLayoutId,
                    manuscriptPreset: result.manuscriptPreset || 'novel',
                    hasProAccess: hasProFeatureAccess(this.plugin),
                })
                : undefined;
            const selectedLayoutIdForExport = templateAccess?.effectiveLayout?.id || result.selectedLayoutId;
            const usedTemplateFallback = templateAccess?.usedFallback === true;

            const lockSceneSelectionToFullBook = result.exportType === 'manuscript' && result.outputFormat === 'pdf';
            const effectiveOrder = lockSceneSelectionToFullBook ? 'narrative' : result.order;
            const effectiveSubplot = lockSceneSelectionToFullBook ? undefined : result.subplot;
            const effectiveRangeStart = lockSceneSelectionToFullBook ? undefined : result.rangeStart;
            const effectiveRangeEnd = lockSceneSelectionToFullBook ? undefined : result.rangeEnd;
            const includeMatter = result.exportType === 'manuscript' && (result.includeMatter ?? false);
            const scenes = await getSceneFilesByOrder(this.app, this.plugin, effectiveOrder, undefined, includeMatter);
            const selection: ManuscriptSceneSelection = {
                files: scenes.files,
                titles: scenes.titles,
                whenDates: scenes.whenDates,
                acts: scenes.acts,
                sceneNumbers: scenes.sceneNumbers,
                subplots: scenes.subplots,
                synopses: scenes.synopses,
                runtimes: scenes.runtimes,
                wordCounts: scenes.wordCounts,
                matterMetaByPath: scenes.matterMetaByPath,
                chapterMarkersByScenePath: scenes.chapterMarkersByScenePath,
                sortOrder: scenes.sortOrder
            };

            let filteredSelection = selection;
            if (result.scenePathFilter && result.scenePathFilter.length > 0) {
                const pathSet = new Set(result.scenePathFilter);
                const indices = selection.files.map((f, i) => pathSet.has(f.path) ? i : -1).filter(i => i !== -1);
                filteredSelection = {
                    files: indices.map(i => selection.files[i]),
                    titles: indices.map(i => selection.titles[i]),
                    whenDates: indices.map(i => selection.whenDates[i]),
                    acts: indices.map(i => selection.acts[i]),
                    sceneNumbers: indices.map(i => selection.sceneNumbers[i]),
                    subplots: indices.map(i => selection.subplots[i]),
                    synopses: indices.map(i => selection.synopses[i]),
                    runtimes: indices.map(i => selection.runtimes[i]),
                    wordCounts: indices.map(i => selection.wordCounts[i]),
                    matterMetaByPath: selection.matterMetaByPath,
                    chapterMarkersByScenePath: selection.chapterMarkersByScenePath,
                    sortOrder: selection.sortOrder
                };
            } else if (effectiveSubplot && effectiveSubplot !== 'All Subplots') {
                const indices = selection.subplots.map((s, i) => s === effectiveSubplot ? i : -1).filter(i => i !== -1);
                filteredSelection = {
                    files: indices.map(i => selection.files[i]),
                    titles: indices.map(i => selection.titles[i]),
                    whenDates: indices.map(i => selection.whenDates[i]),
                    acts: indices.map(i => selection.acts[i]),
                    sceneNumbers: indices.map(i => selection.sceneNumbers[i]),
                    subplots: indices.map(i => selection.subplots[i]),
                    synopses: indices.map(i => selection.synopses[i]),
                    runtimes: indices.map(i => selection.runtimes[i]),
                    wordCounts: indices.map(i => selection.wordCounts[i]),
                    matterMetaByPath: selection.matterMetaByPath,
                    chapterMarkersByScenePath: selection.chapterMarkersByScenePath,
                    sortOrder: selection.sortOrder
                };
            }

            const slicedSelection = this.sliceSelection(filteredSelection, effectiveRangeStart, effectiveRangeEnd, includeMatter);
            if (slicedSelection.files.length === 0) {
                new Notice('Selected range is empty.');
                return {};
            }

            const requestedParts = result.splitMode === 'parts'
                ? Math.max(2, Math.min(20, Math.floor(result.splitParts ?? 2)))
                : 1;

            if (requestedParts > slicedSelection.files.length) {
                new Notice(`Not enough scenes selected to split into ${requestedParts} parts.`);
                return {};
            }

            const preflightSnapshot = this.plugin.getPublishingValidationService().collect(this.plugin.settings.activeBookId, {
                exportType: result.exportType,
                outputFormat: result.outputFormat,
                manuscriptPreset: result.manuscriptPreset,
                selectedLayoutId: result.selectedLayoutId,
            });
            const preflightFailure = this.buildPreflightExportFailure(preflightSnapshot, {
                exportType: result.exportType,
                outputFormat: result.outputFormat,
            });
            if (preflightFailure) {
                throw preflightFailure;
            }

            const partRanges = requestedParts > 1
                ? chunkScenesIntoParts(Array.from({ length: slicedSelection.files.length }, (_unused, idx) => idx), requestedParts).ranges.filter(r => r.size > 0)
                : [{ part: 1, start: 1, end: slicedSelection.files.length, size: slicedSelection.files.length }];

            const isSplitRun = requestedParts > 1;
            const baseTitle = stemToReadable(ctx.fileStem);
            const savedPaths: string[] = [];
            const renderedPaths: string[] = [];
            const statusMessages: string[] = [];
            if (usedTemplateFallback) {
                statusMessages.push(TEMPLATE_ACCESS_FALLBACK_MESSAGE);
                new Notice(TEMPLATE_ACCESS_FALLBACK_MESSAGE);
            }
            if (result.exportType === 'outline') {
                const runtimeSettings = getRuntimeSettings(this.plugin.settings);
                const baseOutputFolder = await ensureOutlineOutputFolder(this.plugin);
                const outputFolder = isSplitRun
                    ? await this.createSplitOutputFolder(baseOutputFolder, baseTitle)
                    : baseOutputFolder;

                for (const range of partRanges) {
                    const partSelection = this.sliceSelection(slicedSelection, range.start, range.end);
                    const outline = buildOutlineExport(
                        partSelection,
                        result.outlinePreset || 'beat-sheet',
                        result.includeSynopsis ?? false,
                        runtimeSettings
                    );
                    const filename = isSplitRun
                        ? `${baseTitle} - Part ${range.part}.${outline.extension}`
                        : buildExportFilename({
                            exportType: 'outline',
                            order: effectiveOrder,
                            subplotFilter: effectiveSubplot,
                            outlinePreset: result.outlinePreset,
                            extension: outline.extension
                        });
                    const vaultPath = `${outputFolder}/${filename}`;
                    const wrote = await this.writeVaultTextFile(vaultPath, outline.text, 'outline-export');
                    if (wrote) savedPaths.push(vaultPath);
                }

                if (savedPaths.length === 0) {
                    new Notice('Outline export cancelled before any existing outputs were overwritten.');
                    return { messages: statusMessages };
                }
                if (isSplitRun) {
                    new Notice(`Outline exported to ${outputFolder} (${savedPaths.length} files)`);
                } else {
                    new Notice(`Outline exported to ${savedPaths[0]}`);
                }
                return {
                    savedPath: savedPaths[0],
                    savedPaths,
                    outputFolder,
                    messages: statusMessages
                };
            }

            const bookMetaResolution = this.resolveBookMetaForExport(folder);
            if (bookMetaResolution.warning) {
                throw new ExportFailure({
                    category: 'missing_metadata',
                    message: bookMetaResolution.warning,
                    detail: 'Keep exactly one BookMeta note per book folder before exporting PDF.'
                });
            }
            if (!bookMetaResolution.bookMeta) {
                throw new ExportFailure({
                    category: 'missing_metadata',
                    message: 'No BookMeta note found for PDF export.',
                    detail: 'Create one BookMeta note in the active book source folder so title, author, and Book Pages resolve explicitly.'
                });
            }
            const selectedMatterCount = slicedSelection.files.reduce((count, file) => (
                filteredSelection.matterMetaByPath?.has(file.path) ? count + 1 : count
            ), 0);
            const selectedMatterSummaries: MatterNoteSummary[] = slicedSelection.files.flatMap(file => {
                const meta = filteredSelection.matterMetaByPath?.get(file.path);
                if (!meta) return [];
                const side: 'frontmatter' | 'backmatter' = meta.side === 'back' ? 'backmatter' : 'frontmatter';
                return [{
                    role: typeof meta.role === 'string' ? meta.role : '',
                    path: file.path,
                    title: file.basename,
                    bodyMode: meta.bodyMode === 'latex' ? 'latex' : 'plain',
                    side,
                }];
            });
            const selectedBookPageCount = resolveBookPages(bookMetaResolution.bookMeta || undefined, selectedMatterSummaries).length;
            if (includeMatter && selectedMatterCount === 0 && selectedBookPageCount === 0) {
                statusMessages.push('Include front & back matter is enabled, but no Book Pages were found for the active book.');
            }

            if (!bookMetaResolution.bookMeta.title?.trim()) {
                throw new ExportFailure({
                    category: 'missing_metadata',
                    message: 'BookMeta is missing Title.',
                    detail: 'PDF layouts require an explicit BookMeta Title for running headers and title pages.'
                });
            }
            if (!bookMetaResolution.bookMeta.author?.trim()) {
                throw new ExportFailure({
                    category: 'missing_metadata',
                    message: 'BookMeta is missing Author.',
                    detail: 'PDF layouts require an explicit BookMeta Author for template metadata and title pages.'
                });
            }
            if (bookMetaResolution.bookMeta.rights && !bookMetaResolution.bookMeta.rights.year) {
                throw new ExportFailure({
                    category: 'missing_metadata',
                    message: 'BookMeta is missing Rights: Year.',
                    detail: 'Complete BookMeta Rights: Year before exporting copyright-backed Book Pages.'
                });
            }

            const extension = getExportFormatExtension(result.outputFormat);
            const baseOutputFolder = await ensureManuscriptOutputFolder(this.plugin);
            const outputFolder = isSplitRun
                ? await this.createSplitOutputFolder(baseOutputFolder, baseTitle)
                : baseOutputFolder;
            const cleanupOptions = this.resolveCleanupOptions(result);

            // The active book's saved Book Pages order (drag-reorder UI in
            // Settings → Publish persists this) drives matter page emission
            // order. Empty/undefined → resolver canonical order.
            const activeBookForOrder = getActiveBook(this.plugin.settings);
            const bookPageOrder = activeBookForOrder?.bookPageOrder;
            if (result.outputFormat === 'markdown') {
                for (const range of partRanges) {
                    const partSelection = this.sliceSelection(slicedSelection, range.start, range.end);
                    const assembled = await assembleManuscript(
                        partSelection.files,
                        this.app.vault,
                        undefined,
                        result.tocMode === 'markdown',
                        filteredSelection.sortOrder,
                        result.tocMode !== 'none',
                        bookMetaResolution.bookMeta,
                        filteredSelection.matterMetaByPath,
                        {
                            chapterMarkersByScenePath: filteredSelection.chapterMarkersByScenePath,
                            sceneHeadingRenderMode: 'markdown-h2',
                            includeSceneIdInToc: result.includeSceneIdInToc === true,
                            includeSceneIdInHeading: result.includeSceneIdInHeading === true,
                            bookPageOrder,
                            includeMatterPages: includeMatter,
                        }
                    );
                    this.assertNoSceneReadFailures(assembled);

                    if (result.updateWordCounts) {
                        await updateSceneWordCounts(this.app, partSelection.files, assembled.scenes);
                    }

                    const sanitizedText = sanitizeCompiledManuscript(assembled.text, cleanupOptions);

                    const filename = isSplitRun
                        ? `${baseTitle} - Part ${range.part}.${extension}`
                        : buildExportFilename({
                            exportType: 'manuscript',
                            order: effectiveOrder,
                            subplotFilter: effectiveSubplot,
                            manuscriptPreset: result.manuscriptPreset,
                            extension
                        });
                    const vaultPath = `${outputFolder}/${filename}`;
                    const wrote = await this.writeVaultTextFile(vaultPath, sanitizedText, 'manuscript-export');
                    if (wrote) savedPaths.push(vaultPath);
                }

                if (savedPaths.length === 0) {
                    new Notice('Manuscript export cancelled before any existing outputs were overwritten.');
                    return { messages: statusMessages };
                }
                if (isSplitRun) {
                    new Notice(`Manuscript exported to ${outputFolder} (${savedPaths.length} files)`);
                } else {
                    new Notice(`Manuscript exported to ${savedPaths[0]}`);
                }
                return {
                    savedPath: savedPaths[0],
                    savedPaths,
                    outputFolder,
                    messages: statusMessages
                };
            }

            if (result.outputFormat === 'docx') {
                // Submission-format Word export (Core). No LaTeX layout, font
                // policy, or template validation — those gates are PDF-only.
                // Pandoc styles the document from the bundled reference.docx
                // (standard manuscript format: TNR 12pt, double-spaced).
                const absoluteOutputFolder = getVaultAbsolutePath(this.plugin, outputFolder);
                if (!absoluteOutputFolder) {
                    new Notice('Word export is not supported in this environment.');
                    return {};
                }
                const referenceDoc = ensureManuscriptReferenceDocxInstalled(this.plugin);
                if (!referenceDoc.path) {
                    const message = `Cannot export DOCX: Word reference document unavailable. ${referenceDoc.error ?? ''}`.trim(); // SAFE: the failure is already stated; the trailing detail is appended only when there is one
                    new Notice(message, 8000);
                    throw new Error(message);
                }
                const docxMetadata: Record<string, string | undefined> = {
                    ...(isProActive(this.plugin)
                        ? parseCustomPandocMetadata(this.plugin.settings.customPandocMetadata)
                        : {}),
                    title: bookMetaResolution.bookMeta?.title,
                    author: bookMetaResolution.bookMeta?.author,
                };

                new Notice('Running Pandoc...');
                for (const range of partRanges) {
                    const partSelection = this.sliceSelection(slicedSelection, range.start, range.end);
                    const assembled = await assembleManuscript(
                        partSelection.files,
                        this.app.vault,
                        undefined,
                        result.tocMode === 'markdown',
                        filteredSelection.sortOrder,
                        result.tocMode !== 'none',
                        bookMetaResolution.bookMeta,
                        filteredSelection.matterMetaByPath,
                        {
                            chapterMarkersByScenePath: filteredSelection.chapterMarkersByScenePath,
                            sceneHeadingRenderMode: 'markdown-h2',
                            includeSceneIdInToc: result.includeSceneIdInToc === true,
                            includeSceneIdInHeading: result.includeSceneIdInHeading === true,
                            bookPageOrder,
                            includeMatterPages: includeMatter,
                        }
                    );
                    this.assertNoSceneReadFailures(assembled);

                    if (result.updateWordCounts) {
                        await updateSceneWordCounts(this.app, partSelection.files, assembled.scenes);
                    }

                    // Reader-facing cleanup posture (same as PDF): comments,
                    // links, callouts, task markers stripped per modal toggles.
                    const sanitizedText = sanitizeCompiledManuscriptForPdf(assembled.text, cleanupOptions);

                    const renderedFilename = isSplitRun
                        ? `${baseTitle} - Part ${range.part}.docx`
                        : buildExportFilename({
                            exportType: 'manuscript',
                            order: effectiveOrder,
                            subplotFilter: effectiveSubplot,
                            manuscriptPreset: result.manuscriptPreset,
                            extension,
                            fileStem: ctx.fileStem
                        });
                    await runPandocOnContent(sanitizedText, `${absoluteOutputFolder}/${renderedFilename}`, {
                        targetFormat: 'docx',
                        referenceDocPath: referenceDoc.path,
                        workingDir: absoluteOutputFolder,
                        pandocPath: this.plugin.settings.pandocPath,
                        metadata: docxMetadata
                    });
                    renderedPaths.push(`${outputFolder}/${renderedFilename}`);
                }

                if (isSplitRun) {
                    new Notice(`Export successful: ${renderedPaths.length} DOCX files`);
                } else {
                    new Notice(`Export successful: ${renderedPaths[0].split('/').pop()}`);
                }
                return {
                    renderedPath: renderedPaths[0],
                    renderedPaths,
                    outputFolder,
                    messages: statusMessages
                };
            }

            if (result.outputFormat !== 'pdf') {
                throw new Error(`Unsupported manuscript output format: ${result.outputFormat}`);
            }

            const layout = getLayoutById(this.plugin, selectedLayoutIdForExport);
            if (!layout) {
                new Notice('No Pandoc layout selected. Configure layouts in Publish settings.');
                return {};
            }
            if (layout.bundled) {
                const bundledInstall = await ensureBundledLayoutInstalledForExport(this.plugin, layout);
                if (bundledInstall.installed) {
                    new Notice(`Installed bundled layout '${layout.name}' to Pandoc folder.`);
                }
            }
            let layoutValidation = validatePandocLayout(this.plugin, layout);
            if (!layoutValidation.valid && layout.bundled) {
                const bundledInstall = await ensureBundledLayoutInstalledForExport(this.plugin, layout);
                if (bundledInstall.installed) {
                    new Notice(`Installed bundled layout '${layout.name}' to Pandoc folder.`);
                    layoutValidation = validatePandocLayout(this.plugin, layout);
                }
            }
            if (!layoutValidation.valid) {
                new Notice(`Layout "${layout.name}" is invalid: ${layoutValidation.error}`);
                return {};
            }

            const absoluteOutputFolder = getVaultAbsolutePath(this.plugin, outputFolder);
            if (!absoluteOutputFolder) {
                new Notice('Pandoc export not supported in this environment.');
                return {};
            }

            const templatePath = resolveTemplatePath(this.plugin, layout.path);
            const shouldSaveMarkdown = result.saveMarkdownArtifact ?? true;
            const layoutExportBehavior = getManuscriptLayoutExportBehavior(layout);
            const useModernClassicStructure = layout.usesModernClassicStructure === true;
            const modernClassicLayoutOptions = useModernClassicStructure
                ? this.resolveModernClassicLayoutOptions(layout.id)
                : undefined;
            // Precedence: user UI override wins only for layouts that expose a
            // scene-opener heading control (Signature Literary). Other layouts
            // use their spec default so stale saved options cannot drift the
            // exported PDF away from the preview card.
            const layoutSceneHeadingMode = (layoutExportBehavior.allowSceneHeadingModeOverride
                ? this.resolveLayoutSceneHeadingMode(layout.id)
                : undefined)
                ?? layoutExportBehavior.defaultSceneHeadingMode;
            const sceneHeadingRenderMode = layoutExportBehavior.sceneHeadingRenderMode;
            const chapterMarkersByScenePath = layoutExportBehavior.suppressChapterMarkers
                ? {}
                : filteredSelection.chapterMarkersByScenePath;
            // Base metadata from BookMeta; Pro custom metadata layers on top but
            // never overrides title/author (BookMeta is the single source of
            // truth for those — running heads and the title page depend on it).
            const proActive = isProActive(this.plugin);
            const customMetadata = proActive
                ? parseCustomPandocMetadata(this.plugin.settings.customPandocMetadata)
                : {};
            const pandocMetadata: Record<string, string | undefined> = {
                ...customMetadata,
                title: bookMetaResolution.bookMeta?.title,
                author: bookMetaResolution.bookMeta?.author,
            };
            // Preamble injection: opt-in binding gutter (Core) + Pro custom
            // LaTeX. User preamble comes last so its definitions win.
            const headerIncludeParts: string[] = [];
            if (this.plugin.settings.pdfBindingGutter === true) {
                headerIncludeParts.push(BINDING_GUTTER_LATEX);
            }
            if (proActive && this.plugin.settings.customLatexPreamble?.trim()) {
                headerIncludeParts.push(this.plugin.settings.customLatexPreamble.trim());
            }
            const headerIncludes = headerIncludeParts.length > 0
                ? headerIncludeParts.join('\n')
                : undefined;
            const fontDiagnostics = getTemplateFontDiagnostics(templatePath);
            if (fontDiagnostics.fontsEmbeddedInPdf) {
                statusMessages.push('Font embedding: XeLaTeX/LuaLaTeX embed resolved OpenType/TrueType fonts in the exported PDF.');
            }
            if (fontDiagnostics.missingRequiredFonts.length > 0) {
                const fontWarning = `Missing required system font(s): ${fontDiagnostics.missingRequiredFonts.join(', ')}. Install them or switch layouts before exporting.`;
                statusMessages.push(fontWarning);
                new Notice(fontWarning);
            }

            // ── STRICT FONT POLICY (Phase 1) ──────────────────────────────
            // Belt-and-suspenders defense — even if the modal's Export-button
            // gating is bypassed, the actual export call must refuse to
            // compile when the layout's required font is not installed. The
            // generator emits a hard `\PackageError` for the same condition,
            // but we surface a clean Obsidian-level error here so the user
            // never sees a raw LaTeX failure.
            //
            // Triggers only for PDF format. Markdown export already returned
            // earlier in this method.
            const structuredFontDiag = getStructuredFontDiagnostic(layout);
            if (structuredFontDiag.state !== 'ok') {
                const primary = structuredFontDiag.primaryFontName;
                const hint = structuredFontDiag.installHint?.message
                    ?? 'Install the font and try again.';
                const blockMessage = `Cannot export PDF: required font '${primary}' is not installed. ${hint}`;
                new Notice(blockMessage, 8000);
                statusMessages.push(blockMessage);
                throw new Error(blockMessage);
            }

            new Notice('Running Pandoc...');
            for (const range of partRanges) {
                const partSelection = this.sliceSelection(slicedSelection, range.start, range.end);
                const assembled = await assembleManuscript(
                    partSelection.files,
                    this.app.vault,
                    undefined,
                    result.tocMode === 'markdown',
                    filteredSelection.sortOrder,
                    result.tocMode !== 'none',
                    bookMetaResolution.bookMeta,
                    filteredSelection.matterMetaByPath,
                    {
                        chapterMarkersByScenePath,
                        sceneHeadingMode: layoutSceneHeadingMode,
                        sceneHeadingRenderMode,
                        suppressMatterPageChrome: true,
                        includeSceneIdInToc: result.includeSceneIdInToc === true,
                        includeSceneIdInHeading: result.includeSceneIdInHeading === true,
                        sceneIdFormat: 'plain',
                        useRtChapterMacro: layoutExportBehavior.useRtChapterMacro,
                        modernClassicStructure: useModernClassicStructure
                            ? {
                                enabled: true,
                                partEpigraphs: modernClassicLayoutOptions?.partEpigraphs,
                                partEpigraphAttributions: modernClassicLayoutOptions?.partEpigraphAttributions
                            }
                            : undefined,
                        bookPageOrder,
                        includeMatterPages: includeMatter,
                    }
                );
                this.assertNoSceneReadFailures(assembled);

                if (result.updateWordCounts) {
                    await updateSceneWordCounts(this.app, partSelection.files, assembled.scenes);
                }

                const compiledMarkdown = assembled.text;
                const sanitizedMarkdown = sanitizeCompiledManuscriptForPdf(compiledMarkdown, cleanupOptions);

                if (shouldSaveMarkdown) {
                    const basePrecursorName = isSplitRun
                        ? `${baseTitle} - Part ${range.part}.md`
                        : buildPrecursorFilename(
                            ctx.fileStem,
                            result.manuscriptPreset || 'novel',
                            effectiveOrder,
                            effectiveSubplot
                        );
                    const artifactNames = this.buildSanitizedArtifactNames(basePrecursorName);
                    const compiledPath = `${outputFolder}/${artifactNames.compiledName}`;
                    const sanitizedPath = `${outputFolder}/${artifactNames.sanitizedName}`;
                    const wroteCompiled = await this.writeVaultTextFile(compiledPath, compiledMarkdown, 'manuscript-compiled-artifact');
                    const wroteSanitized = await this.writeVaultTextFile(sanitizedPath, sanitizedMarkdown, 'manuscript-sanitized-artifact');
                    if (wroteCompiled) savedPaths.push(compiledPath);
                    if (wroteSanitized) savedPaths.push(sanitizedPath);
                }

                const renderedFilename = isSplitRun
                    ? `${baseTitle} - Part ${range.part}.pdf`
                    : buildExportFilename({
                        exportType: 'manuscript',
                        order: effectiveOrder,
                        subplotFilter: effectiveSubplot,
                        manuscriptPreset: result.manuscriptPreset,
                        extension,
                        fileStem: ctx.fileStem,
                        layoutAbbreviation: getLayoutAbbreviation(layout)
                    });
                const renderedAbsolutePath = `${absoluteOutputFolder}/${renderedFilename}`;
                const renderedVaultPath = `${outputFolder}/${renderedFilename}`;

                await runPandocOnContent(sanitizedMarkdown, renderedAbsolutePath, {
                    targetFormat: 'pdf',
                    templatePath,
                    headerIncludes,
                    workingDir: absoluteOutputFolder,
                    pandocPath: this.plugin.settings.pandocPath,
                    metadata: pandocMetadata
                });

                renderedPaths.push(renderedVaultPath);
            }

            const activeBook = getActiveBook(this.plugin.settings);
            if (activeBook) {
                if (!activeBook.lastUsedPandocLayoutByPreset) {
                    activeBook.lastUsedPandocLayoutByPreset = {};
                }
                activeBook.lastUsedPandocLayoutByPreset[result.manuscriptPreset || 'novel'] = layout.id;
            }
            if (result.exportProfileId) {
                this.plugin.settings.lastUsedExportProfileId = result.exportProfileId;
                this.plugin.settings.lastUsedManuscriptExportTemplateId = result.exportProfileId;
                if (activeBook) {
                    const preferences = Array.isArray(this.plugin.settings.bookPublishingPreferences)
                        ? [...this.plugin.settings.bookPublishingPreferences]
                        : [];
                    const index = preferences.findIndex(entry => entry.bookId === activeBook.id);
                    if (index >= 0) {
                        preferences[index] = {
                            ...preferences[index],
                            lastUsedExportProfileId: result.exportProfileId,
                        };
                    } else {
                        preferences.push({
                            bookId: activeBook.id,
                            lastUsedExportProfileId: result.exportProfileId,
                            preferredTemplateProfileIdByContext: result.manuscriptPreset && result.exportProfileTemplateId
                                ? { [result.manuscriptPreset]: result.exportProfileTemplateId }
                                : undefined,
                        });
                    }
                    this.plugin.settings.bookPublishingPreferences = preferences;
                }
            }
            await this.plugin.saveSettings();

            if (isSplitRun) {
                new Notice(`Export successful: ${renderedPaths.length} PDFs`);
            } else {
                new Notice(`Export successful: ${renderedPaths[0].split('/').pop()}`);
            }

            return {
                savedPath: savedPaths[0],
                renderedPath: renderedPaths[0],
                savedPaths,
                renderedPaths,
                outputFolder,
                messages: statusMessages
            };
        } catch (error) {
            const failure = categorizeExportError(error);
            new Notice(failure.message);
            console.error(error);
            throw failure;
        }
        return {};
    }

    private buildPreflightExportFailure(
        snapshot: PublishingValidationSnapshot,
        context: {
            exportType: 'manuscript' | 'outline';
            outputFormat: 'pdf' | 'markdown' | 'docx' | 'csv' | 'json';
        }
    ): ExportFailure | null {
        const shouldBlockOnBookMeta = context.exportType === 'manuscript' && context.outputFormat === 'pdf';
        const blocking = snapshot.preflightIssues.find(issue => issue.level === 'error')
            || (shouldBlockOnBookMeta
                ? snapshot.activeBookMetaIssues.find(issue => issue.level === 'error')
                : undefined);
        if (!blocking) return null;

        const detailLines = [
            ...snapshot.preflightIssues.map(issue => `Preflight: ${issue.message}`),
            ...snapshot.templateCompatibilityIssues.map(issue => `Template Compatibility: ${issue.message}`),
            ...(shouldBlockOnBookMeta
                ? snapshot.activeBookMetaIssues.map(issue => `BookMeta: ${issue.message}`)
                : []),
        ];

        let category: ConstructorParameters<typeof ExportFailure>[0]['category'] = 'pandoc_compile_failure';
        if (blocking.code.includes('pandoc') || blocking.code.includes('engine')) {
            category = 'missing_dependency';
        } else if (blocking.code.includes('layout') || blocking.code.includes('template') || blocking.code.includes('profile') || blocking.code.includes('compatibility')) {
            category = 'invalid_template';
        } else if (blocking.scope === 'book-meta') {
            category = 'missing_metadata';
        }

        return new ExportFailure({
            category,
            message: blocking.message,
            detail: detailLines.join('\n') || blocking.detail,
        });
    }

    private sliceSelection(
        selection: ManuscriptSceneSelection,
        start?: number,
        end?: number,
        keepMatterOutsideRange = false
    ): ManuscriptSceneSelection {
        if (!start && !end) return selection;

        if (!keepMatterOutsideRange) {
            const startIdx = (start || 1) - 1;
            const endIdx = end || selection.files.length;
            const indices = Array.from(
                { length: Math.max(0, endIdx - startIdx) },
                (_unused, offset) => startIdx + offset
            );
            return this.pickSelectionIndices(selection, indices);
        }

        const matterPaths = selection.matterMetaByPath;
        const sceneIndices: number[] = [];
        const matterIndices = new Set<number>();

        selection.files.forEach((file, index) => {
            const isMatter = !!(matterPaths && matterPaths.has(file.path));
            if (isMatter) {
                matterIndices.add(index);
            } else {
                sceneIndices.push(index);
            }
        });

        if (sceneIndices.length === 0) return selection;

        const normalizedStart = Math.max(1, Math.min(start || 1, sceneIndices.length));
        const normalizedEnd = Math.max(normalizedStart, Math.min(end || sceneIndices.length, sceneIndices.length));
        const selectedSceneIndices = new Set(sceneIndices.slice(normalizedStart - 1, normalizedEnd));

        const keepIndices: number[] = [];
        selection.files.forEach((_file, index) => {
            if (matterIndices.has(index) || selectedSceneIndices.has(index)) {
                keepIndices.push(index);
            }
        });

        return this.pickSelectionIndices(selection, keepIndices);
    }

    private pickSelectionIndices(selection: ManuscriptSceneSelection, indices: number[]): ManuscriptSceneSelection {
        const clamped = indices.filter(index => index >= 0 && index < selection.files.length);
        return {
            files: clamped.map(index => selection.files[index]),
            titles: clamped.map(index => selection.titles[index]),
            whenDates: clamped.map(index => selection.whenDates[index]),
            acts: clamped.map(index => selection.acts[index]),
            sceneNumbers: clamped.map(index => selection.sceneNumbers[index]),
            subplots: clamped.map(index => selection.subplots[index]),
            synopses: clamped.map(index => selection.synopses[index]),
            runtimes: clamped.map(index => selection.runtimes[index]),
            wordCounts: clamped.map(index => selection.wordCounts[index]),
            matterMetaByPath: selection.matterMetaByPath,
            chapterMarkersByScenePath: selection.chapterMarkersByScenePath,
            sortOrder: selection.sortOrder
        };
    }

    private async writeVaultTextFile(vaultPath: string, content: string, operation: string): Promise<boolean> {
        const managedMarker = vaultPath.toLowerCase().endsWith('.md')
            ? `<!-- Radial Timeline Managed Output: ${operation} -->`
            : undefined;
        const result = await writeManagedOutput(this.app, vaultPath, content, {
            operation,
            managedMarker,
            unmanagedOverwritePrompt: (file) => `Overwrite existing output "${file.path}"? RT will archive the current contents to a log snapshot first. Manual edits may be replaced.`
        });
        if (result.skipped) {
            return false;
        }
        if (result.snapshotPath) {
            new Notice(`Archived existing output before overwrite: ${result.snapshotPath}`);
        }
        return true;
    }

    private async ensureVaultFolderPath(folderPath: string): Promise<void> {
        const parts = folderPath.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current);
            }
        }
    }

    private async createSplitOutputFolder(baseOutputFolder: string, baseTitle: string): Promise<string> {
        const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const splitFolder = `${baseOutputFolder}/${baseTitle} - Split ${safeStamp}`;
        await this.ensureVaultFolderPath(splitFolder);
        return splitFolder;
    }

    private parseBookMetaFromFrontmatter(frontmatter: Record<string, unknown>, sourcePath: string): BookMeta {
        const book = frontmatter.Book as Record<string, unknown> | undefined;
        const rights = frontmatter.Rights as Record<string, unknown> | undefined;
        const identifiers = frontmatter.Identifiers as Record<string, unknown> | undefined;
        const publisher = frontmatter.Publisher as Record<string, unknown> | undefined;
        const frontmatterBlocks = frontmatter.Frontmatter as Record<string, unknown> | undefined;
        const backmatterBlocks = frontmatter.Backmatter as Record<string, unknown> | undefined;

        const rawYear = rights?.year;
        const year = typeof rawYear === 'number'
            ? rawYear
            : typeof rawYear === 'string'
                ? Number(rawYear)
                : NaN;

        return {
            title: (book?.title as string) || undefined,
            subtitle: (book?.subtitle as string) || undefined,
            author: (book?.author as string) || undefined,
            rights: rights ? {
                copyright_holder: (rights.copyright_holder as string) || undefined,
                year: Number.isFinite(year) ? year : undefined
            } : undefined,
            identifiers: identifiers ? {
                isbn_paperback: (identifiers.isbn_paperback as string) || undefined
            } : undefined,
            publisher: publisher ? {
                name: (publisher.name as string) || undefined,
                imprint: (publisher.imprint as string) || undefined,
                edition: (publisher.edition as string) || undefined
            } : undefined,
            frontmatter: frontmatterBlocks ? {
                title_page_note: (frontmatterBlocks.title_page_note as string) || undefined,
                dedication: (frontmatterBlocks.dedication as string) || undefined,
                epigraph_quote: (frontmatterBlocks.epigraph_quote as string) || undefined,
                epigraph_attribution: (frontmatterBlocks.epigraph_attribution as string) || undefined
            } : undefined,
            backmatter: backmatterBlocks ? {
                acknowledgments: (backmatterBlocks.acknowledgments as string) || undefined,
                about_author: (backmatterBlocks.about_author as string) || undefined,
                author_note: (backmatterBlocks.author_note as string) || undefined,
                other_works: (backmatterBlocks.other_works as string) || undefined
            } : undefined,
            sourcePath
        };
    }

    private resolveBookMetaForExport(sourceFolder: string): { bookMeta: BookMeta | null; warning?: string } {
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);

        const candidates = this.app.vault.getMarkdownFiles()
            .filter(file => isPathInFolderScope(file.path, sourceFolder))
            .map(file => {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache?.frontmatter) return null;
                const normalized = normalizeFrontmatterKeys(cache.frontmatter, mappings);
                if (normalized.Class !== 'BookMeta') return null;
                return {
                    path: file.path,
                    meta: this.parseBookMetaFromFrontmatter(normalized, file.path)
                };
            })
            .filter((entry): entry is { path: string; meta: BookMeta } => !!entry)
            .sort((a, b) => a.path.localeCompare(b.path));

        if (candidates.length === 0) {
            return { bookMeta: this.plugin.getBookMeta() };
        }

        const current = this.plugin.getBookMeta();
        const preferred = current?.sourcePath
            ? candidates.find(candidate => candidate.path === current.sourcePath)
            : undefined;
        const selected = preferred || candidates[0];

        if (candidates.length > 1) {
            return {
                bookMeta: selected.meta,
                warning: `Multiple BookMeta notes found. Using: ${selected.path}`
            };
        }

        return { bookMeta: selected.meta };
    }

    private resolveModernClassicLayoutOptions(layoutId: string): BookLayoutOptions | undefined {
        const activeBook = getActiveBook(this.plugin.settings);
        if (!activeBook || !layoutId) return undefined;
        const scopedOptions = activeBook.layoutOptions?.[layoutId];
        if (!scopedOptions) return undefined;

        const normalizeList = (values: unknown): string[] | undefined => {
            if (!Array.isArray(values)) return undefined;
            const normalized = values.map(value => (typeof value === 'string' ? value.trim() : ''));
            return normalized.some(value => value.length > 0) ? normalized : undefined;
        };
        const partEpigraphs = normalizeList(scopedOptions.partEpigraphs);
        const partEpigraphAttributions = normalizeList(scopedOptions.partEpigraphAttributions);
        if (!partEpigraphs && !partEpigraphAttributions) return undefined;
        return {
            ...(partEpigraphs ? { partEpigraphs } : {}),
            ...(partEpigraphAttributions ? { partEpigraphAttributions } : {})
        };
    }

    private resolveLayoutSceneHeadingMode(layoutId: string): ManuscriptSceneHeadingMode | undefined {
        if (!layoutId) return undefined;
        const activeBook = getActiveBook(this.plugin.settings);
        const mode = activeBook?.layoutOptions?.[layoutId]?.sceneHeadingMode;
        if (mode === 'scene-number' || mode === 'scene-number-title' || mode === 'title-only') {
            return mode;
        }
        return undefined;
    }

    private openCreateNoteModal(): void {
        new CreateRtNoteModal(this.app, async (subtypeId) => {
            await this.createNoteFromSubtype(subtypeId);
        }).open();
    }

    private async createNoteFromSubtype(subtypeId: RtNoteSubtypeId): Promise<void> {
        switch (subtypeId) {
            case 'basic-scene':
                await this.createSceneNote('base');
                return;
            case 'advanced-scene':
                await this.createSceneNote('advanced');
                return;
            case 'screenplay-scene':
                await this.createSceneNote('screenplay');
                return;
            case 'podcast-scene':
                await this.createSceneNote('podcast');
                return;
            case 'front-matter':
                await this.createMatterNote('Frontmatter');
                return;
            case 'back-matter':
                await this.createMatterNote('Backmatter');
                return;
            case 'backdrop':
                await this.createBackdropNote();
                return;
            case 'bookmeta':
                await this.createBookMetaNote();
                return;
            case 'beat':
                await this.createBeatNote();
                return;
            case 'character':
                await this.createEntityNote('character');
                return;
            case 'place':
                await this.createEntityNote('place');
                return;
        }
    }

    /**
     * Create a Character or Place profile note in the entity folder that sits
     * parallel to the active book's scene folder (author-vault convention).
     */
    private async createEntityNote(kind: EntityKind): Promise<void> {
        const book = await ensureActiveBookFolder(this.plugin);
        if (!book) return;
        try {
            const folderPath = entityFolderFor(sanitizeSourcePath(book.sourceFolder), kind);
            if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
                await this.app.vault.createFolder(folderPath);
            }
            const label = kind === 'character' ? 'Character' : 'Place';
            let path = `${folderPath}/New ${label}.md`;
            for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
                path = `${folderPath}/New ${label} ${i}.md`;
            }
            const content = buildEntityNoteContent(kind, { book: book.title ?? '', sceneCount: 0 }); // SAFE: entity-note header field; an untitled book leaves the header blank rather than inventing a name
            const newFile = await this.app.vault.create(path, content);
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(newFile);
            new Notice(`Created ${label.toLowerCase()} note: ${path.split('/').pop()}`);
        } catch (error) {
            const msg = (error as Error)?.message || String(error);
            new Notice(`Failed to create ${kind} note: ` + msg);
        }
    }

    private isUnsupportedExportConfig(options: ManuscriptModalResult): boolean {
        if (options.outputFormat !== 'markdown' && options.outputFormat !== 'pdf' && options.outputFormat !== 'docx') return true;
        return false;
    }

    /**
     * Create a new scene note with basic, advanced, screenplay, or podcast template.
     */
    private async createSceneNote(type: 'base' | 'advanced' | 'screenplay' | 'podcast'): Promise<void> {
        const book = await ensureActiveBookFolder(this.plugin);
        if (!book) return;
        const sourcePath = book.sourceFolder;

        try {
            const sanitizedPath = sanitizeSourcePath(sourcePath);

            const nameMap: Record<string, string> = {
                base: '1 Basic Scene.md',
                advanced: '1 Advanced Scene.md',
                screenplay: 'Screenplay Scene.md',
                podcast: 'Podcast Scene.md'
            };
            const defaultName = nameMap[type] || 'Basic Scene.md';
            const filename = buildInitialSceneFilename(defaultName);
            const folder = this.app.vault.getAbstractFileByPath(sanitizedPath);

            if (!folder) {
                await this.app.vault.createFolder(sanitizedPath);
            }

            const path = `${sanitizedPath}/${filename}`;

            // YAML template resolution is centralized in `getTemplateParts()`; do not re-merge templates here.
            const sceneParts = getTemplateParts('Scene', this.plugin.settings);
            const template = type === 'advanced' ? sceneParts.merged : sceneParts.base;

            // When is intentionally left blank — the author sets the scene's
            // chronology via Timeline Order Normalizer or by editing the YAML.
            const content = generateSceneContent(template, {
                act: 1,
                when: '',
                sceneNumber: 1,
                subplots: ['Main Plot'],
                character: type === 'podcast' ? 'HOST' : 'Hero',
                place: type === 'screenplay' ? 'INT. LOCATION' : 'Unknown',
                characterList: type === 'podcast' ? ['HOST', 'GUEST'] : ['Hero'],
                placeList: type === 'screenplay' ? ['INT. LOCATION'] : ['Unknown']
            });

            let finalContent = ensureSceneTemplateFrontmatter(content).frontmatter;

            if (type === 'screenplay') {
                finalContent = finalContent.replace(/^(Runtime:)\s*$/m, '$1 3:00');
            } else if (type === 'podcast') {
                finalContent = finalContent.replace(/^(Runtime:)\s*$/m, '$1 8:00');
            }

            let body = '';
            if (type === 'screenplay') {
                body = SCREENPLAY_BODY_SCAFFOLD;
            } else if (type === 'podcast') {
                body = PODCAST_BODY_SCAFFOLD;
            }

            const fileContent = `---\n${finalContent}\n---\n\n${body}`;

            const newFile = await this.app.vault.create(path, fileContent);
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(newFile);

            const labelMap: Record<string, string> = {
                base: 'core', advanced: 'advanced properties', screenplay: 'screenplay', podcast: 'podcast'
            };
            new Notice(`Created ${labelMap[type]} scene note: ${filename}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            new Notice('Failed to create scene note: ' + msg);
        }
    }

    /**
     * Create a new front-matter or back-matter note.
     */
    private async createMatterNote(classValue: 'Frontmatter' | 'Backmatter'): Promise<void> {
        const book = await ensureActiveBookFolder(this.plugin);
        if (!book) return;
        const sourcePath = book.sourceFolder;

        try {
            const sanitizedPath = sanitizeSourcePath(sourcePath);
            const isFront = classValue === 'Frontmatter';
            const defaultPrefix = isFront ? '0.01' : '200.01';
            const defaultLabel = isFront ? 'Front Matter' : 'Back Matter';
            const defaultName = `${defaultPrefix} ${defaultLabel}.md`;
            const filename = buildInitialSceneFilename(defaultName);
            const folder = this.app.vault.getAbstractFileByPath(sanitizedPath);

            if (!folder) {
                await this.app.vault.createFolder(sanitizedPath);
            }

            const filePath = `${sanitizedPath}/${filename}`;
            const yaml = `Class: ${classValue}`;

            const fileContent = `---\n${yaml}\n---\n\n`;

            const newFile = await this.app.vault.create(filePath, fileContent);
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(newFile);
            new Notice(`Created ${defaultLabel.toLowerCase()} note: ${filename}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to create ${classValue.toLowerCase()} note: ${msg}`);
        }
    }

    private async createBookMetaNote(): Promise<void> {
        const targetFolder = await this.resolveBookMetaFolder();
        if (targetFolder === null) return;

        try {
            if (targetFolder && !this.app.vault.getAbstractFileByPath(targetFolder)) {
                await this.app.vault.createFolder(targetFolder);
            }

            const filePath = this.buildCopySafeVaultPath(targetFolder, '000 BookMeta.md');
            const currentYear = new Date().getFullYear();
            const yaml = [
                'Class: BookMeta',
                'Book:',
                '  title: "Untitled Manuscript"',
                '  subtitle: ""',
                '  author: "Author"',
                'Rights:',
                '  copyright_holder: "Copyright Holder"',
                `  year: ${currentYear}`,
                'Identifiers:',
                '  isbn_paperback: "000-0-00-000000-0"',
                'Publisher:',
                '  name: "Publisher"',
                '  imprint: "Imprint"',
                '  edition: "1"',
                'Frontmatter:',
                '  title_page_note: ""',
                '  dedication: ""',
                '  epigraph_quote: ""',
                '  epigraph_attribution: ""',
                'Backmatter:',
                '  acknowledgments: ""',
                '  about_author: ""',
                '  author_note: ""',
                '  other_works: ""',
                'Production:',
                '  imprint: "Imprint"',
                '  edition: "1"',
                '  print_location: "City, Country"'
            ].join('\n');

            const fileContent = `---\n${yaml}\n---\n\n`;
            const newFile = await this.app.vault.create(filePath, fileContent);
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(newFile);
            new Notice(`Created BookMeta note: ${newFile.name}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to create BookMeta note: ${msg}`);
        }
    }

    private async resolveBookMetaFolder(): Promise<string | null> {
        const activeSource = getActiveBookExportContext(this.plugin).sourceFolder.trim();
        if (activeSource) {
            return sanitizeSourcePath(activeSource);
        }

        const book = await ensureActiveBookFolder(this.plugin);
        if (!book) return null;
        return sanitizeSourcePath(book.sourceFolder);
    }

    private buildCopySafeVaultPath(folderPath: string, baseFilename: string): string {
        const extIdx = baseFilename.lastIndexOf('.');
        const stem = extIdx > 0 ? baseFilename.slice(0, extIdx) : baseFilename;
        const ext = extIdx > 0 ? baseFilename.slice(extIdx) : '';
        const join = (name: string): string => folderPath ? `${folderPath}/${name}` : name;

        let attempt = 0;
        let candidateName = baseFilename;
        let candidatePath = join(candidateName);
        while (this.app.vault.getAbstractFileByPath(candidatePath)) {
            attempt += 1;
            candidateName = attempt === 1
                ? `${stem} (copy)${ext}`
                : `${stem} (copy ${attempt})${ext}`;
            candidatePath = join(candidateName);
        }
        return candidatePath;
    }

    /**
     * Create a new backdrop note.
     */
    private async createBackdropNote(): Promise<void> {
        const book = await ensureActiveBookFolder(this.plugin);
        if (!book) return;
        const sourcePath = book.sourceFolder;

        try {
            const sanitizedPath = sanitizeSourcePath(sourcePath);
            const filename = buildInitialBackdropFilename();
            const folder = this.app.vault.getAbstractFileByPath(sanitizedPath);

            if (!folder) {
                await this.app.vault.createFolder(sanitizedPath);
            }

            const path = `${sanitizedPath}/${filename}`;

            // Build backdrop template from single source of truth
            const template = getTemplateParts('Backdrop', this.plugin.settings).merged;

            // When/End are left blank — the author sets backdrop dates explicitly.
            const content = template
                .replace(/{{When}}/g, '')
                .replace(/{{End}}/g, '');
            const withReferenceId = ensureReferenceIdTemplateFrontmatter(content, 'Backdrop');

            const fileContent = `---\n${withReferenceId.frontmatter}\n---\n\n`;

            const newFile = await this.app.vault.create(path, fileContent);
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(newFile);
            new Notice(`Created backdrop note: ${filename}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            new Notice('Failed to create backdrop note: ' + msg);
        }
    }

    /**
     * Create a single beat note with the active beat template.
     */
    private async createBeatNote(): Promise<void> {
        const book = await ensureActiveBookFolder(this.plugin);
        if (!book) return;
        const sourcePath = book.sourceFolder;

        try {
            const sanitizedPath = sanitizeSourcePath(sourcePath);
            const folder = this.app.vault.getAbstractFileByPath(sanitizedPath);
            if (!folder) {
                await this.app.vault.createFolder(sanitizedPath);
            }

            const template = getTemplateParts('Beat', this.plugin.settings).merged;
            const content = template
                .replace(/{{Act}}/g, '1')
                .replace(/{{Purpose}}/g, '""')
                .replace(/{{Description}}/g, '""')
                .replace(/{{BeatModel}}/g, '')
                .replace(/{{Range}}/g, '');
            const withReferenceId = ensureReferenceIdTemplateFrontmatter(content, 'Beat');

            const filePath = this.buildCopySafeVaultPath(sanitizedPath, 'Beat.md');
            const fileContent = `---\n${withReferenceId.frontmatter}\n---\n\n`;

            const newFile = await this.app.vault.create(filePath, fileContent);
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(newFile);
            new Notice('Created beat note.');
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            new Notice('Failed to create beat note: ' + msg);
        }
    }

}

// ═══════════════════════════════════════════════════════════════════════════════
// BODY SCAFFOLDS — appended after YAML frontmatter for format-specific scenes
// ═══════════════════════════════════════════════════════════════════════════════

const SCREENPLAY_BODY_SCAFFOLD = [
    'INT. LOCATION - DAY',
    '',
    'Action description.',
    '',
    '                    CHARACTER',
    '          Dialogue here.',
    '',
    ''
].join('\n');

const PODCAST_BODY_SCAFFOLD = [
    '[SEGMENT: INTRODUCTION - 0:00]',
    '',
    'HOST: Opening line.',
    '',
    '[SFX: Theme music]',
    '',
    '[SEGMENT: MAIN DISCUSSION - 2:00]',
    '',
    'HOST: Question or transition.',
    '',
    'GUEST: Response.',
    '',
    '[SEGMENT: CLOSING]',
    '',
    'HOST: Closing remarks.',
    '',
    '[END]',
    '',
    ''
].join('\n');
