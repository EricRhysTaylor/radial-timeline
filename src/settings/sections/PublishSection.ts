import { compactLayoutOptions, readLayoutOptions } from './publish/layoutOptions';
import { renderImportedLayoutSummary } from './publish/ImportedLayoutSummary';
/* global __RT_RELEASE__ -- build-time flags injected by esbuild define; see esbuild.config.mjs */
/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 * 
 * Pro Feature Panels
 */

import { App, Setting, setIcon, normalizePath, Notice, TFile, TFolder, Modal, ButtonComponent, TextComponent } from 'obsidian';
import { existsSync } from 'fs';
import type RadialTimelinePlugin from '../../main';
import { ERT_CLASSES, ERT_DATA } from '../../ui/classes';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { DEFAULT_SETTINGS } from '../defaults';
import { getStructuredFontDiagnostic, parseCustomPandocMetadata, validatePandocLayout, getPandocFolder } from '../../utils/exportFormats';
import type { BookLayoutOptions, BookMeta, BookProfile, ManuscriptSceneHeadingMode, PandocLayoutTemplate, TemplateProfile } from '../../types';
import { ImportTemplateModal, type ImportedTemplateCommit } from '../../modals/ImportTemplateModal';
import { DesignedStyleWizardModal } from '../../modals/DesignedStyleWizardModal';
import { confirmWithErtModal } from '../../modals/ErtConfirmModal';
import { getActiveBookExportContext } from '../../utils/exportContext';
import { getActiveBook } from '../../utils/books';
import { slugifyToFileStem } from '../../utils/slug';
import { resolveBookPages, applyBookPageOrder, inferRoleFromFilename, ROLE_SIDE, type BookPageRole, type ResolvedPage } from '../../utils/bookPagesResolver';
import { resolveManuscriptOutputFolder } from '../../utils/aiOutput';
import { systemFolderPath } from '../../utils/systemFolder';
import { updateBookMetaField, type EditableBookMetaFieldKey } from '../../utils/bookMetaEditing';
import { isProActive } from '../proEntitlement';
import {
    buildTimelineChapterResolverItems,
    collapseTimelineChapterMarkersByResolvedBoundary,
    resolveTimelineChapterMarkers
} from '../../utils/timelineChapters';
import {
    describeMatterReadiness
} from '../../services/PublishingValidationService';
import { adaptPandocLayoutsToPublishingModel } from '../../utils/publishingModel';
import { buildPublishingProgressStages, type PublishingStageId } from '../../utils/publishingProgress';
import {
    acknowledgeHotfixHistory,
    ensureBundledLayoutInstalledForExport,
    ensureBundledPandocLayoutsRegistered,
    formatFontFileSize,
    getBundledPandocLayouts,
    installBundledPandocLayouts,
    isBundledPandocLayoutInstalled,
    type BundledFontInstallResult
} from '../../utils/pandocBundledLayouts';
import { getPandocLayoutTier } from '../../publishing/templateTiering';
import {
    applySpreadValidation,
    collectSpreadStatuses,
    getFictionVariantForLayout,
    getLayoutFeatures,
    getLayoutFeaturesFromSpec,
    getLayoutPictogramRows,
    renderLayoutFeatureList,
    renderLayoutPictograms,
    type FictionLayoutVariant,
} from '../../publishing/layoutVisuals';
import { buildSpreadValidationContext } from '../../publishing/spreadValidationContext';
import { BUNDLED_FICTION_SPECS, isBundledFictionId } from '../../publishing/bundledStyleSpecs';
import { replayTransientClass } from '../../utils/domClassEffects';
import { listAvailableLatexEngines, scanSystemPaths, isPandocPathValid } from '../../publishing/toolchainScan';
import { applyMatterRepairPlan, buildMatterRepairPlan } from '../../publishing/matterRepair';
import { getActiveBookMatterNoteSummaries, getActiveBookMetaStatus } from '../../publishing/activeBookNotes';
import { getMatterPreviewSummary, getPublishingProgressContext, getPublishingValidationSnapshot, type MatterPreviewItem } from '../../publishing/readinessSummary';
import { createBookMetaOnly, ensurePublishingEnvironment, generateSampleTemplates, maybeRenameTemplateFileForPathChange } from '../../publishing/starterSetup';
import { compactTemplatePathForStorage } from '../../utils/templateImport';

// Example shown in the Custom Pandoc metadata field. This is literal Pandoc
// metadata syntax (case-sensitive keys), not sentence-case UI copy, so it must
// stay verbatim and lowercase.
const PANDOC_METADATA_PLACEHOLDER = 'lang: en-US\nsubtitle: A Novel';

/**
 * Reveal a file in the OS file manager (Finder on macOS, Explorer on
 * Windows, default file manager on Linux), highlighting it in its
 * containing folder. Desktop-only (electron.shell); shows a Notice instead
 * of failing silently if unavailable.
 */
function revealAbsolutePathInFileManager(absolutePath: string): void {
    try {
        // electron.shell is available in the desktop renderer process
        const electron = (window as unknown as { require?: (name: string) => { shell?: { showItemInFolder: (p: string) => void } } }).require?.('electron'); // SAFE: Electron shell reveal is the standard desktop-only way to open Finder/Explorer at a file.
        const shell = electron?.shell;
        if (!shell) {
            new Notice(`Could not open file manager. Path: ${absolutePath}`);
            return;
        }
        shell.showItemInFolder(absolutePath);
    } catch {
        new Notice(`Could not open file manager. Path: ${absolutePath}`);
    }
}

/**
 * Build a rich Notice fragment: a headline plus one clickable pill per
 * installed/verified font file (abbreviated name, folder, size). Clicking a
 * pill reveals that exact file in the OS file manager so the user can
 * verify it themselves rather than take the Notice's word for it. Returns
 * null when there is nothing to show (e.g. install failed before any font
 * was touched).
 */
function buildFontPillsNotice(ownerDoc: Document, headline: string, fonts: BundledFontInstallResult): DocumentFragment | string {
    const families = [...fonts.installed, ...fonts.alreadyPresent].filter(f => f.files.length > 0);
    if (families.length === 0) return headline;

    const fragment = ownerDoc.win.createFragment();
    const wrapper = fragment.createDiv();
    wrapper.createDiv({ text: headline });
    const row = wrapper.createDiv({ cls: 'ert-font-pill-row' });
    for (const { family, files } of families) {
        for (const file of files) {
            const pill = row.createEl('button', { cls: 'ert-font-pill', attr: { type: 'button' } });
            pill.createSpan({ cls: 'ert-font-pill-name', text: file.file });
            pill.createSpan({ cls: 'ert-font-pill-meta', text: `fonts/${family} · ${formatFontFileSize(file.sizeBytes)}` });
            pill.setAttribute('title', `${file.absolutePath}\nClick to reveal in file manager.`);
            pill.addEventListener('click', () => revealAbsolutePathInFileManager(file.absolutePath));
        }
    }
    return fragment;
}

const STARTER_PUBLISHING_SETUP_ALREADY_EXISTS = 'Starter publishing files already exist.';

const AUTO_CONFIGURE_BUTTON = 'Auto configure publishing';
const AUTO_CONFIGURE_BUSY = 'Configuring publishing…';

class StarterPublishingSetupModal extends Modal {
    private readonly onConfirm: (confirmed: boolean) => void;
    private resolved = false;

    constructor(app: App, onConfirm: (confirmed: boolean) => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal--template-pack');
            modalEl.setCssStyles({ width: '560px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-template-pack-modal');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        const badge = header.createSpan({ cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_NEUTRAL}` });
        const badgeIcon = badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
        setIcon(badgeIcon, 'book-open-text');
        badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: 'CORE' });
        header.createDiv({ cls: 'ert-modal-title', text: AUTO_CONFIGURE_BUTTON });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Detects Pandoc and LaTeX, installs bundled templates/fonts into your vault, and creates starter publishing notes. External apps are not downloaded.'
        });

        const createdBlock = contentEl.createDiv({ cls: 'ert-template-pack-created ert-stack--tight' });
        const createdHeading = createdBlock.createDiv({ cls: 'ert-template-pack-subtitle' });
        const createdHeadingIcon = createdHeading.createSpan({ cls: 'ert-template-pack-subtitle-icon' });
        setIcon(createdHeadingIcon, 'list-checks');
        createdHeading.createSpan({ text: 'What this setup creates' });
        const createdList = createdBlock.createEl('ol', { cls: 'ert-template-pack-list ert-template-pack-list--ordered' });
        const items = [
            'Pandoc and LaTeX detection',
            'Bundled templates and vault-local fonts',
            'Book Details note',
            'Inline LaTeX front/back matter examples',
        ];
        items.forEach(item => {
            const listItem = createdList.createEl('li', { cls: 'ert-template-pack-list-item' });
            listItem.setText(item);
        });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions ert-template-pack-actions' });
        const generateButton = new ButtonComponent(actions)
            .setButtonText(AUTO_CONFIGURE_BUTTON);
        generateButton.setCta();
        generateButton.buttonEl.addClass('ert-btn');
        generateButton.onClick(() => {
                this.resolved = true;
                this.close();
                this.onConfirm(true);
            });
        new ButtonComponent(actions)
            .setButtonText('Cancel')
            .onClick(() => {
                this.resolved = true;
                this.close();
                this.onConfirm(false);
            });
    }

    onClose(): void {
        if (!this.resolved) {
            this.resolved = true;
            this.onConfirm(false);
        }
        this.contentEl.empty();
    }
}

async function confirmStarterPublishingSetup(app: App): Promise<boolean> {
    return new Promise((resolve) => {
        new StarterPublishingSetupModal(app, resolve).open();
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFESSIONAL SECTION FLAGS
// ═══════════════════════════════════════════════════════════════════════════════
const SHOW_SCREENPLAY_LAYOUT_CATEGORY = false;
const SHOW_PODCAST_LAYOUT_CATEGORY = false;

export interface PublishSectionParams {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

export function renderPublishSection({ app, plugin, containerEl }: PublishSectionParams): HTMLElement {
    const isActive = isProActive(plugin);
    const section = containerEl;

    const rerender = () => {
        containerEl.empty();
        renderPublishSection({ app, plugin, containerEl });
    };

    if (ensureBundledPandocLayoutsRegistered(plugin)) {
        void plugin.saveSettings();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONTENT STACK
    // ─────────────────────────────────────────────────────────────────────────
    const addProRow = (setting: Setting) => setting;
    let refreshPublishingStatusCard: () => void = () => {};

    // ─────────────────────────────────────────────────────────────────────────
    // PANDOC & EXPORT SETTINGS
    // ─────────────────────────────────────────────────────────────────────────
    const publishingStagesPanel = section.createDiv({ cls: `${ERT_CLASSES.STACK}` });
    publishingStagesPanel.addClass('ert-publish-order--stages');
    const statusShell = publishingStagesPanel.createDiv({ cls: 'ert-publishing-status-shell' });
    const statusGrid = statusShell.createDiv({ cls: 'ert-publishing-status-grid' });
    const setupActionRow = publishingStagesPanel.createDiv({ cls: 'ert-publishing-status-action' });

    const pandocIntroPanel = section.createDiv({ cls: ERT_CLASSES.STACK });
    pandocIntroPanel.addClass('ert-publish-order--pandoc-intro');
    const pandocHeading = addProRow(new Setting(pandocIntroPanel))
        .setName('Export & publishing')
        .setDesc('Assemble your manuscript in Markdown or render a print-ready PDF using Pandoc and LaTeX. Configure templates, layouts, and publishing tools below. Exports run the Pandoc and LaTeX programs already installed on your computer — nothing else is downloaded or executed.')
        .setHeading();
    addHeadingIcon(pandocHeading, 'book-open-text');
    addWikiLink(pandocHeading, 'Publishing');
    applyErtHeaderLayout(pandocHeading);

    const systemConfigPanel = section.createDiv({
        cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK}`,
        attr: { [ERT_DATA.SECTION]: 'export-check' }
    });
    systemConfigPanel.addClass('ert-publish-order--export-check');
    // Hidden by default — revealed when validation fails or user expands Advanced
    systemConfigPanel.addClass('is-hidden');
    const revealSystemConfig = () => {
        systemConfigPanel.removeClass('is-hidden');
        systemConfigPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const systemConfigHeading = addProRow(new Setting(systemConfigPanel))
        .setName('System configuration')
        .setDesc('Configure Pandoc for PDF export.')
        .setHeading();
    addHeadingIcon(systemConfigHeading, 'settings');
    applyErtHeaderLayout(systemConfigHeading);

    // Settings
    let pandocPathInputEl: HTMLInputElement | null = null;
    const defaultDesc = 'Path to your Pandoc executable. Required for PDF rendering. Leave blank to use your system PATH, or click Auto locate.';
    const pandocSetting = addProRow(new Setting(systemConfigPanel))
        .setName('Pandoc & LaTeX')
        .setDesc(defaultDesc)
        .addText(text => {
            text.inputEl.addClass('ert-input--lg');
            text.setPlaceholder('/usr/local/bin/pandoc');
            text.setValue(plugin.settings.pandocPath || '');
            pandocPathInputEl = text.inputEl;
            plugin.registerDomEvent(text.inputEl, 'blur', async () => {
                const value = text.getValue().trim();
                plugin.settings.pandocPath = value;
                await plugin.saveSettings();
                refreshPublishingStatusCard();
            });
        })
        .addButton(button => {
            button.setButtonText('Auto locate');
            button.onClick(async () => {
                button.setDisabled(true);
                button.setButtonText('Locating…');
                try {
                    const scan = await scanSystemPaths();
                    const msgs: string[] = [];

                    if (scan.pandocPath) {
                        msgs.push(`✓ Pandoc found at ${scan.pandocPath}`);
                        // Fill when empty — and also repair a configured path
                        // that no longer exists on disk (e.g. a Homebrew
                        // install that was removed). Auto locate is the
                        // explicit fix-it button, so replacing a dead value
                        // here is its job, not a silent fallback.
                        const configured = (plugin.settings.pandocPath || '').trim(); // SAFE: an empty path is the "not configured" state this function goes on to report
                        const configuredIsStale = configured.length > 0
                            && configured.includes('/')
                            && !existsSync(configured);
                        if (!configured || configuredIsStale) {
                            if (configuredIsStale) {
                                msgs.push(`Replaced missing path ${configured}`);
                            }
                            plugin.settings.pandocPath = scan.pandocPath;
                            await plugin.saveSettings();
                            refreshPublishingStatusCard();
                            if (pandocPathInputEl) {
                                pandocPathInputEl.value = scan.pandocPath;
                                pandocPathInputEl.addClass('ert-setting-input-success');
                                window.setTimeout(() => pandocPathInputEl?.removeClass('ert-setting-input-success'), 1200);
                            }
                        }
                    } else {
                        msgs.push('⚠ Pandoc not found — install from pandoc.org');
                    }

                    if (scan.latexPath) {
                        msgs.push(`✓ LaTeX found (${scan.latexEngine})`);
                        const availableEngines = listAvailableLatexEngines();
                        if (availableEngines.length > 0) {
                            msgs.push(`Available engines: ${availableEngines.map(item => item.engine).join(', ')}`);
                        }
                        msgs.push('Auto PDF engine: xelatex/lualatex for fontspec templates, otherwise pdflatex.');
                    } else {
                        msgs.push('⚠ LaTeX not found — needed for PDF export');
                    }

                    pandocSetting.setDesc(msgs.join(' · '));
                    new Notice(msgs.join('\n'));

                    // Revert description after 8 seconds
                    window.setTimeout(() => {
                        pandocSetting.setDesc(defaultDesc);
                    }, 8000);
                } catch (e) {
                    const msg = (e as Error).message || String(e);
                    pandocSetting.setDesc(`Error: ${msg}`);
                    window.setTimeout(() => {
                        pandocSetting.setDesc(defaultDesc);
                    }, 5000);
                } finally {
                    button.setDisabled(false);
                    button.setButtonText('Auto locate');
                }
            });
        });

    // ── Pandoc Folder ──────────────────────────────────────────────────────
    const defaultPandocFolder = normalizePath(DEFAULT_SETTINGS.pandocFolder || systemFolderPath('Pandoc'));
    let pandocFolderText: TextComponent | null = null;
    let pandocFolderInputEl: HTMLInputElement | null = null;
    const saveAndValidatePandocFolder = async (): Promise<void> => {
        if (!pandocFolderText || !pandocFolderInputEl) return;
        const raw = pandocFolderText.getValue().trim();
        const normalized = normalizePath(raw || defaultPandocFolder);
        pandocFolderText.setValue(normalized);
        plugin.settings.pandocFolder = normalized;
        await plugin.saveSettings();

        const folder = plugin.app.vault.getAbstractFileByPath(normalized);
        const cls = (folder && folder instanceof TFolder)
            ? 'ert-input--flash-success'
            : 'ert-input--flash-error';
        replayTransientClass(pandocFolderInputEl, cls, {
            removeClasses: ['ert-input--flash-success', 'ert-input--flash-error'],
            durationMs: 1700
        });
    };

    const pandocFolderSetting = addProRow(new Setting(systemConfigPanel))
        .setName('Pandoc folder')
        .setDesc('Global folder for PDF layout templates (.tex) and compile helpers. Used during PDF rendering. Final exports are saved to the Export folder.')
        .addText(text => {
            pandocFolderText = text;
            pandocFolderInputEl = text.inputEl;
            text.inputEl.addClass('ert-input--lg');
            text.setPlaceholder(defaultPandocFolder);
            text.setValue(normalizePath(plugin.settings.pandocFolder || defaultPandocFolder));
            plugin.registerDomEvent(text.inputEl, 'blur', () => { void saveAndValidatePandocFolder(); });
            plugin.registerDomEvent(text.inputEl, 'keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveAndValidatePandocFolder();
                }
            });
        });
    pandocFolderSetting.addExtraButton(button => {
        button.setIcon('rotate-ccw');
        button.setTooltip('Reset to default (Radial Timeline/Pandoc)');
        button.extraSettingsEl.addClass('ert-iconBtn');
        button.onClick(async () => {
            if (pandocFolderText) {
                pandocFolderText.setValue(defaultPandocFolder);
            }
            plugin.settings.pandocFolder = defaultPandocFolder;
            await plugin.saveSettings();
            if (pandocFolderInputEl) {
                replayTransientClass(pandocFolderInputEl, 'ert-input--flash-success', {
                    removeClasses: ['ert-input--flash-success', 'ert-input--flash-error'],
                    durationMs: 1700
                });
            }
        });
    });

    // ── Advanced Pandoc (Pro) ────────────────────────────────────────────────
    // Migration escape hatches for authors arriving with an existing Pandoc
    // setup: extra --metadata pairs (custom templates read variables beyond
    // title/author) and raw LaTeX preamble injected via --include-in-header.
    // Deliberately parented to systemConfigPanel so it lives inside the
    // collapsed "Advanced configuration" disclosure — this is power-user
    // territory that must not clutter the default publishing flow.
    const advancedPanel = systemConfigPanel.createDiv({
        cls: ERT_CLASSES.STACK,
        attr: { [ERT_DATA.SECTION]: 'pandoc-advanced' }
    });
    const advancedHeading = addProRow(new Setting(advancedPanel))
        .setName('Advanced Pandoc')
        .setDesc('A Pro workflow. Carry an existing Pandoc/LaTeX setup into exports. Applies to PDF export only.')
        .setHeading();
    addHeadingIcon(advancedHeading, 'wrench');
    applyErtHeaderLayout(advancedHeading);

    addProRow(new Setting(advancedPanel))
        .setName('Custom Pandoc metadata')
        .setDesc('One "key: value" per line, passed to Pandoc as metadata for custom/imported templates. Title and author always come from Book Details. Lines starting with # are ignored.')
        .addTextArea(text => {
            text.inputEl.rows = 4;
            text.inputEl.addClass('ert-input--lg');
            // Literal Pandoc metadata syntax; keys are case-sensitive and must
            // stay lowercase, so this example is not sentence-cased UI copy.
            text.setPlaceholder(PANDOC_METADATA_PLACEHOLDER);
            text.setValue(plugin.settings.customPandocMetadata || ''); // SAFE: no custom metadata saved yet, so the textarea opens empty
            text.setDisabled(!isActive);
            plugin.registerDomEvent(text.inputEl, 'blur', async () => {
                const raw = text.getValue();
                plugin.settings.customPandocMetadata = raw;
                await plugin.saveSettings();
                // Surface lines the export-time parser will skip, so authors
                // learn about a typo here rather than by missing metadata in
                // a rendered PDF.
                const accepted = parseCustomPandocMetadata(raw);
                const meaningful = raw.split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'));
                const skipped = meaningful.length - Object.keys(accepted).length;
                if (skipped > 0) {
                    new Notice(`Custom Pandoc metadata: ${skipped} line${skipped === 1 ? '' : 's'} will be ignored (need "key: value" with a plain identifier key).`);
                }
            });
        });

    addProRow(new Setting(advancedPanel))
        .setName('Custom LaTeX preamble')
        .setDesc('Raw LaTeX injected into the PDF preamble after the layout\'s own setup (your definitions win). For migrated macros and packages, e.g. \\usepackage or \\newcommand lines. Invalid LaTeX will fail the export with Pandoc\'s error.')
        .addTextArea(text => {
            text.inputEl.rows = 6;
            text.inputEl.addClass('ert-input--lg');
            text.setPlaceholder('% e.g.\n% \\usepackage{lettrine}\n% \\newcommand{\\mymacro}{...}');
            text.setValue(plugin.settings.customLatexPreamble || ''); // SAFE: no custom preamble saved yet, so the textarea opens empty
            text.setDisabled(!isActive);
            plugin.registerDomEvent(text.inputEl, 'blur', async () => {
                plugin.settings.customLatexPreamble = text.getValue();
                await plugin.saveSettings();
            });
        });

    // ── Layout Registry Subsection ──────────────────────────────────────────
    const layoutPanel = section.createDiv({
        cls: ERT_CLASSES.STACK,
        attr: { [ERT_DATA.SECTION]: 'pdf-style' }
    });
    layoutPanel.addClass('ert-publish-order--pdf-style');
    const layoutHeading = addProRow(new Setting(layoutPanel))
        .setName('PDF style')
        .setDesc('Choose the style used for exported PDFs. Built-in and custom styles are listed below.')
        .setHeading();
    addHeadingIcon(layoutHeading, 'book-open');
    applyErtHeaderLayout(layoutHeading);

    const normalizeVersionLabels = (label: string): string =>
        label.replace(/\bv(?:ersion)?\s*\d+(?:\.\d+)?\b/gi, '').replace(/\s{2,}/g, ' ').trim();

    let layoutProfilesById = new Map<string, TemplateProfile>();

    const getLayoutDisplayName = (layout: PandocLayoutTemplate): string => {
        if (layout.preset === 'novel' && layout.bundled) {
            const variant = getFictionVariantForLayout(layout);
            if (variant === 'classic') return 'Basic';
            if (variant === 'contemporary') return 'Standard';
            if (variant === 'signature') return 'Professional';
            if (variant === 'modernClassic') return 'Signature';
        }
        if (layout.preset === 'screenplay' && layout.bundled) return 'Screenplay';
        return normalizeVersionLabels(layout.name || 'Custom Layout');
    };
    // Single source of truth: descriptions are authored on the template itself.
    // Bundled templates carry their description in pandocBundledLayouts.ts.
    // Duplicated templates inherit at duplicate time. Imports set their own on import.
    const buildLayoutDescription = (layout: PandocLayoutTemplate): string => {
        return layout.description?.trim() || '';
    };
    /**
     * Click-to-edit inline text. Displays as plain text until clicked, then swaps to an
     * input/textarea. Enter commits, Escape cancels, blur commits.
     */
    type InlineEditableOptions = {
        placeholder?: string;
        multiline?: boolean;
        onSave: (next: string) => Promise<void> | void;
        fallbackText?: string;
        displayClass?: string;
        inputClass?: string;
    };
    const renderInlineEditable = (
        container: HTMLElement,
        initialValue: string,
        options: InlineEditableOptions
    ): void => {
        const display = container.createSpan({
            cls: `ert-editable-display ${options.displayClass || ''}`.trim(),
            text: initialValue || options.fallbackText || ''
        });
        display.setAttr('role', 'button');
        display.setAttr('tabindex', '0');
        display.setAttr('aria-label', 'Click to edit');
        display.setAttr('title', 'Click to edit');

        const swapToEditor = () => {
            const current = display.textContent || '';
            display.hide();
            const inputCls = `ert-editable-input ${options.inputClass || ''}`.trim();
            const input = options.multiline
                ? container.createEl('textarea', {
                    cls: `ert-textarea ${inputCls}`,
                    attr: { rows: '2' }
                })
                : container.createEl('input', {
                    type: 'text',
                    cls: `ert-input ${inputCls}`
                });
            input.value = current.trim() === (options.fallbackText || '').trim() ? '' : current;
            if (options.placeholder) input.placeholder = options.placeholder;

            let committed = false;
            const commit = async () => {
                if (committed) return;
                committed = true;
                const next = input.value.trim();
                input.remove();
                display.show();
                display.textContent = next || options.fallbackText || '';
                if (next !== current.trim()) {
                    try { await options.onSave(next); } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        new Notice(`Update failed: ${msg}`);
                    }
                }
            };

            plugin.registerDomEvent(input, 'blur', () => { void commit(); });
            plugin.registerDomEvent(input, 'keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    committed = true;
                    input.remove();
                    display.show();
                }
            });

            input.focus();
            if (typeof (input as HTMLInputElement).select === 'function') {
                (input as HTMLInputElement).select();
            }
        };

        plugin.registerDomEvent(display, 'click', swapToEditor);
        plugin.registerDomEvent(display, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                swapToEditor();
            }
        });
    };

    type LayoutVisualOptions = {
        layoutId?: string;
        description?: string;
        editableDescription?: { onSave: (next: string) => Promise<void> | void };
    };
    const buildLayoutVisual = (
        container: HTMLElement,
        variant: FictionLayoutVariant,
        options: LayoutVisualOptions & { layout?: PandocLayoutTemplate } = {}
    ): void => {
        const visual = container.createDiv({ cls: 'ert-layout-visual' });
        const cols = visual.createDiv({ cls: 'ert-layout-visual-cols' });

        // Prefer spec-driven feature rows when a spec is reachable. Order:
        //   1. Layout carries a designedSpec directly (Designed Pro styles).
        //   2. Layout is a bundled fiction template — look up the canonical spec
        //      by ID so saved layouts that lost the inline designedSpec still
        //      get the same rich Paper / Margins / Line-spacing rows the wizard
        //      shows. (Without this, bundled cards fell through to the legacy
        //      variant-keyed table which omitted Paper + Margins.)
        //   3. Last resort: legacy variant-keyed rows (custom imports, etc.).
        const layoutId = options.layout?.id;
        const bundledSpec = layoutId && isBundledFictionId(layoutId)
            ? BUNDLED_FICTION_SPECS[layoutId]
            : undefined;
        const resolvedSpec = options.layout?.designedSpec ?? bundledSpec;
        const features = resolvedSpec
            ? getLayoutFeaturesFromSpec(resolvedSpec)
            : getLayoutFeatures(variant);
        const featureCol = renderLayoutFeatureList(cols, features);

        // Description row: appended below feature rows, separated by a subtle rule.
        // Read-only for bundled templates; click-to-edit for duplicated templates.
        if (options.description || options.editableDescription) {
            featureCol.createDiv({ cls: 'ert-layout-feature-divider' });
            const descRow = featureCol.createDiv({ cls: 'ert-layout-feature-description' });
            if (options.editableDescription) {
                renderInlineEditable(descRow, options.description || '', {
                    placeholder: 'Describe this layout…',
                    multiline: true,
                    onSave: options.editableDescription.onSave,
                    displayClass: 'ert-layout-feature-description-display',
                    inputClass: 'ert-layout-feature-description-input'
                });
            } else {
                descRow.textContent = options.description || '';
            }
        }

        // Resolve the active scene heading mode for this layout (Signature only)
        const activeSceneMode = options.layoutId
            ? (getLayoutOptionsForActiveBook(options.layoutId).sceneHeadingMode || 'scene-number-title')
            : undefined;

        // Apply the same spread-validation pass the export modal uses, so
        // preview cards in Settings → Publish light up consistently when the
        // active book lacks data the layout promises (e.g. <2 Acts but the
        // layout advertises Part pages, or Part epigraphs configured but no
        // act has a quote). Settings has no scene-selection concept; we pass
        // only the cheap, book-derived inputs (epigraph counts) and let the
        // helper's "no selection → suppress scene-derived warnings" behavior
        // skip the chapter/scene-title checks.
        const baseRows = getLayoutPictogramRows(variant, options.layout);
        const ctx = buildSpreadValidationContext(plugin, {
            layout: options.layout,
            // Book-wide counts prefetched in `refreshBookChapterCounts` so the
            // CHAPTER status / warning surfaces here. `actCount` already falls
            // back to `plugin.settings.actCount` inside the helper.
            bookChapterFieldCount: cachedBookChapterFieldCount,
            bookChapterTitlePopulatedCount: cachedBookChapterTitlePopulatedCount,
        });
        const rows = applySpreadValidation(baseRows, ctx);
        const canSelectSceneMode = !!options.layoutId && (options.layout?.hasSceneOpenerHeadingOptions === true || variant === 'signature');
        renderLayoutPictograms(cols, rows, activeSceneMode, {
            onSceneModeSelect: canSelectSceneMode
                ? (sceneHeadingMode) => {
                    if (!options.layoutId) return;
                    const scoped = getLayoutOptionsForActiveBook(options.layoutId);
                    void saveLayoutOptionsForActiveBook(options.layoutId, {
                        partEpigraphs: scoped.partEpigraphs,
                        partEpigraphAttributions: scoped.partEpigraphAttributions,
                        sceneHeadingMode
                    });
                    renderLayoutRows();
                }
                : undefined,
        });

        // Status lines (Acts/Chapters counts, scene-title coverage) render
        // INSIDE the description column with the same prose styling as the
        // template description, separated by a thin rule. Same visual treatment
        // as the description block: muted text, comfortable line-height. The
        // user sees feature list → rule → description → rule → status.
        const statuses = collectSpreadStatuses(rows, ctx);
        if (statuses.length > 0) {
            featureCol.createDiv({ cls: 'ert-layout-feature-divider' });
            const statusBlock = featureCol.createDiv({ cls: 'ert-layout-feature-description ert-layout-feature-status' });
            for (const status of statuses) {
                statusBlock.createDiv({
                    cls: `ert-layout-feature-status-line is-status-${status.tone}`,
                    text: status.text,
                });
            }
        }
    };

    /**
     * Rename a non-bundled (duplicated/legacy-custom) layout, auto-renaming its .tex file
     * in the Pandoc folder so filename tracks display name. Collisions are avoided by
     * appending `-2`, `-3`, etc. Fails quietly if the file cannot be moved.
     */
    const renameLayoutAndFile = async (layout: PandocLayoutTemplate, nextName: string): Promise<void> => {
        const trimmed = nextName.trim();
        if (!trimmed || trimmed === layout.name) {
            layout.name = trimmed || layout.name;
            await plugin.saveSettings();
            return;
        }
        layout.name = trimmed;

        const ext = '.tex';
        const stem = slugifyToFileStem(trimmed).toLowerCase().replace(/-/g, '_') || 'layout';
        const pandocFolder = getPandocFolder(plugin);
        const currentStored = compactTemplatePathForStorage(plugin, layout.path);

        const makeStored = (filename: string): string => compactTemplatePathForStorage(plugin, filename);
        const vaultPathFor = (filename: string): string => normalizePath(`${pandocFolder}/${filename}`);

        let candidate = `rt_${stem}${ext}`;
        let candidateStored = makeStored(candidate);
        let index = 2;
        while (
            candidateStored !== currentStored &&
            plugin.app.vault.getAbstractFileByPath(vaultPathFor(candidate))
        ) {
            candidate = `rt_${stem}-${index}${ext}`;
            candidateStored = makeStored(candidate);
            index += 1;
        }

        if (candidateStored !== currentStored) {
            try {
                await maybeRenameTemplateFileForPathChange(plugin, layout.path, candidateStored);
                layout.path = candidateStored;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Could not rename template file: ${message}`);
            }
        }

        await plugin.saveSettings();
    };

    const getLayoutInstalledState = (layout: PandocLayoutTemplate): boolean => {
        if (layout.bundled) return isBundledPandocLayoutInstalled(plugin, layout);
        return validatePandocLayout(plugin, layout).valid;
    };
    type LayoutSpecialCapabilities = {
        usesModernClassicStructure: boolean;
        hasEpigraphs: boolean;
        hasSceneOpenerHeadingOptions: boolean;
    };
    const getLayoutSpecialCapabilities = (layout: PandocLayoutTemplate): LayoutSpecialCapabilities => {
        const profile = layoutProfilesById.get(layout.id);
        if (profile) {
            const capabilityKeys = new Set(profile.capabilities.map(capability => capability.key));
            const usesModernClassicStructure = capabilityKeys.has('modernClassicStructure');
            const hasEpigraphs = capabilityKeys.has('partEpigraphs') || usesModernClassicStructure;
            const hasSceneOpenerHeadingOptions = capabilityKeys.has('sceneHeadingMode');
            return { usesModernClassicStructure, hasEpigraphs, hasSceneOpenerHeadingOptions };
        }
        const usesModernClassicStructure = layout.usesModernClassicStructure === true;
        const hasEpigraphs = layout.hasEpigraphs === true || usesModernClassicStructure;
        const variant = getFictionVariantForLayout(layout);
        const hasSceneOpenerHeadingOptions = layout.hasSceneOpenerHeadingOptions === true || variant === 'signature';
        return { usesModernClassicStructure, hasEpigraphs, hasSceneOpenerHeadingOptions };
    };
    const hasLayoutSpecialOptions = (layout: PandocLayoutTemplate): boolean => {
        const caps = getLayoutSpecialCapabilities(layout);
        return caps.usesModernClassicStructure || caps.hasEpigraphs;
    };
    const toRomanNumeral = (value: number): string => {
        if (!Number.isFinite(value) || value <= 0) return '';
        const table: Array<[number, string]> = [
            [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
            [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
            [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
        ];
        let remainder = Math.floor(value);
        let output = '';
        for (const [numeric, roman] of table) {
            while (remainder >= numeric) {
                output += roman;
                remainder -= numeric;
            }
        }
        return output;
    };
    const getActCount = (): number => {
        const parsed = Math.floor(Number(plugin.settings.actCount ?? 3));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
    };
    const getActiveBookReference = (): BookProfile | null => {
        const active = getActiveBook(plugin.settings);
        if (!active) return null;
        const index = (plugin.settings.books || []).findIndex(book => book.id === active.id);
        if (index < 0) return null;
        return plugin.settings.books[index];
    };
    const getLayoutOptionsForActiveBook = (layoutId: string): BookLayoutOptions =>
        readLayoutOptions(getActiveBookReference()?.layoutOptions?.[layoutId]);
    const saveLayoutOptionsForActiveBook = async (layoutId: string, next: BookLayoutOptions): Promise<void> => {
        const activeBook = getActiveBookReference();
        if (!activeBook) return;
        const options = compactLayoutOptions(next);
        if (options) {
            activeBook.layoutOptions = { ...activeBook.layoutOptions, [layoutId]: options };
        } else if (activeBook.layoutOptions) {
            delete activeBook.layoutOptions[layoutId];
            if (!Object.keys(activeBook.layoutOptions).length) delete activeBook.layoutOptions;
        }
        await plugin.saveSettings();
    };

    const layoutRowsContainer = layoutPanel.createDiv({ cls: 'ert-layout-rows' });
    let expandedSpecialLayoutId: string | null = null;

    // (Removed `duplicateBundledLayout`: bundled templates now expose a
    // Customize pencil that opens the Designed Style wizard pre-filled with
    // the bundled spec, producing a wizard-editable designed layout instead of
    // a hand-rolled .tex copy that no UI could later edit. Power users who
    // want raw LaTeX can copy the .tex via Files or use Import Template.)

    const getVisibleLayouts = (): PandocLayoutTemplate[] => {
        const all = plugin.settings.pandocLayouts || [];
        return all.filter(layout => {
            if (layout.preset === 'novel') return true;
            if (layout.preset === 'screenplay') return SHOW_SCREENPLAY_LAYOUT_CATEGORY;
            if (layout.preset === 'podcast') return SHOW_PODCAST_LAYOUT_CATEGORY;
            return false;
        });
    };

    const getVisibleBundledLayouts = (): PandocLayoutTemplate[] => {
        return getBundledPandocLayouts().filter(layout => {
            if (layout.preset === 'novel') return true;
            if (layout.preset === 'screenplay') return SHOW_SCREENPLAY_LAYOUT_CATEGORY;
            if (layout.preset === 'podcast') return SHOW_PODCAST_LAYOUT_CATEGORY;
            return false;
        });
    };

    const getVisibleBundledInstallSummary = (): { total: number; installed: number } => {
        const bundledLayouts = getVisibleBundledLayouts();
        const installed = bundledLayouts.filter(layout => isBundledPandocLayoutInstalled(plugin, layout)).length;
        return { total: bundledLayouts.length, installed };
    };

    /** Render category groups with layout rows. */
    // Book-wide chapter counts for the spread-validation context. Computed
    // async (chapter markers come from scene metadata scanning) and cached in
    // the panel closure so each layout-row render can read them sync. When the
    // cache is empty (initial mount, before prefetch returns), the helper falls
    // back to its data-less defaults — no warning regression vs. before.
    let cachedBookChapterFieldCount: number | undefined;
    let cachedBookChapterTitlePopulatedCount: number | undefined;

    const refreshBookChapterCounts = async (): Promise<void> => {
        try {
            // Count UNIQUE chapter boundaries, not scenes-that-carry-a-Chapter-field.
            // The same scene can have a Chapter title set in its frontmatter, but
            // a "chapter" in the manuscript sense is one boundary that may span
            // many scenes. Reuse the timeline-chapter resolver pattern used by
            // ConfigurationSection so this stays in sync with what the user sees
            // elsewhere in the plugin.
            const sceneItems = await plugin.getSceneData();
            const resolverItems = buildTimelineChapterResolverItems(sceneItems);
            const uniqueMarkers = collapseTimelineChapterMarkersByResolvedBoundary(
                resolveTimelineChapterMarkers(resolverItems)
            );
            cachedBookChapterFieldCount = uniqueMarkers.length;
            cachedBookChapterTitlePopulatedCount = uniqueMarkers.filter(m => {
                return typeof m.title === 'string' && m.title.trim().length > 0;
            }).length;
        } catch {
            // Non-fatal: leave caches undefined; helper falls back to its
            // data-less defaults. The failure mode is "no chapter status line
            // in Settings", not a broken panel.
        }
    };

    const renderLayoutRows = () => {
        layoutRowsContainer.empty();

        const layouts = getVisibleLayouts();
        const publishingModel = adaptPandocLayoutsToPublishingModel(layouts);
        layoutProfilesById = new Map(publishingModel.profiles.map(profile => [profile.legacyLayoutId, profile]));
        if (expandedSpecialLayoutId && !layouts.some(layout => layout.id === expandedSpecialLayoutId)) {
            expandedSpecialLayoutId = null;
        }

        if (layouts.length === 0) {
            const emptyEl = layoutRowsContainer.createDiv({ cls: 'ert-layout-row setting-item' });
            emptyEl.createSpan({ text: 'No layouts configured yet.', cls: 'setting-item-description' });
            return;
        }

        const fictionVariantOrder: Record<FictionLayoutVariant, number> = {
            classic: 1,
            contemporary: 2,
            signature: 3,
            modernClassic: 4,
            generic: 5
        };
        const fictionLayouts = layouts
            .filter(layout => layout.preset === 'novel')
            .sort((a, b) => {
                const variantDiff = fictionVariantOrder[getFictionVariantForLayout(a)] - fictionVariantOrder[getFictionVariantForLayout(b)];
                if (variantDiff !== 0) return variantDiff;
                return getLayoutDisplayName(a).localeCompare(getLayoutDisplayName(b));
            });
        const renderLayoutRow = (parent: HTMLElement, layout: PandocLayoutTemplate) => {
            const row = parent.createDiv({ cls: 'ert-layout-row' });
            const isBundled = layout.bundled === true;
            const isImported = layout.origin === 'imported';
            const installed = getLayoutInstalledState(layout);
            const tier = getPandocLayoutTier(layout);
            const isProLayout = tier === 'pro';
            const specialCapabilities = getLayoutSpecialCapabilities(layout);
            const showsSpecialOptions = hasLayoutSpecialOptions(layout);
            const expanded = expandedSpecialLayoutId === layout.id;
            if (expanded) row.addClass('is-special-expanded');
            row.toggleClass(ERT_CLASSES.SKIN_PRO, isProLayout);
            row.toggleClass('ert-layout-row--pro', isProLayout);
            if (isProLayout) {
                row.addClass(ERT_CLASSES.ELEMENT_BLOCK);
            }
            if (isProLayout && !isActive) {
                row.addClass('ert-pro-locked');
            }

            const variant = getFictionVariantForLayout(layout);
            const useVisual = layout.preset === 'novel' && variant !== 'generic';

            const isEditableLayout = !isBundled && !isImported;

            const s = addProRow(new Setting(row))
                .setName('')
                .setDesc('');
            s.settingEl.addClass('ert-layout-row-setting');
            s.descEl?.addClass('ert-layout-row-desc');

            // Build the title (inline-editable for duplicated layouts, static for bundled)
            if (s.nameEl) {
                s.nameEl.empty();
                s.nameEl.addClass('ert-layout-row-name');
                const displayName = getLayoutDisplayName(layout);
                if (isEditableLayout) {
                    const titleHost = s.nameEl.createSpan({ cls: 'ert-layout-row-title' });
                    renderInlineEditable(titleHost, displayName, {
                        placeholder: 'Layout name',
                        onSave: async (nextName) => {
                            if (!nextName) {
                                new Notice('Layout name is required.');
                                return;
                            }
                            await renameLayoutAndFile(layout, nextName);
                            renderLayoutRows();
                            refreshPublishingStatusCard();
                        },
                        fallbackText: displayName,
                        displayClass: 'ert-layout-row-title-display',
                        inputClass: 'ert-layout-row-title-input'
                    });
                } else {
                    s.nameEl.createSpan({ cls: 'ert-layout-row-title', text: displayName });
                }
                const pill = s.nameEl.createSpan({
                    cls: `ert-layout-status-pill ${installed ? 'is-installed' : 'is-not-installed'}`,
                    text: installed ? 'Installed' : 'Not installed'
                });
                pill.setAttr('aria-label', installed ? 'Installed' : 'Not installed');
                const tierPill = s.nameEl.createSpan({
                    cls: `ert-badgePill ert-badgePill--sm ${isProLayout ? ERT_CLASSES.BADGE_PILL_PRO : ERT_CLASSES.BADGE_PILL_NEUTRAL}`,
                });
                tierPill.createSpan({
                    cls: 'ert-badgePill__text',
                    text: isProLayout ? 'Pro' : 'Core',
                });
            }

            if (useVisual && s.descEl) {
                s.descEl.addClass('ert-layout-row-desc--rich');
                buildLayoutVisual(s.descEl, variant, {
                    layoutId: layout.id,
                    layout,
                    description: buildLayoutDescription(layout),
                    editableDescription: isEditableLayout
                        ? {
                            onSave: async (nextDescription) => {
                                const trimmed = nextDescription.trim();
                                if (trimmed) {
                                    layout.description = trimmed;
                                } else {
                                    delete layout.description;
                                }
                                await plugin.saveSettings();
                            }
                        }
                        : undefined
                });
            } else if (isImported && s.descEl) {
                s.descEl.addClass('ert-layout-row-desc--rich');
                renderImportedLayoutSummary(s.descEl, layout, buildLayoutDescription(layout));
            } else {
                s.setDesc(buildLayoutDescription(layout));
            }

            // ── Per-card font diagnostic (strict policy, Phase 1) ──────
            // Surfaces a red "Missing: <FontName>" badge with an inline
            // Install button when the layout's required font is not
            // installed. Subtle green check when installed. Layouts with
            // no spec render nothing here (no_spec / cannot_verify are
            // omitted intentionally — neutral states should not add chrome).
            if (s.descEl) {
                const fontDiag = getStructuredFontDiagnostic(layout);
                if (fontDiag.state === 'missing-bundled') {
                    // Bundled font simply not copied into the vault yet — a
                    // not-set-up state, not an error. "Auto configure" and the
                    // top-level "Install fonts" both handle it in one click, so
                    // keep a quiet note with no per-card button (which would
                    // duplicate the top-level flow and clutter every card).
                    const row = s.descEl.createDiv({ cls: 'ert-layout-font-status ert-layout-font-status--pending' });
                    row.createSpan({
                        cls: 'ert-layout-font-status-badge',
                        text: 'Fonts install with setup',
                    });
                } else if (fontDiag.state === 'missing-system') {
                    // A system font the author must install on their own OS —
                    // this genuinely needs action outside the app, so keep an
                    // (amber) prompt with instructions.
                    const row = s.descEl.createDiv({ cls: 'ert-layout-font-status ert-layout-font-status--needs-system' });
                    row.createSpan({
                        cls: 'ert-layout-font-status-badge',
                        text: `Needs font: ${fontDiag.primaryFontName}`,
                    });
                    const installBtn = row.createEl('button', {
                        cls: 'ert-layout-font-install ert-link-accent',
                        text: 'How to install',
                    });
                    installBtn.type = 'button';
                    installBtn.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        const hint = fontDiag.installHint;
                        const fragment = installBtn.ownerDocument.win.createFragment();
                        const wrapper = fragment.createDiv();
                        wrapper.createDiv({
                            text: `${fontDiag.primaryFontName}: ${hint?.message ?? 'Install instructions unavailable.'}`,
                        });
                        if (hint?.url) {
                            const link = wrapper.createEl('a', { href: hint.url, text: hint.url });
                            link.setAttribute('target', '_blank');
                            link.setAttribute('rel', 'noopener');
                        }
                        if (hint?.steps?.length) {
                            const ul = wrapper.createEl('ul');
                            for (const step of hint.steps) ul.createEl('li', { text: step });
                        }
                        wrapper.createDiv({
                            text: 'After installing, re-open Settings to refresh status.',
                        });
                        new Notice(fragment, 12000);
                    });
                }
            }

            if (isBundled && !installed) {
                s.addButton(btn => {
                    btn.setButtonText('Install');
                    btn.setTooltip('Install bundled layout');
                    btn.onClick(async () => {
                        btn.setDisabled(true);
                        btn.setButtonText('Installing...');
                        try {
                            const result = await installBundledPandocLayouts(plugin, [layout.id]);
                            const refresh = await ensureBundledLayoutInstalledForExport(plugin, layout);
                            // Mirror Install all + Auto-configure: keep the registry
                            // in sync with on-disk templates so the publishing
                            // status strip advances PDF Style on the next render.
                            if (ensureBundledPandocLayoutsRegistered(plugin)) {
                                await plugin.saveSettings();
                            }
                            const failedFontFamilies = [...new Set([...result.fonts.failed, ...refresh.fonts.failed])];
                            if (result.failed.length > 0 || refresh.failed) {
                                new Notice(`Failed to install bundled layout: ${getLayoutDisplayName(layout)}`);
                            } else if (failedFontFamilies.length > 0) {
                                new Notice(`Installed layout template for ${getLayoutDisplayName(layout)}, but required fonts failed to copy (${failedFontFamilies.join(', ')}). PDF export will fall back to system fonts where available.`);
                            } else if (result.installed.length > 0) {
                                new Notice(buildFontPillsNotice(btn.buttonEl.ownerDocument, `Installed bundled layout and required fonts: ${getLayoutDisplayName(layout)}`, result.fonts), 12000);
                            } else {
                                new Notice(buildFontPillsNotice(btn.buttonEl.ownerDocument, `Bundled layout and required fonts are already installed: ${getLayoutDisplayName(layout)}`, result.fonts), 12000);
                            }
                            renderLayoutRows();
                            refreshPublishingStatusCard();
                            refreshInstallAllButtonState();
                        } catch (error) {
                            new Notice(error instanceof Error ? error.message : `Failed to install bundled layout: ${getLayoutDisplayName(layout)}`);
                        } finally {
                            btn.setDisabled(false);
                            btn.setButtonText('Install');
                        }
                    });
                });
            }

            if (showsSpecialOptions) {
                s.addExtraButton(btn => {
                    btn.extraSettingsEl.addClass('ert-iconBtn', 'ert-layout-special-toggle');
                    btn.setIcon(expanded ? 'minus' : 'plus');
                    btn.setTooltip(expanded ? 'Hide special features' : 'Show special features');
                    btn.onClick(() => {
                        expandedSpecialLayoutId = expandedSpecialLayoutId === layout.id ? null : layout.id;
                        renderLayoutRows();
                    });
                });
            }

            // Pencil button:
            //   • Bundled layouts (with a designedSpec — all four bundled
            //     fiction templates carry one) → "Customize" — opens the
            //     wizard pre-filled with the bundled spec; saving creates a
            //     NEW designed-origin layout (the bundled stays untouched).
            //   • Designed-origin layouts → "Edit" — opens the wizard
            //     pre-filled with the saved spec; saving updates in place.
            //
            // The wizard distinguishes the two by `initialLayoutId` —
            // omitting it routes through createNewLayout (fork mode).
            if (layout.designedSpec) {
                const isCustomizingBundled = isBundled;
                s.addExtraButton(btn => {
                    btn.extraSettingsEl.addClass(
                        'ert-iconBtn',
                        isCustomizingBundled ? 'ert-layout-bundled-customize' : 'ert-layout-designed-edit',
                    );
                    btn.setIcon('pencil');
                    btn.setTooltip(isCustomizingBundled
                        ? `Customize ${layout.name} — opens the wizard pre-filled with this template's settings; saving creates a new editable copy.`
                        : 'Edit designed style');
                    if (!isActive) {
                        btn.extraSettingsEl.addClass('ert-pro-locked');
                    }
                    btn.onClick(() => {
                        if (!isActive) {
                            new Notice(isCustomizingBundled
                                ? 'Customizing PDF styles is a Pro workflow.'
                                : 'Editing designed styles is a Pro workflow.');
                            return;
                        }
                        new DesignedStyleWizardModal(app, plugin, {
                            initialSpec: layout.designedSpec!,
                            // Bundled fork: seed the name with "<Bundled> Copy"
                            // so the user gets a clear default they can rename.
                            initialName: isCustomizingBundled
                                ? `${layout.name} Copy`
                                : layout.name,
                            initialDescription: layout.description ?? '',
                            // Critical: omit layoutId for bundled fork so
                            // persistLayout takes the createNewLayout path
                            // and leaves the canonical bundled spec alone.
                            ...(isCustomizingBundled ? {} : { initialLayoutId: layout.id }),
                            onSave: async () => {
                                renderLayoutRows();
                                refreshPublishingStatusCard();
                            },
                        }).open();
                    });
                });
            }

            if (!isBundled) {
                s.addExtraButton(btn => {
                    if (isImported) {
                        btn.extraSettingsEl.addClass('ert-iconBtn', 'ert-layout-imported-trash');
                    }
                    btn.setIcon('trash');
                    btn.setTooltip('Remove layout');
                    btn.onClick(async () => {
                        plugin.settings.pandocLayouts = (plugin.settings.pandocLayouts || []).filter(item => item.id !== layout.id);
                        await plugin.saveSettings();
                        renderLayoutRows();
                        refreshPublishingStatusCard();
                    });
                });
            }

            if (showsSpecialOptions && expanded) {
                const panel = row.createDiv({ cls: 'ert-layout-special-panel' });

                // Parts = Acts: determined by Act count in settings.
                // Epigraphs are optional quotes printed after each PART page.
                if (specialCapabilities.hasEpigraphs) {
                    const epigraphTitle = panel.createDiv({ cls: 'ert-layout-special-title', text: 'Part epigraphs (optional)' });
                    epigraphTitle.setAttr('role', 'heading');
                    panel.createDiv({ cls: 'ert-layout-special-helper', text: 'Printed after PART pages.' });

                    const activeBook = getActiveBookReference();
                    if (!activeBook) {
                        panel.createDiv({ cls: 'ert-layout-special-empty', text: 'Select an active book to edit layout-specific options.' });
                    } else {
                        const actCount = getActCount();
                        const scopedOptions = getLayoutOptionsForActiveBook(layout.id);
                        const partEpigraphs = scopedOptions.partEpigraphs || [];
                        const partEpigraphAttributions = scopedOptions.partEpigraphAttributions || [];
                        const rows = panel.createDiv({ cls: 'ert-layout-epigraph-rows' });

                        for (let actIndex = 0; actIndex < actCount; actIndex++) {
                            const epigraphRow = rows.createDiv({ cls: 'ert-layout-epigraph-row' });
                            epigraphRow.createDiv({
                                cls: 'ert-layout-epigraph-act',
                                text: `Act ${toRomanNumeral(actIndex + 1) || String(actIndex + 1)}`
                            });

                            const fields = epigraphRow.createDiv({ cls: 'ert-layout-epigraph-fields' });

                            const quoteLabel = fields.createDiv({ cls: 'ert-layout-epigraph-label', text: 'Quote' });
                            quoteLabel.setAttr('role', 'note');
                            const quoteInput = fields.createEl('textarea', {
                                cls: 'ert-input ert-layout-epigraph-quote',
                                attr: { rows: '2' }
                            });
                            quoteInput.value = partEpigraphs[actIndex] || '';
                            plugin.registerDomEvent(quoteInput, 'change', () => {
                                const nextQuotes = [...(getLayoutOptionsForActiveBook(layout.id).partEpigraphs || [])];
                                const nextAttributions = [...(getLayoutOptionsForActiveBook(layout.id).partEpigraphAttributions || [])];
                                nextQuotes[actIndex] = quoteInput.value;
                                void saveLayoutOptionsForActiveBook(layout.id, {
                                    partEpigraphs: nextQuotes,
                                    partEpigraphAttributions: nextAttributions
                                });
                            });

                            const attributionLabel = fields.createDiv({ cls: 'ert-layout-epigraph-label', text: 'Attribution' });
                            attributionLabel.setAttr('role', 'note');
                            const attributionInput = fields.createEl('input', {
                                type: 'text',
                                cls: 'ert-input ert-layout-epigraph-attribution'
                            });
                            attributionInput.value = partEpigraphAttributions[actIndex] || '';
                            plugin.registerDomEvent(attributionInput, 'change', () => {
                                const nextQuotes = [...(getLayoutOptionsForActiveBook(layout.id).partEpigraphs || [])];
                                const nextAttributions = [...(getLayoutOptionsForActiveBook(layout.id).partEpigraphAttributions || [])];
                                nextAttributions[actIndex] = attributionInput.value;
                                void saveLayoutOptionsForActiveBook(layout.id, {
                                    partEpigraphs: nextQuotes,
                                    partEpigraphAttributions: nextAttributions
                                });
                            });
                        }
                    }
                }

                // Scenes = scene notes. Scene opener heading mode controls how
                // each scene's dedicated opener page renders its heading.
                if (specialCapabilities.hasSceneOpenerHeadingOptions) {
                    const headingPanel = panel.createDiv({ cls: 'ert-layout-special-mode' });
                    const headingTitle = headingPanel.createDiv({ cls: 'ert-layout-special-title', text: 'Opener scene heading' });
                    headingTitle.setAttr('role', 'heading');
                    const modeRow = headingPanel.createDiv({ cls: 'ert-layout-special-mode-row' });
                    modeRow.createDiv({ cls: 'ert-layout-epigraph-label', text: 'Style' });
                    const modeSelect = modeRow.createEl('select', { cls: 'ert-input ert-input--xl ert-layout-special-mode-select' });

                    const options: Array<{ value: ManuscriptSceneHeadingMode; label: string }> = [
                        { value: 'scene-number', label: 'Scene number only' },
                        { value: 'scene-number-title', label: 'Scene number + title (title in parentheses)' },
                        { value: 'title-only', label: 'Title only' }
                    ];
                    options.forEach(option => {
                        modeSelect.createEl('option', { value: option.value, text: option.label });
                    });

                    const activeMode = getLayoutOptionsForActiveBook(layout.id).sceneHeadingMode || 'scene-number-title';
                    modeSelect.value = activeMode;
                    plugin.registerDomEvent(modeSelect, 'change', () => {
                        const scoped = getLayoutOptionsForActiveBook(layout.id);
                        const nextMode = modeSelect.value as ManuscriptSceneHeadingMode;
                        void saveLayoutOptionsForActiveBook(layout.id, {
                            partEpigraphs: scoped.partEpigraphs,
                            partEpigraphAttributions: scoped.partEpigraphAttributions,
                            sceneHeadingMode: nextMode
                        });
                        // Re-render so pictogram highlight updates to match
                        renderLayoutRows();
                    });
                }
            }
        };

        const rows = layoutRowsContainer.createDiv({ cls: 'ert-layout-category-rows' });
        fictionLayouts.forEach(layout => renderLayoutRow(rows, layout));
    };

    renderLayoutRows();

    // Async prefetch of book-wide chapter counts; re-render the layout rows
    // once the data is in so the CHAPTER status line ("5 Chapters configured.")
    // appears without making the initial mount block on metadata scanning.
    void refreshBookChapterCounts().then(() => {
        renderLayoutRows();
    });

    const commitImportedTemplate = async (commit: ImportedTemplateCommit): Promise<void> => {
        const existing = plugin.settings.pandocLayouts || [];
        const nextLayout = {
            ...commit.layout,
            draft: commit.draft,
            origin: 'imported' as const,
            tier: 'pro' as const,
            templateKind: 'custom' as const,
            importDetection: {
                styleHint: commit.candidate.detectedTemplate.styleHint,
                mockPreviewKind: commit.candidate.detectedTemplate.mockPreviewKind,
                traits: commit.candidate.detectedTemplate.traits.slice(0, 5),
                confidence: commit.candidate.detectedTemplate.confidence,
            },
        };
        const currentIndex = existing.findIndex(layout => layout.id === nextLayout.id);
        if (currentIndex >= 0) {
            existing[currentIndex] = nextLayout;
        } else {
            existing.push(nextLayout);
        }
        plugin.settings.pandocLayouts = existing;
        await plugin.saveSettings();
        new Notice(commit.activate
            ? `Activated template '${nextLayout.name}'.`
            : `Saved draft template '${nextLayout.name}'.`);
        renderLayoutRows();
        refreshPublishingStatusCard();
    };

    // The Design + Install buttons attach to the section heading (layoutHeading)
    // so they sit on the right margin of the same row as the "PDF Style" title
    // and description, instead of in a separate row at the bottom.
    let installAllButton: ButtonComponent | null = null;
    let installAllButtonEl: HTMLButtonElement | null = null;
    const refreshInstallAllButtonState = (): void => {
        if (!installAllButtonEl) return;
        const bundledLayouts = getVisibleBundledLayouts();
        const { total, installed } = getVisibleBundledInstallSummary();
        const hasUnacknowledgedTemplateUpdate = (plugin.settings.templateHotfixHistory || [])
            .some(entry => !entry.acknowledged);
        const hasFontIssue = bundledLayouts.some(layout => getStructuredFontDiagnostic(layout).state !== 'ok');
        const needsInstall = installed < total;
        const needsAttention = hasUnacknowledgedTemplateUpdate || hasFontIssue || needsInstall;

        installAllButtonEl.toggleClass('ert-layout-install-all-button--muted', !needsAttention);
        installAllButtonEl.toggleClass('ert-layout-install-all-button--attention', needsAttention);
        if (installAllButton) {
            installAllButton.setButtonText(
                hasFontIssue ? 'Install fonts'
                : hasUnacknowledgedTemplateUpdate ? 'Update templates'
                : needsInstall ? 'Install all'
                : 'Installed'
            );
            installAllButton.setTooltip(
                hasFontIssue
                    ? 'Install required bundled font files into your Pandoc folder.'
                    : hasUnacknowledgedTemplateUpdate
                        ? 'Bundled PDF templates were updated. Click to refresh templates and fonts in your Pandoc folder.'
                        : needsInstall
                            ? 'Install bundled PDF templates and their required font files to your Pandoc folder.'
                            : 'Bundled PDF templates and required font files are installed.'
            );
        }
    };
    // Two complementary entry points sit on the same row, opposite the
    // Install all button:
    //
    //   1. Design your own…  — opens the Designed Style wizard. Spec-driven,
    //      live preview, edits flow through the wizard forever after.
    //   2. Import template…  — power-user escape hatch for hand-rolled .tex
    //      files. Brings an existing LaTeX template into Publishing as a
    //      static custom layout (no spec, not wizard-editable). Use when the
    //      wizard's spec axes can't model the look you need.
    //
    // The wizard is the default path; Import is the long tail.

    // Designed Style Wizard entry point — opens a two-column modal that lets
    // a Pro user author a DesignedStyleSpec from scratch (or starting from one
    // of the four bundled archetypes). The .tex file is generated from the
    // spec on save.
    layoutHeading.addButton(button => {
        button.setButtonText('Design your own…');
        button.setTooltip('Design a new PDF style from scratch with a live preview.');
        button.buttonEl.addClass(ERT_CLASSES.PILL_BTN, ERT_CLASSES.PILL_BTN_PRO);
        if (__RT_RELEASE__) {
            button.setDisabled(true);
            button.setTooltip('BETA release pending—design a new PDF style from scratch with a live preview.');
            button.onClick(() => { /* no-op: BETA release pending */ });
            return;
        }
        if (!isActive) {
            button.buttonEl.addClass('ert-pro-locked');
            button.setTooltip('A Pro workflow.');
        }
        button.onClick(() => {
            if (!isActive) {
                new Notice('Designing custom styles is a Pro workflow.');
                return;
            }
            new DesignedStyleWizardModal(app, plugin, {
                onSave: async () => {
                    renderLayoutRows();
                    refreshPublishingStatusCard();
                },
            }).open();
        });
    });

    // Import Template entry point — sits next to "Design your own…" so both
    // "create a custom style" paths are visible in the same place. Import is
    // the escape hatch for users who already have a .tex file (hand-tuned
    // LaTeX, third-party template, custom packages the spec can't express).
    // Imported layouts are static — they don't open in the wizard.
    layoutHeading.addButton(button => {
        button.setButtonText('Import template…');
        button.setTooltip('Bring an existing .tex template into Publishing. For from-scratch design with a live preview, use "Design your own…" instead.');
        button.buttonEl.addClass(ERT_CLASSES.PILL_BTN, ERT_CLASSES.PILL_BTN_PRO);
        if (__RT_RELEASE__) {
            button.setDisabled(true);
            button.setTooltip('BETA release pending—Bring an existing .tex template into Publishing.');
            button.onClick(() => { /* no-op: BETA release pending */ });
            return;
        }
        if (!isActive) {
            button.buttonEl.addClass('ert-pro-locked');
            button.setTooltip('A Pro workflow.');
        }
        button.onClick(() => {
            if (!isActive) {
                new Notice('Importing custom templates is a Pro workflow.');
                return;
            }
            new ImportTemplateModal(app, plugin, commitImportedTemplate).open();
        });
    });
    layoutHeading.addButton(button => {
        installAllButton = button;
        button.setButtonText('Install all');
        button.setTooltip('Install bundled PDF templates and their required font files to your Pandoc folder. Does not seed Book Details or Book Pages.');
        installAllButtonEl = button.buttonEl;
        installAllButtonEl.addClass('ert-layout-install-all-button');
        refreshInstallAllButtonState();
        button.onClick(async () => {
            button.setDisabled(true);
            button.setButtonText('Installing...');
            try {
                const bundledLayouts = getVisibleBundledLayouts();
                const bundledIds = bundledLayouts.map(layout => layout.id);
                const result = await installBundledPandocLayouts(plugin, bundledIds);
                const refreshResults = await Promise.all(bundledLayouts.map(layout => ensureBundledLayoutInstalledForExport(plugin, layout)));
                // Re-register bundled layouts in plugin.settings.pandocLayouts so the
                // PDF Style stage of the publishing status strip sees them as
                // present. Without this, users who had no entries (or had trashed
                // entries) install templates on disk but the validator still
                // reports zero novel layouts and the stage stays Below.
                // Auto-configure ('runAutoConfigurePublishing') already does this
                // via ensurePublishingEnvironment; mirror that behaviour here.
                if (ensureBundledPandocLayoutsRegistered(plugin)) {
                    await plugin.saveSettings();
                }
                const refreshFailures = refreshResults.filter(item => item.failed).length;
                const failedFontFamilies = [...new Set([
                    ...result.fonts.failed,
                    ...refreshResults.flatMap(item => item.fonts.failed)
                ])];
                if (refreshFailures > 0 || result.failed.length > 0 || failedFontFamilies.length > 0) {
                    new Notice(`Some bundled layouts or required fonts failed to install${failedFontFamilies.length > 0 ? ` (fonts: ${failedFontFamilies.join(', ')})` : ''}.`);
                } else {
                    // Templates and fonts are now current on disk, so clear the
                    // "Update templates" nudge by acknowledging the hotfix
                    // history. Without this the button stays lit forever even
                    // after a successful refresh.
                    plugin.settings.templateHotfixHistory = acknowledgeHotfixHistory(
                        plugin.settings.templateHotfixHistory
                    );
                    await plugin.saveSettings();
                    if (result.installed.length > 0) {
                        new Notice(buildFontPillsNotice(button.buttonEl.ownerDocument, `Installed ${result.installed.length} bundled layout template(s) and required fonts in ${getPandocFolder(plugin)}/.`, result.fonts), 12000);
                    } else {
                        new Notice(buildFontPillsNotice(button.buttonEl.ownerDocument, 'Bundled layouts and required fonts are installed and refreshed.', result.fonts), 12000);
                    }
                }
                renderLayoutRows();
                refreshPublishingStatusCard();
                refreshInstallAllButtonState();
            } catch (error) {
                new Notice(error instanceof Error ? error.message : 'Could not install bundled layouts and fonts.');
            } finally {
                button.setDisabled(false);
                refreshInstallAllButtonState();
            }
        });
    });

    let setupInFlight = false;
    let setupButtonComponent: ButtonComponent | null = null;
    let exportOptionsButtonComponent: ButtonComponent | null = null;
    const setSetupButtonState = (busy: boolean) => {
        if (!setupButtonComponent) return;
        setupButtonComponent.setDisabled(busy);
        setupButtonComponent.setButtonText(busy ? AUTO_CONFIGURE_BUSY : AUTO_CONFIGURE_BUTTON);
        if (exportOptionsButtonComponent) {
            exportOptionsButtonComponent.setDisabled(busy);
        }
    };
    const runAutoConfigurePublishing = async () => {
        if (setupInFlight) return;
        setupInFlight = true;
        setSetupButtonState(true);
        try {
            // ── Phase 1: Environment (paths, folders, templates) ─────────
            const envResult = await ensurePublishingEnvironment(plugin);

            // Update Pandoc path input if it was auto-filled
            if (envResult.pandocFound && pandocPathInputEl) {
                pandocPathInputEl.value = plugin.settings.pandocPath || '';
            }

            // Refresh status cards after environment changes
            refreshPublishingStatusCard();

            // Show environment issues as partial-success guidance
            const blockingIssues = envResult.issues.filter(i => i.startsWith('Pandoc not found'));
            if (blockingIssues.length > 0) {
                // Pandoc missing — cannot proceed with full setup
                new Notice(`${blockingIssues[0]}. Radial Timeline can install bundled templates/fonts into your vault, but Pandoc itself must be installed on your computer first.`);
                revealSystemConfig();
                return;
            }

            // Non-blocking issues (e.g. LaTeX missing) — show but continue
            const warnings = envResult.issues.filter(i => !i.startsWith('Pandoc not found'));
            if (warnings.length > 0) {
                new Notice(warnings.join('\n'));
            }

            // ── Phase 2: Starter publishing setup ─────────────────────────
            const confirmed = await confirmStarterPublishingSetup(plugin.app);
            if (!confirmed) return;
            const setup = await generateSampleTemplates(plugin);
            const sourceFolder = getActiveBookExportContext(plugin).sourceFolder.trim();
            const matterTargetLabel = sourceFolder || resolveManuscriptOutputFolder(plugin);
            if (setup.created.length > 0) {
                new Notice(`Publishing configured. Created ${setup.created.length} starter setup files. Book Details + inline LaTeX examples → ${matterTargetLabel}, PDF styles → ${getPandocFolder(plugin)}/.`);
            } else if (setup.updatedGenerated.length > 0) {
                new Notice(`Publishing configured. Refreshed ${setup.updatedGenerated.length} generated inline LaTeX example file(s).`);
            } else {
                new Notice(`${STARTER_PUBLISHING_SETUP_ALREADY_EXISTS} Existing author files were left untouched.`);
            }
            if (setup.updatedGenerated.length > 0 && setup.created.length > 0) {
                new Notice(`Refreshed ${setup.updatedGenerated.length} generated inline LaTeX example file(s).`);
            }
            if (setup.skippedExisting.length > 0) {
                const preview = setup.skippedExisting.slice(0, 5).join(', ');
                const suffix = setup.skippedExisting.length > 5 ? `, +${setup.skippedExisting.length - 5} more` : '';
                new Notice(`Skipped existing author file(s): ${preview}${suffix}.`);
            }
            renderLayoutRows();
            rerender();
        } catch (e) {
            const msg = (e as Error).message || String(e);
            new Notice(`Error configuring publishing: ${msg}`);
        } finally {
            setupInFlight = false;
            setSetupButtonState(false);
        }
    };

    let matterPreviewFrame: HTMLElement | null = null;
    let activeBookMetaEditField: EditableBookMetaFieldKey | null = null;
    let activeBookMetaDraft = '';
    let activeBookMetaEditSourcePath: string | null = null;
    let activeBookMetaPreviewOverride: BookMeta | null = null;
    let activeBookMetaEditBusy = false;
    const expandedBookMetaSections = new Set<string>();
    const bookMetaPreviewPanel = section.createDiv({
        cls: ERT_CLASSES.STACK,
        attr: { [ERT_DATA.SECTION]: 'book-details' }
    });
    bookMetaPreviewPanel.addClass('ert-publish-order--book-details');
    const previewBody = bookMetaPreviewPanel.createDiv({ cls: 'ert-bookmeta-preview-body' });
    const renderBookMetaPreview = () => {
        previewBody.empty();
        const activeBookMetaStatus = getActiveBookMetaStatus(plugin);
        const meta = activeBookMetaPreviewOverride ?? activeBookMetaStatus.bookMeta ?? null;
        const sourcePath = (activeBookMetaEditSourcePath || meta?.sourcePath || activeBookMetaStatus.path || '').trim();
        const hasSourcePath = sourcePath.length > 0;
        // Roles overridden by physical notes — used to dim BookMeta rows + show "Overridden by custom page".
        const matterNotes = getActiveBookMatterNoteSummaries(plugin);
        const overriddenRoles = new Set<BookPageRole>(
            matterNotes
                .map(note => {
                    const explicit = note.role.trim().toLowerCase();
                    if (Object.prototype.hasOwnProperty.call(ROLE_SIDE, explicit)) return explicit as BookPageRole;
                    if (explicit) return null;
                    return inferRoleFromFilename(note.path || note.title);
                })
                .filter((role): role is BookPageRole => !!role)
        );
        const openOrCreateBookMetaNote = async () => {
            if (hasSourcePath) {
                void plugin.app.workspace.openLinkText(sourcePath, '', false);
                return;
            }
            const created = await createBookMetaOnly(plugin);
            if (created.created && created.path) {
                void plugin.app.workspace.openLinkText(created.path, '', false);
            } else {
                new Notice(created.reason || 'Book Details note was not created.');
            }
            rerender();
        };

        const ensureBookMetaNoteForEditing = async (): Promise<string | null> => {
            if (hasSourcePath) return sourcePath;
            const created = await createBookMetaOnly(plugin);
            if (created.path) {
                activeBookMetaEditSourcePath = created.path;
                return created.path;
            }
            new Notice(created.reason || 'Book Details note was not created.');
            return null;
        };

        const beginBookMetaFieldEdit = async (
            field: EditableBookMetaFieldKey,
            currentValue: string | number | null | undefined
        ) => {
            if (activeBookMetaEditBusy) return;
            const editPath = await ensureBookMetaNoteForEditing();
            if (!editPath) return;
            activeBookMetaEditField = field;
            activeBookMetaDraft = currentValue === undefined || currentValue === null ? '' : String(currentValue);
            renderBookMetaPreview();
        };

        const cancelBookMetaFieldEdit = () => {
            activeBookMetaEditField = null;
            activeBookMetaDraft = '';
            renderBookMetaPreview();
        };

        const applyBookMetaEditToPreview = (
            currentMeta: BookMeta | null,
            field: EditableBookMetaFieldKey,
            normalizedValue: string | number | null,
            nextSourcePath: string
        ): BookMeta => {
            const nextMeta: BookMeta = {
                ...(currentMeta || {}),
                sourcePath: nextSourcePath,
            };

            const assignString = (
                target: Record<string, unknown>,
                key: string,
                value: string | number | null
            ): void => {
                if (typeof value === 'string' && value.trim()) target[key] = value;
                else if (typeof value === 'number') target[key] = value;
                else delete target[key];
            };

            if (field === 'title') {
                if (typeof normalizedValue === 'string') nextMeta.title = normalizedValue;
                else delete nextMeta.title;
                return nextMeta;
            }

            if (field === 'subtitle') {
                if (typeof normalizedValue === 'string') nextMeta.subtitle = normalizedValue;
                else delete nextMeta.subtitle;
                return nextMeta;
            }

            if (field === 'author') {
                if (typeof normalizedValue === 'string') nextMeta.author = normalizedValue;
                else delete nextMeta.author;
                return nextMeta;
            }

            if (field === 'copyright-holder') {
                const rights = { ...(nextMeta.rights || {}) };
                if (typeof normalizedValue === 'string') rights.copyright_holder = normalizedValue;
                else delete rights.copyright_holder;
                nextMeta.rights = Object.keys(rights).length > 0 ? rights : undefined;
                return nextMeta;
            }

            if (field === 'rights-year') {
                const rights = { ...(nextMeta.rights || {}) };
                if (typeof normalizedValue === 'number') rights.year = normalizedValue;
                else delete rights.year;
                nextMeta.rights = Object.keys(rights).length > 0 ? rights : undefined;
                return nextMeta;
            }

            if (field === 'isbn') {
                const identifiers = { ...(nextMeta.identifiers || {}) };
                if (typeof normalizedValue === 'string') identifiers.isbn_paperback = normalizedValue;
                else delete identifiers.isbn_paperback;
                nextMeta.identifiers = Object.keys(identifiers).length > 0 ? identifiers : undefined;
                return nextMeta;
            }

            if (field === 'publisher' || field === 'imprint' || field === 'edition') {
                const publisher = { ...(nextMeta.publisher || {}) };
                const key = field === 'publisher' ? 'name' : field;
                assignString(publisher, key, normalizedValue);
                nextMeta.publisher = Object.keys(publisher).length > 0 ? publisher : undefined;
                return nextMeta;
            }

            if (
                field === 'title-page-note'
                || field === 'dedication'
                || field === 'epigraph-quote'
                || field === 'epigraph-attribution'
            ) {
                const frontmatter = { ...(nextMeta.frontmatter || {}) };
                const key = field === 'title-page-note'
                    ? 'title_page_note'
                    : field === 'epigraph-quote'
                        ? 'epigraph_quote'
                        : field === 'epigraph-attribution'
                            ? 'epigraph_attribution'
                            : 'dedication';
                assignString(frontmatter, key, normalizedValue);
                nextMeta.frontmatter = Object.keys(frontmatter).length > 0 ? frontmatter : undefined;
                return nextMeta;
            }

            const backmatter = { ...(nextMeta.backmatter || {}) };
            const key = field === 'about-author'
                ? 'about_author'
                : field === 'author-note'
                    ? 'author_note'
                    : field === 'other-works'
                        ? 'other_works'
                        : 'acknowledgments';
            assignString(backmatter, key, normalizedValue);
            nextMeta.backmatter = Object.keys(backmatter).length > 0 ? backmatter : undefined;
            return nextMeta;
        };

        const saveBookMetaFieldEdit = async (
            field: EditableBookMetaFieldKey,
            mode: 'enter' | 'blur'
        ) => {
            if (activeBookMetaEditBusy) return;
            const editPath = sourcePath || activeBookMetaEditSourcePath || '';
            const file = plugin.app.vault.getAbstractFileByPath(editPath);
            if (!(file instanceof TFile)) {
                new Notice('Book Details note could not be found.');
                cancelBookMetaFieldEdit();
                return;
            }

            activeBookMetaEditBusy = true;
            const result = await updateBookMetaField(plugin.app, file, field, activeBookMetaDraft);
            activeBookMetaEditBusy = false;

            if (!result.ok) {
                new Notice(result.error);
                if (mode === 'enter') {
                    renderBookMetaPreview();
                    return;
                }
                cancelBookMetaFieldEdit();
                return;
            }

            activeBookMetaEditField = null;
            activeBookMetaDraft = '';
            activeBookMetaEditSourcePath = file.path;
            activeBookMetaPreviewOverride = applyBookMetaEditToPreview(meta, field, result.normalizedValue, file.path);
            renderBookMetaPreview();
        };

        const clearBookMetaField = async (field: EditableBookMetaFieldKey) => {
            if (activeBookMetaEditBusy) return;
            const editPath = await ensureBookMetaNoteForEditing();
            if (!editPath) return;
            const file = plugin.app.vault.getAbstractFileByPath(editPath);
            if (!(file instanceof TFile)) {
                new Notice('Book Details note could not be found.');
                return;
            }

            activeBookMetaEditBusy = true;
            const result = await updateBookMetaField(plugin.app, file, field, '');
            activeBookMetaEditBusy = false;

            if (!result.ok) {
                new Notice(result.error);
                renderBookMetaPreview();
                return;
            }

            activeBookMetaEditField = null;
            activeBookMetaDraft = '';
            activeBookMetaEditSourcePath = file.path;
            activeBookMetaPreviewOverride = applyBookMetaEditToPreview(meta, field, result.normalizedValue, file.path);
            renderBookMetaPreview();
        };

        const normalizeValue = (value?: string | number | null): string | null => {
            if (value === undefined || value === null) return null;
            const normalized = String(value).trim();
            return normalized.length > 0 ? normalized : null;
        };

        const renderBookMetaValue = (
            target: HTMLElement,
            field: EditableBookMetaFieldKey,
            label: string,
            value: string | number | null | undefined,
            placeholder: string,
            required: boolean,
            className: 'ert-bookmeta-primary-value' | 'ert-bookmeta-detail-value' | 'ert-bookmeta-matter-value'
        ) => {
            if (activeBookMetaEditField === field) {
                const multilineFields = new Set<EditableBookMetaFieldKey>([
                    'title-page-note',
                    'dedication',
                    'epigraph-quote',
                    'acknowledgments',
                    'about-author',
                    'author-note',
                    'other-works',
                ]);
                const input = multilineFields.has(field)
                    ? target.createEl('textarea', {
                        cls: `${className} ert-bookmeta-inline-input ert-bookmeta-inline-input--textarea`,
                        attr: {
                            rows: '3',
                            'aria-label': label,
                        }
                    })
                    : target.createEl('input', {
                        cls: `${className} ert-bookmeta-inline-input ${className === 'ert-bookmeta-primary-value' ? 'ert-bookmeta-inline-input--primary' : 'ert-bookmeta-inline-input--detail'}`,
                        attr: {
                            type: 'text',
                            'aria-label': label,
                        }
                    });
                input.value = activeBookMetaDraft;
                window.setTimeout(() => {
                    input.focus();
                    input.select();
                }, 0);
                let handled = false;
                input.addEventListener('input', () => {
                    activeBookMetaDraft = input.value;
                });
                input.addEventListener('keydown', (evt: KeyboardEvent) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        handled = true;
                        activeBookMetaDraft = input.value;
                        void saveBookMetaFieldEdit(field, 'enter');
                    } else if (evt.key === 'Escape') {
                        evt.preventDefault();
                        handled = true;
                        cancelBookMetaFieldEdit();
                    }
                });
                input.addEventListener('blur', () => {
                    if (handled) return;
                    handled = true;
                    activeBookMetaDraft = input.value;
                    void saveBookMetaFieldEdit(field, 'blur');
                });
                return input;
            }

            const normalized = normalizeValue(value);
            const missing = !normalized;
            const valueEl = target.createDiv({
                cls: `${className} ert-bookmeta-preview-value--clickable${missing ? ' ert-bookmeta-preview-value--empty ert-bookmeta-preview-value--missing' : ''}`,
                text: normalized || placeholder,
                attr: {
                    role: 'button',
                    tabindex: '0',
                    'aria-label': `${normalized ? 'Edit' : 'Add'} ${label.toLowerCase()}`,
                    title: `${normalized ? 'Edit' : 'Add'} ${label.toLowerCase()}`
                }
            });

            valueEl.classList.toggle('ert-bookmeta-preview-value--required', missing && required);
            valueEl.classList.toggle('ert-bookmeta-preview-value--optional', missing && !required);
            valueEl.addEventListener('click', (evt) => {
                evt.preventDefault();
                void beginBookMetaFieldEdit(field, normalized || value);
            });
            valueEl.addEventListener('keydown', (evt: KeyboardEvent) => {
                if (evt.key !== 'Enter' && evt.key !== ' ') return;
                evt.preventDefault();
                void beginBookMetaFieldEdit(field, normalized || value);
            });
            return valueEl;
        };

        const renderPageIntent = (
            target: HTMLElement,
            kind: 'title' | 'dedication' | 'epigraph' | 'copyright' | 'prose' | 'list',
            caption: string
        ): void => {
            const page = target.createDiv({ cls: `ert-bookmeta-intent-page ert-bookmeta-intent-page--${kind}` });
            page.createDiv({ cls: 'ert-bookmeta-intent-block ert-bookmeta-intent-block--primary' });
            if (kind === 'title' || kind === 'epigraph') {
                page.createDiv({ cls: 'ert-bookmeta-intent-block ert-bookmeta-intent-block--secondary' });
            }
            if (kind === 'prose' || kind === 'list') {
                const lines = page.createDiv({ cls: 'ert-bookmeta-intent-lines' });
                for (let index = 0; index < (kind === 'list' ? 4 : 5); index++) {
                    lines.createDiv({ cls: `ert-bookmeta-intent-line${index === 3 ? ' is-short' : ''}` });
                }
            }
            target.createDiv({ cls: 'ert-bookmeta-intent-caption', text: caption });
        };

        const bookDetailsPanel = previewBody.createDiv({ cls: 'ert-bookmeta-module ert-bookmeta-module--details' });
        const bookDetailsHeader = bookDetailsPanel.createDiv({
            cls: 'ert-bookmeta-module-header ert-bookmeta-module-header--static'
        });
        const bookDetailsHeaderLeft = bookDetailsHeader.createDiv({ cls: 'ert-bookmeta-module-header-left' });
        const bookDetailsIcon = bookDetailsHeaderLeft.createSpan({ cls: 'ert-bookmeta-module-icon' });
        bookDetailsIcon.setAttr('aria-hidden', 'true');
        setIcon(bookDetailsIcon, 'file-text');
        bookDetailsHeaderLeft.createSpan({ cls: 'ert-bookmeta-module-title', text: 'Book Details' });
        bookDetailsHeader.createDiv({
            cls: 'ert-bookmeta-module-count',
            text: hasSourcePath ? 'Connected' : 'Not set up'
        });

        const primary = bookDetailsPanel.createDiv({ cls: 'ert-bookmeta-primary' });
        const addPrimaryField = (
            label: string,
            fieldKey: EditableBookMetaFieldKey,
            value: string | number | null | undefined,
            placeholder: string,
            required = true,
            tone: 'title' | 'subtitle' | 'author' = 'title'
        ) => {
            const field = primary.createDiv({ cls: `ert-bookmeta-primary-field ert-bookmeta-primary-field--${tone}` });
            renderBookMetaValue(
                field,
                fieldKey,
                label,
                value,
                placeholder,
                required,
                'ert-bookmeta-primary-value'
            );
            field.createDiv({ cls: 'ert-bookmeta-primary-label', text: label });
        };
        addPrimaryField('Title', 'title', meta?.title, 'Add title', true, 'title');
        addPrimaryField('Subtitle', 'subtitle', meta?.subtitle, 'Add subtitle', false, 'subtitle');
        addPrimaryField('Author', 'author', meta?.author, 'Add author', true, 'author');

        const details = bookDetailsPanel.createDiv({ cls: 'ert-bookmeta-detail-grid' });
        const leftCol = details.createDiv({ cls: 'ert-bookmeta-detail-col ert-bookmeta-detail-col--left' });
        const rightCol = details.createDiv({ cls: 'ert-bookmeta-detail-col ert-bookmeta-detail-col--right' });
        const addDetailField = (
            target: HTMLElement,
            label: string,
            value: string | number | null | undefined,
            placeholder: string,
            required: boolean
        ) => {
            const field = target.createDiv({ cls: 'ert-bookmeta-detail-field' });
            const fieldKey: EditableBookMetaFieldKey =
                label === 'Copyright holder'
                    ? 'copyright-holder'
                    : label === 'ISBN'
                        ? 'isbn'
                        : label === 'Rights year'
                            ? 'rights-year'
                            : label === 'Imprint'
                                ? 'imprint'
                                : label === 'Edition'
                                    ? 'edition'
                                    : 'publisher';
            renderBookMetaValue(field, fieldKey, label, value, placeholder, required, 'ert-bookmeta-detail-value');
            field.createDiv({ cls: 'ert-bookmeta-detail-label', text: label });
        };
        addDetailField(leftCol, 'Copyright holder', meta?.rights?.copyright_holder, 'Add copyright', true);
        addDetailField(leftCol, 'ISBN', meta?.identifiers?.isbn_paperback, 'Add ISBN (optional)', false);
        addDetailField(leftCol, 'Imprint', meta?.publisher?.imprint, 'Add imprint', false);
        addDetailField(rightCol, 'Rights year', meta?.rights?.year, 'Add year', true);
        addDetailField(rightCol, 'Publisher', meta?.publisher?.name, 'Add publisher', false);
        addDetailField(rightCol, 'Edition', meta?.publisher?.edition, 'Add edition', false);

        type MatterBookMetaField = {
            field: EditableBookMetaFieldKey;
            label: string;
            pageLabel: string;
            value: string | undefined;
            placeholder: string;
            kind: 'title' | 'dedication' | 'epigraph' | 'copyright' | 'prose' | 'list';
            caption: string;
            guidance: string;
            tone?: 'quote' | 'attribution';
            /** Canonical role this BookMeta field maps to. Used to detect note overrides. */
            role?: BookPageRole;
        };

        const renderMatterBookMetaSection = (
            key: string,
            title: string,
            description: string,
            fields: MatterBookMetaField[]
        ): void => {
            const expanded = expandedBookMetaSections.has(key);
            const filledPageLabels = Array.from(new Set(
                fields
                    .filter(field => normalizeValue(field.value))
                    .map(field => field.pageLabel)
            ));
            const count = filledPageLabels.length;
            const panel = previewBody.createDiv({
                cls: `ert-bookmeta-module ert-bookmeta-module--matter${expanded ? ' is-expanded' : ''}`,
                attr: { 'data-bookmeta-section': key }
            });
            const header = panel.createDiv({
                cls: 'ert-bookmeta-module-header',
                attr: {
                    role: 'button',
                    tabindex: '0',
                    'aria-expanded': String(expanded),
                    'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${title}`
                }
            });
            const headerLeft = header.createDiv({ cls: 'ert-bookmeta-module-header-left' });
            const chevron = headerLeft.createSpan({ cls: 'ert-bookmeta-module-chevron' });
            chevron.setAttr('aria-hidden', 'true');
            setIcon(chevron, 'chevron-right');
            const copy = headerLeft.createDiv({ cls: 'ert-bookmeta-module-copy' });
            copy.createDiv({ cls: 'ert-bookmeta-module-title', text: title });
            copy.createDiv({ cls: 'ert-bookmeta-module-description', text: description });
            header.createDiv({ cls: 'ert-bookmeta-module-count', text: `${count} page${count === 1 ? '' : 's'}` });

            const getScrollParent = (el: HTMLElement): HTMLElement | null => {
                let current = el.parentElement;
                while (current) {
                    const style = window.getComputedStyle(current);
                    const canScroll = /(auto|scroll)/.test(style.overflowY);
                    if (canScroll && current.scrollHeight > current.clientHeight) return current;
                    current = current.parentElement;
                }
                return el.ownerDocument.scrollingElement instanceof HTMLElement ? el.ownerDocument.scrollingElement : null;
            };
            const restoreSectionAnchor = (
                sectionKey: string,
                scrollParent: HTMLElement | null,
                previousHeaderTop: number
            ) => {
                const restore = () => {
                    const nextPanel = previewBody
                        .querySelector<HTMLElement>(`.ert-bookmeta-module--matter[data-bookmeta-section="${sectionKey}"]`);
                    const nextHeader = nextPanel?.querySelector<HTMLElement>('.ert-bookmeta-module-header');
                    if (!scrollParent || !nextHeader) return;
                    scrollParent.scrollTop += nextHeader.getBoundingClientRect().top - previousHeaderTop;
                };
                window.requestAnimationFrame(() => {
                    restore();
                    window.requestAnimationFrame(restore);
                });
            };
            const toggleSection = () => {
                const scrollParent = getScrollParent(header);
                const previousHeaderTop = header.getBoundingClientRect().top;
                if (expanded) expandedBookMetaSections.delete(key);
                else expandedBookMetaSections.add(key);
                renderBookMetaPreview();
                restoreSectionAnchor(key, scrollParent, previousHeaderTop);
            };
            header.addEventListener('click', toggleSection);
            header.addEventListener('keydown', (evt: KeyboardEvent) => {
                if (evt.key !== 'Enter' && evt.key !== ' ') return;
                evt.preventDefault();
                toggleSection();
            });

            if (!expanded) {
                panel.createDiv({
                    cls: 'ert-bookmeta-module-summary',
                    text: count > 0 ? filledPageLabels.join(', ') : 'No pages added'
                });
                return;
            }

            const list = panel.createDiv({ cls: 'ert-bookmeta-matter-list' });
            fields.forEach(fieldDef => {
                const hasValue = !!normalizeValue(fieldDef.value);
                const isOverridden = !!fieldDef.role && overriddenRoles.has(fieldDef.role);
                const overrideClass = isOverridden ? ' is-overridden' : '';
                const row = list.createDiv({ cls: `ert-bookmeta-matter-row${fieldDef.tone ? ` ert-bookmeta-matter-row--${fieldDef.tone}` : ''}${overrideClass}` });
                const textCol = row.createDiv({ cls: `ert-bookmeta-matter-field${fieldDef.tone ? ` ert-bookmeta-matter-field--${fieldDef.tone}` : ''}` });
                renderBookMetaValue(
                    textCol,
                    fieldDef.field,
                    fieldDef.label,
                    fieldDef.value,
                    fieldDef.placeholder,
                    false,
                    'ert-bookmeta-matter-value'
                );
                textCol.createDiv({ cls: 'ert-bookmeta-matter-guidance', text: fieldDef.guidance });
                textCol.createDiv({
                    cls: 'ert-bookmeta-matter-state',
                    text: hasValue ? 'BookMeta value set' : 'No BookMeta value'
                });
                if (isOverridden) {
                    textCol.createDiv({
                        cls: 'ert-bookmeta-matter-state',
                        text: 'Overridden by custom page'
                    });
                }
                const metaRow = textCol.createDiv({ cls: 'ert-bookmeta-matter-meta-row' });
                metaRow.createDiv({ cls: 'ert-bookmeta-matter-role', text: fieldDef.pageLabel.toUpperCase() });
                const previewCol = row.createDiv({ cls: 'ert-bookmeta-matter-preview-cell' });
                if (hasValue) {
                    const clearButton = previewCol.createEl('button', {
                        cls: 'ert-iconBtn ert-bookmeta-matter-clear',
                        attr: {
                            type: 'button',
                            'aria-label': `Reset ${fieldDef.label.toLowerCase()}`,
                            title: `Reset ${fieldDef.label.toLowerCase()}`
                        }
                    });
                    setIcon(clearButton, 'rotate-ccw');
                    clearButton.addEventListener('click', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        void clearBookMetaField(fieldDef.field);
                    });
                }
                const intent = previewCol.createDiv({ cls: 'ert-bookmeta-intent' });
                renderPageIntent(intent, fieldDef.kind, fieldDef.caption);
            });
        };

        renderMatterBookMetaSection('frontmatter', 'Frontmatter book pages', 'Pages before the manuscript — title page, dedication, epigraph. All optional.', [
            {
                field: 'title-page-note',
                label: 'Title page note',
                pageLabel: 'Title page',
                value: meta?.frontmatter?.title_page_note,
                placeholder: 'Title page note',
                kind: 'title',
                caption: 'Centered title page',
                guidance: 'Optional note beneath the title page block.',
                role: 'title-page',
            },
            {
                field: 'dedication',
                label: 'Dedication',
                pageLabel: 'Dedication',
                value: meta?.frontmatter?.dedication,
                placeholder: 'Dedication',
                kind: 'dedication',
                caption: 'Centered one-third down',
                guidance: 'A brief dedication, usually sparse and centered.',
                role: 'dedication',
            },
            {
                field: 'epigraph-quote',
                label: 'Epigraph quote',
                pageLabel: 'Epigraph',
                value: meta?.frontmatter?.epigraph_quote,
                placeholder: 'Epigraph quote',
                kind: 'epigraph',
                caption: 'Centered quote block',
                guidance: 'A short quoted passage before the manuscript.',
                tone: 'quote',
                role: 'epigraph',
            },
            {
                field: 'epigraph-attribution',
                label: 'Epigraph attribution',
                pageLabel: 'Epigraph',
                value: meta?.frontmatter?.epigraph_attribution,
                placeholder: 'Epigraph attribution',
                kind: 'epigraph',
                caption: 'Right-aligned attribution',
                guidance: 'The author, source, or context for the epigraph.',
                tone: 'attribution',
                role: 'epigraph',
            },
        ]);

        renderMatterBookMetaSection('backmatter', 'Backmatter book pages', 'Pages after the manuscript — acknowledgments, about the author. All optional.', [
            {
                field: 'acknowledgments',
                label: 'Acknowledgments',
                pageLabel: 'Acknowledgments',
                value: meta?.backmatter?.acknowledgments,
                placeholder: 'Acknowledgments',
                kind: 'prose',
                caption: 'Heading + prose',
                guidance: 'Thanks to readers, editors, supporters, or contributors.',
                role: 'acknowledgments',
            },
            {
                field: 'about-author',
                label: 'About the author',
                pageLabel: 'About the author',
                value: meta?.backmatter?.about_author,
                placeholder: 'About the author',
                kind: 'prose',
                caption: 'Bio paragraph',
                guidance: 'A short author bio for the final pages.',
                role: 'about-author',
            },
            {
                field: 'author-note',
                label: 'Author note',
                pageLabel: 'Author note',
                value: meta?.backmatter?.author_note,
                placeholder: 'Author note',
                kind: 'prose',
                caption: 'Heading + prose',
                guidance: 'A closing note to readers after the manuscript.',
                role: 'author-note',
            },
            {
                field: 'other-works',
                label: 'Other works',
                pageLabel: 'Other works',
                value: meta?.backmatter?.other_works,
                placeholder: 'Other works',
                kind: 'list',
                caption: 'Heading + list',
                guidance: 'Related titles, series entries, or selected works.',
                role: 'other-works',
            },
        ]);

        if (hasSourcePath) {
            const previewActions = bookDetailsPanel.createDiv({ cls: 'ert-bookmeta-preview-actions' });
            const infoIcon = previewActions.createSpan({ cls: 'ert-bookmeta-preview-actions-icon' });
            infoIcon.setAttr('aria-hidden', 'true');
            setIcon(infoIcon, 'info');
            previewActions.createSpan({ cls: 'ert-bookmeta-preview-actions-text', text: 'Click any field to edit.' });
            const sourceRow = bookDetailsPanel.createDiv({ cls: 'ert-bookmeta-source-row' });
            sourceRow.createSpan({ cls: 'ert-bookmeta-source-label', text: 'Source' });
            const sourceLink = sourceRow.createEl('a', {
                cls: 'ert-bookmeta-source-link',
                text: sourcePath,
                attr: { href: '#', title: sourcePath }
            });
            sourceLink.addEventListener('click', (evt) => {
                evt.preventDefault();
                void plugin.app.workspace.openLinkText(sourcePath, '', false);
            });
        }

        if (!meta) {
            const actions = bookDetailsPanel.createDiv({ cls: 'ert-bookmeta-preview-empty-actions' });
            new ButtonComponent(actions)
                .setButtonText('Create Book Details')
                .setCta()
                .onClick(async () => {
                    await openOrCreateBookMetaNote();
                });
            new ButtonComponent(actions)
                .setButtonText('Jump to Book Pages')
                .onClick(() => {
                    matterPreviewFrame?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
        }
    };
    renderBookMetaPreview();

    // ── Publishing Setup ────────────────────────────────────────────────────
    const publishingSetupPanel = section.createDiv({
        cls: ERT_CLASSES.STACK,
        attr: { [ERT_DATA.SECTION]: 'book-pages' }
    });
    publishingSetupPanel.addClass('ert-publish-order--book-pages');
    const publishingHeading = addProRow(new Setting(publishingSetupPanel))
        .setName('Book Pages')
        .setDesc('Review and reorder the pages that will be included in your manuscript.')
        .setHeading();
    addHeadingIcon(publishingHeading, 'book-open-text');
    applyErtHeaderLayout(publishingHeading);

    const buildStatusColumn = (
        iconName: string,
        title: string,
        value: string,
        desc: string,
        statusKey: 'optional' | 'setup' | 'attention' | 'blocked' | 'ready',
        stageNumber: number,
        pressLabel: string,
        actionLabel: string,
        quickStart: boolean,
        onClick?: () => void
    ): void => {
        const col = statusGrid.createDiv({ cls: `ert-publishing-status-col ert-publishing-status-col--${statusKey}${quickStart ? ' is-quick-start' : ''}` });
        if (quickStart) {
            col.createSpan({ cls: 'ert-publishing-status-col-quickstart', text: 'Start here' });
        }
        if (onClick) {
            col.setAttr('role', 'button');
            col.setAttr('tabindex', '0');
            col.addEventListener('click', onClick);
            col.addEventListener('keydown', (evt: KeyboardEvent) => {
                if (evt.key !== 'Enter' && evt.key !== ' ') return;
                evt.preventDefault();
                onClick();
            });
        }
        const glyph = col.createDiv({ cls: 'ert-publishing-status-col-glyph' });
        glyph.setAttr('aria-hidden', 'true');
        setIcon(glyph, iconName);

        const header = col.createDiv({ cls: 'ert-publishing-status-col-header' });
        const icon = header.createSpan({ cls: 'ert-publishing-status-col-icon' });
        icon.setAttr('aria-hidden', 'true');
        setIcon(icon, iconName);
        const heading = header.createDiv({ cls: 'ert-publishing-status-col-heading' });
        heading.createSpan({ cls: 'ert-publishing-status-col-kicker', text: `Form ${String(stageNumber).padStart(2, '0')}` });
        heading.createSpan({ cls: 'ert-publishing-status-col-title', text: title });
        col.createDiv({ cls: 'ert-publishing-status-col-value', text: value });
        col.createDiv({ cls: 'ert-publishing-status-col-desc', text: desc });
        const footer = col.createDiv({ cls: 'ert-publishing-status-col-footer' });
        footer.createSpan({ cls: 'ert-publishing-status-col-folio', text: String(stageNumber).padStart(2, '0') });
        footer.createSpan({ cls: 'ert-publishing-status-col-proof', text: pressLabel });
        footer.createSpan({ cls: 'ert-publishing-status-col-actionLabel', text: actionLabel });
    };

    const renderPublishingStripActions = (stages: ReturnType<typeof buildPublishingProgressStages>) => {
        setupActionRow.empty();
        setupButtonComponent = null;
        exportOptionsButtonComponent = null;

        const exportStage = stages.find(stage => stage.id === 'export-check');
        // Show "Export now" once export is genuinely possible (tools + a valid
        // style) — not while the one-time 'setup' step is still pending.
        const showExportButton = !!exportStage
            && (exportStage.statusKey === 'ready' || exportStage.statusKey === 'attention');
        const exportPrimary = exportStage?.statusKey === 'ready';
        // Nothing left that needs the author: every stage is either done or an
        // untaken optional. (Optional stages never block "all set".)
        const allReady = stages.every(stage => stage.statusKey === 'ready' || stage.statusKey === 'optional');

        // Auto configure — rendered first (left position)
        setupButtonComponent = new ButtonComponent(setupActionRow)
            .setButtonText(AUTO_CONFIGURE_BUTTON)
            .setTooltip('One-shot setup: detects Pandoc, installs templates, and seeds Book Details + optional inline LaTeX front/back matter examples.')
            .onClick(() => {
                void runAutoConfigurePublishing();
            });
        if (allReady) {
            // Nothing left to configure — mute the button
            setupButtonComponent.buttonEl.addClass('ert-pillBtn', 'ert-pillBtn--muted');
        } else if (!showExportButton || !exportPrimary) {
            setupButtonComponent.setCta();
            setupButtonComponent.buttonEl.addClass('ert-pillBtn');
        } else {
            setupButtonComponent.buttonEl.addClass('ert-pillBtn');
        }

        if (setupInFlight) {
            setSetupButtonState(true);
        }

        // Export now — rendered second (right position)
        if (showExportButton) {
            exportOptionsButtonComponent = new ButtonComponent(setupActionRow)
                .setButtonText('Export now')
                .onClick(() => {
                    plugin.openManuscriptExportModal();
                });
            if (exportPrimary) {
                exportOptionsButtonComponent.setCta();
            }
            exportOptionsButtonComponent.buttonEl.addClass('ert-pillBtn');
            exportOptionsButtonComponent.buttonEl.empty();
            exportOptionsButtonComponent.buttonEl.createSpan({
                cls: ERT_CLASSES.PILL_BTN_LABEL,
                text: 'Export now'
            });
            const exportIcon = exportOptionsButtonComponent.buttonEl.createSpan({ cls: ERT_CLASSES.PILL_BTN_ICON });
            setIcon(exportIcon, 'arrow-right');
        }
    };

    const renderPublishingStatusCard = () => {
        statusGrid.empty();
        const progress = getPublishingProgressContext(plugin);
        const stages = buildPublishingProgressStages({
            hasBookMeta: !!progress.activeBookMetaStatus.bookMeta,
            bookMetaSummary: progress.bookMetaSummary,
            matterSummary: progress.matterSummary,
            matterCount: progress.matterCount,
            layoutSummary: progress.layoutSummary,
            pandocPathValid: progress.pandocPathValid
        });

        const targetByStage: Record<PublishingStageId, HTMLElement | null> = {
            'book-details': bookMetaPreviewPanel,
            'book-pages': publishingSetupPanel,
            'pdf-style': layoutPanel,
            'export-check': systemConfigPanel
        };
        const iconByStage: Record<PublishingStageId, string> = {
            'book-details': 'file-text',
            'book-pages': 'book-open-text',
            'pdf-style': 'book-open',
            'export-check': 'check-circle-2'
        };
        const pressLabelByStage: Record<PublishingStageId, string> = {
            'book-details': 'Copy deck',
            'book-pages': 'Imposition',
            'pdf-style': 'Type form',
            'export-check': 'Press proof'
        };

        stages.forEach((stage, index) => {
            buildStatusColumn(
                iconByStage[stage.id],
                stage.title,
                stage.statusLabel,
                stage.detail,
                stage.statusKey,
                index + 1,
                pressLabelByStage[stage.id],
                stage.actionLabel,
                stage.quickStart === true,
                () => {
                    if (stage.id === 'export-check' && systemConfigPanel.hasClass('is-hidden')) {
                        revealSystemConfig();
                    } else {
                        targetByStage[stage.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            );
        });

        renderPublishingStripActions(stages);
    };
    refreshPublishingStatusCard = renderPublishingStatusCard;

    matterPreviewFrame = publishingSetupPanel.createDiv({ cls: `${ERT_CLASSES.PREVIEW_FRAME} ert-previewFrame--flush` });
    const matterPreviewHeader = matterPreviewFrame.createDiv({ cls: 'ert-previewFrame__header' });
    matterPreviewHeader.createDiv({ cls: 'ert-planetary-preview-heading ert-previewFrame__title', text: 'Book Pages preview' });
    const matterPreviewBody = matterPreviewFrame.createDiv({ cls: 'ert-matter-preview-body' });
    const formatRoleLabel = (role: string): string => role.replace(/[_-]+/g, ' ').trim();

    /**
     * Persist a new Book Pages preview order on the active book.
     * Saves an array of `ResolvedPage.id` values; UI reorder only at this stage.
     */
    const persistBookPageOrder = async (orderedIds: string[]): Promise<void> => {
        const activeBook = getActiveBook(plugin.settings);
        if (!activeBook) return;
        activeBook.bookPageOrder = orderedIds.slice();
        await plugin.saveSettings();
    };

    /**
     * Toggle a matter note's `Enabled` frontmatter. Writing `false` excludes
     * the note from the resolver (and the export) so a canonical-role note
     * steps aside and the BookMeta page for that role surfaces again; writing
     * `true` is recorded explicitly so the intent is visible in the YAML
     * rather than relying on absence. Atomic via processFrontMatter.
     */
    const setNoteEnabled = async (notePath: string, nextEnabled: boolean): Promise<void> => {
        const file = plugin.app.vault.getAbstractFileByPath(notePath);
        if (!(file instanceof TFile)) return;
        await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const fm = frontmatter as Record<string, unknown>;
            fm.Enabled = nextEnabled;
        });
        await renderMatterPreview();
    };

    const renderMatterPreview = async () => {
        matterPreviewBody.empty();
        try {
            const activeBookMetaStatus = getActiveBookMetaStatus(plugin);
            const validationSnapshot = getPublishingValidationSnapshot(plugin);
            const bookMetaAvailable = !!activeBookMetaStatus.bookMeta;
            const preview = await getMatterPreviewSummary(plugin);
            const matterNotes = getActiveBookMatterNoteSummaries(plugin);
            const resolvedCanonical = resolveBookPages(
                activeBookMetaStatus.bookMeta || undefined,
                matterNotes
            );
            const activeBook = getActiveBook(plugin.settings);
            const resolvedPages = applyBookPageOrder(resolvedCanonical, activeBook?.bookPageOrder);

            // Visibility is governed solely by the resolver's output: it IS the
            // final list. Zero pages = nothing to show, regardless of what the
            // matter-note walk or BookMeta hero would surface in their own panels.
            if (resolvedPages.length === 0) {
                const empty = matterPreviewBody.createDiv({ cls: 'ert-matter-preview-empty' });
                empty.createDiv({ cls: 'ert-matter-preview-empty-title', text: 'No Book Pages found yet' });
                empty.createDiv({
                    cls: 'ert-matter-preview-empty-desc',
                    text: 'Create Book Details first, then add the pages you need.'
                });
                const actions = empty.createDiv({ cls: 'ert-matter-preview-empty-actions' });
                new ButtonComponent(actions)
                    .setButtonText('Jump to Publishing Setup')
                    .onClick(() => {
                        publishingStagesPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                new ButtonComponent(actions)
                    .setButtonText('Jump to Book Details')
                    .onClick(() => {
                        bookMetaPreviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                return;
            }

            // Build a quick lookup from note path → MatterPreviewItem so we can
            // hydrate readiness/link metadata for note-backed rows.
            const previewByPath = new Map<string, MatterPreviewItem>();
            for (const item of [...preview.front, ...preview.back]) {
                previewByPath.set(item.file.path, item);
            }

            // Aggregate readiness across all preview items (unchanged from prior behavior).
            const allItems = [...preview.front, ...preview.back];
            const descriptors = allItems.map(item => {
                const issueCodes = validationSnapshot.matterIssues
                    .filter(issue => issue.field === item.role || issue.field === item.file.path)
                    .map(issue => issue.code);
                return {
                    item,
                    descriptor: describeMatterReadiness({
                        role: item.role,
                        usesBookMeta: item.usesBookMeta,
                        bookMetaAvailable,
                        issueCodes
                    })
                };
            });
            if (descriptors.length > 0) {
                const overallDescriptor = descriptors.reduce((winner, entry) => {
                    const rank: Record<string, number> = {
                        Ready: 0,
                        'Uses page content': 1,
                        'Excluded by layout': 2,
                        'Needs repair': 3,
                        'Needs metadata': 4
                    };
                    return rank[entry.descriptor.label] > rank[winner.label] ? entry.descriptor : winner;
                }, descriptors[0].descriptor);
                const statusRow = matterPreviewBody.createDiv({ cls: `ert-bookmeta-status is-${overallDescriptor.tone === 'error' ? 'missing' : overallDescriptor.tone === 'warning' ? 'warning' : 'found'}` });
                const statusIcon = statusRow.createSpan({ cls: 'ert-bookmeta-status-icon' });
                setIcon(statusIcon, overallDescriptor.tone === 'error' ? 'alert-circle' : overallDescriptor.tone === 'warning' ? 'alert-triangle' : 'check-circle-2');
                statusRow.createSpan({ text: `${overallDescriptor.label}: ${overallDescriptor.detail}` });
            }

            const list = matterPreviewBody.createDiv({ cls: 'ert-matter-preview-list' });

            // Drag-reorder state. The list is a single flat array (resolver order
            // with the user's saved override applied); the "Manuscript" divider is
            // a visual cue between frontmatter and backmatter, NOT a separate list.
            const dragState: { fromId: string | null; sourceRow: HTMLElement | null } = {
                fromId: null,
                sourceRow: null
            };
            const clearDragState = () => {
                list.querySelectorAll('.ert-matter-preview-row.is-dragover').forEach(el => el.removeClass('is-dragover'));
                dragState.sourceRow?.removeClass('is-dragging');
                dragState.sourceRow = null;
                dragState.fromId = null;
            };

            const reorderTo = async (fromId: string, toId: string) => {
                if (fromId === toId) return;
                // Enforce side-grouping: a frontmatter page cannot drop onto a
                // backmatter row (or vice versa). The export pipeline relies on
                // strict front→manuscript→back ordering; mixing sides would
                // also confuse readers. The applier enforces this at render
                // time too, but rejecting the drop here gives crisper UX —
                // the row visibly snaps back instead of silently re-sorting.
                const fromPage = resolvedPages.find(p => p.id === fromId);
                const toPage = resolvedPages.find(p => p.id === toId);
                if (!fromPage || !toPage || fromPage.side !== toPage.side) return;
                const ids = resolvedPages.map(p => p.id);
                const fromIdx = ids.indexOf(fromId);
                const toIdx = ids.indexOf(toId);
                if (fromIdx < 0 || toIdx < 0) return;
                const [moved] = ids.splice(fromIdx, 1);
                ids.splice(toIdx, 0, moved);
                await persistBookPageOrder(ids);
                await renderMatterPreview();
            };

            let rowIndex = 0;
            let lastSide: 'frontmatter' | 'backmatter' | null = null;

            const renderRow = (page: ResolvedPage) => {
                // Visual separator between frontmatter and backmatter.
                if (lastSide && lastSide !== page.side) {
                    list.createDiv({ cls: 'ert-matter-preview-divider', text: 'Manuscript' });
                }
                lastSide = page.side;

                const row = list.createDiv({ cls: 'ert-matter-preview-row' });
                row.toggleClass('is-alt', rowIndex % 2 === 1);
                rowIndex += 1;
                row.draggable = true;
                row.dataset.pageId = page.id;

                // Drag handle (visual affordance — entire row is draggable).
                const handle = row.createDiv({ cls: 'ert-drag-handle ert-matter-preview-handle' });
                setIcon(handle, 'grip-vertical');
                handle.setAttr('aria-label', 'Drag to reorder');

                if (page.source === 'note' && page.path) {
                    // Enable/disable toggle — only note-backed pages have a
                    // physical file to write `Enabled` into. Rows reaching
                    // this list are enabled by definition (the resolver drops
                    // disabled notes); unchecking writes Enabled:false so the
                    // note steps aside and any BookMeta page for its role
                    // resurfaces. stopPropagation keeps the row drag intact.
                    const notePath = page.path;
                    const toggle = row.createEl('input', {
                        cls: 'ert-matter-preview-enable',
                        attr: { type: 'checkbox', title: 'Enabled — uncheck to exclude this page from export without deleting the note' },
                    });
                    toggle.checked = true;
                    plugin.registerDomEvent(toggle, 'click', (e: MouseEvent) => {
                        e.stopPropagation();
                    });
                    plugin.registerDomEvent(toggle, 'change', () => {
                        void setNoteEnabled(notePath, false);
                    });

                    const main = row.createDiv({ cls: 'ert-matter-preview-main' });
                    const item = previewByPath.get(page.path);
                    const titleLink = main.createEl('a', {
                        cls: 'ert-matter-preview-link',
                        text: page.title,
                        attr: { href: '#', title: page.path }
                    });
                    titleLink.addEventListener('click', (evt: MouseEvent) => {
                        evt.preventDefault();
                        if (page.path) void plugin.app.workspace.openLinkText(page.path, '', false);
                    });

                    // NOTE pill omitted intentionally: every row in the Book
                    // Pages preview that's note-sourced is already implied by
                    // the body-mode badge (LATEX / PLAIN) and the role badge.
                    // BookMeta-sourced rows still get an explicit BOOKMETA pill
                    // because that source is the meaningful distinction.
                    const badges = main.createDiv({ cls: 'ert-matter-preview-badges' });
                    const modeTone = page.bodyMode === 'latex' ? 'latex' : 'plain';
                    badges.createSpan({
                        cls: `ert-matter-preview-badge ert-matter-preview-badge--${modeTone}`,
                        text: modeTone === 'latex' ? 'LATEX' : 'PLAIN'
                    });

                    if (item) {
                        const issueCodes = validationSnapshot.matterIssues
                            .filter(issue => issue.field === item.role || issue.field === item.file.path)
                            .map(issue => issue.code);
                        const readiness = describeMatterReadiness({
                            role: item.role,
                            usesBookMeta: item.usesBookMeta,
                            bookMetaAvailable,
                            issueCodes
                        });
                        const readinessBadge = badges.createSpan({
                            cls: 'ert-matter-preview-badge ert-matter-preview-badge--state',
                            text: readiness.label
                        });
                        readinessBadge.setAttr('title', readiness.detail);
                    }

                    if (page.role) {
                        badges.createSpan({
                            cls: 'ert-matter-preview-badge ert-matter-preview-badge--role',
                            text: formatRoleLabel(page.role)
                        });
                    }
                    // Custom note (page.role === null): no role badge — the
                    // NOTE · <BodyMode> badges already identify it.
                } else {
                    // BookMeta-generated row.
                    row.createSpan({ cls: 'ert-matter-preview-enable-spacer', attr: { 'aria-hidden': 'true' } });
                    const main = row.createDiv({ cls: 'ert-matter-preview-main' });
                    main.createSpan({ cls: 'ert-matter-preview-link', text: page.title });
                    const badges = main.createDiv({ cls: 'ert-matter-preview-badges' });
                    badges.createSpan({ cls: 'ert-matter-preview-badge ert-matter-preview-badge--source', text: 'BOOKMETA' });
                    badges.createSpan({ cls: 'ert-matter-preview-badge ert-matter-preview-badge--state', text: 'GENERATED' });
                    if (page.role) {
                        badges.createSpan({
                            cls: 'ert-matter-preview-badge ert-matter-preview-badge--role',
                            text: formatRoleLabel(page.role)
                        });
                    }
                }

                plugin.registerDomEvent(row, 'dragstart', (e: DragEvent) => {
                    dragState.fromId = page.id;
                    dragState.sourceRow = row;
                    row.addClass('is-dragging');
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', page.id);
                    }
                });
                plugin.registerDomEvent(row, 'dragend', () => {
                    clearDragState();
                });
                // Cross-side drops are rejected (frontmatter ↔ backmatter never
                // mix). Suppress the dragover affordance entirely on rows from
                // the other side so the cursor shows "no drop" and the row
                // doesn't get a misleading drop indicator.
                const isCrossSideDrag = (): boolean => {
                    if (!dragState.fromId) return false;
                    const fromPage = resolvedPages.find(p => p.id === dragState.fromId);
                    return !!fromPage && fromPage.side !== page.side;
                };
                plugin.registerDomEvent(row, 'dragenter', (e: DragEvent) => {
                    if (!dragState.fromId || dragState.fromId === page.id) return;
                    if (isCrossSideDrag()) return;
                    e.preventDefault();
                    row.addClass('is-dragover');
                });
                plugin.registerDomEvent(row, 'dragover', (e: DragEvent) => {
                    if (!dragState.fromId || dragState.fromId === page.id) return;
                    if (isCrossSideDrag()) {
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                        return;
                    }
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    row.addClass('is-dragover');
                });
                plugin.registerDomEvent(row, 'dragleave', () => {
                    row.removeClass('is-dragover');
                });
                plugin.registerDomEvent(row, 'drop', (e: DragEvent) => {
                    e.preventDefault();
                    const fromId = dragState.fromId || e.dataTransfer?.getData('text/plain') || '';
                    clearDragState();
                    if (!fromId || fromId === page.id) return;
                    void reorderTo(fromId, page.id);
                });
            };

            for (const page of resolvedPages) renderRow(page);

            // Disabled notes don't reach `resolvedPages` (the resolver drops
            // them), so render them in a muted group below the live list.
            // Without this they'd vanish from the UI entirely once disabled,
            // leaving no way to turn them back on. Re-checking writes
            // Enabled:true and the note rejoins the resolved list.
            const disabledNotes = matterNotes.filter(n => n.enabled === false);
            if (disabledNotes.length > 0) {
                list.createDiv({
                    cls: 'ert-matter-preview-divider ert-matter-preview-divider--disabled',
                    text: 'Disabled — excluded from export',
                });
                for (const note of disabledNotes) {
                    const drow = list.createDiv({ cls: 'ert-matter-preview-row is-disabled' });
                    drow.createDiv({
                        cls: 'ert-matter-preview-handle ert-matter-preview-handle--placeholder',
                        attr: { 'aria-hidden': 'true' },
                    });
                    const dToggle = drow.createEl('input', {
                        cls: 'ert-matter-preview-enable',
                        attr: { type: 'checkbox', title: 'Disabled — check to include this page in export again' },
                    });
                    dToggle.checked = false;
                    const dNotePath = note.path;
                    plugin.registerDomEvent(dToggle, 'change', () => {
                        void setNoteEnabled(dNotePath, true);
                    });
                    const dMain = drow.createDiv({ cls: 'ert-matter-preview-main' });
                    const dLink = dMain.createEl('a', {
                        cls: 'ert-matter-preview-link',
                        text: note.title || note.path,
                        attr: { href: '#', title: note.path },
                    });
                    plugin.registerDomEvent(dLink, 'click', (evt: MouseEvent) => {
                        evt.preventDefault();
                        void plugin.app.workspace.openLinkText(note.path, '', false);
                    });
                    const dBadges = dMain.createDiv({ cls: 'ert-matter-preview-badges' });
                    const dTone = note.bodyMode === 'latex' ? 'latex' : 'plain';
                    dBadges.createSpan({
                        cls: `ert-matter-preview-badge ert-matter-preview-badge--${dTone}`,
                        text: dTone === 'latex' ? 'LATEX' : 'PLAIN',
                    });
                    // Show the role this note WOULD claim if re-enabled, so
                    // the user can see what it's currently suppressing.
                    const explicitRole = (note.role || '').trim().toLowerCase();
                    const inferredRole = explicitRole || inferRoleFromFilename(note.path || note.title) || '';
                    if (inferredRole) {
                        dBadges.createSpan({
                            cls: 'ert-matter-preview-badge ert-matter-preview-badge--role',
                            text: formatRoleLabel(inferredRole),
                        });
                    }
                }
            }
        } catch (e) {
            const message = (e as Error).message || String(e);
            matterPreviewBody.createDiv({ cls: 'ert-matter-preview-empty-line', text: `Matter preview unavailable: ${message}` });
        }
    };
    void renderMatterPreview();

    renderPublishingStatusCard();

    // ── System Configuration visibility: show when pandoc path is invalid ──
    if (!isPandocPathValid(plugin.settings.pandocPath)) {
        systemConfigPanel.removeClass('is-hidden');
    }

    // ── "Advanced configuration" disclosure toggle ─────────────────────────
    const advancedToggle = section.createDiv({ cls: 'ert-advanced-config-toggle' });
    advancedToggle.addClass('ert-publish-order--advanced-toggle');
    const advancedLink = advancedToggle.createEl('a', {
        cls: 'ert-advanced-config-link',
        text: 'Advanced configuration',
        attr: { href: '#' }
    });
    const advancedIcon = advancedToggle.createSpan({ cls: 'ert-advanced-config-icon' });
    setIcon(advancedIcon, 'chevron-right');
    advancedToggle.prepend(advancedIcon);
    // Hide toggle if system config is already visible
    if (!systemConfigPanel.hasClass('is-hidden')) {
        advancedToggle.addClass('is-hidden');
    }
    advancedLink.addEventListener('click', (evt: MouseEvent) => {
        evt.preventDefault();
        advancedToggle.addClass('is-hidden');
        revealSystemConfig();
    });

    // ── System Configuration: Repair tools (only when mismatches exist) ────
    const repairPlan = buildMatterRepairPlan(plugin);
    if (repairPlan.issues.length > 0) {
        const repairHeading = addProRow(new Setting(systemConfigPanel))
            .setName('Repair tools')
            .setDesc('Repair detected metadata mismatches for matter notes in the active book.')
            .setHeading();
        addHeadingIcon(repairHeading, 'wrench');
        applyErtHeaderLayout(repairHeading);

        const repairSetting = addProRow(new Setting(systemConfigPanel))
            .setName('Repair matter metadata')
            .setDesc('Updates frontmatter only on detected matter notes. No file moves. No note body edits.');
        repairSetting.addButton(button => {
            button.setButtonText('Repair active book');
            button.setTooltip('Repairs metadata mismatches and removes legacy Matter/matter fields.');
            if (repairPlan.repairableIssues.length === 0) {
                button.setDisabled(true);
            }
            button.onClick(async () => {
                const currentPlan = buildMatterRepairPlan(plugin);
                const targetCount = currentPlan.repairableIssues.length;
                if (targetCount === 0) {
                    new Notice('No repairable matter metadata mismatches found.');
                    return;
                }
                const proceed = await confirmWithErtModal(plugin.app, {
                    title: 'Repair matter metadata',
                    message: `This will update frontmatter on ${targetCount} note${targetCount === 1 ? '' : 's'} in the active book. Note bodies and filenames are not changed.`,
                    confirmText: 'Repair now',
                    cancelText: 'Cancel',
                    badge: { text: 'Repair', icon: 'wrench' }
                });
                if (!proceed) return;

                button.setDisabled(true);
                button.setButtonText('Repairing…');
                try {
                    const result = await applyMatterRepairPlan(plugin, currentPlan);
                    new Notice(`Repaired ${result.updated} notes.`);
                    rerender();
                } catch (e) {
                    const msg = (e as Error).message || String(e);
                    new Notice(`Failed to repair matter metadata: ${msg}`);
                } finally {
                    button.setDisabled(false);
                    button.setButtonText('Repair active book');
                }
            });
        });

        const changeList = repairSetting.settingEl.createEl('ul', { cls: 'ert-migration-change-list' });
        changeList.createEl('li', {
            text: `Detected on ${repairPlan.issues.length} note${repairPlan.issues.length === 1 ? '' : 's'} in the active book.`
        });
        changeList.createEl('li', {
            text: `Repairable now: ${repairPlan.repairableIssues.length}`
        });
        if (repairPlan.unresolvedIssues.length > 0) {
            changeList.createEl('li', {
                text: `${repairPlan.unresolvedIssues.length} note${repairPlan.unresolvedIssues.length === 1 ? '' : 's'} require Class to be set to Frontmatter or Backmatter.`
            });
        }
    }

    return section;
}
