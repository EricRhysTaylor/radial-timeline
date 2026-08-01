import { describe, expect, it } from 'vitest';
import type { BookMigrationPlan } from './partMarkers';
import type { JournalBookRecord, JournalFieldChange, JournalSnapshot } from './partMarkersJournal';
import { LIST_ABSENT, snapshotList } from './partMarkersJournal';
import {
    buildManifest,
    findManifestJournalMismatch,
    fingerprintManifest,
    isManifest,
    type BuildManifestOptions,
    type ExecutableManifest,
} from './partMarkersManifest';

const PATH = 'Books/A/1.md';
const OTHER = 'Books/A/2.md';
const bool = (value: boolean): JournalSnapshot => ({ kind: 'boolean', value });
const str = (value: string): JournalSnapshot => ({ kind: 'string', value });
const ABSENT_SNAP: JournalSnapshot = { kind: 'absent' };

function derivePlan(
    overrides: Partial<Extract<BookMigrationPlan, { status: 'derive' }>> = {}
): BookMigrationPlan {
    return {
        bookId: 'book-1',
        status: 'derive',
        epigraphSources: [],
        writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1 }],
        ...overrides,
    };
}

function manifestOf(plan: BookMigrationPlan, options: BuildManifestOptions = {}): ExecutableManifest {
    const resolved = buildManifest(plan, options);
    if (!isManifest(resolved)) throw new Error(`expected a manifest, got: ${resolved.detail}`);
    return resolved;
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

function cleanupFor(layoutId: string, quotes: string[] = ['A quote.']) {
    return {
        layoutId,
        before: { actEpigraphs: snapshotList(quotes), actEpigraphAttributions: LIST_ABSENT },
        after: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        state: 'planned' as const,
        accepted: true,
    };
}

describe('buildManifest', () => {
    it('enumerates every field a derive plan writes', () => {
        const manifest = manifestOf(derivePlan({
            writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'q', attribution: 'a' }],
        }));
        expect(manifest.scenes[0].fields.map(field => field.field))
            .toEqual(['Part', 'Part Epigraph', 'Part Epigraph By']);
    });

    it('carries exact before and after values for every cleanup target', () => {
        // Naming only the layout left the journal free to carry arbitrary
        // snapshots, which the executor would apply and verify.
        const manifest = manifestOf(derivePlan({
            writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'One.' }],
            epigraphSources: [{ layoutId: 'b', quotes: ['One.'], attributions: [] }],
        }));

        expect(manifest.cleanups).toEqual([{
            layoutId: 'b',
            before: { actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT },
            after: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        }]);
    });

    it('refuses cleanup while a populated slot was never migrated', () => {
        // An epigraph for an act the book no longer has would be destroyed by a
        // cleanup approved for other reasons.
        const manifest = manifestOf(derivePlan({
            writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'One.' }],
            epigraphSources: [{ layoutId: 'l', quotes: ['One.', 'Stranded.'], attributions: [] }],
        }));
        expect(manifest.cleanups).toEqual([]);
    });

    it('authorizes cleanup once a stranded slot is explicitly discarded', () => {
        const manifest = manifestOf(
            derivePlan({
                writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'One.' }],
                epigraphSources: [{ layoutId: 'l', quotes: ['One.', 'Stranded.'], attributions: [] }],
            }),
            { discardedActNumbers: [2] }
        );
        expect(manifest.cleanups.map(target => target.layoutId)).toEqual(['l']);
    });

    it('refuses blocked and noop plans with a reason', () => {
        const blocked = buildManifest({
            bookId: 'b', status: 'blocked', reason: 're-entrant-acts', scenes: [], detail: '',
        });
        expect(isManifest(blocked)).toBe(false);
        expect(isManifest(buildManifest({ bookId: 'b', status: 'noop', reason: 'no-scenes' }))).toBe(false);
    });

    describe('author-owned acceptance', () => {
        const plan: BookMigrationPlan = {
            bookId: 'book-1',
            status: 'author-owned',
            markerPaths: [PATH, OTHER],
            epigraphProposal: {
                layoutId: 'layout',
                entries: [
                    { actNumber: 1, quote: 'One.' },
                    { actNumber: 2, quote: 'Two.' },
                ],
            },
            epigraphSources: [{ layoutId: 'layout', quotes: ['One.', 'Two.'], attributions: [] }],
        };

        it('refuses when only some proposals are answered', () => {
            // Partial acceptance previously enabled cleanup of every source,
            // deleting the unmapped remainder.
            const resolved = buildManifest(plan, {
                acceptedEpigraphs: [{ actNumber: 1, path: PATH, quote: 'One.' }],
            });
            expect(isManifest(resolved)).toBe(false);
            if (isManifest(resolved)) return;
            expect(resolved.detail).toMatch(/have not been accepted or discarded/);
        });

        it('refuses a placement onto a scene with no marker', () => {
            const resolved = buildManifest(plan, {
                acceptedEpigraphs: [
                    { actNumber: 1, path: 'Books/A/no-marker.md', quote: 'One.' },
                    { actNumber: 2, path: OTHER, quote: 'Two.' },
                ],
            });
            expect(isManifest(resolved)).toBe(false);
            if (isManifest(resolved)) return;
            expect(resolved.detail).toMatch(/carries no Part marker/);
        });

        it('refuses an accepted entry carrying no text', () => {
            // One empty entry produced no fields yet still enabled cleanup.
            const resolved = buildManifest(plan, {
                acceptedEpigraphs: [
                    { actNumber: 1, path: PATH },
                    { actNumber: 2, path: OTHER, quote: 'Two.' },
                ],
            });
            expect(isManifest(resolved)).toBe(false);
            if (isManifest(resolved)) return;
            expect(resolved.detail).toMatch(/carries no text/);
        });

        it('refuses an act both accepted and discarded, or accepted twice', () => {
            const conflicting = buildManifest(plan, {
                acceptedEpigraphs: [{ actNumber: 1, path: PATH, quote: 'One.' }],
                discardedActNumbers: [1, 2],
            });
            expect(isManifest(conflicting)).toBe(false);

            const twice = buildManifest(plan, {
                acceptedEpigraphs: [
                    { actNumber: 1, path: PATH, quote: 'One.' },
                    { actNumber: 1, path: OTHER, quote: 'One.' },
                ],
                discardedActNumbers: [2],
            });
            expect(isManifest(twice)).toBe(false);
        });

        it('refuses two epigraphs aimed at one scene', () => {
            const resolved = buildManifest(plan, {
                acceptedEpigraphs: [
                    { actNumber: 1, path: PATH, quote: 'One.' },
                    { actNumber: 2, path: PATH, quote: 'Two.' },
                ],
            });
            expect(isManifest(resolved)).toBe(false);
            if (isManifest(resolved)) return;
            expect(resolved.detail).toMatch(/a scene opens one part/);
        });

        it('authorizes writes and cleanup once every proposal is answered', () => {
            const manifest = manifestOf(plan, {
                acceptedEpigraphs: [{ actNumber: 1, path: PATH, quote: 'One.' }],
                discardedActNumbers: [2],
            });

            expect(manifest.scenes).toEqual([{
                path: PATH,
                fields: [{
                    field: 'Part Epigraph',
                    after: str('One.'),
                    allowedSkips: ['author-value-present', 'unsupported-value', 'marker-not-written'],
                }],
            }]);
            expect(manifest.cleanups.map(target => target.layoutId)).toEqual(['layout']);
        });

        it('authorizes nothing when there was no proposal at all', () => {
            const manifest = manifestOf({ ...plan, epigraphProposal: null });
            expect(manifest.scenes).toEqual([]);
            expect(manifest.cleanups).toEqual([]);
        });
    });
});

describe('fingerprintManifest', () => {
    it('is order-independent', () => {
        const a = { path: PATH, title: true as const, actNumber: 1, partNumber: 1 };
        const b = { path: OTHER, title: true as const, actNumber: 2, partNumber: 2 };
        expect(fingerprintManifest(manifestOf(derivePlan({ writes: [a, b] }))))
            .toBe(fingerprintManifest(manifestOf(derivePlan({ writes: [b, a] }))));
    });

    it('still changes with the structural numbering', () => {
        expect(fingerprintManifest(manifestOf(derivePlan())))
            .not.toBe(fingerprintManifest(manifestOf(derivePlan({
                writes: [{ path: PATH, title: true, actNumber: 2, partNumber: 2 }],
            }))));
    });

    it('changes with the cleanup values, not just the layout', () => {
        const base = derivePlan({
            writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'One.' }],
            epigraphSources: [{ layoutId: 'l', quotes: ['One.'], attributions: [] }],
        });
        const differentStored = derivePlan({
            writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'One.' }],
            epigraphSources: [{ layoutId: 'l', quotes: ['One.'], attributions: ['Camus'] }],
        });
        expect(fingerprintManifest(manifestOf(base)))
            .not.toBe(fingerprintManifest(manifestOf(differentStored)));
    });
});

describe('findManifestJournalMismatch', () => {
    const manifest = manifestOf(derivePlan({
        writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1, quote: 'A quote.' }],
        epigraphSources: [{ layoutId: 'layout', quotes: ['A quote.'], attributions: [] }],
    }));

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

    it('accepts a permitted skip in place of a change', () => {
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

    it('rejects a marker skipped as author-value-present', () => {
        // The marker is the migration's own structure, so "the author already
        // wrote something" is not a reason to leave it. Accepting this let a
        // markerless book satisfy validation and stamp applied.
        const markerSkipped = bookRecord({
            scenes: [{
                path: PATH,
                changes: [change({ field: 'Part Epigraph', after: str('A quote.') })],
                skipped: [{ field: 'Part', reason: 'author-value-present' }],
            }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(markerSkipped, manifest))
            .toMatch(/not a reason that field may be skipped for/);
    });

    it('accepts a marker skipped for an unsupported value', () => {
        const markerSkipped = bookRecord({
            scenes: [{
                path: PATH,
                changes: [change({ field: 'Part Epigraph', after: str('A quote.') })],
                skipped: [{ field: 'Part', reason: 'unsupported-value' }],
            }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(markerSkipped, manifest)).toBeNull();
    });

    it('rejects a planned field that vanished from the journal', () => {
        const missingField = bookRecord({
            scenes: [{ path: PATH, changes: [change()], skipped: [] }],
            epigraphCleanups: [cleanupFor('layout')],
        });
        expect(findManifestJournalMismatch(missingField, manifest))
            .toMatch(/neither a change nor a skip/);
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
        expect(findManifestJournalMismatch(bookRecord({
            scenes: [
                { path: PATH, changes: [change()], skipped: [] },
                { path: PATH, changes: [change()], skipped: [] },
            ],
        }), manifest)).toMatch(/more than one record/);

        expect(findManifestJournalMismatch(bookRecord({
            scenes: [{ path: PATH, changes: [change(), change()], skipped: [] }],
            epigraphCleanups: [cleanupFor('layout')],
        }), manifest)).toMatch(/more than one change/);
    });

    it('rejects a cleanup record whose recorded prior storage is not the plan’s', () => {
        // The executor verifies against whatever the record carries, so a wrong
        // before-value would authorize clearing storage it never inspected.
        const wrongBefore = bookRecord({
            scenes: complete.scenes,
            epigraphCleanups: [cleanupFor('layout', ['Something else entirely.'])],
        });
        expect(findManifestJournalMismatch(wrongBefore, manifest))
            .toMatch(/recorded prior storage is not what the plan resolved/);
    });

    it('rejects a cleanup record that would leave storage in an unplanned state', () => {
        const wrongAfter = bookRecord({
            scenes: complete.scenes,
            epigraphCleanups: [{
                ...cleanupFor('layout'),
                after: { actEpigraphs: snapshotList(['left behind']), actEpigraphAttributions: LIST_ABSENT },
            }],
        });
        expect(findManifestJournalMismatch(wrongAfter, manifest))
            .toMatch(/leave storage in a state the plan does not call for/);
    });

    it('rejects missing, stray, and duplicate cleanup records', () => {
        expect(findManifestJournalMismatch(
            bookRecord({ scenes: complete.scenes, epigraphCleanups: [] }), manifest
        )).toMatch(/no cleanup record/);

        expect(findManifestJournalMismatch(bookRecord({
            scenes: complete.scenes,
            epigraphCleanups: [cleanupFor('layout'), cleanupFor('unexpected')],
        }), manifest)).toMatch(/does not call for/);

        expect(findManifestJournalMismatch(bookRecord({
            scenes: complete.scenes,
            epigraphCleanups: [cleanupFor('layout'), cleanupFor('layout')],
        }), manifest)).toMatch(/more than one cleanup record/);
    });
});
