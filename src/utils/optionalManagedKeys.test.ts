import { describe, expect, it } from 'vitest';
import {
    getOptionalManagedKeys,
    isOptionalManagedKey,
    withOptionalManagedKeys,
} from './optionalManagedKeys';

const PART_KEYS = ['Part', 'Part Epigraph', 'Part Epigraph By'];

/** The Scene base template's key order, trimmed to the region that matters here. */
const SCENE_ORDER = ['ID', 'Class', 'Act', 'When', 'Duration', 'Chapter', 'Synopsis'];

describe('optionalManagedKeys', () => {
    describe('registry', () => {
        it('declares the Part fields for scenes only', () => {
            expect(getOptionalManagedKeys('Scene')).toEqual(PART_KEYS);
            expect(getOptionalManagedKeys('Beat')).toEqual([]);
            expect(getOptionalManagedKeys('Backdrop')).toEqual([]);
        });

        it('recognises Part fields as optional-managed for scenes', () => {
            for (const key of PART_KEYS) {
                expect(isOptionalManagedKey('Scene', key)).toBe(true);
                // Registration is per note type — a Beat carrying `Part` is still foreign.
                expect(isOptionalManagedKey('Beat', key)).toBe(false);
            }
        });

        it('does not claim template or foreign keys', () => {
            expect(isOptionalManagedKey('Scene', 'Chapter')).toBe(false);
            expect(isOptionalManagedKey('Scene', 'Act')).toBe(false);
            expect(isOptionalManagedKey('Scene', 'SomeOtherPluginField')).toBe(false);
        });
    });

    describe('withOptionalManagedKeys', () => {
        it('places Part fields immediately before Chapter, in declaration order', () => {
            expect(withOptionalManagedKeys('Scene', SCENE_ORDER)).toEqual([
                'ID',
                'Class',
                'Act',
                'When',
                'Duration',
                'Part',
                'Part Epigraph',
                'Part Epigraph By',
                'Chapter',
                'Synopsis',
            ]);
        });

        it('falls back to the first available anchor when Chapter was removed', () => {
            // A customized template may drop Chapter entirely; the keys must still
            // land somewhere defined rather than being appended to the tail.
            const withoutChapter = ['ID', 'Class', 'Act', 'When', 'Duration', 'Synopsis'];
            expect(withOptionalManagedKeys('Scene', withoutChapter)).toEqual([
                'ID',
                'Class',
                'Act',
                'When',
                'Duration',
                'Part',
                'Part Epigraph',
                'Part Epigraph By',
                'Synopsis',
            ]);
        });

        it('appends when no anchor is present at all', () => {
            expect(withOptionalManagedKeys('Scene', ['ID', 'Synopsis'])).toEqual([
                'ID',
                'Synopsis',
                'Part',
                'Part Epigraph',
                'Part Epigraph By',
            ]);
        });

        it('does not duplicate a key a template already declares', () => {
            const withPart = ['ID', 'Class', 'Part', 'Chapter'];
            const result = withOptionalManagedKeys('Scene', withPart);
            expect(result.filter((key) => key === 'Part')).toHaveLength(1);
            // The template's own placement wins; only the missing siblings are added.
            expect(result).toEqual([
                'ID',
                'Class',
                'Part',
                'Part Epigraph',
                'Part Epigraph By',
                'Chapter',
            ]);
        });

        it('leaves note types with no registered keys untouched', () => {
            const beatOrder = ['ID', 'Class', 'Purpose'];
            expect(withOptionalManagedKeys('Beat', beatOrder)).toEqual(beatOrder);
        });

        it('does not mutate the caller’s array', () => {
            const order = [...SCENE_ORDER];
            withOptionalManagedKeys('Scene', order);
            expect(order).toEqual(SCENE_ORDER);
        });
    });
});
