/*
 * AI Pass Strategy Details Modal
 *
 * Shows detailed explanations of single-pass and multi-pass analysis
 * strategies. The system chooses automatically based on manuscript size.
 */
import { App, Modal, setIcon } from 'obsidian';

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
        hero.createDiv({ cls: 'ert-modal-title', text: 'Analysis pass strategies' });
        hero.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'How manuscript analysis is structured based on size.'
        });

        // ── Single-Pass section ──
        this.createStrategySection(contentEl, {
            icon: 'git-commit-vertical',
            title: 'Single-Pass Analysis',
            body: 'Entire manuscript analyzed in one request. Best suited for deeply global thematic questions that depend on the full manuscript being considered at once.',
            questions: [
                'What is the central moral argument of this book?',
                'Does the ending fulfill the thematic promise of the opening?',
                'Is the protagonist\u2019s transformation coherent across all acts?',
                'How does the midpoint reframe the final resolution?'
            ]
        });

        // Divider
        contentEl.createDiv({ cls: 'ert-ai-strategy-divider' });

        // ── Multi-Pass section ──
        this.createStrategySection(contentEl, {
            icon: 'git-fork',
            title: 'Multi-Pass Analysis',
            body: 'Large manuscripts are split into structured segments. Each segment is evaluated independently, and the findings are combined into one unified response. Best for structural patterns that can be analyzed segment by segment.',
            questions: [
                'Identify unresolved character arcs across the manuscript.',
                'Where does tension stall or repeat structurally?',
                'Detect timeline inconsistencies or continuity errors.',
                'Compare scene-level pacing patterns across acts.'
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
            questionList.createDiv({ cls: 'ert-ai-strategy-questions-label', text: 'Example questions:' });
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
