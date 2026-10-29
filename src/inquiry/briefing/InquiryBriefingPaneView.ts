import { App, ItemView, TFile, type ViewStateResult } from 'obsidian';
import { INQUIRY_BRIEFING_VIEW_TYPE, INQUIRY_VIEW_TYPE } from '../constants';
import type { InquiryView } from '../InquiryView';
import { InquiryBriefingModal } from '../modals/InquiryBriefingModal';
import { InquiryBriefingArticle, type InquiryBriefingPayload } from './InquiryBriefingArticle';
import { openOrRevealFile } from '../../utils/fileUtils';
import { t } from '../../i18n';

/**
 * The briefing article docked beside the Inquiry view, so the author can read
 * it while working in Inquiry. It keeps the briefing it was given; picking
 * another session in Inquiry does not change it.
 */
export class InquiryBriefingPaneView extends ItemView {
    // Not a navigation view: links opened from the briefing land in another
    // tab instead of replacing it.
    navigation = false;
    private payload: InquiryBriefingPayload | null = null;
    private briefPath: string | null = null;
    private article: InquiryBriefingArticle | null = null;

    getViewType(): string {
        return INQUIRY_BRIEFING_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.payload?.brief.questionTitle?.trim() || t('ui.inquiryBriefingModal.brandSubline');
    }

    getIcon(): string {
        return 'newspaper';
    }

    getState(): Record<string, unknown> {
        return this.briefPath ? { briefPath: this.briefPath } : {};
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const briefPath = (state as { briefPath?: unknown } | null)?.briefPath;
        if (typeof briefPath === 'string' && briefPath !== this.briefPath) {
            // Restored from the saved layout: only the path survives a reload,
            // so the article is rebuilt from Inquiry's saved session.
            this.briefPath = briefPath;
            this.payload = null;
            this.app.workspace.onLayoutReady(() => {
                void this.restoreFromInquiry();
            });
        }
        await super.setState(state, result);
    }

    async onOpen(): Promise<void> {
        this.containerEl.addClass('ert-briefing-pane');
        this.render();
    }


    showBriefing(payload: InquiryBriefingPayload): void {
        this.payload = payload;
        this.briefPath = payload.briefFile?.path ?? null;
        this.render();
        this.app.workspace.requestSaveLayout();
    }

    private async restoreFromInquiry(): Promise<void> {
        const briefPath = this.briefPath;
        if (this.payload || !briefPath) return;
        for (const leaf of this.app.workspace.getLeavesOfType(INQUIRY_VIEW_TYPE)) {
            await leaf.loadIfDeferred();
            if (leaf.view.getViewType() !== INQUIRY_VIEW_TYPE) continue;
            const payload = (leaf.view as InquiryView).buildBriefingPayloadForPath(briefPath);
            if (payload) {
                this.payload = payload;
                break;
            }
        }
        this.render();
    }

    private render(): void {
        if (this.article) this.removeChild(this.article);
        this.article = null;
        this.contentEl.empty();
        this.refreshHeader();
        const payload = this.payload;
        if (payload) {
            this.article = new InquiryBriefingArticle(this.app, this.contentEl, payload, {
                themeRoot: this.containerEl,
                afterNavigate: () => {},
                layoutAction: {
                    icon: 'maximize-2',
                    label: t('ui.inquiryBriefingModal.openFullBriefing'),
                    run: () => this.popOut(payload)
                }
            });
            this.addChild(this.article);
            return;
        }
        if (this.briefPath) this.renderUnavailable(this.briefPath);
    }

    /** Blocked state: the saved session for this briefing could not be found in an open Inquiry view. */
    private renderUnavailable(briefPath: string): void {
        const empty = this.contentEl.createDiv({ cls: 'ert-briefing-pane-empty' });
        empty.createDiv({ text: t('ui.inquiryBriefingModal.paneUnavailable') });
        const file = this.app.vault.getAbstractFileByPath(briefPath);
        if (file instanceof TFile) {
            const open = empty.createEl('button', {
                cls: 'ert-briefing-action',
                text: t('ui.inquiryBriefingModal.openMarkdown')
            });
            this.registerDomEvent(open, 'click', () => {
                void openOrRevealFile(this.app, file);
            });
        }
    }

    private popOut(payload: InquiryBriefingPayload): void {
        const app = this.app;
        new InquiryBriefingModal(app, payload, () => {
            void openInquiryBriefingPane(app, payload);
        }).open();
        this.leaf.detach();
    }

    private refreshHeader(): void {
        const titleText = this.getDisplayText();
        const headerTitle = this.containerEl.querySelector('.view-header-title');
        if (headerTitle && headerTitle.textContent !== titleText) {
            headerTitle.textContent = titleText;
        }
        // Obsidian owns the tab header outside the view; refresh its title from getDisplayText().
        (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.(); // SAFE: Obsidian's untyped leaf header refresh, also used by InquiryView and TimeLineView.
    }
}

/** Show a briefing in the side panel: reuse an open panel, else split beside the Inquiry view. */
export async function openInquiryBriefingPane(app: App, payload: InquiryBriefingPayload): Promise<void> {
    const { workspace } = app;
    const existing = workspace.getLeavesOfType(INQUIRY_BRIEFING_VIEW_TYPE)[0];
    const inquiry = workspace.getLeavesOfType(INQUIRY_VIEW_TYPE).find(leaf => leaf.getRoot() === workspace.rootSplit);
    const leaf = existing ?? (inquiry ? workspace.createLeafBySplit(inquiry, 'vertical') : workspace.getLeaf('split', 'vertical'));
    await leaf.setViewState({ type: INQUIRY_BRIEFING_VIEW_TYPE, active: true });
    if (!(leaf.view instanceof InquiryBriefingPaneView)) return;
    leaf.view.showBriefing(payload);
    await workspace.revealLeaf(leaf);
}
