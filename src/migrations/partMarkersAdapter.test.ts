import { describe, expect, it } from 'vitest';
import type { BookProfile } from '../types/settings';
import type { TimelineItem } from '../types';
import { normalizeBookProfile } from '../utils/books';
import {
    assertNormalizedBookProfile,
    buildBookMigrationInput,
    findBookProfileNormalizationViolations,
} from './partMarkersAdapter';
import { planBookMigration } from './partMarkers';

function makeBook(overrides: Partial<BookProfile> = {}): BookProfile {
    return normalizeBookProfile({
        id: 'book-1',
        title: 'A Book',
        sourceFolder: 'Books/A',
        ...overrides,
    } as BookProfile);
}

function makeScene(
    title: string,
    frontmatter: Record<string, unknown>,
    path = `Scenes/${title}.md`
): TimelineItem {
    return {
        itemType: 'Scene',
        path,
        title,
        date: '',
        rawFrontmatter: frontmatter,
    };
}

describe('findBookProfileNormalizationViolations', () => {
    it('accepts a profile that has been through normalizeBookProfile', () => {
        const book = makeBook({
            layoutOptions: {
                layout: { actEpigraphs: ['  A quote.  ', ''], actEpigraphAttributions: ['Camus'] },
            },
        });
        expect(findBookProfileNormalizationViolations(book)).toEqual([]);
    });

    it('catches untrimmed entries', () => {
        // Constructed by hand, bypassing normalizeBookProfile.
        const book = {
            id: 'b',
            title: 'B',
            sourceFolder: '',
            layoutOptions: { layout: { actEpigraphs: ['A quote. '] } },
        } as BookProfile;

        expect(findBookProfileNormalizationViolations(book)).toEqual([
            { layoutId: 'layout', field: 'actEpigraphs', detail: 'Entry 1 is not trimmed.' },
        ]);
    });

    it('catches trailing empty entries', () => {
        const book = {
            id: 'b',
            title: 'B',
            sourceFolder: '',
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

    it('throws from the assert, naming the book and the violation', () => {
        const book = {
            id: 'book-9',
            title: 'B',
            sourceFolder: '',
            layoutOptions: { layout: { actEpigraphs: [' x'] } },
        } as BookProfile;

        expect(() => assertNormalizedBookProfile(book)).toThrow(/book-9/);
        expect(() => assertNormalizedBookProfile(book)).toThrow(/normalizeBookProfile/);
    });
});

describe('buildBookMigrationInput', () => {
    it('orders scenes by manuscript number, not by the order supplied', () => {
        const input = buildBookMigrationInput({
            book: makeBook(),
            scenes: [
                makeScene('3 Third', { Act: 2 }),
                makeScene('1 First', { Act: 1 }),
                makeScene('2 Second', { Act: 1 }),
            ],
        });

        expect(input.scenes.map(scene => scene.path)).toEqual([
            'Scenes/1 First.md',
            'Scenes/2 Second.md',
            'Scenes/3 Third.md',
        ]);
    });

    it('reads Act and Part uncoerced, so the boolean sentinel survives', () => {
        const input = buildBookMigrationInput({
            book: makeBook(),
            scenes: [
                makeScene('1 A', { Act: 1, Part: true }),
                makeScene('2 B', { Act: '2', Part: 'The Crossing' }),
            ],
        });

        expect(input.scenes[0].part).toBe(true);
        expect(input.scenes[1].part).toBe('The Crossing');
        expect(input.scenes[1].act).toBe('2');
    });

    it('tolerates case and separator drift in the field keys', () => {
        const input = buildBookMigrationInput({
            book: makeBook(),
            scenes: [makeScene('1 A', { act: 1, part: 'Named' })],
        });

        expect(input.scenes[0].act).toBe(1);
        expect(input.scenes[0].part).toBe('Named');
    });

    it('drops beats, backdrops and matter notes', () => {
        const beat: TimelineItem = { itemType: 'Beat', path: 'Beats/1.md', title: '1 Beat', date: '' };
        const matter: TimelineItem = {
            itemType: 'Frontmatter',
            path: 'Books/A/0.1 Title.md',
            title: 'Title Page',
            date: '',
        };

        const input = buildBookMigrationInput({
            book: makeBook(),
            scenes: [beat, matter, makeScene('1 A', { Act: 1 })],
        });

        expect(input.scenes.map(scene => scene.path)).toEqual(['Scenes/1 A.md']);
    });

    it('collects epigraphs per layout, keeping arrays aligned to act index', () => {
        const input = buildBookMigrationInput({
            book: makeBook({
                layoutOptions: {
                    'bundled-fiction-modern-classic': {
                        actEpigraphs: ['One.', 'Two.'],
                        actEpigraphAttributions: ['A', 'B'],
                    },
                },
            }),
            scenes: [makeScene('1 A', { Act: 1 })],
        });

        expect(input.storedEpigraphs).toEqual({
            'bundled-fiction-modern-classic': {
                quotes: ['One.', 'Two.'],
                attributions: ['A', 'B'],
            },
        });
    });

    it('omits storedEpigraphs entirely when the book has none', () => {
        const input = buildBookMigrationInput({ book: makeBook(), scenes: [] });
        expect(input.storedEpigraphs).toBeUndefined();
    });

    it('passes the journal disown-set through untouched', () => {
        const written = new Set(['Scenes/1 A.md']);
        const input = buildBookMigrationInput({
            book: makeBook(),
            scenes: [makeScene('1 A', { Act: 1 })],
            migrationWrittenPaths: written,
        });
        expect(input.migrationWrittenPaths).toBe(written);
    });

    it('refuses a book profile that was never normalized', () => {
        expect(() => buildBookMigrationInput({
            book: {
                id: 'b',
                title: 'B',
                sourceFolder: '',
                layoutOptions: { layout: { actEpigraphs: ['untrimmed '] } },
            } as BookProfile,
            scenes: [],
        })).toThrow(/not normalized/);
    });
});

describe('adapter feeding the planner end to end', () => {
    it('derives markers from a well-formed book, carrying its epigraphs', () => {
        const input = buildBookMigrationInput({
            book: makeBook({
                layoutOptions: {
                    layout: {
                        actEpigraphs: ['The absurd does not liberate.', 'Who draws back?'],
                        actEpigraphAttributions: ['Albert Camus', 'Arthur Rimbaud'],
                    },
                },
            }),
            scenes: [
                makeScene('2 Second', { Act: 1 }),
                makeScene('4 Fourth', { Act: 2 }),
                makeScene('1 First', { Act: 1 }),
                makeScene('3 Third', { Act: 2 }),
            ],
        });

        const plan = planBookMigration(input);

        expect(plan.status).toBe('derive');
        if (plan.status !== 'derive') return;
        // Boundaries land on the first scene of each act in narrative order —
        // which is only correct because the adapter sorted before the planner ran.
        expect(plan.writes).toEqual([
            {
                path: 'Scenes/1 First.md',
                title: true,
                actNumber: 1,
                partNumber: 1,
                quote: 'The absurd does not liberate.',
                attribution: 'Albert Camus',
            },
            {
                path: 'Scenes/3 Third.md',
                title: true,
                actNumber: 2,
                partNumber: 2,
                quote: 'Who draws back?',
                attribution: 'Arthur Rimbaud',
            },
        ]);
    });

    it('classifies a book the author already marked up as author-owned', () => {
        const plan = planBookMigration(buildBookMigrationInput({
            book: makeBook(),
            scenes: [
                makeScene('1 First', { Act: 1, Part: true }),
                makeScene('2 Second', { Act: 2, Part: 'The Crossing' }),
            ],
        }));

        expect(plan.status).toBe('author-owned');
        if (plan.status !== 'author-owned') return;
        expect(plan.markerPaths).toEqual(['Scenes/1 First.md', 'Scenes/2 Second.md']);
    });

    it('blocks a re-entrant book built from real scene ordering', () => {
        const plan = planBookMigration(buildBookMigrationInput({
            book: makeBook(),
            scenes: [
                makeScene('1 First', { Act: 1 }),
                makeScene('2 Second', { Act: 2 }),
                makeScene('3 Third', { Act: 1 }),
            ],
        }));

        expect(plan.status).toBe('blocked');
        if (plan.status !== 'blocked') return;
        expect(plan.reason).toBe('re-entrant-acts');
        expect(plan.scenes.map(scene => scene.path)).toEqual(['Scenes/3 Third.md']);
    });
});
