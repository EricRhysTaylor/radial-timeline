import { describe, expect, it } from 'vitest';
import { communityTheme } from '@radial-timeline/timeline-tokens';
import { isTimelinePreviewDocument, renderTimelinePreview } from './timelinePreview';

const doc = { anonymized: true, book: { actCount: 1 }, scenes: [
    { id: 'scene-0', order: 1, act: 1, status: 'todo', revealed: false },
    { id: 'scene-1', order: 2, act: 1, status: 'complete', publishStage: 'author', revealed: true },
] };

/** A stand-in for Obsidian's createSvg helpers: records tags, attributes and children. */
interface FakeNode { tag: string; attributes: Record<string, string>; children: FakeNode[];
    createSvg(tag: string, o?: { cls?: string; attr?: Record<string, string> }): FakeNode; appendChild(child: FakeNode): void }
function create(tag: string, o?: { cls?: string; attr?: Record<string, string> }): FakeNode {
    const node: FakeNode = { tag, attributes: { ...o?.attr, ...(o?.cls ? { class: o.cls } : {}) }, children: [],
        createSvg(childTag, childOptions) { const child = create(childTag, childOptions); node.children.push(child); return child; },
        appendChild(child) { node.children.push(child); } };
    return node;
}
function container(): FakeNode & { ownerDocument: { win: { createSvg: typeof create } } } {
    return Object.assign(create('div'), { ownerDocument: { win: { createSvg: create } } });
}

describe('Community timeline preview', () => {
    it('accepts a filtered document and refuses an unfiltered one', () => {
        expect(isTimelinePreviewDocument(doc)).toBe(true);
        expect(isTimelinePreviewDocument({ ...doc, anonymized: false })).toBe(false);
        expect(isTimelinePreviewDocument({ ...doc, scenes: [{ id: 'bad', act: -1, order: 1 }] })).toBe(false);
    });
    it('renders geometry with a reveal mark and no scene text', () => {
        const parent = container();
        expect(renderTimelinePreview(parent as unknown as HTMLElement, doc as never)).toBe(true);
        const svg = parent.children[0];
        expect(svg.tag).toBe('svg');
        expect(svg.attributes.class).toBe('ert-community-wheel');
        expect(svg.children.some(path => path.attributes.stroke === communityTheme.accent)).toBe(true);
        expect(JSON.stringify(svg)).not.toContain('Scene title');
    });
    it('draws empty ring cells as etched cells styled by the theme, not a near-invisible fill', () => {
        const parent = container();
        const withVoids = { anonymized: true, book: { actCount: 1 }, scenes: [
            { id: 'a', order: 1, act: 1, status: 'todo', subplots: ['Main Plot'] },
            { id: 'b', order: 2, act: 1, status: 'todo', subplots: ['Second'] },
            { id: 'c', order: 3, act: 1, status: 'todo', subplots: ['Main Plot'] },
        ] };
        expect(renderTimelinePreview(parent as unknown as HTMLElement, withVoids as never)).toBe(true);
        const voids = parent.children[0].children.filter(path => path.attributes.class === 'ert-community-wheel__void');
        expect(voids.length).toBeGreaterThan(0);
        for (const cell of voids) {
            expect(cell.attributes.d).toBeTruthy();
            // Color comes from rt-ui.css theme variables, never a fixed hex on the path.
            expect(cell.attributes.fill).toBeUndefined();
            expect(cell.attributes['fill-opacity']).toBeUndefined();
        }
    });
});
