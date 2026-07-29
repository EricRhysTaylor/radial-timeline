import type { BookProfile } from '../types/settings';
import type { TimelineItem } from '../types';
import { buildTimelineChapterResolverItems } from '../utils/timelineChapters';
import { SHARED_PART_FIELD_KEY } from '../utils/timelineParts';
import type { BookMigrationInput, MigrationSceneInput, StoredEpigraphs } from './partMarkers';

/**
 * Vault-facing adapter for the Part marker migration planner.
 *
 * Turns a book's scenes and stored settings into the planner's inputs. Kept
 * separate from `partMarkers.ts` so the planner stays free of TimelineItem and
 * settings types, and separate from the executor so both the preview and the
 * run build their input the same way.
 *
 * Still pure: the caller supplies the scenes (from `SceneDataService.getSceneData`).
 */

const ACT_FIELD_KEY = 'Act';

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * Read a frontmatter field tolerating case and separator drift, returning the
 * value uncoerced.
 *
 * Uncoerced matters: `Part` distinguishes boolean `true` (untitled marker) from
 * the string `"true"` (a part titled "true"), and stringifying here would
 * destroy that. The planner and `resolvePartMarkerValue` do the interpreting.
 */
function readRawField(frontmatter: Record<string, unknown> | undefined, field: string): unknown {
    if (!frontmatter) return undefined;
    const wanted = normalizeKey(field);
    for (const [key, value] of Object.entries(frontmatter)) {
        if (normalizeKey(key) === wanted) return value;
    }
    return undefined;
}

/** Describes how a book profile failed the normalization contract. */
export interface BookProfileNormalizationViolation {
    layoutId: string;
    field: 'actEpigraphs' | 'actEpigraphAttributions';
    detail: string;
}

/**
 * Check that a book profile carries the shape `normalizeBookProfile` guarantees:
 * every epigraph string trimmed, and no trailing empty entries.
 *
 * This is load-bearing rather than defensive. The planner treats epigraph arrays
 * stored under two layout ids as one source when they compare exactly equal, so
 * an untrimmed trailing space would reclassify a benign duplicate as a conflict
 * and block a book that should migrate cleanly. Every book profile in settings
 * has passed through `normalizeBookProfile` (see `main.ts` settings load), so a
 * violation here is a programmer error upstream, not bad user data.
 */
export function findBookProfileNormalizationViolations(
    book: BookProfile
): BookProfileNormalizationViolation[] {
    const violations: BookProfileNormalizationViolation[] = [];

    for (const [layoutId, options] of Object.entries(book.layoutOptions ?? {})) {
        const lists: Array<['actEpigraphs' | 'actEpigraphAttributions', string[] | undefined]> = [
            ['actEpigraphs', options?.actEpigraphs],
            ['actEpigraphAttributions', options?.actEpigraphAttributions],
        ];

        for (const [field, values] of lists) {
            if (!values) continue;

            const untrimmed = values.findIndex(value => value !== value.trim());
            if (untrimmed >= 0) {
                violations.push({
                    layoutId,
                    field,
                    detail: `Entry ${untrimmed + 1} is not trimmed.`,
                });
            }

            if (values.length > 0 && values[values.length - 1].trim().length === 0) {
                violations.push({
                    layoutId,
                    field,
                    detail: 'Trailing empty entries were not truncated.',
                });
            }
        }
    }

    return violations;
}

/** Throw when a book profile has not been normalized. See the finder above for why. */
export function assertNormalizedBookProfile(book: BookProfile): void {
    const violations = findBookProfileNormalizationViolations(book);
    if (violations.length === 0) return;

    const summary = violations
        .map(violation => `${violation.layoutId}.${violation.field}: ${violation.detail}`)
        .join('; ');
    throw new Error(
        `Book profile "${book.id}" was not normalized before migration planning. `
        + `Pass it through normalizeBookProfile first. Violations — ${summary}`
    );
}

function collectStoredEpigraphs(book: BookProfile): Record<string, StoredEpigraphs> {
    const stored: Record<string, StoredEpigraphs> = {};

    for (const [layoutId, options] of Object.entries(book.layoutOptions ?? {})) {
        const quotes = options?.actEpigraphs;
        const attributions = options?.actEpigraphAttributions;
        if (!quotes && !attributions) continue;
        stored[layoutId] = {
            quotes: quotes ?? [],
            attributions: attributions ?? [],
        };
    }

    return stored;
}

/**
 * Assert every supplied scene belongs to the book being planned.
 *
 * Scope is proved, not assumed, so the preview and the run cannot plan
 * different scene sets: a caller that scopes one and forgets the other would
 * otherwise show the author one migration and perform another. Books with no
 * source folder (single-book vaults) impose no constraint.
 */
export function assertScenesWithinBook(book: BookProfile, paths: string[]): void {
    const folder = (book.sourceFolder || '').replace(/\/+$/, '');
    if (!folder) return;

    const prefix = `${folder}/`;
    const strays = paths.filter(path => !path.startsWith(prefix));
    if (strays.length === 0) return;

    throw new Error(
        `Book "${book.id}" was given ${strays.length} scene(s) outside its source folder `
        + `"${folder}": ${strays.slice(0, 5).join(', ')}${strays.length > 5 ? ', …' : ''}. `
        + 'Scope scenes to the book before planning so preview and execution agree.'
    );
}

export interface BuildBookMigrationInputParams {
    /** Must already have passed through `normalizeBookProfile` — asserted. */
    book: BookProfile;
    /** Every scene in the book, in any order. Narrative order is imposed here. */
    scenes: TimelineItem[];
    /**
     * Exporter-equivalent frontmatter per scene path, from
     * `extractFrontmatterObject(fileContents)`.
     *
     * **Not** the TimelineItem's `rawFrontmatter`. `SceneDataService` builds that
     * with `normalizeFrontmatterKeys(fm, mappings)`, so a vault using custom
     * metadata mapping shows the timeline a renamed field (`MyAct` → `Act`) that
     * the export never sees — the export reads each file's own frontmatter text
     * and normalizes casing only. Planning from the cache would derive part
     * boundaries the export does not emit.
     *
     * Every ordered scene must be present; a missing entry throws rather than
     * being silently read as "no Act", because an unreadable file is not the
     * same fact as a scene without an act.
     */
    frontmatterByPath: ReadonlyMap<string, Record<string, unknown>>;
    /** Paths whose marker a previous interrupted run wrote, per the journal. */
    migrationWrittenPaths?: ReadonlySet<string>;
}

/**
 * Build the planner's input for one book.
 *
 * Ordering comes from `buildTimelineChapterResolverItems`, which dedupes scenes,
 * drops matter and BookMeta notes, and applies `sortScenes(items, false, false)`
 * — full-book narrative order, the same order the exporter walks. Reusing it
 * rather than re-sorting here is deliberate: a second ordering implementation is
 * exactly how a migration drifts from the pipeline it must reproduce. (Its name
 * predates Parts; it is generic scene ordering, not chapter-specific.)
 *
 * Act and Part come from `frontmatterByPath` — file text, no user key mappings —
 * because the export reads frontmatter directly and the migration has to
 * reproduce what the export does, not what the timeline computed.
 */
export function buildBookMigrationInput(
    params: BuildBookMigrationInputParams
): BookMigrationInput {
    const { book, scenes, frontmatterByPath, migrationWrittenPaths } = params;
    assertNormalizedBookProfile(book);

    const ordered = buildTimelineChapterResolverItems(scenes)
        .filter((item): item is TimelineItem & { path: string } => Boolean(item.path));

    assertScenesWithinBook(book, ordered.map(item => item.path));

    const unread = ordered.filter(item => !frontmatterByPath.has(item.path));
    if (unread.length > 0) {
        throw new Error(
            `Book "${book.id}" is missing exporter-equivalent frontmatter for ${unread.length} scene(s): `
            + `${unread.slice(0, 5).map(item => item.path).join(', ')}${unread.length > 5 ? ', …' : ''}. `
            + 'Read every scene before planning — an unreadable file is not a scene without an Act.'
        );
    }

    const sceneInputs: MigrationSceneInput[] = ordered.map(item => {
        const frontmatter = frontmatterByPath.get(item.path);
        return {
            path: item.path,
            act: readRawField(frontmatter, ACT_FIELD_KEY),
            part: readRawField(frontmatter, SHARED_PART_FIELD_KEY),
        };
    });

    const storedEpigraphs = collectStoredEpigraphs(book);

    return {
        bookId: book.id,
        scenes: sceneInputs,
        ...(Object.keys(storedEpigraphs).length > 0 ? { storedEpigraphs } : {}),
        ...(migrationWrittenPaths ? { migrationWrittenPaths } : {}),
    };
}
