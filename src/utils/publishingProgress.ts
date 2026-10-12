import type { ValidationSummary } from '../types';
import { t } from '../i18n';

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
            title: t('ui.publishingProgress.bookDetailsTitle'),
            description: t('ui.publishingProgress.bookDetailsDesc'),
            statusLabel: bookDetailsStatus,
            statusKey: getStatusKey(bookDetailsStatus),
            detail: !inputs.hasBookMeta
                ? t('ui.publishingProgress.bookDetailsSetupDetail')
                : inputs.bookMetaSummary.topMessage || t('ui.publishingProgress.bookDetailsReadyDetail'),
            actionLabel: !inputs.hasBookMeta ? t('ui.publishingProgress.addDetailsAction') : t('ui.publishingProgress.openDetailsAction'),
        },
        {
            id: 'book-pages',
            title: t('ui.publishingProgress.bookPagesTitle'),
            description: t('ui.publishingProgress.bookPagesDesc'),
            statusLabel: bookPagesStatus,
            statusKey: getStatusKey(bookPagesStatus),
            detail: inputs.matterCount === 0
                ? t('ui.publishingProgress.bookPagesOptionalDetail')
                : inputs.matterSummary.topMessage || t('ui.publishingProgress.bookPagesReadyDetail'),
            actionLabel: inputs.matterCount === 0 ? t('ui.publishingProgress.addPagesAction') : t('ui.publishingProgress.reviewPagesAction'),
        },
        {
            id: 'pdf-style',
            title: t('ui.publishingProgress.pdfStyleTitle'),
            description: t('ui.publishingProgress.pdfStyleDesc'),
            statusLabel: pdfStyleStatus,
            statusKey: getStatusKey(pdfStyleStatus),
            quickStart: true,
            detail: inputs.layoutSummary.totalCount === 0
                ? t('ui.publishingProgress.pdfStyleSetupDetail')
                : inputs.layoutSummary.state === 'ready' && inputs.layoutSummary.validCount >= inputs.layoutSummary.totalCount
                    ? t('ui.publishingProgress.pdfStyleReadyDetail')
                    : inputs.layoutSummary.topMessage || t('ui.publishingProgress.stylesReadyCount', { valid: inputs.layoutSummary.validCount, total: inputs.layoutSummary.totalCount }),
            actionLabel: inputs.layoutSummary.totalCount === 0 ? t('ui.publishingProgress.chooseStyleAction') : t('ui.publishingProgress.reviewStylesAction'),
        },
        {
            id: 'export-check',
            title: t('ui.publishingProgress.exportCheckTitle'),
            description: t('ui.publishingProgress.exportCheckDesc'),
            statusLabel: exportCheckStatus,
            statusKey: getStatusKey(exportCheckStatus),
            detail: exportCheckReady
                ? t('ui.publishingProgress.exportCheckReadyDetail')
                : !inputs.pandocPathValid
                    ? t('ui.publishingProgress.exportCheckToolsDetail')
                    : inputs.layoutSummary.validCount === 0
                        ? t('ui.publishingProgress.exportCheckStyleDetail')
                        : inputs.exportSummary.topMessage || t('ui.publishingProgress.exportCheckRemainingDetail'), // SAFE: generic next-step prompt when validation has no message.
            actionLabel: exportCheckReady ? t('ui.publishingProgress.reviewExportAction') : !inputs.pandocPathValid ? t('ui.publishingProgress.setUpToolsAction') : t('ui.publishingProgress.reviewExportAction'),
        },
    ];
}
