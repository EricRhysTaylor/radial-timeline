import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import {
    buildNarrativeRuntimeTicks,
    collectNarrativeRuntimeEntries,
    inclusiveRuntimeBetween,
    NARRATIVE_RUNTIME_LABEL_GAP_RAD,
    NARRATIVE_RUNTIME_TOTAL_GAP_RAD,
    runtimeBeforeEachScene,
    type NarrativeRuntimeEntry
} from './NarrativeRuntime';
import { renderNarrativeRuntimeOverlay } from '../components/NarrativeRuntimeOverlay';

function scene(path: string, runtime?: string, extra: Partial<TimelineItem> = {}): TimelineItem {
    return { path, title: path, itemType: 'Scene', Runtime: runtime, ...extra } as TimelineItem;
}

/** Equal slices clockwise from 12 o'clock, as the Narrative outer ring lays them out. */
function equalSlices(paths: string[]): Map<string, { startAngle: number; endAngle: number }> {
    const size = (2 * Math.PI) / paths.length;
    return new Map(paths.map((path, index) => [path, {
        startAngle: -Math.PI / 2 + index * size,
        endAngle: -Math.PI / 2 + (index + 1) * size
    }]));
}

describe('runtimeBeforeEachScene', () => {
    it('starts at zero and adds each scene presented before', () => {
        expect(runtimeBeforeEachScene([60, 120, 30])).toEqual({ before: [0, 60, 180], total: 210 });
    });

    it('adds nothing for scenes without a runtime', () => {
        expect(runtimeBeforeEachScene([60, null, 0, 30])).toEqual({ before: [0, 60, 60, 60], total: 90 });
    });

    it('is empty for an empty book', () => {
        expect(runtimeBeforeEachScene([])).toEqual({ before: [], total: 0 });
    });
});

describe('inclusiveRuntimeBetween', () => {
    const runtimes = [60, 120, null, 30, 300];

    it('sums both selected scenes and every scene between them', () => {
        expect(inclusiveRuntimeBetween(runtimes, 1, 3)).toBe(150);
    });

    it('reads the same in either selection order', () => {
        expect(inclusiveRuntimeBetween(runtimes, 3, 1)).toBe(150);
    });

    it('covers the whole book from first to last scene', () => {
        expect(inclusiveRuntimeBetween(runtimes, 0, 4)).toBe(510);
    });

    it('is the scene itself when both ends are one scene', () => {
        expect(inclusiveRuntimeBetween(runtimes, 4, 4)).toBe(300);
    });
});

describe('collectNarrativeRuntimeEntries', () => {
    it('orders scenes by their place on the outer ring, not by story time', () => {
        const scenes = [
            scene('b.md', '2:00', { when: new Date('2020-01-01') }),
            scene('a.md', '1:00', { when: new Date('2024-01-01') }),
            scene('c.md', '0:30', { when: new Date('2010-01-01') }),
        ];
        const entries = collectNarrativeRuntimeEntries(scenes, equalSlices(['a.md', 'b.md', 'c.md']));
        expect(entries.map(entry => entry.scene.path)).toEqual(['a.md', 'b.md', 'c.md']);
        expect(entries.map(entry => entry.runtimeSeconds)).toEqual([60, 120, 30]);
    });

    it('keeps each scene once and leaves out beats and scenes off the ring', () => {
        const scenes = [
            scene('a.md', '1:00'),
            scene('a.md', '1:00'),
            { path: 'beat.md', title: 'Beat', itemType: 'Beat' } as TimelineItem,
            scene('elsewhere.md', '5:00'),
        ];
        const positions = equalSlices(['a.md', 'beat.md']);
        expect(collectNarrativeRuntimeEntries(scenes, positions).map(entry => entry.scene.path)).toEqual(['a.md']);
    });

    it('reads missing, unreadable and zero runtimes as none', () => {
        const scenes = [scene('a.md'), scene('b.md', 'soon'), scene('c.md', '0')];
        const entries = collectNarrativeRuntimeEntries(scenes, equalSlices(['a.md', 'b.md', 'c.md']));
        expect(entries.map(entry => entry.runtimeSeconds)).toEqual([null, null, null]);
    });
});

describe('buildNarrativeRuntimeTicks', () => {
    const entries: NarrativeRuntimeEntry[] = collectNarrativeRuntimeEntries(
        [scene('a.md', '1:00'), scene('b.md', '2:00'), scene('c.md'), scene('d.md', '0:30')],
        equalSlices(['a.md', 'b.md', 'c.md', 'd.md'])
    );

    it('labels each scene start with the runtime presented before it', () => {
        const labels = buildNarrativeRuntimeTicks(entries).filter(tick => !tick.isLast).map(tick => tick.label);
        expect(labels).toEqual(['0:00', '1:00', '3:00', '3:00']);
    });

    it('closes at the end of the last scene with the total', () => {
        const last = buildNarrativeRuntimeTicks(entries).at(-1);
        expect(last).toMatchObject({ label: '3:30', isLast: true });
        expect(last?.angle).toBeCloseTo(entries[entries.length - 1].endAngle);
    });

    it('opens with 0:00 at the first scene', () => {
        expect(buildNarrativeRuntimeTicks(entries)[0]).toMatchObject({ label: '0:00', isFirst: true, angle: entries[0].startAngle });
    });

    it('leaves crowded scene starts as unlabelled ticks', () => {
        const paths = Array.from({ length: 200 }, (_, index) => `s${index}.md`);
        const crowded = collectNarrativeRuntimeEntries(paths.map(path => scene(path, '1:00')), equalSlices(paths));
        const ticks = buildNarrativeRuntimeTicks(crowded);
        expect(ticks).toHaveLength(201);
        const labelled = ticks.filter(tick => tick.label !== null && !tick.isLast);
        for (let i = 1; i < labelled.length; i++) {
            expect(labelled[i].angle - labelled[i - 1].angle).toBeGreaterThanOrEqual(NARRATIVE_RUNTIME_LABEL_GAP_RAD - 1e-9);
        }
        expect(labelled.length).toBeLessThan(200);
    });

    it('leaves the scene start before the total unlabelled when both labels would overlap', () => {
        const paths = ['a.md', 'b.md', 'c.md', 'd.md'];
        const positions = new Map(paths.map((path, index) => {
            const start = -Math.PI / 2 + index * 0.12;
            return [path, { startAngle: start, endAngle: start + 0.12 }] as const;
        }));
        const ticks = buildNarrativeRuntimeTicks(collectNarrativeRuntimeEntries(paths.map(path => scene(path, '1:00')), positions));
        const end = ticks.at(-1)!.angle;
        ticks.filter(tick => tick.label !== null && !tick.isLast && !tick.isFirst).forEach(tick => {
            expect(end - tick.angle).toBeGreaterThanOrEqual(NARRATIVE_RUNTIME_TOTAL_GAP_RAD - 1e-9);
        });
        expect(ticks.at(-2)?.label).toBeNull();
    });

    it('is empty for a book with no scenes on the ring', () => {
        expect(buildNarrativeRuntimeTicks([])).toEqual([]);
    });
});

describe('renderNarrativeRuntimeOverlay', () => {
    const params = { arcRadius: 758, labelRadius: 790, tickStart: 764, tickEnd: 799 };

    it('carries each scene in narrative order with its runtime and its own equal slice', () => {
        const entries = collectNarrativeRuntimeEntries(
            [scene('a.md', '1:00'), scene('b.md', '4:00'), scene('c.md')],
            equalSlices(['a.md', 'b.md', 'c.md'])
        );
        const svg = renderNarrativeRuntimeOverlay({ entries, ...params });
        const groups = [...svg.matchAll(/<g class="rt-runtime-scene" data-path="([^"]*)" data-runtime-index="(\d+)" data-runtime-seconds="([^"]*)" data-start-angle="([^"]*)" data-end-angle="([^"]*)"/g)];
        expect(groups.map(match => match[1])).toEqual(['a.md', 'b.md', 'c.md']);
        expect(groups.map(match => match[3])).toEqual(['60', '240', '0']);
        const spans = groups.map(match => parseFloat(match[5]) - parseFloat(match[4]));
        spans.forEach(span => expect(span).toBeCloseTo((2 * Math.PI) / 3, 3));
    });

    it('draws runtime arcs for scenes with runtime and a red stub for a scene without', () => {
        const entries = collectNarrativeRuntimeEntries(
            [scene('a.md', '1:00'), scene('b.md', '4:00'), scene('c.md')],
            equalSlices(['a.md', 'b.md', 'c.md'])
        );
        const svg = renderNarrativeRuntimeOverlay({ entries, ...params });
        expect(svg.match(/class="rt-duration-arc"/g)).toHaveLength(2);
        expect(svg.match(/rt-duration-arc-unparseable/g)).toHaveLength(1);
        expect(svg.match(/class="rt-runtime-tick-label">([^<]*)</g)).toEqual([
            'class="rt-runtime-tick-label">1:00<',
            'class="rt-runtime-tick-label">4:00<'
        ]);
    });

    it('labels the perimeter from 0:00 to the total', () => {
        const entries = collectNarrativeRuntimeEntries(
            [scene('a.md', '1:00'), scene('b.md', '4:00')],
            equalSlices(['a.md', 'b.md'])
        );
        const svg = renderNarrativeRuntimeOverlay({ entries, ...params });
        const labels = [...svg.matchAll(/<text class="(rt-runtime-outer-label[^"]*)"><textPath [^>]*>([^<]*)</g)].map(match => [match[1], match[2]]);
        expect(labels).toEqual([
            ['rt-runtime-outer-label rt-runtime-outer-label-first', '0:00'],
            ['rt-runtime-outer-label', '1:00'],
            ['rt-runtime-outer-label rt-runtime-outer-label-last', '5:00'],
        ]);
    });

    it('renders nothing without scenes', () => {
        expect(renderNarrativeRuntimeOverlay({ entries: [], ...params })).toBe('');
    });
});
