import type { TimelineItem } from '../types';
import { buildRippleRenamePlan } from '../services/SceneReorderService';
import type { OuterRingOrderEntry } from '../view/interactions/OuterRingDragController';
import { extractPrefixToken } from '../utils/prefixOrder';
import { fileStem } from '../utils/paths';
import { timelineItemAct } from '../utils/acts';
import type { TimelineModeState } from './timetableRegistry';

/**
 * The mode a Timetable is drawn in. Unpinned, or pinned to the mode the
 * timeline is in, it follows the timeline with its micro-modes (Chronologue's
 * Shift and Alt, Narrative's runtime view). Pinned to another mode, it is that
 * mode, plain. With no timeline open it follows the saved mode, plain.
 */
export function timetableModeState(pin: string | null, timeline: TimelineModeState | null, savedMode: string | undefined): TimelineModeState {
    const following = timeline ?? { mode: savedMode || 'narrative', shift: false, alt: false, runtime: false };
    if (pin === null || pin === following.mode) return following;
    return { mode: pin, shift: false, alt: false, runtime: false };
}

/** The columns a micro-mode adds after When: Chronologue Shift's Gap, Narrative runtime's Running time. */
export function timetableModeColumns(state: TimelineModeState): Array<'gap' | 'running'> {
    const columns: Array<'gap' | 'running'> = [];
    if (state.mode === 'chronologue' && state.shift) columns.push('gap');
    if (state.mode === 'narrative' && state.runtime) columns.push('running');
    return columns;
}

/**
 * Scene drag in the table places by Narrative's or Chronologue's own order, so
 * it waits while a micro-mode (Shift, Alt, runtime) changes what the rows show.
 */
export function modeAllowsSceneDrag(state: TimelineModeState): boolean {
    return (state.mode === 'narrative' || state.mode === 'chronologue') && !state.runtime && !state.shift && !state.alt;
}

/** Use the whole book and the same act, prefix, and active-beat ordering as manuscript renumbering. */
export function timetableNarrativeOrder(items: TimelineItem[], beatModel?: string): OuterRingOrderEntry[] {
    const byPath = new Map<string, TimelineItem>();
    for (const item of items) if (item.path && !byPath.has(item.path)) byPath.set(item.path, item);
    const paths = buildRippleRenamePlan(items, { beatModel }).orderedPaths;
    return paths.flatMap((path, index) => {
        const item = byPath.get(path);
        if (!item || (item.itemType !== 'Scene' && item.itemType !== 'Beat')) return [];
        const basename = fileStem(path);
        return [{ sceneId: path, path, basename, numberText: extractPrefixToken(basename) ?? '', // SAFE: an unnumbered file has no prefix text
            act: timelineItemAct(item) - 1, ring: 0, itemType: item.itemType, startAngle: index }];
    });
}
