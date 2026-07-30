import { describe, expect, it } from 'vitest';
import type { BookMigrationPlan, PartMarkerWrite } from './partMarkers';
import {
    ABSENT,
    LIST_ABSENT,
    PART_MIGRATION_JOURNAL_SCHEMA,
    canRestore,
    changesForWrite,
    classifyCleanupGate,
    classifyFieldRecovery,
    classifySceneRecovery,
    cleanupNeedsApply,
    fingerprintPlan,
    getMigrationWrittenPaths,
    listSnapshotsEqual,
    needsWrite,
    parseJournal,
    serializeJournal,
    snapshotList,
    snapshotValue,
    snapshotsEqual,
    type JournalBookRecord,
    type JournalFieldChange,
    type JournalLayoutCleanupRecord,
    type JournalSnapshot,
    type PartMigrationJournal,
} from './partMarkersJournal';

const str = (value: string): JournalSnapshot => ({ kind: 'string', value });
const bool = (value: boolean): JournalSnapshot => ({ kind: 'boolean', value });
const unsupported: JournalSnapshot = { kind: 'unsupported', typeName: 'list' };

function write(overrides: Partial<PartMarkerWrite> = {}): PartMarkerWrite {
    return { path: 'Books/A/1.md', title: true, actNumber: 1, partNumber: 1, ...overrides };
}

function derivePlan(writes: PartMarkerWrite[]): BookMigrationPlan {
    return { bookId: 'book-1', status: 'derive', writes };
}

function change(overrides: Partial<JournalFieldChange> = {}): JournalFieldChange {
    return { field: 'Part', before: ABSENT, after: bool(true), applied: false, ...overrides };
}

function cleanup(overrides: Partial<JournalLayoutCleanupRecord> = {}): JournalLayoutCleanupRecord {
    return {
        layoutId: 'layout',
        before: { actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT },
        after: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        applied: false,
        accepted: false,
        ...overrides,
    };
}

function book(overrides: Partial<JournalBookRecord> = {}): JournalBookRecord {
    return {
        bookId: 'book-1',
        status: 'planned',
        planFingerprint: 'fp',
        preExistingMarkerPaths: [],
        scenes: [],
        epigraphCleanups: [],
        ...overrides,
    };
}

function journal(overrides: Partial<PartMigrationJournal> = {}): PartMigrationJournal {
    return {
        schema: PART_MIGRATION_JOURNAL_SCHEMA,
        startedAt: '2026-07-29T10:00:00.000Z',
        books: [],
        ...overrides,
    };
}

describe('snapshots', () => {
    it('separates an absent key from a key holding null', () => {
        expect(snapshotValue(undefined, false)).toEqual({ kind: 'absent' });
        expect(snapshotValue(null, true)).toEqual({ kind: 'null' });
        expect(snapshotsEqual(ABSENT, { kind: 'null' })).toBe(false);
    });

    it('preserves scalar types rather than flattening them', () => {
        expect(snapshotValue(1, true)).toEqual({ kind: 'number', value: 1 });
        expect(snapshotsEqual(bool(true), str('true'))).toBe(false);
    });

    it('marks lists and maps unsupported, and never calls two of them equal', () => {
        expect(snapshotValue(['a'], true)).toEqual({ kind: 'unsupported', typeName: 'list' });
        expect(snapshotsEqual(unsupported, unsupported)).toBe(false);
    });

    it('compares stored epigraph arrays element-wise', () => {
        expect(listSnapshotsEqual(snapshotList(['a', 'b']), snapshotList(['a', 'b']))).toBe(true);
        expect(listSnapshotsEqual(snapshotList(['a']), snapshotList(['a', 'b']))).toBe(false);
        expect(listSnapshotsEqual(snapshotList([]), LIST_ABSENT)).toBe(false);
    });
});

describe('fingerprintPlan', () => {
    it('is order-independent but sensitive to numbering and values', () => {
        const a = write({ path: 'Books/A/1.md' });
        const b = write({ path: 'Books/A/2.md', partNumber: 2, actNumber: 2 });
        expect(fingerprintPlan(derivePlan([a, b]))).toBe(fingerprintPlan(derivePlan([b, a])));
        expect(fingerprintPlan(derivePlan([write({ partNumber: 1 })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ partNumber: 2 })])));
        expect(fingerprintPlan(derivePlan([write({ quote: 'One.' })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ quote: 'Two.' })])));
    });

    it('distinguishes two blocked plans that differ in reason or scenes', () => {
        // A book blocked for one reason and later for another has genuinely
        // changed; a fingerprint of the status alone reported them identical.
        const reEntrant: BookMigrationPlan = {
            bookId: 'book-1', status: 'blocked', reason: 're-entrant-acts',
            scenes: [{ path: 'Books/A/3.md', detail: 'Re-opens Act 1.' }], detail: '',
        };
        const missing: BookMigrationPlan = {
            ...reEntrant, reason: 'act-missing',
        } as BookMigrationPlan;
        const otherScene: BookMigrationPlan = {
            ...reEntrant, scenes: [{ path: 'Books/A/9.md', detail: 'Re-opens Act 1.' }],
        } as BookMigrationPlan;

        expect(fingerprintPlan(reEntrant)).not.toBe(fingerprintPlan(missing));
        expect(fingerprintPlan(reEntrant)).not.toBe(fingerprintPlan(otherScene));
    });

    it('distinguishes author-owned plans by their markers and proposal', () => {
        const base: BookMigrationPlan = {
            bookId: 'book-1', status: 'author-owned',
            markerPaths: ['Books/A/1.md'], epigraphProposal: null,
        };
        const more: BookMigrationPlan = { ...base, markerPaths: ['Books/A/1.md', 'Books/A/2.md'] };
        expect(fingerprintPlan(base)).not.toBe(fingerprintPlan(more));
    });

    it('distinguishes noop reasons', () => {
        const noScenes: BookMigrationPlan = { bookId: 'b', status: 'noop', reason: 'no-scenes' };
        const noBoundaries: BookMigrationPlan = { bookId: 'b', status: 'noop', reason: 'no-boundaries' };
        expect(fingerprintPlan(noScenes)).not.toBe(fingerprintPlan(noBoundaries));
    });
});

describe('changesForWrite — adds structure, never removes author content', () => {
    it('writes the marker and both epigraph fields onto an untouched scene', () => {
        const { changes, skipped } = changesForWrite(
            write({ quote: 'A quote.', attribution: 'Camus' }), {}
        );

        expect(skipped).toEqual([]);
        expect(changes.map(entry => entry.field)).toEqual(['Part', 'Part Epigraph', 'Part Epigraph By']);
        expect(changes.every(entry => entry.applied === false)).toBe(true);
    });

    it('leaves an epigraph field alone when the migration has nothing for it', () => {
        const { changes, skipped } = changesForWrite(write(), {
            'Part Epigraph': str('Author wrote this'),
        });

        expect(changes.map(entry => entry.field)).toEqual(['Part']);
        expect(skipped).toEqual([]);
    });

    it('defers to author text rather than overwriting it', () => {
        const { changes, skipped } = changesForWrite(
            write({ quote: 'From layout options', attribution: 'Camus' }),
            { 'Part Epigraph': str('The author already wrote one') }
        );

        expect(changes.map(entry => entry.field)).toEqual(['Part', 'Part Epigraph By']);
        expect(skipped).toEqual([{ field: 'Part Epigraph', reason: 'author-value-present' }]);
    });

    it('writes nothing at all when the marker itself cannot be written', () => {
        // Epigraph fields decorate a Part opener. Writing them onto a scene with
        // no marker leaves orphan text attached to nothing, in a book the author
        // never agreed to change.
        const { changes, skipped } = changesForWrite(
            write({ quote: 'q', attribution: 'a' }),
            { Part: unsupported }
        );

        expect(changes).toEqual([]);
        expect(skipped).toEqual([
            { field: 'Part', reason: 'unsupported-value' },
            { field: 'Part Epigraph', reason: 'marker-not-written' },
            { field: 'Part Epigraph By', reason: 'marker-not-written' },
        ]);
    });

    it('does not invent skips for epigraph fields it had nothing to write to', () => {
        const { skipped } = changesForWrite(write(), { Part: unsupported });
        expect(skipped).toEqual([{ field: 'Part', reason: 'unsupported-value' }]);
    });

    it('overwrites a marker the author left blank, but not one already correct', () => {
        expect(changesForWrite(write(), { Part: str('') }).changes).toHaveLength(1);
        expect(changesForWrite(write(), { Part: bool(true) }).changes).toEqual([]);
    });
});

describe('recovery decisions consult the recorded attempt', () => {
    it('observes disk state without claiming authorship', () => {
        expect(classifyFieldRecovery(change(), bool(true))).toBe('matches-target');
        expect(classifyFieldRecovery(change(), ABSENT)).toBe('matches-origin');
        expect(classifyFieldRecovery(change(), str('The Crossing'))).toBe('diverged');
        expect(classifyFieldRecovery(change({ before: bool(true) }), bool(true))).toBe('indeterminate');
    });

    it('needs a write only when never attempted and still untouched', () => {
        expect(needsWrite(change({ applied: false }), ABSENT)).toBe(true);
        expect(needsWrite(change({ applied: true }), ABSENT)).toBe(false);
        expect(needsWrite(change({ applied: false }), str('edited'))).toBe(false);
    });

    it('refuses to restore a value the migration never wrote', () => {
        // The decisive case: disk matches the target, but no attempt was
        // recorded — the author typed it. Reverting would delete author content
        // while believing it was undoing our own work.
        expect(canRestore(change({ applied: false }), bool(true))).toBe(false);
        expect(canRestore(change({ applied: true }), bool(true))).toBe(true);
    });

    it('refuses to restore a field edited since the write landed', () => {
        expect(canRestore(change({ applied: true }), str('author edited'))).toBe(false);
    });
});

describe('classifySceneRecovery', () => {
    const marker = change();
    const epigraph = change({ field: 'Part Epigraph', after: str('A quote.') });
    const record = { path: 'p', changes: [marker, epigraph], skipped: [] };

    it('rolls fields up, with divergence dominating', () => {
        expect(classifySceneRecovery(record, { Part: bool(true), 'Part Epigraph': str('A quote.') }))
            .toBe('matches-target');
        expect(classifySceneRecovery(record, {})).toBe('matches-origin');
        expect(classifySceneRecovery(record, { Part: bool(true) })).toBe('partial');
        expect(classifySceneRecovery(record, {
            Part: bool(true), 'Part Epigraph': str('rewritten'),
        })).toBe('diverged');
    });

    it('treats a scene with no planned changes as nothing to do', () => {
        expect(classifySceneRecovery({ path: 'p', changes: [], skipped: [] }, {}))
            .toBe('matches-target');
    });
});

describe('cleanup gating', () => {
    it('refuses while any scene write is outstanding', () => {
        // Cleanup destroys the last copy of anything the scenes did not take.
        const target = book({
            scenes: [{ path: 'p', changes: [change({ applied: false })], skipped: [] }],
            epigraphCleanups: [cleanup({ accepted: true })],
        });
        expect(classifyCleanupGate(target)).toEqual({
            allowed: false, reason: 'scene-writes-outstanding',
        });
    });

    it('refuses while a skipped epigraph has not been accepted', () => {
        // The legacy storage is the only surviving copy of a skipped epigraph.
        const target = book({
            scenes: [{
                path: 'p',
                changes: [change({ applied: true })],
                skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
            }],
            epigraphCleanups: [cleanup({ accepted: false })],
        });
        expect(classifyCleanupGate(target)).toEqual({ allowed: false, reason: 'skips-unaccepted' });
    });

    it('allows once writes have landed and skips are accepted', () => {
        const target = book({
            scenes: [{
                path: 'p',
                changes: [change({ applied: true })],
                skipped: [{ field: 'Part Epigraph', reason: 'unsupported-value' }],
            }],
            epigraphCleanups: [cleanup({ accepted: true })],
        });
        expect(classifyCleanupGate(target)).toEqual({ allowed: true });
    });

    it('allows a book with no skips and no outstanding writes', () => {
        expect(classifyCleanupGate(book({
            scenes: [{ path: 'p', changes: [change({ applied: true })], skipped: [] }],
            epigraphCleanups: [cleanup()],
        }))).toEqual({ allowed: true });
    });
});

describe('cleanupNeedsApply', () => {
    it('applies when storage still holds the recorded before-state', () => {
        expect(cleanupNeedsApply(cleanup(), {
            actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT,
        })).toBe(true);
    });

    it('does not re-apply a cleanup already recorded as done', () => {
        expect(cleanupNeedsApply(cleanup({ applied: true }), {
            actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT,
        })).toBe(false);
    });

    it('does not apply when the storage changed underneath', () => {
        expect(cleanupNeedsApply(cleanup(), {
            actEpigraphs: snapshotList(['Something else.']), actEpigraphAttributions: LIST_ABSENT,
        })).toBe(false);
    });
});

describe('getMigrationWrittenPaths', () => {
    const target = book({
        preExistingMarkerPaths: ['Books/A/author.md'],
        scenes: [
            { path: 'Books/A/1.md', changes: [change()], skipped: [] },
            { path: 'Books/A/2.md', changes: [change({ field: 'Part Epigraph', after: str('q') })], skipped: [] },
            { path: 'Books/A/author.md', changes: [change()], skipped: [] },
        ],
    });

    it('claims planned markers, confirmed or not, but never a pre-existing one', () => {
        expect(getMigrationWrittenPaths(journal({ books: [target] }), 'book-1'))
            .toEqual(new Set(['Books/A/1.md']));
    });

    it('returns nothing for a book the journal has never seen', () => {
        expect(getMigrationWrittenPaths(journal({ books: [target] }), 'other')).toEqual(new Set());
    });
});

describe('parseJournal — fails closed at every level', () => {
    const goodBook = book({
        preExistingMarkerPaths: ['Books/A/author.md'],
        scenes: [{
            path: 'Books/A/1.md',
            changes: [change({ applied: true })],
            skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
        }],
        epigraphCleanups: [cleanup({ accepted: true, applied: true })],
    });

    it('round-trips through serialization', () => {
        const source = journal({ books: [goodBook] });
        expect(parseJournal(JSON.parse(serializeJournal(source)))).toEqual(source);
    });

    it('rejects a journal written by a different schema', () => {
        expect(parseJournal({ ...journal(), schema: 2 })).toBeNull();
    });

    it('rejects anything that is not an object', () => {
        expect(parseJournal(null)).toBeNull();
        expect(parseJournal([])).toBeNull();
    });

    it('rejects a record whose required arrays are missing', () => {
        // A record missing `changes` is not an empty plan, it is an unreadable
        // one, and treating the two alike lets a truncated journal report a
        // half-migrated book as complete.
        const noChanges = { ...goodBook, scenes: [{ path: 'p', skipped: [] }] };
        const noScenes = { bookId: 'b', status: 'planned', planFingerprint: 'fp', preExistingMarkerPaths: [], epigraphCleanups: [] };
        const noCleanups = { ...goodBook, epigraphCleanups: undefined };

        expect(parseJournal(journal({ books: [noChanges] } as never))).toBeNull();
        expect(parseJournal(journal({ books: [noScenes] } as never))).toBeNull();
        expect(parseJournal(journal({ books: [noCleanups] } as never))).toBeNull();
    });

    it('rejects a change with no recorded attempt state', () => {
        const missingApplied = {
            ...goodBook,
            scenes: [{
                path: 'p',
                changes: [{ field: 'Part', before: ABSENT, after: bool(true) }],
                skipped: [],
            }],
        };
        expect(parseJournal(journal({ books: [missingApplied] } as never))).toBeNull();
    });

    it('rejects a malformed change, skip, or cleanup record', () => {
        const badChange = {
            ...goodBook,
            scenes: [{ path: 'p', changes: [{ field: 'Synopsis', before: ABSENT, after: bool(true), applied: false }], skipped: [] }],
        };
        const badSkip = {
            ...goodBook,
            scenes: [{ path: 'p', changes: [], skipped: [{ field: 'Part', reason: 'because' }] }],
        };
        const badCleanup = { ...goodBook, epigraphCleanups: [{ layoutId: 'l', applied: false }] };

        expect(parseJournal(journal({ books: [badChange] } as never))).toBeNull();
        expect(parseJournal(journal({ books: [badSkip] } as never))).toBeNull();
        expect(parseJournal(journal({ books: [badCleanup] } as never))).toBeNull();
    });

    it('preserves an unsupported snapshot through a round trip', () => {
        const source = journal({
            books: [book({
                scenes: [{
                    path: 'p',
                    changes: [change({ before: unsupported, applied: false })],
                    skipped: [],
                }],
            })],
        });
        expect(parseJournal(JSON.parse(serializeJournal(source)))).toEqual(source);
    });
});
