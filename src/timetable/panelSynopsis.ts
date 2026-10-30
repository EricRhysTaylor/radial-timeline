import { canonicalizeFrontmatterKey, getActiveFrontmatterMappings } from '../utils/frontmatter';
import { authorKeyFor } from './timetableFiles';
import type { RadialTimelineSettings } from '../types';

/** Find the author's actual Synopsis key, including a configured mapping. */
export function synopsisKey(frontmatter: Record<string, unknown>, settings: RadialTimelineSettings): string {
    const mappings = getActiveFrontmatterMappings(settings);
    return Object.keys(frontmatter).find(key => canonicalizeFrontmatterKey(key, mappings) === 'Synopsis')
        ?? authorKeyFor('Synopsis', settings);
}

/** Write only if the value still matches what the author began editing. */
export function updateSynopsis(
    frontmatter: Record<string, unknown>, settings: RadialTimelineSettings, expected: unknown, value: string,
): boolean {
    const key = synopsisKey(frontmatter, settings);
    if (frontmatter[key] !== expected) return false;
    frontmatter[key] = value;
    return true;
}
