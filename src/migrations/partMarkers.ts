import { resolvePartMarkerValue } from '../utils/timelineParts';

/**
 * Planning core for the Act-derived → explicit Part marker migration.
 *
 * Pure: no vault access, no settings, no writes. It takes an already-ordered
 * list of scenes and decides what — if anything — may safely be written to a
 * book. The executor and the preview both consume its output; neither repeats
 * its reasoning.
 *
 * Scene order must be the order the exporter walks, which is the timeline's own
 * `sortScenes` order (see `assembleManuscript`). The planner does not sort:
 * duplicating that logic is exactly how a migration drifts from the pipeline it
 * is supposed to reproduce.
 *
 * See `docs/engineering/plans/parts-first-class-markers-implementation.md` §5.
 */

/** A scene as the planner sees it — frontmatter values uncoerced. */
export interface MigrationSceneInput {
    path: string;
    /** Raw `Act:` value. Numbers and numeric strings both occur in real vaults. */
    act: unknown;
    /** Raw `Part:` value, if the scene already carries one. */
    part?: unknown;
}

export interface StoredEpigraphs {
    quotes: string[];
    attributions: string[];
}

export interface BookMigrationInput {
    bookId: string;
    /** Ordered as the exporter walks them. */
    scenes: MigrationSceneInput[];
    /** Epigraph text as stored per layout id, indexed by act number - 1. */
    storedEpigraphs?: Record<string, StoredEpigraphs>;
    /**
     * Paths whose Part marker THIS migration wrote on an earlier, interrupted
     * run, per the journal. Markers on these paths are the migration's own
     * output and must not be read as author intent.
     *
     * Presence is not provenance: without this, a crashed run's partial output
     * looks exactly like a book the author marked up by hand, and the next run
     * would classify it as author-owned and skip derivation — freezing a
     * half-migrated book into a structure that looks deliberate.
     */
    migrationWrittenPaths?: ReadonlySet<string>;
}

export type BlockedReason =
    /** A scene carries no usable `Act:` value. */
    | 'act-missing'
    /** A boundary re-enters an act that already opened (1,2,1). */
    | 're-entrant-acts'
    /** Boundary acts are not 1..k — a gap (1,3) or a start above 1. */
    | 'non-sequential-acts'
    /** Two or more layouts store different epigraph text; which is canonical is unknowable. */
    | 'epigraph-conflict';

export interface BlockedScene {
    path: string;
    detail: string;
}

/** One Part marker the migration would write. */
export interface PartMarkerWrite {
    path: string;
    /** Act that opened at this boundary — also the printed numeral, pre-migration. */
    actNumber: number;
    /** 1-based position among markers — the numeral after migration. */
    partNumber: number;
    quote?: string;
    attribution?: string;
}

export type BookMigrationPlan =
    | { bookId: string; status: 'noop'; reason: 'no-scenes' | 'no-boundaries' }
    | { bookId: string; status: 'author-owned'; markerPaths: string[]; epigraphProposal: EpigraphProposal | null }
    | { bookId: string; status: 'derive'; writes: PartMarkerWrite[] }
    | { bookId: string; status: 'blocked'; reason: BlockedReason; scenes: BlockedScene[]; detail: string };

/**
 * Epigraphs the migration cannot place on its own.
 *
 * For an author-placed marker set, the stored act index has no reliable
 * correspondence to a marker, so this is surfaced for acceptance rather than
 * applied. Never guessed.
 */
export interface EpigraphProposal {
    layoutId: string;
    entries: Array<{ actNumber: number; quote?: string; attribution?: string }>;
}

function parseActNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
    return null;
}

/**
 * Replay the exporter's boundary rule: a Part opens every time the Act value
 * *changes*, walking scenes in order — not once per distinct Act.
 *
 * `1,1,2,2,1,1` yields three boundaries (acts 1, 2, 1), which is why re-entrant
 * books cannot be migrated: the third would renumber from III to I.
 */
export function findActBoundaries(
    scenes: MigrationSceneInput[]
): Array<{ path: string; actNumber: number; index: number }> {
    const boundaries: Array<{ path: string; actNumber: number; index: number }> = [];
    let currentAct: number | null = null;

    scenes.forEach((scene, index) => {
        const act = parseActNumber(scene.act);
        if (act === null) return;
        if (act === currentAct) return;
        boundaries.push({ path: scene.path, actNumber: act, index });
        currentAct = act;
    });

    return boundaries;
}

/**
 * True when sequential part numbering reproduces the act-derived numerals.
 *
 * The pre-migration numeral comes from the Act number; after migration it comes
 * from the marker's position. Those agree only when the boundary acts are
 * exactly 1, 2, … k. That single condition rules out all three ways they can
 * diverge: re-entry (1,2,1), gaps (1,3), and starting above 1 (2,3).
 */
function isSequentialFromOne(boundaryActs: number[]): boolean {
    return boundaryActs.every((act, index) => act === index + 1);
}

function resolveEpigraphs(
    storedEpigraphs: Record<string, StoredEpigraphs> | undefined
): { layoutId: string; stored: StoredEpigraphs } | 'none' | 'conflict' {
    const populated = Object.entries(storedEpigraphs ?? {}).filter(([, stored]) =>
        stored.quotes.some(entry => entry.trim().length > 0)
        || stored.attributions.some(entry => entry.trim().length > 0)
    );

    if (populated.length === 0) return 'none';
    if (populated.length === 1) return { layoutId: populated[0][0], stored: populated[0][1] };

    // More than one layout carries text. Identical copies are the common case —
    // the author switched layouts and the text was duplicated forward — and can
    // be treated as one source. Genuinely different text is unknowable.
    const [, first] = populated[0];
    const allIdentical = populated.every(([, stored]) =>
        JSON.stringify(stored.quotes) === JSON.stringify(first.quotes)
        && JSON.stringify(stored.attributions) === JSON.stringify(first.attributions)
    );

    return allIdentical ? { layoutId: populated[0][0], stored: first } : 'conflict';
}

function epigraphFor(
    stored: StoredEpigraphs | undefined,
    actNumber: number
): { quote?: string; attribution?: string } {
    if (!stored) return {};
    const quote = stored.quotes[actNumber - 1]?.trim();
    const attribution = stored.attributions[actNumber - 1]?.trim();
    return {
        ...(quote ? { quote } : {}),
        ...(attribution ? { attribution } : {}),
    };
}

/**
 * Decide what may be done to one book.
 *
 * Classification order matters: explicit author markers are checked first, and
 * when any exist, act derivation never applies. That is what makes D2's repair
 * path terminate — a blocked author places markers by hand, re-runs, and the
 * book migrates on the strength of those markers with its Act values left
 * exactly as they are. Without it, the same act sequence would block forever.
 */
export function planBookMigration(input: BookMigrationInput): BookMigrationPlan {
    const { bookId, scenes, storedEpigraphs, migrationWrittenPaths } = input;

    if (scenes.length === 0) {
        return { bookId, status: 'noop', reason: 'no-scenes' };
    }

    const epigraphs = resolveEpigraphs(storedEpigraphs);
    if (epigraphs === 'conflict') {
        return {
            bookId,
            status: 'blocked',
            reason: 'epigraph-conflict',
            scenes: [],
            detail: 'Two or more layouts store different act epigraph text. '
                + 'Choose which one is canonical before migrating; the migration will not pick for you.',
        };
    }
    const epigraphSource = epigraphs === 'none' ? null : epigraphs;

    // ── Author-owned markers win outright ──────────────────────────────
    const authorMarkerPaths = scenes
        .filter(scene => !migrationWrittenPaths?.has(scene.path))
        .filter(scene => resolvePartMarkerValue(scene.part) !== null)
        .map(scene => scene.path);

    if (authorMarkerPaths.length > 0) {
        return {
            bookId,
            status: 'author-owned',
            markerPaths: authorMarkerPaths,
            epigraphProposal: epigraphSource
                ? {
                    layoutId: epigraphSource.layoutId,
                    entries: epigraphSource.stored.quotes
                        .map((_, index) => ({
                            actNumber: index + 1,
                            ...epigraphFor(epigraphSource.stored, index + 1),
                        }))
                        .filter(entry => entry.quote || entry.attribution),
                }
                : null,
        };
    }

    // ── No markers: derive from acts, if the acts allow it ─────────────
    const missingAct = scenes.filter(scene => parseActNumber(scene.act) === null);
    if (missingAct.length > 0) {
        return {
            bookId,
            status: 'blocked',
            reason: 'act-missing',
            scenes: missingAct.map(scene => ({
                path: scene.path,
                detail: 'No usable Act value.',
            })),
            detail: `${missingAct.length} scene${missingAct.length === 1 ? '' : 's'} carry no usable Act value, `
                + 'so the part boundaries cannot be reproduced.',
        };
    }

    const boundaries = findActBoundaries(scenes);
    if (boundaries.length === 0) {
        return { bookId, status: 'noop', reason: 'no-boundaries' };
    }

    const boundaryActs = boundaries.map(boundary => boundary.actNumber);
    if (!isSequentialFromOne(boundaryActs)) {
        const seen = new Set<number>();
        const reEntered = boundaryActs.some(act => {
            if (seen.has(act)) return true;
            seen.add(act);
            return false;
        });

        return {
            bookId,
            status: 'blocked',
            reason: reEntered ? 're-entrant-acts' : 'non-sequential-acts',
            scenes: boundaries.map(boundary => ({
                path: boundary.path,
                detail: `Opens Act ${boundary.actNumber}.`,
            })),
            detail: reEntered
                ? `Acts re-enter (${boundaryActs.join(', ')}), so a part numeral repeats. `
                    + 'Place Part markers explicitly to say what the structure should be; '
                    + 'the migration will not renumber the book for you.'
                : `Act boundaries run ${boundaryActs.join(', ')} rather than 1 upward, `
                    + 'so migrating would renumber the parts. Place Part markers explicitly instead.',
        };
    }

    return {
        bookId,
        status: 'derive',
        writes: boundaries.map((boundary, index) => ({
            path: boundary.path,
            actNumber: boundary.actNumber,
            partNumber: index + 1,
            ...epigraphFor(epigraphSource?.stored, boundary.actNumber),
        })),
    };
}
