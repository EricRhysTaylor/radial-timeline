import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../../types';
import { computeChronologueLayout } from '../../renderer/utils/SceneLayout';
import { renderTimeReferenceMarkers } from './render';
import { renderRings } from '../../renderer/renderers/RingRenderer';

vi.mock('../../renderer/utils/FontMetricsCache', () => ({ estimateBeatLabelWidth: (title: string) => title.length * 8 }));
vi.mock('../../renderer/utils/SynopsisBuilder', () => ({ appendSynopsisElementForScene: () => undefined }));
vi.mock('../../renderer/utils/subplotColors', () => ({ readSubplotColor: () => '#996699' }));
afterEach(() => vi.unstubAllGlobals());

const start = -Math.PI / 2, end = 3 * Math.PI / 2;
const source = (subplot: string, dates = ['1952']): TimelineItem => ({ path: '12.md', title: '12 Source', date: '', when: new Date('2026-10-14T12:00:00'), subplot,
    rawFrontmatter: { When: '2026-10-14', 'Time References': dates.map((When, i) => ({ Label: `A <memory> ${i}`, When, Kind: 'recollection' })) } });
const render = (dates: string[], inner = 400, outer = 460) => {
    const items = [source('History', dates)], layout = computeChronologueLayout(inner, outer, start, end, items);
    return renderTimeReferenceMarkers(items, layout.positions, layout.slots, inner, outer, 0, () => 'var(--rt-subplot-colors-1)');
};
describe('reference occurrences across actual ring layouts', () => {
    it.each(['fill', 'sequence'])('renders references once on All Scenes while preserving subplot scenes: %s', subplotAlignment => {
        vi.stubGlobal('activeDocument', {});
        const scenes = [source('Family', ['1952', '2040']), source('History', ['1952', '2040'])].map(item => ({ ...item, actNumber: 1 }));
        const plugin = { settings: { currentMode: 'chronologue', subplotAlignment, actCount: 1 }, openScenePaths: new Set() };
        const markup = renderRings({ plugin: plugin as never, scenes, actsToRender: 1, sortByWhen: true,
            isChronologueMode: true, forceChronological: true, masterSubplotOrder: ['Main Plot', 'Family', 'History'],
            colorIndexBySubplot: new Map([['Main Plot', 0], ['Family', 1], ['History', 2]]),
            ringStartRadii: [200, 400, 600], ringWidths: [200, 200, 200],
            scenesByActAndSubplot: { 0: { Family: [scenes[0]], History: [scenes[1]] } },
            PUBLISH_STAGE_COLORS: { Zero: '#996699' }, maxTextWidth: 120, synopsesElements: [] });
        expect(markup.match(/class="ert-time-reference"/g)).toHaveLength(2);
        expect(markup.match(/class="ert-time-reference-origin"/g)).toHaveLength(1);
        expect(markup.match(/class="rt-scene-group/g)).toHaveLength(3);
        const occurrences = [...markup.matchAll(/<g class="ert-time-reference"[^>]*data-ring="(\d+)"/g)];
        expect(occurrences.map(match => match[1])).toEqual(['2', '2']);
        expect(markup).toContain('12 · Source');
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
        const squares = Array.from(markup.matchAll(/<g transform="translate\(([^ ]+) ([^)]+)\) rotate\(([^)]+)\)"><rect class="ert-time-reference-slice" x="[^"]+" y="[^"]+" width="([^"]+)"/g), m => m.slice(1).map(Number));
        expect(squares).toHaveLength(2);
        const radii = squares.map(([x, y, rotation]) => {
            expect(Math.cos(rotation * Math.PI / 180)).toBeCloseTo(Math.cos(Math.atan2(y, x) + Math.PI / 2));
            return Math.hypot(x, y);
        });
        expect(radii[0]).toBeCloseTo(408.8);
        expect(radii[1] - radii[0]).toBeCloseTo(6);
        expect(markup).not.toContain('ert-time-reference-halo');
        expect(markup).toContain('d="M22 12h-2.48');
    });
    it('uses circular label paths and a larger source square, with upright lower-half source text', () => {
        const markup = render(['1952', '2040']);
        expect(markup.match(/<textPath /g)).toHaveLength(3);
        const sourceMark = markup.match(/class="ert-time-reference-source-mark"[^>]*width="([^"]+)"/);
        expect(Number(sourceMark![1])).toBeGreaterThan(9.6 * 1.35);
        expect(markup).not.toContain('<circle');
        const label = markup.match(/class="ert-time-reference-origin-label"[^>]*><textPath href="#([^"]+)"/);
        const sourcePath = markup.match(new RegExp(`<path id="${label![1]}" d="([^"]+)"`));
        expect(sourcePath![1]).toContain(' A 422.8 422.8 0 0 0 ');
    });
    it('keeps overflow on its own side of the seam across ring sizes', () => {
        const items = [source('History', Array(5).fill('1952'))];
        for (const [inner, outside] of [[200, 320], [400, 520], [700, 900]]) {
            const local = computeChronologueLayout(inner, outside, start, end, items);
            const markup = renderTimeReferenceMarkers(items, local.positions, local.slots, inner, outside, 0, () => 'purple');
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
