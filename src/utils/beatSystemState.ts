import type { BeatDefinition, RadialTimelineSettings, SavedBeatSystem } from '../types/settings';
import { normalizeBeatNameInput, normalizeBeatSetNameInput } from './beatsInputNormalize';
import { getActiveBook } from './books';

export const DEFAULT_CUSTOM_BEAT_SYSTEM_ID = 'default';
export const DEFAULT_CUSTOM_BEAT_SYSTEM_NAME = 'Custom';
const DEFAULT_CUSTOM_CREATED_AT = '1970-01-01T00:00:00.000Z';

function normalizeBeatDefinition(beat: BeatDefinition): BeatDefinition {
    const name = normalizeBeatNameInput(beat.name, '');
    return {
        ...beat,
        name,
        purpose: typeof beat.purpose === 'string' ? beat.purpose.trim() || undefined : undefined,
        range: typeof beat.range === 'string' ? beat.range.trim() || undefined : undefined,
        id: typeof beat.id === 'string' && beat.id.trim().length > 0 ? beat.id.trim() : undefined,
    };
}

export function buildDefaultCustomBeatSystem(): SavedBeatSystem {
    return {
        id: DEFAULT_CUSTOM_BEAT_SYSTEM_ID,
        name: DEFAULT_CUSTOM_BEAT_SYSTEM_NAME,
        description: '',
        beats: [],
        createdAt: DEFAULT_CUSTOM_CREATED_AT,
    };
}

export function getCustomBeatConfigKey(customBeatSystemId: string | undefined): string {
    const normalizedId = (customBeatSystemId ?? '').trim() || DEFAULT_CUSTOM_BEAT_SYSTEM_ID;
    return `custom:${normalizedId}`;
}

export function getSavedBeatSystems(settings: Pick<RadialTimelineSettings, 'savedBeatSystems'>): SavedBeatSystem[] {
    return Array.isArray(settings.savedBeatSystems) ? settings.savedBeatSystems : [];
}

export function findSavedBeatSystem(
    settings: Pick<RadialTimelineSettings, 'savedBeatSystems'>,
    customBeatSystemId: string | undefined
): SavedBeatSystem | undefined {
    const targetId = (customBeatSystemId ?? '').trim();
    if (!targetId) return undefined;
    return getSavedBeatSystems(settings).find((system) => system.id === targetId);
}

export function replaceSavedBeatSystem(
    settings: Pick<RadialTimelineSettings, 'savedBeatSystems'>,
    system: SavedBeatSystem
): void {
    if (!Array.isArray(settings.savedBeatSystems)) {
        settings.savedBeatSystems = [];
    }
    const normalized: SavedBeatSystem = {
        ...system,
        name: normalizeBeatSetNameInput(system.name, DEFAULT_CUSTOM_BEAT_SYSTEM_NAME),
        description: typeof system.description === 'string' ? system.description : '',
        beats: (system.beats ?? []).map(normalizeBeatDefinition).filter((beat) => beat.name.length > 0),
        createdAt: typeof system.createdAt === 'string' && system.createdAt.trim().length > 0
            ? system.createdAt
            : new Date().toISOString(),
    };
    const existingIndex = settings.savedBeatSystems.findIndex((entry) => entry.id === normalized.id);
    if (existingIndex >= 0) {
        settings.savedBeatSystems[existingIndex] = normalized;
        return;
    }
    settings.savedBeatSystems.unshift(normalized);
}

export function resolveSelectedBeatModelFromSettings(
    settings: Pick<RadialTimelineSettings, 'books' | 'activeBookId'>
): string | undefined {
    const activeBook = getActiveBook(settings as RadialTimelineSettings);
    const workspace = activeBook?.beatWorkspace;
    const activeTabId = workspace?.activeTabId;
    if (activeTabId && workspace?.tabsById?.[activeTabId]) {
        const activeTabName = normalizeBeatSetNameInput(workspace.tabsById[activeTabId].name, '');
        if (activeTabName) return activeTabName;
    }
    return undefined;
}
