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
 * The hazard this exists for: presence is not provenance. A crashed run leaves
 * markers that look exactly like a book the author marked up by hand. Without
 * the journal the next run classifies that book as author-owned, skips
 * derivation, and freezes a half-migrated book into a structure that looks
 * deliberate.
 *
 * This module is pure — shape, serialization, and recovery arithmetic. Reading
 * and writing the sidecar belongs to the executor.
 */

/** Bumped from 1 when snapshots replaced bare scalars; no v1 journal ever shipped. */
export const PART_MIGRATION_JOURNAL_SCHEMA = 2;

export const JOURNAL_FIELDS = [
    SHARED_PART_FIELD_KEY,
    SHARED_PART_EPIGRAPH_FIELD_KEY,
    SHARED_PART_EPIGRAPH_BY_FIELD_KEY,
] as const;

export type JournalFieldName = typeof JOURNAL_FIELDS[number];

/**
 * A faithful snapshot of one frontmatter field.
 *
 * A bare `string | boolean | null` cannot represent what YAML actually permits.
 * Three distinctions matter and all three were previously lost:
 *
 *   - **absent vs null-valued.** `Part:` with no value parses to null; no `Part:`
 *     key at all is a different state. Clearing a marker deletes the key (D1),
 *     so restore has to tell "remove this" from "blank this".
 *   - **numbers.** `Part: 1` is not a marker, but it is author data, and
 *     flattening it to a string would restore the wrong YAML type.
 *   - **lists and maps.** These cannot round-trip through a scalar at all.
 *     Rather than lose them they are recorded as `unsupported`, and the
 *     migration refuses to touch that field — a field it cannot faithfully
 *     restore is a field it has no business writing.
 */
export type JournalSnapshot =
    | { kind: 'absent' }
    | { kind: 'null' }
    | { kind: 'string'; value: string }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'number'; value: number }
    | { kind: 'unsupported'; typeName: string };

export const ABSENT: JournalSnapshot = { kind: 'absent' };

/** Snapshot a raw frontmatter value. `hasKey` separates absent from null-valued. */
export function snapshotValue(raw: unknown, hasKey: boolean): JournalSnapshot {
    if (!hasKey) return { kind: 'absent' };
    if (raw === null || raw === undefined) return { kind: 'null' };
    if (typeof raw === 'string') return { kind: 'string', value: raw };
    if (typeof raw === 'boolean') return { kind: 'boolean', value: raw };
    if (typeof raw === 'number' && Number.isFinite(raw)) return { kind: 'number', value: raw };
    return { kind: 'unsupported', typeName: Array.isArray(raw) ? 'list' : typeof raw };
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

/** True when a snapshot holds author-authored text the migration must not displace. */
function holdsAuthorText(snapshot: JournalSnapshot): boolean {
    return snapshot.kind === 'string' && snapshot.value.trim().length > 0;
}

export interface JournalFieldChange {
    field: JournalFieldName;
    before: JournalSnapshot;
    after: JournalSnapshot;
}

export type SkipReason =
    /** The scene already carries author text here; the migration defers to it. */
    | 'author-value-present'
    /** The current value cannot be faithfully snapshotted, so it must not be touched. */
    | 'unsupported-value';

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

export type JournalBookStatus = 'planned' | 'applied' | 'blocked' | 'skipped';

export interface JournalBookRecord {
    bookId: string;
    status: JournalBookStatus;
    /**
     * Fingerprint of the plan this record was written for.
     *
     * Agreement is a **precondition** for resuming, not proof that resuming is
     * safe: it covers what the plan intends to write, not the state it was
     * computed against. An author who edits a scene's epigraph without touching
     * any `Act:` produces an identical fingerprint. Per-field three-way
     * comparison remains the authority on whether any individual write may
     * proceed.
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
 * Order-independent, so an unrelated reordering upstream does not read as
 * drift. Sensitive to path, target value, epigraph text, **and the structural
 * numbering** — two plans that write the same values to the same scenes but
 * assign different part numbers are different plans, and resuming across that
 * difference would renumber a book.
 *
 * Each write is JSON-encoded before joining so no separator can collide with a
 * path, title, or epigraph containing the same character.
 */
export function fingerprintPlan(plan: BookMigrationPlan): string {
    if (plan.status !== 'derive') return `${plan.status}:${plan.bookId}`;

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

/**
 * Field changes a planned write implies, given faithful snapshots of the
 * scene's current values.
 *
 * The migration **adds structure; it never removes author content.** Two rules
 * follow, and both were previously violated:
 *
 *   - A field the migration has no value for is left completely alone. Writing
 *     `null` there would have *deleted* an epigraph the author wrote by hand,
 *     simply because this book's layout options happened to carry nothing for
 *     that act.
 *   - A field already holding author text is not overwritten. The migration is
 *     moving epigraphs out of layout options, not outranking text that is
 *     already on the scene.
 *
 * A field whose current value cannot be snapshotted is skipped for the same
 * reason: it cannot be restored, so it must not be written.
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

    const changes: JournalFieldChange[] = [];
    const skipped: JournalFieldSkip[] = [];

    for (const field of JOURNAL_FIELDS) {
        const target = desired[field];
        const current = before[field] ?? ABSENT;

        if (current.kind === 'unsupported') {
            skipped.push({ field, reason: 'unsupported-value' });
            continue;
        }

        // Nothing to write: leave the field exactly as found, whatever it holds.
        if (target === null) continue;

        // The marker itself is the migration's own structure. Epigraph fields
        // belong to the author, so existing text wins.
        if (field !== SHARED_PART_FIELD_KEY && holdsAuthorText(current)) {
            skipped.push({ field, reason: 'author-value-present' });
            continue;
        }

        if (snapshotsEqual(current, target)) continue;

        changes.push({ field, before: current, after: target });
    }

    return { changes, skipped };
}

export type FieldRecoveryVerdict =
    /**
     * On disk already matches the intended value, so applying the write would
     * be a no-op. **Not** a claim that the migration put it there — the author
     * could have typed the same thing. Endpoint equality is not provenance;
     * this states only that nothing needs doing.
     */
    | 'matches-target'
    /** On disk still matches the recorded prior value: the write has not landed. */
    | 'matches-origin'
    /** On disk matches neither endpoint: the field was edited by someone else. */
    | 'diverged'
    /**
     * The recorded endpoints are identical, so the observation cannot
     * distinguish them. Degenerate by construction — `changesForWrite` never
     * emits such a change — but a hand-edited journal can contain one.
     */
    | 'indeterminate';

/**
 * Three-way comparison for one field: journal-before, journal-after, disk-now.
 *
 * Two values are not enough. Knowing only the intended value cannot distinguish
 * "the write landed" from "the author happened to type the same thing"; knowing
 * only the prior value cannot distinguish "not yet written" from "written and
 * then reverted". The third point resolves what is *actionable* — whether the
 * write still needs doing — which is all the executor requires. It does not
 * establish causation, and the verdict names say so.
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

export type SceneRecoveryVerdict = FieldRecoveryVerdict | 'partial';

/**
 * Roll a scene's fields up into one verdict.
 *
 * Divergence and indeterminacy dominate: a scene whose journalled fields were
 * edited, or whose record cannot be reasoned about, must not be resumed or
 * restored whatever its other fields say.
 *
 * A record with no changes means the migration planned nothing for this scene.
 * That is only trustworthy because a scene whose changes failed to parse is
 * rejected outright rather than arriving here looking empty (see `parseJournal`).
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

// ─── Parsing ────────────────────────────────────────────────────────────
//
// Fail closed at every level. A malformed change invalidates its scene, a
// malformed scene invalidates its book, and a malformed book invalidates the
// journal. Tolerating a bad record and carrying on would leave a scene looking
// like it had nothing planned — which `classifySceneRecovery` reads as "nothing
// to do", silently reporting a half-migrated book as complete.

function parseSnapshot(raw: unknown): JournalSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;

    switch (candidate.kind) {
        case 'absent':
        case 'null':
            return { kind: candidate.kind };
        case 'string':
            return typeof candidate.value === 'string'
                ? { kind: 'string', value: candidate.value }
                : null;
        case 'boolean':
            return typeof candidate.value === 'boolean'
                ? { kind: 'boolean', value: candidate.value }
                : null;
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

function parseChange(raw: unknown): JournalFieldChange | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    const field = candidate.field;
    if (typeof field !== 'string') return null;
    if (!(JOURNAL_FIELDS as readonly string[]).includes(field)) return null;

    const before = parseSnapshot(candidate.before);
    const after = parseSnapshot(candidate.after);
    if (!before || !after) return null;

    return { field: field as JournalFieldName, before, after };
}

function parseSkip(raw: unknown): JournalFieldSkip | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    const field = candidate.field;
    const reason = candidate.reason;
    if (typeof field !== 'string') return null;
    if (!(JOURNAL_FIELDS as readonly string[]).includes(field)) return null;
    if (reason !== 'author-value-present' && reason !== 'unsupported-value') return null;
    return { field: field as JournalFieldName, reason };
}

function parseScene(raw: unknown): JournalSceneRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.path !== 'string') return null;

    if (candidate.changes !== undefined && !Array.isArray(candidate.changes)) return null;
    const rawChanges = Array.isArray(candidate.changes) ? candidate.changes : [];
    const changes = rawChanges.map(parseChange);
    if (changes.some(change => change === null)) return null;

    if (candidate.skipped !== undefined && !Array.isArray(candidate.skipped)) return null;
    const rawSkips = Array.isArray(candidate.skipped) ? candidate.skipped : [];
    const skipped = rawSkips.map(parseSkip);
    if (skipped.some(skip => skip === null)) return null;

    return {
        path: candidate.path,
        changes: changes as JournalFieldChange[],
        skipped: skipped as JournalFieldSkip[],
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

    if (candidate.preExistingMarkerPaths !== undefined && !Array.isArray(candidate.preExistingMarkerPaths)) {
        return null;
    }
    const rawPaths = Array.isArray(candidate.preExistingMarkerPaths) ? candidate.preExistingMarkerPaths : [];
    if (rawPaths.some(entry => typeof entry !== 'string')) return null;

    if (candidate.scenes !== undefined && !Array.isArray(candidate.scenes)) return null;
    const rawScenes = Array.isArray(candidate.scenes) ? candidate.scenes : [];
    const scenes = rawScenes.map(parseScene);
    if (scenes.some(scene => scene === null)) return null;

    return {
        bookId,
        status,
        planFingerprint,
        preExistingMarkerPaths: rawPaths as string[],
        scenes: scenes as JournalSceneRecord[],
    };
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
