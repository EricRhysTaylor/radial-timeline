import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { computeCacheableValues } from './Precompute';
import { createSearchState } from '../../services/searchState';
import { MIN_TIMELINE_RINGS, placeholderRingCount } from '../modules/ModeRenderingHelpers';
import { placeholderRingGeometry, renderPlaceholderRings } from '../components/PlaceholderRings';
import { INNER_RADIUS, SUBPLOT_OUTER_RADIUS_STANDARD } from '../layout/LayoutConstants';

function makePlugin(currentMode: string) {
    return {
        settings: {
            currentMode,
            publishStageColors: { Zero: '#9900ff', Author: '#3366ff', House: '#33aa44', Press: '#ffaa00' },
            subplotColors: ['#eeeeee'],
            enableAiSceneAnalysis: false,
            actCount: 3,
        },
        searchState: createSearchState(),
        openScenePaths: new Set<string>(),
        desaturateColor: (hex: string) => hex,
        calculateCompletionEstimate: () => null,
    };
}

function scene(n: number, subplot: string): TimelineItem {
    return { title: `${n} Scene ${n}`, path: `Book/${n}.md`, date: '', itemType: 'Scene', subplot, actNumber: 1 };
}

function book(subplots: string[]): TimelineItem[] {
    return subplots.map((subplot, i) => scene(i + 1, subplot));
}

function rings(mode: string, scenes: TimelineItem[]) {
    const values = computeCacheableValues(makePlugin(mode) as never, scenes, { ownSubplotColors: new Map() });
    return { real: values.masterSubplotOrder.length, placeholders: values.placeholderRings.length, values };
}

describe('placeholderRingCount', () => {
    it('pads the ring views to three, and never pads a view that already has three', () => {
        for (const mode of ['narrative', 'progress']) {
            expect(placeholderRingCount(mode, 0)).toBe(3);
            expect(placeholderRingCount(mode, 1)).toBe(2);
            expect(placeholderRingCount(mode, 2)).toBe(1);
            expect(placeholderRingCount(mode, 3)).toBe(0);
            expect(placeholderRingCount(mode, 4)).toBe(0);
        }
    });

    it('leaves Chronologue and Gossamer stacks as they are, except the zero state', () => {
        for (const mode of ['chronologue', 'gossamer']) {
            expect(placeholderRingCount(mode, 0)).toBe(MIN_TIMELINE_RINGS);
            expect(placeholderRingCount(mode, 1)).toBe(0);
            expect(placeholderRingCount(mode, 2)).toBe(0);
        }
    });
});

describe('the timeline ring stack', () => {
    it('0 scenes: three placeholders in every mode', () => {
        for (const mode of ['narrative', 'progress', 'chronologue', 'gossamer']) {
            const { real, placeholders } = rings(mode, []);
            expect({ mode, real, placeholders }).toEqual({ mode, real: 0, placeholders: 3 });
        }
    });

    it('Main Plot only: one real ring (the outer ring) plus two placeholders', () => {
        for (const mode of ['narrative', 'progress']) {
            expect(rings(mode, book(['Main Plot', 'Main Plot']))).toMatchObject({ real: 1, placeholders: 2 });
        }
        // Gossamer and Chronologue keep the single ring they always drew.
        expect(rings('gossamer', book(['Main Plot']))).toMatchObject({ real: 1, placeholders: 0 });
        expect(rings('chronologue', book(['Main Plot']))).toMatchObject({ real: 1, placeholders: 0 });
    });

    it('two subplots: Narrative and Progress draw two rings, so one placeholder', () => {
        // Narrative's outer ring holds every scene in Main Plot's slot; Progress
        // holds Main Plot alone there. Either way two rings, plus one placeholder.
        for (const mode of ['narrative', 'progress']) {
            expect(rings(mode, book(['Main Plot', 'Thread']))).toMatchObject({ real: 2, placeholders: 1 });
        }
        expect(rings('gossamer', book(['Main Plot', 'Thread']))).toMatchObject({ real: 2, placeholders: 0 });
    });

    it('four subplots: no placeholders', () => {
        for (const mode of ['narrative', 'progress', 'chronologue', 'gossamer']) {
            expect(rings(mode, book(['Main Plot', 'A', 'B', 'C']))).toMatchObject({ real: 4, placeholders: 0 });
        }
    });

    it('placeholders take the innermost bands and the first scene lands without the rings moving', () => {
        const empty = rings('narrative', []).values;
        const one = rings('narrative', book(['Main Plot'])).values;
        const outerBand = empty.placeholderRings[2];
        expect(empty.placeholderRings[0].innerR).toBe(INNER_RADIUS);
        expect(empty.placeholderRings[2].outerR).toBeCloseTo(SUBPLOT_OUTER_RADIUS_STANDARD.normal, 6);
        // The real ring keeps index 0 in ringStartRadii and sits where the outermost placeholder was.
        expect(one.ringStartRadii[0]).toBeCloseTo(outerBand.innerR, 6);
        expect(one.ringStartRadii[0] + one.ringWidths[0]).toBeCloseTo(outerBand.outerR, 6);
        expect(one.placeholderRings.map(r => r.innerR)).toEqual(empty.placeholderRings.slice(0, 2).map(r => r.innerR));
    });

    it('a full book is laid out exactly as before', () => {
        const values = rings('narrative', book(['Main Plot', 'A', 'B'])).values;
        expect(values.placeholderRings).toEqual([]);
        expect(values.ringStartRadii[0]).toBe(INNER_RADIUS);
    });
});

describe('renderPlaceholderRings', () => {
    it('draws an outline and an inset band in the Community proportions, with no cells', () => {
        const g = placeholderRingGeometry({ innerR: 200, outerR: 388 });
        expect(g.outlineInnerR).toBe(208);
        expect(g.outlineOuterR).toBe(380);
        expect(g.bandInnerR).toBeCloseTo(200 + 188 * 0.24, 6);
        expect(g.bandOuterR).toBeCloseTo(388 - 188 * 0.24, 6);

        const svg = renderPlaceholderRings([{ innerR: 200, outerR: 388 }]);
        expect(svg).toContain('ert-placeholder-ring-outline');
        expect(svg).toContain('ert-placeholder-ring-band');
        expect(svg).toContain('pointer-events="none"');
        expect(svg).not.toContain('rt-void-cell');
        expect(svg).not.toContain('rt-scene');
        expect(svg).not.toContain('data-ring');
        expect(renderPlaceholderRings([])).toBe('');
    });
});
