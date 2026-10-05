import { normalizeClassContribution, normalizeInquirySources } from './services/InquiryCorpusService';
import type { InquiryClassConfig, InquirySourcesSettings, RadialTimelineSettings } from '../types/settings';

const SAMPLE_INQUIRY_CORE_CLASSES: InquiryClassConfig[] = [
    normalizeClassContribution({
        className: 'scene',
        enabled: true,
        bookScope: 'full',
        sagaScope: 'summary',
        referenceScope: 'excluded'
    }),
    normalizeClassContribution({
        className: 'outline',
        enabled: true,
        bookScope: 'full',
        sagaScope: 'full',
        referenceScope: 'excluded'
    })
];

export const mergeSampleInquirySources = (raw?: InquirySourcesSettings): InquirySourcesSettings => {
    const current = normalizeInquirySources(raw);
    const classScope = new Set(current.classScope || []);
    classScope.add('/');

    const classesByName = new Map((current.classes || []).map(config => [config.className, config]));
    for (const coreConfig of SAMPLE_INQUIRY_CORE_CLASSES) {
        const existing = classesByName.get(coreConfig.className);
        classesByName.set(
            coreConfig.className,
            existing
                ? normalizeClassContribution({
                    ...existing,
                    enabled: true,
                    bookScope: existing.bookScope === 'excluded' ? coreConfig.bookScope : existing.bookScope,
                    sagaScope: existing.sagaScope === 'excluded' ? coreConfig.sagaScope : existing.sagaScope,
                    referenceScope: 'excluded'
                })
                : coreConfig
        );
    }

    return {
        ...current,
        preset: current.preset || 'default',
        classScope: Array.from(classScope),
        classes: Array.from(classesByName.values()),
        lastScanAt: current.lastScanAt || new Date().toISOString()
    };
};

/** Only initialize unconfigured sources; importing a demo preserves existing AI choices. */
export function initializeSampleInquirySources(settings: RadialTimelineSettings): void {
    if (settings.inquirySources?.classScope?.length || settings.inquirySources?.classes?.length) return;
    settings.inquirySources = mergeSampleInquirySources(settings.inquirySources);
}
