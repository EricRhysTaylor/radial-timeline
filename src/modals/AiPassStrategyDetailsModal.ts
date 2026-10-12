/*
 * AI Pass Strategy Details Modal
 *
 * Shows detailed explanations of single-pass and multi-pass analysis
 * strategies. The system chooses automatically based on manuscript size.
 */
import { App, Modal, setIcon } from 'obsidian';
import { t } from '../i18n';

export class AiPassStrategyDetailsModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');

        modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Hero header
        const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
        hero.createDiv({ cls: 'ert-modal-title', text: t('ui.aiPassStrategyDetailsModal.title') });
        hero.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('ui.aiPassStrategyDetailsModal.subtitle')
        });

        // ── Single-Pass section ──
        this.createStrategySection(contentEl, {
            icon: 'git-commit-vertical',
            title: t('ui.aiPassStrategyDetailsModal.singlePassTitle'),
            body: t('ui.aiPassStrategyDetailsModal.singlePassBody'),
            questions: [
                t('ui.aiPassStrategyDetailsModal.singlePassQuestion1'),
                t('ui.aiPassStrategyDetailsModal.singlePassQuestion2'),
                t('ui.aiPassStrategyDetailsModal.singlePassQuestion3'),
                t('ui.aiPassStrategyDetailsModal.singlePassQuestion4')
            ]
        });

        // Divider
        contentEl.createDiv({ cls: 'ert-ai-strategy-divider' });

        // ── Multi-Pass section ──
        this.createStrategySection(contentEl, {
            icon: 'git-fork',
            title: t('ui.aiPassStrategyDetailsModal.multiPassTitle'),
            body: t('ui.aiPassStrategyDetailsModal.multiPassBody'),
            questions: [
                t('ui.aiPassStrategyDetailsModal.multiPassQuestion1'),
                t('ui.aiPassStrategyDetailsModal.multiPassQuestion2'),
                t('ui.aiPassStrategyDetailsModal.multiPassQuestion3'),
                t('ui.aiPassStrategyDetailsModal.multiPassQuestion4')
            ]
        });

    }

    private createStrategySection(container: HTMLElement, config: {
        icon: string;
        title: string;
        body: string;
        questions: string[];
        note?: string;
    }): void {
        const section = container.createDiv({ cls: 'ert-stack ert-ai-strategy-section' });

        // Header with icon
        const header = section.createDiv({ cls: 'ert-ai-strategy-header' });
        const iconEl = header.createSpan({ cls: 'ert-ai-strategy-icon' });
        setIcon(iconEl, config.icon);
        header.createSpan({ cls: 'ert-ai-strategy-title', text: config.title });

        // Body text
        section.createDiv({ cls: 'ert-ai-strategy-body', text: config.body });

        // Example questions
        if (config.questions.length > 0) {
            const questionList = section.createDiv({ cls: 'ert-stack ert-stack--tight ert-ai-strategy-questions' });
            questionList.createDiv({ cls: 'ert-ai-strategy-questions-label', text: t('ui.aiPassStrategyDetailsModal.exampleQuestionsLabel') });
            config.questions.forEach(question => {
                const row = questionList.createDiv({ cls: 'ert-ai-strategy-question' });
                const qIcon = row.createSpan({ cls: 'ert-ai-strategy-question-icon' });
                setIcon(qIcon, 'message-circle-question-mark');
                row.createSpan({ text: question });
            });
        }

        // Note
        if (config.note) {
            section.createDiv({ cls: 'ert-ai-strategy-note', text: config.note });
        }
    }
}
