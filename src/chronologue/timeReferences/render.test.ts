import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../../types';
import { computeChronologueLayout } from '../../renderer/utils/SceneLayout';
import { referenceDirection, renderTimeReferenceMarkers } from './render';
import { readTimeReferences } from './model';
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
    return renderTimeReferenceMarkers(items, layout.positions, layout.slots, inner, outer, 0);
};
describe('reference occurrences across actual ring layouts', () => {
    it.each(['fill', 'sequence'])('renders references once on All Scenes while preserving subplot scenes: %s', subplotAlignment => {
        vi.stubGlobal('activeDocument', {});
        const scenes = [source('Family', ['1952', '2040']), source('History', ['1952', '2040'])].map(item => ({ ...item, actNumber: 1 }));
        const plugin = { settings: { currentMode: 'chronologue', subplotAlignment, actCount: 1 }, openScenePaths: new Set() };
        const foregroundElements: string[] = [], referenceElements: string[] = [];
        const scenesMarkup = renderRings({ plugin: plugin as never, scenes, actsToRender: 1, sortByWhen: true,
            isChronologueMode: true, forceChronological: true, masterSubplotOrder: ['Main Plot', 'Family', 'History'],
            subplotColorFor: () => '#996699',
            ringStartRadii: [200, 400, 600], ringWidths: [200, 200, 200],
            scenesByActAndSubplot: { 0: { Family: [scenes[0]], History: [scenes[1]] } },
            PUBLISH_STAGE_COLORS: { Zero: '#996699' }, maxTextWidth: 120, synopsesElements: [], foregroundElements, referenceElements });
        const foreground = foregroundElements.join('');
        const markup = scenesMarkup + foreground + referenceElements.join('');
        expect(scenesMarkup).not.toContain('class="ert-time-reference"');
        // References paint in their own layer, above the Chronologue overlays; the foreground keeps the titles.
        expect(foreground).not.toContain('ert-time-reference');
        expect(foreground.match(/<use href="#scene-title-/g)).toHaveLength(3);
        expect(scenesMarkup.match(/<defs><text id="scene-title-/g)).toHaveLength(3);
        // Clip the painted instance outside its shadow tree so Chromium resolves
        // the scene path. The source remains in its scene group for live updates.
        const paintedTitles = [...foreground.matchAll(/<use href="#scene-title-([^"]+)" clip-path="url\(#clip-([^)]+)\)"/g)];
        expect(paintedTitles).toHaveLength(3);
        // Each painted title carries its scene id so Shift can light it with the scene.
        expect(foreground.match(/class="rt-scene-title-use" data-scene-id="/g)).toHaveLength(3);
        for (const match of paintedTitles) {
            expect(match[1]).toBe(match[2]);
            expect(scenesMarkup).toContain(`<clipPath id="clip-${match[1]}">`);
        }
        expect(markup.match(/class="ert-time-reference"/g)).toHaveLength(2);
        expect(markup.match(/class="ert-time-reference-origin"/g)).toHaveLength(1);
        expect(markup.match(/class="rt-scene-group/g)).toHaveLength(3);
        // Every scene group carries the color its subplot paints with, for hover, drag and synopsis readers.
        expect(scenesMarkup.match(/data-subplot-color="#996699"/g)).toHaveLength(3);
        const occurrences = [...markup.matchAll(/<g class="ert-time-reference"[^>]*data-ring="(\d+)"/g)];
        expect(occurrences.map(match => match[1])).toEqual(['2', '2']);
        expect(markup).toContain('12 · Source');
        expect(markup).toContain('A &lt;memory&gt;');
        expect(markup).not.toContain('aria-label=');
    });
    it('runs each route along its date mark\'s own radius, with separate explicit seam terminals', () => {
        const markup = render(['1952', '2040']);
        // Earlier at the marks' base radius, Later at its small lift; neither climbs to another track and back.
        expect(markup).toContain(' A 414.4 414.4 ');
        expect(markup).toContain(' A 420.4 420.4 ');
        expect(markup).not.toContain(' A 440.8 440.8 ');
        expect(markup.match(/class="ert-time-reference-connector ert-time-reference-break"/g)).toHaveLength(2);
        expect(markup.match(/class="ert-time-reference-connector ert-time-reference-break ert-time-reference-casing"/g)).toHaveLength(2);
        expect(markup).toContain('Earlier · 1952');
        expect(markup).toContain('Later · 2040');
        expect(markup).not.toMatch(/NaN|Infinity/);
    });
    it('shows three same-date marks and an actionable overflow containing every remaining reference', () => {
        const markup = render(Array(5).fill('1952'), 400, 520);
        expect(markup.match(/class="ert-time-reference-mark"/g)).toHaveLength(3);
        expect(markup.match(/class="ert-time-reference"/g)).toHaveLength(4);
        expect(markup).toContain('>+2</textPath></text>');
        // One shared source/date route, plus its seam break, rather than five coincident paths.
        expect(markup.match(/class="ert-time-reference-connector"/g)).toHaveLength(1);
        for (let i = 0; i < 5; i++) expect(markup).toContain(`A &lt;memory&gt; ${i}`);
    });
    it('returns labels to scene bottoms and lifts only Later slightly above the dominance corner', () => {
        const markup = render(['1952', '2040']);
        const ends = Array.from(markup.matchAll(/<g class="ert-time-reference"[^>]*data-reference-x="([^"]+)" data-reference-y="([^"]+)"/g), m => m.slice(1).map(Number));
        expect(ends).toHaveLength(2);
        const radii = ends.map(([x, y]) => Math.hypot(x, y));
        // A size and a half off the ring's inner edge (size 9.6 in a 60-unit ring), clear of the backdrop ring.
        expect(radii[0]).toBeCloseTo(414.4);
        expect(radii[1] - radii[0]).toBeCloseTo(6);
        expect(markup).not.toContain('ert-time-reference-halo');
        expect(markup).toContain('d="M22 12h-2.48');
    });
    it('ends in a hollow source circle and hollow arrowheads over casings, with upright lower-half source text', () => {
        const markup = render(['1952', '2040']);
        expect(markup.match(/<textPath /g)).toHaveLength(3);
        // The source circle is one size in radius, so its core stays open on the scene.
        const sourceMark = markup.match(/<circle class="ert-time-reference-source-mark" (cx="[^"]+" cy="[^"]+" r="([^"]+)")/);
        expect(Number(sourceMark![2])).toBeCloseTo(9.6);
        expect(markup).toContain(`<circle class="ert-time-reference-casing" ${sourceMark![1]}/><circle class="ert-time-reference-source-mark"`);
        // Every arrowhead lies on a casing of the same shape, all casings painted before the strokes.
        for (const mark of markup.matchAll(/<g class="ert-time-reference-mark"[^>]*>(.*?)<\/g>/g)) {
            const casings = Array.from(mark[1].matchAll(/<polygon class="ert-time-reference-casing" (points="[^"]+")/g), m => m[1]);
            const strokes = Array.from(mark[1].matchAll(/<polygon class="ert-time-reference-slice" (points="[^"]+")/g), m => m[1]);
            expect(strokes.length).toBeGreaterThan(0);
            expect(casings).toEqual(strokes);
            expect(mark[1].lastIndexOf('ert-time-reference-casing')).toBeLessThan(mark[1].indexOf('ert-time-reference-slice'));
        }
        expect(markup).not.toContain('<circle class="ert-time-reference-slice"');
        const label = markup.match(/class="ert-time-reference-origin-label"[^>]*><textPath href="#([^"]+)"/);
        const sourcePath = markup.match(new RegExp(`<path id="${label![1]}" d="([^"]+)"`));
        expect(sourcePath![1]).toContain(' A 424 424 0 0 0 ');
    });
    it('points each mark along the ring the way its date lies, doubled past the timeline and a diamond around the scene', () => {
        // Off the timeline: Earlier is a double arrowhead pointing back, Later a double pointing forward.
        const offRange = render(['1952', '2040']);
        const marks = Array.from(offRange.matchAll(/<g class="ert-time-reference-mark" data-direction="([^"]+)"( data-beyond="true")?>(.*?)<\/g>/g),
            m => ({ direction: m[1], beyond: Boolean(m[2]), shapes: m[3].match(/class="ert-time-reference-slice"/g)!.length }));
        expect(marks).toEqual([{ direction: 'back', beyond: true, shapes: 2 }, { direction: 'forward', beyond: true, shapes: 2 }]);
        // Within the timeline: before the scene, after it, and on its own day.
        const scene = (path: string, when: string, dates: string[] = []): TimelineItem => ({ path, title: path, date: when, when: new Date(`${when}T12:00:00`),
            whenHasClock: false, subplot: 'History', rawFrontmatter: { When: when, 'Time References': dates.map((When, i) => ({ Label: `Ref ${i}`, When, Kind: 'mention' })) } });
        const items = [scene('first.md', '2026-06-01'), scene('source.md', '2026-06-04', ['2026-06-02', '2026-06-04', '2026-06-06']), scene('last.md', '2026-06-07')];
        const layout = computeChronologueLayout(400, 460, start, end, items);
        const within = renderTimeReferenceMarkers(items, layout.positions, layout.slots, 400, 460, 0);
        expect(Array.from(within.matchAll(/<g class="ert-time-reference-mark" data-direction="([^"]+)"(?: data-beyond="true")?>/g), m => m[1]))
            .toEqual(['back', 'both', 'forward']);
        expect(within).not.toContain('data-beyond');
        // A back arrowhead's tip leads counter-clockwise: at 3 o'clock it points up, a forward one down.
        const tipAt3 = (direction: 'back' | 'forward') => {
            const source = scene('s.md', '2026-06-04');
            const ref = readTimeReferences([{ Label: 'x', When: direction === 'back' ? '2026-06-01' : '2026-06-07', Kind: 'mention' }], 's.md').references[0];
            expect(referenceDirection(ref, source)).toBe(direction);
            const slot = { angle: 0, extent: 'within' as const, seam: start, clipped: false, references: [ref] };
            const markup = renderTimeReferenceMarkers([source], new Map([[0, layout.positions.get(1)!]]), [slot], 400, 460, 0);
            const points = markup.match(/class="ert-time-reference-slice" points="([^"]+)"/)![1].split(' ').map(p => p.split(',').map(Number));
            return points[1][1] - points[0][1];
        };
        expect(tipAt3('back')).toBeLessThan(0);
        expect(tipAt3('forward')).toBeGreaterThan(0);
    });
    it('paints the reference layer after the Chronologue overlays and before the synopses', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/renderer/TimelineRenderer.ts'), 'utf8');
        const layer = source.indexOf('<g class="ert-time-reference-layer">');
        expect(layer).toBeGreaterThan(source.indexOf('svg += chronologueOverlaysHtml'));
        expect(layer).toBeGreaterThan(source.indexOf('svg += boundaryLabelsHtml'));
        expect(layer).toBeLessThan(source.indexOf('svg += synopsisHTML'));
    });
    it('keeps overflow text on the date baseline, away from scene titles across ring sizes', () => {
        const items = [source('History', Array(5).fill('1952'))];
        for (const [inner, outside] of [[200, 320], [400, 520], [700, 900]]) {
            const local = computeChronologueLayout(inner, outside, start, end, items);
            const markup = renderTimeReferenceMarkers(items, local.positions, local.slots, inner, outside, 0);
            const overflow = markup.match(/<g class="ert-time-reference"[^>]*data-reference-x="([^"]+)" data-reference-y="([^"]+)" data-reference-overflow="true"/);
            expect(overflow).not.toBeNull();
            // The count follows the first date's inner baseline, not a fourth row.
            expect(Math.hypot(Number(overflow![1]), Number(overflow![2]))).toBeCloseTo(inner + 15);
            const countPath = markup.match(/<path id="[^"]+-overflow" d="[^"]* A ([^ ]+) /);
            expect(Number(countPath![1])).toBeLessThanOrEqual(inner + (outside - inner) * .4);
            expect(markup).toContain('>+2</textPath></text>');
        }
    });
    it('draws every route in theme colors on a matching casing, never in the subplot color', () => {
        const markup = render(['1952', '1990-06-01', '2040'], 400, 520);
        // The stylesheet colors the line and its casing; nothing inline can bring back a fill-matched hue.
        expect(markup).not.toMatch(/stroke="|color-mix|rt-subplot-colors/);
        const lines = Array.from(markup.matchAll(/<path class="ert-time-reference-connector" ([^>]*)\/>/g), m => m[1]);
        const casings = Array.from(markup.matchAll(/<path class="ert-time-reference-connector ert-time-reference-casing" ([^>]*)\/>/g), m => m[1]);
        expect(lines.length).toBeGreaterThan(0);
        // Each casing shares its line's keys and route, and is painted first.
        expect(casings).toEqual(lines);
        expect(markup.indexOf('ert-time-reference-casing')).toBeLessThan(markup.indexOf('class="ert-time-reference-connector"'));
    });
    it('distinguishes multiple off-range dates from a same-date stack', () => {
        const markup = render(['1952', '1986', '1990']);
        expect(markup.match(/class="ert-time-reference-mark"/g)).toHaveLength(1);
        expect(markup).toContain('3 dates');
        for (const date of ['1952', '1986', '1990']) expect(markup).toContain(date);
    });
});
