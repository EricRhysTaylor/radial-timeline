import { SHARED_PART_EPIGRAPH_BY_FIELD_KEY, SHARED_PART_EPIGRAPH_FIELD_KEY, SHARED_PART_FIELD_KEY } from '../utils/timelineParts';
import type { BookMigrationPlan, PartMarkerWrite } from './partMarkers';

/**
 * Migration journal for the Act-derived → explicit Part marker cutover.
 *
 * A vault-local sidecar recording the preflight plan and, for every field the
 * migration intends to touch, its exact value before and after. Written before
 * any scene is mutated, so every marker the migration later writes is
 * attributable to it.
 *
 * **No provenance field goes into scene YAML.** Provenance is operational state
 * and scene frontmatter stays author-only; the journal is the sidecar that
 * carries it (see `rt-scene-yaml-author-only` and plan §5.4).
 *
 * The hazard this exists for: presence is not provenance. A crashed run leaves
 * markers that look exactly like a book the author marked up by hand. Without
 * the journal the next run classifies that book as author-owned, skips
 * derivation, and freezes a half-migrated book into a structure that looks
 * deliberate.
 *
 * This module is pure — shape, serialization, and recovery arithmetic. Reading
 * and writing the sidecar belongs to the executor.
 */

export const PART_MIGRATION_JOURNAL_SCHEMA = 1;

export const JOURNAL_FIELDS = [
    SHARED_PART_FIELD_KEY,
    SHARED_PART_EPIGRAPH_FIELD_KEY,
    SHARED_PART_EPIGRAPH_BY_FIELD_KEY,
] as const;

export type JournalFieldName = typeof JOURNAL_FIELDS[number];

/**
 * A frontmatter value as the journal stores it.
 *
 * `null` means *the key was absent*, which is distinct from an empty string.
 * Clearing a marker deletes the key (D1), so the two are different end states
 * and collapsing them would make restore unable to tell "remove this" from
 * "blank this".
 */
export type JournalValue = string | boolean | null;

export interface JournalFieldChange {
    field: JournalFieldName;
    before: JournalValue;
    after: JournalValue;
}

export interface JournalSceneRecord {
    path: string;
    changes: JournalFieldChange[];
}

export type JournalBookStatus = 'planned' | 'applied' | 'blocked' | 'skipped';

export interface JournalBookRecord {
    bookId: string;
    status: JournalBookStatus;
    /**
     * Fingerprint of the plan this record was written for. Compared against a
     * freshly computed plan on resume: disagreement means the vault changed
     * under the migration, and resuming would apply half of one plan and half
     * of another.
     */
    planFingerprint: string;
    /**
     * Paths that already carried a Part marker at preflight — author structure,
     * never the migration's own output. Recorded before any write, because
     * afterwards the two are indistinguishable on disk.
     */
    preExistingMarkerPaths: string[];
    scenes: JournalSceneRecord[];
}

export interface PartMigrationJournal {
    schema: number;
    startedAt: string;
    books: JournalBookRecord[];
}

/**
 * A stable fingerprint of what a plan intends to do.
 *
 * Deterministic and order-independent so an unrelated reordering upstream does
 * not read as drift, but sensitive to any change in path, target value, or
 * epigraph text — the things that make a resumed write wrong.
 */
export function fingerprintPlan(plan: BookMigrationPlan): string {
    if (plan.status !== 'derive') return `${plan.status}:${plan.bookId}`;

    // Each write is JSON-encoded before joining so no separator can collide
    // with a path, title, or epigraph containing the same character. An earlier
    // version joined on control characters, which worked but put a NUL in the
    // source and made git treat this file as binary.
    const parts = plan.writes
        .map(write => JSON.stringify([
            write.path,
            write.title,
            write.quote ?? '',
            write.attribution ?? '',
        ]))
        .sort();

    return `derive:${plan.bookId}:${parts.join('|')}`;
}

/** Field changes a single planned write implies, given the scene's current values. */
export function changesForWrite(
    write: PartMarkerWrite,
    before: Partial<Record<JournalFieldName, JournalValue>>
): JournalFieldChange[] {
    const desired: Record<JournalFieldName, JournalValue> = {
        [SHARED_PART_FIELD_KEY]: write.title,
        [SHARED_PART_EPIGRAPH_FIELD_KEY]: write.quote ?? null,
        [SHARED_PART_EPIGRAPH_BY_FIELD_KEY]: write.attribution ?? null,
    };

    return JOURNAL_FIELDS
        .map(field => ({
            field,
            before: before[field] ?? null,
            after: desired[field],
        }))
        // A field the migration would leave exactly as it found it is not a
        // change, and recording it would invite a needless write.
        .filter(change => change.before !== change.after);
}

export type FieldRecoveryVerdict =
    /** On disk already matches what the migration meant to write. */
    | 'already-applied'
    /** On disk still matches what was there before — the write never landed. */
    | 'pending'
    /** On disk matches neither: someone edited this field. */
    | 'author-drift';

/**
 * Three-way comparison for one field: journal-before, journal-after, disk-now.
 *
 * Two values are not enough. Knowing only the intended value cannot distinguish
 * "the write landed" from "the author happened to type the same thing", and
 * knowing only the prior value cannot distinguish "not yet written" from
 * "written and then reverted by the author".
 */
export function classifyFieldRecovery(
    change: JournalFieldChange,
    current: JournalValue
): FieldRecoveryVerdict {
    if (current === change.after) return 'already-applied';
    if (current === change.before) return 'pending';
    return 'author-drift';
}

export type SceneRecoveryVerdict = FieldRecoveryVerdict | 'partial';

/**
 * Roll a scene's fields up into one verdict.
 *
 * Drift dominates: a scene where the author touched any journalled field cannot
 * be safely resumed or restored, whatever its other fields say.
 */
export function classifySceneRecovery(
    record: JournalSceneRecord,
    current: Partial<Record<JournalFieldName, JournalValue>>
): SceneRecoveryVerdict {
    if (record.changes.length === 0) return 'already-applied';

    const verdicts = record.changes.map(change =>
        classifyFieldRecovery(change, current[change.field] ?? null)
    );

    if (verdicts.includes('author-drift')) return 'author-drift';
    if (verdicts.every(verdict => verdict === 'already-applied')) return 'already-applied';
    if (verdicts.every(verdict => verdict === 'pending')) return 'pending';
    return 'partial';
}

/**
 * Paths whose Part marker this migration wrote or attempted to write.
 *
 * Feeds the planner's disown-set. Attempted counts as written: a run that
 * crashed mid-write may have landed the marker without recording success, and
 * the three-way check is what establishes the real state afterwards. Treating
 * only confirmed writes as ours would hand a crashed run's output back to the
 * planner as author intent — the exact failure the journal exists to prevent.
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

function isJournalValue(value: unknown): value is JournalValue {
    return value === null || typeof value === 'string' || typeof value === 'boolean';
}

function parseChange(raw: unknown): JournalFieldChange | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    const field = candidate.field;
    if (typeof field !== 'string') return null;
    if (!(JOURNAL_FIELDS as readonly string[]).includes(field)) return null;
    if (!isJournalValue(candidate.before) || !isJournalValue(candidate.after)) return null;
    return { field: field as JournalFieldName, before: candidate.before, after: candidate.after };
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

    const preExistingMarkerPaths = Array.isArray(candidate.preExistingMarkerPaths)
        ? candidate.preExistingMarkerPaths.filter((entry): entry is string => typeof entry === 'string')
        : [];

    const scenes: JournalSceneRecord[] = Array.isArray(candidate.scenes)
        ? candidate.scenes.flatMap(rawScene => {
            if (!rawScene || typeof rawScene !== 'object') return [];
            const sceneCandidate = rawScene as Record<string, unknown>;
            if (typeof sceneCandidate.path !== 'string') return [];
            const changes = Array.isArray(sceneCandidate.changes)
                ? sceneCandidate.changes.map(parseChange).filter((change): change is JournalFieldChange => change !== null)
                : [];
            return [{ path: sceneCandidate.path, changes }];
        })
        : [];

    return { bookId, status, planFingerprint, preExistingMarkerPaths, scenes };
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
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    if (candidate.schema !== PART_MIGRATION_JOURNAL_SCHEMA) return null;
    if (typeof candidate.startedAt !== 'string') return null;
    if (!Array.isArray(candidate.books)) return null;

    const books = candidate.books.map(parseBook);
    if (books.some(book => book === null)) return null;

    return {
        schema: PART_MIGRATION_JOURNAL_SCHEMA,
        startedAt: candidate.startedAt,
        books: books as JournalBookRecord[],
    };
}

export function serializeJournal(journal: PartMigrationJournal): string {
    return JSON.stringify(journal, null, 2);
}
