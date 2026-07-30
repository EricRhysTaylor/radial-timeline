import type { BookMigrationPlan } from './partMarkers';
import {
    ABSENT,
    classifyCleanupGate,
    classifyFieldRecovery,
    cleanupNeedsApply,
    fingerprintPlan,
    listSnapshotsEqual,
    needsWrite,
    requiresRecoveryChoice,
    snapshotsEqual,
    type JournalBookRecord,
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
    /** Every planned field was written and verified. */
    | 'written'
    /** Nothing needed doing; the scene already held the intended values. */
    | 'already-current'
    /** An unresolved earlier attempt: the executor must not decide this alone. */
    | 'needs-choice'
    /** A journalled field was edited outside the migration. */
    | 'diverged'
    /** The mutation threw, or the value did not survive verification. */
    | 'failed';

export interface SceneOutcome {
    path: string;
    status: SceneOutcomeStatus;
    fields: JournalFieldName[];
    detail?: string;
}

export interface CleanupOutcome {
    layoutId: string;
    status: 'cleared' | 'already-clear' | 'blocked' | 'failed';
    detail?: string;
}

export interface ExecutionReport {
    bookId: string;
    scenes: SceneOutcome[];
    cleanups: CleanupOutcome[];
    /** Set when the run stopped before doing anything. */
    aborted?: { reason: 'plan-drift'; detail: string };
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
    const report: ExecutionReport = { bookId: bookRecord.bookId, scenes: [], cleanups: [] };

    const fresh = fingerprintPlan(plan);
    if (fresh !== bookRecord.planFingerprint) {
        report.aborted = {
            reason: 'plan-drift',
            detail: 'The vault changed since this migration was planned. '
                + 'Nothing was written. Re-plan, or restore the partial run, before continuing.',
        };
        return report;
    }

    for (const sceneRecord of bookRecord.scenes) {
        report.scenes.push(await applyScene(sceneRecord, { journal, store, scenes }));
    }

    report.cleanups.push(...await applyCleanups({ journal, bookRecord, store, scenes, layouts }));

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

    const diverged = record.changes.filter(change =>
        change.state === 'planned'
        && classifyFieldRecovery(change, current[change.field] ?? ABSENT) === 'diverged'
    );
    if (diverged.length > 0) {
        return {
            path: record.path,
            status: 'diverged',
            fields: diverged.map(change => change.field),
            detail: 'These fields hold neither the value recorded before the migration nor the one '
                + 'it meant to write, so someone else edited them.',
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
        await saveQuietly(store, journal);
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
        await saveQuietly(store, journal);
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
    await saveQuietly(store, journal);

    if (unverified.length > 0) {
        return {
            path: record.path,
            status: 'failed',
            fields: unverified.map(change => change.field),
            detail: 'The write reported success but the value is not on disk.',
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
    if (cleanup.state === 'confirmed') {
        return { layoutId: cleanup.layoutId, status: 'already-clear' };
    }

    let current;
    try {
        current = await layouts.read(cleanup.layoutId);
    } catch (error) {
        return { layoutId: cleanup.layoutId, status: 'failed', detail: describeError(error) };
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
        await saveQuietly(store, journal);
        return { layoutId: cleanup.layoutId, status: 'failed', detail: describeError(error) };
    }

    let verified;
    try {
        verified = await layouts.read(cleanup.layoutId);
    } catch (error) {
        await saveQuietly(store, journal);
        return {
            layoutId: cleanup.layoutId,
            status: 'failed',
            detail: `Cleanup could not be verified: ${describeError(error)}`,
        };
    }

    const matches = listSnapshotsEqual(verified.actEpigraphs, cleanup.after.actEpigraphs)
        && listSnapshotsEqual(verified.actEpigraphAttributions, cleanup.after.actEpigraphAttributions);

    if (matches) cleanup.state = 'confirmed';
    await saveQuietly(store, journal);

    return matches
        ? { layoutId: cleanup.layoutId, status: 'cleared' }
        : {
            layoutId: cleanup.layoutId,
            status: 'failed',
            detail: 'The cleanup reported success but the stored epigraphs are still present.',
        };
}

/**
 * Save without letting a journal failure mask the vault outcome being reported.
 *
 * The in-memory state is already correct; a failed save means the next run sees
 * an older journal, which the three-way check handles. Throwing here would hide
 * what actually happened to the author's files.
 */
async function saveQuietly(store: JournalStore, journal: PartMigrationJournal): Promise<void> {
    try {
        await store.save(journal);
    } catch {
        // Intentionally swallowed — see above.
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
