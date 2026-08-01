import type { BookMigrationPlan } from './partMarkers';
import {
    JOURNAL_FIELDS,
    snapshotsEqual,
    type JournalBookRecord,
    type JournalFieldName,
    type JournalSnapshot,
} from './partMarkersJournal';

/**
 * The resolved, executable manifest for one book.
 *
 * A plan says what *should* happen; a manifest says exactly what will be
 * touched. The distinction matters because the plan alone is not enough
 * authority to validate a journal:
 *
 *   - It enumerates no cleanup targets, so any set of cleanup records looked
 *     acceptable and stray ones would have been executed.
 *   - An author-owned book's epigraph writes exist only once the author accepts
 *     a mapping, so validating against the plan rejected legitimate work as
 *     "a non-derive plan that writes nothing".
 *
 * The manifest resolves both: every scene field target and every cleanup target,
 * in one object, fingerprinted and matched one-to-one against the journal before
 * any I/O.
 */

export interface ManifestFieldTarget {
    field: JournalFieldName;
    after: JournalSnapshot;
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

export interface ExecutableManifest {
    bookId: string;
    scenes: ManifestSceneTarget[];
    /** Every legacy storage location this migration will clear. */
    cleanupLayoutIds: string[];
}

/** An author-accepted epigraph placement for a book whose markers they wrote. */
export interface AcceptedEpigraph {
    path: string;
    quote?: string;
    attribution?: string;
}

export interface BuildManifestOptions {
    /**
     * Required before an author-owned book has anything to execute. The stored
     * act index has no reliable correspondence to an author-placed marker, so
     * the mapping is the author's to confirm — never inferred.
     */
    acceptedEpigraphs?: AcceptedEpigraph[];
}

function epigraphFields(entry: { quote?: string; attribution?: string }): ManifestFieldTarget[] {
    const fields: ManifestFieldTarget[] = [];
    if (entry.quote !== undefined) {
        fields.push({ field: 'Part Epigraph', after: { kind: 'string', value: entry.quote } });
    }
    if (entry.attribution !== undefined) {
        fields.push({ field: 'Part Epigraph By', after: { kind: 'string', value: entry.attribution } });
    }
    return fields;
}

/**
 * Resolve a plan into the work that may actually be performed.
 *
 * Returns null for plans that are not executable at all — a blocked book has
 * nothing to do, and a noop book has nothing to do by definition. Callers treat
 * null as "there is no migration here", which is different from "the migration
 * is empty".
 */
export function buildManifest(
    plan: BookMigrationPlan,
    options: BuildManifestOptions = {}
): ExecutableManifest | null {
    switch (plan.status) {
        case 'derive':
            return {
                bookId: plan.bookId,
                scenes: plan.writes.map(write => ({
                    path: write.path,
                    partNumber: write.partNumber,
                    actNumber: write.actNumber,
                    fields: [
                        {
                            field: 'Part' as const,
                            after: typeof write.title === 'string'
                                ? { kind: 'string' as const, value: write.title }
                                : { kind: 'boolean' as const, value: true },
                        },
                        ...epigraphFields(write),
                    ],
                })),
                cleanupLayoutIds: [...plan.epigraphSourceLayoutIds].sort(),
            };

        case 'author-owned': {
            const accepted = options.acceptedEpigraphs ?? [];
            return {
                bookId: plan.bookId,
                // The author already wrote the markers; the migration only ever
                // places the epigraphs they accepted.
                scenes: accepted
                    .map(entry => ({ path: entry.path, fields: epigraphFields(entry) }))
                    .filter(scene => scene.fields.length > 0),
                // Nothing may be cleared until an accepted placement exists —
                // otherwise the stored copy is the only surviving one.
                cleanupLayoutIds: accepted.length > 0
                    ? [...plan.epigraphSourceLayoutIds].sort()
                    : [],
            };
        }

        case 'noop':
        case 'blocked':
            return null;
    }
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

    return `manifest:${manifest.bookId}:${scenes.join('|')}::${manifest.cleanupLayoutIds.join(',')}`;
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
 * Every manifest field must be accounted for by **exactly one** change or
 * **exactly one** skip. Validating only the changes that happen to exist let a
 * planned epigraph vanish from the journal entirely: the book still looked
 * consistent, cleanup then cleared the legacy copy, and the epigraph existed
 * nowhere.
 *
 * Duplicates are rejected outright. Two records for one path, or two changes for
 * one field, make "what is planned here" unanswerable, and an executor cannot
 * safely act on a question it cannot answer.
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

        const plannedFields = new Set(target.fields.map(field => field.field));

        for (const field of JOURNAL_FIELDS) {
            const change = record.changes.find(entry => entry.field === field);
            const skip = record.skipped.find(entry => entry.field === field);

            if (!plannedFields.has(field)) {
                if (change) {
                    return `${target.path}: the journal writes ${field}, which the plan does not call for.`;
                }
                continue;
            }

            if (change && skip) {
                return `${target.path}: ${field} is recorded as both written and skipped.`;
            }
            if (!change && !skip) {
                // The silent-disappearance case. Without this the field is simply
                // gone, and cleanup would clear the last copy of its text.
                return `${target.path}: the plan writes ${field}, but the journal records `
                    + 'neither a change nor a skip for it.';
            }
            if (change) {
                const expected = target.fields.find(entry => entry.field === field);
                if (expected && !snapshotsEqual(change.after, expected.after)) {
                    return `${target.path}: the journal's target for ${field} is not the value `
                        + 'the plan calls for.';
                }
            }
        }
    }

    const expectedLayouts = new Set(manifest.cleanupLayoutIds);
    const recordedLayouts = new Set(bookRecord.epigraphCleanups.map(entry => entry.layoutId));

    const missingLayouts = manifest.cleanupLayoutIds.filter(id => !recordedLayouts.has(id));
    if (missingLayouts.length > 0) {
        return `The journal has no cleanup record for ${summarize(missingLayouts)}, so that `
            + 'storage would keep epigraphs the migration claims to have moved.';
    }

    const extraLayouts = [...recordedLayouts].filter(id => !expectedLayouts.has(id));
    if (extraLayouts.length > 0) {
        return `The journal holds cleanup records the plan does not call for: `
            + `${summarize(extraLayouts)}.`;
    }

    return null;
}
