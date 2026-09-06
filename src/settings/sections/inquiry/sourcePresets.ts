import type { InquiryClassConfig, InquirySourcesPreset, SceneInclusion } from '../../../types/settings';
import { isSynopsisCapableClass, normalizeContributionMode, normalizeClassContribution } from '../../../inquiry/services/InquiryCorpusService';

const defaultParticipationForClass = (className: string): { book: boolean; saga: boolean; reference: boolean } => {
    const normalized = className.toLowerCase();
    if (!isSynopsisCapableClass(normalized)) {
        return { book: false, saga: false, reference: true };
    }
    if (normalized === 'outline') {
        return { book: true, saga: true, reference: false };
    }
    if (normalized === 'scene') {
        return { book: true, saga: true, reference: false };
    }
    return { book: true, saga: false, reference: false };
};

const resolvePresetContribution = (preset: InquirySourcesPreset, className: string): SceneInclusion => {
    const normalized = className.toLowerCase();
    const isReference = !isSynopsisCapableClass(normalized);
    let mode: SceneInclusion = 'excluded';
    if (preset === 'deep' && (isReference || normalized === 'scene' || normalized === 'outline')) mode = 'full';
    if (preset === 'light' && (normalized === 'scene' || normalized === 'outline')) mode = 'summary';
    if (preset === 'default' && normalized === 'scene') mode = 'summary';
    if (preset === 'default' && normalized === 'outline') mode = 'full';
    return normalizeContributionMode(mode, normalized);
};

export const buildPresetClassConfig = (config: InquiryClassConfig, preset: InquirySourcesPreset): InquiryClassConfig => {
    const contribution = resolvePresetContribution(preset, config.className);
    const normalized = config.className.toLowerCase();
    const participation = contribution === 'excluded'
        ? { book: false, saga: false, reference: false }
        : defaultParticipationForClass(config.className);
    const bookContribution: SceneInclusion =
        preset === 'default' && normalized === 'scene' ? 'full' : contribution;
    const sagaContribution: SceneInclusion =
        preset === 'default' && normalized === 'scene' ? 'summary' : contribution;
    return normalizeClassContribution({
        ...config,
        enabled: contribution !== 'excluded',
        bookScope: participation.book ? bookContribution : 'excluded',
        sagaScope: participation.saga ? sagaContribution : 'excluded',
        referenceScope: participation.reference ? contribution : 'excluded'
    });
};

