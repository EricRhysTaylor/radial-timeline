import type { BookLayoutOptions } from '../../../types';
const list = (values: unknown): string[] => Array.isArray(values) ? values.map(value => typeof value === 'string' ? value : '') : [];
export function readLayoutOptions(options?: BookLayoutOptions): BookLayoutOptions {
    if (!options) return {};
    const sceneHeadingMode = options.sceneHeadingMode === 'scene-number' || options.sceneHeadingMode === 'scene-number-title' || options.sceneHeadingMode === 'title-only'
        ? options.sceneHeadingMode : undefined;
    return { partEpigraphs: list(options.partEpigraphs), partEpigraphAttributions: list(options.partEpigraphAttributions), ...(sceneHeadingMode ? { sceneHeadingMode } : {}) };
}
/** Remove trailing empty slots while preserving interior part positions and independent attributions. */
export function compactLayoutOptions(options: BookLayoutOptions): BookLayoutOptions | null {
    const normalized = readLayoutOptions(options);
    const trim = (values: string[] = []): string[] => {
        const result = values.map(value => value.trim());
        while (result.length && !result[result.length - 1]) result.pop();
        return result;
    };
    const partEpigraphs = trim(normalized.partEpigraphs);
    const partEpigraphAttributions = trim(normalized.partEpigraphAttributions);
    const sceneHeadingMode = normalized.sceneHeadingMode !== 'scene-number-title' ? normalized.sceneHeadingMode : undefined;
    if (!partEpigraphs.length && !partEpigraphAttributions.length && !sceneHeadingMode) return null;
    return { ...(partEpigraphs.length ? { partEpigraphs } : {}), ...(partEpigraphAttributions.length ? { partEpigraphAttributions } : {}), ...(sceneHeadingMode ? { sceneHeadingMode } : {}) };
}
