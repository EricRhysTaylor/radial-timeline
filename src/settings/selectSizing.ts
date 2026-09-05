const measurementCanvasByDocument = new WeakMap<Document, HTMLCanvasElement>();

function getMeasurementContext(doc: Document): CanvasRenderingContext2D | null {
    let canvas = measurementCanvasByDocument.get(doc);
    if (!canvas) {
        canvas = doc.win.createEl('canvas');
        measurementCanvasByDocument.set(doc, canvas);
    }
    return canvas.getContext('2d');
}

function buildCanvasFont(computed: CSSStyleDeclaration): string {
    const style = computed.fontStyle || 'normal';
    const variant = computed.fontVariant || 'normal';
    const weight = computed.fontWeight || '400';
    const size = computed.fontSize || '16px';
    const family = computed.fontFamily || 'sans-serif';
    return `${style} ${variant} ${weight} ${size} ${family}`;
}

function measureTextWidth(targetEl: HTMLElement, text: string): number {
    const doc = targetEl.ownerDocument;
    const view = doc.defaultView;
    if (!view) return 0;

    const context = getMeasurementContext(doc);
    if (!context) return 0;

    const computed = view.getComputedStyle(targetEl);
    context.font = buildCanvasFont(computed);

    const letterSpacing = Number.parseFloat(computed.letterSpacing);
    const extraLetterSpacing = Number.isFinite(letterSpacing)
        ? Math.max(0, text.length - 1) * letterSpacing
        : 0;

    return Math.ceil(context.measureText(text).width + extraLetterSpacing);
}

export function fitSelectToSelectedLabel(
    selectEl: HTMLSelectElement,
    options: {
        extraPx?: number;
        minPx?: number;
        maxPx?: number;
    } = {}
): void {
    const selectedLabel = selectEl.options[selectEl.selectedIndex]?.text ?? '';
    if (!selectedLabel) return;

    const doc = selectEl.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;

    const computed = view.getComputedStyle(selectEl);
    const textWidth = measureTextWidth(selectEl, selectedLabel);
    const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
    const borderLeft = Number.parseFloat(computed.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(computed.borderRightWidth) || 0;
    const extraPx = options.extraPx ?? 16;
    const minPx = options.minPx ?? 0;
    const maxPx = options.maxPx ?? Number.POSITIVE_INFINITY;
    const isBorderBox = computed.boxSizing === 'border-box';

    let rawWidth = textWidth + extraPx;
    if (isBorderBox) {
        rawWidth += paddingLeft + paddingRight + borderLeft + borderRight;
    }

    const nextWidth = Math.min(maxPx, Math.max(minPx, Math.ceil(rawWidth)));
    const nextWidthPx = `${nextWidth}px`;
    selectEl.style.width = nextWidthPx; // SAFE: inline style used for dynamic fit-to-content width
    selectEl.style.minWidth = nextWidthPx; // SAFE: inline style used for dynamic fit-to-content width
    selectEl.style.maxWidth = nextWidthPx; // SAFE: inline style used for dynamic fit-to-content width
    selectEl.style.flex = `0 0 ${nextWidthPx}`; // SAFE: inline style used for dynamic fit-to-content width
    selectEl.style.setProperty('--ert-control-width', nextWidthPx); // SAFE: inline style used for dynamic fit-to-content width
}
