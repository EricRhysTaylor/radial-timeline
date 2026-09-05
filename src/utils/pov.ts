import type { TimelineItem } from '../types';
import type { GlobalPovMode, PovMarkerLabel } from '../types/settings';

export interface ResolvedPov {
    syntheticEntries: Array<{ text: string; label: PovMarkerLabel }>;
    characterMarkers: Array<{ index: number; label: PovMarkerLabel }>;
}

type EffectiveMode = 'first' | 'second' | 'third' | 'omni' | 'objective' | 'legacy';

const MODE_KEYWORDS: Record<string, EffectiveMode> = {
    first: 'first',
    '1st': 'first',
    second: 'second',
    '2nd': 'second',
    you: 'second',
    third: 'third',
    '3rd': 'third',
    limited: 'third',
    omni: 'omni',
    omniscient: 'omni',
    objective: 'objective',
    narrator: 'objective',
    legacy: 'legacy',
    pov: 'legacy'
};

const COUNT_WORDS: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    dozen: 12
};

const MODE_CONFIG: Record<EffectiveMode, { label: PovMarkerLabel; usesCharacters: boolean; syntheticText?: string }> = {
    first: { label: '1', usesCharacters: true },
    third: { label: '3', usesCharacters: true },
    legacy: { label: '1', usesCharacters: true },
    second: { label: '2', usesCharacters: false, syntheticText: 'You' },
    omni: { label: '3', usesCharacters: false, syntheticText: 'Omni' },
    objective: { label: '0', usesCharacters: false, syntheticText: 'Narrator' }
};

interface PovInterpretation {
    modeOverride?: EffectiveMode;
    countOverride?: number;
}

function interpretKeyword(raw: unknown): PovInterpretation {
    if (typeof raw !== 'string') return {};
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return {};

    const firstToken = trimmed.split(/\s+/)[0];
    const mappedMode = MODE_KEYWORDS[firstToken];
    if (mappedMode) {
        return { modeOverride: mappedMode };
    }

    if (trimmed === 'count' || trimmed === 'all') {
        return { countOverride: Number.POSITIVE_INFINITY };
    }

    const wordCount = COUNT_WORDS[trimmed];
    if (wordCount) {
        return { countOverride: wordCount };
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && numeric > 0) {
        return { countOverride: numeric };
    }

    return {};
}

function normalizeGlobalMode(mode: GlobalPovMode | undefined): EffectiveMode {
    if (!mode || mode === 'off') return 'legacy';
    if (mode === 'first' || mode === 'second' || mode === 'third' || mode === 'omni' || mode === 'objective') {
        return mode;
    }
    return 'legacy';
}

function determineHighlightCount(countOverride: number | undefined, characterCount: number): number {
    if (characterCount <= 0) return 0;
    if (countOverride === undefined) {
        return 1;
    }
    if (!Number.isFinite(countOverride)) {
        return characterCount;
    }
    return Math.max(1, Math.min(characterCount, Math.floor(countOverride)));
}

export function resolveScenePov(
    scene: Pick<TimelineItem, 'Character' | 'pov'>,
    options: { globalMode?: GlobalPovMode }
): ResolvedPov {
    const characters = scene.Character || [];
    const { modeOverride, countOverride } = interpretKeyword(scene.pov);
    const effectiveMode = modeOverride ?? normalizeGlobalMode(options.globalMode);
    const config = MODE_CONFIG[effectiveMode];

    const syntheticEntries: Array<{ text: string; label: PovMarkerLabel }> = [];
    const characterMarkers: Array<{ index: number; label: PovMarkerLabel }> = [];

    if (!config.usesCharacters) {
        if (config.syntheticText) {
            syntheticEntries.push({ text: config.syntheticText, label: config.label });
        }
        return { syntheticEntries, characterMarkers };
    }

    const highlightCount = determineHighlightCount(countOverride, characters.length);
    for (let i = 0; i < highlightCount; i++) {
        if (i >= characters.length) break;
        characterMarkers.push({ index: i, label: config.label });
    }

    return { syntheticEntries, characterMarkers };
}
