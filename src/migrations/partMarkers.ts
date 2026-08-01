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
     *
     * **Trusted input — the planner does not validate it.** Deciding whether a
     * journal is still resumable is the executor's responsibility: only it holds
     * both artifacts (the journal's recorded plan and a freshly computed one)
     * and only it can act on the answer. A book whose Act values changed between
     * runs will produce a plan that disagrees with the journal; the executor
     * must detect that and restore rather than resume, because resuming would
     * apply half of one plan and half of another. The planner is pure
     * classification and has no notion of a previous run beyond this set.
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
    /**
     * The literal value to write as `Part:`, per D1: `true` for an untitled
     * marker, a non-empty string for a titled one. Stated explicitly rather than
     * left implicit so the executor has no shape to infer — a derived marker is
     * always `true`, because the Act it came from had no name to carry.
     */
    title: string | true;
    /** Act that opened at this boundary — also the printed numeral, pre-migration. */
    actNumber: number;
    /** 1-based position among markers — the numeral after migration. */
    partNumber: number;
    quote?: string;
    attribution?: string;
}

export type BookMigrationPlan =
    | { bookId: string; status: 'noop'; reason: 'no-scenes' | 'no-boundaries' }
    | {
        bookId: string;
        status: 'author-owned';
        markerPaths: string[];
        epigraphProposal: EpigraphProposal | null;
        /** Every layout whose stored epigraphs this migration would supersede. */
        epigraphSources: EpigraphSource[];
    }
    | {
        bookId: string;
        status: 'derive';
        writes: PartMarkerWrite[];
        /**
         * Every layout whose stored epigraphs this migration would supersede —
         * including identical copies, which are distinct storage locations.
         * Leaving one behind would resurrect epigraphs the author believes were
         * migrated, so cleanup needs all of them, not just the one read from.
         *
         * Carries the exact stored values, not just ids: cleanup deletes whole
         * arrays, so the manifest has to know precisely what it is deleting and
         * be able to prove every populated slot was migrated or discarded first.
         */
        epigraphSources: EpigraphSource[];
    }
    | { bookId: string; status: 'blocked'; reason: BlockedReason; scenes: BlockedScene[]; detail: string };

/** One layout's stored epigraph arrays, exactly as they sit in settings. */
export interface EpigraphSource {
    layoutId: string;
    quotes: string[];
    attributions: string[];
}

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
): { layoutIds: string[]; stored: StoredEpigraphs } | 'none' | 'conflict' {
    const populated = Object.entries(storedEpigraphs ?? {}).filter(([, stored]) =>
        stored.quotes.some(entry => entry.trim().length > 0)
        || stored.attributions.some(entry => entry.trim().length > 0)
    );

    if (populated.length === 0) return 'none';

    const layoutIds = populated.map(([layoutId]) => layoutId).sort();
    if (populated.length === 1) return { layoutIds, stored: populated[0][1] };

    // More than one layout carries text. Identical copies are the common case —
    // the author switched layouts and the text was duplicated forward — and can
    // be treated as one source for READING. Every copy is still reported, because
    // each is a distinct storage location and cleanup must clear all of them:
    // leaving one behind resurrects epigraphs the author believes were migrated.
    // Genuinely different text is unknowable.
    const [, first] = populated[0];
    const allIdentical = populated.every(([, stored]) =>
        JSON.stringify(stored.quotes) === JSON.stringify(first.quotes)
        && JSON.stringify(stored.attributions) === JSON.stringify(first.attributions)
    );

    return allIdentical ? { layoutIds, stored: first } : 'conflict';
}

/**
 * Epigraph text stored for one act.
 *
 * The two fields are independent. A slot holding only an attribution is carried
 * forward rather than dropped, because that is already what the act-derived
 * export prints: `\rtPart` guards `#3` and `#4` separately, so an attribution
 * with no quote typesets the attribution alone today. Dropping it would make the
 * migration lossy, and dropping it in one path but not the other would make the
 * two disagree — so the rule is stated once here and used by both.
 */
/** Exact stored arrays for the layouts cleanup will clear. */
function epigraphSourcesOf(
    storedEpigraphs: Record<string, StoredEpigraphs> | undefined,
    layoutIds: string[]
): EpigraphSource[] {
    return layoutIds.map(layoutId => ({
        layoutId,
        quotes: [...(storedEpigraphs?.[layoutId]?.quotes ?? [])],
        attributions: [...(storedEpigraphs?.[layoutId]?.attributions ?? [])],
    }));
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

/** True when a slot carries anything worth migrating — either field alone counts. */
function hasEpigraphContent(entry: { quote?: string; attribution?: string }): boolean {
    return Boolean(entry.quote || entry.attribution);
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
            epigraphSources: epigraphSourcesOf(storedEpigraphs, epigraphSource?.layoutIds ?? []),
            epigraphProposal: epigraphSource
                ? {
                    layoutId: epigraphSource.layoutIds[0],
                    // Walk both arrays: an attribution can outlive its quote, and
                    // quotes.length alone would miss a trailing attribution-only slot.
                    entries: Array.from(
                        {
                            length: Math.max(
                                epigraphSource.stored.quotes.length,
                                epigraphSource.stored.attributions.length
                            ),
                        },
                        (_, index) => ({
                            actNumber: index + 1,
                            ...epigraphFor(epigraphSource.stored, index + 1),
                        })
                    ).filter(hasEpigraphContent),
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
        // Report only the boundaries that actually break the rule — the repair
        // path sends the author to look at specific scenes, so listing every
        // boundary in a five-part book blocked by one late re-entry buries the
        // one that matters.
        //
        // But report ALL of them. A book can be both re-entrant and gapped
        // (`1,3,1`); naming only the repeat would send the author to fix one
        // thing and get blocked again on the next run for a reason that was
        // already knowable. `position` is carried explicitly rather than
        // recovered with indexOf, which finds the first structurally equal
        // element and would mislabel entries the moment boundaries stop being
        // unique by construction.
        const seenActs = new Set<number>();
        const annotated = boundaries.map((boundary, position) => {
            const reEnters = seenActs.has(boundary.actNumber);
            seenActs.add(boundary.actNumber);
            return {
                ...boundary,
                position,
                reEnters,
                outOfSequence: boundary.actNumber !== position + 1,
            };
        });

        const reEntered = annotated.some(entry => entry.reEnters);
        const gapped = annotated.some(entry => entry.outOfSequence && !entry.reEnters);
        const offending = annotated.filter(entry => entry.reEnters || entry.outOfSequence);

        const detailFor = (entry: typeof annotated[number]): string => entry.reEnters
            ? `Re-opens Act ${entry.actNumber}, which already opened earlier.`
            : `Opens Act ${entry.actNumber} where part ${entry.position + 1} is expected.`;

        return {
            bookId,
            status: 'blocked',
            reason: reEntered ? 're-entrant-acts' : 'non-sequential-acts',
            scenes: offending.map(entry => ({
                path: entry.path,
                detail: detailFor(entry),
            })),
            detail: reEntered
                ? `Act boundaries run ${boundaryActs.join(', ')}. Acts re-enter, so a part numeral repeats`
                    + (gapped ? ', and others fall out of sequence' : '')
                    + '. Place Part markers explicitly to say what the structure should be; '
                    + 'the migration will not renumber the book for you.'
                : `Act boundaries run ${boundaryActs.join(', ')} rather than 1 upward, `
                    + 'so migrating would renumber the parts. Place Part markers explicitly instead.',
        };
    }

    return {
        bookId,
        status: 'derive',
        epigraphSources: epigraphSourcesOf(storedEpigraphs, epigraphSource?.layoutIds ?? []),
        writes: boundaries.map((boundary, index) => ({
            path: boundary.path,
            // Always untitled: the Act this boundary came from had no name.
            title: true as const,
            actNumber: boundary.actNumber,
            partNumber: index + 1,
            ...epigraphFor(epigraphSource?.stored, boundary.actNumber),
        })),
    };
}
