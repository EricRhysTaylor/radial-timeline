import type { BookMigrationPlan, EpigraphSource } from './partMarkers';
import {
    JOURNAL_FIELDS,
    LIST_ABSENT,
    listSnapshotsEqual,
    snapshotList,
    snapshotsEqual,
    type JournalBookRecord,
    type JournalFieldName,
    type JournalListSnapshot,
    type JournalSnapshot,
    type SkipReason,
} from './partMarkersJournal';

/**
 * The resolved, executable manifest for one book — the complete authority for
 * every mutation the migration may perform.
 *
 * A plan says what *should* happen; a manifest says exactly what will be
 * touched, down to the value. Anything the manifest does not name, the executor
 * must not do, and anything it names must appear in the journal exactly once.
 *
 * Authority has to reach values, not just targets. Naming only the layouts to
 * clean left the journal free to carry arbitrary before/after snapshots for an
 * expected layout, which the executor would then dutifully apply and verify.
 */

export interface ManifestFieldTarget {
    field: JournalFieldName;
    after: JournalSnapshot;
    /** Skip reasons that may legitimately stand in for this write. */
    allowedSkips: SkipReason[];
}

export interface ManifestSceneTarget {
    path: string;
    fields: ManifestFieldTarget[];
    /**
     * Structural numbering for a derived boundary.
     *
     * Carried into the fingerprint even though it is not written to any field:
     * two plans placing the same values on the same scenes under different part
     * numbers are different plans, and resuming across that difference would
     * renumber a book. Absent for author-placed markers, whose numbering is the
     * author's.
     */
    partNumber?: number;
    actNumber?: number;
}

export interface ManifestListPair {
    actEpigraphs: JournalListSnapshot;
    actEpigraphAttributions: JournalListSnapshot;
}

export interface ManifestCleanupTarget {
    layoutId: string;
    /** Exactly what must still be in storage for the clear to be authorized. */
    before: ManifestListPair;
    /** Exactly what must remain afterwards — both arrays absent. */
    after: ManifestListPair;
}

export interface ExecutableManifest {
    bookId: string;
    scenes: ManifestSceneTarget[];
    cleanups: ManifestCleanupTarget[];
}

/** An author-confirmed placement for a book whose markers they wrote themselves. */
export interface AcceptedEpigraph {
    /** The proposal entry this answers. */
    actNumber: number;
    /** Destination scene — must be one of the book's existing markers. */
    path: string;
    quote?: string;
    attribution?: string;
}

export interface BuildManifestOptions {
    /**
     * Author decisions about the proposed epigraph placements. Every proposal
     * entry must be answered — accepted with a destination, or listed in
     * `discardedActNumbers`. An unanswered entry leaves cleanup unauthorized,
     * because clearing storage would delete text nobody decided about.
     */
    acceptedEpigraphs?: AcceptedEpigraph[];
    /** Proposal entries the author chose not to migrate, knowing they will be lost. */
    discardedActNumbers?: number[];
}

export type ManifestRefusal =
    /** The plan describes no migration at all. */
    | { reason: 'not-executable'; detail: string }
    /** The author's decisions do not answer the proposal one-to-one. */
    | { reason: 'acceptance-incomplete'; detail: string };

const EPIGRAPH_SKIPS: SkipReason[] = [
    'author-value-present',
    'unsupported-value',
    'marker-not-written',
];

/**
 * Skips the marker itself may legitimately carry.
 *
 * Never `author-value-present`: the marker is the migration's own structure, so
 * "the author already wrote something here" is not a reason to leave it — and
 * accepting it would let a markerless book satisfy validation and stamp applied.
 */
const MARKER_SKIPS: SkipReason[] = ['unsupported-value'];

function epigraphFieldTargets(entry: { quote?: string; attribution?: string }): ManifestFieldTarget[] {
    const fields: ManifestFieldTarget[] = [];
    if (entry.quote !== undefined) {
        fields.push({
            field: 'Part Epigraph',
            after: { kind: 'string', value: entry.quote },
            allowedSkips: EPIGRAPH_SKIPS,
        });
    }
    if (entry.attribution !== undefined) {
        fields.push({
            field: 'Part Epigraph By',
            after: { kind: 'string', value: entry.attribution },
            allowedSkips: EPIGRAPH_SKIPS,
        });
    }
    return fields;
}

/** Act numbers whose stored slot holds text — the slots cleanup would destroy. */
function populatedSlots(sources: EpigraphSource[]): number[] {
    const slots = new Set<number>();
    for (const source of sources) {
        const length = Math.max(source.quotes.length, source.attributions.length);
        for (let index = 0; index < length; index++) {
            const quote = source.quotes[index]?.trim() ?? '';
            const attribution = source.attributions[index]?.trim() ?? '';
            if (quote || attribution) slots.add(index + 1);
        }
    }
    return [...slots].sort((a, b) => a - b);
}

function cleanupTargets(sources: EpigraphSource[]): ManifestCleanupTarget[] {
    return [...sources]
        .sort((a, b) => a.layoutId.localeCompare(b.layoutId))
        .map(source => ({
            layoutId: source.layoutId,
            before: {
                // An empty array is not a stored value: normalizeBookProfile
                // drops the key entirely, so absent is what the vault holds.
                actEpigraphs: snapshotList(source.quotes.length > 0 ? source.quotes : undefined),
                actEpigraphAttributions: snapshotList(
                    source.attributions.length > 0 ? source.attributions : undefined
                ),
            },
            // Cleanup removes the arrays outright. Unrelated settings on the same
            // layout are not represented here and must be left untouched.
            after: { actEpigraphs: LIST_ABSENT, actEpigraphAttributions: LIST_ABSENT },
        }));
}

/**
 * Resolve a plan and the author's decisions into the work that may be performed.
 *
 * Returns a refusal rather than an empty manifest when the inputs do not
 * authorize anything, so a caller cannot mistake "nothing was agreed" for
 * "nothing to do".
 */
export function buildManifest(
    plan: BookMigrationPlan,
    options: BuildManifestOptions = {}
): ExecutableManifest | ManifestRefusal {
    if (plan.status === 'noop' || plan.status === 'blocked') {
        return {
            reason: 'not-executable',
            detail: `This book is "${plan.status}", so there is no migration to perform.`,
        };
    }

    if (plan.status === 'derive') {
        const scenes = plan.writes.map(write => ({
            path: write.path,
            partNumber: write.partNumber,
            actNumber: write.actNumber,
            fields: [
                {
                    field: 'Part' as const,
                    after: typeof write.title === 'string'
                        ? { kind: 'string' as const, value: write.title }
                        : { kind: 'boolean' as const, value: true },
                    allowedSkips: MARKER_SKIPS,
                },
                ...epigraphFieldTargets(write),
            ],
        }));

        // Cleanup deletes whole arrays, so every populated slot must have been
        // migrated onto some scene first. A slot with no matching boundary —
        // an epigraph for an act the book no longer has — would otherwise be
        // silently destroyed by a cleanup the author approved for other reasons.
        const migratedSlots = new Set(
            plan.writes
                .filter(write => write.quote !== undefined || write.attribution !== undefined)
                .map(write => write.actNumber)
        );
        const discarded = new Set(options.discardedActNumbers ?? []);
        const stranded = populatedSlots(plan.epigraphSources)
            .filter(slot => !migratedSlots.has(slot) && !discarded.has(slot));

        return {
            bookId: plan.bookId,
            scenes,
            cleanups: stranded.length === 0 ? cleanupTargets(plan.epigraphSources) : [],
        };
    }

    // ── author-owned ───────────────────────────────────────────────────
    const proposal = plan.epigraphProposal;
    const accepted = options.acceptedEpigraphs ?? [];
    const discarded = new Set(options.discardedActNumbers ?? []);

    if (!proposal) {
        // Nothing was proposed, so nothing may be written or cleared.
        return { bookId: plan.bookId, scenes: [], cleanups: [] };
    }

    const markerPaths = new Set(plan.markerPaths);
    const answeredActs = new Set<number>();

    for (const entry of accepted) {
        if (discarded.has(entry.actNumber)) {
            return {
                reason: 'acceptance-incomplete',
                detail: `Act ${entry.actNumber} is both accepted and discarded.`,
            };
        }
        if (answeredActs.has(entry.actNumber)) {
            return {
                reason: 'acceptance-incomplete',
                detail: `Act ${entry.actNumber} was accepted more than once.`,
            };
        }
        if (!markerPaths.has(entry.path)) {
            // Without this an accepted placement could write an epigraph onto a
            // scene carrying no Part marker at all.
            return {
                reason: 'acceptance-incomplete',
                detail: `${entry.path} carries no Part marker, so an epigraph cannot be placed there.`,
            };
        }
        if (entry.quote === undefined && entry.attribution === undefined) {
            return {
                reason: 'acceptance-incomplete',
                detail: `The placement for act ${entry.actNumber} carries no text.`,
            };
        }
        answeredActs.add(entry.actNumber);
    }

    const unanswered = proposal.entries
        .map(entry => entry.actNumber)
        .filter(actNumber => !answeredActs.has(actNumber) && !discarded.has(actNumber));

    if (unanswered.length > 0) {
        // Cleanup would delete every stored epigraph, including these. Partial
        // acceptance must not authorize that.
        return {
            reason: 'acceptance-incomplete',
            detail: `${unanswered.length} proposed epigraph(s) have not been accepted or `
                + `discarded (act ${unanswered.slice(0, 3).join(', ')}). `
                + 'Cleanup would delete them.',
        };
    }

    const byPath = new Map<string, AcceptedEpigraph[]>();
    for (const entry of accepted) {
        byPath.set(entry.path, [...(byPath.get(entry.path) ?? []), entry]);
    }

    for (const [path, entries] of byPath) {
        if (entries.length > 1) {
            return {
                reason: 'acceptance-incomplete',
                detail: `${path} was given ${entries.length} epigraphs; a scene opens one part.`,
            };
        }
    }

    return {
        bookId: plan.bookId,
        scenes: [...byPath.entries()]
            .map(([path, entries]) => ({ path, fields: epigraphFieldTargets(entries[0]) }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        // Every proposal entry is now answered, so clearing storage destroys
        // nothing undecided.
        cleanups: cleanupTargets(plan.epigraphSources),
    };
}

export function isManifest(
    result: ExecutableManifest | ManifestRefusal
): result is ExecutableManifest {
    return !('reason' in result);
}

/** Deterministic fingerprint of everything the manifest will touch. */
export function fingerprintManifest(manifest: ExecutableManifest): string {
    const scenes = manifest.scenes
        .map(scene => JSON.stringify([
            scene.path,
            scene.partNumber ?? null,
            scene.actNumber ?? null,
            [...scene.fields]
                .sort((a, b) => a.field.localeCompare(b.field))
                .map(target => [target.field, target.after]),
        ]))
        .sort();

    const cleanups = manifest.cleanups
        .map(target => JSON.stringify([target.layoutId, target.before, target.after]))
        .sort();

    return `manifest:${manifest.bookId}:${scenes.join('|')}::${cleanups.join('|')}`;
}

function duplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) repeated.add(value);
        seen.add(value);
    }
    return [...repeated];
}

function summarize(values: string[]): string {
    return `${values.slice(0, 3).join(', ')}${values.length > 3 ? ', …' : ''}`;
}

/**
 * Match a journal's records one-to-one against the manifest.
 *
 * Every manifest field must be accounted for by exactly one change or exactly
 * one **permitted** skip. Accepting any skip regardless of reason let a `Part`
 * marked `author-value-present` satisfy validation, count as non-blocking, and
 * carry a markerless book through to `applied`.
 *
 * Cleanup records are matched on their values, not just their layout, because
 * the executor applies and verifies whatever snapshots the record carries.
 *
 * Returns a description of the mismatch, or null when the records agree.
 */
export function findManifestJournalMismatch(
    bookRecord: JournalBookRecord,
    manifest: ExecutableManifest
): string | null {
    const repeatedPaths = duplicates(bookRecord.scenes.map(scene => scene.path));
    if (repeatedPaths.length > 0) {
        return `The journal holds more than one record for ${summarize(repeatedPaths)}.`;
    }

    const repeatedLayouts = duplicates(bookRecord.epigraphCleanups.map(entry => entry.layoutId));
    if (repeatedLayouts.length > 0) {
        return `The journal holds more than one cleanup record for ${summarize(repeatedLayouts)}.`;
    }

    const targetByPath = new Map(manifest.scenes.map(scene => [scene.path, scene]));
    const recordByPath = new Map(bookRecord.scenes.map(scene => [scene.path, scene]));

    const missing = manifest.scenes
        .filter(scene => !recordByPath.has(scene.path))
        .map(scene => scene.path);
    if (missing.length > 0) {
        return `The journal has no record for ${missing.length} planned scene(s): ${summarize(missing)}.`;
    }

    const extra = bookRecord.scenes
        .filter(scene => !targetByPath.has(scene.path))
        .map(scene => scene.path);
    if (extra.length > 0) {
        return `The journal holds records the plan does not call for: ${summarize(extra)}.`;
    }

    for (const target of manifest.scenes) {
        const record = recordByPath.get(target.path);
        if (!record) continue;

        const repeatedChanges = duplicates(record.changes.map(change => change.field));
        if (repeatedChanges.length > 0) {
            return `${target.path}: more than one change recorded for ${summarize(repeatedChanges)}.`;
        }
        const repeatedSkips = duplicates(record.skipped.map(skip => skip.field));
        if (repeatedSkips.length > 0) {
            return `${target.path}: more than one skip recorded for ${summarize(repeatedSkips)}.`;
        }

        const targetByField = new Map(target.fields.map(field => [field.field, field]));

        for (const field of JOURNAL_FIELDS) {
            const change = record.changes.find(entry => entry.field === field);
            const skip = record.skipped.find(entry => entry.field === field);
            const expected = targetByField.get(field);

            if (!expected) {
                if (change) {
                    return `${target.path}: the journal writes ${field}, which the plan does not call for.`;
                }
                continue;
            }

            if (change && skip) {
                return `${target.path}: ${field} is recorded as both written and skipped.`;
            }
            if (!change && !skip) {
                return `${target.path}: the plan writes ${field}, but the journal records `
                    + 'neither a change nor a skip for it.';
            }
            if (change && !snapshotsEqual(change.after, expected.after)) {
                return `${target.path}: the journal's target for ${field} is not the value `
                    + 'the plan calls for.';
            }
            if (skip && !expected.allowedSkips.includes(skip.reason)) {
                return `${target.path}: ${field} is skipped as "${skip.reason}", which is not a `
                    + 'reason that field may be skipped for.';
            }
        }
    }

    const cleanupByLayout = new Map(manifest.cleanups.map(target => [target.layoutId, target]));
    const recordedByLayout = new Map(
        bookRecord.epigraphCleanups.map(record => [record.layoutId, record])
    );

    const missingLayouts = manifest.cleanups
        .filter(target => !recordedByLayout.has(target.layoutId))
        .map(target => target.layoutId);
    if (missingLayouts.length > 0) {
        return `The journal has no cleanup record for ${summarize(missingLayouts)}, so that `
            + 'storage would keep epigraphs the migration claims to have moved.';
    }

    const extraLayouts = bookRecord.epigraphCleanups
        .filter(record => !cleanupByLayout.has(record.layoutId))
        .map(record => record.layoutId);
    if (extraLayouts.length > 0) {
        return `The journal holds cleanup records the plan does not call for: `
            + `${summarize(extraLayouts)}.`;
    }

    for (const target of manifest.cleanups) {
        const record = recordedByLayout.get(target.layoutId);
        if (!record) continue;
        const beforeMatches =
            listSnapshotsEqual(record.before.actEpigraphs, target.before.actEpigraphs)
            && listSnapshotsEqual(
                record.before.actEpigraphAttributions,
                target.before.actEpigraphAttributions
            );
        const afterMatches =
            listSnapshotsEqual(record.after.actEpigraphs, target.after.actEpigraphs)
            && listSnapshotsEqual(
                record.after.actEpigraphAttributions,
                target.after.actEpigraphAttributions
            );
        if (!beforeMatches) {
            return `${target.layoutId}: the journal's recorded prior storage is not what the `
                + 'plan resolved, so it would verify against the wrong values.';
        }
        if (!afterMatches) {
            return `${target.layoutId}: the journal would leave storage in a state the plan `
                + 'does not call for.';
        }
    }

    return null;
}
