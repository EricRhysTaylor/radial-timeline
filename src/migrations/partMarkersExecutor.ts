import type { BookMigrationPlan } from './partMarkers';
import {
    buildManifest,
    findManifestJournalMismatch,
    fingerprintManifest,
    type AcceptedEpigraph,
} from './partMarkersManifest';
import {
    ABSENT,
    classifyCleanupGate,
    classifyFieldRecovery,
    cleanupNeedsApply,
    listSnapshotsEqual,
    needsWrite,
    requiresRecoveryChoice,
    snapshotsEqual,
    type JournalBookRecord,
    type JournalBookStatus,
    type JournalFieldName,
    type JournalLayoutCleanupRecord,
    type JournalListSnapshot,
    type JournalSceneRecord,
    type JournalSnapshot,
    type PartMigrationJournal,
} from './partMarkersJournal';

/**
 * Executor for the Part marker migration.
 *
 * Owns the ordering contract that makes a crash recoverable:
 *
 *   1. persist `attempting` — **before** touching the vault
 *   2. perform the mutation
 *   3. re-read and verify the target actually holds the intended value
 *   4. persist `confirmed`
 *
 * Every step is durable before the next begins, so a crash at any point leaves
 * a journal that describes reality: `planned` means untouched, `attempting`
 * means unknown, `confirmed` means verified. Skipping step 1 would produce
 * writes with no record; skipping step 3 would record success the vault never
 * granted.
 *
 * The same four steps apply to layout cleanup, which is a vault mutation like
 * any other.
 *
 * I/O is injected. The sequence is the risky part, not the file handling, so it
 * is testable — including crash windows — without a vault.
 */

/** Persists the journal. Must be durable before it resolves. */
export interface JournalStore {
    save(journal: PartMigrationJournal): Promise<void>;
}

export interface SceneFieldPort {
    /** Current snapshots of the journalled fields on one scene. */
    read(path: string): Promise<Partial<Record<JournalFieldName, JournalSnapshot>>>;
    /** Apply field values to a scene's frontmatter in a single mutation. */
    write(
        path: string,
        values: Array<{ field: JournalFieldName; value: JournalSnapshot }>
    ): Promise<void>;
}

export interface LayoutEpigraphPort {
    read(layoutId: string): Promise<{
        actEpigraphs: JournalListSnapshot;
        actEpigraphAttributions: JournalListSnapshot;
    }>;
    write(layoutId: string, values: {
        actEpigraphs: JournalListSnapshot;
        actEpigraphAttributions: JournalListSnapshot;
    }): Promise<void>;
}

export type SceneOutcomeStatus =
    /** Every planned field was written, verified, and durably confirmed. */
    | 'written'
    /**
     * The write landed and verified, but the journal could not record the
     * confirmation. The vault is correct; the record is not, and the next run
     * will see an unresolved attempt.
     */
    | 'written-unconfirmed'
    /** Nothing needed doing; every field is confirmed and still on the scene. */
    | 'already-current'
    /**
     * A field already holds its target value with no attempt recorded, so the
     * migration cannot claim it. Most likely an author edit after preflight.
     */
    | 'unattributed'
    /** An unresolved earlier attempt: the executor must not decide this alone. */
    | 'needs-choice'
    /** A journalled field no longer holds what the record says it should. */
    | 'diverged'
    /** The mutation threw, or the value did not survive verification. */
    | 'failed';

export interface SceneOutcome {
    path: string;
    status: SceneOutcomeStatus;
    fields: JournalFieldName[];
    detail?: string;
}

export type CleanupOutcomeStatus =
    | 'cleared'
    /** Storage was cleared and verified, but the confirmation was not recorded. */
    | 'cleared-unconfirmed'
    | 'already-clear'
    | 'blocked'
    | 'failed';

export interface CleanupOutcome {
    layoutId: string;
    status: CleanupOutcomeStatus;
    detail?: string;
}

/**
 * Skip reasons that mean the migration failed to do something it intended.
 *
 * `author-value-present` is a deliberate deferral to the author and does not
 * block completion on its own; the cleanup gate handles whether the legacy copy
 * may then be cleared. The other two mean a field the plan called for was never
 * written, so the book is not migrated.
 */
const BLOCKING_SKIPS: ReadonlySet<string> = new Set(['unsupported-value', 'marker-not-written']);

/** Outcomes that leave nothing outstanding for this book. */
const SETTLED_SCENE: ReadonlySet<SceneOutcomeStatus> = new Set(['written', 'already-current']);
const SETTLED_CLEANUP: ReadonlySet<CleanupOutcomeStatus> = new Set(['cleared', 'already-clear']);

export type IncompleteReason =
    /** The plan itself does not describe a migration that can finish. */
    | 'plan-not-completable'
    /** Fields the migration could not write, so the book is not fully migrated. */
    | 'unresolved-skips'
    /** Everything landed, but the completion stamp could not be recorded. */
    | 'stamp-not-recorded';

export interface ExecutionReport {
    bookId: string;
    scenes: SceneOutcome[];
    cleanups: CleanupOutcome[];
    /** The book's status after this run — `applied` only when everything settled. */
    bookStatus: JournalBookStatus;
    /**
     * Why the book is not finished, when every individual outcome looks fine.
     * Without this a caller could show a page of successes and no explanation
     * for a book that is still, correctly, unfinished.
     */
    incomplete?: { reason: IncompleteReason; detail: string };
    /** Set when the run stopped before doing anything. */
    aborted?: { reason: 'plan-drift' | 'journal-plan-mismatch'; detail: string };
}

export interface ExecuteBookOptions {
    journal: PartMigrationJournal;
    /** The record inside `journal` for this book. Mutated in place as work lands. */
    bookRecord: JournalBookRecord;
    /** Freshly computed plan, compared against the recorded fingerprint. */
    plan: BookMigrationPlan;
    store: JournalStore;
    scenes: SceneFieldPort;
    layouts: LayoutEpigraphPort;
    /**
     * Author-confirmed epigraph placements, required before an author-owned
     * book has anything to execute. Never inferred.
     */
    acceptedEpigraphs?: AcceptedEpigraph[];
}

function plannedFields(record: JournalSceneRecord): JournalFieldName[] {
    return record.changes.map(change => change.field);
}

/**
 * Apply one book's journalled scene writes, then its layout cleanup.
 *
 * Refuses outright when the recorded plan no longer matches a freshly computed
 * one. Resuming across that difference would apply half of one plan and half of
 * another — the case the fingerprint exists to catch, and the reason the
 * executor rather than the planner owns this check: only here are both
 * artifacts in hand.
 */
export async function executeBookMigration(
    options: ExecuteBookOptions
): Promise<ExecutionReport> {
    const { journal, bookRecord, plan, store, scenes, layouts } = options;
    const report: ExecutionReport = {
        bookId: bookRecord.bookId,
        scenes: [],
        cleanups: [],
        bookStatus: bookRecord.status,
    };

    // A stamped book is done. Re-reading its scenes on every run would be
    // wasted work and would risk reporting later author edits as migration
    // business, which they are not.
    if (bookRecord.status === 'applied') return report;

    // One resolved authority for both checks: the manifest enumerates every
    // scene field and every cleanup target, so drift and record-mismatch are
    // measured against the same object rather than against a plan that knows
    // nothing about cleanup.
    const manifest = buildManifest(plan, { acceptedEpigraphs: options.acceptedEpigraphs });
    if (!manifest) {
        report.incomplete = {
            reason: 'plan-not-completable',
            detail: `This book is "${plan.status}", so there is no migration to perform.`,
        };
        if (bookRecord.scenes.some(scene => scene.changes.length > 0)
            || bookRecord.epigraphCleanups.length > 0) {
            report.incomplete = undefined;
            report.aborted = {
                reason: 'journal-plan-mismatch',
                detail: `The plan is "${plan.status}" and performs nothing, but the journal holds `
                    + 'records. Nothing was written. Re-plan this book before continuing.',
            };
        }
        return report;
    }

    if (fingerprintManifest(manifest) !== bookRecord.planFingerprint) {
        report.aborted = {
            reason: 'plan-drift',
            detail: 'The vault changed since this migration was planned. '
                + 'Nothing was written. Re-plan, or restore the partial run, before continuing.',
        };
        return report;
    }

    // Records must describe the manifest before anything is touched. Checking
    // this after the loops would be checking after the damage.
    const mismatch = findManifestJournalMismatch(bookRecord, manifest);
    if (mismatch) {
        report.aborted = {
            reason: 'journal-plan-mismatch',
            detail: `${mismatch} Nothing was written. Re-plan this book before continuing.`,
        };
        return report;
    }

    for (const sceneRecord of bookRecord.scenes) {
        report.scenes.push(await applyScene(sceneRecord, { journal, store, scenes }));
    }

    report.cleanups.push(...await applyCleanups({ journal, bookRecord, store, scenes, layouts }));

    // ── Stamp only when nothing is outstanding ────────────────────────
    // `written-unconfirmed` deliberately fails this test: the vault is right
    // but the journal is not, and stamping would bury an attempt the next run
    // still has to resolve.
    //
    // Emitted outcomes alone are not enough to conclude completion. `every` is
    // vacuously true over an empty list, so a book that produced no outcomes at
    // all — a blocked plan, or one whose records were never written — would
    // sail through. Completion is therefore also conditioned on the plan being
    // one that can finish, and on nothing having been skipped that the plan
    // called for.
    const outcomesSettled = report.scenes.every(outcome => SETTLED_SCENE.has(outcome.status))
        && report.cleanups.every(outcome => SETTLED_CLEANUP.has(outcome.status));

    if (!outcomesSettled) {
        report.bookStatus = bookRecord.status;
        return report;
    }

    const blockingSkips = bookRecord.scenes
        .filter(scene => scene.skipped.some(skip => BLOCKING_SKIPS.has(skip.reason)))
        .map(scene => scene.path);
    if (blockingSkips.length > 0) {
        report.incomplete = {
            reason: 'unresolved-skips',
            detail: `The migration could not write every field it planned (${blockingSkips
                .slice(0, 3).join(', ')}${blockingSkips.length > 3 ? ', …' : ''}), `
                + 'so this book is not fully migrated.',
        };
        report.bookStatus = bookRecord.status;
        return report;
    }

    bookRecord.status = 'applied';
    if (!await trySave(store, journal)) {
        // The work is done but the stamp is not durable. The next run re-reads
        // and settles again, which is harmless — but the caller must not present
        // a page of successes as a finished book.
        bookRecord.status = 'planned';
        report.incomplete = {
            reason: 'stamp-not-recorded',
            detail: 'Everything was written and verified, but the completion stamp could not be '
                + 'saved. The book will be checked again on the next run.',
        };
    }

    report.bookStatus = bookRecord.status;
    return report;
}

async function applyScene(
    record: JournalSceneRecord,
    deps: { journal: PartMigrationJournal; store: JournalStore; scenes: SceneFieldPort }
): Promise<SceneOutcome> {
    const { journal, store, scenes } = deps;
    const fields = plannedFields(record);

    if (record.changes.length === 0) {
        return { path: record.path, status: 'already-current', fields: [] };
    }

    const unresolved = record.changes.filter(requiresRecoveryChoice);
    if (unresolved.length > 0) {
        return {
            path: record.path,
            status: 'needs-choice',
            fields: unresolved.map(change => change.field),
            detail: 'An earlier attempt was interrupted here. Whether the write landed cannot be '
                + 'determined from the record, so it needs a decision rather than a guess.',
        };
    }

    let current: Partial<Record<JournalFieldName, JournalSnapshot>>;
    try {
        current = await scenes.read(record.path);
    } catch (error) {
        return { path: record.path, status: 'failed', fields, detail: describeError(error) };
    }

    const verdictFor = (change: typeof record.changes[number]) =>
        classifyFieldRecovery(change, current[change.field] ?? ABSENT);

    // Divergence is checked for every state, not just `planned`. A confirmed
    // field whose value the author later changed is not "current" — reporting
    // it as such would be simply false, and it must never be silently rewritten.
    const diverged = record.changes.filter(change => change.state === 'confirmed'
        ? verdictFor(change) !== 'matches-target'
        : verdictFor(change) === 'diverged');
    if (diverged.length > 0) {
        return {
            path: record.path,
            status: 'diverged',
            fields: diverged.map(change => change.field),
            detail: 'These fields no longer hold what the record says they should, '
                + 'so they were edited outside the migration.',
        };
    }

    const undecidable = record.changes.filter(change => verdictFor(change) === 'indeterminate');
    if (undecidable.length > 0) {
        return {
            path: record.path,
            status: 'needs-choice',
            fields: undecidable.map(change => change.field),
            detail: 'The recorded before and after values are identical here, so no observation '
                + 'can tell whether this was applied.',
        };
    }

    // A planned field already holding its target has no recorded attempt behind
    // it, so the migration cannot claim it — most likely the author edited the
    // scene after preflight. Auto-confirming would fabricate provenance, and
    // leaving it silent would strand the book: the cleanup gate rightly keeps
    // treating it as outstanding.
    const unattributed = record.changes.filter(change =>
        change.state === 'planned' && verdictFor(change) === 'matches-target'
    );
    if (unattributed.length > 0) {
        return {
            path: record.path,
            status: 'unattributed',
            fields: unattributed.map(change => change.field),
            detail: 'These fields already hold the intended value, but the migration never wrote '
                + 'them. Accept them as-is or re-plan; they will not be claimed automatically.',
        };
    }

    const pending = record.changes.filter(change =>
        needsWrite(change, current[change.field] ?? ABSENT)
    );
    if (pending.length === 0) {
        return { path: record.path, status: 'already-current', fields };
    }

    // ── 1. Persist `attempting` BEFORE touching the vault ──────────────
    // A crash after this point is visible as an unresolved attempt rather than
    // as a write nobody recorded.
    for (const change of pending) change.state = 'attempting';
    try {
        await store.save(journal);
    } catch (error) {
        for (const change of pending) change.state = 'planned';
        return {
            path: record.path,
            status: 'failed',
            fields: pending.map(change => change.field),
            detail: `Journal could not be saved, so nothing was written: ${describeError(error)}`,
        };
    }

    // ── 2. Mutate ─────────────────────────────────────────────────────
    try {
        await scenes.write(
            record.path,
            pending.map(change => ({ field: change.field, value: change.after }))
        );
    } catch (error) {
        // State stays `attempting`: the mutation may have partially landed.
        await trySave(store, journal);
        return {
            path: record.path,
            status: 'failed',
            fields: pending.map(change => change.field),
            detail: describeError(error),
        };
    }

    // ── 3. Re-read and verify ─────────────────────────────────────────
    let verified: Partial<Record<JournalFieldName, JournalSnapshot>>;
    try {
        verified = await scenes.read(record.path);
    } catch (error) {
        await trySave(store, journal);
        return {
            path: record.path,
            status: 'failed',
            fields: pending.map(change => change.field),
            detail: `Write could not be verified: ${describeError(error)}`,
        };
    }

    const unverified = pending.filter(change =>
        !snapshotsEqual(verified[change.field] ?? ABSENT, change.after)
    );

    // ── 4. Confirm only what the vault actually granted ───────────────
    for (const change of pending) {
        if (!unverified.includes(change)) change.state = 'confirmed';
    }
    const recorded = await trySave(store, journal);

    if (unverified.length > 0) {
        return {
            path: record.path,
            status: 'failed',
            fields: unverified.map(change => change.field),
            detail: 'The write reported success but the value is not on disk.',
        };
    }

    if (!recorded) {
        // The vault is correct and the in-memory state says so, but the durable
        // journal still reads `attempting`. Calling this success would bury an
        // unresolved attempt that the next run must handle.
        return {
            path: record.path,
            status: 'written-unconfirmed',
            fields: pending.map(change => change.field),
            detail: 'The values were written and verified, but the journal could not record the '
                + 'confirmation. The next run will treat these as an interrupted attempt.',
        };
    }

    return { path: record.path, status: 'written', fields: pending.map(change => change.field) };
}

async function applyCleanups(deps: {
    journal: PartMigrationJournal;
    bookRecord: JournalBookRecord;
    store: JournalStore;
    scenes: SceneFieldPort;
    layouts: LayoutEpigraphPort;
    /**
     * Author-confirmed epigraph placements, required before an author-owned
     * book has anything to execute. Never inferred.
     */
    acceptedEpigraphs?: AcceptedEpigraph[];
}): Promise<CleanupOutcome[]> {
    const { journal, bookRecord, store, scenes, layouts } = deps;
    if (bookRecord.epigraphCleanups.length === 0) return [];

    // The gate reads the vault as it is now, so collect fresh scene state first.
    // A scene that cannot be read leaves the gate to refuse rather than assume.
    const currentByPath = new Map<string, Partial<Record<JournalFieldName, JournalSnapshot>>>();
    for (const sceneRecord of bookRecord.scenes) {
        if (sceneRecord.changes.length === 0) continue;
        try {
            currentByPath.set(sceneRecord.path, await scenes.read(sceneRecord.path));
        } catch {
            // Deliberately left absent: unknown must block, not pass.
        }
    }

    const gate = classifyCleanupGate(bookRecord, currentByPath);
    if (!gate.allowed) {
        return bookRecord.epigraphCleanups.map(cleanup => ({
            layoutId: cleanup.layoutId,
            status: 'blocked' as const,
            detail: describeGate(gate.reason, gate.paths),
        }));
    }

    const outcomes: CleanupOutcome[] = [];
    for (const cleanup of bookRecord.epigraphCleanups) {
        outcomes.push(await applyCleanup(cleanup, { journal, store, layouts }));
    }
    return outcomes;
}

async function applyCleanup(
    cleanup: JournalLayoutCleanupRecord,
    deps: { journal: PartMigrationJournal; store: JournalStore; layouts: LayoutEpigraphPort }
): Promise<CleanupOutcome> {
    const { journal, store, layouts } = deps;

    if (cleanup.state === 'attempting') {
        return {
            layoutId: cleanup.layoutId,
            status: 'blocked',
            detail: 'An earlier cleanup attempt was interrupted here and needs a decision.',
        };
    }
    let current;
    try {
        current = await layouts.read(cleanup.layoutId);
    } catch (error) {
        return { layoutId: cleanup.layoutId, status: 'failed', detail: describeError(error) };
    }

    // A confirmed cleanup is re-verified rather than trusted, for the same
    // reason confirmed scene fields are: confirmation is a fact about the past.
    // If one layout was cleared, another failed, and the author then repopulated
    // the first, trusting the flag would let a rerun clear the second and stamp
    // the book applied while legacy epigraphs still sit in the first.
    if (cleanup.state === 'confirmed') {
        const stillClear = listSnapshotsEqual(current.actEpigraphs, cleanup.after.actEpigraphs)
            && listSnapshotsEqual(
                current.actEpigraphAttributions,
                cleanup.after.actEpigraphAttributions
            );
        return stillClear
            ? { layoutId: cleanup.layoutId, status: 'already-clear' }
            : {
                layoutId: cleanup.layoutId,
                status: 'blocked',
                detail: 'This storage was cleared earlier but holds epigraphs again, so it was '
                    + 'repopulated after the migration ran.',
            };
    }

    if (!cleanupNeedsApply(cleanup, current)) {
        return {
            layoutId: cleanup.layoutId,
            status: 'blocked',
            detail: 'Stored epigraphs no longer match what was recorded before the migration, '
                + 'so this storage was changed by someone else.',
        };
    }

    cleanup.state = 'attempting';
    try {
        await store.save(journal);
    } catch (error) {
        cleanup.state = 'planned';
        return {
            layoutId: cleanup.layoutId,
            status: 'failed',
            detail: `Journal could not be saved, so nothing was cleared: ${describeError(error)}`,
        };
    }

    try {
        await layouts.write(cleanup.layoutId, cleanup.after);
    } catch (error) {
        await trySave(store, journal);
        return { layoutId: cleanup.layoutId, status: 'failed', detail: describeError(error) };
    }

    let verified;
    try {
        verified = await layouts.read(cleanup.layoutId);
    } catch (error) {
        await trySave(store, journal);
        return {
            layoutId: cleanup.layoutId,
            status: 'failed',
            detail: `Cleanup could not be verified: ${describeError(error)}`,
        };
    }

    const matches = listSnapshotsEqual(verified.actEpigraphs, cleanup.after.actEpigraphs)
        && listSnapshotsEqual(verified.actEpigraphAttributions, cleanup.after.actEpigraphAttributions);

    if (matches) cleanup.state = 'confirmed';
    const recorded = await trySave(store, journal);

    if (!matches) {
        return {
            layoutId: cleanup.layoutId,
            status: 'failed',
            detail: 'The cleanup reported success but the stored epigraphs are still present.',
        };
    }

    return recorded
        ? { layoutId: cleanup.layoutId, status: 'cleared' }
        : {
            layoutId: cleanup.layoutId,
            status: 'cleared-unconfirmed',
            detail: 'The stored epigraphs were cleared and verified, but the journal could not '
                + 'record the confirmation. The next run will treat this as an interrupted attempt.',
        };
}

/**
 * Save, reporting failure rather than throwing.
 *
 * A journal failure must not mask the vault outcome — the author's files did
 * what they did, and hiding that behind a bookkeeping error helps nobody. But
 * it must not be silently discarded either: an unrecorded confirmation leaves
 * the durable journal reading `attempting`, which the next run has to resolve.
 * Callers surface it as an `-unconfirmed` outcome and withhold completion.
 */
async function trySave(store: JournalStore, journal: PartMigrationJournal): Promise<boolean> {
    try {
        await store.save(journal);
        return true;
    } catch {
        return false;
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function describeGate(reason: string, paths?: string[]): string {
    const suffix = paths && paths.length > 0 ? ` (${paths.slice(0, 3).join(', ')})` : '';
    switch (reason) {
        case 'scene-writes-outstanding':
            return `Scene writes are not all confirmed yet${suffix}.`;
        case 'scene-state-unknown':
            return `Some scenes could not be re-read, so cleanup cannot be verified safe${suffix}.`;
        case 'scene-value-reverted':
            return `A migrated value is no longer on its scene${suffix}; clearing the stored `
                + 'epigraphs would delete the last copy.';
        case 'skips-unaccepted':
            return 'Skipped epigraphs have not been accepted, and stored copies are all that remain.';
        default:
            return 'Cleanup is not permitted yet.';
    }
}
