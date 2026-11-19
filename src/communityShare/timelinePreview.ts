/** Geometry-only version of the Community wheel, using its shared layout and colors. */
import { layout, type LayoutDocument } from '@radial-timeline/timeline-layout';
import { communityTheme, dimensions, themes } from '@radial-timeline/timeline-tokens';

interface PreviewScene { id: string; order: number; act: number; itemType?: string; subplots?: string[]; status?: string; publishStage?: string; revealed?: boolean }
export interface TimelinePreviewDocument extends LayoutDocument {
    anonymized: true;
    book: { actCount: number };
    scenes: PreviewScene[];
}

export function isTimelinePreviewDocument(value: unknown): value is TimelinePreviewDocument {
    if (!value || typeof value !== 'object') return false;
    const doc = value as Partial<TimelinePreviewDocument>;
    return doc.anonymized === true && !!doc.book && Number.isInteger(doc.book.actCount)
        && doc.book.actCount > 0 && doc.book.actCount <= 100 && Array.isArray(doc.scenes)
        && doc.scenes.length <= 10000 && doc.scenes.every(scene => scene && typeof scene.id === 'string'
            && Number.isFinite(scene.order) && Number.isInteger(scene.act) && scene.act > 0
            && (!scene.subplots || (Array.isArray(scene.subplots) && scene.subplots.every(v => typeof v === 'string'))));
}

/** Render no text or document content into markup; SVG paths are engine output only. */
export function renderTimelinePreview(container: HTMLElement, doc: TimelinePreviewDocument): boolean {
    try {
        const tree = layout(doc, { arrangement: 'narrative', wheelRadius: dimensions.wheelRadius,
            hubRadius: dimensions.hubRadius, actCount: doc.book.actCount, actGapWidth: dimensions.actGapWidth,
            maxActGapAngle: dimensions.maxActGapAngle });
        // Built detached and attached whole at the end, so a failure leaves the container empty.
        const svg = container.ownerDocument.win.createSvg('svg', {
            cls: 'ert-community-wheel',
            attr: { viewBox: `0 0 ${tree.resolved.size.width} ${tree.resolved.size.height}`, 'aria-hidden': 'true' },
        });
        const draw = (d: string, fill: string, opacity: string, stroke?: string) => {
            svg.createSvg('path', { attr: { d, fill, 'fill-opacity': opacity, ...(stroke ? { stroke, 'stroke-width': '6' } : {}) } });
        };
        tree.resolved.rings.forEach(r => draw(r.dPath, communityTheme.surface, '0.55'));
        // An empty cell is an etched dark cell with a hairline edge, colored by the theme in CSS
        // (rt-ui.css), so the ring reads whole rather than bitten.
        tree.voids.forEach(v => {
            svg.createSvg('path', { cls: 'ert-community-wheel__void', attr: { d: v.dPath } });
        });
        const scenes = new Map(doc.scenes.map(scene => [scene.id, scene]));
        tree.scenes.forEach(placement => {
            const scene = scenes.get(placement.sceneId);
            const status = scene?.status ?? 'todo';
            const palette = themes.dark.color;
            const color = status === 'complete'
                ? palette.publishStage[scene?.publishStage as keyof typeof palette.publishStage] ?? palette.publishStage.zero
                : palette.status[status as keyof typeof palette.status] ?? palette.status.todo;
            draw(placement.dPath, color, '0.92', scene?.revealed ? communityTheme.accent : undefined);
        });
        container.appendChild(svg);
        return true;
    } catch { return false; }
}
