import { describe, expect, it } from 'vitest';
import type { BookMigrationPlan } from './partMarkers';
import { buildManifest, fingerprintManifest } from './partMarkersManifest';
import {
    LIST_ABSENT,
    PART_MIGRATION_JOURNAL_SCHEMA,
    snapshotList,
    type JournalBookRecord,
    type JournalFieldChange,
    type JournalFieldName,
    type JournalLayoutCleanupRecord,
    type JournalListSnapshot,
    type JournalSnapshot,
    type PartMigrationJournal,
} from './partMarkersJournal';
import { executeBookMigration, type ExecuteBookOptions } from './partMarkersExecutor';

const ABSENT_SNAP: JournalSnapshot = { kind: 'absent' };
const bool = (value: boolean): JournalSnapshot => ({ kind: 'boolean', value });
const str = (value: string): JournalSnapshot => ({ kind: 'string', value });

const PATH = 'Books/A/1.md';

const PLAN: BookMigrationPlan = {
    bookId: 'book-1',
    status: 'derive',
    epigraphSourceLayoutIds: [],
    writes: [{ path: PATH, title: true, actNumber: 1, partNumber: 1 }],
};

function change(overrides: Partial<JournalFieldChange> = {}): JournalFieldChange {
    return { field: 'Part', before: ABSENT_SNAP, after: bool(true), state: 'planned', ...overrides };
}

function cleanupRecord(
    overrides: Partial<JournalLayoutCleanupRecord> = {}
): JournalLayoutCleanupRecord {
    return {
        layoutId: 'layout',
        before: { actEpigraphs: snapshotList(['One.']), actEpigraphAttributions: LIST_ABSENT },
        after: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        state: 'planned',
        accepted: true,
        ...overrides,
    };
}

interface HarnessOptions {
    disk?: Partial<Record<JournalFieldName, JournalSnapshot>>;
    layoutDisk?: { actEpigraphs: JournalListSnapshot; actEpigraphAttributions: JournalListSnapshot };
    bookRecord?: Partial<JournalBookRecord>;
    failSave?: number;
    failWrite?: boolean;
    /** Simulate a write that reports success but does not land. */
    swallowWrite?: boolean;
    failRead?: boolean;
}

/** Fingerprint of the resolved manifest for a plan, as the journal stores it. */
function manifestFingerprint(plan: BookMigrationPlan): string {
    const manifest = buildManifest(plan);
    return manifest ? fingerprintManifest(manifest) : 'not-executable';
}

function makeHarness(options: HarnessOptions = {}) {
    const ops: string[] = [];
    const disk: Partial<Record<JournalFieldName, JournalSnapshot>> = { ...(options.disk ?? {}) };
    let layoutDisk = options.layoutDisk ?? {
        actEpigraphs: snapshotList(['One.']),
        actEpigraphAttributions: LIST_ABSENT,
    };
    let saveCount = 0;

    const bookRecord: JournalBookRecord = {
        bookId: 'book-1',
        status: 'planned',
        planFingerprint: manifestFingerprint(PLAN),
        preExistingMarkerPaths: [],
        scenes: [{ path: PATH, changes: [change()], skipped: [] }],
        epigraphCleanups: [],
        ...options.bookRecord,
    };

    const journal: PartMigrationJournal = {
        schema: PART_MIGRATION_JOURNAL_SCHEMA,
        startedAt: '2026-07-29T10:00:00.000Z',
        books: [bookRecord],
    };

    const states = () => bookRecord.scenes
        .flatMap(scene => scene.changes.map(entry => entry.state))
        .concat(bookRecord.epigraphCleanups.map(entry => entry.state))
        .join('+');

    const deps: Omit<ExecuteBookOptions, 'plan'> = {
        journal,
        bookRecord,
        store: {
            save: async () => {
                saveCount += 1;
                if (options.failSave === saveCount) {
                    ops.push('save:FAIL');
                    throw new Error('disk full');
                }
                ops.push(`save:${states()}`);
            },
        },
        scenes: {
            read: async (path: string) => {
                if (options.failRead) {
                    ops.push('read:FAIL');
                    throw new Error('unreadable');
                }
                ops.push(`read:${path}`);
                return { ...disk };
            },
            write: async (path, values) => {
                if (options.failWrite) {
                    ops.push('write:FAIL');
                    throw new Error('write failed');
                }
                ops.push(`write:${path}`);
                if (options.swallowWrite) return;
                for (const entry of values) disk[entry.field] = entry.value;
            },
        },
        layouts: {
            read: async (layoutId: string) => {
                ops.push(`layout-read:${layoutId}`);
                return layoutDisk;
            },
            write: async (layoutId, values) => {
                ops.push(`layout-write:${layoutId}`);
                layoutDisk = values;
            },
        },
    };

    return { ops, disk, bookRecord, journal, deps, layout: () => layoutDisk };
}

describe('the ordering contract', () => {
    it('persists `attempting` before touching the vault, and `confirmed` only after verifying', async () => {
        // The whole recovery model rests on this sequence. A crash at any point
        // must leave a journal that describes reality.
        const harness = makeHarness();
        await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(harness.ops).toEqual([
            `read:${PATH}`,        // what is there now
            'save:attempting',     // 1. record the intent, durably
            `write:${PATH}`,       // 2. mutate
            `read:${PATH}`,        // 3. verify against the vault, not the return value
            'save:confirmed',      // 4. only now claim success
            'save:confirmed',      // book stamped applied — nothing outstanding
        ]);
    });

    it('reports the write and leaves the change confirmed', async () => {
        const harness = makeHarness();
        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes).toEqual([{ path: PATH, status: 'written', fields: ['Part'] }]);
        expect(harness.bookRecord.scenes[0].changes[0].state).toBe('confirmed');
        expect(harness.disk.Part).toEqual(bool(true));
    });

    it('stamps the book applied once nothing is outstanding', async () => {
        // Without the stamp the promised complete -> no-op state is unreachable
        // and every later run re-reads a finished book.
        const harness = makeHarness();
        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.bookStatus).toBe('applied');
        expect(harness.bookRecord.status).toBe('applied');
    });

    it('does no work at all for a book already stamped applied', async () => {
        const harness = makeHarness({ bookRecord: { status: 'applied' } });
        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.bookStatus).toBe('applied');
        expect(report.scenes).toEqual([]);
        expect(harness.ops).toEqual([]);
    });

    it('does not stamp a book that produced no outcomes at all', async () => {
        // `every` is vacuously true over an empty list, so a book with no
        // records would otherwise sail through as complete.
        const blocked: BookMigrationPlan = {
            bookId: 'book-1', status: 'blocked', reason: 're-entrant-acts',
            scenes: [{ path: PATH, detail: 'Re-opens Act 1.' }], detail: '',
        };
        const harness = makeHarness({
            bookRecord: { scenes: [], planFingerprint: manifestFingerprint(blocked) },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: blocked });

        expect(report.bookStatus).toBe('planned');
        expect(report.incomplete?.reason).toBe('plan-not-completable');
    });

    it('does not stamp a book with a field the migration could not write', async () => {
        // A scene with zero changes reports `already-current`, so without the
        // skip check a marker skipped for an unsupported value looked complete.
        const harness = makeHarness({
            bookRecord: {
                scenes: [{
                    path: PATH,
                    changes: [],
                    skipped: [{ field: 'Part', reason: 'unsupported-value' }],
                }],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('already-current');
        expect(report.bookStatus).toBe('planned');
        expect(report.incomplete?.reason).toBe('unresolved-skips');
    });

    it('still stamps when the only skip was a deliberate deferral to the author', async () => {
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: {
                scenes: [{
                    path: PATH,
                    changes: [change({ state: 'confirmed' })],
                    skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
                }],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.bookStatus).toBe('applied');
        expect(report.incomplete).toBeUndefined();
    });

    it('reports an unrecorded completion stamp rather than a silent unfinished book', async () => {
        // Every outcome reads as success; without this the caller would show a
        // page of green for a book that is correctly still unfinished.
        const harness = makeHarness({ failSave: 3 });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('written');
        expect(report.bookStatus).toBe('planned');
        expect(report.incomplete?.reason).toBe('stamp-not-recorded');
    });

    it('does not stamp a book whose work did not settle', async () => {
        const harness = makeHarness({ swallowWrite: true });
        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('failed');
        expect(report.bookStatus).toBe('planned');
    });
});

describe('refusing to act', () => {
    it('aborts without writing when the plan no longer matches', async () => {
        // Resuming across a changed plan would apply half of one and half of
        // another. Only the executor holds both artifacts, so only it can tell.
        const harness = makeHarness();
        const drifted: BookMigrationPlan = {
            ...PLAN,
            writes: [{ path: PATH, title: true, actNumber: 2, partNumber: 2 }],
        };

        const report = await executeBookMigration({ ...harness.deps, plan: drifted });

        expect(report.aborted?.reason).toBe('plan-drift');
        expect(report.scenes).toEqual([]);
        expect(harness.ops).toEqual([]);
    });

    it('refuses a blocked plan carrying stray change records, before writing', async () => {
        // The completability check runs after the loops, so without validation
        // up front these writes would already have landed by the time it fired.
        const blocked: BookMigrationPlan = {
            bookId: 'book-1', status: 'blocked', reason: 're-entrant-acts',
            scenes: [{ path: PATH, detail: 'Re-opens Act 1.' }], detail: '',
        };
        const harness = makeHarness({
            bookRecord: { planFingerprint: manifestFingerprint(blocked) },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: blocked });

        expect(report.aborted?.reason).toBe('journal-plan-mismatch');
        expect(harness.ops).toEqual([]);
        expect(harness.disk.Part).toBeUndefined();
    });

    it('refuses a noop plan carrying stray change records', async () => {
        const noop: BookMigrationPlan = { bookId: 'book-1', status: 'noop', reason: 'no-boundaries' };
        const harness = makeHarness({ bookRecord: { planFingerprint: manifestFingerprint(noop) } });

        const report = await executeBookMigration({ ...harness.deps, plan: noop });

        expect(report.aborted?.reason).toBe('journal-plan-mismatch');
        expect(harness.ops).toEqual([]);
    });

    it('refuses a derive plan whose journal is missing one of its writes', async () => {
        // Executing the rest would migrate the book partially and stamp it
        // applied — a half-migrated book recorded as finished.
        const twoWrites: BookMigrationPlan = {
            bookId: 'book-1',
            status: 'derive',
            epigraphSourceLayoutIds: [],
            writes: [
                { path: PATH, title: true, actNumber: 1, partNumber: 1 },
                { path: 'Books/A/2.md', title: true, actNumber: 2, partNumber: 2 },
            ],
        };
        const harness = makeHarness({
            bookRecord: { planFingerprint: manifestFingerprint(twoWrites) },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: twoWrites });

        expect(report.aborted?.reason).toBe('journal-plan-mismatch');
        expect(report.aborted?.detail).toMatch(/no record for 1 planned scene/);
        expect(harness.ops).toEqual([]);
    });

    it('refuses a journal record the plan does not call for', async () => {
        const harness = makeHarness({
            bookRecord: {
                scenes: [
                    { path: PATH, changes: [change()], skipped: [] },
                    { path: 'Books/A/stray.md', changes: [change()], skipped: [] },
                ],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.aborted?.reason).toBe('journal-plan-mismatch');
        expect(report.aborted?.detail).toMatch(/does not call for/);
        expect(harness.ops).toEqual([]);
    });

    it('refuses a record whose target is not the value the plan calls for', async () => {
        const harness = makeHarness({
            bookRecord: {
                scenes: [{
                    path: PATH,
                    changes: [change({ after: str('Something the plan never asked for') })],
                    skipped: [],
                }],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.aborted?.reason).toBe('journal-plan-mismatch');
        expect(harness.ops).toEqual([]);
    });

    it('refuses a record writing a field the plan says nothing about', async () => {
        // PLAN has no quote, so an epigraph write is not the plan's business.
        const harness = makeHarness({
            bookRecord: {
                scenes: [{
                    path: PATH,
                    changes: [
                        change(),
                        change({ field: 'Part Epigraph', after: str('invented') }),
                    ],
                    skipped: [],
                }],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.aborted?.reason).toBe('journal-plan-mismatch');
        expect(harness.ops).toEqual([]);
    });

    it('refuses to decide an interrupted attempt', async () => {
        const harness = makeHarness({
            bookRecord: { scenes: [{ path: PATH, changes: [change({ state: 'attempting' })], skipped: [] }] },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('needs-choice');
        expect(harness.ops).toEqual([]);
    });

    it('stops on a field edited outside the migration', async () => {
        const harness = makeHarness({ disk: { Part: str('Author renamed this') } });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('diverged');
        expect(harness.ops).toEqual([`read:${PATH}`]);
        expect(harness.bookRecord.scenes[0].changes[0].state).toBe('planned');
    });

    it('will not claim a value it never wrote, even when it matches the target', async () => {
        // No attempt was recorded, so this is most likely an author edit after
        // preflight. Auto-confirming would fabricate provenance; staying silent
        // would strand the book, since the cleanup gate rightly keeps treating
        // it as outstanding.
        const harness = makeHarness({ disk: { Part: bool(true) } });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('unattributed');
        expect(harness.ops).toEqual([`read:${PATH}`]);
        expect(harness.bookRecord.scenes[0].changes[0].state).toBe('planned');
        expect(report.bookStatus).not.toBe('applied');
    });

    it('reports a confirmed, still-present field as current', async () => {
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: {
                scenes: [{ path: PATH, changes: [change({ state: 'confirmed' })], skipped: [] }],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('already-current');
        expect(report.bookStatus).toBe('applied');
    });

    it('reports a confirmed field the author later edited', async () => {
        // Divergence was only checked for `planned` changes, so this scene came
        // back as "already-current" — simply false.
        const harness = makeHarness({
            disk: { Part: str('Author renamed this') },
            bookRecord: {
                scenes: [{ path: PATH, changes: [change({ state: 'confirmed' })], skipped: [] }],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('diverged');
        expect(harness.ops).toEqual([`read:${PATH}`]);
    });

    it('reports a confirmed field the author reverted', async () => {
        const harness = makeHarness({
            disk: {},
            bookRecord: {
                scenes: [{ path: PATH, changes: [change({ state: 'confirmed' })], skipped: [] }],
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('diverged');
    });
});

describe('failure leaves an honest record', () => {
    it('writes nothing if the journal cannot be saved first', async () => {
        // Without a durable record of intent, a write would be unattributable.
        const harness = makeHarness({ failSave: 1 });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('failed');
        expect(harness.ops).toEqual([`read:${PATH}`, 'save:FAIL']);
        expect(harness.bookRecord.scenes[0].changes[0].state).toBe('planned');
        expect(harness.disk.Part).toBeUndefined();
    });

    it('leaves a failed mutation as `attempting`, never back to planned', async () => {
        // The mutation may have partially landed; claiming it never started
        // would license re-applying over an author's revert.
        const harness = makeHarness({ failWrite: true });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('failed');
        expect(harness.bookRecord.scenes[0].changes[0].state).toBe('attempting');
        expect(harness.ops).toContain('write:FAIL');
    });

    it('does not confirm a write the vault did not actually keep', async () => {
        // Trusting the mutation's return value would record success the vault
        // never granted. Verification reads back.
        const harness = makeHarness({ swallowWrite: true });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('failed');
        expect(report.scenes[0].detail).toMatch(/not on disk/);
        expect(harness.bookRecord.scenes[0].changes[0].state).toBe('attempting');
    });

    it('does not call a write successful when the confirmation was not recorded', async () => {
        // The vault is correct but the durable journal still reads `attempting`,
        // so the next run will need a recovery decision. Reporting success here
        // would bury that.
        const harness = makeHarness({ failSave: 2 });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('written-unconfirmed');
        expect(harness.disk.Part).toEqual(bool(true));
        expect(report.bookStatus).not.toBe('applied');
    });

    it('reports an unreadable scene without touching it', async () => {
        const harness = makeHarness({ failRead: true });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN });

        expect(report.scenes[0].status).toBe('failed');
        expect(harness.ops).toEqual(['read:FAIL']);
    });
});

describe('layout cleanup', () => {
    const PLAN_WITH_LAYOUT: BookMigrationPlan = { ...PLAN, epigraphSourceLayoutIds: ['layout'] } as BookMigrationPlan;
    const withCleanup = (extra: Partial<JournalBookRecord> = {}) => ({
        planFingerprint: manifestFingerprint(PLAN_WITH_LAYOUT),
        scenes: [{ path: PATH, changes: [change({ state: 'confirmed' })], skipped: [] }],
        epigraphCleanups: [cleanupRecord()],
        ...extra,
    });

    it('follows the same four steps as a scene write', async () => {
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: withCleanup(),
        });

        await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(harness.ops).toEqual([
            `read:${PATH}`,               // scene already current
            `read:${PATH}`,               // fresh state for the gate
            'layout-read:layout',         // storage still as recorded?
            'save:confirmed+attempting',  // 1. record intent
            'layout-write:layout',        // 2. mutate
            'layout-read:layout',         // 3. verify
            'save:confirmed+confirmed',   // 4. confirm
            'save:confirmed+confirmed',   // book stamped applied
        ]);
        expect(harness.layout().actEpigraphs).toEqual(LIST_ABSENT);
    });

    it('does not call cleanup successful when the confirmation was not recorded', async () => {
        // Storage was cleared and verified, but the durable journal still reads
        // `attempting`. The next run must resolve that, so this is not success.
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: withCleanup(),
            failSave: 2,
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('cleared-unconfirmed');
        expect(harness.layout().actEpigraphs).toEqual(LIST_ABSENT);
        expect(report.bookStatus).not.toBe('applied');
    });

    it('refuses when a migrated value is no longer on its scene', async () => {
        // Confirmation is a fact about the past. Clearing the stored copy now
        // would delete the last surviving one.
        const harness = makeHarness({ disk: {}, bookRecord: withCleanup() });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('blocked');
        expect(report.cleanups[0].detail).toMatch(/no longer on its scene/);
        expect(harness.layout().actEpigraphs).toEqual(snapshotList(['One.']));
    });

    it('refuses when a scene cannot be re-read', async () => {
        const harness = makeHarness({ failRead: true, bookRecord: withCleanup() });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('blocked');
        expect(report.cleanups[0].detail).toMatch(/could not be re-read/);
    });

    it('refuses when stored epigraphs changed underneath', async () => {
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: withCleanup(),
            layoutDisk: {
                actEpigraphs: snapshotList(['Someone edited this.']),
                actEpigraphAttributions: LIST_ABSENT,
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('blocked');
        expect(report.cleanups[0].detail).toMatch(/changed by someone else/);
    });

    it('refuses while a skipped epigraph is unaccepted', async () => {
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: withCleanup({
                scenes: [{
                    path: PATH,
                    changes: [change({ state: 'confirmed' })],
                    skipped: [{ field: 'Part Epigraph', reason: 'author-value-present' }],
                }],
                epigraphCleanups: [cleanupRecord({ accepted: false })],
            }),
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('blocked');
        expect(report.cleanups[0].detail).toMatch(/not been accepted/);
    });

    it('does not repeat a cleanup already confirmed and still clear', async () => {
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: withCleanup({ epigraphCleanups: [cleanupRecord({ state: 'confirmed' })] }),
            layoutDisk: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('already-clear');
        expect(harness.ops).not.toContain('layout-write:layout');
    });

    it('re-verifies a confirmed cleanup instead of trusting the flag', async () => {
        // If one layout was cleared, another failed, and the author repopulated
        // the first, trusting the flag would let a rerun clear the second and
        // stamp the book applied while legacy epigraphs remain in the first.
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: withCleanup({ epigraphCleanups: [cleanupRecord({ state: 'confirmed' })] }),
            layoutDisk: {
                actEpigraphs: snapshotList(['Author put these back.']),
                actEpigraphAttributions: LIST_ABSENT,
            },
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('blocked');
        expect(report.cleanups[0].detail).toMatch(/repopulated/);
        expect(report.bookStatus).toBe('planned');
    });

    it('refuses an interrupted cleanup attempt', async () => {
        const harness = makeHarness({
            disk: { Part: bool(true) },
            bookRecord: withCleanup({ epigraphCleanups: [cleanupRecord({ state: 'attempting' })] }),
        });

        const report = await executeBookMigration({ ...harness.deps, plan: PLAN_WITH_LAYOUT });

        expect(report.cleanups[0].status).toBe('blocked');
        expect(report.cleanups[0].detail).toMatch(/interrupted/);
    });
});
