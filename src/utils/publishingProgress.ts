import type { ValidationSummary } from '../types';

// Book Details are required for formatted output; Book Pages remain optional.
export type PublishingStageStatus = 'Ready' | 'Optional' | 'Setup' | 'Needs attention' | 'Blocked';
export type PublishingStageStatusKey = 'optional' | 'setup' | 'attention' | 'blocked' | 'ready';
export type PublishingStageId = 'book-details' | 'book-pages' | 'pdf-style' | 'export-check';

export interface PublishingStageModel {
    id: PublishingStageId;
    title: string;
    description: string;
    statusLabel: PublishingStageStatus;
    statusKey: PublishingStageStatusKey;
    detail: string;
    actionLabel: string;
    /** The zero-config quick-start anchor — where an author with no setup begins. */
    quickStart?: boolean;
}

export interface PublishingStageSummary {
    state: ValidationSummary['state'];
    topMessage?: string;
}

export interface PublishingLayoutSummary extends PublishingStageSummary {
    validCount: number;
    totalCount: number;
}

export interface PublishingProgressInputs {
    hasBookMeta: boolean;
    bookMetaSummary: PublishingStageSummary;
    matterSummary: PublishingStageSummary;
    matterCount: number;
    layoutSummary: PublishingLayoutSummary;
    pandocPathValid: boolean;
    exportSummary: PublishingStageSummary;
}

function getStatusKey(statusLabel: PublishingStageStatus): PublishingStageStatusKey {
    if (statusLabel === 'Ready') return 'ready';
    if (statusLabel === 'Blocked') return 'blocked';
    if (statusLabel === 'Needs attention') return 'attention';
    if (statusLabel === 'Setup') return 'setup';
    return 'optional';
}

export function buildPublishingProgressStages(inputs: PublishingProgressInputs): PublishingStageModel[] {
    const bookDetailsStatus: PublishingStageStatus = !inputs.hasBookMeta
        ? 'Setup'
        : inputs.bookMetaSummary.state === 'blocked'
            ? 'Blocked'
            : inputs.bookMetaSummary.state === 'warning'
                ? 'Needs attention'
                : 'Ready';

    const bookPagesStatus: PublishingStageStatus = inputs.matterCount === 0
        ? 'Optional'
        : inputs.matterSummary.state === 'blocked'
            ? 'Blocked'
            : inputs.matterSummary.state === 'warning'
                ? 'Needs attention'
                : 'Ready';

    // PDF Style is the quick-start anchor: Core ships two ready styles, so this
    // is normally green from a cold start. Only a totally empty style list is a
    // setup task; a broken selected style is a real error (blocked).
    const pdfStyleStatus: PublishingStageStatus = inputs.layoutSummary.totalCount === 0
        ? 'Setup'
        : inputs.layoutSummary.validCount === 0 || inputs.layoutSummary.state === 'blocked'
            ? 'Blocked'
            : inputs.layoutSummary.state === 'warning' || inputs.layoutSummary.validCount < inputs.layoutSummary.totalCount
                ? 'Needs attention'
                : 'Ready';

    const exportCheckReady = inputs.exportSummary.state !== 'blocked';
    const exportCheckStatus: PublishingStageStatus = !inputs.pandocPathValid
        ? 'Setup'
        : inputs.exportSummary.state === 'blocked'
            ? 'Blocked'
            : inputs.exportSummary.state === 'warning' ? 'Needs attention' : 'Ready';

    return [
        {
            id: 'book-details',
            title: 'Book Details',
            description: 'Title, author, and publishing info.',
            statusLabel: bookDetailsStatus,
            statusKey: getStatusKey(bookDetailsStatus),
            detail: !inputs.hasBookMeta
                ? 'Add title and author for PDF and Word. Markdown needs no Book Details.'
                : inputs.bookMetaSummary.topMessage || 'Your details are in place.',
            actionLabel: !inputs.hasBookMeta ? 'Add details' : 'Open details',
        },
        {
            id: 'book-pages',
            title: 'Book Pages',
            description: 'Front and back matter pages.',
            statusLabel: bookPagesStatus,
            statusKey: getStatusKey(bookPagesStatus),
            detail: inputs.matterCount === 0
                ? 'Optional — front & back matter (title page, dedication…). Export works without them.'
                : inputs.matterSummary.topMessage || 'Your book pages are ready.',
            actionLabel: inputs.matterCount === 0 ? 'Add pages' : 'Review pages',
        },
        {
            id: 'pdf-style',
            title: 'PDF Style',
            description: 'Choose the layout for your PDF.',
            statusLabel: pdfStyleStatus,
            statusKey: getStatusKey(pdfStyleStatus),
            quickStart: true,
            detail: inputs.layoutSummary.totalCount === 0
                ? 'Choose a PDF style before exporting.'
                : inputs.layoutSummary.state === 'ready' && inputs.layoutSummary.validCount >= inputs.layoutSummary.totalCount
                    ? 'Two styles free with Core · two more with Pro.'
                    : inputs.layoutSummary.topMessage || `${inputs.layoutSummary.validCount} of ${inputs.layoutSummary.totalCount} styles are ready.`,
            actionLabel: inputs.layoutSummary.totalCount === 0 ? 'Choose style' : 'Review styles',
        },
        {
            id: 'export-check',
            title: 'Export Check',
            description: 'Make sure export is ready.',
            statusLabel: exportCheckStatus,
            statusKey: getStatusKey(exportCheckStatus),
            detail: exportCheckReady
                ? 'Ready to export. Generate your PDF.'
                : !inputs.pandocPathValid
                    ? 'One-time setup: install export tools for PDF.'
                    : inputs.layoutSummary.validCount === 0
                        ? 'Pick a working PDF style first.'
                        : inputs.exportSummary.topMessage || 'Finish the remaining setup.', // SAFE: generic next-step prompt when validation has no message.
            actionLabel: exportCheckReady ? 'Review export' : !inputs.pandocPathValid ? 'Set up tools' : 'Review export',
        },
    ];
}
