import type { RadialTimelineSettings } from '../types';
import { t } from '../i18n';

const MIN_ACTS = 3;

export function getConfiguredActCount(settings?: Pick<RadialTimelineSettings, 'actCount'>): number {
    const raw = settings?.actCount;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.max(MIN_ACTS, Math.floor(raw));
    }
    return MIN_ACTS;
}

export function parseActLabels(settings: RadialTimelineSettings | undefined, actCount: number): string[] {
    const raw = settings?.actLabelsRaw ?? '';
    if (!raw.trim()) return [];
    return raw
        .split(',')
        .map(label => label.trim())
        .slice(0, actCount);
}

export function resolveActLabel(
    actIndex: number,
    labels: string[]
): string {
    const label = labels[actIndex];
    return label && label.length > 0 ? label : t('timeline.acts.actFallback', { number: actIndex + 1 });
}

export function clampActNumber(actNumber: number | undefined, actCount: number): number {
    const n = typeof actNumber === 'number' && Number.isFinite(actNumber) ? Math.floor(actNumber) : 1;
    if (n < 1) return 1;
    if (n > actCount) return actCount;
    return n;
}

