import { App, ButtonComponent, DropdownComponent, Modal, Notice, SuggestModal, TFile, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { ImportedTemplateCandidate } from '../utils/templateImport';
import { buildImportedTemplateCandidate, finalizeImportedLayout } from '../utils/templateImport';
import { fontNameWithSpelling } from '../publishing/fontResolver';
import { buildImportedTemplateCheckManuscript, hashTemplateText, runImportedTemplateCheck, type ImportedTemplateCheckRecord } from '../publishing/importedTemplateCheck';
import type { PandocLayoutTemplate, UsageContext } from '../types';
import type { LatexMissingCause } from '../utils/exportErrors';
import { parseCustomPandocMetadata } from '../utils/exportFormats';
import { drawPdfPage, renderPdfPagePng } from '../publishing/importedTemplatePreview';
import { buildImportedTemplateFactRows, renderImportedTemplateFacts, type ImportedTemplateFactRow } from '../settings/sections/publish/ImportedLayoutSummary';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { scheduleClassAfterPaint } from '../utils/domClassEffects';
import { t } from '../i18n';

type ImportTemplateStep = 1 | 2 | 3 | 4;

/** What Save hands over: the layout to register, the text to copy, and the proof that text built a PDF. */
export interface ImportedTemplateCommit {
    layout: PandocLayoutTemplate;
    templateText: string;
    record: ImportedTemplateCheckRecord;
    /** The sample page of the test PDF, for the layout's row in Settings. Absent when it could not be drawn. */
    firstPagePng?: ArrayBuffer;
}

/**
 * The test PDF for the chosen file. `key` names what was built (the template
 * text and how an export would assemble for the layout), so a pass is reused
 * only for exactly that.
 */
type TemplateCheckState =
    | { state: 'idle' }
    | { state: 'passed'; key: string; record: ImportedTemplateCheckRecord; pdf: Uint8Array }
    | { state: 'failed'; key: string; reason: 'tools' | 'latex' | 'missing'; latexLines: string[]; cause: LatexMissingCause | null };

class TemplateFileSuggestModal extends SuggestModal<TFile> {
    private readonly onChooseFile: (path: string) => void;
    private readonly itemCache = new WeakMap<HTMLElement, { row: HTMLDivElement; title: HTMLDivElement; desc: HTMLDivElement }>();

    constructor(app: App, onChooseFile: (path: string) => void) {
        super(app);
        this.onChooseFile = onChooseFile;
        this.limit = 40;
        this.emptyStateText = t('ui.importTemplateModal.noTemplatesFound');
    }

    onOpen(): void {
        void super.onOpen();
        this.modalEl.addClass('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md', 'ert-modal--template-pack', 'ert-modal--search');
        this.modalEl.removeClass('is-ui-settled');
        scheduleClassAfterPaint(this.modalEl, 'is-ui-settled');
        this.contentEl.addClass('ert-modal-container', 'ert-search-modal', 'ert-search-modal--with-results', 'ert-stack', 'ert-template-search-modal');
        this.resultContainerEl.addClass('ert-template-search-results');
        this.setPlaceholder(t('ui.importTemplateModal.searchPlaceholder'));
        scheduleFocusAfterPaint(this.inputEl, { selectText: true });
    }

    getSuggestions(query: string): TFile[] {
        const lowered = (query || '').trim().toLowerCase();
        return this.app.vault.getFiles()
            .filter(file => /\.(tex|ltx|latex)$/i.test(file.path))
            .filter(file => !lowered || file.path.toLowerCase().includes(lowered))
            .slice(0, 40);
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        let cached = this.itemCache.get(el);
        if (!cached) {
            const row = el.createDiv({ cls: 'ert-modal-choice' });
            const title = row.createDiv({ cls: 'ert-note-creator-option__title' });
            const desc = row.createDiv({ cls: 'ert-note-creator-option__desc' });
            cached = { row, title, desc };
            this.itemCache.set(el, cached);
        }

        cached.title.setText(file.basename);
        cached.desc.setText(file.path);
    }

    onChooseSuggestion(file: TFile): void {
        this.onChooseFile(file.path);
    }
}

export class ImportTemplateModal extends Modal {
    private step: ImportTemplateStep = 1;
    private sourcePath = '';
    private usageContext: UsageContext = 'novel';
    private templateName = '';
    private templateNameTouched = false;
    private templateDescription = '';
    private templateDescriptionTouched = false;
    private candidate: ImportedTemplateCandidate | null = null;
    /** What the dialog is waiting on: reading the file, or building the test PDF. */
    private busy: 'reading' | 'building' | null = null;
    private check: TemplateCheckState = { state: 'idle' };
    private commitInFlight = false;
    /** Set while the dialog is closed, so a Save still awaiting its check does not register after a cancel. */
    private closed = false;
    private candidateRequestToken = 0;
    private readonly onCommit: (commit: ImportedTemplateCommit) => Promise<void> | void;

    private usageDropdown?: DropdownComponent;
    private saveButton?: ButtonComponent;
    private nextButton: ButtonComponent | null = null;
    private backButton: ButtonComponent | null = null;
    private cancelButton: ButtonComponent | null = null;
    private stepItemEls: HTMLDivElement[] = [];
    private stepMetaEl: HTMLSpanElement | null = null;
    private railEl: HTMLDivElement | null = null;
    private panelEl: HTMLDivElement | null = null;
    private actionsEl: HTMLDivElement | null = null;

    constructor(app: App, private readonly plugin: RadialTimelinePlugin, onCommit: (commit: ImportedTemplateCommit) => Promise<void> | void) {
        super(app);
        this.onCommit = onCommit;
    }

    onOpen(): void {
        this.step = 1;
        this.sourcePath = '';
        this.usageContext = 'novel';
        this.templateName = '';
        this.templateNameTouched = false;
        this.templateDescription = '';
        this.templateDescriptionTouched = false;
        this.candidate = null;
        this.busy = null;
        this.check = { state: 'idle' };
        this.commitInFlight = false;
        this.closed = false;
        this.candidateRequestToken += 1;
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md', 'ert-modal--import-template');
            modalEl.classList.remove('is-ui-settled');
            scheduleClassAfterPaint(modalEl, 'is-ui-settled');
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.importTemplateModal.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.importTemplateModal.title') });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('ui.importTemplateModal.subtitle'),
        });
        const meta = header.createDiv({ cls: 'ert-modal-meta' });
        this.stepMetaEl = meta.createSpan({ cls: 'ert-modal-meta-item' });
        this.railEl = contentEl.createDiv({ cls: 'ert-import-template-steps' });
        this.panelEl = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-stack ert-import-template-panel' });
        this.actionsEl = contentEl.createDiv({ cls: 'ert-modal-actions' });
        this.createStepRail();
        this.createActionButtons();
        void this.refreshCandidate();
    }

    onClose(): void {
        this.closed = true;
        this.candidateRequestToken += 1;
        this.contentEl.empty();
        this.nextButton = null;
        this.backButton = null;
        this.cancelButton = null;
        this.stepItemEls = [];
        this.stepMetaEl = null;
        this.railEl = null;
        this.panelEl = null;
        this.actionsEl = null;
    }

    private getCandidatePath(): string {
        return this.sourcePath.trim();
    }

    private getCandidateName(): string | undefined {
        const value = this.templateName.trim();
        return value.length > 0 ? value : undefined;
    }

    private getCandidateDescription(): string | undefined {
        const value = this.templateDescription.trim();
        return value.length > 0 ? value : undefined;
    }

    /** The layout record Save will register, from the file as read and the fields as entered. */
    private buildFinalLayout(candidate: ImportedTemplateCandidate): PandocLayoutTemplate {
        return finalizeImportedLayout(this.plugin, candidate, {
            name: this.templateName,
            preset: this.usageContext,
            description: this.templateDescription,
        });
    }

    /** Names exactly what a test PDF is built from: the template text and the manuscript assembled for this layout. */
    private async getCheckKey(layout: PandocLayoutTemplate, templateText: string): Promise<string> {
        return `${hashTemplateText(templateText)}|${hashTemplateText(await buildImportedTemplateCheckManuscript(layout))}`;
    }

    /**
     * Read the chosen file again and, if nothing in the file itself blocks it,
     * make sure a test PDF has been built from exactly this text for exactly
     * this layout. A pass already on hand for the same text and layout is kept.
     */
    private async refreshCandidate(): Promise<void> {
        const sourcePath = this.getCandidatePath();
        const requestToken = ++this.candidateRequestToken;
        if (!sourcePath) {
            this.candidate = null;
            this.check = { state: 'idle' };
            this.busy = null;
            this.render();
            return;
        }

        this.busy = 'reading';
        this.render();

        try {
            const candidate = await buildImportedTemplateCandidate(this.plugin, {
                sourcePath,
                // Only what the author typed is carried over: a name or
                // description filled in from one file must not stick to the next.
                name: this.templateNameTouched ? this.getCandidateName() : undefined,
                preset: this.usageContext,
                description: this.templateDescriptionTouched ? this.getCandidateDescription() : undefined,
            });
            if (requestToken !== this.candidateRequestToken) return;

            if (!this.templateNameTouched) {
                this.templateName = candidate.layout.name;
            }
            if (!this.templateDescriptionTouched) {
                this.templateDescription = candidate.layout.description || '';
            }
            this.candidate = candidate;
            if (!candidate.canActivate) {
                this.check = { state: 'idle' };
                return;
            }

            const layout = this.buildFinalLayout(candidate);
            const key = await this.getCheckKey(layout, candidate.sourceText);
            if (requestToken !== this.candidateRequestToken) return;
            if (this.check.state === 'passed' && this.check.key === key) return;
            this.busy = 'building';
            this.render();
            const result = await runImportedTemplateCheck({
                layout,
                templateText: candidate.sourceText,
                pandocPath: this.plugin.settings.pandocPath,
            });
            if (requestToken !== this.candidateRequestToken) return;
            this.check = result.ok
                ? { state: 'passed', key, record: result.record, pdf: result.pdf }
                : { state: 'failed', key, reason: result.reason, latexLines: result.latexLines, cause: result.cause };
        } catch (error) {
            if (requestToken !== this.candidateRequestToken) return;
            this.candidate = null;
            this.check = { state: 'idle' };
            console.error(error);
        } finally {
            if (requestToken === this.candidateRequestToken) {
                this.busy = null;
                this.render();
            }
        }
    }

    /** The saved picture is a convenience: an import does not fail for want of it. */
    private async renderSamplePagePng(pdf: Uint8Array, page: number): Promise<ArrayBuffer | undefined> {
        try {
            return await renderPdfPagePng(pdf, page, this.contentEl.ownerDocument);
        } catch (error) { // SAFE: the layout is saved without a picture and its row shows none; the test PDF itself already passed
            console.error(error);
            return undefined;
        }
    }

    private async chooseFile(): Promise<void> {
        new TemplateFileSuggestModal(this.app, (selectedPath) => {
            this.sourcePath = selectedPath;
            void this.refreshCandidate();
        }).open();
    }

    private async handleDroppedTemplate(files: FileList | null): Promise<void> {
        const dropped = files?.[0];
        if (!dropped) return;

        const fileName = dropped.name;
        if (!/\.(tex|ltx|latex)$/i.test(fileName)) {
            new Notice(t('ui.importTemplateModal.dropTexNotice'));
            return;
        }
        let filePath: string;
        try {
            const electron = (window as unknown as { require(name: 'electron'): { webUtils: { getPathForFile(file: File): string } } }).require('electron'); // SAFE: public Electron API resolves only the local file explicitly dropped by the user.
            filePath = electron.webUtils.getPathForFile(dropped).trim();
        } catch {
            new Notice(t('ui.importTemplateModal.droppedPathUnreadable'));
            return;
        }
        if (!filePath) { new Notice(t('ui.importTemplateModal.droppedPathUnreadable')); return; }

        this.sourcePath = filePath;
        await this.refreshCandidate();
    }

    private async commit(): Promise<void> {
        if (!this.candidate || this.commitInFlight) return;
        this.commitInFlight = true;
        this.updateActionButtons();
        try {
            // The check may have run several steps ago, and the name entered
            // since can change how an export assembles for this layout. Read
            // the file again; the test PDF is rebuilt unless the pass on hand
            // is for this exact text and layout.
            await this.refreshCandidate();
            // Closed (Escape or the close button) while the check ran: that
            // is a cancel, and the pass on hand may be for an older layout.
            if (this.closed) return;
            const candidate = this.candidate;
            const check = this.check;
            if (!candidate?.canActivate || check.state !== 'passed') {
                // Show why on the Check step instead of leaving Save silently inert.
                this.step = 2;
                this.render();
                return;
            }
            const firstPagePng = await this.renderSamplePagePng(check.pdf, check.record.samplePage);
            // Drawing the page image takes a moment too; a close during it is still a cancel.
            if (this.closed) return;
            await this.onCommit({
                layout: this.buildFinalLayout(candidate),
                templateText: candidate.sourceText,
                record: check.record,
                firstPagePng,
            });
            this.close();
        } catch (error) {
            new Notice(t('ui.importTemplateModal.saveFailed', { message: error instanceof Error ? error.message : String(error) }));
        } finally {
            this.commitInFlight = false;
            this.updateActionButtons();
        }
    }

    private render(): void {
        if (!this.stepMetaEl || !this.railEl || !this.panelEl || !this.actionsEl) return;
        this.stepMetaEl.setText(t('ui.importTemplateModal.stepMeta', { step: this.step }));
        this.panelEl.empty();
        this.updateStepRail();

        const panel = this.panelEl;
        if (this.busy) {
            this.renderStepHero(panel, {
                icon: 'loader-circle',
                title: this.busy === 'building' ? t('ui.importTemplateModal.buildingTitle') : t('ui.importTemplateModal.checkingTitle'),
                description: this.busy === 'building' ? t('ui.importTemplateModal.buildingDesc') : t('ui.importTemplateModal.checkingDesc'),
            });
        } else {
            switch (this.step) {
                case 1:
                    this.renderChooseFileStep(panel);
                    break;
                case 2:
                    this.renderCheckStep(panel);
                    break;
                case 3:
                    this.renderSetupStep(panel);
                    break;
                case 4:
                    this.renderSaveStep(panel);
                    break;
            }
        }

        this.updateActionButtonsVisibility();
        this.updateActionButtons();
    }

    private canAdvanceToNextStep(): boolean {
        if (this.busy) return false;
        if (this.step === 1) return Boolean(this.getCandidatePath());
        // Past the Check step only with a test PDF built.
        return Boolean(this.candidate?.canActivate) && this.check.state === 'passed';
    }

    private createStepRail(): void {
        if (!this.railEl) return;
        const steps = [t('ui.importTemplateModal.stepChoose'), t('ui.importTemplateModal.stepCheck'), t('ui.importTemplateModal.stepSetUp'), t('common.save')];
        this.stepItemEls = steps.map((label, index) => {
            const item = this.railEl!.createDiv({ cls: `ert-import-template-step ert-import-template-step--${index + 1}` });
            const bg = item.createDiv({ cls: 'ert-import-template-step-bg' });
            setIcon(bg, this.getStepRailIcon(index + 1));
            const text = item.createDiv({ cls: 'ert-import-template-step-text' });
            text.createDiv({ cls: 'ert-import-template-step-label', text: `${index + 1} ${label}` });
            return item;
        });
        this.updateStepRail();
    }

    private updateStepRail(): void {
        this.stepItemEls.forEach((item, index) => {
            const stepNumber = (index + 1) as ImportTemplateStep;
            const isCurrent = this.step === stepNumber;
            const isComplete = this.step > stepNumber;
            const isReady = stepNumber === 1 ? Boolean(this.getCandidatePath()) : isCurrent || isComplete;
            item.classList.toggle('is-active', isCurrent);
            item.classList.toggle('is-complete', isComplete);
            item.classList.toggle('is-ready', isReady);
            if (isCurrent) {
                item.setAttr('aria-current', 'step');
            } else {
                item.removeAttribute('aria-current');
            }
        });
    }

    private createActionButtons(): void {
        if (!this.actionsEl) return;
        this.backButton = new ButtonComponent(this.actionsEl)
            .setButtonText(t('ui.importTemplateModal.back'))
            .onClick(() => {
                if (this.step > 1) {
                    this.step = (this.step - 1) as ImportTemplateStep;
                    this.render();
                }
            });
        this.nextButton = new ButtonComponent(this.actionsEl)
            .setButtonText(t('ui.importTemplateModal.next'))
            .onClick(() => {
                if (this.step < 4) {
                    this.step = (this.step + 1) as ImportTemplateStep;
                    this.render();
                }
            });
        this.nextButton.buttonEl.addClass('ert-import-template-nextBtn');
        this.saveButton = new ButtonComponent(this.actionsEl)
            .setButtonText(t('ui.importTemplateModal.saveTemplate'))
            .setCta()
            .onClick(() => void this.commit());
        this.cancelButton = new ButtonComponent(this.actionsEl)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
    }

    private setButtonVisible(button: ButtonComponent | null | undefined, visible: boolean): void {
        const el = button?.buttonEl;
        if (!el) return;
        el.toggleClass('is-hidden', !visible);
    }

    private updateActionButtonsVisibility(): void {
        // Steps 1-3: Back / Next / Cancel (all grouped on the right).
        // Step 4: Back / Save / Cancel (all grouped on the right).
        this.setButtonVisible(this.backButton, this.step > 1);
        this.setButtonVisible(this.nextButton, this.step < 4);
        this.setButtonVisible(this.saveButton, this.step === 4);
    }

    private renderStepHero(
        panel: HTMLElement,
        options: {
            icon: string;
            title: string;
            description: string;
            tone?: 'ready' | 'blocked';
            statusLabel?: string;
            notes?: string[];
            /** Lines LaTeX printed, shown as given. */
            latexLines?: string[];
        }
    ): void {
        const hero = panel.createDiv({
            cls: `ert-import-template-stepHero${options.tone ? ` ert-import-template-stepHero--${options.tone}` : ''}`,
        });
        const visual = hero.createDiv({ cls: 'ert-import-template-stepHero-visual' });
        const iconWrap = visual.createDiv({ cls: 'ert-import-template-stepHero-icon' });
        setIcon(iconWrap, options.icon);

        hero.createDiv({ cls: 'ert-import-template-stepHero-title', text: options.title });
        hero.createDiv({ cls: 'ert-import-template-stepHero-desc', text: options.description });
        if (options.statusLabel) {
            hero.createDiv({ cls: 'ert-import-template-stepHero-status', text: options.statusLabel });
        }
        if (options.notes && options.notes.length > 0) {
            const notes = hero.createDiv({ cls: 'ert-import-template-stepHero-notes' });
            options.notes.forEach((note) => {
                notes.createDiv({ cls: 'ert-import-template-stepHero-note', text: note });
            });
        }
        if (options.latexLines && options.latexLines.length > 0) {
            hero.createEl('pre', { cls: 'ert-import-template-latexError', text: options.latexLines.join('\n') });
        }
    }

    private renderChooseFileStep(panel: HTMLElement): void {
        const picker = panel.createDiv({
            cls: `ert-import-template-picker${this.getCandidatePath() ? ' is-selected' : ''}`,
        });
        picker.setAttr('role', 'button');
        picker.setAttr('tabindex', '0');
        picker.addEventListener('click', () => { void this.chooseFile(); });
        picker.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            void this.chooseFile();
        });
        picker.addEventListener('dragenter', (event) => {
            event.preventDefault();
            picker.addClass('is-dragover');
        });
        picker.addEventListener('dragover', (event) => {
            event.preventDefault();
            picker.addClass('is-dragover');
        });
        picker.addEventListener('dragleave', (event) => {
            const related = event.relatedTarget;
            if (!(related instanceof Node) || !picker.contains(related)) {
                picker.removeClass('is-dragover');
            }
        });
        picker.addEventListener('drop', (event) => {
            event.preventDefault();
            picker.removeClass('is-dragover');
            void this.handleDroppedTemplate(event.dataTransfer?.files || null);
        });

        const visual = picker.createDiv({ cls: 'ert-import-template-picker-visual' });
        const iconWrap = visual.createDiv({ cls: 'ert-import-template-picker-icon' });
        setIcon(iconWrap, 'scroll-text');

        picker.createDiv({
            cls: 'ert-import-template-picker-title',
            text: this.getSelectedTemplateTitle(),
        });
        picker.createDiv({
            cls: 'ert-import-template-picker-desc',
            text: this.getCandidatePath() ? t('ui.importTemplateModal.latexTemplate') : t('ui.importTemplateModal.chooseLatexTemplate'),
        });

        if (this.getCandidatePath()) {
            picker.createDiv({
                cls: 'ert-import-template-picker-meta',
                text: this.getCandidatePath(),
            });
        }
    }

    /**
     * What the dialog says about the template: read from the file, and
     * measured from the test PDF once there is one. Nothing is guessed.
     */
    private getFactRows(copyPath?: string): ImportedTemplateFactRow[] {
        const candidate = this.candidate;
        if (!candidate) return [];
        return buildImportedTemplateFactRows({
            facts: candidate.facts,
            check: this.check.state === 'passed' ? this.check.record : undefined,
            copyPath,
            filledFields: Object.keys(parseCustomPandocMetadata(this.plugin.settings.customPandocMetadata)),
        });
    }

    /** Fact rows beside a page of the test PDF: the real page, drawn from the PDF. */
    private renderFactsWithPage(panel: HTMLElement, rows: ImportedTemplateFactRow[]): void {
        const block = panel.createDiv({ cls: 'ert-import-template-facts' });
        renderImportedTemplateFacts(block.createDiv({ cls: 'ert-import-template-facts-rows' }), rows);
        const check = this.check;
        if (check.state !== 'passed') return;
        const figure = block.createDiv({ cls: 'ert-import-template-page' });
        const canvas = figure.createEl('canvas', { cls: 'ert-import-template-page-canvas' });
        figure.createDiv({ cls: 'ert-import-template-page-caption', text: t('ui.importedLayoutSummary.previewCaption', { page: check.record.samplePage }) });
        // No picture is better than a made-up one: if the page cannot be drawn, the figure goes.
        void drawPdfPage(check.pdf, check.record.samplePage, canvas, 190).catch((error: unknown) => {
            figure.remove();
            console.error(error);
        });
    }

    /**
     * "Ready" here means one thing: this template built a test PDF on this
     * computer. A file that only looks right is not ready.
     */
    private renderCheckStep(panel: HTMLElement): void {
        const candidate = this.candidate;
        const check = this.check;
        const ready = Boolean(candidate?.canActivate) && check.state === 'passed';
        let description = t('ui.importTemplateModal.chooseFileFirst');
        let notes: string[] = [];
        let latexLines: string[] = [];
        if (candidate && !candidate.canActivate) {
            // The file itself is the problem; each message says what to do.
            description = t('ui.importTemplateModal.checkStatusBlocked');
            notes = candidate.issues.slice(0, 4).map(issue => issue.message);
        } else if (candidate && check.state === 'failed') {
            // A font or package this computer lacks is named outright; it is
            // the commonest reason a good template stops, and the fix is not
            // in the template.
            description = check.reason === 'tools' ? t('ui.importTemplateModal.checkStatusTools')
                : check.cause?.kind === 'font' ? t('ui.importTemplateModal.checkStatusMissingFont', { name: fontNameWithSpelling(check.cause.name) })
                : check.cause?.kind === 'package' ? t('ui.importTemplateModal.checkStatusMissingPackage', { name: check.cause.name })
                : t('ui.importTemplateModal.checkStatusFailed');
            latexLines = check.reason === 'latex' ? check.latexLines : [];
            if (latexLines.length > 0) notes = [t('ui.importTemplateModal.latexSaid')];
        } else if (ready) {
            description = t('ui.importTemplateModal.checkStatusReady');
        }
        this.renderStepHero(panel, {
            icon: ready ? 'badge-check' : 'octagon-alert',
            title: t('ui.importTemplateModal.checkTitle'),
            description,
            tone: ready ? 'ready' : 'blocked',
            statusLabel: !candidate ? undefined : ready ? t('ui.importTemplateModal.statusReady') : t('ui.importTemplateModal.statusBlocked'),
            notes,
            latexLines,
        });

        if (ready) this.renderFactsWithPage(panel, this.getFactRows());
    }

    private renderSetupStep(panel: HTMLElement): void {
        this.renderStepHero(panel, {
            icon: 'sliders-horizontal',
            title: t('ui.importTemplateModal.setupTitle'),
            description: t('ui.importTemplateModal.setupDesc'),
        });

        const grid = panel.createDiv({ cls: 'ert-gridForm ert-gridForm--2' });

        const nameCell = grid.createDiv({ cls: 'ert-gridForm__cell' });
        nameCell.createDiv({ cls: 'ert-label', text: t('ui.importTemplateModal.nameLabel') });
        const nameInput = nameCell.createEl('input', {
            cls: 'ert-input ert-input--full',
            attr: { type: 'text', value: this.templateName },
        });
        nameInput.addEventListener('input', () => {
            this.templateNameTouched = true;
            this.templateName = nameInput.value;
        });

        // Which manuscript preset lists this style in the export dialog.
        const usageCell = grid.createDiv({ cls: 'ert-gridForm__cell' });
        usageCell.createDiv({ cls: 'ert-label', text: t('ui.importTemplateModal.usageLabel') });
        this.usageDropdown = new DropdownComponent(usageCell);
        this.usageDropdown.addOption('novel', t('ui.importTemplateModal.usageNovel'));
        this.usageDropdown.addOption('screenplay', t('ui.importTemplateModal.usageScreenplay'));
        this.usageDropdown.addOption('podcast', t('ui.importTemplateModal.usagePodcast'));
        this.usageDropdown.setValue(this.usageContext);
        this.usageDropdown.onChange((value) => {
            this.usageContext = value as UsageContext;
        });

        const descriptionCell = panel.createDiv({ cls: 'ert-import-template-descriptionCell' });
        descriptionCell.createDiv({ cls: 'ert-label', text: t('ui.importTemplateModal.descriptionLabel') });
        const descriptionInput = descriptionCell.createEl('textarea', {
            cls: 'ert-textarea ert-textarea--compact ert-import-template-descriptionInput',
            attr: { rows: '2' },
        });
        descriptionInput.value = this.templateDescription;
        descriptionInput.addEventListener('input', () => {
            this.templateDescriptionTouched = true;
            this.templateDescription = descriptionInput.value;
        });
    }

    private renderSaveStep(panel: HTMLElement): void {
        const candidate = this.candidate;
        const summary = panel.createDiv({ cls: 'ert-card ert-import-template-summary ert-stack ert-stack--tight' });
        summary.createDiv({ cls: 'ert-card__header', text: t('ui.importTemplateModal.finalSummary') });
        if (!candidate) return;

        const layout = this.buildFinalLayout(candidate);
        this.renderFactsWithPage(summary, [
            { label: t('ui.importTemplateModal.nameLabel'), value: layout.name },
            { label: t('ui.importTemplateModal.usageLabel'), value: this.formatUsageContext(layout.preset) },
            { label: t('ui.importTemplateModal.fileLabel'), value: this.getCandidatePath() },
            ...(layout.description ? [{ label: t('ui.importTemplateModal.descriptionLabel'), value: layout.description }] : []),
            ...this.getFactRows(layout.path),
        ]);
    }

    private formatUsageContext(context: UsageContext): string {
        switch (context) {
            case 'screenplay':
                return t('ui.importTemplateModal.usageScreenplay');
            case 'podcast':
                return t('ui.importTemplateModal.usagePodcast');
            default:
                return t('ui.importTemplateModal.usageNovel');
        }
    }

    private getStepRailIcon(step: number): string {
        switch (step) {
            case 1:
                return 'scroll-text';
            case 2:
                return 'check-circle';
            case 3:
                return 'sliders-horizontal';
            case 4:
                return 'save';
            default:
                return 'circle';
        }
    }

    private getSelectedTemplateTitle(): string {
        const targetPath = this.getCandidatePath().trim();
        if (!targetPath) return t('ui.importTemplateModal.chooseTemplate');
        const segments = targetPath.split(/[\\/]/).filter(Boolean);
        return segments.length > 0 ? segments[segments.length - 1] : targetPath;
    }

    private updateActionButtons(): void {
        this.backButton?.setDisabled(this.step === 1 || this.commitInFlight);
        this.nextButton?.setDisabled(this.commitInFlight || !this.canAdvanceToNextStep());
        this.nextButton?.buttonEl.classList.toggle('is-ready', this.step < 4 && this.canAdvanceToNextStep());
        this.cancelButton?.setDisabled(this.commitInFlight);
        this.saveButton?.setDisabled(this.commitInFlight || !this.canAdvanceToNextStep());
    }
}
