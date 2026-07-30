import { describe, expect, it } from 'vitest';
import type { BookMigrationPlan, PartMarkerWrite } from './partMarkers';
import {
    ABSENT,
    PART_MIGRATION_JOURNAL_SCHEMA,
    changesForWrite,
    classifyFieldRecovery,
    classifySceneRecovery,
    fingerprintPlan,
    getMigrationWrittenPaths,
    parseJournal,
    serializeJournal,
    snapshotValue,
    snapshotsEqual,
    type JournalFieldChange,
    type JournalSnapshot,
    type PartMigrationJournal,
} from './partMarkersJournal';

const str = (value: string): JournalSnapshot => ({ kind: 'string', value });
const bool = (value: boolean): JournalSnapshot => ({ kind: 'boolean', value });

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

describe('snapshotValue', () => {
    it('separates an absent key from a key holding null', () => {
        // `Part:` with no value parses to null; no Part key at all is a
        // different state. Clearing a marker deletes the key, so restore has to
        // tell "remove this" from "blank this".
        expect(snapshotValue(undefined, false)).toEqual({ kind: 'absent' });
        expect(snapshotValue(null, true)).toEqual({ kind: 'null' });
    });

    it('preserves scalar types rather than flattening them to strings', () => {
        expect(snapshotValue('The Crossing', true)).toEqual(str('The Crossing'));
        expect(snapshotValue(true, true)).toEqual(bool(true));
        expect(snapshotValue(1, true)).toEqual({ kind: 'number', value: 1 });
    });

    it('marks lists and maps unsupported instead of losing them', () => {
        expect(snapshotValue(['a', 'b'], true)).toEqual({ kind: 'unsupported', typeName: 'list' });
        expect(snapshotValue({ nested: true }, true)).toEqual({ kind: 'unsupported', typeName: 'object' });
    });
});

describe('snapshotsEqual', () => {
    it('matches like for like', () => {
        expect(snapshotsEqual(str('a'), str('a'))).toBe(true);
        expect(snapshotsEqual(ABSENT, { kind: 'absent' })).toBe(true);
        expect(snapshotsEqual({ kind: 'null' }, { kind: 'null' })).toBe(true);
    });

    it('does not confuse an absent key with a null value or an empty string', () => {
        expect(snapshotsEqual(ABSENT, { kind: 'null' })).toBe(false);
        expect(snapshotsEqual(ABSENT, str(''))).toBe(false);
    });

    it('does not confuse a boolean with its string spelling', () => {
        expect(snapshotsEqual(bool(true), str('true'))).toBe(false);
    });

    it('never considers two unsupported values equal', () => {
        // We do not know what either holds, so we must not conclude they agree.
        const unsupported: JournalSnapshot = { kind: 'unsupported', typeName: 'list' };
        expect(snapshotsEqual(unsupported, unsupported)).toBe(false);
    });
});

describe('fingerprintPlan', () => {
    it('is stable across runs and independent of write order', () => {
        const a = write({ path: 'Books/A/1.md' });
        const b = write({ path: 'Books/A/2.md', partNumber: 2, actNumber: 2 });
        expect(fingerprintPlan(derivePlan([a, b]))).toBe(fingerprintPlan(derivePlan([b, a])));
    });

    it('changes when the structural numbering changes', () => {
        // Same paths, same values, different part numbers: a different plan, and
        // resuming across the difference would renumber the book.
        expect(fingerprintPlan(derivePlan([write({ partNumber: 1 })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ partNumber: 2 })])));
    });

    it('changes when the act a boundary opens changes', () => {
        expect(fingerprintPlan(derivePlan([write({ actNumber: 1 })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ actNumber: 2 })])));
    });

    it('changes when a path or epigraph changes', () => {
        expect(fingerprintPlan(derivePlan([write()])))
            .not.toBe(fingerprintPlan(derivePlan([write({ path: 'Books/A/9.md' })])));
        expect(fingerprintPlan(derivePlan([write({ quote: 'One.' })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ quote: 'Two.' })])));
    });

    it('distinguishes an untitled marker from one titled "true"', () => {
        expect(fingerprintPlan(derivePlan([write({ title: true })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ title: 'true' })])));
    });

    it('distinguishes non-derive outcomes without inventing write detail', () => {
        const blocked: BookMigrationPlan = {
            bookId: 'book-1', status: 'blocked', reason: 're-entrant-acts', scenes: [], detail: '',
        };
        expect(fingerprintPlan(blocked)).toBe('blocked:book-1');
    });
});

describe('changesForWrite — adds structure, never removes author content', () => {
    it('writes the marker and both epigraph fields onto an untouched scene', () => {
        const { changes, skipped } = changesForWrite(
            write({ title: true, quote: 'A quote.', attribution: 'Camus' }),
            {}
        );

        expect(skipped).toEqual([]);
        expect(changes).toEqual([
            { field: 'Part', before: ABSENT, after: bool(true) },
            { field: 'Part Epigraph', before: ABSENT, after: str('A quote.') },
            { field: 'Part Epigraph By', before: ABSENT, after: str('Camus') },
        ]);
    });

    it('leaves an epigraph field alone when the migration has nothing for it', () => {
        // Previously this wrote null, DELETING an epigraph the author had written
        // by hand simply because layout options carried nothing for that act.
        const { changes, skipped } = changesForWrite(
            write({ title: true }),
            { 'Part Epigraph': str('Author wrote this'), 'Part Epigraph By': str('Author') }
        );

        expect(changes).toEqual([{ field: 'Part', before: ABSENT, after: bool(true) }]);
        expect(skipped).toEqual([]);
    });

    it('defers to author text rather than overwriting it', () => {
        const { changes, skipped } = changesForWrite(
            write({ quote: 'From layout options', attribution: 'Camus' }),
            { 'Part Epigraph': str('The author already wrote one') }
        );

        expect(changes.map(change => change.field)).toEqual(['Part', 'Part Epigraph By']);
        expect(skipped).toEqual([{ field: 'Part Epigraph', reason: 'author-value-present' }]);
    });

    it('treats whitespace-only text as absent, not as author content', () => {
        const { changes, skipped } = changesForWrite(
            write({ quote: 'From layout options' }),
            { 'Part Epigraph': str('   ') }
        );

        expect(skipped).toEqual([]);
        expect(changes).toContainEqual({
            field: 'Part Epigraph', before: str('   '), after: str('From layout options'),
        });
    });

    it('refuses to touch a field whose current value cannot be snapshotted', () => {
        // A field it cannot faithfully restore is a field it has no business
        // writing — including the marker itself.
        const { changes, skipped } = changesForWrite(write({ quote: 'q' }), {
            Part: { kind: 'unsupported', typeName: 'list' },
        });

        expect(changes.map(change => change.field)).toEqual(['Part Epigraph']);
        expect(skipped).toEqual([{ field: 'Part', reason: 'unsupported-value' }]);
    });

    it('omits a field the migration would leave exactly as it found it', () => {
        const { changes } = changesForWrite(write({ title: true }), { Part: bool(true) });
        expect(changes).toEqual([]);
    });

    it('overwrites a marker the author left blank', () => {
        // An empty Part is not a marker (D1), so there is no author structure here.
        const { changes } = changesForWrite(write({ title: true }), { Part: str('') });
        expect(changes).toEqual([{ field: 'Part', before: str(''), after: bool(true) }]);
    });
});

describe('classifyFieldRecovery — states what is actionable, not what caused it', () => {
    const change: JournalFieldChange = { field: 'Part', before: ABSENT, after: bool(true) };

    it('reports a target match without claiming the migration wrote it', () => {
        // The author could have typed the same thing. All this establishes is
        // that applying the write would now be a no-op.
        expect(classifyFieldRecovery(change, bool(true))).toBe('matches-target');
    });

    it('reports an origin match when the write has not landed', () => {
        expect(classifyFieldRecovery(change, ABSENT)).toBe('matches-origin');
    });

    it('reports divergence when the value matches neither endpoint', () => {
        expect(classifyFieldRecovery(change, str('The Crossing'))).toBe('diverged');
    });

    it('does not read an empty string as an absent key', () => {
        expect(classifyFieldRecovery(change, str(''))).toBe('diverged');
    });

    it('reports indeterminate when the recorded endpoints are identical', () => {
        // Degenerate by construction, but a hand-edited journal can contain one,
        // and no observation could tell the two endpoints apart.
        const degenerate: JournalFieldChange = { field: 'Part', before: bool(true), after: bool(true) };
        expect(classifyFieldRecovery(degenerate, bool(true))).toBe('indeterminate');
    });

    it('reports divergence when the current value cannot be compared', () => {
        expect(classifyFieldRecovery(change, { kind: 'unsupported', typeName: 'list' }))
            .toBe('diverged');
    });
});

describe('classifySceneRecovery', () => {
    const marker: JournalFieldChange = { field: 'Part', before: ABSENT, after: bool(true) };
    const epigraph: JournalFieldChange = {
        field: 'Part Epigraph', before: ABSENT, after: str('A quote.'),
    };
    const record = { path: 'p', changes: [marker, epigraph], skipped: [] };

    it('reports a fully applied scene', () => {
        expect(classifySceneRecovery(record, { Part: bool(true), 'Part Epigraph': str('A quote.') }))
            .toBe('matches-target');
    });

    it('reports an untouched scene', () => {
        expect(classifySceneRecovery(record, {})).toBe('matches-origin');
    });

    it('reports a half-written scene as partial', () => {
        expect(classifySceneRecovery(record, { Part: bool(true) })).toBe('partial');
    });

    it('lets divergence dominate every other verdict', () => {
        expect(classifySceneRecovery(record, {
            Part: bool(true), 'Part Epigraph': str('Author rewrote this'),
        })).toBe('diverged');
    });

    it('lets indeterminacy dominate a partial result', () => {
        const degenerate: JournalFieldChange = { field: 'Part', before: bool(true), after: bool(true) };
        expect(classifySceneRecovery(
            { path: 'p', changes: [degenerate, epigraph], skipped: [] },
            { Part: bool(true) }
        )).toBe('indeterminate');
    });

    it('treats a scene with no planned changes as nothing to do', () => {
        // Trustworthy only because a scene whose changes failed to parse is
        // rejected outright rather than arriving here looking empty.
        expect(classifySceneRecovery({ path: 'p', changes: [], skipped: [] }, {}))
            .toBe('matches-target');
    });
});

describe('getMigrationWrittenPaths', () => {
    const book = {
        bookId: 'book-1',
        status: 'planned' as const,
        planFingerprint: 'fp',
        preExistingMarkerPaths: ['Books/A/author.md'],
        scenes: [
            { path: 'Books/A/1.md', changes: [{ field: 'Part' as const, before: ABSENT, after: bool(true) }], skipped: [] },
            { path: 'Books/A/2.md', changes: [{ field: 'Part Epigraph' as const, before: ABSENT, after: str('q') }], skipped: [] },
            { path: 'Books/A/author.md', changes: [{ field: 'Part Epigraph' as const, before: ABSENT, after: str('q') }], skipped: [] },
        ],
    };

    it('claims markers the migration planned to write, confirmed or not', () => {
        expect(getMigrationWrittenPaths(journal({ books: [book] }), 'book-1'))
            .toEqual(new Set(['Books/A/1.md']));
    });

    it('never claims a marker that pre-existed the migration', () => {
        expect(getMigrationWrittenPaths(journal({ books: [book] }), 'book-1').has('Books/A/author.md'))
            .toBe(false);
    });

    it('ignores scenes where only epigraph fields changed', () => {
        expect(getMigrationWrittenPaths(journal({ books: [book] }), 'book-1').has('Books/A/2.md'))
            .toBe(false);
    });

    it('returns nothing for a book the journal has never seen', () => {
        expect(getMigrationWrittenPaths(journal({ books: [book] }), 'other')).toEqual(new Set());
    });
});

describe('parseJournal — fails closed at every level', () => {
    const goodBook = {
        bookId: 'book-1',
        status: 'planned' as const,
        planFingerprint: 'fp',
        preExistingMarkerPaths: ['Books/A/author.md'],
        scenes: [{
            path: 'Books/A/1.md',
            changes: [{ field: 'Part' as const, before: ABSENT, after: bool(true) }],
            skipped: [{ field: 'Part Epigraph' as const, reason: 'author-value-present' as const }],
        }],
    };

    it('round-trips through serialization', () => {
        const source = journal({ books: [goodBook] });
        expect(parseJournal(JSON.parse(serializeJournal(source)))).toEqual(source);
    });

    it('rejects a journal written by a different schema', () => {
        expect(parseJournal({ ...journal(), schema: 1 })).toBeNull();
    });

    it('rejects anything that is not an object', () => {
        expect(parseJournal(null)).toBeNull();
        expect(parseJournal('{}')).toBeNull();
        expect(parseJournal([])).toBeNull();
    });

    it('rejects the whole journal when a change record is malformed', () => {
        // Previously the bad change was dropped and the scene kept, leaving it
        // with zero changes — which reads as "nothing to do" and would report a
        // half-migrated book as complete.
        const broken = journal({
            books: [{
                ...goodBook,
                scenes: [{
                    path: 'Books/A/1.md',
                    changes: [{ field: 'Part', before: { kind: 'bogus' }, after: bool(true) }],
                    skipped: [],
                }],
            }],
        } as unknown as Partial<PartMigrationJournal>);

        expect(parseJournal(broken)).toBeNull();
    });

    it('rejects a change naming a field the migration does not own', () => {
        const broken = journal({
            books: [{
                ...goodBook,
                scenes: [{
                    path: 'Books/A/1.md',
                    changes: [{ field: 'Synopsis', before: ABSENT, after: str('not ours') }],
                    skipped: [],
                }],
            }],
        } as unknown as Partial<PartMigrationJournal>);

        expect(parseJournal(broken)).toBeNull();
    });

    it('rejects a malformed skip record', () => {
        const broken = journal({
            books: [{
                ...goodBook,
                scenes: [{
                    path: 'Books/A/1.md',
                    changes: [],
                    skipped: [{ field: 'Part', reason: 'because' }],
                }],
            }],
        } as unknown as Partial<PartMigrationJournal>);

        expect(parseJournal(broken)).toBeNull();
    });

    it('rejects the whole journal when any book record is malformed', () => {
        const broken = journal({
            books: [goodBook, { bookId: 'bad', status: 'nonsense' }],
        } as unknown as Partial<PartMigrationJournal>);

        expect(parseJournal(broken)).toBeNull();
    });

    it('preserves an unsupported snapshot through a round trip', () => {
        // The record of "we could not represent this" must itself survive, or a
        // resumed run would not know to keep its hands off the field.
        const source = journal({
            books: [{
                ...goodBook,
                scenes: [{
                    path: 'Books/A/1.md',
                    changes: [{
                        field: 'Part',
                        before: { kind: 'unsupported', typeName: 'list' },
                        after: bool(true),
                    }],
                    skipped: [],
                }],
            }],
        });

        expect(parseJournal(JSON.parse(serializeJournal(source)))).toEqual(source);
    });
});
