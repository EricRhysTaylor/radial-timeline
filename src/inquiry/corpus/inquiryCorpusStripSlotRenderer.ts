import { addTooltipData } from '../../utils/tooltip';
import { t } from '../../i18n';
import type { CorpusCcEntry, CorpusCcSlot, CorpusCcStats } from '../types/inquiryViewTypes';
import type { SynopsisQuality } from '../../sceneAnalysis/synopsisQuality';
import {
    isLowSubstanceTier,
    resolveCorpusSceneStatus,
    type CorpusSceneStatus,
    type CorpusSubstanceTier
} from '../services/corpusCellStatus';

export type InquiryCorpusThresholds = {
    emptyMax: number;
    sketchyMin: number;
    mediumMin: number;
    substantiveMin: number;
};

export type InquiryCorpusCcSlotViewModel = {
    fillHeight: number;
    fillY: number;
    tier: CorpusSubstanceTier;
    mode: string;
    sceneStatus?: CorpusSceneStatus;
    lowSubstance: boolean;
    tooltip: string;
    filePath?: string;
};

export function buildInquiryCorpusCcSlotViewModel(args: {
    entry: CorpusCcEntry;
    stats: CorpusCcStats;
    thresholds: InquiryCorpusThresholds;
    pageHeight: number;
}): InquiryCorpusCcSlotViewModel {
    const mode = args.entry.mode ?? 'excluded';
    const isSynopsis = mode === 'summary';
    const wordCount = isSynopsis ? args.stats.synopsisWords : args.stats.bodyWords;
    const tier = isSynopsis
        ? getInquiryCorpusSynopsisTier(args.stats.synopsisQuality, wordCount, args.thresholds)
        : getInquiryCorpusTier(wordCount, args.thresholds);
    const ratioBase = args.thresholds.substantiveMin > 0 ? (wordCount / args.thresholds.substantiveMin) : 0;
    const ratio = Math.min(Math.max(ratioBase, 0), 1);
    const fillHeight = Math.round(args.pageHeight * ratio);
    const sceneStatus = args.entry.className === 'scene'
        ? resolveCorpusSceneStatus({ status: args.stats.statusRaw, due: args.stats.due })
        : undefined;
    const lowSubstance = args.entry.className === 'scene' && isLowSubstanceTier(tier);

    return {
        fillHeight,
        fillY: args.pageHeight - fillHeight,
        tier,
        mode,
        sceneStatus,
        lowSubstance,
        tooltip: buildInquiryCorpusCcTooltip({
            entry: args.entry,
            stats: args.stats,
            tier,
            sceneStatus,
            isLowSubstance: lowSubstance,
            wordCount
        }),
        filePath: args.entry.filePath || undefined
    };
}

export function applyInquiryCorpusCcSlotViewModel(
    slot: CorpusCcSlot,
    viewModel: InquiryCorpusCcSlotViewModel
): void {
    slot.fill.setAttribute('height', String(viewModel.fillHeight));
    slot.fill.setAttribute('y', String(viewModel.fillY));

    slot.group.classList.remove(
        'is-tier-empty',
        'is-tier-sketchy',
        'is-tier-medium',
        'is-tier-substantive',
        'is-mode-excluded',
        'is-mode-summary',
        'is-mode-full',
        'is-status-todo',
        'is-status-working',
        'is-status-complete',
        'is-status-overdue',
        'is-low-substance'
    );
    slot.group.classList.add(`is-tier-${viewModel.tier}`);
    if (viewModel.mode === 'summary') {
        slot.group.classList.add('is-mode-summary');
    } else if (viewModel.mode === 'full') {
        slot.group.classList.add('is-mode-full');
    } else {
        slot.group.classList.add('is-mode-excluded');
    }

    if (viewModel.sceneStatus) {
        slot.group.classList.add(`is-status-${viewModel.sceneStatus}`);
    }
    if (viewModel.lowSubstance) {
        slot.group.classList.add('is-low-substance');
    }

    addTooltipData(slot.group, viewModel.tooltip, 'left');
    slot.group.setAttribute('data-rt-tip-offset-x', '-3');
    if (viewModel.filePath) {
        slot.group.classList.add('is-openable');
        slot.group.setAttribute('data-file-path', viewModel.filePath);
    } else {
        slot.group.classList.remove('is-openable');
        slot.group.removeAttribute('data-file-path');
    }
}

function getInquiryCorpusTier(
    wordCount: number,
    thresholds: InquiryCorpusThresholds
): CorpusSubstanceTier {
    if (wordCount <= thresholds.emptyMax) return 'empty';
    if (wordCount < thresholds.sketchyMin) return 'sketchy';
    if (wordCount < thresholds.mediumMin) return 'sketchy';
    if (wordCount < thresholds.substantiveMin) return 'medium';
    return 'substantive';
}

function getInquiryCorpusSynopsisTier(
    quality: SynopsisQuality,
    wordCount: number,
    thresholds: InquiryCorpusThresholds
): CorpusSubstanceTier {
    if (quality === 'missing') return 'empty';
    if (quality === 'weak') return 'sketchy';
    return getInquiryCorpusTier(wordCount, thresholds);
}

function getInquiryCorpusTierLabel(tier: CorpusSubstanceTier): string {
    if (tier === 'empty') return t('settings.inquiry.corpusTier.empty');
    if (tier === 'sketchy') return t('settings.inquiry.corpusTier.sketchy');
    if (tier === 'medium') return t('settings.inquiry.corpusTier.medium');
    return t('settings.inquiry.corpusTier.substantive');
}

function buildInquiryCorpusCcTooltip(args: {
    entry: CorpusCcEntry;
    stats: CorpusCcStats;
    tier: CorpusSubstanceTier;
    sceneStatus?: CorpusSceneStatus;
    isLowSubstance: boolean;
    wordCount: number;
}): string {
    const tooltipTitle = args.stats.title || args.entry.label;
    const classInitial = args.entry.className?.trim().charAt(0).toLowerCase() || '?';
    const conditions: string[] = [];

    if (args.sceneStatus) {
        const statusLabel = args.sceneStatus === 'overdue'
            ? t('inquiry.corpus.statusOverdueLabel')
            : args.sceneStatus === 'todo'
                ? t('inquiry.corpus.statusTodoLabel')
                : args.sceneStatus === 'working'
                    ? t('inquiry.corpus.statusWorkingLabel')
                    : t('inquiry.corpus.statusCompleteLabel');
        const statusBorderNote = args.sceneStatus === 'todo'
            ? t('inquiry.corpus.tooltipStatusTodo')
            : args.sceneStatus === 'working'
                ? t('inquiry.corpus.tooltipStatusWorking')
                : args.sceneStatus === 'overdue'
                    ? t('inquiry.corpus.tooltipStatusOverdue')
                    : t('inquiry.corpus.tooltipStatusComplete');
        conditions.push(`Status: ${statusLabel}${statusBorderNote}`);
    }

    if (args.entry.mode === 'excluded') {
        conditions.push(t('inquiry.corpus.tooltipModeExclude'));
    }

    if (args.entry.isTarget) {
        conditions.push(t('inquiry.corpus.tooltipTargetActive'));
    }

    const tierLabel = getInquiryCorpusTierLabel(args.tier);
    const wordsLabel = t('inquiry.corpus.tooltipWordsLabel', { count: args.wordCount.toLocaleString() });
    if (args.isLowSubstance) {
        conditions.push(`${tierLabel}: ${wordsLabel} (X)`);
    } else {
        conditions.push(`${tierLabel}: ${wordsLabel}`);
    }

    return `${tooltipTitle} [${classInitial}]\n${conditions.map(item => `• ${item}`).join('\n')}`;
}
