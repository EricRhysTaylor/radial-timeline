// Focuses on building SVG elements for synopses (no data rules)

export function createSynopsisContainer(sceneId: string, scenePath?: string): SVGGElement {
  const containerGroup = activeWindow.createSvg("g");
  containerGroup.setAttribute("class", "rt-scene-info rt-info-container");
  containerGroup.setAttribute("data-for-scene", sceneId);
  // Add scene path for DOM updates
  if (scenePath) {
    containerGroup.setAttribute("data-scene-path", encodeURIComponent(scenePath));
  }
  return containerGroup;
}

export function createTextGroup(): SVGGElement {
  const group = activeWindow.createSvg("g");
  group.setAttribute("class", "rt-synopsis-text");
  return group;
}

export function createText(x: number, y: number, cls: string, text: string): SVGTextElement {
  const el = activeWindow.createSvg("text");
  el.setAttribute("class", cls);
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("text-anchor", "start");
  el.textContent = text;
  return el;
}

/** Back the final rendered lines, including icon and multi-line title metadata bounds. */
export function renderSynopsisStrips(
  group: SVGGElement,
  rows: SVGTextElement[][],
  circle: { x: number; y: number; radius: number },
  isRightAligned: boolean,
  fontScale: number
): void {
  group.querySelector('.ert-hover-strips')?.remove();
  group.querySelectorAll('[data-ert-hover-inset]').forEach(el => {
    el.removeAttribute('transform');
    el.removeAttribute('data-ert-hover-inset');
  });

  const doc = group.ownerDocument;
  const layer = doc.win.createSvg('g');
  layer.setAttribute('class', 'ert-hover-strips');
  layer.setAttribute('aria-hidden', 'true');
  // Only the backing is clipped: existing long Pulse lines retain their content.
  const clip = doc.win.createSvg('clipPath');
  const clipId = `ert-hover-strips-${doc.win.crypto.randomUUID()}`;
  clip.setAttribute('id', clipId);
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  const disk = doc.win.createSvg('circle');
  disk.setAttribute('cx', String(circle.x));
  disk.setAttribute('cy', String(circle.y));
  disk.setAttribute('r', String(circle.radius));
  clip.appendChild(disk);
  layer.appendChild(clip);
  layer.setAttribute('clip-path', `url(#${clipId})`);
  group.prepend(layer);

  const groupMatrix = group.getCTM();
  if (!groupMatrix) throw new Error('Cannot measure hover strips without the synopsis SVG matrix.');
  const toGroup = groupMatrix.inverse();
  const padX = 3 * fontScale;
  const padY = 1.5 * fontScale;

  rows.forEach(row => {
    const shifted = new Set<SVGGraphicsElement>(row);
    const strips: Array<{ x: number; y: number; width: number; height: number }> = [];
    row.forEach(text => {
      if (!text.textContent?.trim()) return;
      const parts = text.getAttribute('data-metadata-block') === 'true'
        ? Array.from(text.querySelectorAll<SVGTSpanElement>('tspan[data-column-role]'))
        : [text];
      parts.forEach(part => {
        if (!part.textContent?.trim()) return;
        const box = part.getBBox();
        const fontSize = parseFloat(doc.win.getComputedStyle(part).fontSize);
        const baseline = part.getStartPositionOfChar(0).y;
        const top = Math.min(box.y, baseline - fontSize * 0.85) - padY;
        const bottom = Math.max(box.y + box.height, baseline + fontSize * 0.2) + padY;
        strips.push({ x: box.x - padX, y: top, width: box.width + padX * 2, height: bottom - top });
      });

      const strip = strips[strips.length - 1];
      if (!strip) return;
      const line = text.closest('.rt-hover-metadata-line');
      const icon = line?.querySelector<SVGGElement>('.rt-hover-metadata-icon-g');
      const outline = text.previousElementSibling;
      const extras: SVGGraphicsElement[] = [];
      // Continuation lines share the group, but only the first line carries its icon.
      if (icon && line?.querySelector('text') === text) extras.push(icon);
      if (outline?.classList.contains('rt-planetary-outline')) extras.push(outline as SVGRectElement);
      extras.forEach(extra => {
        const matrix = extra.getCTM();
        if (!matrix) throw new Error('Cannot measure hover decoration without its SVG matrix.');
        const box = extra.getBBox();
        const transform = toGroup.multiply(matrix);
        const corners = [
          new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y),
          new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height)
        ].map(point => point.matrixTransform(transform));
        const right = Math.max(strip.x + strip.width, ...corners.map(p => p.x + padX));
        const bottom = Math.max(strip.y + strip.height, ...corners.map(p => p.y + padY));
        strip.x = Math.min(strip.x, ...corners.map(p => p.x - padX));
        strip.y = Math.min(strip.y, ...corners.map(p => p.y - padY));
        strip.width = right - strip.x;
        strip.height = bottom - strip.y;
        shifted.add(extra);
      });
    });

    // Use both vertical corners, not just the baseline, to respect the curved edge.
    // Move the complete row together so date columns, superscripts and icons stay aligned.
    let offset = 0;
    strips.forEach(strip => {
      const farY = Math.max(Math.abs(strip.y - circle.y), Math.abs(strip.y + strip.height - circle.y));
      const edge = Math.sqrt(Math.max(0, circle.radius ** 2 - farY ** 2));
      offset = isRightAligned
        ? Math.min(offset, circle.x + edge - strip.x - strip.width)
        : Math.max(offset, circle.x - edge - strip.x);
    });
    if (offset !== 0) {
      shifted.forEach(el => {
        const transform = el.getAttribute('transform') ?? '';
        el.setAttribute('transform', `translate(${offset}, 0) ${transform}`);
        // Icons are repositioned by the manager before each render; leave their transform intact.
        if (!el.classList.contains('rt-hover-metadata-icon-g')) el.setAttribute('data-ert-hover-inset', 'true');
      });
    }
    strips.forEach(strip => {
      const rect = doc.win.createSvg('rect');
      rect.setAttribute('x', String(strip.x + offset));
      rect.setAttribute('y', String(strip.y));
      rect.setAttribute('width', String(strip.width));
      rect.setAttribute('height', String(strip.height));
      layer.appendChild(rect);
    });
  });
}


