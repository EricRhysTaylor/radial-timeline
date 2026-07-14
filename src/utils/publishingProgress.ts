import type { ValidationSummary } from '../types';

// 'Optional' — a calm, positive "you can skip this" state (Book Details / Book
// Pages, which export never requires). 'Setup' — a calm "a one-time setup step
// is needed for PDF export" state (Pandoc/LaTeX tools). 'Blocked' (red) is
// reserved for a genuine error in something the author already configured, so
// the eye lands on green go-states, not a scary red at the end of the row.
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
}

function getStatusKey(statusLabel: PublishingStageStatus): PublishingStageStatusKey {
    if (statusLabel === 'Ready') return 'ready';
    if (statusLabel === 'Blocked') return 'blocked';
    if (statusLabel === 'Needs attention') return 'attention';
    if (statusLabel === 'Setup') return 'setup';
    return 'optional';
}

export function buildPublishingProgressStages(inputs: PublishingProgressInputs): PublishingStageModel[] {
    // Book Details & Book Pages are genuinely optional — a PDF exports from the
    // built-in styles with neither. Pre-setup they read 'Optional' (calm), not a
    // muted-but-alarming "needs setup"; once the author adds them, real problems
    // surface as attention/blocked.
    const bookDetailsStatus: PublishingStageStatus = !inputs.hasBookMeta
        ? 'Optional'
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

    // Export readiness depends ONLY on the tools + a working style — never on
    // the optional Book Details / Book Pages. Missing export tools is a calm
    // one-time 'Setup', not a red block.
    const exportCheckReady = inputs.pandocPathValid
        && inputs.layoutSummary.validCount > 0
        && inputs.layoutSummary.state !== 'blocked';

    const exportCheckStatus: PublishingStageStatus = exportCheckReady
        ? 'Ready'
        : !inputs.pandocPathValid || inputs.layoutSummary.validCount === 0
            ? 'Setup'
            : 'Needs attention';

    return [
        {
            id: 'book-details',
            title: 'Book Details',
            description: 'Title, author, and publishing info.',
            statusLabel: bookDetailsStatus,
            statusKey: getStatusKey(bookDetailsStatus),
            detail: !inputs.hasBookMeta
                ? 'Optional — title, author, publishing info. Export works without it.'
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
                        : inputs.layoutSummary.topMessage || 'Finish the remaining setup.',
            actionLabel: exportCheckReady ? 'Review export' : !inputs.pandocPathValid ? 'Set up tools' : 'Review export',
        },
    ];
}
