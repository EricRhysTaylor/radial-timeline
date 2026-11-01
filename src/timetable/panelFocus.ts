export type PanelFocus = { x: number; y: number };

/** Position a cover image so the selected point is as close to center as the crop allows. */
export function coverPosition(width: number, height: number, imageWidth: number, imageHeight: number, focus: PanelFocus): { x: number; y: number } {
    if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) return { x: 0, y: 0 };
    const scale = Math.max(width / imageWidth, height / imageHeight);
    const scaledWidth = imageWidth * scale;
    const scaledHeight = imageHeight * scale;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    return { x: clamp(width / 2 - clamp(focus.x, 0, 1) * scaledWidth, width - scaledWidth, 0), y: clamp(height / 2 - clamp(focus.y, 0, 1) * scaledHeight, height - scaledHeight, 0) };
}

export function validPanelFocus(value: unknown): PanelFocus {
    if (!value || typeof value !== 'object') return { x: 0.5, y: 0.5 };
    const { x, y } = value as Record<string, unknown>;
    return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 && typeof y === 'number' && Number.isFinite(y) && y >= 0 && y <= 1 ? { x, y } : { x: 0.5, y: 0.5 };
}
