/*
 * Precompute reusable values for timeline rendering.
 * Extracted from TimelineRenderer to keep that file focused on orchestration.
 */

import type { TimelineItem } from '../../types';
import { shouldRenderStoryBeats } from '../modules/ModeRenderingHelpers';
import { isBeatNote, isMatterNote, sortScenes, usesWhenOrdering, type PluginRendererFacade } from '../../utils/sceneHelpers';
import {
    SVG_SIZE,
    INNER_RADIUS,
    SUBPLOT_OUTER_RADIUS_MAINPLOT,
    SUBPLOT_OUTER_RADIUS_STANDARD,
    SUBPLOT_OUTER_RADIUS_CHRONOLOGUE,
    MONTH_LABEL_RADIUS,
    BACKDROP_RING_HEIGHT,
    MICRO_RING_GAP,
    MICRO_RING_WIDTH
} from '../layout/LayoutConstants';
import { computeRingGeometry } from '../layout/Rings';
import { buildBackdropMicroRingLayout, type BackdropMicroRingLayout } from '../components/BackdropMicroRings';
import { buildBackdropRingLayout, type BackdropRingLayout } from '../components/BackdropRing';
import { getMostAdvancedStageColor } from '../../utils/colour';
import { startPerfSegment } from '../utils/Performance';
import { computeSubplotDominanceStates, type SubplotDominanceState } from '../components/SubplotDominanceIndicators';
import { getReadabilityScale } from '../../utils/readability';
import { getTimelineScope } from '../../utils/books';
import { getTimelineSegmentCount } from './TimelineSegments';

/** One subplot's aggregated scene count, the unit {@link compareSubplotOrder} orders. */
export interface SubplotCountEntry {
    subplot: string;
    count: number;
}

/**
 * Strict total order for ring placement (outermost first). The single
 * canonical definition — `computeCacheableValues` sorts with this directly,
 * and tests exercise it directly, so there is exactly one place the rule
 * can be stated or broken.
 *
 *   1. 'Main Plot' is pinned first — it is the spine and always reads first.
 *   2. Otherwise, higher scene count sorts first (busiest subplot gets the
 *      longest/outermost ring).
 *   3. Ties break by subplot name, ascending, via localeCompare — the
 *      plugin runs in a single Obsidian/Electron process per vault, so the
 *      same machine always produces the same collation; this matches the
 *      display-locale sort used elsewhere in the plugin's UI. (The web
 *      timeline engine's port of this rule, `timeline-layout/subplots.ts`,
 *      deliberately swaps in a locale-free code-point compare instead,
 *      because that package must produce byte-identical output across
 *      machines; the plugin has no such constraint.)
 *
 * Pinning is on exact name match to 'Main Plot' only, computed once per side
 * as a rank rather than as two independent `return -1` / `return 1` branches.
 * An earlier version used `if (a.subplot === 'Main Plot' || !a.subplot)
 * return -1;` / the mirrored check for `b` — a defensive fallback for a
 * falsy `subplot` that every caller already normalizes to a non-empty
 * string before it reaches this comparator, so the fallback was unreachable
 * in practice. It was also a genuine comparator-contract bug in its own
 * right: given one entry with a falsy subplot and one literally named
 * 'Main Plot', both `compareSubplotOrder(a, b)` and `compareSubplotOrder(b,
 * a)` returned -1 — each claiming to sort before the other — which
 * violates antisymmetry (`a <CF b` must imply `NOT b <CF a`, ECMA-262
 * "consistent comparator" note). It also failed reflexivity (`a =CF a` must
 * hold for every value): comparing the one real 'Main Plot' entry to
 * itself returned -1, not 0. A comparator that isn't consistent leaves
 * `Array.prototype.sort`'s result implementation-defined — engines (and
 * different V8 versions) are free to produce different orderings once the
 * contract breaks, even though V8's actual TimSort has never been observed
 * to exploit this specific inconsistency.
 *
 * The rank formulation here satisfies both properties for *any* input, not
 * just the shape production happens to pass: two same-ranked entries only
 * short-circuit to a tie when both `subplot` and `count` are literally
 * equal (true whenever `a` and `b` are the same conceptual entry — in
 * production, `subplotCounts` is Map-built, so two distinct entries can
 * never share a subplot name, and a name match therefore implies a count
 * match too). A test generator that invents entries sharing a name but
 * disagreeing on count (impossible from real data, but a fair thing for a
 * property test to try) is deliberately routed through the ordinary count
 * comparison rather than force-tied, which is what keeps the relation
 * transitive for that case as well.
 */
export function compareSubplotOrder(a: SubplotCountEntry, b: SubplotCountEntry): number {
    const rankA = a.subplot === 'Main Plot' ? 0 : 1;
    const rankB = b.subplot === 'Main Plot' ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === 0) return 0; // both are the (at most one) 'Main Plot' entry
    if (a.count !== b.count) return b.count - a.count;
    return a.subplot.localeCompare(b.subplot);
}

export interface PrecomputedRenderValues {
    scenesByActAndSubplot: { [act: number]: { [subplot: string]: TimelineItem[] } };
    masterSubplotOrder: string[];
    colorIndexBySubplot: Map<string, number>;
    totalPlotNotes: number;
    plotIndexByKey: Map<string, number>;
    plotsBySubplot: Map<string, TimelineItem[]>;
    ringWidths: number[];
    ringStartRadii: number[];
    lineInnerRadius: number;
    maxStageColor: string;
    subplotDominanceStates: Map<string, SubplotDominanceState>;
    microRingLayout?: BackdropMicroRingLayout;
    backdropLayout?: BackdropRingLayout;
}

export function computeCacheableValues(
    plugin: PluginRendererFacade,
    scenes: TimelineItem[]
): PrecomputedRenderValues {
    const stopPrecompute = startPerfSegment(plugin, 'timeline.precompute');

    const currentMode = plugin.settings.currentMode || 'narrative';
    const isChronologueMode = currentMode === 'chronologue';
    const isProgressMode = currentMode === 'progress';
    const isSagaScope = getTimelineScope(plugin.settings) === 'saga';
    const segmentCount = getTimelineSegmentCount(plugin.settings);
    const readabilityScale = getReadabilityScale(plugin.settings);
    const sortByWhen = usesWhenOrdering(plugin.settings);
    const forceChronological = isChronologueMode;

    const hasBackdrops = scenes.some(scene => scene.itemType === 'Backdrop');

    // Add virtual 'Backdrop' subplot for Chronologue mode to reserve space
    const showBackdropRing = plugin.settings.showBackdropRing ?? true;
    const shouldIncludeBackdrop = isChronologueMode && hasBackdrops && showBackdropRing;
    const microRingConfigs = Array.isArray(plugin.settings.chronologueBackdropMicroRings)
        ? plugin.settings.chronologueBackdropMicroRings
        : [];
    const microRingLayout = (shouldIncludeBackdrop && microRingConfigs.length > 0)
        ? buildBackdropMicroRingLayout({ scenes, configs: microRingConfigs })
        : undefined;
    const microRingLaneCount = microRingLayout?.laneCount ?? 0;
    const shouldIncludeMicroBackdrop = shouldIncludeBackdrop && microRingLaneCount > 0;

    // Compute the backdrop ring layout up front so we can reserve the right
    // amount of radial space for it in fixedRings below. Lane count > 1
    // means overlapping backdrops will be stacked into concentric lanes;
    // the subplot rings inside must shift inward accordingly.
    let backdropLayout: BackdropRingLayout | undefined;
    if (shouldIncludeBackdrop) {
        try {
            backdropLayout = buildBackdropRingLayout(scenes);
        } catch (err) {
             
            console.error(
                '[radial-timeline] buildBackdropRingLayout failed in precompute; backdrop ring will be skipped.',
                err
            );
            backdropLayout = undefined;
        }
    }
    const backdropLaneCount = backdropLayout?.laneCount ?? 0;

    const shouldShowBeats = shouldRenderStoryBeats(plugin);
    const allScenesPlotNotes = shouldShowBeats ? scenes.filter(s => isBeatNote(s)) : [];
    const totalPlotNotes = allScenesPlotNotes.length;
    const plotIndexByKey = new Map<string, number>();
    allScenesPlotNotes.forEach((p, i) => plotIndexByKey.set(`${String(p.title || '')}::${String(p.actNumber ?? '')}`, i));
    const plotsBySubplot = new Map<string, TimelineItem[]>();
    allScenesPlotNotes.forEach(p => {
        const key = String(p.subplot || '');
        const arr = plotsBySubplot.get(key) || [];
        arr.push(p);
        plotsBySubplot.set(key, arr);
    });

    const scenesByActAndSubplot: { [act: number]: { [subplot: string]: TimelineItem[] } } = {};

    if (sortByWhen) {
        scenesByActAndSubplot[0] = {};
        scenes.forEach(scene => {
            if (scene.itemType === 'Backdrop' || isMatterNote(scene)) return;
            const subplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
            if (!scenesByActAndSubplot[0][subplot]) {
                scenesByActAndSubplot[0][subplot] = [];
            }
            scenesByActAndSubplot[0][subplot].push(scene);
        });
        Object.keys(scenesByActAndSubplot[0]).forEach(subplot => {
            scenesByActAndSubplot[0][subplot] = sortScenes(scenesByActAndSubplot[0][subplot], true, forceChronological);
        });
    } else {
        const numActs = segmentCount;
        for (let act = 0; act < numActs; act++) {
            scenesByActAndSubplot[act] = {};
        }
        scenes.forEach(scene => {
            if (scene.itemType === 'Backdrop' || isMatterNote(scene)) return;
            const act = isSagaScope
                ? (typeof scene.bookIndex === 'number' ? scene.bookIndex : 0)
                : (scene.actNumber !== undefined ? scene.actNumber - 1 : 0);
            // Clamp to the nearest valid quadrant instead of resetting to 0 — an
            // out-of-range act (e.g. stale actNumber cached from a since-lowered
            // actCount) must not collapse into Act 1's quadrant. Mirrors the
            // clamping already used for the same case in AprRenderer.ts.
            const validAct = Math.min(Math.max(act, 0), numActs - 1);
            const subplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
            if (!scenesByActAndSubplot[validAct][subplot]) {
                scenesByActAndSubplot[validAct][subplot] = [];
            }
            scenesByActAndSubplot[validAct][subplot].push(scene);
        });
        for (let act = 0; act < numActs; act++) {
            Object.keys(scenesByActAndSubplot[act] || {}).forEach(subplot => {
                scenesByActAndSubplot[act][subplot] = sortScenes(scenesByActAndSubplot[act][subplot], false, false);
            });
        }
    }

    const allSubplotsMap = new Map<string, number>();
    const actsToCheck = sortByWhen ? 1 : segmentCount;

    for (let actIndex = 0; actIndex < actsToCheck; actIndex++) {
        Object.entries(scenesByActAndSubplot[actIndex] || {}).forEach(([subplot, scenes]) => {
            allSubplotsMap.set(subplot, (allSubplotsMap.get(subplot) || 0) + scenes.length);
        });
    }

    const subplotCounts = Array.from(allSubplotsMap.entries()).map(([subplot, count]) => ({
        subplot,
        count
    }));

    subplotCounts.sort(compareSubplotOrder);

    const baseSubplotOrder = subplotCounts.map(item => item.subplot);

    // Stable color index map (pre-reorder) so colors remain consistent across modes
    const colorIndexBySubplot = new Map<string, number>();
    baseSubplotOrder.forEach((subplot, idx) => {
        colorIndexBySubplot.set(subplot, idx % 16);
    });

    let masterSubplotOrder = [...baseSubplotOrder];

    // For Chronologue mode, ensure 'Backdrop' is the second ring from the outside
    // Outer Ring (ringOffset=0) is typically Main Plot or All Scenes.
    // Backdrop (ringOffset=1) should be next.
    if (shouldIncludeBackdrop) {
        masterSubplotOrder = masterSubplotOrder.filter(s => s !== 'Backdrop' && s !== 'MicroBackdrop');
        const insertIndex = masterSubplotOrder.length > 0 ? 1 : 0;
        masterSubplotOrder.splice(insertIndex, 0, 'Backdrop');
        if (shouldIncludeMicroBackdrop) {
            masterSubplotOrder.splice(insertIndex + 1, 0, 'MicroBackdrop');
        }
    }

    // Single source of truth for ring count: masterSubplotOrder is the
    // authoritative list of rings (every renderer that needs a ring count —
    // RingRenderer, TimelineRenderer, NumberSquareRenderer — derives it the
    // same way, from this array's length). Previously this function computed
    // its own NUM_RINGS earlier from a separately-built `allSubplots` set
    // that walked every scene (including Frontmatter/Backmatter notes) and
    // excluded only itemType 'Backdrop'; masterSubplotOrder is built from
    // scenesByActAndSubplot, which excludes Frontmatter/Backmatter via
    // isMatterNote(). A book with front/back matter notes and no scene ever
    // falling back to the default 'Main Plot' subplot could make the two
    // counts diverge by one, sizing the ring geometry below (ringGeo) for
    // one more ring than masterSubplotOrder actually has entries for and
    // silently compressing every real ring's width.
    const NUM_RINGS = masterSubplotOrder.length;

    const subplotDominanceStates = computeSubplotDominanceStates({
        scenes,
        masterSubplotOrder,
        dominantSubplots: plugin.settings.dominantSubplots
    });

    const subplotOuterRadius = isChronologueMode
        ? SUBPLOT_OUTER_RADIUS_CHRONOLOGUE
        : isProgressMode
            ? SUBPLOT_OUTER_RADIUS_MAINPLOT
            : SUBPLOT_OUTER_RADIUS_STANDARD[readabilityScale];

    const fixedRings: Array<{ index: number; width: number }> = [];
    const backdropSubplotIndex = masterSubplotOrder.indexOf('Backdrop');
    if (shouldIncludeBackdrop && backdropSubplotIndex !== -1) {
        // Width scales with the number of backdrop lanes — when overlapping
        // backdrops force stacking into multiple lanes (e.g. lane 0 +
        // lane 1), the Backdrop subplot's allocation must grow so the
        // subplot rings inside push inward correctly. Fall back to a
        // single-lane allocation if the layout couldn't be built.
        const laneCount = backdropLaneCount > 0 ? backdropLaneCount : 1;
        fixedRings.push({
            index: NUM_RINGS - 1 - backdropSubplotIndex,
            width: laneCount * BACKDROP_RING_HEIGHT
        });
    }
    const microBackdropSubplotIndex = masterSubplotOrder.indexOf('MicroBackdrop');
    if (shouldIncludeMicroBackdrop && microBackdropSubplotIndex !== -1) {
        const microRingWidth = microRingLaneCount > 0
            ? (microRingLaneCount * MICRO_RING_WIDTH) + ((microRingLaneCount - 1) * MICRO_RING_GAP)
            : 0;
        if (microRingWidth > 0) {
            fixedRings.push({
                index: NUM_RINGS - 1 - microBackdropSubplotIndex,
                width: microRingWidth
            });
        }
    }

    const ringGeo = computeRingGeometry({
        size: SVG_SIZE,
        innerRadius: INNER_RADIUS,
        subplotOuterRadius,
        outerRadius: MONTH_LABEL_RADIUS,
        numRings: NUM_RINGS,
        monthTickTerminal: 0,
        monthTextInset: 0,
        fixedRings
    });

    const maxStageColor = getMostAdvancedStageColor(scenes, plugin.settings.publishStageColors);

    stopPrecompute();

    return {
        scenesByActAndSubplot,
        masterSubplotOrder,
        colorIndexBySubplot,
        totalPlotNotes,
        plotIndexByKey,
        plotsBySubplot,
        ringWidths: ringGeo.ringWidths,
        ringStartRadii: ringGeo.ringStartRadii,
        lineInnerRadius: ringGeo.lineInnerRadius,
        maxStageColor,
        subplotDominanceStates,
        microRingLayout,
        backdropLayout
    };
}
