import type { TimelineItem } from '../types';
import { buildRippleRenamePlan } from '../services/SceneReorderService';
import type { OuterRingOrderEntry } from '../view/interactions/OuterRingDragController';
import { extractPrefixToken } from '../utils/prefixOrder';
import { fileStem } from '../utils/paths';

/** Use the whole book and the same act, prefix, and active-beat ordering as manuscript renumbering. */
export function timetableNarrativeOrder(items: TimelineItem[], beatModel?: string): OuterRingOrderEntry[] {
    const byPath = new Map<string, TimelineItem>();
    for (const item of items) if (item.path && !byPath.has(item.path)) byPath.set(item.path, item);
    const paths = buildRippleRenamePlan(items, { beatModel }).orderedPaths;
    return paths.flatMap((path, index) => {
        const item = byPath.get(path);
        if (!item || (item.itemType !== 'Scene' && item.itemType !== 'Beat')) return [];
        const basename = fileStem(path);
        const act = Number(item.actNumber ?? item.act ?? 1);
        return [{ sceneId: path, path, basename, numberText: extractPrefixToken(basename) ?? '',
            act: Number.isFinite(act) && act > 0 ? act - 1 : 0, ring: 0, itemType: item.itemType, startAngle: index }];
    });
}
