import { describe, expect, it } from 'vitest';
import type { BookProfile } from '../types/settings';
import type { TimelineItem } from '../types';
import { normalizeBookProfile } from '../utils/books';
import { extractFrontmatterObject } from '../utils/frontmatter';
import {
    assertNormalizedBookProfile,
    assertScenesWithinBook,
    buildBookMigrationInput,
    findBookProfileNormalizationViolations,
} from './partMarkersAdapter';
import { planBookMigration } from './partMarkers';

const BOOK_FOLDER = 'Books/A';

function makeBook(overrides: Partial<BookProfile> = {}): BookProfile {
    return normalizeBookProfile({
        id: 'book-1',
        title: 'A Book',
        sourceFolder: BOOK_FOLDER,
        ...overrides,
    } as BookProfile);
}

interface SceneFixture {
    item: TimelineItem;
    frontmatter: Record<string, unknown>;
}

/**
 * A scene plus the exporter-equivalent frontmatter the adapter requires.
 *
 * `rawFrontmatter` is deliberately set to values that would produce a DIFFERENT
 * plan, so any test that passes only because the adapter fell back to the
 * metadata cache fails loudly. That fallback is the bug this shape prevents:
 * SceneDataService applies user key mappings to `rawFrontmatter`, the exporter
 * applies none, so planning from the cache derives boundaries the export never
 * emits.
 */
function makeScene(
    title: string,
    frontmatter: Record<string, unknown>,
    path = `${BOOK_FOLDER}/${title}.md`
): SceneFixture {
    return {
        item: {
            itemType: 'Scene',
            path,
            title,
            date: '',
            rawFrontmatter: { Act: 99, Part: 'FROM CACHE — must not be used' },
        },
        frontmatter,
    };
}

function build(
    book: BookProfile,
    entries: SceneFixture[],
    extra: { migrationWrittenPaths?: ReadonlySet<string> } = {}
) {
    return buildBookMigrationInput({
        book,
        scenes: entries.map(entry => entry.item),
        frontmatterByPath: new Map(
            entries.map(entry => [entry.item.path as string, entry.frontmatter])
        ),
        ...extra,
    });
}

describe('book profile normalization', () => {
    it('accepts a profile that has been through normalizeBookProfile', () => {
        const book = makeBook({
            layoutOptions: {
                layout: { actEpigraphs: ['  A quote.  ', ''], actEpigraphAttributions: ['Camus'] },
            },
        });
        expect(findBookProfileNormalizationViolations(book)).toEqual([]);
    });

    it('catches untrimmed entries', () => {
        const book = {
            id: 'b', title: 'B', sourceFolder: '',
            layoutOptions: { layout: { actEpigraphs: ['A quote. '] } },
        } as BookProfile;

        expect(findBookProfileNormalizationViolations(book)).toEqual([
            { layoutId: 'layout', field: 'actEpigraphs', detail: 'Entry 1 is not trimmed.' },
        ]);
    });

    it('catches trailing empty entries', () => {
        const book = {
            id: 'b', title: 'B', sourceFolder: '',
            layoutOptions: { layout: { actEpigraphAttributions: ['Camus', ''] } },
        } as BookProfile;

        expect(findBookProfileNormalizationViolations(book)).toEqual([
            {
                layoutId: 'layout',
                field: 'actEpigraphAttributions',
                detail: 'Trailing empty entries were not truncated.',
            },
        ]);
    });

    it('throws from the assert, naming the book and the fix', () => {
        const book = {
            id: 'book-9', title: 'B', sourceFolder: '',
            layoutOptions: { layout: { actEpigraphs: [' x'] } },
        } as BookProfile;

        expect(() => assertNormalizedBookProfile(book)).toThrow(/book-9/);
        expect(() => assertNormalizedBookProfile(book)).toThrow(/normalizeBookProfile/);
    });
});

describe('assertScenesWithinBook', () => {
    it('accepts paths inside the book folder', () => {
        expect(() => assertScenesWithinBook(makeBook(), [`${BOOK_FOLDER}/1 A.md`])).not.toThrow();
    });

    it('rejects a path from another book', () => {
        expect(() => assertScenesWithinBook(makeBook(), ['Books/B/1 A.md']))
            .toThrow(/outside its source folder/);
    });

    it('tolerates a trailing slash on the source folder', () => {
        const book = makeBook({ sourceFolder: `${BOOK_FOLDER}/` });
        expect(() => assertScenesWithinBook(book, [`${BOOK_FOLDER}/1 A.md`])).not.toThrow();
    });

    it('rejects every scene when the book has no source folder', () => {
        // Matches the export: resolveBookScopedMarkdownFiles yields ZERO files
        // for a book with no source path, so such a book has nothing to export
        // and nothing to migrate. Treating empty as "no constraint" would let
        // the migration plan writes across a vault the export never touches.
        const book = makeBook({ sourceFolder: '' });
        expect(() => assertScenesWithinBook(book, ['Anywhere/1 A.md']))
            .toThrow(/outside its source folder \(none set\)/);
    });

    it('accepts an empty scene list for a book with no source folder', () => {
        // Nothing in scope is not the same as an error; only supplied strays are.
        expect(() => assertScenesWithinBook(makeBook({ sourceFolder: '' }), [])).not.toThrow();
    });

    it('rejects a vault-root scope, which is not an explicit folder', () => {
        for (const folder of ['/', '.']) {
            expect(() => assertScenesWithinBook(makeBook({ sourceFolder: folder }), ['1 A.md']))
                .toThrow(/outside its source folder/);
        }
    });

    it('accepts the folder note itself, matching the export predicate', () => {
        expect(() => assertScenesWithinBook(makeBook(), [BOOK_FOLDER])).not.toThrow();
    });

    it('does not accept a sibling folder that merely shares a prefix', () => {
        expect(() => assertScenesWithinBook(makeBook(), ['Books/Away/1 A.md']))
            .toThrow(/outside its source folder/);
    });
});

describe('buildBookMigrationInput', () => {
    it('orders scenes by manuscript number, not by the order supplied', () => {
        const input = build(makeBook(), [
            makeScene('3 Third', { Act: 2 }),
            makeScene('1 First', { Act: 1 }),
            makeScene('2 Second', { Act: 1 }),
        ]);

        expect(input.scenes.map(scene => scene.path)).toEqual([
            `${BOOK_FOLDER}/1 First.md`,
            `${BOOK_FOLDER}/2 Second.md`,
            `${BOOK_FOLDER}/3 Third.md`,
        ]);
    });

    it('reads from the supplied frontmatter, never the metadata cache', () => {
        // The fixtures' rawFrontmatter says Act 99 and carries a Part marker.
        // If the adapter read it, this book would classify as author-owned.
        const input = build(makeBook(), [
            makeScene('1 A', { Act: 1 }),
            makeScene('2 B', { Act: 2 }),
        ]);

        expect(input.scenes.map(scene => scene.act)).toEqual([1, 2]);
        expect(input.scenes.every(scene => scene.part === undefined)).toBe(true);
        expect(planBookMigration(input).status).toBe('derive');
    });

    it('reads Act and Part uncoerced, so the boolean sentinel survives', () => {
        const input = build(makeBook(), [
            makeScene('1 A', { Act: 1, Part: true }),
            makeScene('2 B', { Act: '2', Part: 'The Crossing' }),
        ]);

        expect(input.scenes[0].part).toBe(true);
        expect(input.scenes[1].part).toBe('The Crossing');
        expect(input.scenes[1].act).toBe('2');
    });

    it('tolerates case and separator drift in the field keys', () => {
        const input = build(makeBook(), [makeScene('1 A', { act: 1, part: 'Named' })]);
        expect(input.scenes[0].act).toBe(1);
        expect(input.scenes[0].part).toBe('Named');
    });

    it('drops beats, backdrops and matter notes', () => {
        const beat: SceneFixture = {
            item: { itemType: 'Beat', path: `${BOOK_FOLDER}/1 Beat.md`, title: '1 Beat', date: '' },
            frontmatter: {},
        };
        const matter: SceneFixture = {
            item: {
                itemType: 'Frontmatter',
                path: `${BOOK_FOLDER}/0.1 Title.md`,
                title: 'Title Page',
                date: '',
            },
            frontmatter: {},
        };

        const input = build(makeBook(), [beat, matter, makeScene('1 A', { Act: 1 })]);
        expect(input.scenes.map(scene => scene.path)).toEqual([`${BOOK_FOLDER}/1 A.md`]);
    });

    it('collects epigraphs per layout, keeping arrays aligned to act index', () => {
        const input = build(
            makeBook({
                layoutOptions: {
                    'bundled-fiction-modern-classic': {
                        actEpigraphs: ['One.', 'Two.'],
                        actEpigraphAttributions: ['A', 'B'],
                    },
                },
            }),
            [makeScene('1 A', { Act: 1 })]
        );

        expect(input.storedEpigraphs).toEqual({
            'bundled-fiction-modern-classic': { quotes: ['One.', 'Two.'], attributions: ['A', 'B'] },
        });
    });

    it('omits storedEpigraphs entirely when the book has none', () => {
        expect(build(makeBook(), []).storedEpigraphs).toBeUndefined();
    });

    it('passes the journal disown-set through untouched', () => {
        const written = new Set([`${BOOK_FOLDER}/1 A.md`]);
        const input = build(makeBook(), [makeScene('1 A', { Act: 1 })], {
            migrationWrittenPaths: written,
        });
        expect(input.migrationWrittenPaths).toBe(written);
    });

    it('refuses a book profile that was never normalized', () => {
        expect(() => buildBookMigrationInput({
            book: {
                id: 'b', title: 'B', sourceFolder: '',
                layoutOptions: { layout: { actEpigraphs: ['untrimmed '] } },
            } as BookProfile,
            scenes: [],
            frontmatterByPath: new Map(),
        })).toThrow(/not normalized/);
    });

    it('refuses to plan when a scene could not be read', () => {
        // An unreadable file is not the same fact as a scene without an Act;
        // treating it as "no Act" would block the book for the wrong reason.
        expect(() => buildBookMigrationInput({
            book: makeBook(),
            scenes: [makeScene('1 A', { Act: 1 }).item],
            frontmatterByPath: new Map(),
        })).toThrow(/missing exporter-equivalent frontmatter/);
    });

    it('refuses a scene from outside the book', () => {
        expect(() => build(makeBook(), [
            makeScene('1 A', { Act: 1 }),
            makeScene('2 B', { Act: 2 }, 'Books/Other/2 B.md'),
        ])).toThrow(/outside its source folder/);
    });
});

describe('exporter equivalence', () => {
    it('parses raw note text the way the export does', () => {
        // Round-trip through the same helper the exporter uses, so the adapter's
        // input in production is provably the export's own view.
        const note = [
            '---',
            'Class: Scene',
            'Act: 2',
            'Part: true',
            '---',
            '',
            'Body text.',
        ].join('\n');

        const frontmatter = extractFrontmatterObject(note);
        expect(frontmatter).not.toBeNull();

        const input = buildBookMigrationInput({
            book: makeBook(),
            scenes: [makeScene('1 A', {}).item],
            frontmatterByPath: new Map([
                [`${BOOK_FOLDER}/1 A.md`, frontmatter as Record<string, unknown>],
            ]),
        });

        expect(input.scenes[0].act).toBe(2);
        expect(input.scenes[0].part).toBe(true);
    });
});

describe('adapter feeding the planner end to end', () => {
    it('derives markers from a well-formed book, carrying its epigraphs', () => {
        const input = build(
            makeBook({
                layoutOptions: {
                    layout: {
                        actEpigraphs: ['The absurd does not liberate.', 'Who draws back?'],
                        actEpigraphAttributions: ['Albert Camus', 'Arthur Rimbaud'],
                    },
                },
            }),
            [
                makeScene('2 Second', { Act: 1 }),
                makeScene('4 Fourth', { Act: 2 }),
                makeScene('1 First', { Act: 1 }),
                makeScene('3 Third', { Act: 2 }),
            ]
        );

        const plan = planBookMigration(input);

        expect(plan.status).toBe('derive');
        if (plan.status !== 'derive') return;
        // Boundaries land on the first scene of each act in narrative order —
        // correct only because the adapter sorted before the planner ran.
        expect(plan.writes).toEqual([
            {
                path: `${BOOK_FOLDER}/1 First.md`,
                title: true,
                actNumber: 1,
                partNumber: 1,
                quote: 'The absurd does not liberate.',
                attribution: 'Albert Camus',
            },
            {
                path: `${BOOK_FOLDER}/3 Third.md`,
                title: true,
                actNumber: 2,
                partNumber: 2,
                quote: 'Who draws back?',
                attribution: 'Arthur Rimbaud',
            },
        ]);
    });

    it('classifies a book the author already marked up as author-owned', () => {
        const plan = planBookMigration(build(makeBook(), [
            makeScene('1 First', { Act: 1, Part: true }),
            makeScene('2 Second', { Act: 2, Part: 'The Crossing' }),
        ]));

        expect(plan.status).toBe('author-owned');
        if (plan.status !== 'author-owned') return;
        expect(plan.markerPaths).toEqual([
            `${BOOK_FOLDER}/1 First.md`,
            `${BOOK_FOLDER}/2 Second.md`,
        ]);
    });

    it('blocks a re-entrant book built from real scene ordering', () => {
        const plan = planBookMigration(build(makeBook(), [
            makeScene('1 First', { Act: 1 }),
            makeScene('2 Second', { Act: 2 }),
            makeScene('3 Third', { Act: 1 }),
        ]));

        expect(plan.status).toBe('blocked');
        if (plan.status !== 'blocked') return;
        expect(plan.reason).toBe('re-entrant-acts');
        expect(plan.scenes.map(scene => scene.path)).toEqual([`${BOOK_FOLDER}/3 Third.md`]);
    });
});
