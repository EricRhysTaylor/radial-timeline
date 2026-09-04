import { App, ButtonComponent, DropdownComponent, Modal, Notice, SuggestModal, TFile, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { ImportedTemplateCandidate } from '../utils/templateImport';
import { buildImportedTemplateCandidate, buildImportedTemplateId, compactTemplatePathForStorage } from '../utils/templateImport';
import type { PandocLayoutTemplate, UsageContext } from '../types';
import type { DetectedTemplateConfidence, DetectedTemplateMockPreviewKind, DetectedTemplateStyleHint } from '../publishing/templateDetection';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { scheduleClassAfterPaint } from '../utils/domClassEffects';

type ImportTemplateStep = 1 | 2 | 3 | 4;

export interface ImportedTemplateCommit {
    layout: PandocLayoutTemplate;
    draft: boolean;
    activate: boolean;
    candidate: ImportedTemplateCandidate;
}

class TemplateFileSuggestModal extends SuggestModal<TFile> {
    private readonly onChooseFile: (path: string) => void;
    private readonly itemCache = new WeakMap<HTMLElement, { row: HTMLDivElement; title: HTMLDivElement; desc: HTMLDivElement }>();

    constructor(app: App, onChooseFile: (path: string) => void) {
        super(app);
        this.onChooseFile = onChooseFile;
        this.limit = 40;
        this.emptyStateText = 'No LaTeX templates found.';
    }

    onOpen(): void {
        void super.onOpen();
        this.modalEl.addClass('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md', 'ert-modal--template-pack', 'ert-modal--search');
        this.modalEl.removeClass('is-ui-settled');
        scheduleClassAfterPaint(this.modalEl, 'is-ui-settled');
        this.contentEl.addClass('ert-modal-container', 'ert-search-modal', 'ert-search-modal--with-results', 'ert-stack', 'ert-template-search-modal');
        this.resultContainerEl.addClass('ert-template-search-results');
        this.setPlaceholder('Search LaTeX templates');
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
    private sourceContentOverride: string | null = null;
    private usageContext: UsageContext = 'novel';
    private usageContextTouched = false;
    private templateName = '';
    private templateNameTouched = false;
    private templateDescription = '';
    private templateDescriptionTouched = false;
    private candidate: ImportedTemplateCandidate | null = null;
    private candidateLoading = false;
    private commitInFlight = false;
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
        this.sourceContentOverride = null;
        this.usageContext = 'novel';
        this.usageContextTouched = false;
        this.templateName = '';
        this.templateNameTouched = false;
        this.templateDescription = '';
        this.templateDescriptionTouched = false;
        this.candidate = null;
        this.candidateLoading = false;
        this.commitInFlight = false;
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
        header.createSpan({ cls: 'ert-modal-badge', text: 'IMPORT' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Import template' });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Bring an existing LaTeX template (.tex) into Publishing as a static custom layout. Use this when you have hand-tuned LaTeX or a third-party template the wizard\'s spec can\'t express. For visual, wizard-editable styles, close this and use "Design your own…" instead.',
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

    private resolveExistingIds(): Set<string> {
        return new Set((this.plugin.settings.pandocLayouts || []).map(layout => layout.id));
    }

    private async refreshCandidate(): Promise<void> {
        const sourcePath = this.getCandidatePath();
        const requestToken = ++this.candidateRequestToken;
        if (!sourcePath) {
            this.candidate = null;
            this.candidateLoading = false;
            this.render();
            return;
        }

        this.candidateLoading = true;
        this.render();

        try {
            const candidate = await buildImportedTemplateCandidate(this.plugin, {
                sourcePath,
                sourceContent: this.sourceContentOverride || undefined,
                name: this.getCandidateName(),
                preset: this.usageContextTouched ? this.usageContext : undefined,
                description: this.getCandidateDescription(),
                origin: 'imported',
            });
            if (requestToken !== this.candidateRequestToken) return;

            if (!this.usageContextTouched) {
                this.usageContext = candidate.layout.preset;
            }
            if (!this.templateNameTouched) {
                this.templateName = candidate.layout.name;
            }
            if (!this.templateDescriptionTouched) {
                this.templateDescription = candidate.layout.description || '';
            }
            this.candidate = candidate;
        } catch (error) {
            if (requestToken !== this.candidateRequestToken) return;
            this.candidate = null;
            console.error(error);
        } finally {
            if (requestToken === this.candidateRequestToken) {
                this.candidateLoading = false;
                this.render();
            }
        }
    }

    private async chooseFile(): Promise<void> {
        new TemplateFileSuggestModal(this.app, (selectedPath) => {
            this.sourcePath = selectedPath;
            this.sourceContentOverride = null;
            void this.refreshCandidate();
        }).open();
    }

    private async handleDroppedTemplate(files: FileList | null): Promise<void> {
        const dropped = files?.[0];
        if (!dropped) return;

        const filePath = (dropped as File & { path?: string }).path?.trim() || '';
        const fileName = dropped.name || filePath.split(/[\\/]/).pop() || '';
        if (!/\.(tex|ltx|latex)$/i.test(fileName)) {
            new Notice('Drop a .tex template file to import.');
            return;
        }
        if (!filePath) {
            new Notice('Could not read the dropped file path.');
            return;
        }

        try {
            this.sourceContentOverride = await dropped.text();
        } catch {
            this.sourceContentOverride = null;
        }

        this.sourcePath = filePath;
        await this.refreshCandidate();
    }

    private async commit(): Promise<void> {
        if (!this.candidate || this.commitInFlight) return;
        this.commitInFlight = true;
        this.updateActionButtons();

        const existingIds = this.resolveExistingIds();
        const id = buildImportedTemplateId(
            this.candidate.layout.name,
            this.candidate.layout.preset,
            existingIds
        );
        const finalLayout: PandocLayoutTemplate = {
            ...this.candidate.layout,
            id,
            name: this.templateName.trim() || this.candidate.layout.name,
            preset: this.usageContext,
            description: this.templateDescription.trim() || this.candidate.layout.description,
            path: compactTemplatePathForStorage(this.plugin, this.getCandidatePath()) || this.candidate.layout.path.trim(),
            draft: false,
            origin: 'imported',
        };

        try {
            await this.onCommit({
                layout: finalLayout,
                draft: false,
                activate: true,
                candidate: this.candidate,
            });
            this.close();
        } finally {
            this.commitInFlight = false;
            this.updateActionButtons();
        }
    }

    private render(): void {
        if (!this.stepMetaEl || !this.railEl || !this.panelEl || !this.actionsEl) return;
        this.stepMetaEl.setText(`Step ${this.step} of 4`);
        this.panelEl.empty();
        this.updateStepRail();

        const panel = this.panelEl;
        if (this.candidateLoading) {
            this.renderStepHero(panel, {
                icon: 'loader-circle',
                title: 'Checking template',
                description: 'Reviewing the file and gathering a quick profile.',
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
        if (this.step === 1) return Boolean(this.getCandidatePath());
        if (this.step === 2 || this.step === 3) return Boolean(this.candidate);
        return true;
    }

    private createStepRail(): void {
        if (!this.railEl) return;
        const steps = ['Choose', 'Check', 'Set up', 'Save'];
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
            .setButtonText('Back')
            .onClick(() => {
                if (this.step > 1) {
                    this.step = (this.step - 1) as ImportTemplateStep;
                    this.render();
                }
            });
        this.nextButton = new ButtonComponent(this.actionsEl)
            .setButtonText('Next')
            .onClick(() => {
                if (this.step < 4) {
                    this.step = (this.step + 1) as ImportTemplateStep;
                    this.render();
                }
            });
        this.nextButton.buttonEl.addClass('ert-import-template-nextBtn');
        this.saveButton = new ButtonComponent(this.actionsEl)
            .setButtonText('Save template')
            .setCta()
            .onClick(() => void this.commit());
        this.cancelButton = new ButtonComponent(this.actionsEl)
            .setButtonText('Cancel')
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
            icon?: string;
            previewKind?: DetectedTemplateMockPreviewKind;
            title: string;
            description: string;
            tone?: 'ready' | 'attention' | 'blocked';
            statusLabel?: string;
            notes?: string[];
        }
    ): void {
        const hero = panel.createDiv({
            cls: `ert-import-template-stepHero${options.tone ? ` ert-import-template-stepHero--${options.tone}` : ''}`,
        });
        const visual = hero.createDiv({ cls: 'ert-import-template-stepHero-visual' });

        if (options.previewKind) {
            this.renderMockPreview(visual, options.previewKind);
        } else if (options.icon) {
            const iconWrap = visual.createDiv({ cls: 'ert-import-template-stepHero-icon' });
            setIcon(iconWrap, options.icon);
        }

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
            text: this.getCandidatePath() ? 'LaTeX template' : 'Choose a LaTeX template',
        });

        if (this.getCandidatePath()) {
            picker.createDiv({
                cls: 'ert-import-template-picker-meta',
                text: this.getCandidatePath(),
            });
        }
    }

    private renderCheckStep(panel: HTMLElement): void {
        const status = this.candidate?.summary.state || 'ready';
        this.renderStepHero(panel, {
            icon: status === 'blocked' ? 'octagon-alert' : status === 'warning' ? 'triangle-alert' : 'badge-check',
            title: 'Check template',
            description: this.candidate
                ? this.getCheckStatusMessage(this.candidate)
                : 'Choose a template file first.',
            tone: status === 'blocked' ? 'blocked' : status === 'warning' ? 'attention' : 'ready',
            statusLabel: status === 'blocked'
                ? 'Blocked'
                : status === 'warning'
                    ? 'Needs attention'
                    : 'Ready',
            notes: (this.candidate?.issues || []).slice(0, 4).map(issue => this.formatIssueMessage(issue.message)),
        });

        this.renderDetectedLayoutCard(panel);
    }

    private renderSetupStep(panel: HTMLElement): void {
        this.renderStepHero(panel, {
            previewKind: this.candidate?.detectedTemplate.mockPreviewKind || 'generic',
            title: 'Set up template',
            description: 'Name the template and choose where you want to use it.',
        });

        const grid = panel.createDiv({ cls: 'ert-gridForm ert-gridForm--2' });

        const nameCell = grid.createDiv({ cls: 'ert-gridForm__cell' });
        nameCell.createDiv({ cls: 'ert-label', text: 'Name' });
        const nameInput = nameCell.createEl('input', {
            cls: 'ert-input ert-input--full',
            attr: { type: 'text', value: this.templateName },
        });
        nameInput.addEventListener('input', () => {
            this.templateNameTouched = true;
            this.templateName = nameInput.value;
        });

        const usageCell = grid.createDiv({ cls: 'ert-gridForm__cell' });
        usageCell.createDiv({ cls: 'ert-label', text: 'Usage context' });
        this.usageDropdown = new DropdownComponent(usageCell);
        this.usageDropdown.addOption('novel', 'Novel');
        this.usageDropdown.addOption('screenplay', 'Screenplay');
        this.usageDropdown.addOption('podcast', 'Podcast');
        this.usageDropdown.setValue(this.usageContext);
        this.usageDropdown.onChange((value) => {
            this.usageContextTouched = true;
            this.usageContext = value as UsageContext;
        });

        const descriptionCell = panel.createDiv({ cls: 'ert-import-template-descriptionCell' });
        descriptionCell.createDiv({ cls: 'ert-label', text: 'Description' });
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
        summary.createDiv({ cls: 'ert-card__header', text: 'Final summary' });

        const top = summary.createDiv({ cls: 'ert-import-template-summary-top' });
        const details = top.createDiv({ cls: 'ert-import-template-summary-details' });
        const preview = top.createDiv({ cls: 'ert-import-template-summary-preview' });

        this.renderMockPreview(preview, candidate?.detectedTemplate.mockPreviewKind || 'generic', {
            compact: true,
            showLabel: false,
        });

        const rows = [
            { label: 'Name', value: candidate?.profile.name || this.templateName || 'Template' },
            { label: 'Usage', value: this.formatUsageContext(this.usageContext) },
            { label: 'File', value: this.getCandidatePath() || candidate?.layout.path || 'No file selected' },
            { label: 'Description', value: this.templateDescription.trim() || candidate?.layout.description || 'No description added' },
            { label: 'Detected layout', value: candidate ? this.getLikelyLayoutLabel(candidate.detectedTemplate.styleHint) : 'Custom / unknown layout' },
            { label: 'Confidence', value: candidate ? this.formatConfidence(candidate.detectedTemplate.confidence) : 'Low' },
        ];
        rows.forEach((row) => {
            const item = details.createDiv({ cls: 'ert-import-template-summary-row' });
            item.createDiv({ cls: 'ert-import-template-summary-label', text: row.label });
            item.createDiv({ cls: 'ert-import-template-summary-value', text: row.value });
        });

        if ((candidate?.detectedTemplate.traits.length || 0) > 0) {
            const traitSection = summary.createDiv({ cls: 'ert-import-template-summary-traits' });
            traitSection.createDiv({ cls: 'ert-import-template-summary-subtitle', text: 'Detected formatting' });
            const traits = traitSection.createDiv({ cls: 'ert-import-template-traitGrid ert-import-template-traitGrid--summary' });
            this.getVisibleTraitEntries(candidate?.detectedTemplate.traits || []).forEach(({ trait, visual }) => {
                const item = traits.createDiv({ cls: 'ert-import-template-traitTile ert-import-template-traitTile--summary' });
                const iconWrap = item.createDiv({ cls: 'ert-import-template-traitIcon ert-import-template-traitIcon--summary' });
                setIcon(iconWrap, visual.icon);
                item.createDiv({ cls: 'ert-import-template-traitLabel', text: visual.label });
                item.createDiv({ cls: 'ert-import-template-summary-traitText', text: trait });
            });
        }

        if ((candidate?.issues.length || 0) > 0) {
            const issueSection = summary.createDiv({ cls: 'ert-import-template-summary-issues' });
            issueSection.createDiv({ cls: 'ert-import-template-summary-subtitle', text: 'Open items' });
            candidate?.issues.slice(0, 3).forEach(issue => {
                issueSection.createDiv({ cls: 'ert-field-note', text: this.formatIssueMessage(issue.message) });
            });
        }
    }

    private renderDetectedLayoutCard(panel: HTMLElement): void {
        const candidate = this.candidate;
        if (!candidate) return;

        const card = panel.createDiv({ cls: 'ert-card ert-import-template-detected-card ert-stack ert-stack--tight' });
        const meta = card.createDiv({ cls: 'ert-import-template-detected-meta' });
        meta.createDiv({
            cls: 'ert-import-template-detected-line',
            text: `Detected layout: ${this.getLikelyLayoutShortLabel(candidate.detectedTemplate.styleHint)}`,
        });
        meta.createDiv({
            cls: 'ert-import-template-detected-line ert-import-template-detected-line--confidence',
            text: `Confidence: ${this.formatConfidence(candidate.detectedTemplate.confidence)}`,
        });

        if (candidate.detectedTemplate.traits.length > 0) {
            const traits = card.createDiv({ cls: 'ert-import-template-traitGrid' });
            this.getVisibleTraitEntries(candidate.detectedTemplate.traits).forEach(({ trait, visual }) => {
                const item = traits.createDiv({ cls: 'ert-import-template-traitTile' });
                const iconWrap = item.createDiv({ cls: 'ert-import-template-traitIcon' });
                setIcon(iconWrap, visual.icon);
                item.createDiv({ cls: 'ert-import-template-traitLabel', text: visual.label });
                item.createDiv({ cls: 'ert-import-template-summary-traitText', text: trait });
            });
        }
    }

    private renderMockPreview(
        container: HTMLElement,
        kind: DetectedTemplateMockPreviewKind,
        options: { compact?: boolean; showLabel?: boolean } = {},
    ): void {
        const wrap = container.createDiv({ cls: 'ert-import-template-mock-wrap' });
        if (options.compact) {
            wrap.addClass('is-compact');
        }
        if (options.showLabel !== false) {
            wrap.createDiv({ cls: 'ert-import-template-mock-label', text: 'Approximate preview' });
        }

        const mock = wrap.createDiv({ cls: `ert-import-template-mock ert-import-template-mock--${kind}${options.compact ? ' is-compact' : ''}` });
        const page = mock.createDiv({ cls: 'ert-import-template-mock-page' });
        if (kind === 'book' || kind === 'chaptered') {
            page.createDiv({ cls: 'ert-import-template-mock-header-line' });
        }

        const kicker = page.createDiv({ cls: 'ert-import-template-mock-kicker' });
        kicker.setText(kind === 'chaptered' ? 'Chapter opener' : kind === 'literary' ? 'Literary layout' : kind === 'manuscript' ? 'Submission format' : kind === 'book' ? 'Book layout' : 'Custom layout');

        page.createDiv({
            cls: `ert-import-template-mock-title ert-import-template-mock-title--${kind}`,
            text: kind === 'chaptered' ? 'Chapter One' : kind === 'literary' ? 'Winter Light' : kind === 'manuscript' ? 'Manuscript Page' : kind === 'book' ? 'Book Page' : 'Template Preview',
        });

        if (kind === 'literary') {
            page.createDiv({ cls: 'ert-import-template-mock-subtitle', text: 'A quiet opening line' });
        }

        const lines = page.createDiv({ cls: 'ert-import-template-mock-lines' });
        ['',' is-mid','',' is-short','',''].forEach((suffix) => {
            lines.createDiv({ cls: `ert-import-template-mock-line${suffix}`.trim() });
        });
    }

    private getLikelyLayoutLabel(styleHint: DetectedTemplateStyleHint): string {
        switch (styleHint) {
            case 'chaptered':
                return 'Chaptered book layout';
            case 'book':
                return 'Book layout';
            case 'literary':
                return 'Literary book layout';
            case 'manuscript':
                return 'Submission manuscript';
            default:
                return 'Custom / unknown layout';
        }
    }

    private getLikelyLayoutShortLabel(styleHint: DetectedTemplateStyleHint): string {
        switch (styleHint) {
            case 'chaptered':
                return 'Chaptered';
            case 'book':
                return 'Book';
            case 'literary':
                return 'Literary';
            case 'manuscript':
                return 'Manuscript';
            default:
                return 'Custom';
        }
    }

    private describeTraitVisual(trait: string): { icon: string; label: string } {
        const normalized = trait.toLowerCase();
        if (normalized.includes('body hook') || normalized.includes('manuscript')) {
            return { icon: 'book-open-text', label: 'Manuscript' };
        }
        if (normalized.includes('header')) {
            return { icon: 'panel-top', label: 'Header' };
        }
        if (normalized.includes('chapter') || normalized.includes('page structure') || normalized.includes('part')) {
            return { icon: 'book-open', label: 'Structure' };
        }
        if (normalized.includes('typography') || normalized.includes('font')) {
            return { icon: 'type', label: 'Type' };
        }
        if (normalized.includes('margin') || normalized.includes('print layout')) {
            return { icon: 'scan-line', label: 'Layout' };
        }
        if (normalized.includes('metadata') || normalized.includes('front-page')) {
            return { icon: 'badge-info', label: 'Metadata' };
        }
        if (normalized.includes('contents')) {
            return { icon: 'list', label: 'Contents' };
        }
        if (normalized.includes('spacing')) {
            return { icon: 'move-horizontal', label: 'Spacing' };
        }
        if (normalized.includes('scene break')) {
            return { icon: 'separator-horizontal', label: 'Breaks' };
        }
        if (normalized.includes('heading')) {
            return { icon: 'heading', label: 'Headings' };
        }
        if (normalized.includes('dialogue') || normalized.includes('scene')) {
            return { icon: 'message-square', label: 'Dialogue' };
        }
        return { icon: 'file-text', label: 'Custom' };
    }

    private getVisibleTraitEntries(traits: string[]): Array<{ trait: string; visual: { icon: string; label: string } }> {
        const entries: Array<{ trait: string; visual: { icon: string; label: string } }> = [];
        const seenLabels = new Set<string>();
        for (const trait of traits) {
            const visual = this.describeTraitVisual(trait);
            if (seenLabels.has(visual.label)) continue;
            seenLabels.add(visual.label);
            entries.push({ trait, visual });
            if (entries.length >= 5) break;
        }
        return entries;
    }

    private formatConfidence(confidence: DetectedTemplateConfidence): string {
        return confidence.charAt(0).toUpperCase() + confidence.slice(1);
    }

    private formatUsageContext(context: UsageContext): string {
        switch (context) {
            case 'screenplay':
                return 'Screenplay';
            case 'podcast':
                return 'Podcast';
            default:
                return 'Novel';
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
        if (!targetPath) return 'Choose template';
        const segments = targetPath.split(/[\\/]/).filter(Boolean);
        return segments.length > 0 ? segments[segments.length - 1] : targetPath;
    }

    private getCheckStatusMessage(candidate: ImportedTemplateCandidate): string {
        if (candidate.summary.state === 'blocked') {
            return 'This template needs fixes before it can be activated.';
        }
        if (candidate.summary.state === 'warning') {
            return 'This template can be saved now, but it needs a quick review.';
        }
        return 'This template looks ready to use.';
    }

    private formatIssueMessage(message: string): string {
        if (/\$body\$/i.test(message)) {
            return 'The template is missing the main manuscript placeholder.';
        }
        if (/fontspec|xelatex|lualatex/i.test(message)) {
            return 'This template expects a Unicode PDF engine.';
        }
        if (/\.tex/i.test(message) && /import/i.test(message)) {
            return 'Choose a valid .tex template file.';
        }
        return message;
    }

    private updateActionButtons(): void {
        this.backButton?.setDisabled(this.step === 1 || this.commitInFlight);
        this.nextButton?.setDisabled(this.commitInFlight || !this.canAdvanceToNextStep());
        this.nextButton?.buttonEl.classList.toggle('is-ready', this.step < 4 && this.canAdvanceToNextStep());
        this.cancelButton?.setDisabled(this.commitInFlight);
        this.saveButton?.setDisabled(this.commitInFlight || !this.candidate || !this.candidate.canActivate);
    }
}
