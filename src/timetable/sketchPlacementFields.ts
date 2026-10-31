/** Author-readable placement properties kept on sketch notes. */
export const SKETCH_AFTER_SCENE = 'Place after scene';
export const SKETCH_ORDER = 'Sketch order';

export function sketchAnchor(frontmatter?: Record<string, unknown>): string | null {
    const key = Object.keys(frontmatter ?? {}).find(candidate => candidate.toLowerCase() === SKETCH_AFTER_SCENE.toLowerCase());
    const value = key ? frontmatter?.[key] : undefined;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
