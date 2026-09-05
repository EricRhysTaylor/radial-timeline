/*
 * Book Pages resolver.
 *
 * Pure resolution layer for the Settings → Publish UI:
 *   BookMeta defines. Notes override. Book Pages shows the final book.
 *
 * Precedence (per canonical role):
 *   1. Physical matter note with that Role  →  source: 'note'
 *   2. BookMeta has content for that role   →  source: 'bookmeta'
 *   3. Else → omitted from output
 *
 * Role determination for notes (in order):
 *   1. Explicit `Role:` field in yaml frontmatter — ALWAYS WINS
 *   2. Filename inference (e.g. `0.2 Title Page.md` → `title-page`)
 *   3. No match → custom note (role === null), surfaced in numeric order
 *
 * The resolver is shared by the Settings preview and export assembly.
 */
import { kebabSlug } from './slug';
import type { BookMeta } from '../types';
import type { MatterBodyMode } from './matterMeta';

/**
 * Canonical role identifier. Mirrors `VALID_MATTER_ROLES` in
 * `src/settings/sections/PublishSection.ts`.
 */
export type BookPageRole =
    | 'title-page'
    | 'copyright'
    | 'dedication'
    | 'epigraph'
    | 'acknowledgments'
    | 'about-author'
    | 'author-note'
    | 'other-works';

export type BookPageSide = 'frontmatter' | 'backmatter';

/**
 * Where a role lives in the book. Acknowledgments lives in backmatter
 * (BookMeta.backmatter.acknowledgments + the seeded `200.* Acknowledgments` note).
 */
export const ROLE_SIDE: Record<BookPageRole, BookPageSide> = {
    'title-page': 'frontmatter',
    'copyright': 'frontmatter',
    'dedication': 'frontmatter',
    'epigraph': 'frontmatter',
    'acknowledgments': 'backmatter',
    'about-author': 'backmatter',
    'author-note': 'backmatter',
    'other-works': 'backmatter',
};

/**
 * Canonical render order. Frontmatter roles first, then backmatter roles.
 */
export const CANONICAL_ROLE_ORDER: BookPageRole[] = [
    'title-page',
    'copyright',
    'dedication',
    'epigraph',
    'acknowledgments',
    'about-author',
    'author-note',
    'other-works',
];

/**
 * Display title for each role. Used when no note exists and the page is
 * generated from BookMeta.
 */
const ROLE_DISPLAY_TITLE: Record<BookPageRole, string> = {
    'title-page': 'Title Page',
    'copyright': 'Copyright',
    'dedication': 'Dedication',
    'epigraph': 'Epigraph',
    'acknowledgments': 'Acknowledgments',
    'about-author': 'About the Author',
    'author-note': 'Author Note',
    'other-works': 'Other Works',
};

/**
 * A single matter note, normalized for the resolver. Mirrors the shape
 * already produced by `getMatterPreviewSummary` / `parseMatterMetaFromFrontmatter`.
 *
 * `role` may be empty when the note has no explicit `Role:` field — in that
 * case the resolver attempts filename inference. `side` is required because
 * a custom note (no canonical role) still belongs to either frontmatter or
 * backmatter based on its `Class:` value.
 *
 * Callers pass an array; the resolver does NOT scan the vault.
 */
export interface MatterNoteSummary {
    role: string;
    path: string;
    title: string;
    bodyMode: MatterBodyMode;
    side?: BookPageSide;
    /**
     * `false` → the note is excluded from resolution entirely (it neither
     * claims its canonical role nor appears as a custom page). Undefined or
     * `true` → resolved normally. A disabled canonical-role note steps aside
     * so the BookMeta page for that role can surface.
     */
    enabled?: boolean;
}

export interface ResolvedPage {
    /** Canonical role, or `null` for custom notes that don't match any canonical role. */
    role: BookPageRole | null;
    side: BookPageSide;
    source: 'note' | 'bookmeta';
    title: string;
    /** Body mode of the overriding note. Present only when source === 'note'. */
    bodyMode?: MatterBodyMode;
    /** Vault path of the overriding note. Present only when source === 'note'. */
    path?: string;
    /**
     * Stable identifier for ordering / dedup:
     *   - notes:      `note:<path>`
     *   - BookMeta:   `bookmeta:<role>`
     */
    id: string;
}

function isBookPageRole(value: string): value is BookPageRole {
    return Object.prototype.hasOwnProperty.call(ROLE_SIDE, value);
}

function trimToString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Strip vault path + extension and any leading numeric prefix
 * (e.g. `0.2 Title Page` → `Title Page`, `200.1 Acknowledgments` → `Acknowledgments`).
 */
function stripFilenamePrefix(filenameOrPath: string): string {
    const base = filenameOrPath.split('/').pop() || filenameOrPath;
    const stem = base.replace(/\.md$/i, '');
    // Strip leading numeric prefix: "0.2 ", "200.1 ", "12 ", "001-", etc.
    return stem.replace(/^\s*\d+(?:[.-]\d+)*\s*[-_.\s]+/, '').trim();
}

/**
 * Normalize a free-form filename stem to lowercase kebab-case.
 * Lenient with separators (spaces, hyphens, underscores, periods).
 */
function normalizeForRoleMatch(label: string): string {
    // Apostrophes go first so "author's" reads as "authors", not "author-s".
    return kebabSlug(label.replace(/['']/g, ''), '');
}

/**
 * Map of normalized filename forms → canonical role. Includes singular,
 * plural, and common variant spellings. Update here (not in the matcher) when
 * adding new role aliases.
 */
const FILENAME_ROLE_ALIASES: Record<string, BookPageRole> = {
    // title-page
    'title-page': 'title-page',
    'titlepage': 'title-page',
    'title': 'title-page',
    // copyright
    'copyright': 'copyright',
    'copyrights': 'copyright',
    // dedication
    'dedication': 'dedication',
    'dedications': 'dedication',
    // epigraph
    'epigraph': 'epigraph',
    'epigraphs': 'epigraph',
    // acknowledgments
    'acknowledgments': 'acknowledgments',
    'acknowledgements': 'acknowledgments',   // British spelling
    'acknowledgment': 'acknowledgments',
    'acknowledgement': 'acknowledgments',
    // about-author
    'about-author': 'about-author',
    'about-the-author': 'about-author',
    'authors-bio': 'about-author',
    'author-bio': 'about-author',
    'about': 'about-author',
    // author-note
    'author-note': 'author-note',
    'authors-note': 'author-note',
    'authors-notes': 'author-note',
    'author-notes': 'author-note',
    'note-from-the-author': 'author-note',
    // other-works
    'other-works': 'other-works',
    'other-books': 'other-works',
    'also-by': 'other-works',
    'also-by-the-author': 'other-works',
    'by-the-same-author': 'other-works',
};

/**
 * Infer a canonical role from a filename or vault path.
 *
 * Strips numeric prefixes (`0.2 Title Page` → `Title Page`), normalizes case
 * and separators, then looks up the alias map. Returns `null` for non-matches
 * (which become custom pages, NOT silently dropped).
 *
 * Examples:
 *   `0.2 Title Page.md`        → `title-page`
 *   `0.3 Copyright.md`         → `copyright`
 *   `200.1 Acknowledgments.md` → `acknowledgments`
 *   `0.6 Title 2.md`           → `null` (custom page)
 *   `0.1 Alpha Readers.md`     → `null` (custom page)
 */
export function inferRoleFromFilename(filenameOrPath: string): BookPageRole | null {
    const stripped = stripFilenamePrefix(filenameOrPath);
    if (!stripped) return null;
    const normalized = normalizeForRoleMatch(stripped);
    if (!normalized) return null;
    const direct = FILENAME_ROLE_ALIASES[normalized];
    if (direct) return direct;
    return null;
}

/**
 * Returns true if BookMeta has any user-supplied content for the given role.
 *
 * Title page and copyright are considered "present" whenever the BookMeta
 * note exists (they are derived from required identity fields). Dedication,
 * epigraph, etc. require the matching prose field to be non-empty.
 */
function bookMetaHasRoleContent(bookMeta: BookMeta | undefined, role: BookPageRole): boolean {
    if (!bookMeta) return false;
    switch (role) {
        case 'title-page':
            return !!trimToString(bookMeta.title);
        case 'copyright': {
            const holder = trimToString(bookMeta.rights?.copyright_holder);
            const year = bookMeta.rights?.year;
            return !!holder || (typeof year === 'number' && Number.isFinite(year));
        }
        case 'dedication':
            return !!trimToString(bookMeta.frontmatter?.dedication);
        case 'epigraph':
            return !!trimToString(bookMeta.frontmatter?.epigraph_quote)
                || !!trimToString(bookMeta.frontmatter?.epigraph_attribution);
        case 'acknowledgments':
            return !!trimToString(bookMeta.backmatter?.acknowledgments);
        case 'about-author':
            return !!trimToString(bookMeta.backmatter?.about_author);
        case 'author-note':
            return !!trimToString(bookMeta.backmatter?.author_note);
        case 'other-works':
            return !!trimToString(bookMeta.backmatter?.other_works);
    }
}

/**
 * Resolve a single note's canonical role: explicit `Role:` field wins over
 * filename inference. Returns `null` for custom notes.
 *
 * Explicit yaml `Role:` is the source of truth — filename is only a fallback
 * for legacy notes that pre-date the `Role:` convention.
 */
function resolveNoteRole(note: MatterNoteSummary): BookPageRole | null {
    const explicit = trimToString(note.role).toLowerCase();
    if (explicit && isBookPageRole(explicit)) return explicit;
    if (explicit) return null; // explicit-but-unrecognized → don't fall through to filename
    return inferRoleFromFilename(note.path || note.title);
}

/**
 * Resolve the final list of book pages.
 *
 * Output structure:
 *   - Canonical-role pages first, in CANONICAL_ROLE_ORDER (note-overrides-bookmeta).
 *   - Custom notes appended at the end, in input (file) order.
 *     They surface with `role: null` and `source: 'note'`.
 *
 * Each canonical role appears at most once. When two notes resolve to the
 * same canonical role, first-wins (deterministic dedup).
 */
export function resolveBookPages(
    bookMeta: BookMeta | undefined,
    matterNotes: MatterNoteSummary[],
): ResolvedPage[] {
    const noteByRole = new Map<BookPageRole, MatterNoteSummary>();
    const customNotes: MatterNoteSummary[] = [];

    for (const note of matterNotes) {
        // Explicitly-disabled notes are dropped before any role resolution.
        // This is the mechanism that lets a canonical-role note "step aside":
        // skipping it here means bookMetaHasRoleContent() can surface the
        // BookMeta page for that role below, instead of the note silently
        // winning. Undefined/true → resolved normally (no migration needed).
        if (note.enabled === false) continue;
        const role = resolveNoteRole(note);
        if (role) {
            // First-wins: deterministic dedup for malformed input with two notes per role.
            if (!noteByRole.has(role)) {
                noteByRole.set(role, note);
            }
            // NOTE: a duplicate canonical-role note is dropped (not promoted to custom)
            // — surfacing it as custom would mask the duplication bug.
            continue;
        }
        customNotes.push(note);
    }

    const resolved: ResolvedPage[] = [];
    for (const role of CANONICAL_ROLE_ORDER) {
        const note = noteByRole.get(role);
        if (note) {
            resolved.push({
                role,
                side: ROLE_SIDE[role],
                source: 'note',
                title: trimToString(note.title) || ROLE_DISPLAY_TITLE[role],
                bodyMode: note.bodyMode,
                path: note.path,
                id: `note:${note.path}`,
            });
            continue;
        }
        if (bookMetaHasRoleContent(bookMeta, role)) {
            resolved.push({
                role,
                side: ROLE_SIDE[role],
                source: 'bookmeta',
                title: ROLE_DISPLAY_TITLE[role],
                id: `bookmeta:${role}`,
            });
        }
    }

    for (const note of customNotes) {
        // Custom notes default to frontmatter when side is unknown — caller
        // is expected to pass `side` (derived from `Class:`) for accurate placement.
        const side: BookPageSide = note.side || 'frontmatter';
        resolved.push({
            role: null,
            side,
            source: 'note',
            title: trimToString(note.title) || note.path,
            bodyMode: note.bodyMode,
            path: note.path,
            id: `note:${note.path}`,
        });
    }

    return resolved;
}

/**
 * Apply a saved page order to a resolved page list.
 *
 * Pure / deterministic / no side effects.
 *
 *   - `saved` empty/undefined → returns canonical order unchanged
 *   - else → reorders `resolved` to match `saved`
 *     - new (unsaved) pages append at the end in canonical order
 *     - removed pages drop silently from `saved`
 *     - **side grouping is enforced**: all frontmatter pages render before all
 *       backmatter pages regardless of what `saved` contains. A frontmatter
 *       page cannot become backmatter (or vice versa) just because the saved
 *       order interleaves them. The export pipeline relies on this
 *       front→manuscript→back ordering, and the UI enforces it on drag too.
 *       Within each side the saved order is honored.
 */
export function applyBookPageOrder(
    resolved: ResolvedPage[],
    saved: string[] | undefined,
): ResolvedPage[] {
    const applyWithinSide = (sidePages: ResolvedPage[]): ResolvedPage[] => {
        if (!saved || saved.length === 0) return sidePages.slice();
        const byId = new Map<string, ResolvedPage>();
        for (const page of sidePages) byId.set(page.id, page);
        const used = new Set<string>();
        const ordered: ResolvedPage[] = [];
        for (const id of saved) {
            const page = byId.get(id);
            if (page && !used.has(id)) {
                ordered.push(page);
                used.add(id);
            }
        }
        // New pages not yet in `saved` → append in canonical (input) order.
        for (const page of sidePages) {
            if (!used.has(page.id)) {
                ordered.push(page);
                used.add(page.id);
            }
        }
        return ordered;
    };

    const front = resolved.filter(p => p.side === 'frontmatter');
    const back = resolved.filter(p => p.side === 'backmatter');
    return [...applyWithinSide(front), ...applyWithinSide(back)];
}
