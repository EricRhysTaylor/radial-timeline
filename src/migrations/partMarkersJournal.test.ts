import { describe, expect, it } from 'vitest';
import type { BookMigrationPlan, PartMarkerWrite } from './partMarkers';
import {
    PART_MIGRATION_JOURNAL_SCHEMA,
    changesForWrite,
    classifyFieldRecovery,
    classifySceneRecovery,
    fingerprintPlan,
    getMigrationWrittenPaths,
    parseJournal,
    serializeJournal,
    type JournalFieldChange,
    type PartMigrationJournal,
} from './partMarkersJournal';

function derivePlan(writes: PartMarkerWrite[]): BookMigrationPlan {
    return { bookId: 'book-1', status: 'derive', writes };
}

function write(overrides: Partial<PartMarkerWrite> = {}): PartMarkerWrite {
    return { path: 'Books/A/1.md', title: true, actNumber: 1, partNumber: 1, ...overrides };
}

function journal(overrides: Partial<PartMigrationJournal> = {}): PartMigrationJournal {
    return {
        schema: PART_MIGRATION_JOURNAL_SCHEMA,
        startedAt: '2026-07-29T10:00:00.000Z',
        books: [],
        ...overrides,
    };
}

describe('fingerprintPlan', () => {
    it('is stable across runs for the same plan', () => {
        const plan = derivePlan([write(), write({ path: 'Books/A/2.md', partNumber: 2 })]);
        expect(fingerprintPlan(plan)).toBe(fingerprintPlan(plan));
    });

    it('ignores the order writes happen to arrive in', () => {
        const a = write({ path: 'Books/A/1.md' });
        const b = write({ path: 'Books/A/2.md', partNumber: 2 });
        expect(fingerprintPlan(derivePlan([a, b]))).toBe(fingerprintPlan(derivePlan([b, a])));
    });

    it('changes when a target path changes', () => {
        expect(fingerprintPlan(derivePlan([write()])))
            .not.toBe(fingerprintPlan(derivePlan([write({ path: 'Books/A/9.md' })])));
    });

    it('changes when epigraph text changes', () => {
        // Epigraph text is a value the migration writes, so a change to it makes
        // a resumed write wrong even though the marker paths are identical.
        expect(fingerprintPlan(derivePlan([write({ quote: 'One.' })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ quote: 'Two.' })])));
    });

    it('distinguishes an untitled marker from one titled "true"', () => {
        expect(fingerprintPlan(derivePlan([write({ title: true })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ title: 'true' })])));
    });

    it('distinguishes non-derive outcomes without inventing write detail', () => {
        const blocked: BookMigrationPlan = {
            bookId: 'book-1',
            status: 'blocked',
            reason: 're-entrant-acts',
            scenes: [],
            detail: '',
        };
        expect(fingerprintPlan(blocked)).toBe('blocked:book-1');
        expect(fingerprintPlan(blocked)).not.toBe(fingerprintPlan(derivePlan([write()])));
    });
});

describe('changesForWrite', () => {
    it('records the marker and both epigraph fields against an untouched scene', () => {
        const changes = changesForWrite(
            write({ title: true, quote: 'A quote.', attribution: 'Camus' }),
            {}
        );

        expect(changes).toEqual([
            { field: 'Part', before: null, after: true },
            { field: 'Part Epigraph', before: null, after: 'A quote.' },
            { field: 'Part Epigraph By', before: null, after: 'Camus' },
        ]);
    });

    it('omits fields the migration would leave exactly as it found them', () => {
        // Recording a no-op would invite a needless write to an author's file.
        const changes = changesForWrite(write({ title: true }), { Part: true });
        expect(changes).toEqual([]);
    });

    it('treats an absent key and an empty string as different prior states', () => {
        // Clearing a marker deletes the key, so "absent" and "blank" are
        // different end states; collapsing them would make restore unable to
        // tell "remove this" from "blank this".
        const changes = changesForWrite(write({ title: true }), { Part: '' });
        expect(changes).toEqual([{ field: 'Part', before: '', after: true }]);
    });

    it('carries an attribution with no quote', () => {
        const changes = changesForWrite(write({ attribution: 'Anonymous' }), {});
        expect(changes).toEqual([
            { field: 'Part', before: null, after: true },
            { field: 'Part Epigraph By', before: null, after: 'Anonymous' },
        ]);
    });
});

describe('classifyFieldRecovery — the three-way check', () => {
    const change: JournalFieldChange = { field: 'Part', before: null, after: true };

    it('sees a landed write', () => {
        expect(classifyFieldRecovery(change, true)).toBe('already-applied');
    });

    it('sees a write that never landed', () => {
        expect(classifyFieldRecovery(change, null)).toBe('pending');
    });

    it('sees an author edit as drift, not as either endpoint', () => {
        // Two values could not tell this apart: knowing only the intended value
        // cannot distinguish a landed write from the author typing the same
        // thing, and knowing only the prior value cannot distinguish "not yet
        // written" from "written then reverted".
        expect(classifyFieldRecovery(change, 'The Crossing')).toBe('author-drift');
    });

    it('does not confuse an empty string with an absent key', () => {
        expect(classifyFieldRecovery(change, '')).toBe('author-drift');
    });
});

describe('classifySceneRecovery', () => {
    const applied: JournalFieldChange = { field: 'Part', before: null, after: true };
    const epigraph: JournalFieldChange = { field: 'Part Epigraph', before: null, after: 'A quote.' };

    it('reports a fully applied scene', () => {
        expect(classifySceneRecovery(
            { path: 'p', changes: [applied, epigraph] },
            { Part: true, 'Part Epigraph': 'A quote.' }
        )).toBe('already-applied');
    });

    it('reports an untouched scene as pending', () => {
        expect(classifySceneRecovery({ path: 'p', changes: [applied, epigraph] }, {}))
            .toBe('pending');
    });

    it('reports a half-written scene as partial', () => {
        expect(classifySceneRecovery(
            { path: 'p', changes: [applied, epigraph] },
            { Part: true }
        )).toBe('partial');
    });

    it('lets drift dominate every other verdict', () => {
        // A scene the author touched cannot be safely resumed or restored,
        // whatever its other fields say.
        expect(classifySceneRecovery(
            { path: 'p', changes: [applied, epigraph] },
            { Part: true, 'Part Epigraph': 'Author rewrote this' }
        )).toBe('author-drift');
    });

    it('treats a scene with no recorded changes as nothing to do', () => {
        expect(classifySceneRecovery({ path: 'p', changes: [] }, {})).toBe('already-applied');
    });
});

describe('getMigrationWrittenPaths', () => {
    const book = {
        bookId: 'book-1',
        status: 'planned' as const,
        planFingerprint: 'fp',
        preExistingMarkerPaths: ['Books/A/author.md'],
        scenes: [
            { path: 'Books/A/1.md', changes: [{ field: 'Part' as const, before: null, after: true }] },
            {
                path: 'Books/A/2.md',
                changes: [{ field: 'Part Epigraph' as const, before: null, after: 'q' }],
            },
            {
                path: 'Books/A/author.md',
                changes: [{ field: 'Part Epigraph' as const, before: null, after: 'q' }],
            },
        ],
    };

    it('claims markers the migration planned to write, confirmed or not', () => {
        // Attempted counts as ours: a crashed run may have landed the marker
        // without recording success, and handing that back to the planner as
        // author intent is the exact failure the journal exists to prevent.
        expect(getMigrationWrittenPaths(journal({ books: [book] }), 'book-1'))
            .toEqual(new Set(['Books/A/1.md']));
    });

    it('never claims a marker that pre-existed the migration', () => {
        const paths = getMigrationWrittenPaths(journal({ books: [book] }), 'book-1');
        expect(paths.has('Books/A/author.md')).toBe(false);
    });

    it('ignores scenes where only epigraph fields changed', () => {
        const paths = getMigrationWrittenPaths(journal({ books: [book] }), 'book-1');
        expect(paths.has('Books/A/2.md')).toBe(false);
    });

    it('returns nothing for a book the journal has never seen', () => {
        expect(getMigrationWrittenPaths(journal({ books: [book] }), 'other')).toEqual(new Set());
    });
});

describe('parseJournal', () => {
    it('round-trips through serialization', () => {
        const source = journal({
            books: [{
                bookId: 'book-1',
                status: 'planned',
                planFingerprint: 'fp',
                preExistingMarkerPaths: ['Books/A/author.md'],
                scenes: [{
                    path: 'Books/A/1.md',
                    changes: [{ field: 'Part', before: null, after: true }],
                }],
            }],
        });

        expect(parseJournal(JSON.parse(serializeJournal(source)))).toEqual(source);
    });

    it('rejects a journal written by a different schema', () => {
        expect(parseJournal({ ...journal(), schema: 99 })).toBeNull();
    });

    it('rejects anything that is not an object', () => {
        expect(parseJournal(null)).toBeNull();
        expect(parseJournal('{}')).toBeNull();
        expect(parseJournal([])).toBeNull();
    });

    it('rejects the whole journal when any book record is malformed', () => {
        // Half a journal is worse than none: it would license resuming writes
        // whose before-values are unknown.
        const broken = journal({
            books: [
                {
                    bookId: 'ok',
                    status: 'planned',
                    planFingerprint: 'fp',
                    preExistingMarkerPaths: [],
                    scenes: [],
                },
                { bookId: 'bad', status: 'nonsense' } as unknown as PartMigrationJournal['books'][number],
            ],
        });

        expect(parseJournal(broken)).toBeNull();
    });

    it('drops change entries naming a field the migration does not own', () => {
        const parsed = parseJournal({
            ...journal(),
            books: [{
                bookId: 'book-1',
                status: 'planned',
                planFingerprint: 'fp',
                preExistingMarkerPaths: [],
                scenes: [{
                    path: 'Books/A/1.md',
                    changes: [
                        { field: 'Part', before: null, after: true },
                        { field: 'Synopsis', before: null, after: 'not ours' },
                    ],
                }],
            }],
        });

        expect(parsed?.books[0].scenes[0].changes).toEqual([
            { field: 'Part', before: null, after: true },
        ]);
    });

    it('drops change entries whose values are not frontmatter scalars', () => {
        const parsed = parseJournal({
            ...journal(),
            books: [{
                bookId: 'book-1',
                status: 'planned',
                planFingerprint: 'fp',
                preExistingMarkerPaths: [],
                scenes: [{
                    path: 'Books/A/1.md',
                    changes: [{ field: 'Part', before: { nested: true }, after: true }],
                }],
            }],
        });

        expect(parsed?.books[0].scenes[0].changes).toEqual([]);
    });
});
