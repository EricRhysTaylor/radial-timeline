import { TimelineMode } from '../modes/ModeDefinition';

const LEGACY_MODE_ALIASES: Record<string, TimelineMode> = {
    subplot: TimelineMode.PROGRESS,
    publication: TimelineMode.PROGRESS,
};

export function normalizeTimelineMode(value: unknown): { mode: TimelineMode | null; changed: boolean } {
    if (typeof value !== 'string') return { mode: null, changed: false };

    const trimmed = value.trim();
    if (!trimmed) return { mode: null, changed: false };

    const normalized = trimmed.toLowerCase();
    const canonical = Object.values(TimelineMode).find(mode => mode === (normalized as TimelineMode));

    if (canonical) {
        return { mode: canonical, changed: canonical !== (value as TimelineMode) };
    }

    const legacy = LEGACY_MODE_ALIASES[normalized];
    if (legacy) {
        return { mode: legacy, changed: true };
    }

    return { mode: null, changed: false };
}
