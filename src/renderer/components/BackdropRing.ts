/*
 * Backdrop Ring Renderer
 *
 * Renders the "Backdrop" layer in Chronologue mode. Backdrops are time
 * spans (e.g. "Bingley at Netherfield" Sep–Dec 1811) that should appear
 * as bands behind the scene ring.
 *
 * Architecture: overlapping backdrops are placed in separate concentric
 * lanes via greedy interval-graph scheduling. Lane 0 is the outermost
 * (drawn at the layout-engine-allocated radius); each additional lane
 * stacks one BACKDROP_RING_HEIGHT inward. This is the same algorithm
 * used by BackdropMicroRings.ts.
 *
 * The previous architecture tried to render all overlapping backdrops
 * at a single radius with stacked overlay paths and a diagonal pattern
 * fill, which produced visual confusion ("plaid") and a silent-blank
 * SVG bug at depth-3+ overlap. Lanes eliminate that class of problem
 * by construction — within a single lane, segments never overlap.
 */

import type { TimelineItem } from '../../types/timeline';
import { parseDuration, parseWhenField } from '../../utils/date';
import { formatNumber } from '../../utils/svg';
import { BACKDROP_RING_HEIGHT, BACKDROP_TITLE_RADIUS_OFFSET } from '../layout/LayoutConstants';
import { isBeatNote, sortScenes, type PluginRendererFacade } from '../../utils/sceneHelpers';
import { appendSynopsisElementForScene } from '../utils/SynopsisBuilder';
import { makeSceneId } from '../../utils/numberSquareHelpers';


/**
 * Escape XML/SVG special characters in text destined for SVG <text> content
 * or attribute values. A single unescaped `&` (e.g. "Hunsford & Rosings")
 * makes the whole SVG invalid and the browser drops it silently — no console
 * error, just a blank timeline. Must escape `&` first so subsequent
 * replacements don't re-escape ampersands they introduce.
 */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}


interface BackdropSegment {
    scene: TimelineItem;
    startAngle: number;
    endAngle: number;
    lane: number;
}

export type BackdropRingLayout = {
    segments: BackdropSegment[];
    laneCount: number;
};


/**
 * Build the lane layout for backdrops without drawing anything.
 *
 * Returns the segments tagged with their lane assignment plus the total
 * lane count. Callers can use `laneCount` to reserve radial space (e.g.
 * to shift the micro-backdrop ring inward when laneCount > 1).
 *
 * Filters out backdrops with non-finite angles (e.g. from bad date input)
 * with a console.warn naming the offending file. This prevents a single
 * malformed backdrop from blanking the whole timeline via NaN-string
 * propagation into SVG path coordinates.
 */
export function buildBackdropRingLayout(scenes: TimelineItem[]): BackdropRingLayout {
    // 1. Filter for valid Backdrop items.
    const backdropItems = scenes.filter(s => s.itemType === 'Backdrop' && s.when && (s.Duration || s.End));
    if (backdropItems.length === 0) {
        return { segments: [], laneCount: 0 };
    }

    // 2. Build the scene-ring reference (same dedup+sort as Chronologue.ts)
    //    so our angular calculations align with the scene squares.
    const seenPaths = new Set<string>();
    const candidates: TimelineItem[] = [];
    scenes.forEach(s => {
        if (isBeatNote(s) || s.itemType === 'Backdrop') return;
        const key = s.path || `${s.title || ''}::${String(s.when || '')}`;
        if (!seenPaths.has(key)) {
            if (s.when && s.when instanceof Date && !isNaN(s.when.getTime())) {
                seenPaths.add(key);
                candidates.push(s);
            }
        }
    });
    const sortedScenes = sortScenes(candidates, true, true);
    if (sortedScenes.length === 0) {
        return { segments: [], laneCount: 0 };
    }

    const startAngle = -Math.PI / 2;
    const endAngle = (3 * Math.PI) / 2;
    const totalAngle = endAngle - startAngle;
    const angularSize = totalAngle / sortedScenes.length;

    function mapTimestampToSceneIndexAngle(timeMs: number, bias: 'start' | 'end' = 'end'): number {
        let prevIndex = -1;
        for (let i = 0; i < sortedScenes.length; i++) {
            const sceneTime = sortedScenes[i].when!.getTime();
            const condition = bias === 'start' ? sceneTime < timeMs : sceneTime <= timeMs;
            if (condition) prevIndex = i;
            else break;
        }
        if (prevIndex === -1) return startAngle;
        if (prevIndex === sortedScenes.length - 1) {
            return startAngle + (prevIndex * angularSize) + angularSize;
        }
        const prevScene = sortedScenes[prevIndex];
        const nextScene = sortedScenes[prevIndex + 1];
        const prevTime = prevScene.when!.getTime();
        const nextTime = nextScene.when!.getTime();
        const segmentDuration = nextTime - prevTime;
        const progress = segmentDuration > 0 ? (timeMs - prevTime) / segmentDuration : 0;
        const prevAngle = startAngle + (prevIndex * angularSize);
        return prevAngle + (progress * angularSize);
    }

    // 3. Compute angular extents for each backdrop.
    const rawSegments: BackdropSegment[] = [];
    backdropItems.forEach(item => {
        const itemStart = item.when!.getTime();
        let itemEnd: number;
        if (item.End) {
            const parsedEnd = parseWhenField(item.End);
            itemEnd = parsedEnd ? parsedEnd.getTime() : itemStart;
        } else {
            const duration = parseDuration(item.Duration) || 0;
            itemEnd = itemStart + duration;
        }

        const viewStartMs = sortedScenes[0].when!.getTime();
        const viewEndMs = sortedScenes[sortedScenes.length - 1].when!.getTime();
        const clampedStartMs = Math.max(itemStart, viewStartMs);
        const clampedEndMs = Math.min(itemEnd, viewEndMs);

        if (clampedStartMs >= clampedEndMs && itemStart < viewStartMs && itemEnd < viewStartMs) return;
        if (clampedStartMs >= clampedEndMs && itemStart > viewEndMs) return;

        let computedStartAngle = mapTimestampToSceneIndexAngle(clampedStartMs, 'start');
        let computedEndAngle = mapTimestampToSceneIndexAngle(clampedEndMs, 'end');

        // Guard against zero-width and full-circle degenerate paths.
        const epsilon = 0.002;
        const span = computedEndAngle - computedStartAngle;
        const fullCircleSpan = totalAngle - epsilon;
        if (span <= 0) {
            computedEndAngle = computedStartAngle + epsilon;
        } else if (span >= totalAngle - 1e-4) {
            computedEndAngle = computedStartAngle + fullCircleSpan;
        }

        // Defensive: drop any segment whose angles are non-finite (NaN from
        // bad upstream date parse). Browsers render "NaN" path coordinates
        // as nothing, which silently blanked the whole timeline in the
        // pre-lane architecture.
        if (!Number.isFinite(computedStartAngle) || !Number.isFinite(computedEndAngle)) {
             
            console.warn(
                '[radial-timeline] dropping backdrop with non-finite angles:',
                item.title || item.path,
                { startAngle: computedStartAngle, endAngle: computedEndAngle }
            );
            return;
        }

        rawSegments.push({
            scene: item,
            startAngle: computedStartAngle,
            endAngle: computedEndAngle,
            lane: -1,
        });
    });

    if (rawSegments.length === 0) {
        return { segments: [], laneCount: 0 };
    }

    // 4. Greedy lane assignment, sorted chronologically (by start angle).
    //    A lane accepts a candidate iff every pairwise overlap with the
    //    lane's existing segments stays at or below MAX_PAIRWISE_OVERLAP
    //    of the SHORTER segment in that pair.
    //
    //    Why the shorter-segment denominator: it catches "small fully
    //    inside big" cases. A short backdrop entirely contained in a
    //    longer one would otherwise look fine by candidate-percentage
    //    alone, but the short one's plaid would cover 100% of itself —
    //    visually it's been swallowed. Measuring against the shorter
    //    span makes burial the disqualifier, not raw overlap length.
    //
    //    The 50% cap means a pair can share a lane as long as each
    //    backdrop is visible (non-overlap region) for at least half its
    //    own span. Multiple non-burying overlap pairs can share a lane
    //    as long as their overlap regions don't collide into depth-3.
    //
    //    Because we scan outer-to-inner and process chronologically, a
    //    backdrop's typical lane reflects its position in time.
    const MAX_PAIRWISE_OVERLAP = 0.5;
    const sortedByStart = rawSegments.slice().sort((a, b) => a.startAngle - b.startAngle);
    const lanes: BackdropSegment[][] = [];
    sortedByStart.forEach(segment => {
        let assigned = false;
        for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
            if (maxPairwiseOverlapRatio(lanes[laneIndex], segment) <= MAX_PAIRWISE_OVERLAP) {
                segment.lane = laneIndex;
                lanes[laneIndex].push(segment);
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            segment.lane = lanes.length;
            lanes.push([segment]);
        }
    });

    return { segments: sortedByStart, laneCount: lanes.length };
}


/**
 * For a candidate segment and a lane's existing segments, return the
 * largest pairwise overlap ratio — overlap length divided by the SHORTER
 * of the two segments' total spans.
 *
 * Using the shorter denominator makes "small fully inside big" yield
 * ratio 1.0 (full burial of the small segment), which the lane rule
 * rejects. Two same-sized segments overlapping halfway yields 0.5
 * (boundary). Returns 0 when there's no overlap at all.
 */
function maxPairwiseOverlapRatio(
    lane: BackdropSegment[],
    candidate: BackdropSegment
): number {
    let maxRatio = 0;
    const candSize = candidate.endAngle - candidate.startAngle;
    for (const seg of lane) {
        const overlapStart = Math.max(seg.startAngle, candidate.startAngle);
        const overlapEnd = Math.min(seg.endAngle, candidate.endAngle);
        const overlapSize = overlapEnd - overlapStart;
        if (overlapSize <= 0) continue;
        const segSize = seg.endAngle - seg.startAngle;
        const denom = Math.min(candSize, segSize);
        if (denom <= 0) continue;
        const ratio = overlapSize / denom;
        if (ratio > maxRatio) maxRatio = ratio;
    }
    return maxRatio;
}


export type BackdropRingOptions = {
    plugin: PluginRendererFacade;
    scenes: TimelineItem[]; // still needed for the synopsis appender's context
    layout: BackdropRingLayout;
    availableRadius: number; // center radius of the outermost lane (lane 0)
    synopsesElements: SVGGElement[];
    maxTextWidth: number;
    masterSubplotOrder: string[];
};

export function renderBackdropRing({
    plugin,
    scenes,
    layout,
    availableRadius,
    synopsesElements,
    maxTextWidth,
    masterSubplotOrder,
}: BackdropRingOptions): string {
    if (!layout.segments.length) return '';

    let svg = `<g class="rt-backdrop-ring">`;

    // Diagonal-stripe pattern used to mark depth-2 overlap regions where
    // two backdrops share a lane. Lane assignment guarantees depth never
    // exceeds 2, so we only need one pattern. Colors come from the same
    // CSS variables the subplot ring uses so themes stay consistent.
    svg += `<defs>
        <pattern id="rt-backdrop-diagonal" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="0" y="0" width="7" height="14" fill="var(--rt-subplot-colors-0)" fill-opacity="0.45" />
            <rect x="7" y="0" width="7" height="14" fill="var(--rt-subplot-colors-1)" fill-opacity="0.45" />
        </pattern>
    </defs>`;

    // Lane backgrounds sit behind the segments. The lane borders are drawn
    // last instead (see below) so segments can fill their lane edge to edge
    // without a dead band between them and the neighbouring ring.
    for (let lane = 0; lane < layout.laneCount; lane++) {
        const laneCenter = availableRadius - lane * BACKDROP_RING_HEIGHT;
        svg += `<circle cx="0" cy="0" r="${formatNumber(laneCenter)}" class="rt-backdrop-ring-background" stroke-width="${BACKDROP_RING_HEIGHT}" pointer-events="none" fill="none" />`;
    }

    // One segment per backdrop, drawn at its lane's radius.
    layout.segments.forEach((seg, idx) => {
        const laneCenter = availableRadius - seg.lane * BACKDROP_RING_HEIGHT;
        const largeArcFlag = (seg.endAngle - seg.startAngle) > Math.PI ? 1 : 0;

        // Text path runs along the lane (offset by constant — currently
        // negative so text rides just inside the lane's outer border).
        const textRadius = laneCenter + BACKDROP_TITLE_RADIUS_OFFSET;
        const tx1 = formatNumber(textRadius * Math.cos(seg.startAngle));
        const ty1 = formatNumber(textRadius * Math.sin(seg.startAngle));
        const tx2 = formatNumber(textRadius * Math.cos(seg.endAngle));
        const ty2 = formatNumber(textRadius * Math.sin(seg.endAngle));
        const td = `M ${tx1} ${ty1} A ${formatNumber(textRadius)} ${formatNumber(textRadius)} 0 ${largeArcFlag} 1 ${tx2} ${ty2}`;

        const pathId = `backdrop-arc-${idx}`;
        const sceneUniqueKey = seg.scene.path || `${seg.scene.title || ''}::${seg.scene.number ?? ''}::${String(seg.scene.when ?? '')}`;
        const sceneId = makeSceneId(0, 1, idx, true, true, sceneUniqueKey);

        appendSynopsisElementForScene({
            plugin,
            scene: seg.scene,
            sceneId,
            maxTextWidth,
            masterSubplotOrder,
            scenes,
            targets: synopsesElements,
        });

        const encodedPath = encodeURIComponent(seg.scene.path || '');
        svg += `<g class="rt-scene-group" data-item-type="Backdrop" data-path="${encodedPath}" data-backdrop-lane="${seg.lane}">`;
        svg += `<defs><path id="${pathId}" d="${td}" /></defs>`;

        // Filled box geometry for the segment, centered on the lane radius.
        // Full lane height: an inset here left an unhittable band between the
        // segment and the ring beside it, so crossing into the backdrop lost
        // the hover for a frame and flickered.
        const halfHeight = BACKDROP_RING_HEIGHT / 2;
        const boxInnerRadius = laneCenter - halfHeight;
        const boxOuterRadius = laneCenter + halfHeight;
        const boxLargeArcFlag = largeArcFlag;

        const startInnerX = formatNumber(boxInnerRadius * Math.cos(seg.startAngle));
        const startInnerY = formatNumber(boxInnerRadius * Math.sin(seg.startAngle));
        const startOuterX = formatNumber(boxOuterRadius * Math.cos(seg.startAngle));
        const startOuterY = formatNumber(boxOuterRadius * Math.sin(seg.startAngle));
        const endInnerX = formatNumber(boxInnerRadius * Math.cos(seg.endAngle));
        const endInnerY = formatNumber(boxInnerRadius * Math.sin(seg.endAngle));
        const endOuterX = formatNumber(boxOuterRadius * Math.cos(seg.endAngle));
        const endOuterY = formatNumber(boxOuterRadius * Math.sin(seg.endAngle));

        const boxPath = `M ${startOuterX} ${startOuterY} ` +
            `A ${formatNumber(boxOuterRadius)} ${formatNumber(boxOuterRadius)} 0 ${boxLargeArcFlag} 1 ${endOuterX} ${endOuterY} ` +
            `L ${endInnerX} ${endInnerY} ` +
            `A ${formatNumber(boxInnerRadius)} ${formatNumber(boxInnerRadius)} 0 ${boxLargeArcFlag} 0 ${startInnerX} ${startInnerY} ` +
            `Z`;

        svg += `<path id="${sceneId}" d="${boxPath}" class="rt-backdrop-segment rt-scene-path" pointer-events="all" data-scene-id="${sceneId}" />`;

        // Repeating title text along the textPath.
        const title = seg.scene.title || 'Untitled';
        const textPadding = 4;
        const totalArcLen = textRadius * (seg.endAngle - seg.startAngle);
        const usableArcLen = Math.max(0, totalArcLen - (textPadding * 2));
        const estimatedTextWidth = (title.length * 14) + 30;
        const repeatCount = Math.ceil(usableArcLen / estimatedTextWidth) + 2;
        // CRITICAL: escape XML special characters in the title before injecting
        // into SVG text content. An unescaped `&` (e.g. "Hunsford & Rosings")
        // produces invalid SVG that browsers silently drop — blanking the
        // whole timeline with no console error.
        const safeTitle = escapeXml(title);
        const content = (safeTitle + ' • ').repeat(repeatCount);

        svg += `<text class="rt-backdrop-label">
            <textPath href="#${pathId}" startOffset="${textPadding}" spacing="auto" method="align">
                ${content}
            </textPath>
        </text>`;

        svg += `</g>`;
    });

    // Overlay diagonal-stripe boxes over depth-2 overlap regions within
    // each lane. Drawn AFTER the segments so they sit on top of both
    // overlapping bands, visually announcing "two things here." The lane
    // assignment rule guarantees these regions never have depth > 2, so
    // a single overlay per region suffices — no stacking.
    svg += renderOverlapOverlays(layout, availableRadius);

    // Lane borders on top of the segments, so they read as the ring's edge at
    // full width rather than being half-covered. pointer-events none: a
    // decorative hairline that can take the hover is the same flicker by
    // another route.
    for (let lane = 0; lane < layout.laneCount; lane++) {
        const laneCenter = availableRadius - lane * BACKDROP_RING_HEIGHT;
        const innerBorderR = laneCenter - (BACKDROP_RING_HEIGHT / 2);
        const outerBorderR = laneCenter + (BACKDROP_RING_HEIGHT / 2);
        svg += `<circle cx="0" cy="0" r="${formatNumber(innerBorderR)}" class="rt-backdrop-border" pointer-events="none" fill="none" />`;
        svg += `<circle cx="0" cy="0" r="${formatNumber(outerBorderR)}" class="rt-backdrop-border" pointer-events="none" fill="none" />`;
    }

    svg += `</g>`;
    return svg;
}


/**
 * For each lane, find the angular regions where exactly two segments are
 * simultaneously active and emit a striped overlay box at each. Lanes
 * with 0 or 1 segments produce no overlays. Depth is capped at 2 by the
 * lane-assignment rule, so we never produce stacked overlays.
 */
function renderOverlapOverlays(
    layout: BackdropRingLayout,
    availableRadius: number
): string {
    let svg = '';
    for (let laneIndex = 0; laneIndex < layout.laneCount; laneIndex++) {
        const segs = layout.segments.filter(s => s.lane === laneIndex);
        if (segs.length < 2) continue;

        // Sweep over segment boundaries within this lane. Whenever the
        // active count rises to 2, mark an overlap-start; when it drops
        // back to 1, emit the accumulated overlap region.
        type Event = { angle: number; delta: number };
        const events: Event[] = [];
        for (const seg of segs) {
            events.push({ angle: seg.startAngle, delta: +1 });
            events.push({ angle: seg.endAngle, delta: -1 });
        }
        // Process ends before starts at identical angles so a touching
        // boundary doesn't register as a transient overlap.
        events.sort((a, b) => a.angle - b.angle || a.delta - b.delta);

        const laneCenter = availableRadius - laneIndex * BACKDROP_RING_HEIGHT;
        // Matches the segment box it overlays.
        const halfHeight = BACKDROP_RING_HEIGHT / 2;
        const innerR = laneCenter - halfHeight;
        const outerR = laneCenter + halfHeight;

        let active = 0;
        let overlapStart: number | null = null;
        for (const ev of events) {
            const before = active;
            active += ev.delta;
            if (before < 2 && active >= 2) {
                overlapStart = ev.angle;
            } else if (before >= 2 && active < 2 && overlapStart !== null) {
                const overlapEnd = ev.angle;
                if (overlapEnd > overlapStart) {
                    svg += buildOverlapBoxPath(overlapStart, overlapEnd, innerR, outerR);
                }
                overlapStart = null;
            }
        }
    }
    return svg;
}


function buildOverlapBoxPath(
    startAngle: number,
    endAngle: number,
    innerR: number,
    outerR: number
): string {
    const largeArcFlag = (endAngle - startAngle) > Math.PI ? 1 : 0;
    const startInnerX = formatNumber(innerR * Math.cos(startAngle));
    const startInnerY = formatNumber(innerR * Math.sin(startAngle));
    const startOuterX = formatNumber(outerR * Math.cos(startAngle));
    const startOuterY = formatNumber(outerR * Math.sin(startAngle));
    const endInnerX = formatNumber(innerR * Math.cos(endAngle));
    const endInnerY = formatNumber(innerR * Math.sin(endAngle));
    const endOuterX = formatNumber(outerR * Math.cos(endAngle));
    const endOuterY = formatNumber(outerR * Math.sin(endAngle));

    const d =
        `M ${startOuterX} ${startOuterY} ` +
        `A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 ${largeArcFlag} 1 ${endOuterX} ${endOuterY} ` +
        `L ${endInnerX} ${endInnerY} ` +
        `A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 ${largeArcFlag} 0 ${startInnerX} ${startInnerY} ` +
        `Z`;

    return `<path d="${d}" class="rt-backdrop-overlap" pointer-events="none" />`;
}
