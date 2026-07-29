import type { TimelineItem } from '../types';
import { isSceneItem } from './sceneHelpers';

/**
 * Publishing Part markers — the scene-anchored replacement for Act-derived Parts.
 *
 * A Part is a *boundary* that owns a range of scenes, exactly like a Chapter: the
 * scene carrying the field opens the part, which runs until the next marked scene.
 * See `docs/engineering/plans/parts-first-class-markers-implementation.md` (D1).
 *
 * This module is pure. It resolves markers from frontmatter values and nothing else —
 * no settings, no layout, no vault access. Appearance stays owned by the PDF layout
 * spec (`designedSpec.parts`); this decides only *where* parts break and *what* they say.
 */

export const SHARED_PART_FIELD_KEY = 'Part';
export const SHARED_PART_EPIGRAPH_FIELD_KEY = 'Part Epigraph';
export const SHARED_PART_EPIGRAPH_BY_FIELD_KEY = 'Part Epigraph By';

/**
 * A resolved marker. `titled` is carried explicitly rather than inferred from
 * `title` being present, because untitled parts are a first-class case: every
 * existing Signature book prints numeral-only Part pages. Collapsing this to
 * `string | undefined` would make those books unrepresentable — the mistake
 * `readSharedChapterTitle` makes safely for chapters (which are always titled)
 * and which must not be repeated here.
 */
export interface PartMarker {
    titled: boolean;
    title?: string;
}

export interface TimelinePartMarker {
    sourcePath?: string;
    sourceType: 'Scene';
    titled: boolean;
    title?: string;
    resolvedScenePath: string;
    resolvedTimelinePosition: number;
}

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * Resolve a raw `Part:` frontmatter value into a marker, or `null` for no boundary.
 *
 * The value arrives **uncoerced** from either Obsidian's metadata cache
 * (`item.rawFrontmatter`, the timeline path) or `parseYaml` (the export path). Both
 * deliver parsed values, so this takes `unknown` and must never stringify before
 * testing — the boolean-vs-string distinction *is* the mechanism:
 *
 * | Frontmatter            | Parsed value      | Result                  |
 * |------------------------|-------------------|-------------------------|
 * | `Part: true`           | `true` (boolean)  | marker, untitled        |
 * | `Part: "true"`         | `'true'` (string) | marker, titled `"true"` |
 * | `Part: The Crossing`   | string            | marker, titled          |
 * | `Part: false`          | `false` (boolean) | no marker               |
 * | `Part:` / `Part: "  "` | `null` / blank    | no marker               |
 * | `Part: 1` / list / map | number / object   | no marker               |
 *
 * Empty means *no marker* rather than *untitled* deliberately: if any normalization
 * pass ever seeds `Part:` across scenes, a blank value must not silently turn every
 * scene into a part boundary.
 */
export function resolvePartMarkerValue(value: unknown): PartMarker | null {
    // Strict identity: `1` and other truthy values must not become untitled markers.
    if (value === true) return { titled: false };

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? { titled: true, title: trimmed } : null;
    }

    // false, null, undefined, numbers, arrays, objects — all "no boundary".
    return null;
}

/** Read the `Part` key from a frontmatter object, tolerating case and separator drift. */
export function readPartMarker(frontmatter?: Record<string, unknown>): PartMarker | null {
    if (!frontmatter) return null;

    for (const [key, value] of Object.entries(frontmatter)) {
        // 'Part Epigraph' normalizes to 'partepigraph', so sibling fields cannot
        // be mistaken for the marker itself.
        if (normalizeKey(key) !== 'part') continue;
        return resolvePartMarkerValue(value);
    }

    return null;
}

/**
 * Walk scenes in manuscript order and collect their part boundaries.
 *
 * Mirrors `resolveTimelineChapterMarkers`: position counts scenes only, so a marker's
 * `resolvedTimelinePosition` is its scene index regardless of interleaved beats or
 * backdrops. Numbering of the parts themselves is *sequential by marker order* and is
 * applied by consumers — never derived from the scene's `Act:` value, which no longer
 * has any part authority.
 */
export function resolveTimelinePartMarkers(
    orderedItems: TimelineItem[]
): TimelinePartMarker[] {
    const resolved: TimelinePartMarker[] = [];
    let resolvedTimelinePosition = 0;

    for (const item of orderedItems) {
        if (!isSceneItem(item) || !item.path) continue;
        const marker = readPartMarker(item.rawFrontmatter);
        resolvedTimelinePosition += 1;

        if (marker) {
            resolved.push({
                sourcePath: item.path,
                sourceType: 'Scene',
                titled: marker.titled,
                ...(marker.title === undefined ? {} : { title: marker.title }),
                resolvedScenePath: item.path,
                resolvedTimelinePosition,
            });
        }
    }

    return resolved;
}
