/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem } from '../../types';

/**
 * Schema version for the JSON data export document. Bump on breaking changes.
 * 1.1.0 (additive): adds `exportId`, a per-export provenance UUID that also
 * appears in the SVG image export's <metadata> block.
 */
export const TIMELINE_DATA_EXPORT_SCHEMA_VERSION = '1.1.0';

/** `YYYY-MM-DD`, or `YYYY-M-D` as an author may reasonably have typed it. */
const FRONTMATTER_DATE_ONLY = /^\s*\d{4}-\d{1,2}-\d{1,2}\s*$/;

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/**
 * A scene's `when` as the string the export carries.
 *
 * **A scene's time is a wall clock in the story, not an instant on Earth.**
 * `parseWhenField` turns the author's `When` frontmatter into a `Date` built
 * from LOCAL components, which is right for the plugin's own rendering — it
 * reads the same local getters back. But `JSON.stringify` serialises a `Date`
 * through `toISOString()`, which converts to UTC, and every consumer
 * downstream then reads the author's fiction shifted by whatever offset the
 * exporting machine happened to be in. A scene the author wrote at 7 PM
 * reached the website as 2 AM the next day (Eric, 2026-08-21: "why is every
 * date in the AM? not matching the actual scene! scene 1 is at 7pm").
 *
 * So the components are written out LOCAL and unzoned — the same digits the
 * author typed, which is exactly how the reading end treats them.
 *
 * The second half of the same defect: a `When` with no time in it at all is
 * parsed to local noon, and noon-in-UTC is a precise-looking hour the author
 * never wrote. A date-only source therefore stays date-only here, and the
 * reader is shown a day rather than an invented clock time.
 */
export function wallClockWhen(item: Pick<TimelineItem, 'when' | 'rawFrontmatter'>): string | undefined {
    const when = item.when;
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) return undefined;

    const date = `${pad(when.getFullYear(), 4)}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;

    const raw = item.rawFrontmatter?.['When'];
    if (typeof raw === 'string' && FRONTMATTER_DATE_ONLY.test(raw)) return date;

    return `${date}T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
}
