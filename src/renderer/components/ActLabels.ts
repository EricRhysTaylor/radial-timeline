import { resolveActLabel } from '../../utils/acts';
import { escapeXml, formatNumber } from '../../utils/svg';
import { VERSION_ICON_Y } from '../layout/LayoutConstants';
import { getSegmentBoundaries } from '../utils/TimelineSegments';

export function renderActLabels(params: {
  numActs: number;
  actLabels: string[];
  outerMostOuterRadius: number;
  actLabelOffset: number;
  maxStageColor: string;
}): string {
  const { numActs, actLabels, outerMostOuterRadius, actLabelOffset, maxStageColor } = params;
  let svg = '';
  const actLabelRadius = outerMostOuterRadius + actLabelOffset;
  for (let act = 0; act < numActs; act++) {
    const angle = (act * 2 * Math.PI) / numActs - Math.PI / 2;
    // Left-justify each act label just clockwise of its spoke, reading into
    // the act it names.
    const anchorOffset = 0.02;
    const startAngleAct = angle + anchorOffset;
    // Long enough for long titles, but never past the next act's spoke.
    const arcLength = Math.min(Math.PI / 3, (2 * Math.PI) / numActs - 2 * anchorOffset);
    const endAngleAct = startAngleAct + arcLength;

    const actPathId = `actPath-${act}`;
    // An act label is the author's text, and in a saga a book title ("Pride & Prejudice").
    const labelText = escapeXml(resolveActLabel(act, actLabels));
    svg += `
      <path id="${actPathId}" d="
        M ${formatNumber(actLabelRadius * Math.cos(startAngleAct))} ${formatNumber(actLabelRadius * Math.sin(startAngleAct))}
        A ${formatNumber(actLabelRadius)} ${formatNumber(actLabelRadius)} 0 0 1 ${formatNumber(actLabelRadius * Math.cos(endAngleAct))} ${formatNumber(actLabelRadius * Math.sin(endAngleAct))}
      " fill="none" />
      <text class="rt-act-label" data-act="${act}" fill="${maxStageColor}">
        <textPath href="#${actPathId}" startOffset="0" text-anchor="start">${labelText}</textPath>
      </text>
    `;
  }
  return svg;
}


const NARRATIVE_ACT_FONT_SIZE = 26;
const LABEL_FRAME_INSET = 10;
const LABEL_MAX_WIDTH = 280;

type ActLabelPosition = { x: number; y: number };
type NarrativeActLabel = ActLabelPosition & { lines: string[]; fontSize: number; inset: boolean };

/** Search from the act midpoint for room between the beat track and the viewBox. */
function findLabelPosition(
    start: number, end: number, halfWidth: number, halfHeight: number, rim: number, frame: number
): ActLabelPosition | undefined {
    const mid = (start + end) / 2;
    const step = (end - start) / 48;
    for (let i = 0; i < 48; i++) {
        const angle = mid + Math.ceil(i / 2) * step * (i % 2 === 0 ? -1 : 1);
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        // Project the box onto the spoke and the two act boundaries to clear
        // the rim and neighbouring sectors.
        const radius = Math.max(
            rim + Math.abs(dx) * halfWidth + Math.abs(dy) * halfHeight,
            (Math.abs(Math.sin(start)) * halfWidth + Math.abs(Math.cos(start)) * halfHeight + 4) / Math.sin(angle - start),
            (Math.abs(Math.sin(end)) * halfWidth + Math.abs(Math.cos(end)) * halfHeight + 4) / Math.sin(end - angle)
        );
        const x = radius * dx;
        const y = radius * dy;
        if (Math.abs(x) + halfWidth > frame || Math.abs(y) + halfHeight > frame) continue;
        // Leave room for the top controls and the version indicators below left.
        if (y - halfHeight < -705 && Math.abs(x) + halfWidth > 420) continue;
        if (x - halfWidth < -frame + 245 && y + halfHeight > VERSION_ICON_Y - 88) continue;
        return { x, y };
    }
    return undefined;
}

export function layoutNarrativeActLabel(params: {
    title: string;
    start: number;
    end: number;
    fontSize: number;
    rim: number;
    viewBoxHalf: number;
    measure: (line: string) => number;
}): NarrativeActLabel {
    const { title, start, end, fontSize, rim, viewBoxHalf, measure } = params;
    const frame = viewBoxHalf - LABEL_FRAME_INSET;
    const lineHeight = fontSize * 1.14;
    const place = (lines: string[]): NarrativeActLabel | undefined => {
        const width = Math.max(...lines.map(measure));
        if (width > LABEL_MAX_WIDTH) return undefined;
        const position = findLabelPosition(start, end, width / 2 + 3, lineHeight * lines.length / 2, rim, frame);
        return position && { ...position, lines, fontSize, inset: false };
    };
    const fit = place([title]);
    if (fit) return fit;

    const words = title.split(/\s+/u);
    const wraps = words.slice(1).map((_, i) => {
        const lines = [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')];
        return { lines, width: Math.max(...lines.map(measure)) };
    }).sort((a, b) => a.width - b.width);
    for (const { lines } of wraps) {
        const fit = place(lines);
        if (fit) return fit;
    }

    // Keep the full wording in the tooltip when a long label needs ellipsis.
    const shorten = (width: number): string => {
        const letters = Array.from(title);
        let low = 0;
        let high = letters.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (measure(letters.slice(0, mid).join('').trimEnd() + '…') <= width) low = mid;
            else high = mid - 1;
        }
        return letters.slice(0, low).join('').trimEnd() + '…';
    };
    for (const width of [220, 170, 125, 85]) {
        const fit = place([shorten(width)]);
        if (fit) return fit;
    }

    // Narrow sectors facing an edge of the viewBox can have no exterior
    // pocket. Set these labels inside the rim with a contrasting outline.
    const angle = (start + end) / 2;
    const radius = rim - 90;
    const width = radius * Math.sin((end - start) / 2);
    const insetFontSize = Math.min(fontSize, width / 2);
    const name = measure(title) * insetFontSize / fontSize <= width
        ? title : shorten(width * fontSize / insetFontSize);
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), lines: [name], fontSize: insetFontSize, inset: true };
}

export function renderNarrativeActLabels(params: {
    numActs: number;
    actLabels: string[];
    maxStageColor: string;
    viewBoxHalf: number;
    rim: number;
    fontScale: number;
    document: Document;
}): string {
    const { numActs, actLabels, maxStageColor, viewBoxHalf, rim, fontScale, document } = params;
    const fontSize = NARRATIVE_ACT_FONT_SIZE * fontScale;
    const ctx = document.createElement('canvas').getContext('2d');
    const fontFamily = document.defaultView?.getComputedStyle(document.body).getPropertyValue('--font-interface').trim();
    if (ctx) ctx.font = '700 ' + fontSize + 'px ' + (fontFamily || 'system-ui');
    const measure = (line: string): number => ctx?.measureText(line).width ?? Array.from(line).length * fontSize;

    return Array.from({ length: numActs }, (_, act) => {
        const title = resolveActLabel(act, actLabels);
        const layout = layoutNarrativeActLabel({ title, ...getSegmentBoundaries(act, numActs), fontSize, measure, rim, viewBoxHalf });
        const x = formatNumber(layout.x);
        const lineHeight = layout.fontSize * 1.14;
        const lines = layout.lines.map((line, i) => {
            const y = layout.y + (i - (layout.lines.length - 1) / 2) * lineHeight;
            return '<tspan x="' + x + '" y="' + formatNumber(y) + '">' + escapeXml(line) + '</tspan>';
        }).join('');
        const inset = layout.inset ? ' ert-timeline-act-label--inset' : '';
        const tooltip = layout.lines.join(' ') === title
            ? '' : ' data-tooltip="' + escapeXml(title) + '" data-tooltip-placement="top"';
        return '<text class="rt-act-label ert-timeline-act-label' + inset + '" data-act="' + act + '" fill="' + maxStageColor
            + '" font-size="' + formatNumber(layout.fontSize) + '"' + tooltip + '>' + lines + '</text>';
    }).join('');
}
