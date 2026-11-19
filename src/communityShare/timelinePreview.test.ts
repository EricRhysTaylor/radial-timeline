import { describe, expect, it, vi } from 'vitest';
import { communityTheme } from '@radial-timeline/timeline-tokens';
import { isTimelinePreviewDocument, renderTimelinePreview } from './timelinePreview';

const doc = { anonymized: true, book: { actCount: 1 }, scenes: [
    { id: 'scene-0', order: 1, act: 1, status: 'todo', revealed: false },
    { id: 'scene-1', order: 2, act: 1, status: 'complete', publishStage: 'author', revealed: true },
] };

describe('Community timeline preview', () => {
    it('accepts a filtered document and refuses an unfiltered one', () => {
        expect(isTimelinePreviewDocument(doc)).toBe(true);
        expect(isTimelinePreviewDocument({ ...doc, anonymized: false })).toBe(false);
        expect(isTimelinePreviewDocument({ ...doc, scenes: [{ id: 'bad', act: -1, order: 1 }] })).toBe(false);
    });
    it('renders geometry with a reveal mark and no scene text', () => {
        const create = (tag: string) => ({ tag, attributes: {} as Record<string, string>, children: [] as unknown[],
            setAttribute(key: string, value: string) { this.attributes[key] = value; },
            appendChild(child: unknown) { this.children.push(child); } });
        vi.stubGlobal('document', { createElementNS: (_ns: string, tag: string) => create(tag) });
        const parent = create('div');
        expect(renderTimelinePreview(parent as unknown as HTMLElement, doc as never)).toBe(true);
        const svg = parent.children[0] as ReturnType<typeof create>;
        const paths = svg.children as ReturnType<typeof create>[];
        expect(paths.some(path => path.attributes.stroke === communityTheme.accent)).toBe(true);
        expect(JSON.stringify(svg)).not.toContain('Scene title');
        vi.unstubAllGlobals();
    });
    it('draws empty ring cells as etched cells styled by the theme, not a near-invisible fill', () => {
        const create = (tag: string) => ({ tag, attributes: {} as Record<string, string>, children: [] as unknown[],
            setAttribute(key: string, value: string) { this.attributes[key] = value; },
            appendChild(child: unknown) { this.children.push(child); } });
        vi.stubGlobal('document', { createElementNS: (_ns: string, tag: string) => create(tag) });
        const parent = create('div');
        const withVoids = { anonymized: true, book: { actCount: 1 }, scenes: [
            { id: 'a', order: 1, act: 1, status: 'todo', subplots: ['Main Plot'] },
            { id: 'b', order: 2, act: 1, status: 'todo', subplots: ['Second'] },
            { id: 'c', order: 3, act: 1, status: 'todo', subplots: ['Main Plot'] },
        ] };
        expect(renderTimelinePreview(parent as unknown as HTMLElement, withVoids as never)).toBe(true);
        const paths = (parent.children[0] as ReturnType<typeof create>).children as ReturnType<typeof create>[];
        const voids = paths.filter(path => path.attributes.class === 'ert-community-wheel__void');
        expect(voids.length).toBeGreaterThan(0);
        for (const cell of voids) {
            expect(cell.attributes.d).toBeTruthy();
            // Color comes from rt-ui.css theme variables, never a fixed hex on the path.
            expect(cell.attributes.fill).toBeUndefined();
            expect(cell.attributes['fill-opacity']).toBeUndefined();
        }
        vi.unstubAllGlobals();
    });
});
