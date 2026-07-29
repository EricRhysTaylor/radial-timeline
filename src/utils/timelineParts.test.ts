import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import {
    readPartMarker,
    resolvePartMarkerValue,
    resolveTimelinePartMarkers,
} from './timelineParts';

function makeItem(
    itemType: TimelineItem['itemType'],
    path: string,
    title: string,
    part?: unknown
): TimelineItem {
    return {
        itemType,
        path,
        title,
        date: '',
        rawFrontmatter: part === undefined ? {} : { Part: part },
    };
}

/**
 * Frontmatter spellings and the values they parse to.
 *
 * Both marker sources hand the resolver an already-parsed value: Obsidian's metadata
 * cache (timeline path) and `parseYaml` (export path). So the resolver contract is
 * value-shaped, and this table pins the YAML spelling → value mapping the contract
 * depends on.
 *
 * The right column was verified against js-yaml 4.2.0 — Obsidian's parser — on
 * 2026-07-29. js-yaml is only a transitive dependency here, so the mapping is captured
 * as fixture data rather than re-derived at test time. `yes`/`no` are the load-bearing
 * entries: YAML 1.1 read them as booleans, js-yaml 4 reads them as strings, which is
 * why they are part *titles* and not untitled markers.
 */
const YAML_FORMS: Array<{ yaml: string; parsed: unknown; marker: boolean; title?: string }> = [
    { yaml: 'Part: true', parsed: true, marker: true },
    { yaml: 'Part: True', parsed: true, marker: true },
    { yaml: 'Part: "true"', parsed: 'true', marker: true, title: 'true' },
    { yaml: 'Part: yes', parsed: 'yes', marker: true, title: 'yes' },
    { yaml: 'Part: no', parsed: 'no', marker: true, title: 'no' },
    { yaml: 'Part: The Crossing', parsed: 'The Crossing', marker: true, title: 'The Crossing' },
    { yaml: 'Part: false', parsed: false, marker: false },
    { yaml: 'Part:', parsed: null, marker: false },
    { yaml: 'Part: 1', parsed: 1, marker: false },
    { yaml: 'Part: [a, b]', parsed: ['a', 'b'], marker: false },
    { yaml: 'Part: {a: 1}', parsed: { a: 1 }, marker: false },
];

describe('timelineParts', () => {
    describe('resolvePartMarkerValue', () => {
        it('treats only boolean true as an untitled marker', () => {
            expect(resolvePartMarkerValue(true)).toEqual({ titled: false });
            // Truthy-but-not-true must not become a marker — strict identity, not coercion.
            expect(resolvePartMarkerValue(1)).toBeNull();
            expect(resolvePartMarkerValue('  ')).toBeNull();
        });

        it('treats non-empty strings as titles, trimmed', () => {
            expect(resolvePartMarkerValue('The Crossing')).toEqual({
                titled: true,
                title: 'The Crossing',
            });
            expect(resolvePartMarkerValue('  The Crossing  ')).toEqual({
                titled: true,
                title: 'The Crossing',
            });
        });

        it('distinguishes boolean true from the quoted string "true"', () => {
            expect(resolvePartMarkerValue(true)).toEqual({ titled: false });
            expect(resolvePartMarkerValue('true')).toEqual({ titled: true, title: 'true' });
        });

        it('creates no marker for false, empty, or non-scalar values', () => {
            expect(resolvePartMarkerValue(false)).toBeNull();
            expect(resolvePartMarkerValue(null)).toBeNull();
            expect(resolvePartMarkerValue(undefined)).toBeNull();
            expect(resolvePartMarkerValue('')).toBeNull();
            expect(resolvePartMarkerValue(0)).toBeNull();
            expect(resolvePartMarkerValue(42)).toBeNull();
            expect(resolvePartMarkerValue(['a', 'b'])).toBeNull();
            expect(resolvePartMarkerValue({ a: 1 })).toBeNull();
        });
    });

    describe('frontmatter spellings', () => {
        it.each(YAML_FORMS)('resolves `$yaml`', ({ parsed, marker, title }) => {
            const resolved = readPartMarker({ Part: parsed });
            if (!marker) {
                expect(resolved).toBeNull();
                return;
            }
            expect(resolved).toEqual(
                title === undefined ? { titled: false } : { titled: true, title }
            );
        });
    });

    describe('readPartMarker', () => {
        it('tolerates case and separator drift in the key', () => {
            expect(readPartMarker({ part: 'The Crossing' })).toEqual({
                titled: true,
                title: 'The Crossing',
            });
            expect(readPartMarker({ PART: true })).toEqual({ titled: false });
        });

        it('does not mistake sibling Part fields for the marker', () => {
            expect(
                readPartMarker({
                    'Part Epigraph': 'We shall not cease from exploration.',
                    'Part Epigraph By': 'T.S. Eliot',
                })
            ).toBeNull();
        });

        it('returns null for missing frontmatter or a missing key', () => {
            expect(readPartMarker(undefined)).toBeNull();
            expect(readPartMarker({})).toBeNull();
            expect(readPartMarker({ Chapter: 'Boy with a Skull' })).toBeNull();
        });
    });

    describe('resolveTimelinePartMarkers', () => {
        it('resolves scene markers and ignores beat/backdrop Part fields', () => {
            const items: TimelineItem[] = [
                makeItem('Beat', 'Beats/1.md', '1 Opening Beat', 'Ignored'),
                makeItem('Backdrop', 'Backdrop/1.md', '1.5 Storm Front', 'Ignored'),
                makeItem('Scene', 'Scenes/1.md', '2 Opening Scene'),
                makeItem('Scene', 'Scenes/2.md', '3 Second Scene', 'The Crossing'),
            ];

            expect(resolveTimelinePartMarkers(items)).toEqual([
                {
                    sourcePath: 'Scenes/2.md',
                    sourceType: 'Scene',
                    titled: true,
                    title: 'The Crossing',
                    resolvedScenePath: 'Scenes/2.md',
                    resolvedTimelinePosition: 2,
                },
            ]);
        });

        it('carries untitled markers without a title key', () => {
            const markers = resolveTimelinePartMarkers([
                makeItem('Scene', 'Scenes/1.md', '1 Scene', true),
            ]);

            expect(markers).toEqual([
                {
                    sourcePath: 'Scenes/1.md',
                    sourceType: 'Scene',
                    titled: false,
                    resolvedScenePath: 'Scenes/1.md',
                    resolvedTimelinePosition: 1,
                },
            ]);
            expect(markers[0]).not.toHaveProperty('title');
        });

        it('counts scene positions only, across a mixed titled/untitled book', () => {
            const markers = resolveTimelinePartMarkers([
                makeItem('Scene', 'Scenes/1.md', '1 Scene', true),
                makeItem('Beat', 'Beats/1.md', '2 Beat'),
                makeItem('Scene', 'Scenes/2.md', '3 Scene'),
                makeItem('Scene', 'Scenes/3.md', '4 Scene', 'The Crossing'),
            ]);

            expect(
                markers.map((m) => [m.resolvedTimelinePosition, m.titled, m.title])
            ).toEqual([
                [1, false, undefined],
                [3, true, 'The Crossing'],
            ]);
        });

        it('skips scenes with no path and produces no markers for an unmarked book', () => {
            const unmarked = resolveTimelinePartMarkers([
                makeItem('Scene', 'Scenes/1.md', '1 Scene'),
                makeItem('Scene', 'Scenes/2.md', '2 Scene', ''),
                makeItem('Scene', 'Scenes/3.md', '3 Scene', false),
            ]);
            expect(unmarked).toEqual([]);
        });
    });
});
