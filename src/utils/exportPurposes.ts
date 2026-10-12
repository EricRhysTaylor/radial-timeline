/*
 * Built-in export presets, one per purpose: who the export is for decides its
 * format, scene IDs and cleanup. A purpose sets only the settings it owns and
 * keeps everything else (order, range, layout, line breaks, word counts) from
 * the export being built, so it works like a saved preset that follows the
 * book. Built-ins are never persisted; only their id is remembered as the
 * last-used preset.
 */
import type { ManuscriptExportCleanupOptions } from '../types';
import type { ModalExportProfile } from './exportProfileModel';
import { t } from '../i18n';

export type ExportPurposeId = 'editor-round' | 'ai-review' | 'readers';

export interface ExportPurpose {
    id: ExportPurposeId;
    label: string;
    description: string;
}

export const EXPORT_PURPOSES: readonly ExportPurpose[] = [
    {
        id: 'editor-round',
        get label() { return t('ui.exportPurposes.editorRoundLabel'); },
        get description() { return t('ui.exportPurposes.editorRoundDesc'); },
    },
    {
        id: 'ai-review',
        get label() { return t('ui.exportPurposes.aiReviewLabel'); },
        get description() { return t('ui.exportPurposes.aiReviewDesc'); },
    },
    {
        id: 'readers',
        get label() { return t('ui.exportPurposes.readersLabel'); },
        get description() { return t('ui.exportPurposes.readersDesc'); },
    },
];

const BUILT_IN_PRESET_PREFIX = 'builtin:';

export function builtInPresetId(purpose: ExportPurposeId): string {
    return `${BUILT_IN_PRESET_PREFIX}${purpose}`;
}

export function getExportPurposeForPresetId(presetId: string | null | undefined): ExportPurpose | undefined {
    if (!presetId || !presetId.startsWith(BUILT_IN_PRESET_PREFIX)) return undefined;
    return EXPORT_PURPOSES.find(purpose => builtInPresetId(purpose.id) === presetId);
}

const STRIP_EVERYTHING: ManuscriptExportCleanupOptions = {
    stripComments: true,
    stripAiComments: true,
    stripLinks: true,
    stripCallouts: true,
    stripBlockIds: true,
};

/**
 * The built-in preset for a purpose, layered on `base` (the export being
 * built). The modal's one SceneId toggle drives both TOC and heading IDs, so
 * both flags move together.
 */
export function buildPurposeProfile(purpose: ExportPurpose, base: ModalExportProfile): ModalExportProfile {
    const shared = { ...base, id: builtInPresetId(purpose.id), name: purpose.label, exportType: 'manuscript' as const };
    switch (purpose.id) {
        case 'editor-round':
            return {
                ...shared,
                outputFormat: 'docx',
                includeSceneIdInToc: true,
                includeSceneIdInHeading: true,
                includeMatter: false,
                saveMarkdownArtifact: false,
                selectionPolicy: 'manual-range',
                cleanup: { ...STRIP_EVERYTHING, stripAiComments: false },
            };
        case 'ai-review':
            return {
                ...shared,
                outputFormat: 'markdown',
                includeSceneIdInToc: true,
                includeSceneIdInHeading: true,
                includeMatter: false,
                saveMarkdownArtifact: false,
                selectionPolicy: 'manual-range',
                cleanup: { stripComments: true, stripAiComments: false, stripLinks: false, stripCallouts: false, stripBlockIds: false },
            };
        case 'readers': {
            // Readers get Word or PDF; a PDF export stays PDF, anything else becomes Word.
            const outputFormat = base.outputFormat === 'pdf' ? 'pdf' : 'docx';
            return {
                ...shared,
                outputFormat,
                includeSceneIdInToc: false,
                includeSceneIdInHeading: false,
                selectionPolicy: outputFormat === 'pdf' ? 'full-book' : 'manual-range',
                cleanup: { ...STRIP_EVERYTHING },
            };
        }
    }
}
