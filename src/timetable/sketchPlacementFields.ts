/**
 * Where a sketch sits among the scenes: after the scene with ID `after` (none:
 * at the end of its act), then by `order` among the sketches at that spot.
 * Plugin-owned, kept in the placement sidecar (SketchPlacementStore), never in
 * the sketch note.
 */
export interface SketchPlacement {
    after?: string;
    order?: number;
}

/**
 * The properties earlier versions wrote into sketch notes. Read once, by the
 * sidecar's one-time import; never written, and never read again after it.
 */
export const LEGACY_SKETCH_AFTER_SCENE = 'Place after scene';
export const LEGACY_SKETCH_ORDER = 'Sketch order';

export function sketchAnchor(placement?: SketchPlacement): string | null {
    return placement?.after ?? null;
}

export function sketchOrder(placement?: SketchPlacement): number | null {
    return placement?.order ?? null;
}
