import type { BeatDefinition, BeatLibraryItem, BeatSourceKind, BeatSystemConfig, RadialTimelineSettings, SavedBeatSystem } from '../types/settings';
import { getPlotSystem, PLOT_SYSTEM_NAMES, STARTER_BEAT_SETS } from '../utils/beatsSystems';
import { DEFAULT_CUSTOM_BEAT_SYSTEM_ID, getCustomBeatConfigKey } from '../utils/beatSystemState';

const EMPTY_BEAT_CONFIG: BeatSystemConfig = {
    beatYamlAdvanced: '',
    beatHoverMetadataFields: [],
};

const BUILTIN_SOURCE_IDS: Record<string, string> = {
    'Save The Cat': 'builtin:save_the_cat',
    "Hero's Journey": 'builtin:heros_journey',
    'Classic Dramatic Structure': 'builtin:classic_dramatic_structure',
};

export const BLANK_LIBRARY_ITEM_ID = 'blank';

function cloneBeatDefinition(beat: BeatDefinition): BeatDefinition {
    return {
        ...beat,
        name: typeof beat.name === 'string' ? beat.name : '',
        act: typeof beat.act === 'number' && Number.isFinite(beat.act) ? beat.act : 1,
        purpose: typeof beat.purpose === 'string' ? beat.purpose : undefined,
        id: typeof beat.id === 'string' ? beat.id : undefined,
        range: typeof beat.range === 'string' ? beat.range : undefined,
    };
}

function cloneBeatConfig(config: BeatSystemConfig | undefined): BeatSystemConfig {
    return {
        beatYamlAdvanced: typeof config?.beatYamlAdvanced === 'string' ? config.beatYamlAdvanced : '',
        beatHoverMetadataFields: Array.isArray(config?.beatHoverMetadataFields)
            ? config.beatHoverMetadataFields.map((field) => ({ ...field }))
            : [],
    };
}

function buildBuiltinBeatDefinitions(systemName: string): BeatDefinition[] {
    const preset = getPlotSystem(systemName);
    if (!preset) return [];
    return preset.beatDetails.map((detail, index) => ({
        name: detail.name,
        act: typeof detail.act === 'number' && Number.isFinite(detail.act) ? detail.act : (index < preset.beats.length / 3 ? 1 : index < (preset.beats.length * 2) / 3 ? 2 : 3),
        purpose: detail.description,
        id: detail.id,
        range: detail.range,
    }));
}

function getBuiltinItemId(systemName: string): string {
    return BUILTIN_SOURCE_IDS[systemName] ?? `builtin:${systemName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

export function isStarterBeatSetId(id: string | undefined): boolean {
    if (!id) return false;
    return STARTER_BEAT_SETS.some((entry) => entry.id === id);
}

export function isWorkspaceBeatSystemId(id: string | undefined): boolean {
    return typeof id === 'string' && id.startsWith('workspace:');
}

export function getBlankBeatLibraryItem(): BeatLibraryItem {
    return {
        id: BLANK_LIBRARY_ITEM_ID,
        kind: 'blank',
        category: 'blank',
        icon: 'square',
        name: 'Blank custom',
        description: '',
        beats: [],
        config: cloneBeatConfig(EMPTY_BEAT_CONFIG),
    };
}

export function getBuiltinBeatLibraryItems(settings: Pick<RadialTimelineSettings, 'beatSystemConfigs'>): BeatLibraryItem[] {
    return PLOT_SYSTEM_NAMES.map((systemName) => {
        const preset = getPlotSystem(systemName);
        return {
            id: getBuiltinItemId(systemName),
            kind: 'builtin',
            category: (preset?.category ?? 'narrative'),
            icon: preset?.icon,
            name: systemName,
            description: '',
            beats: buildBuiltinBeatDefinitions(systemName).map(cloneBeatDefinition),
            config: cloneBeatConfig(settings.beatSystemConfigs?.[systemName]),
        };
    });
}

export function getStarterBeatLibraryItems(settings: Pick<RadialTimelineSettings, 'beatSystemConfigs'>): BeatLibraryItem[] {
    return STARTER_BEAT_SETS.map((system) => ({
        id: system.id,
        kind: 'starter',
        category: system.category,
        icon: system.icon,
        name: system.name,
        description: system.description,
        beats: system.beats.map(cloneBeatDefinition),
        config: cloneBeatConfig(settings.beatSystemConfigs?.[getCustomBeatConfigKey(system.id)] ?? {
            beatYamlAdvanced: system.beatYamlAdvanced,
            beatHoverMetadataFields: system.beatHoverMetadataFields,
        }),
    }));
}

export function getSavedBeatLibraryItems(
    settings: Pick<RadialTimelineSettings, 'savedBeatSystems' | 'beatSystemConfigs'>
): BeatLibraryItem[] {
    const systems = Array.isArray(settings.savedBeatSystems) ? settings.savedBeatSystems : [];
    return systems
        .filter((system) => system.id !== DEFAULT_CUSTOM_BEAT_SYSTEM_ID)
        .filter((system) => !isStarterBeatSetId(system.id))
        .filter((system) => !isWorkspaceBeatSystemId(system.id))
        .map((system: SavedBeatSystem) => ({
            id: system.id,
            kind: 'saved',
            category: 'saved',
            name: system.name,
            description: system.description,
            beats: system.beats.map(cloneBeatDefinition),
            config: cloneBeatConfig(settings.beatSystemConfigs?.[getCustomBeatConfigKey(system.id)]),
            linkedSavedSystemId: system.id,
        }));
}

export function getBeatLibraryItems(
    settings: Pick<RadialTimelineSettings, 'savedBeatSystems' | 'beatSystemConfigs'>
): BeatLibraryItem[] {
    return [
        ...getBuiltinBeatLibraryItems(settings),
        ...getStarterBeatLibraryItems(settings),
        ...getSavedBeatLibraryItems(settings),
        getBlankBeatLibraryItem(),
    ];
}

export function getBeatLibraryItemBySource(
    settings: Pick<RadialTimelineSettings, 'savedBeatSystems' | 'beatSystemConfigs'>,
    kind: BeatSourceKind,
    id?: string
): BeatLibraryItem | undefined {
    if (kind === 'blank') return getBlankBeatLibraryItem();
    if (!id) return undefined;
    return getBeatLibraryItems(settings).find((item) => item.kind === kind && item.id === id);
}

export function cloneBeatLibraryItem(item: BeatLibraryItem): BeatLibraryItem {
    return {
        ...item,
        beats: item.beats.map(cloneBeatDefinition),
        config: cloneBeatConfig(item.config),
    };
}
