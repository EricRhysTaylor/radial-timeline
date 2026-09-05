import type { BookProfile, RadialTimelineSettings, StructuralMoveHistoryEntry } from '../types/settings';

export const MAX_RECENT_STRUCTURAL_MOVES = 20;

function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeHistoryEntry(entry: StructuralMoveHistoryEntry | undefined): StructuralMoveHistoryEntry | null {
    const timestamp = normalizeOptionalString(entry?.timestamp);
    const itemType = entry?.itemType;
    const itemId = normalizeOptionalString(entry?.itemId);
    const itemLabel = normalizeOptionalString(entry?.itemLabel);
    const summary = normalizeOptionalString(entry?.summary);

    if (!timestamp || (itemType !== 'Scene' && itemType !== 'Beat') || !itemId || !itemLabel || !summary) {
        return null;
    }

    return {
        timestamp,
        itemType,
        itemId,
        itemLabel,
        summary,
        renameCount: typeof entry?.renameCount === 'number' && Number.isFinite(entry.renameCount)
            ? Math.max(0, Math.round(entry.renameCount))
            : 0,
        crossedActs: !!entry?.crossedActs,
        rippleRename: !!entry?.rippleRename,
        ...(normalizeOptionalString(entry?.sourceContext) ? { sourceContext: normalizeOptionalString(entry?.sourceContext) } : {}),
        ...(normalizeOptionalString(entry?.destinationContext) ? { destinationContext: normalizeOptionalString(entry?.destinationContext) } : {}),
    };
}

export function normalizeRecentStructuralMoves(
    entries: StructuralMoveHistoryEntry[] | undefined
): StructuralMoveHistoryEntry[] | undefined {
    if (!Array.isArray(entries) || entries.length === 0) return undefined;

    const normalized = entries
        .map((entry) => normalizeHistoryEntry(entry))
        .filter((entry): entry is StructuralMoveHistoryEntry => !!entry)
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, MAX_RECENT_STRUCTURAL_MOVES);

    return normalized.length > 0 ? normalized : undefined;
}

function resolveTargetBook(settings: RadialTimelineSettings, bookId?: string): BookProfile | null {
    const books = Array.isArray(settings.books) ? settings.books : [];
    if (books.length === 0) return null;
    if (bookId) {
        return books.find((book) => book.id === bookId) ?? null;
    }
    if (settings.activeBookId) {
        return books.find((book) => book.id === settings.activeBookId) ?? books[0] ?? null;
    }
    return books[0] ?? null;
}

export function getActiveRecentStructuralMoves(settings: RadialTimelineSettings): StructuralMoveHistoryEntry[] {
    const activeBook = resolveTargetBook(settings);
    return normalizeRecentStructuralMoves(activeBook?.recentStructuralMoves) ?? [];
}

export function appendRecentStructuralMove(
    settings: RadialTimelineSettings,
    entry: StructuralMoveHistoryEntry,
    bookId?: string
): boolean {
    const targetBook = resolveTargetBook(settings, bookId);
    const normalizedEntry = normalizeHistoryEntry(entry);
    if (!targetBook || !normalizedEntry) return false;

    const nextEntries = [
        normalizedEntry,
        ...(normalizeRecentStructuralMoves(targetBook.recentStructuralMoves) ?? [])
    ].slice(0, MAX_RECENT_STRUCTURAL_MOVES);

    targetBook.recentStructuralMoves = nextEntries;
    return true;
}
