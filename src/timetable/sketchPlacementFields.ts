import { readFrontmatterProperty } from '../utils/frontmatterKeys';

/** Author-readable placement properties kept on sketch notes. */
export const SKETCH_AFTER_SCENE = 'Place after scene';
export const SKETCH_ORDER = 'Sketch order';

export function sketchAnchor(frontmatter?: Record<string, unknown>): string | null {
    const value = readFrontmatterProperty(frontmatter, SKETCH_AFTER_SCENE);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
