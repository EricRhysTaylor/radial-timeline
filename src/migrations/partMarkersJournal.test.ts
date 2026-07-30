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
    requiresRecoveryChoice,
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
    return { field: 'Part', before: ABSENT, after: bool(true), state: 'planned', ...overrides };
}

function cleanup(overrides: Partial<JournalLayoutCleanupRecord> = {}): JournalLayoutCleanupRecord {
    return {
        layoutId: 'layout',
        before: { actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT },
        after: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        state: 'planned',
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
    it('is stable and independent of the order writes arrive in', () => {
        const a = write({ path: 'Books/A/1.md' });
        const b = write({ path: 'Books/A/2.md', partNumber: 2, actNumber: 2 });
        expect(fingerprintPlan(derivePlan([a, b]))).toBe(fingerprintPlan(derivePlan([b, a])));
    });

    it('changes when the structural numbering changes', () => {
        expect(fingerprintPlan(derivePlan([write({ partNumber: 1 })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ partNumber: 2 })])));
    });

    it('changes when the act a boundary opens changes', () => {
        expect(fingerprintPlan(derivePlan([write({ actNumber: 1 })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ actNumber: 2 })])));
    });

    it('changes when a target path changes', () => {
        expect(fingerprintPlan(derivePlan([write()])))
            .not.toBe(fingerprintPlan(derivePlan([write({ path: 'Books/A/9.md' })])));
    });

    it('changes when epigraph text changes', () => {
        expect(fingerprintPlan(derivePlan([write({ quote: 'One.' })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ quote: 'Two.' })])));
        expect(fingerprintPlan(derivePlan([write({ attribution: 'A' })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ attribution: 'B' })])));
    });

    it('distinguishes an untitled marker from one titled "true"', () => {
        expect(fingerprintPlan(derivePlan([write({ title: true })])))
            .not.toBe(fingerprintPlan(derivePlan([write({ title: 'true' })])));
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
        expect(changes.every(entry => entry.state === 'planned')).toBe(true);
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

    it('does not overwrite a non-string value the author put in an epigraph field', () => {
        // Malformed for its purpose, but still something someone typed.
        // Replacing it silently destroys it as surely as overwriting a sentence.
        for (const authored of [{ kind: 'number', value: 1 } as const, bool(false)]) {
            const { changes, skipped } = changesForWrite(
                write({ quote: 'From layout options' }),
                { 'Part Epigraph': authored }
            );
            expect(changes.map(entry => entry.field)).toEqual(['Part']);
            expect(skipped).toEqual([{ field: 'Part Epigraph', reason: 'author-value-present' }]);
        }
    });

    it('still fills an epigraph field holding null or blank text', () => {
        expect(changesForWrite(write({ quote: 'q' }), { 'Part Epigraph': { kind: 'null' } })
            .changes.map(entry => entry.field)).toEqual(['Part', 'Part Epigraph']);
        expect(changesForWrite(write({ quote: 'q' }), { 'Part Epigraph': str('  ') })
            .changes.map(entry => entry.field)).toEqual(['Part', 'Part Epigraph']);
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

    it('writes only what was planned and is still untouched', () => {
        expect(needsWrite(change({ state: 'planned' }), ABSENT)).toBe(true);
        expect(needsWrite(change({ state: 'confirmed' }), ABSENT)).toBe(false);
        expect(needsWrite(change({ state: 'planned' }), str('edited'))).toBe(false);
    });

    it('never re-applies an interrupted attempt', () => {
        // The crash window is the dangerous case: the author may have seen the
        // write land and reverted it. A boolean flag could not tell that apart
        // from "never written", so re-applying would overwrite a deliberate
        // revert. `attempting` refuses to guess.
        expect(needsWrite(change({ state: 'attempting' }), ABSENT)).toBe(false);
        expect(requiresRecoveryChoice(change({ state: 'attempting' }))).toBe(true);
        expect(requiresRecoveryChoice(change({ state: 'planned' }))).toBe(false);
        expect(requiresRecoveryChoice(change({ state: 'confirmed' }))).toBe(false);
    });

    it('refuses to restore a value the migration never confirmed writing', () => {
        // Disk matches the target, but no confirmed attempt — the author typed
        // it. Reverting would delete author content while believing it was
        // undoing our own work.
        expect(canRestore(change({ state: 'planned' }), bool(true))).toBe(false);
        expect(canRestore(change({ state: 'attempting' }), bool(true))).toBe(false);
        expect(canRestore(change({ state: 'confirmed' }), bool(true))).toBe(true);
    });

    it('refuses to restore a field edited since the write landed', () => {
        expect(canRestore(change({ state: 'confirmed' }), str('author edited'))).toBe(false);
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

describe('cleanup gating — verifies the vault now, not what the journal remembers', () => {
    const confirmed = change({ state: 'confirmed' });
    const onDisk = new Map([['p', { Part: bool(true) }]]);

    it('refuses while any scene write is not confirmed', () => {
        const target = book({
            scenes: [{ path: 'p', changes: [change({ state: 'planned' })], skipped: [] }],
            epigraphCleanups: [cleanup({ accepted: true })],
        });
        expect(classifyCleanupGate(target, onDisk)).toEqual({
            allowed: false, reason: 'scene-writes-outstanding', paths: ['p'],
        });
    });

    it('refuses while an attempt is unresolved', () => {
        const target = book({
            scenes: [{ path: 'p', changes: [change({ state: 'attempting' })], skipped: [] }],
            epigraphCleanups: [cleanup({ accepted: true })],
        });
        expect(classifyCleanupGate(target, onDisk).allowed).toBe(false);
    });

    it('refuses when a scene could not be re-read', () => {
        // Unknown is not the same as verified.
        const target = book({
            scenes: [{ path: 'p', changes: [confirmed], skipped: [] }],
            epigraphCleanups: [cleanup({ accepted: true })],
        });
        expect(classifyCleanupGate(target, new Map())).toEqual({
            allowed: false, reason: 'scene-state-unknown', paths: ['p'],
        });
    });

    it('refuses when a confirmed value is no longer on the scene', () => {
        // The decisive case: confirmation is a historical fact, and the author
        // can revert a migrated value afterwards. Clearing the legacy source on
        // a stale flag would erase the only remaining copy.
        const target = book({
            scenes: [{ path: 'p', changes: [confirmed], skipped: [] }],
            epigraphCleanups: [cleanup({ accepted: true })],
        });
        expect(classifyCleanupGate(target, new Map([['p', {}]]))).toEqual({
            allowed: false, reason: 'scene-value-reverted', paths: ['p'],
        });
    });

    it('refuses while a skipped epigraph has not been accepted', () => {
        const target = book({
            scenes: [{
                path: 'p',
                changes: [confirmed],
                skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
            }],
            epigraphCleanups: [cleanup({ accepted: false })],
        });
        expect(classifyCleanupGate(target, onDisk)).toEqual({
            allowed: false, reason: 'skips-unaccepted',
        });
    });

    it('allows once every write is confirmed, still present, and skips accepted', () => {
        const target = book({
            scenes: [{
                path: 'p',
                changes: [confirmed],
                skipped: [{ field: 'Part Epigraph', reason: 'unsupported-value' }],
            }],
            epigraphCleanups: [cleanup({ accepted: true })],
        });
        expect(classifyCleanupGate(target, onDisk)).toEqual({ allowed: true });
    });

    it('does not demand snapshots for scenes with nothing planned', () => {
        const target = book({
            scenes: [{ path: 'untouched', changes: [], skipped: [] }],
            epigraphCleanups: [cleanup()],
        });
        expect(classifyCleanupGate(target, new Map())).toEqual({ allowed: true });
    });
});

describe('cleanupNeedsApply', () => {
    it('applies when storage still holds the recorded before-state', () => {
        expect(cleanupNeedsApply(cleanup(), {
            actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT,
        })).toBe(true);
    });

    it('does not re-apply a cleanup already recorded as done', () => {
        expect(cleanupNeedsApply(cleanup({ state: 'confirmed' }), {
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
            changes: [change({ state: 'confirmed' })],
            skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
        }],
        epigraphCleanups: [cleanup({ accepted: true, state: 'confirmed' })],
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
        const badState = {
            ...goodBook,
            scenes: [{
                path: 'p',
                changes: [{ field: 'Part', before: ABSENT, after: bool(true), state: 'done' }],
                skipped: [],
            }],
        };
        expect(parseJournal(journal({ books: [missingApplied] } as never))).toBeNull();
        expect(parseJournal(journal({ books: [badState] } as never))).toBeNull();
    });

    it('rejects a malformed change, skip, or cleanup record', () => {
        const badChange = {
            ...goodBook,
            scenes: [{ path: 'p', changes: [{ field: 'Synopsis', before: ABSENT, after: bool(true), state: 'planned' }], skipped: [] }],
        };
        const badSkip = {
            ...goodBook,
            scenes: [{ path: 'p', changes: [], skipped: [{ field: 'Part', reason: 'because' }] }],
        };
        const badCleanup = { ...goodBook, epigraphCleanups: [{ layoutId: 'l', state: 'planned' }] };

        expect(parseJournal(journal({ books: [badChange] } as never))).toBeNull();
        expect(parseJournal(journal({ books: [badSkip] } as never))).toBeNull();
        expect(parseJournal(journal({ books: [badCleanup] } as never))).toBeNull();
    });

    it('preserves an unsupported snapshot through a round trip', () => {
        const source = journal({
            books: [book({
                scenes: [{
                    path: 'p',
                    changes: [change({ before: unsupported, state: 'planned' })],
                    skipped: [],
                }],
            })],
        });
        expect(parseJournal(JSON.parse(serializeJournal(source)))).toEqual(source);
    });
});
