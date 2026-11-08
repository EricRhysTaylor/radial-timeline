import type { TimelineItem } from '../types';
import type { NarrationMode, PovMarkerLabel } from '../types/settings';

export interface ResolvedPov {
    syntheticEntries: Array<{ text: string; label: PovMarkerLabel }>;
    characterMarkers: Array<{ index: number; label: PovMarkerLabel }>;
}

/** Every narration mode, in the order the book details list them. 'off' is "not set". */
export const NARRATION_MODES: readonly NarrationMode[] = ['off', 'first', 'second', 'third', 'omni', 'objective'];

type EffectiveMode = 'first' | 'second' | 'third' | 'omni' | 'objective' | 'legacy';

const MODE_KEYWORDS = new Map<string, EffectiveMode>([
    ['first', 'first'],
    ['1st', 'first'],
    ['second', 'second'],
    ['2nd', 'second'],
    ['you', 'second'],
    ['third', 'third'],
    ['3rd', 'third'],
    ['limited', 'third'],
    ['omni', 'omni'],
    ['omniscient', 'omni'],
    ['objective', 'objective'],
    ['narrator', 'objective'],
    ['legacy', 'legacy'],
    ['pov', 'legacy'],
]);

/** Words that describe a narration without naming the mode ("third person limited", "close third"). */
const NARRATION_QUALIFIERS = new Set(['person', 'close', 'deep', 'distant', 'past', 'present', 'tense', 'multiple', 'single']);

const COUNT_WORDS = new Map<string, number>([
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
    ['six', 6],
    ['seven', 7],
    ['eight', 8],
    ['nine', 9],
    ['ten', 10],
    ['dozen', 12],
]);

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

/**
 * A narration value is a mode, described by mode words and qualifiers only
 * ("first", "third person limited", "close third"), or a count ("two", "all",
 * "3"). Every word must belong: "Third Officer Ames" is a name, not a mode.
 */
function interpretKeyword(raw: unknown): PovInterpretation {
    if (typeof raw !== 'string') return {};
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return {};

    if (trimmed === 'count' || trimmed === 'all') {
        return { countOverride: Number.POSITIVE_INFINITY };
    }

    const wordCount = COUNT_WORDS.get(trimmed);
    if (wordCount !== undefined) {
        return { countOverride: wordCount };
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && numeric > 0) {
        return { countOverride: numeric };
    }

    const words = trimmed.split(/[^a-z0-9]+/).filter(word => word.length > 0);
    if (words.length === 0 || !words.every(word => MODE_KEYWORDS.has(word) || NARRATION_QUALIFIERS.has(word))) {
        return {};
    }
    const mode = words.map(word => MODE_KEYWORDS.get(word)).find(found => found !== undefined);
    return mode ? { modeOverride: mode } : {};
}

/**
 * Whether a scene's narration value names a mode (first, third, omni…) or a
 * count (two, all, 3). Anything else, such as a character's name, is not a
 * narration value and is ignored when the timeline resolves narration.
 */
export function isNarrationValue(raw: string): boolean {
    const { modeOverride, countOverride } = interpretKeyword(raw);
    return modeOverride !== undefined || countOverride !== undefined;
}

export function isNarrationMode(value: unknown): value is NarrationMode {
    return typeof value === 'string' && (NARRATION_MODES as readonly string[]).includes(value);
}

function normalizeBookMode(mode: NarrationMode | undefined): EffectiveMode {
    if (!mode || mode === 'off') return 'legacy';
    return mode;
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

/**
 * How a scene's characters are marked. The scene's `Narration:` override wins
 * when it names a mode; otherwise the scene's book narration applies. A count
 * override marks that many listed characters with the book's marker.
 */
export function resolveScenePov(
    scene: Pick<TimelineItem, 'Character' | 'pov'>,
    options: { narrationMode?: NarrationMode }
): ResolvedPov {
    const characters = scene.Character || [];
    const { modeOverride, countOverride } = interpretKeyword(scene.pov);
    const effectiveMode = modeOverride ?? normalizeBookMode(options.narrationMode);
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
