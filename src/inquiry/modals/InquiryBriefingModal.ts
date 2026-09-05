import { App, Modal, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { InquiryBriefModel } from '../types/inquiryViewTypes';
import type { InquiryStaleDiagnosis } from '../state';
import { openOrRevealFile, openOrRevealFileAtSubpath, openOrRevealFileByPath } from '../../utils/fileUtils';
import { getEmbeddedAssetDataUri } from '../../utils/embeddedAssets';
import { escapeRegExp } from '../../utils/regex';

type InquiryBriefingModalOptions = {
    brief: InquiryBriefModel;
    plugin: RadialTimelinePlugin;
    briefFile?: TFile | null;
    logFile?: TFile | null;
    generatedAt?: number | string | null;
    focusAnchorId?: string | null;
    isCorpusStale?: boolean;
    staleDiagnosis?: InquiryStaleDiagnosis | null;
};

const ARTICLE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
});

export class InquiryBriefingModal extends Modal {
    private readonly brief: InquiryBriefModel;
    private readonly plugin: RadialTimelinePlugin;
    private readonly briefFile: TFile | null;
    private readonly logFile: TFile | null;
    private readonly generatedAt: number | string | null | undefined;
    private readonly focusAnchorId: string | null;
    private readonly isCorpusStale: boolean;
    private readonly staleDiagnosis: InquiryStaleDiagnosis | null;
    private themeObserver?: MutationObserver;
    private readonly sceneReferenceEntries: Array<{ label: string; anchorId?: string }>;

    constructor(app: App, options: InquiryBriefingModalOptions) {
        super(app);
        this.brief = options.brief;
        this.plugin = options.plugin;
        this.briefFile = options.briefFile ?? null;
        this.logFile = options.logFile ?? null;
        this.generatedAt = options.generatedAt;
        this.focusAnchorId = options.focusAnchorId ?? null;
        this.isCorpusStale = options.isCorpusStale ?? false;
        this.staleDiagnosis = options.staleDiagnosis ?? null;
        this.sceneReferenceEntries = [...(this.brief.sceneReferences || [])].sort((a, b) => b.label.length - a.label.length);
    }

    onOpen(): void {
        const { contentEl, titleEl, modalEl } = this;
        contentEl.empty();
        titleEl.setText('');
        modalEl.addClass('ert-briefing-modal');
        contentEl.addClass('ert-briefing-surface');
        this.applyTheme();
        this.installThemeObserver();

        const shell = contentEl.createDiv({ cls: 'ert-briefing-shell' });
        this.renderHeader(shell);
        this.renderHero(shell);
        this.renderSummary(shell);
        this.renderFindings(shell);
        this.renderSources(shell);
        this.renderSceneNotes(shell);
        this.renderPendingActions(shell);
        this.renderRawResponse(shell);
        window.requestAnimationFrame(() => this.focusRequestedAnchor());
    }

    onClose(): void {
        this.themeObserver?.disconnect();
        this.themeObserver = undefined;
        this.contentEl.empty();
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
        brandText.createDiv({ cls: 'ert-briefing-brand-subline', text: 'Inquiry Briefing' });

        const actions = header.createDiv({ cls: 'ert-briefing-actions' });
        const pdfAction = actions.createEl('button', {
            cls: 'ert-briefing-action',
            text: 'Save PDF'
        });
        pdfAction.addEventListener('click', () => {
            this.printBriefing();
        });
        const briefFile = this.briefFile;
        if (briefFile) {
            const noteAction = actions.createEl('button', {
                cls: 'ert-briefing-action',
                text: 'Open Markdown'
            });
            noteAction.addEventListener('click', () => {
                void this.openFileAndClose(briefFile);
            });
        }
    }

    private renderHero(container: HTMLElement): void {
        const hero = container.createEl('section', { cls: 'ert-briefing-hero' });
        hero.createDiv({ cls: 'ert-briefing-kicker', text: 'Briefing' });
        const context = this.brief.questionTitle?.trim();
        if (context && context.toLowerCase() !== 'briefing') {
            hero.createDiv({ cls: 'ert-briefing-context', text: context });
        }
        hero.createEl('h1', {
            cls: 'ert-briefing-title',
            text: this.brief.questionText?.trim() || 'Inquiry question unavailable.'
        });

        const meta = hero.createDiv({ cls: 'ert-briefing-meta' });
        const primaryMeta = [
            this.formatGeneratedAt(),
            this.brief.scopeIndicator ? `Scope ${this.brief.scopeIndicator}` : '',
        ].filter(Boolean);
        if (primaryMeta.length) {
            const primaryLine = meta.createDiv({ cls: 'ert-briefing-meta-line', text: primaryMeta.join(' · ') });
            if (this.isCorpusStale) {
                primaryLine.appendText(' · ');
                const labelText = this.staleDiagnosis
                    ? `STALE — ${this.staleDiagnosis.shortLabel.toUpperCase()}`
                    : 'STALE';
                const tooltip = this.staleDiagnosis?.tooltipLines.length
                    ? `Corpus has changed since this briefing was generated:\n${this.staleDiagnosis.tooltipLines.join('\n')}\nRe-run to refresh.`
                    : 'Corpus has changed since this briefing was generated. Re-run to refresh.';
                primaryLine.createSpan({
                    cls: 'ert-briefing-stale-badge',
                    text: labelText,
                    attr: { title: tooltip }
                });
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
        const section = this.createSection(container, 'Summary');
        const summaryStack = section.createDiv({ cls: 'ert-briefing-summary-stack' });

        const summaryEntries = this.brief.mode === 'depth'
            ? [
                { label: 'Depth', text: this.brief.depthSummary || 'No depth summary available.' },
                { label: 'Flow', text: this.brief.flowSummary || 'No flow summary available.' }
            ]
            : [
                { label: 'Flow', text: this.brief.flowSummary || 'No flow summary available.' },
                { label: 'Depth', text: this.brief.depthSummary || 'No depth summary available.' }
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

        this.renderFindingGroup(section, 'Primary Findings', targetFindings);
        this.renderFindingGroup(section, 'Context Findings', contextFindings);
    }

    private renderSources(container: HTMLElement): void {
        if (!this.brief.sources.length) return;
        const section = this.createSection(container, 'Sources');
        const list = section.createDiv({ cls: 'ert-briefing-stack' });
        this.brief.sources.forEach(source => {
            const item = list.createEl('article', { cls: 'ert-briefing-block ert-briefing-source' });
            const titleRow = item.createDiv({ cls: 'ert-briefing-source-header' });
            const title = source.title?.trim() || 'Untitled source';

            if (source.path) {
                const link = titleRow.createEl('a', {
                    cls: 'ert-briefing-source-title ert-briefing-link',
                    text: title,
                    href: '#'
                });
                link.addEventListener('click', event => {
                    event.preventDefault();
                    void this.openPathAndClose(source.path as string);
                });
            } else if (source.url) {
                titleRow.createEl('a', {
                    cls: 'ert-briefing-source-title ert-briefing-link',
                    text: title,
                    href: source.url,
                    attr: {
                        target: '_blank',
                        rel: 'noopener'
                    }
                });
            } else {
                titleRow.createDiv({ cls: 'ert-briefing-source-title', text: title });
            }

            const metaParts = [
                source.classLabel?.trim() || '',
                Number.isFinite(source.citationCount) && (source.citationCount ?? 0) > 0
                    ? `${source.citationCount} citation${source.citationCount === 1 ? '' : 's'}`
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
        const section = this.createSection(container, 'Scene Notes');
        const notes = section.createDiv({ cls: 'ert-briefing-stack' });

        this.brief.sceneNotes.forEach(note => {
            const article = notes.createEl('article', {
                cls: 'ert-briefing-block ert-briefing-note',
                attr: note.anchorId ? { 'data-rt-brief-anchor': note.anchorId } : undefined
            });
            const labelRow = article.createDiv({ cls: 'ert-briefing-note-label-row' });
            labelRow.createDiv({ cls: 'ert-briefing-note-label', text: note.header });
            const anchorTarget = this.briefFile;
            if (note.anchorId && anchorTarget) {
                const anchorAction = labelRow.createEl('a', {
                    cls: 'ert-briefing-note-link',
                    text: '↗',
                    attr: {
                        href: '#',
                        'aria-label': `Open ${note.header} in Markdown brief`,
                        title: 'Open in Markdown brief'
                    }
                });
                anchorAction.addEventListener('click', (event) => {
                    event.preventDefault();
                    void this.openSubpathAndClose(anchorTarget, `#^${note.anchorId}`);
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
        const section = this.createSection(container, 'Action Items');
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
        const section = this.createSection(container, 'Provider Response');
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
        return `Generated ${ARTICLE_DATE_FORMAT.format(normalized)}`;
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
        this.themeObserver?.disconnect();
        this.themeObserver = new MutationObserver(() => {
            this.applyTheme();
        });
        this.themeObserver.observe(this.modalEl.ownerDocument.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    private resolveEffectiveTheme(): 'dark' | 'light' {
        return this.modalEl.ownerDocument.body.classList.contains('theme-dark') ? 'dark' : 'light';
    }

    private applyTheme(): void {
        const effectiveTheme = this.resolveEffectiveTheme();
        this.modalEl.setAttribute('data-ert-briefing-theme', effectiveTheme);
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
        const doc = this.contentEl.ownerDocument;
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
            el.addEventListener('click', (event) => {
                event.preventDefault();
                this.scrollToSceneReference(anchorId);
            });
            el.setAttribute('aria-label', `Jump to ${label}`);
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
        const doc = this.contentEl.ownerDocument;
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
        const el = this.contentEl.ownerDocument.win.createSpan();
        el.className = `ert-briefing-quote ert-briefing-quote--${mode}`;
        el.textContent = text;
        return el;
    }

    private scrollToSceneReference(anchorId?: string): void {
        if (!anchorId) return;
        this.focusAnchorIdInternal(anchorId);
    }

    private focusAnchorIdInternal(anchorId: string): void {
        const notes = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.ert-briefing-note[data-rt-brief-anchor]'));
        const target = notes.find(note => note.getAttribute('data-rt-brief-anchor') === anchorId);
        if (!target) return;
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        target.classList.add('is-focus-target');
        window.setTimeout(() => {
            target.classList.remove('is-focus-target');
        }, 1600);
    }

    private printBriefing(): void {
        const doc = this.contentEl.ownerDocument;
        const previousTitle = doc.title;
        const nextTitle = this.resolvePrintTitle();
        const printHost = this.createPrintHost();
        let restored = false;
        const restore = (): void => {
            if (restored) return;
            restored = true;
            doc.title = previousTitle;
            printHost.remove();
            window.removeEventListener('afterprint', restore);
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
        window.addEventListener('afterprint', restore, { once: true });
        printMedia?.addEventListener?.('change', mediaListener);
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                window.print();
            });
        });
    }

    private createPrintHost(): HTMLElement {
        const host = this.contentEl.ownerDocument.win.createDiv();
        host.className = 'print ert-briefing-print-root';
        host.setAttribute('aria-hidden', 'true');

        const article = this.contentEl.cloneNode(true) as HTMLElement;
        host.appendChild(article);
        return host;
    }

    private async openFileAndClose(file: TFile): Promise<void> {
        await openOrRevealFile(this.app, file);
        this.close();
    }

    private async openPathAndClose(path: string): Promise<void> {
        await openOrRevealFileByPath(this.app, path);
        this.close();
    }

    private async openSubpathAndClose(file: TFile, subpath: string): Promise<void> {
        await openOrRevealFileAtSubpath(this.app, file, subpath);
        this.close();
    }

    private escapeRegExp(value: string): string {
        return escapeRegExp(value);
    }

    private focusRequestedAnchor(): void {
        if (!this.focusAnchorId) return;
        this.focusAnchorIdInternal(this.focusAnchorId);
    }

    private resolvePrintTitle(): string {
        const baseName = this.briefFile?.basename?.trim();
        if (baseName) return baseName;

        const questionText = this.brief.questionText?.trim();
        if (questionText) {
            return `Inquiry Brief — ${questionText.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}`;
        }

        return 'Inquiry Brief';
    }
}
