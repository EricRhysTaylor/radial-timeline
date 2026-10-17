import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { buildOuterRingSequence } from '../../renderer/utils/OuterRingSequence';
import { alignPositionsToOuterRing, computeChronologueLayout } from '../../renderer/utils/SceneLayout';
import { renderTimeReferenceMarkers } from './render';

const start = -Math.PI / 2, end = 3 * Math.PI / 2;
const source = (subplot: string, dates = ['1952']): TimelineItem => ({ path: '12.md', title: '12 Source', date: '', when: new Date('2026-10-14T12:00:00'), subplot,
    rawFrontmatter: { When: '2026-10-14', 'Time References': dates.map((When, i) => ({ Label: `A <memory> ${i}`, When, Kind: 'recollection' })) } });
const render = (dates: string[], inner = 400, outer = 460) => {
    const items = [source('History', dates)], layout = computeChronologueLayout(inner, outer, start, end, items);
    return renderTimeReferenceMarkers(items, layout.positions, layout.slots, inner, outer, 0, () => 'var(--rt-subplot-colors-1)');
};
describe('reference occurrences across actual ring layouts', () => {
    it('deduplicates the outer reference while rendering an occurrence in each inherited ring', () => {
        const scenes = [source('Family'), source('History')];
        const outer = buildOuterRingSequence({ scenes, segment: 0, isSagaScope: false, sortByWhen: true, forceChronological: true,
            includeBeats: false, masterSubplotOrder: ['Main Plot', 'Family', 'History'], innerR: 700, outerR: 760, startAngle: start, endAngle: end });
        expect(outer.items).toHaveLength(1);
        expect(outer.referenceSlots).toHaveLength(1);
        let markup = renderTimeReferenceMarkers(outer.items, outer.positions, outer.referenceSlots, 700, 760, 2, () => 'var(--rt-subplot-colors-0)');
        for (const [ring, subplot] of ['Family', 'History'].entries()) {
            const items = [source(subplot)];
            markup += renderTimeReferenceMarkers(items, alignPositionsToOuterRing(items, outer.positionByKey), outer.referenceSlots,
                400 + ring * 100, 460 + ring * 100, ring, () => `var(--rt-subplot-colors-${ring + 1})`);
        }
        expect(markup.match(/class="ert-time-reference"/g)).toHaveLength(3);
        expect(markup.match(/class="ert-time-reference-connector"/g)).toHaveLength(3);
        expect(markup).not.toContain('class="rt-scene-group');
        expect(markup).toContain('A &lt;memory&gt;');
        expect(markup).not.toContain('aria-label=');
    });
    it('uses interior concentric tracks and separate explicit seam terminals', () => {
        const markup = render(['1952', '2040']);
        expect(markup).toContain(' A 440.8 440.8 ');
        expect(markup.match(/ert-time-reference-break/g)).toHaveLength(2);
        expect(markup).toContain('Earlier · 1952');
        expect(markup).toContain('Later · 2040');
        expect(markup).not.toMatch(/NaN|Infinity/);
    });
    it('shows three same-date squares and an actionable overflow containing every remaining reference', () => {
        const markup = render(Array(5).fill('1952'), 400, 520);
        expect(markup.match(/class="ert-time-reference-slice"/g)).toHaveLength(3);
        expect(markup.match(/class="ert-time-reference"/g)).toHaveLength(4);
        expect(markup).toContain('>+2</text>');
        // One shared source/date route, plus its seam break, rather than five coincident paths.
        expect(markup.match(/class="ert-time-reference-connector"/g)).toHaveLength(1);
        for (let i = 0; i < 5; i++) expect(markup).toContain(`A &lt;memory&gt; ${i}`);
    });
    it('returns labels to scene bottoms and lifts only Later slightly above the dominance corner', () => {
        const markup = render(['1952', '2040']);
        const squares = Array.from(markup.matchAll(/<rect class="ert-time-reference-slice" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g), m => m.slice(1).map(Number));
        expect(squares).toHaveLength(2);
        const radii = squares.map(([x, y, width, height]) => Math.hypot(x + width / 2, y + height / 2));
        expect(radii[0]).toBeCloseTo(408.8);
        expect(radii[1] - radii[0]).toBeCloseTo(6);
        expect(markup).not.toContain('ert-time-reference-halo');
        expect(markup).toContain('d="M22 12h-2.48');
    });
    it.each([false, true])('keeps overflow on its own side of the seam with inherited Sequence slots: %s', inherited => {
        const items = [source('History', Array(5).fill('1952'))];
        const outer = computeChronologueLayout(700, 900, start, end, items);
        for (const [inner, outside] of [[200, 320], [400, 520], [700, 900]]) {
            const local = computeChronologueLayout(inner, outside, start, end, items);
            const markup = renderTimeReferenceMarkers(items, local.positions, inherited ? outer.slots : local.slots, inner, outside, 0, () => 'purple');
            const overflow = markup.match(/class="ert-time-reference-count" x="([^"]+)" y="[^"]+" text-anchor="end">\+2/);
            expect(overflow).not.toBeNull();
            // End anchoring makes the whole count extend left, away from the seam.
            expect(Number(overflow![1])).toBeLessThan(-10);
        }
    });
    it('distinguishes multiple off-range dates from a same-date stack', () => {
        const markup = render(['1952', '1986', '1990']);
        expect(markup.match(/class="ert-time-reference-slice"/g)).toHaveLength(1);
        expect(markup).toContain('3 dates');
        for (const date of ['1952', '1986', '1990']) expect(markup).toContain(date);
    });
});
