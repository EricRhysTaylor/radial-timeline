import { App, Modal } from 'obsidian';
import type { TimelineItem } from '../types';
import { formatElapsedTime } from '../utils/date';
import { previewCompressedScale, previewSceneRanges, previewSceneSectors } from './compressedPreviewModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
let previewId = 0;

function element(doc: Document, tag: string, attrs: Record<string, string>): SVGElement {
    const result = doc.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([name, value]) => result.setAttribute(name, value));
    return result;
}

function sector(inner: number, outer: number, start: number, end: number): string {
    const point = (radius: number, angle: number) => `${radius * Math.cos(angle)} ${radius * Math.sin(angle)}`;
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
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
        content.createEl('p', { text: `${ranges.length} dated scenes · ${excluded} undated or unsupported scenes omitted. Wedges allocate space around scene dates; they do not show scene duration. Infinity marks compressed gaps. Some labels may be too close together to display. Hover or focus a scene to highlight its matching subplot positions.` });
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
        const sceneShapes = new Map<string, SVGElement>();
        const highlight = (path: string | null) => {
            sceneShapes.forEach(shape => shape.classList.toggle('is-selected', !!path && sceneShapes.get(path) === shape));
            groups.forEach(group => group.classList.toggle('ert-compressed-preview__match', !!path && group.getAttribute('data-path') === encodeURIComponent(path)));
        };
        for (const wedge of previewSceneSectors(scale)) {
            const first = wedge.ranges[0];
            const matching = groups.find(group => Number(group.getAttribute('data-outer-r')) === outer && group.getAttribute('data-path') === encodeURIComponent(first.id));
            const color = matching?.getAttribute('data-subplot-color') || 'var(--interactive-accent)';
            const group = element(svg.ownerDocument, 'g', { class: 'ert-compressed-preview__wedge' });
            const shape = element(svg.ownerDocument, 'path', { d: sector(inner, outer, wedge.startAngle, wedge.endAngle), fill: color, class: 'ert-compressed-preview__wedge-shape' });
            group.appendChild(shape);
            group.appendChild(element(svg.ownerDocument, 'title', {})).textContent = wedge.ranges.map(range => titles.get(range.id) ?? range.id).join('\n');
            const width = wedge.endAngle - wedge.startAngle;
            if (width * mid > 40) {
                const angle = (wedge.startAngle + wedge.endAngle) / 2;
                const label = element(svg.ownerDocument, 'text', { x: String(mid * Math.cos(angle)), y: String(mid * Math.sin(angle)), 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${angle * 180 / Math.PI + 90 + (Math.cos(angle) < 0 ? 180 : 0)} ${mid * Math.cos(angle)} ${mid * Math.sin(angle)})`, class: 'ert-compressed-preview__wedge-label' });
                const scene = this.scenes.find(item => item.path === first.id);
                const name = wedge.ranges.length > 1 ? `${wedge.ranges.length} scenes` : `${scene?.number != null ? `${scene.number} ` : ''}${scene?.title ?? first.id}`;
                const max = Math.max(3, Math.floor(width * mid / 9));
                label.textContent = name.length > max ? `${name.slice(0, max - 1)}…` : name;
                group.appendChild(label);
            }
            wedge.ranges.forEach(range => sceneShapes.set(range.id, group));
            group.addEventListener('pointerenter', () => highlight(first.id));
            group.addEventListener('pointerleave', () => highlight(null));
            overlay.appendChild(group);
        }
        for (const gap of scale.segments.filter(segment => segment.compressed)) {
            const angle = (gap.startAngle + gap.endAngle) / 2;
            const marker = element(svg.ownerDocument, 'text', { x: String(mid * Math.cos(angle)), y: String(mid * Math.sin(angle)), class: 'rt-discontinuity-marker rt-compressed-gap-marker', 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': '20', 'stroke-width': '6', 'pointer-events': 'none' });
            marker.appendChild(element(svg.ownerDocument, 'title', {})).textContent = `Compressed gap: ${formatElapsedTime(gap.endMs - gap.startMs)}`;
            marker.append('∞');
            overlay.appendChild(marker);
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
