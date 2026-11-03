import type { TimelineItem } from '../types';
import { buildRippleRenamePlan } from '../services/SceneReorderService';
import type { OuterRingOrderEntry } from '../view/interactions/OuterRingDragController';
import { extractPrefixToken } from '../utils/prefixOrder';
import { fileStem } from '../utils/paths';
import { timelineItemAct } from '../utils/acts';

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
