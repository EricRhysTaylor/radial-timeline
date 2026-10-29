import { setAccessibleLabel, withAccessibleLabel, withTooltip } from '../../utils/domTooltip';
import { App, Component, setIcon, TFile } from 'obsidian';
import type { InquiryBriefModel } from '../types/inquiryViewTypes';
import type { InquiryStaleDiagnosis } from '../state';
import { openOrRevealFile, openOrRevealFileAtSubpath, openOrRevealFileByPath } from '../../utils/fileUtils';
import { getEmbeddedAssetDataUri } from '../../utils/embeddedAssets';
import { escapeRegExp } from '../../utils/regex';
import { t, tCount } from '../../i18n';

/** Everything a briefing article needs, whether it shows in the modal or the side panel. */
export type InquiryBriefingPayload = {
    brief: InquiryBriefModel;
    briefFile: TFile;
    generatedAt: number | string | null;
    focusAnchorId: string | null;
    isCorpusStale: boolean;
    staleDiagnosis: InquiryStaleDiagnosis | null;
};

/** The header icon that moves the briefing between the modal and the side panel. */
export type InquiryBriefingLayoutAction = {
    icon: string;
    label: string;
    run: () => void;
};

type InquiryBriefingHost = {
    /** The host's `ert-briefing-theme-root` element; the article sets its light/dark attribute. */
    themeRoot: HTMLElement;
    /** Runs after a link opens a note: the modal closes, the side panel stays. */
    afterNavigate: () => void;
    layoutAction: InquiryBriefingLayoutAction;
};

const ARTICLE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
});

/**
 * Renders an Inquiry briefing article into a surface element. The modal and the
 * side panel are both thin hosts around this one renderer; as a Component, its
 * listeners, observer and frames are released when the host unloads it.
 */
export class InquiryBriefingArticle extends Component {
    private readonly brief: InquiryBriefModel;
    private readonly briefFile: TFile;
    private readonly generatedAt: number | string | null;
    private readonly focusAnchorId: string | null;
    private readonly isCorpusStale: boolean;
    private readonly staleDiagnosis: InquiryStaleDiagnosis | null;
    private readonly sceneReferenceEntries: Array<{ label: string; anchorId?: string }>;

    constructor(
        private readonly app: App,
        private readonly surface: HTMLElement,
        payload: InquiryBriefingPayload,
        private readonly host: InquiryBriefingHost
    ) {
        super();
        this.brief = payload.brief;
        this.briefFile = payload.briefFile;
        this.generatedAt = payload.generatedAt;
        this.focusAnchorId = payload.focusAnchorId;
        this.isCorpusStale = payload.isCorpusStale;
        this.staleDiagnosis = payload.staleDiagnosis;
        this.sceneReferenceEntries = [...(this.brief.sceneReferences || [])].sort((a, b) => b.label.length - a.label.length);
    }

    onload(): void {
        this.surface.empty();
        this.surface.addClass('ert-briefing-surface');
        this.applyTheme();
        this.installThemeObserver();

        const shell = this.surface.createDiv({ cls: 'ert-briefing-shell' });
        this.renderHeader(shell);
        this.renderHero(shell);
        this.renderSummary(shell);
        this.renderFindings(shell);
        this.renderSources(shell);
        this.renderSceneNotes(shell);
        this.renderPendingActions(shell);
        this.renderRawResponse(shell);
        const focusFrame = window.requestAnimationFrame(() => this.focusRequestedAnchor());
        this.register(() => { window.cancelAnimationFrame(focusFrame); });
    }

    onunload(): void {
        this.surface.empty();
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createEl('header', { cls: 'ert-briefing-header' });
        const brand = header.createDiv({ cls: 'ert-briefing-brand' });
        const logoHref = this.resolveLogoHref();
        if (logoHref) {
            brand.createEl('img', {
                cls: 'ert-briefing-brand-logo',
                attr: {
                    src: logoHref,
                    alt: 'Radial Timeline'
                }
            });
        } else {
            brand.createDiv({ cls: 'ert-briefing-brand-mark', text: 'RT' });
        }

        const brandText = brand.createDiv({ cls: 'ert-briefing-brand-text' });
        brandText.createDiv({ cls: 'ert-briefing-brand-name', text: 'Radial Timeline' });
        brandText.createDiv({ cls: 'ert-briefing-brand-subline', text: t('ui.inquiryBriefingModal.brandSubline') });

        const actions = header.createDiv({ cls: 'ert-briefing-actions' });
        const layoutAction = this.host.layoutAction;
        const layoutButton = withTooltip(withAccessibleLabel(actions.createEl('button', {
            cls: 'ert-briefing-action ert-briefing-action--icon'
        }), layoutAction.label), layoutAction.label);
        setIcon(layoutButton, layoutAction.icon);
        this.registerDomEvent(layoutButton, 'click', () => {
            layoutAction.run();
        });
        const pdfAction = actions.createEl('button', {
            cls: 'ert-briefing-action',
            text: t('ui.inquiryBriefingModal.savePdf')
        });
        this.registerDomEvent(pdfAction, 'click', () => {
            this.printBriefing();
        });
        const noteAction = actions.createEl('button', {
            cls: 'ert-briefing-action',
            text: t('ui.inquiryBriefingModal.openMarkdown')
        });
        this.registerDomEvent(noteAction, 'click', () => {
            void this.openFileFromBriefing(this.briefFile);
        });
    }

    private renderHero(container: HTMLElement): void {
        const hero = container.createEl('section', { cls: 'ert-briefing-hero' });
        hero.createDiv({ cls: 'ert-briefing-kicker', text: t('ui.inquiryBriefingModal.kicker') });
        const context = this.brief.questionTitle?.trim();
        if (context && context.toLowerCase() !== 'briefing') {
            hero.createDiv({ cls: 'ert-briefing-context', text: context });
        }
        hero.createEl('h1', {
            cls: 'ert-briefing-title',
            text: this.brief.questionText?.trim() || t('ui.inquiryBriefingModal.questionUnavailable')
        });

        const meta = hero.createDiv({ cls: 'ert-briefing-meta' });
        const primaryMeta = [
            this.formatGeneratedAt(),
            this.brief.scopeIndicator ? t('ui.inquiryBriefingModal.scopeIndicator', { scope: this.brief.scopeIndicator }) : '',
        ].filter(Boolean);
        if (primaryMeta.length) {
            const primaryLine = meta.createDiv({ cls: 'ert-briefing-meta-line', text: primaryMeta.join(' · ') });
            if (this.isCorpusStale) {
                primaryLine.appendText(' · ');
                const labelText = this.staleDiagnosis
                    ? t('ui.inquiryBriefingModal.staleBadgeWithLabel', { label: this.staleDiagnosis.shortLabel.toUpperCase() })
                    : t('ui.inquiryBriefingModal.staleBadge');
                const tooltip = this.staleDiagnosis?.tooltipLines.length
                    ? t('ui.inquiryBriefingModal.staleTooltipWithLines', { lines: this.staleDiagnosis.tooltipLines.join('\n') })
                    : t('ui.inquiryBriefingModal.staleTooltip');
                withTooltip(primaryLine.createSpan({
                    cls: 'ert-briefing-stale-badge',
                    text: labelText,
                }), tooltip);
            }
        }
        if (this.brief.pills.length) {
            meta.createDiv({ cls: 'ert-briefing-meta-line ert-briefing-meta-line--secondary', text: this.brief.pills.join(' · ') });
        }
        if (this.isCorpusStale && this.staleDiagnosis?.tooltipLines.length) {
            const detail = meta.createDiv({ cls: 'ert-briefing-meta-line ert-briefing-stale-detail' });
            detail.setText(this.staleDiagnosis.tooltipLines.join(' · '));
        }
    }

    private renderSummary(container: HTMLElement): void {
        const section = this.createSection(container, t('ui.inquiryBriefingModal.summarySection'));
        const summaryStack = section.createDiv({ cls: 'ert-briefing-summary-stack' });

        const summaryEntries = this.brief.mode === 'depth'
            ? [
                { label: t('ui.inquiryBriefingModal.depthLabel'), text: this.brief.depthSummary || t('ui.inquiryBriefingModal.noDepthSummary') },
                { label: t('ui.inquiryBriefingModal.flowLabel'), text: this.brief.flowSummary || t('ui.inquiryBriefingModal.noFlowSummary') }
            ]
            : [
                { label: t('ui.inquiryBriefingModal.flowLabel'), text: this.brief.flowSummary || t('ui.inquiryBriefingModal.noFlowSummary') },
                { label: t('ui.inquiryBriefingModal.depthLabel'), text: this.brief.depthSummary || t('ui.inquiryBriefingModal.noDepthSummary') }
            ];

        summaryEntries
            .filter((entry, index, entries) => index === 0 || entry.text !== entries[0].text)
            .forEach((entry, index) => {
                const block = summaryStack.createEl('article', {
                    cls: index === 0
                        ? 'ert-briefing-block ert-briefing-block--lead ert-briefing-summary-block'
                        : 'ert-briefing-block ert-briefing-summary-block'
                });
                block.createDiv({ cls: 'ert-briefing-summary-label', text: entry.label });
                this.renderTextElement(block, 'p', 'ert-briefing-paragraph ert-briefing-summary-text', entry.text);
            });
    }

    private renderFindings(container: HTMLElement): void {
        // No outer "Findings" label — the "Primary Findings" group label heads
        // this section, so a section header would be redundant.
        const section = this.createSection(container);
        const targetFindings = this.brief.findings.filter(finding => finding.role === 'target');
        const contextFindings = this.brief.findings.filter(finding => finding.role !== 'target');

        this.renderFindingGroup(section, t('inquiry.findings.targetSection'), targetFindings);
        this.renderFindingGroup(section, t('inquiry.findings.contextSection'), contextFindings);
    }

    private renderSources(container: HTMLElement): void {
        if (!this.brief.sources.length) return;
        const section = this.createSection(container, t('ui.inquiryBriefingModal.sourcesSection'));
        const list = section.createDiv({ cls: 'ert-briefing-stack' });
        this.brief.sources.forEach(source => {
            const item = list.createEl('article', { cls: 'ert-briefing-block ert-briefing-source' });
            const titleRow = item.createDiv({ cls: 'ert-briefing-source-header' });
            const title = source.title?.trim() || t('ui.inquiryBriefingModal.untitledSource');

            if (source.path) {
                const link = titleRow.createEl('a', {
                    cls: 'ert-briefing-source-title ert-briefing-link',
                    href: '#'
                });
                link.createSpan({ cls: 'ert-briefing-link-label', text: title });
                this.registerDomEvent(link, 'click', event => {
                    event.preventDefault();
                    void this.openPathFromBriefing(source.path as string);
                });
            } else if (source.url) {
                const link = titleRow.createEl('a', {
                    cls: 'ert-briefing-source-title ert-briefing-link',
                    href: source.url,
                    attr: {
                        target: '_blank',
                        rel: 'noopener'
                    }
                });
                link.createSpan({ cls: 'ert-briefing-link-label', text: title });
            } else {
                titleRow.createDiv({ cls: 'ert-briefing-source-title', text: title });
            }

            const metaParts = [
                source.classLabel?.trim() || '',
                Number.isFinite(source.citationCount) && (source.citationCount ?? 0) > 0
                    ? tCount('citation', source.citationCount ?? 0)
                    : ''
            ].filter(Boolean);
            if (metaParts.length) {
                item.createDiv({ cls: 'ert-briefing-source-meta', text: metaParts.join(' · ') });
            }
            if (source.excerpt?.trim()) {
                this.renderTextElement(item, 'p', 'ert-briefing-paragraph ert-briefing-source-excerpt', source.excerpt.trim());
            }
        });
    }

    private renderSceneNotes(container: HTMLElement): void {
        if (!this.brief.sceneNotes.length) return;
        const section = this.createSection(container, t('ui.inquiryBriefingModal.sceneNotesSection'));
        const notes = section.createDiv({ cls: 'ert-briefing-stack' });

        this.brief.sceneNotes.forEach(note => {
            const article = notes.createEl('article', {
                cls: 'ert-briefing-block ert-briefing-note',
                attr: note.anchorId ? { 'data-rt-brief-anchor': note.anchorId } : undefined
            });
            const labelRow = article.createDiv({ cls: 'ert-briefing-note-label-row' });
            labelRow.createDiv({ cls: 'ert-briefing-note-label', text: note.header });
            if (note.anchorId) {
                const anchorAction = withTooltip(withAccessibleLabel(labelRow.createEl('a', {
                    cls: 'ert-briefing-note-link',
                    text: '↗',
                    attr: { href: '#' }
                }), t('ui.inquiryBriefingModal.openNoteInBriefAria', { header: note.header })), t('ui.inquiryBriefingModal.openInBriefTitle'));
                this.registerDomEvent(anchorAction, 'click', (event) => {
                    event.preventDefault();
                    void this.openSubpathFromBriefing(this.briefFile, `#^${note.anchorId}`);
                });
            }

            note.entries.forEach(entry => {
                const entryBlock = article.createDiv({ cls: 'ert-briefing-note-entry' });
                this.renderTextElement(entryBlock, 'h3', 'ert-briefing-finding-title', entry.headline, 'headline');
                if (entry.lens) {
                    entryBlock.createDiv({
                        cls: 'ert-briefing-finding-meta',
                        text: entry.lens
                    });
                }
                entry.bullets.forEach(bullet => {
                    this.renderTextElement(entryBlock, 'p', 'ert-briefing-paragraph', bullet);
                });
            });
        });
    }

    private renderPendingActions(container: HTMLElement): void {
        if (!this.brief.pendingActions.length) return;
        const section = this.createSection(container, t('ui.inquiryBriefingModal.actionItemsSection'));
        const list = section.createEl('ol', { cls: 'ert-briefing-action-list' });
        this.brief.pendingActions.forEach(action => {
            const item = list.createEl('li', { cls: 'ert-briefing-action-item' });
            if (action.targetLabel) {
                item.createSpan({ cls: 'ert-briefing-action-pill', text: action.targetLabel });
            }
            this.renderTextElement(item, 'span', 'ert-briefing-action-text', action.text);
        });
    }

    private renderRawResponse(container: HTMLElement): void {
        if (!this.brief.rawResponse?.trim()) return;
        const section = this.createSection(container, t('ui.inquiryBriefingModal.providerResponseSection'));
        section.createEl('pre', {
            cls: 'ert-briefing-raw',
            text: this.brief.rawResponse.trim()
        });
    }

    private renderFindingGroup(container: HTMLElement, label: string, findings: InquiryBriefModel['findings']): void {
        if (!findings.length) return;
        const group = container.createDiv({ cls: 'ert-briefing-group' });
        group.createDiv({ cls: 'ert-briefing-group-label', text: label });
        findings.forEach(finding => {
            const card = group.createEl('article', { cls: 'ert-briefing-block ert-briefing-finding' });
            if (finding.sceneLabel) {
                card.createDiv({
                    cls: 'ert-briefing-group-label',
                    text: finding.sceneLabel
                });
            }
            this.renderTextElement(card, 'h3', 'ert-briefing-finding-title', finding.headline, 'headline');
            if (finding.lens) {
                card.createDiv({
                    cls: 'ert-briefing-finding-meta',
                    text: finding.lens
                });
            }
            if (finding.bullets.length) {
                finding.bullets.forEach(bullet => {
                    this.renderTextElement(card, 'p', 'ert-briefing-paragraph', bullet);
                });
            }
        });
    }

    private createSection(container: HTMLElement, label?: string): HTMLElement {
        const section = container.createEl('section', { cls: 'ert-briefing-section' });
        // Label optional: the Findings section omits it because its first group
        // label ("Primary Findings") already heads the area — an outer
        // "Findings" header would just stack two near-identical labels.
        if (label) {
            section.createDiv({ cls: 'ert-briefing-section-label', text: label });
        }
        return section;
    }

    private formatGeneratedAt(): string {
        const normalized = this.resolveGeneratedAt();
        if (!normalized) return '';
        return t('ui.inquiryBriefingModal.generatedAt', { date: ARTICLE_DATE_FORMAT.format(normalized) });
    }

    private resolveGeneratedAt(): Date | null {
        if (typeof this.generatedAt === 'number' && Number.isFinite(this.generatedAt)) {
            return new Date(this.generatedAt);
        }
        if (typeof this.generatedAt === 'string' && this.generatedAt.trim()) {
            const parsed = new Date(this.generatedAt);
            if (!Number.isNaN(parsed.getTime())) return parsed;
        }
        return null;
    }

    private resolveLogoHref(): string | null {
        // Embedded in main.js, not read from the plugin folder: Obsidian
        // installs only manifest.json/main.js/styles.css from a release, so a
        // plugin-folder path resolves to nothing for anyone who installed
        // through the Community Plugins browser.
        return getEmbeddedAssetDataUri('images/rt-logo.png');
    }

    private installThemeObserver(): void {
        const themeObserver = new MutationObserver(() => {
            this.applyTheme();
        });
        themeObserver.observe(this.host.themeRoot.ownerDocument.body, {
            attributes: true,
            attributeFilter: ['class']
        });
        this.register(() => themeObserver.disconnect());
    }

    private resolveEffectiveTheme(): 'dark' | 'light' {
        return this.host.themeRoot.ownerDocument.body.classList.contains('theme-dark') ? 'dark' : 'light';
    }

    private applyTheme(): void {
        const effectiveTheme = this.resolveEffectiveTheme();
        this.host.themeRoot.setAttribute('data-ert-briefing-theme', effectiveTheme);
    }

    private renderTextElement(
        container: HTMLElement,
        tag: keyof HTMLElementTagNameMap,
        cls: string,
        text: string,
        sceneRefStyle: 'callout' | 'headline' = 'callout'
    ): HTMLElement {
        const el = container.createEl(tag, cls ? { cls } : undefined);
        this.appendSceneReferenceMarkup(el, text, sceneRefStyle);
        return el;
    }

    private appendSceneReferenceMarkup(container: HTMLElement, text: string, sceneRefStyle: 'callout' | 'headline'): void {
        const content = text || '';
        if (!content) return;
        if (!this.sceneReferenceEntries.length) {
            this.appendStyledPlainText(container, content, sceneRefStyle);
            return;
        }

        const regex = new RegExp(this.sceneReferenceEntries.map(entry => this.escapeRegExp(entry.label)).join('|'), 'g');
        let cursor = 0;
        let match: RegExpExecArray | null = regex.exec(content);
        while (match) {
            const [label] = match;
            const index = match.index;
            if (index > cursor) {
                this.appendStyledPlainText(container, content.slice(cursor, index), sceneRefStyle);
            }
            const ref = this.sceneReferenceEntries.find(entry => entry.label === label);
            container.append(this.buildSceneReferenceNode(label, ref?.anchorId, sceneRefStyle));
            cursor = index + label.length;
            match = regex.exec(content);
        }
        if (cursor < content.length) {
            this.appendStyledPlainText(container, content.slice(cursor), sceneRefStyle);
        }
    }

    private appendStyledPlainText(container: HTMLElement, text: string, sceneRefStyle: 'callout' | 'headline'): void {
        const content = text || '';
        if (!content) return;
        const regex = /"[^"\n]+"|(?<!\w)'[^'\n]+'(?!\w)|\bscn_[a-z0-9]+\b/gi;
        let cursor = 0;
        let match: RegExpExecArray | null = regex.exec(content);
        while (match) {
            const token = match[0];
            const index = match.index;
            if (index > cursor) {
                container.appendText(content.slice(cursor, index));
            }
            if (/^scn_/i.test(token)) {
                container.append(this.buildUnresolvedSceneReferenceNode(token, sceneRefStyle));
            } else if (token.startsWith('"')) {
                container.append(this.buildQuoteNode(token, 'double'));
            } else {
                container.append(this.buildQuoteNode(token, 'single'));
            }
            cursor = index + token.length;
            match = regex.exec(content);
        }
        if (cursor < content.length) {
            container.appendText(content.slice(cursor));
        }
    }

    private buildSceneReferenceNode(label: string, anchorId?: string, style: 'callout' | 'headline' = 'callout'): HTMLElement {
        const doc = this.surface.ownerDocument;
        if (style === 'headline') {
            const textEl = doc.win.createSpan();
            textEl.className = 'ert-briefing-scene-inline';
            textEl.textContent = label;
            return textEl;
        }
        const [numberPart, ...titleParts] = label.split(' ');
        const titlePart = titleParts.join(' ').trim();
        const interactive = !!anchorId;
        const el = doc.win.createEl(interactive ? 'a' : 'span');
        el.className = 'ert-briefing-scene-ref';
        if (interactive && el instanceof HTMLAnchorElement) {
            el.href = '#';
            this.registerDomEvent(el, 'click', (event) => {
                event.preventDefault();
                this.scrollToSceneReference(anchorId);
            });
            setAccessibleLabel(el, t('ui.inquiryBriefingModal.jumpToAria', { label }));
        }
        const numberEl = doc.win.createSpan();
        numberEl.className = 'ert-briefing-scene-ref-num';
        numberEl.textContent = numberPart;
        el.append(numberEl);
        if (titlePart) {
            const titleEl = doc.win.createSpan();
            titleEl.className = 'ert-briefing-scene-ref-title';
            titleEl.textContent = titlePart;
            el.append(titleEl);
        }
        return el;
    }

    private buildUnresolvedSceneReferenceNode(rawRef: string, style: 'callout' | 'headline' = 'callout'): HTMLElement {
        const doc = this.surface.ownerDocument;
        if (style === 'headline') {
            const textEl = doc.win.createSpan();
            textEl.className = 'ert-briefing-scene-inline ert-briefing-scene-inline--unresolved';
            textEl.textContent = rawRef;
            return textEl;
        }
        const el = doc.win.createSpan();
        el.className = 'ert-briefing-scene-ref ert-briefing-scene-ref--unresolved';
        const textEl = doc.win.createSpan();
        textEl.className = 'ert-briefing-scene-ref-title';
        textEl.textContent = rawRef;
        el.append(textEl);
        return el;
    }

    private buildQuoteNode(text: string, mode: 'single' | 'double'): HTMLElement {
        const el = this.surface.ownerDocument.win.createSpan();
        el.className = `ert-briefing-quote ert-briefing-quote--${mode}`;
        el.textContent = text;
        return el;
    }

    private scrollToSceneReference(anchorId?: string): void {
        if (!anchorId) return;
        this.focusAnchorIdInternal(anchorId);
    }

    private focusAnchorIdInternal(anchorId: string): void {
        const notes = Array.from(this.surface.querySelectorAll<HTMLElement>('.ert-briefing-note[data-rt-brief-anchor]'));
        const target = notes.find(note => note.getAttribute('data-rt-brief-anchor') === anchorId);
        if (!target) return;
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        target.classList.add('is-focus-target');
        window.setTimeout(() => {
            target.classList.remove('is-focus-target');
        }, 1600);
    }

    private printBriefing(): void {
        const doc = this.surface.ownerDocument;
        const previousTitle = doc.title;
        const nextTitle = this.resolvePrintTitle();
        const printHost = this.createPrintHost();
        let restored = false;
        const restore = (): void => {
            if (restored) return;
            restored = true;
            doc.title = previousTitle;
            printHost.remove();
            printMedia?.removeEventListener?.('change', mediaListener);
        };

        const printMedia = typeof window.matchMedia === 'function'
            ? window.matchMedia('print')
            : null;
        const mediaListener = (event: MediaQueryListEvent): void => {
            if (!event.matches) restore();
        };

        doc.title = nextTitle;
        doc.body.appendChild(printHost);
        // restore is idempotent, so it also runs safely if the host unloads mid-print.
        this.registerDomEvent(window, 'afterprint', restore);
        this.register(restore);
        printMedia?.addEventListener?.('change', mediaListener);
        const outerFrame = window.requestAnimationFrame(() => {
            const printFrame = window.requestAnimationFrame(() => {
                window.print();
            });
            this.register(() => { window.cancelAnimationFrame(printFrame); });
        });
        this.register(() => { window.cancelAnimationFrame(outerFrame); });
    }

    private createPrintHost(): HTMLElement {
        const host = this.surface.ownerDocument.win.createDiv();
        host.className = 'print ert-briefing-print-root';
        host.setAttribute('aria-hidden', 'true');

        const article = this.surface.cloneNode(true) as HTMLElement;
        host.appendChild(article);
        return host;
    }

    private async openFileFromBriefing(file: TFile): Promise<void> {
        await openOrRevealFile(this.app, file);
        this.host.afterNavigate();
    }

    private async openPathFromBriefing(path: string): Promise<void> {
        await openOrRevealFileByPath(this.app, path);
        this.host.afterNavigate();
    }

    private async openSubpathFromBriefing(file: TFile, subpath: string): Promise<void> {
        await openOrRevealFileAtSubpath(this.app, file, subpath);
        this.host.afterNavigate();
    }

    private escapeRegExp(value: string): string {
        return escapeRegExp(value);
    }

    private focusRequestedAnchor(): void {
        if (!this.focusAnchorId) return;
        this.focusAnchorIdInternal(this.focusAnchorId);
    }

    private resolvePrintTitle(): string {
        return this.briefFile.basename;
    }
}
