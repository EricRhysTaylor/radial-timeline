import { describe, expect, it } from 'vitest';
import type { BookMigrationPlan } from './partMarkers';
import type { JournalBookRecord, JournalFieldChange, JournalSnapshot } from './partMarkersJournal';
import { LIST_ABSENT, snapshotList } from './partMarkersJournal';
import {
    buildManifest,
    findManifestJournalMismatch,
    fingerprintManifest,
} from './partMarkersManifest';

const PATH = 'Books/A/1.md';
const bool = (value: boolean): JournalSnapshot => ({ kind: 'boolean', value });
const str = (value: string): JournalSnapshot => ({ kind: 'string', value });
const ABSENT_SNAP: JournalSnapshot = { kind: 'absent' };

function derivePlan(overrides: Partial<Extract<BookMigrationPlan, { status: 'derive' }>> = {}) {
    return {
        bookId: 'book-1',
        status: 'derive' as const,
        epigraphSourceLayoutIds: [],
        writes: [{ path: PATH, title: true as const, actNumber: 1, partNumber: 1 }],
        ...overrides,
    };
}

function change(overrides: Partial<JournalFieldChange> = {}): JournalFieldChange {
    return { field: 'Part', before: ABSENT_SNAP, after: bool(true), state: 'planned', ...overrides };
}

function bookRecord(overrides: Partial<JournalBookRecord> = {}): JournalBookRecord {
    return {
        bookId: 'book-1',
        status: 'planned',
        planFingerprint: 'fp',
        preExistingMarkerPaths: [],
        scenes: [{ path: PATH, changes: [change()], skipped: [] }],
        epigraphCleanups: [],
        ...overrides,
    };
}

function cleanupFor(layoutId: string) {
    return {
        layoutId,
        before: { actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT },
        after: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        state: 'planned' as const,
        accepted: true,
    };
}

describe('buildManifest', () => {
    it('enumerates every field a derive plan writes', () => {
        const manifest = buildManifest(derivePlan({
            writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'q', attribution: 'a' }],
        }));

        expect(manifest?.scenes[0].fields.map(field => field.field))
            .toEqual(['Part', 'Part Epigraph', 'Part Epigraph By']);
    });

    it('carries every source layout as a cleanup target, including identical copies', () => {
        // Each is a distinct storage location; leaving one behind resurrects
        // epigraphs the author believes were migrated.
        const manifest = buildManifest(derivePlan({ epigraphSourceLayoutIds: ['b', 'a'] }));
        expect(manifest?.cleanupLayoutIds).toEqual(['a', 'b']);
    });

    it('treats blocked and noop plans as having no migration at all', () => {
        expect(buildManifest({
            bookId: 'b', status: 'blocked', reason: 're-entrant-acts', scenes: [], detail: '',
        })).toBeNull();
        expect(buildManifest({ bookId: 'b', status: 'noop', reason: 'no-scenes' })).toBeNull();
    });

    describe('author-owned books', () => {
        const plan: BookMigrationPlan = {
            bookId: 'book-1',
            status: 'author-owned',
            markerPaths: [PATH],
            epigraphProposal: null,
            epigraphSourceLayoutIds: ['layout'],
        };

        it('has nothing to execute until the author accepts a placement', () => {
            // Clearing storage before acceptance would destroy the only copy.
            const manifest = buildManifest(plan);
            expect(manifest?.scenes).toEqual([]);
            expect(manifest?.cleanupLayoutIds).toEqual([]);
        });

        it('writes exactly what the author accepted, and then permits cleanup', () => {
            // Previously these legitimate writes were rejected outright as
            // "a non-derive plan that writes nothing".
            const manifest = buildManifest(plan, {
                acceptedEpigraphs: [{ path: PATH, quote: 'A quote.', attribution: 'Camus' }],
            });

            expect(manifest?.scenes).toEqual([{
                path: PATH,
                fields: [
                    { field: 'Part Epigraph', after: str('A quote.') },
                    { field: 'Part Epigraph By', after: str('Camus') },
                ],
            }]);
            expect(manifest?.cleanupLayoutIds).toEqual(['layout']);
        });
    });
});

describe('fingerprintManifest', () => {
    it('is order-independent', () => {
        const a = { path: 'Books/A/1.md', title: true as const, actNumber: 1, partNumber: 1 };
        const b = { path: 'Books/A/2.md', title: true as const, actNumber: 2, partNumber: 2 };
        expect(fingerprintManifest(buildManifest(derivePlan({ writes: [a, b] }))!))
            .toBe(fingerprintManifest(buildManifest(derivePlan({ writes: [b, a] }))!));
    });

    it('still changes with the structural numbering', () => {
        // The manifest replaced the plan fingerprint, so it has to keep this
        // sensitivity: resuming across a renumbering would renumber the book.
        expect(fingerprintManifest(buildManifest(derivePlan())!))
            .not.toBe(fingerprintManifest(buildManifest(derivePlan({
                writes: [{ path: PATH, title: true, actNumber: 2, partNumber: 2 }],
            }))!));
    });

    it('changes with the cleanup targets', () => {
        expect(fingerprintManifest(buildManifest(derivePlan())!))
            .not.toBe(fingerprintManifest(buildManifest(derivePlan({
                epigraphSourceLayoutIds: ['layout'],
            }))!));
    });
});

describe('findManifestJournalMismatch', () => {
    const manifest = buildManifest(derivePlan({
        writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'A quote.' }],
        epigraphSourceLayoutIds: ['layout'],
    }))!;

    const complete = bookRecord({
        scenes: [{
            path: PATH,
            changes: [change(), change({ field: 'Part Epigraph', after: str('A quote.') })],
            skipped: [],
        }],
        epigraphCleanups: [cleanupFor('layout')],
    });

    it('accepts a journal that accounts for every planned field', () => {
        expect(findManifestJournalMismatch(complete, manifest)).toBeNull();
    });

    it('accepts a skip in place of a change', () => {
        const withSkip = bookRecord({
            scenes: [{
                path: PATH,
                changes: [change()],
                skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
            }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(withSkip, manifest)).toBeNull();
    });

    it('rejects a planned field that simply vanished from the journal', () => {
        // The silent-disappearance case: the book looked consistent, cleanup
        // then cleared the legacy copy, and the epigraph existed nowhere.
        const missingField = bookRecord({
            scenes: [{ path: PATH, changes: [change()], skipped: [] }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(missingField, manifest))
            .toMatch(/neither a change nor a skip/);
    });

    it('rejects a record with no changes at all when fields were planned', () => {
        const empty = bookRecord({
            scenes: [{ path: PATH, changes: [], skipped: [] }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(empty, manifest)).toMatch(/neither a change nor a skip/);
    });

    it('rejects a field recorded as both written and skipped', () => {
        const both = bookRecord({
            scenes: [{
                path: PATH,
                changes: [change(), change({ field: 'Part Epigraph', after: str('A quote.') })],
                skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
            }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(both, manifest)).toMatch(/both written and skipped/);
    });

    it('rejects duplicate scene records and duplicate field changes', () => {
        const dupePath = bookRecord({
            scenes: [
                { path: PATH, changes: [change()], skipped: [] },
                { path: PATH, changes: [change()], skipped: [] },
            ],
        });
        expect(findManifestJournalMismatch(dupePath, manifest))
            .toMatch(/more than one record/);

        const dupeField = bookRecord({
            scenes: [{ path: PATH, changes: [change(), change()], skipped: [] }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(dupeField, manifest))
            .toMatch(/more than one change/);
    });

    it('rejects a missing cleanup record, which would strand a storage location', () => {
        const noCleanup = bookRecord({
            scenes: complete.scenes,
            epigraphCleanups: [],
        });
        expect(findManifestJournalMismatch(noCleanup, manifest))
            .toMatch(/no cleanup record/);
    });

    it('rejects cleanup records the plan does not call for', () => {
        const strayCleanup = bookRecord({
            scenes: complete.scenes,
            epigraphCleanups: [cleanupFor('layout'), cleanupFor('unexpected')],
        });
        expect(findManifestJournalMismatch(strayCleanup, manifest))
            .toMatch(/does not call for/);
    });

    it('rejects duplicate cleanup records for one layout', () => {
        const dupe = bookRecord({
            scenes: complete.scenes,
            epigraphCleanups: [cleanupFor('layout'), cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(dupe, manifest))
            .toMatch(/more than one cleanup record/);
    });
});
