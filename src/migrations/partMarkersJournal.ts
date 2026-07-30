import { SHARED_PART_EPIGRAPH_BY_FIELD_KEY, SHARED_PART_EPIGRAPH_FIELD_KEY, SHARED_PART_FIELD_KEY } from '../utils/timelineParts';
import type { BookMigrationPlan, PartMarkerWrite } from './partMarkers';

/**
 * Migration journal for the Act-derived → explicit Part marker cutover.
 *
 * A vault-local sidecar recording the preflight plan and, for every field the
 * migration intends to touch, a faithful snapshot of its value before and the
 * value it intends to write. Written before any scene is mutated, so every
 * marker the migration later writes is attributable to it.
 *
 * **No provenance field goes into scene YAML.** Provenance is operational state
 * and scene frontmatter stays author-only; the journal is the sidecar that
 * carries it (see `rt-scene-yaml-author-only` and plan §5.4).
 *
 * The journal covers two kinds of mutation, tracked separately because they
 * recover separately: writes to scene frontmatter, and cleanup of the legacy
 * per-layout epigraph storage those writes replace.
 *
 * This module is pure — shape, serialization, and recovery arithmetic. Reading
 * and writing the sidecar belongs to the executor.
 */

/** v3 added recorded write attempts and layout cleanup; no journal has shipped. */
export const PART_MIGRATION_JOURNAL_SCHEMA = 3;

export const JOURNAL_FIELDS = [
    SHARED_PART_FIELD_KEY,
    SHARED_PART_EPIGRAPH_FIELD_KEY,
    SHARED_PART_EPIGRAPH_BY_FIELD_KEY,
] as const;

export type JournalFieldName = typeof JOURNAL_FIELDS[number];

// ─── Snapshots ──────────────────────────────────────────────────────────

/**
 * A faithful snapshot of one frontmatter field.
 *
 * A bare `string | boolean | null` cannot represent what YAML permits. Three
 * distinctions matter: an absent key versus a key holding null (clearing a
 * marker deletes the key, so restore must tell "remove this" from "blank
 * this"), numbers, and lists/maps. The last cannot round-trip through a scalar,
 * so they are recorded as `unsupported` and the migration refuses to touch that
 * field — a field it cannot faithfully restore is one it has no business
 * writing.
 */
export type JournalSnapshot =
    | { kind: 'absent' }
    | { kind: 'null' }
    | { kind: 'string'; value: string }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'number'; value: number }
    | { kind: 'unsupported'; typeName: string };

export const ABSENT: JournalSnapshot = { kind: 'absent' };

/** Snapshot of a stored epigraph array. Normalized profiles guarantee `string[]`. */
export type JournalListSnapshot =
    | { kind: 'absent' }
    | { kind: 'list'; values: string[] };

export const LIST_ABSENT: JournalListSnapshot = { kind: 'absent' };

/** Snapshot a raw frontmatter value. `hasKey` separates absent from null-valued. */
export function snapshotValue(raw: unknown, hasKey: boolean): JournalSnapshot {
    if (!hasKey) return { kind: 'absent' };
    if (raw === null || raw === undefined) return { kind: 'null' };
    if (typeof raw === 'string') return { kind: 'string', value: raw };
    if (typeof raw === 'boolean') return { kind: 'boolean', value: raw };
    if (typeof raw === 'number' && Number.isFinite(raw)) return { kind: 'number', value: raw };
    return { kind: 'unsupported', typeName: Array.isArray(raw) ? 'list' : typeof raw };
}

export function snapshotList(values: string[] | undefined): JournalListSnapshot {
    return values ? { kind: 'list', values: [...values] } : { kind: 'absent' };
}

/**
 * Compare two snapshots.
 *
 * `unsupported` never equals anything, including another `unsupported`: we do
 * not know what it holds, so we must never conclude two such fields agree.
 */
export function snapshotsEqual(a: JournalSnapshot, b: JournalSnapshot): boolean {
    if (a.kind === 'unsupported' || b.kind === 'unsupported') return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'absent' || a.kind === 'null') return true;
    return a.value === (b as Extract<JournalSnapshot, { value: unknown }>).value;
}

export function listSnapshotsEqual(a: JournalListSnapshot, b: JournalListSnapshot): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'absent') return true;
    const other = b as Extract<JournalListSnapshot, { values: string[] }>;
    return a.values.length === other.values.length
        && a.values.every((value, index) => value === other.values[index]);
}

/** True when a snapshot holds author-authored text the migration must not displace. */
function holdsAuthorText(snapshot: JournalSnapshot): boolean {
    return snapshot.kind === 'string' && snapshot.value.trim().length > 0;
}

// ─── Scene records ──────────────────────────────────────────────────────

export interface JournalFieldChange {
    field: JournalFieldName;
    before: JournalSnapshot;
    after: JournalSnapshot;
    /**
     * Set true only once the executor has confirmed this write landed.
     *
     * Load-bearing for restore. Endpoint equality cannot establish provenance:
     * a field whose value matches `after` may have been written by the
     * migration, or typed independently by the author. Restoring on equality
     * alone would revert author content the migration never touched. Only a
     * recorded attempt licenses undoing a write.
     */
    applied: boolean;
}

export type SkipReason =
    /** The scene already carries author text here; the migration defers to it. */
    | 'author-value-present'
    /** The current value cannot be faithfully snapshotted, so it must not be touched. */
    | 'unsupported-value'
    /** The marker itself could not be written, so nothing else on the scene may be. */
    | 'marker-not-written';

export interface JournalFieldSkip {
    field: JournalFieldName;
    reason: SkipReason;
}

export interface JournalSceneRecord {
    path: string;
    changes: JournalFieldChange[];
    /** Fields deliberately left alone, recorded so the report can explain why. */
    skipped: JournalFieldSkip[];
}

// ─── Layout cleanup records ─────────────────────────────────────────────

/**
 * One layout's legacy epigraph storage, and what the migration intends to do
 * with it.
 *
 * Cleanup is itself a recoverable mutation, so it is journalled with the same
 * before/after/attempt discipline as a scene write rather than being
 * rediscovered afterwards. It is tracked separately from scene records because
 * it recovers separately: a crash between "scene written" and "layout cleaned"
 * leaves both, and the executor must be able to tell which half happened.
 *
 * Every populated layout gets a record, including identical copies — those are
 * distinct storage locations, and leaving one behind would resurrect epigraphs
 * the author believes were migrated.
 */
export interface JournalLayoutCleanupRecord {
    layoutId: string;
    before: {
        actEpigraphs: JournalListSnapshot;
        actEpigraphAttributions: JournalListSnapshot;
    };
    /**
     * Intended end state — normally both fields absent. Unrelated settings on
     * the same layout (`sceneHeadingMode`) are not represented here and must be
     * left untouched; this migration owns the epigraph arrays only.
     */
    after: {
        actEpigraphs: JournalListSnapshot;
        actEpigraphAttributions: JournalListSnapshot;
    };
    applied: boolean;
    /**
     * The author explicitly accepted that scene-side epigraphs which were
     * skipped or conflicting will not be migrated. Without acceptance the
     * legacy storage is the only surviving copy and must be kept.
     */
    accepted: boolean;
}

export type JournalBookStatus = 'planned' | 'applied' | 'blocked' | 'skipped';

export interface JournalBookRecord {
    bookId: string;
    status: JournalBookStatus;
    /**
     * Fingerprint of the plan this record was written for.
     *
     * Agreement is a **precondition** for resuming, not proof that resuming is
     * safe: it covers what the plan intends to write, not the state it was
     * computed against. Per-field three-way comparison plus the recorded
     * attempt remain the authority on whether any individual write may proceed.
     */
    planFingerprint: string;
    /**
     * Paths that already carried a Part marker at preflight — author structure,
     * never the migration's own output. Recorded before any write, because
     * afterwards the two are indistinguishable on disk.
     */
    preExistingMarkerPaths: string[];
    scenes: JournalSceneRecord[];
    epigraphCleanups: JournalLayoutCleanupRecord[];
}

export interface PartMigrationJournal {
    schema: number;
    startedAt: string;
    books: JournalBookRecord[];
}

// ─── Planning ───────────────────────────────────────────────────────────

/**
 * A stable fingerprint of what a plan intends to do.
 *
 * Order-independent, so an unrelated reordering upstream does not read as
 * drift. Sensitive to path, target value, epigraph text, and the structural
 * numbering — two plans writing the same values under different part numbers
 * are different plans, and resuming across that difference would renumber a
 * book.
 *
 * Non-derive outcomes carry their distinguishing detail too. A book blocked for
 * one reason and later blocked for another has genuinely changed, and a
 * fingerprint of the status alone would report the two as identical.
 *
 * Each entry is JSON-encoded before joining so no separator can collide with a
 * path, title, or epigraph containing the same character.
 */
export function fingerprintPlan(plan: BookMigrationPlan): string {
    switch (plan.status) {
        case 'derive': {
            const parts = plan.writes
                .map(write => JSON.stringify([
                    write.path,
                    write.partNumber,
                    write.actNumber,
                    write.title,
                    write.quote ?? '',
                    write.attribution ?? '',
                ]))
                .sort();
            return `derive:${plan.bookId}:${parts.join('|')}`;
        }
        case 'blocked': {
            const scenes = plan.scenes
                .map(scene => JSON.stringify([scene.path, scene.detail]))
                .sort();
            return `blocked:${plan.bookId}:${plan.reason}:${scenes.join('|')}`;
        }
        case 'author-owned': {
            const markers = [...plan.markerPaths].sort();
            const proposal = plan.epigraphProposal
                ? JSON.stringify([plan.epigraphProposal.layoutId, plan.epigraphProposal.entries])
                : '';
            return `author-owned:${plan.bookId}:${markers.join('|')}:${proposal}`;
        }
        case 'noop':
            return `noop:${plan.bookId}:${plan.reason}`;
    }
}

/**
 * Field changes a planned write implies, given faithful snapshots of the
 * scene's current values.
 *
 * The migration **adds structure; it never removes author content.** Rules:
 *
 *   - A field the migration has no value for is left completely alone. Writing
 *     `null` there would *delete* an epigraph the author wrote by hand, simply
 *     because this book's layout options carried nothing for that act.
 *   - A field already holding author text is not overwritten. The migration is
 *     moving epigraphs out of layout options, not outranking text already on
 *     the scene.
 *   - A field whose current value cannot be snapshotted is skipped: it cannot
 *     be restored, so it must not be written.
 *   - **If the marker itself cannot be written, nothing on the scene is.**
 *     Epigraph fields exist to decorate a Part opener; writing them onto a
 *     scene with no marker would leave orphan text attached to nothing, in a
 *     book the author never agreed to change.
 */
export function changesForWrite(
    write: PartMarkerWrite,
    before: Partial<Record<JournalFieldName, JournalSnapshot>>
): { changes: JournalFieldChange[]; skipped: JournalFieldSkip[] } {
    const desired: Record<JournalFieldName, JournalSnapshot | null> = {
        [SHARED_PART_FIELD_KEY]: typeof write.title === 'string'
            ? { kind: 'string', value: write.title }
            : { kind: 'boolean', value: true },
        // null = "the migration has nothing to say about this field".
        [SHARED_PART_EPIGRAPH_FIELD_KEY]: write.quote === undefined
            ? null
            : { kind: 'string', value: write.quote },
        [SHARED_PART_EPIGRAPH_BY_FIELD_KEY]: write.attribution === undefined
            ? null
            : { kind: 'string', value: write.attribution },
    };

    const markerCurrent = before[SHARED_PART_FIELD_KEY] ?? ABSENT;
    const markerTarget = desired[SHARED_PART_FIELD_KEY];

    // Resolve the marker first: everything else on the scene depends on it.
    if (markerCurrent.kind === 'unsupported') {
        return {
            changes: [],
            skipped: [
                { field: SHARED_PART_FIELD_KEY, reason: 'unsupported-value' },
                ...JOURNAL_FIELDS
                    .filter(field => field !== SHARED_PART_FIELD_KEY)
                    .filter(field => desired[field] !== null)
                    .map(field => ({ field, reason: 'marker-not-written' as const })),
            ],
        };
    }

    const changes: JournalFieldChange[] = [];
    const skipped: JournalFieldSkip[] = [];

    if (markerTarget && !snapshotsEqual(markerCurrent, markerTarget)) {
        changes.push({
            field: SHARED_PART_FIELD_KEY,
            before: markerCurrent,
            after: markerTarget,
            applied: false,
        });
    }

    for (const field of JOURNAL_FIELDS) {
        if (field === SHARED_PART_FIELD_KEY) continue;
        const target = desired[field];
        const current = before[field] ?? ABSENT;

        if (current.kind === 'unsupported') {
            skipped.push({ field, reason: 'unsupported-value' });
            continue;
        }
        if (target === null) continue;
        if (holdsAuthorText(current)) {
            skipped.push({ field, reason: 'author-value-present' });
            continue;
        }
        if (snapshotsEqual(current, target)) continue;

        changes.push({ field, before: current, after: target, applied: false });
    }

    return { changes, skipped };
}

// ─── Recovery ───────────────────────────────────────────────────────────

export type FieldRecoveryVerdict =
    /**
     * On disk matches the intended value. **Not** a claim about who wrote it —
     * see `applied` for that. States only that applying the write would be a
     * no-op.
     */
    | 'matches-target'
    /** On disk still matches the recorded prior value: the write has not landed. */
    | 'matches-origin'
    /** On disk matches neither endpoint: the field was edited by someone else. */
    | 'diverged'
    /** The recorded endpoints are identical, so no observation can separate them. */
    | 'indeterminate';

/**
 * Three-way comparison for one field: journal-before, journal-after, disk-now.
 *
 * Answers "what does the disk look like", nothing more. It cannot answer "did
 * we do this" — that requires the recorded attempt. Use `needsWrite` and
 * `canRestore` for decisions; this is the observation they are built on.
 */
export function classifyFieldRecovery(
    change: JournalFieldChange,
    current: JournalSnapshot
): FieldRecoveryVerdict {
    if (snapshotsEqual(change.before, change.after)) return 'indeterminate';
    if (snapshotsEqual(current, change.after)) return 'matches-target';
    if (snapshotsEqual(current, change.before)) return 'matches-origin';
    return 'diverged';
}

/** True when the write still needs applying: never attempted, and untouched since. */
export function needsWrite(change: JournalFieldChange, current: JournalSnapshot): boolean {
    if (change.applied) return false;
    return classifyFieldRecovery(change, current) === 'matches-origin';
}

/**
 * True when this field may be reverted to its prior value.
 *
 * Requires **both** a recorded attempt and the disk still holding what we
 * wrote. Restoring on endpoint equality alone would revert a value the author
 * produced independently — the migration would delete author content while
 * believing it was undoing its own work.
 */
export function canRestore(change: JournalFieldChange, current: JournalSnapshot): boolean {
    if (!change.applied) return false;
    return classifyFieldRecovery(change, current) === 'matches-target';
}

export type SceneRecoveryVerdict = FieldRecoveryVerdict | 'partial';

/**
 * Roll a scene's fields up into one verdict.
 *
 * Divergence and indeterminacy dominate: a scene whose journalled fields were
 * edited, or whose record cannot be reasoned about, must not be resumed or
 * restored whatever its other fields say.
 *
 * A record with no changes means the migration planned nothing for this scene.
 * That is trustworthy only because a scene whose changes failed to parse is
 * rejected outright rather than arriving here looking empty.
 */
export function classifySceneRecovery(
    record: JournalSceneRecord,
    current: Partial<Record<JournalFieldName, JournalSnapshot>>
): SceneRecoveryVerdict {
    if (record.changes.length === 0) return 'matches-target';

    const verdicts = record.changes.map(change =>
        classifyFieldRecovery(change, current[change.field] ?? ABSENT)
    );

    if (verdicts.includes('diverged')) return 'diverged';
    if (verdicts.includes('indeterminate')) return 'indeterminate';
    if (verdicts.every(verdict => verdict === 'matches-target')) return 'matches-target';
    if (verdicts.every(verdict => verdict === 'matches-origin')) return 'matches-origin';
    return 'partial';
}

export type CleanupGate =
    | { allowed: true }
    | { allowed: false; reason: 'scene-writes-outstanding' | 'skips-unaccepted' };

/**
 * Whether legacy epigraph storage may be cleared for a book.
 *
 * Cleanup destroys the last copy of anything the scenes did not take, so it
 * runs only after every corresponding scene change has actually landed, and
 * only when the author has accepted whatever was skipped. An unsupported or
 * unaccepted skipped epigraph keeps its legacy storage — the alternative is
 * deleting text that now exists nowhere.
 */
export function classifyCleanupGate(
    book: Pick<JournalBookRecord, 'scenes' | 'epigraphCleanups'>
): CleanupGate {
    const outstanding = book.scenes.some(scene => scene.changes.some(change => !change.applied));
    if (outstanding) return { allowed: false, reason: 'scene-writes-outstanding' };

    const hasSkips = book.scenes.some(scene => scene.skipped.length > 0);
    const allAccepted = book.epigraphCleanups.every(cleanup => cleanup.accepted);
    if (hasSkips && !allAccepted) return { allowed: false, reason: 'skips-unaccepted' };

    return { allowed: true };
}

/** Whether a cleanup record's intended change still needs applying. */
export function cleanupNeedsApply(
    cleanup: JournalLayoutCleanupRecord,
    current: { actEpigraphs: JournalListSnapshot; actEpigraphAttributions: JournalListSnapshot }
): boolean {
    if (cleanup.applied) return false;
    return listSnapshotsEqual(current.actEpigraphs, cleanup.before.actEpigraphs)
        && listSnapshotsEqual(current.actEpigraphAttributions, cleanup.before.actEpigraphAttributions);
}

/**
 * Paths whose Part marker this migration wrote or attempted to write.
 *
 * Feeds the planner's disown-set. Attempted counts as written: a run that
 * crashed mid-write may have landed the marker without recording success, and
 * the three-way check establishes the real state afterwards. Treating only
 * confirmed writes as ours would hand a crashed run's output back to the
 * planner as author intent — the failure the journal exists to prevent.
 */
export function getMigrationWrittenPaths(
    journal: PartMigrationJournal,
    bookId: string
): Set<string> {
    const book = journal.books.find(entry => entry.bookId === bookId);
    if (!book) return new Set();

    const preExisting = new Set(book.preExistingMarkerPaths);
    return new Set(
        book.scenes
            .filter(scene => !preExisting.has(scene.path))
            .filter(scene => scene.changes.some(change => change.field === SHARED_PART_FIELD_KEY))
            .map(scene => scene.path)
    );
}

// ─── Parsing ────────────────────────────────────────────────────────────
//
// Fail closed at every level. A malformed change invalidates its scene, a
// malformed scene invalidates its book, and a malformed book invalidates the
// journal. Required arrays must be present: a record missing `changes`
// entirely is not an empty plan, it is an unreadable one, and treating the two
// alike would let a truncated journal report a half-migrated book as complete.

function parseSnapshot(raw: unknown): JournalSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;

    switch (candidate.kind) {
        case 'absent':
        case 'null':
            return { kind: candidate.kind };
        case 'string':
            return typeof candidate.value === 'string' ? { kind: 'string', value: candidate.value } : null;
        case 'boolean':
            return typeof candidate.value === 'boolean' ? { kind: 'boolean', value: candidate.value } : null;
        case 'number':
            return typeof candidate.value === 'number' && Number.isFinite(candidate.value)
                ? { kind: 'number', value: candidate.value }
                : null;
        case 'unsupported':
            return typeof candidate.typeName === 'string'
                ? { kind: 'unsupported', typeName: candidate.typeName }
                : null;
        default:
            return null;
    }
}

function parseListSnapshot(raw: unknown): JournalListSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    if (candidate.kind === 'absent') return { kind: 'absent' };
    if (candidate.kind !== 'list') return null;
    if (!Array.isArray(candidate.values)) return null;
    if (candidate.values.some(entry => typeof entry !== 'string')) return null;
    return { kind: 'list', values: candidate.values as string[] };
}

function parseChange(raw: unknown): JournalFieldChange | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    const field = candidate.field;
    if (typeof field !== 'string') return null;
    if (!(JOURNAL_FIELDS as readonly string[]).includes(field)) return null;
    if (typeof candidate.applied !== 'boolean') return null;

    const before = parseSnapshot(candidate.before);
    const after = parseSnapshot(candidate.after);
    if (!before || !after) return null;

    return { field: field as JournalFieldName, before, after, applied: candidate.applied };
}

function parseSkip(raw: unknown): JournalFieldSkip | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    const field = candidate.field;
    const reason = candidate.reason;
    if (typeof field !== 'string') return null;
    if (!(JOURNAL_FIELDS as readonly string[]).includes(field)) return null;
    if (reason !== 'author-value-present' && reason !== 'unsupported-value' && reason !== 'marker-not-written') {
        return null;
    }
    return { field: field as JournalFieldName, reason };
}

function parseAll<T>(raw: unknown, parse: (entry: unknown) => T | null): T[] | null {
    if (!Array.isArray(raw)) return null;
    const parsed = raw.map(parse);
    return parsed.some(entry => entry === null) ? null : (parsed as T[]);
}

function parseScene(raw: unknown): JournalSceneRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.path !== 'string') return null;

    const changes = parseAll(candidate.changes, parseChange);
    const skipped = parseAll(candidate.skipped, parseSkip);
    if (!changes || !skipped) return null;

    return { path: candidate.path, changes, skipped };
}

function parseCleanup(raw: unknown): JournalLayoutCleanupRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.layoutId !== 'string') return null;
    if (typeof candidate.applied !== 'boolean') return null;
    if (typeof candidate.accepted !== 'boolean') return null;

    const parseSide = (side: unknown) => {
        if (!side || typeof side !== 'object') return null;
        const sideCandidate = side as Record<string, unknown>;
        const actEpigraphs = parseListSnapshot(sideCandidate.actEpigraphs);
        const actEpigraphAttributions = parseListSnapshot(sideCandidate.actEpigraphAttributions);
        if (!actEpigraphs || !actEpigraphAttributions) return null;
        return { actEpigraphs, actEpigraphAttributions };
    };

    const before = parseSide(candidate.before);
    const after = parseSide(candidate.after);
    if (!before || !after) return null;

    return {
        layoutId: candidate.layoutId,
        before,
        after,
        applied: candidate.applied,
        accepted: candidate.accepted,
    };
}

function parseBook(raw: unknown): JournalBookRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    const bookId = candidate.bookId;
    const status = candidate.status;
    const planFingerprint = candidate.planFingerprint;
    if (typeof bookId !== 'string' || typeof planFingerprint !== 'string') return null;
    if (status !== 'planned' && status !== 'applied' && status !== 'blocked' && status !== 'skipped') {
        return null;
    }

    const preExistingMarkerPaths = parseAll(
        candidate.preExistingMarkerPaths,
        entry => (typeof entry === 'string' ? entry : null)
    );
    const scenes = parseAll(candidate.scenes, parseScene);
    const epigraphCleanups = parseAll(candidate.epigraphCleanups, parseCleanup);
    if (!preExistingMarkerPaths || !scenes || !epigraphCleanups) return null;

    return { bookId, status, planFingerprint, preExistingMarkerPaths, scenes, epigraphCleanups };
}

/**
 * Parse a journal read back from the vault.
 *
 * Returns null for anything not recognisably this schema. A journal that cannot
 * be trusted must not be partially believed: half a journal is worse than none,
 * because it would license resuming writes whose before-values are unknown. The
 * executor's answer to null is to stop and ask, never to reclassify.
 */
export function parseJournal(raw: unknown): PartMigrationJournal | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as Record<string, unknown>;
    if (candidate.schema !== PART_MIGRATION_JOURNAL_SCHEMA) return null;
    if (typeof candidate.startedAt !== 'string') return null;

    const books = parseAll(candidate.books, parseBook);
    if (!books) return null;

    return { schema: PART_MIGRATION_JOURNAL_SCHEMA, startedAt: candidate.startedAt, books };
}

export function serializeJournal(journal: PartMigrationJournal): string {
    return JSON.stringify(journal, null, 2);
}
