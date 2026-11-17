import { App, Modal } from 'obsidian';
import type { TimelineItem } from '../types';
import { formatElapsedTime } from '../utils/date';
import { previewCompressedScale, previewSceneRanges } from './compressedPreviewModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
let previewId = 0;

function element(doc: Document, tag: string, attrs: Record<string, string>): SVGElement {
    const result = doc.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([name, value]) => result.setAttribute(name, value));
    return result;
}

function arc(radius: number, start: number, end: number): string {
    const point = (angle: number) => `${radius * Math.cos(angle)} ${radius * Math.sin(angle)}`;
    return `M ${point(start)} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(end)}`;
}

/** Prefix cloned SVG ids so the preview cannot alter the live wheel's references. */
function isolateIds(svg: SVGSVGElement): void {
    const ids = new Map<string, string>();
    const prefix = `compressed-preview-${++previewId}-`;
    svg.querySelectorAll('[id]').forEach(node => {
        const old = node.id;
        const next = `${prefix}${old}`;
        ids.set(old, next);
        node.id = next;
    });
    svg.querySelectorAll('*').forEach(node => {
        for (const attribute of Array.from(node.attributes)) {
            let value = attribute.value.replace(/url\(#([^)]*)\)/g, (match, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
            if (value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
            if (value !== attribute.value) node.setAttribute(attribute.name, value);
        }
    });
}

export class CompressedPreviewModal extends Modal {
    constructor(app: App, private readonly source: SVGSVGElement, private readonly scenes: TimelineItem[]) { super(app); }

    onOpen(): void {
        this.modalEl.addClass('ert-compressed-preview-modal');
        const content = this.contentEl;
        content.addClass('ert-compressed-preview');
        content.createEl('h2', { text: 'Compressed time · preview' });
        content.createEl('p', { text: 'Read-only experiment. Subplots retain their current positions; the outer ring shows time. Gaps over 90 days are shortened to the space of 14 days.' });
        const { ranges, titles, excluded } = previewSceneRanges(this.scenes);
        const scale = previewCompressedScale(ranges);
        if (!scale) {
            content.createEl('p', { text: 'This preview needs at least two distinct dated positions or a date range.' });
            return;
        }
        content.createEl('p', { text: `${ranges.length} dated scenes · ${excluded} undated or unsupported scenes omitted. Lines mark exact times; arcs show date uncertainty. Dashed arcs mark compressed gaps. Hover or focus a scene to highlight its matching subplot positions.` });
        const layout = content.createDiv({ cls: 'ert-compressed-preview__layout' });
        const host = layout.createDiv({ cls: 'radial-timeline-container ert-compressed-preview__wheel' });
        const svg = this.source.cloneNode(true) as SVGSVGElement; // SAFE: cloning a rendered SVG is confined to this read-only preview.
        isolateIds(svg);
        svg.removeAttribute('data-shift-mode');
        svg.classList.remove('rt-global-fade', 'scene-hover', 'rt-shift-scene-hover');
        svg.querySelectorAll('.rt-month-label-outer, .rt-chronological-outer-ticks, .rt-chronologue-timeline-arc, .rt-chronologue-backbone-discontinuities').forEach(node => node.remove());
        const groups = Array.from(svg.querySelectorAll<SVGElement>('.rt-scene-group[data-outer-r][data-inner-r]'));
        const outer = Math.max(...groups.map(group => Number(group.getAttribute('data-outer-r'))).filter(Number.isFinite));
        const reference = groups.find(group => Number(group.getAttribute('data-outer-r')) === outer);
        const inner = Number(reference?.getAttribute('data-inner-r'));
        if (!Number.isFinite(outer) || !Number.isFinite(inner) || outer <= inner) {
            content.createEl('p', { text: 'Could not find the outer scene ring in this timeline.' });
            return;
        }
        const mid = (inner + outer) / 2;
        const overlay = element(svg.ownerDocument, 'g', { class: 'ert-compressed-preview__overlay' });
        overlay.appendChild(element(svg.ownerDocument, 'circle', { cx: '0', cy: '0', r: String(mid), 'stroke-width': String(outer - inner + 3), class: 'ert-compressed-preview__mask' }));
        overlay.appendChild(element(svg.ownerDocument, 'circle', { cx: '0', cy: '0', r: String(mid), 'stroke-width': String(outer - inner - 8), class: 'ert-compressed-preview__track' }));
        for (const gap of scale.segments.filter(segment => segment.compressed)) {
            const path = element(svg.ownerDocument, 'path', { d: arc(mid, gap.startAngle, gap.endAngle), class: 'ert-compressed-preview__gap' });
            path.appendChild(element(svg.ownerDocument, 'title', {})).textContent = `Compressed gap: ${formatElapsedTime(gap.endMs - gap.startMs)}`;
            overlay.appendChild(path);
        }
        const sceneShapes = new Map<string, SVGElement>();
        const highlight = (path: string | null) => {
            sceneShapes.forEach((shape, id) => shape.classList.toggle('is-selected', id === path));
            groups.forEach(group => group.classList.toggle('ert-compressed-preview__match', !!path && group.getAttribute('data-path') === encodeURIComponent(path)));
        };
        for (const range of scale.ranges) {
            const title = titles.get(range.id) ?? range.id;
            const shape = range.startMs === range.endMs
                ? element(svg.ownerDocument, 'line', { x1: String((inner + 8) * Math.cos(range.startAngle)), y1: String((inner + 8) * Math.sin(range.startAngle)), x2: String((outer - 8) * Math.cos(range.startAngle)), y2: String((outer - 8) * Math.sin(range.startAngle)), class: 'ert-compressed-preview__instant' })
                : element(svg.ownerDocument, 'path', { d: arc(mid, range.startAngle, range.endAngle), class: 'ert-compressed-preview__range' });
            shape.appendChild(element(svg.ownerDocument, 'title', {})).textContent = title;
            sceneShapes.set(range.id, shape);
            shape.addEventListener('pointerenter', () => highlight(range.id));
            shape.addEventListener('pointerleave', () => highlight(null));
            overlay.appendChild(shape);
        }
        svg.appendChild(overlay);
        host.appendChild(svg);
        const list = layout.createDiv({ cls: 'ert-compressed-preview__list' });
        list.createEl('h3', { text: 'Scenes in this preview' });
        for (const range of scale.ranges.slice().sort((a, b) => a.startMs - b.startMs)) {
            const row = list.createEl('button', { cls: 'ert-compressed-preview__scene', text: titles.get(range.id) ?? range.id });
            row.addEventListener('pointerenter', () => highlight(range.id));
            row.addEventListener('pointerleave', () => highlight(null));
            row.addEventListener('focus', () => highlight(range.id));
            row.addEventListener('blur', () => highlight(null));
            row.addEventListener('click', () => highlight(range.id));
        }
        list.createEl('h3', { text: 'Shortened gaps' });
        const gaps = scale.segments.filter(segment => segment.compressed);
        if (!gaps.length) list.createEl('p', { text: 'None with this preview threshold.' });
        gaps.forEach(gap => list.createEl('p', { text: formatElapsedTime(gap.endMs - gap.startMs) }));
    }

    onClose(): void { this.contentEl.empty(); }
}
