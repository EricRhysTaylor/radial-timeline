/*
 * Prefix ordering helpers
 *
 * Scene/beat/matter filenames commonly start with a numeric token:
 *   "1 Scene", "1.01 Beat", "0.01 Front", "200.01 Back"
 *
 * These helpers intentionally compare prefix tokens using natural string
 * ordering (localeCompare numeric) so behavior matches Obsidian file sorting.
 */

const PREFIX_TOKEN_REGEX = /^\s*(\d+(?:\.\d+)?)\s+/;

export function extractPrefixToken(value: string | undefined | null): string | null {
    if (!value) return null;
    const match = value.match(PREFIX_TOKEN_REGEX);
    return match?.[1] ?? null;
}

export function comparePrefixTokens(a: string | null, b: string | null): number {
    if (a && b) {
        const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        // Deterministic fallback for rare ties.
        return a.localeCompare(b);
    }
    if (a && !b) return -1;
    if (!a && b) return 1;
    return 0;
}

export function formatIntegerPrefix(index: number, _width: number = 0): string {
    const normalized = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    return String(normalized);
}

export function formatBeatDecimalPrefix(majorPrefix: string, minorIndex: number, minorWidth: number = 2): string {
    const safeMajor = majorPrefix && majorPrefix.trim().length > 0 ? majorPrefix.trim() : '0';
    const safeMinor = Math.max(1, Math.floor(minorIndex));
    return `${safeMajor}.${String(safeMinor).padStart(minorWidth, '0')}`;
}
