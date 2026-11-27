import type { TimelineItem } from '../types';
import { buildRippleRenamePlan } from '../services/SceneReorderService';
import type { OuterRingOrderEntry } from '../view/interactions/OuterRingDragController';
import { comparePrefixTokens, extractPrefixToken } from '../utils/prefixOrder';
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

/**
 * What a sort set in Bases has taken over in this mode, as translation keys
 * for the sort notice beside Mode: story order and the day dividers in
 * Chronologue, manuscript order elsewhere, and the scene drag where it would
 * otherwise work: the mode allows it and the timeline shows one book.
 */
export function sortNoticeHelpKeys(state: TimelineModeState, scope: 'book' | 'saga'): string[] {
    const keys = [state.mode === 'chronologue' ? 'ui.timetable.sortReplacesStoryOrder' : 'ui.timetable.sortReplacesManuscriptOrder'];
    if (modeAllowsSceneDrag(state) && scope === 'book') keys.push('ui.timetable.sortPausesDrag');
    return keys;
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

export interface TimetableBeatOrder {
    all: OuterRingOrderEntry[];
    active: OuterRingOrderEntry[];
}

/** The index in the order after removing the source. Only a scene can anchor a drop. */
export function timetableBeatDropIndex(
    order: readonly OuterRingOrderEntry[], source: string, target: string, after: boolean
): number | null {
    const from = order.findIndex(entry => entry.path === source && entry.itemType === 'Beat');
    const to = order.findIndex(entry => entry.path === target && entry.itemType === 'Scene');
    if (from < 0 || to < 0 || order[from].act !== order[to].act) return null;
    const gap = to + Number(after);
    const insert = gap - Number(from < gap);
    if (insert === from) return null;
    const crossed = order.slice(Math.min(from + 1, gap), Math.max(from, gap));
    return crossed.every(entry => entry.act === order[from].act && entry.itemType === 'Scene') ? insert : null;
}

/** An inactive beat keeps its filename when the active manuscript is renumbered.
 * Check that the proposed prefixes preserve its side of the moved beat too. */
export function timetableBeatKeepsOrder(
    order: readonly OuterRingOrderEntry[], source: string, numbers: ReadonlyMap<string, string>
): boolean {
    const from = order.findIndex(entry => entry.path === source);
    const number = numbers.get(source);
    if (from < 0 || !number) return false;
    return order.every((entry, index) => {
        if (index === from || entry.itemType !== 'Beat' || entry.act !== order[from].act) return true;
        const otherNumber = numbers.get(entry.path) ?? (entry.numberText || null);
        return Math.sign(comparePrefixTokens(number, otherNumber)) === Math.sign(from - index);
    });
}

export function sameTimetableBeatOrder(before: TimetableBeatOrder, after: TimetableBeatOrder): boolean {
    const same = (a: OuterRingOrderEntry[], b: OuterRingOrderEntry[]): boolean =>
        a.length === b.length && a.every((entry, index) =>
            entry.path === b[index].path && entry.act === b[index].act && entry.itemType === b[index].itemType);
    return same(before.all, after.all) && same(before.active, after.active);
}
