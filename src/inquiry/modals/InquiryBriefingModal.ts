import { App, Modal } from 'obsidian';
import { InquiryBriefingArticle, type InquiryBriefingPayload } from '../briefing/InquiryBriefingArticle';
import { t } from '../../i18n';

/** The full-window briefing article. `onDock` moves it into the side panel beside Inquiry. */
export class InquiryBriefingModal extends Modal {
    private article?: InquiryBriefingArticle;

    constructor(
        app: App,
        private readonly payload: InquiryBriefingPayload,
        private readonly onDock: (() => void) | null
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, titleEl, modalEl } = this;
        titleEl.setText('');
        modalEl.addClass('ert-briefing-modal');
        const onDock = this.onDock;
        this.article = new InquiryBriefingArticle(this.app, contentEl, this.payload, {
            themeRoot: modalEl,
            afterNavigate: () => this.close(),
            layoutAction: onDock
                ? {
                    icon: 'panel-right',
                    label: t('ui.inquiryBriefingModal.dockBesideInquiry'),
                    run: () => {
                        this.close();
                        onDock();
                    }
                }
                : null
        });
        this.article.load();
    }

    onClose(): void {
        this.article?.unload();
        this.article = undefined;
    }
}
