import { App, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { INQUIRY_VIEW_TYPE } from './constants';
import { InquiryView } from './InquiryView';
import type { InquiryCurrentCorpusContext } from './types';

export class InquiryService {
    constructor(private app: App, private plugin: RadialTimelinePlugin) {}

    getInquiryViews(): InquiryView[] {
        return this.app.workspace
            .getLeavesOfType(INQUIRY_VIEW_TYPE)
            .map(leaf => leaf.view as unknown)
            .filter((view): view is InquiryView => view instanceof InquiryView);
    }

    getCurrentCorpusContext(): InquiryCurrentCorpusContext | null {
        const view = this.getInquiryViews()[0];
        return view?.getCurrentCorpusContext() ?? null;
    }

    /** Notify all open Inquiry views that AI settings changed. */
    notifyAiSettingsChanged(): void {
        for (const view of this.getInquiryViews()) {
            view.onAiSettingsChanged();
        }
    }

    /** Notify all open Inquiry views that prompt settings changed. */
    notifyPromptSettingsChanged(): void {
        for (const view of this.getInquiryViews()) {
            view.onPromptSettingsChanged();
        }
    }

    /** Notify all open Inquiry views that book settings or order changed. */
    notifyBookSettingsChanged(): void {
        for (const view of this.getInquiryViews()) {
            view.onBookSettingsChanged();
        }
    }

    /** Notify all open Inquiry views that material source/class settings changed. */
    notifySourcesSettingsChanged(): void {
        for (const view of this.getInquiryViews()) {
            view.onSourcesSettingsChanged();
        }
    }

    async activateView(): Promise<void> {
        if (!(this.plugin.settings.enableAiSceneAnalysis ?? true)) {
            new Notice(t('inquiry.notice.aiDisabledInSettings'));
            return;
        }

        const leaves = this.app.workspace.getLeavesOfType(INQUIRY_VIEW_TYPE);
        if (leaves.length > 0) {
            void this.app.workspace.revealLeaf(leaves[0]);
            return;
        }

        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({
            type: INQUIRY_VIEW_TYPE,
            active: true
        });
        void this.app.workspace.revealLeaf(leaf);
    }

    async runOmnibusPass(): Promise<void> {
        if (!(this.plugin.settings.enableAiSceneAnalysis ?? true)) {
            new Notice(t('inquiry.notice.aiDisabledInSettings'));
            return;
        }
        await this.activateView();
        const view = this.getInquiryViews()[0];
        if (!view) {
            new Notice(t('inquiry.notice.omnibusViewFailed'));
            return;
        }
        await view.runOmnibusPass();
    }
}
