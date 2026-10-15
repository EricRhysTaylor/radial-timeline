import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { buildOuterRingSequence } from '../../renderer/utils/OuterRingSequence';
import { alignPositionsToOuterRing, computeChronologueLayout } from '../../renderer/utils/SceneLayout';
import { renderTimeReferenceSlices } from './render';

describe('reference occurrences across actual ring layouts', () => {
    const source = (subplot: string): TimelineItem => ({ path: '12.md', title: '12 Source', date: '', when: new Date('2026-10-14'), subplot,
        rawFrontmatter: { 'Time References': [{ Label: 'A <memory>', When: '1952', Kind: 'recollection' }] } });
    it('deduplicates the outer reference while rendering one occurrence per inherited ring', () => {
        const scenes = [source('Family'), source('History')];
        const outer = buildOuterRingSequence({ scenes, segment: 0, isSagaScope: false, sortByWhen: true, forceChronological: true,
            includeBeats: false, masterSubplotOrder: ['Main Plot', 'Family', 'History'], innerR: 700, outerR: 760, startAngle: 0, endAngle: Math.PI * 2 });
        expect(outer.items).toHaveLength(1);
        expect(outer.referenceSlots).toHaveLength(1);
        let markup = renderTimeReferenceSlices(outer.items, outer.positions, outer.referenceSlots, 700, 760, 2, () => 'var(--rt-subplot-colors-0)');
        for (const [ring, subplot] of ['Family', 'History'].entries()) {
            const items = [source(subplot)];
            const aligned = alignPositionsToOuterRing(items, outer.positionByKey);
            markup += renderTimeReferenceSlices(items, aligned, outer.referenceSlots, 400 + ring * 100, 460 + ring * 100, ring, () => `var(--rt-subplot-colors-${ring + 1})`);
        }
        expect(markup.match(/class="ert-time-reference"/g)).toHaveLength(3);
        expect(markup.match(/class="ert-time-reference-connector"/g)).toHaveLength(3);
        expect(markup).not.toContain('class="rt-scene-group');
        expect(markup).toContain('A &lt;memory&gt;');
        expect(markup).not.toContain('aria-label=');
    });
    it('uses independent Fill positions but the same radius for both connector endpoints', () => {
        const items = [source('History')];
        const layout = computeChronologueLayout(400, 460, 0, Math.PI * 2, items);
        const markup = renderTimeReferenceSlices(items, layout.positions, layout.slots, 400, 460, 0, () => 'var(--rt-subplot-colors-1)');
        expect(markup).toContain(' A 400 400 ');
        expect(markup).toContain('data-ring="0"');
    });
});
