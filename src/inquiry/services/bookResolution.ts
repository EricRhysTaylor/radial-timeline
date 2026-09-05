import { normalizePath } from 'obsidian';
import type { BookProfile } from '../../types/settings';
import { getSequencedBooks } from '../../utils/books';

const BOOK_FOLDER_REGEX = /^Book\s+(\d+)/i;

const DRAFT_VARIANT_PATTERNS: RegExp[] = [
    /\bdraft(?:\s*\d+)?\b/i,
    /\balt(?:ernate)?\b/i,
    /\brevision(?:s)?\b/i,
    /\brev\b/i,
    /(^|[\s._-])v\d+($|[\s._-])/i,
    /\bvariant\b/i
];

export type InquiryBookStatus =
    | 'included'
    | 'excluded_variant'
    | 'excluded_nested'
    | 'excluded_manual';

export interface DiscoveredInquiryBookRoot {
    rootPath: string;
    bookNumber?: number;
    detectedByName: boolean;
    detectedByOutline: boolean;
    detectedByProfile: boolean;
}

export interface InquiryResolvedBook {
    id: string;
    rootPath: string;
    bookNumber?: number;
    detectedBy: 'profile' | 'name' | 'outline' | 'name+outline' | 'profile+name' | 'profile+outline' | 'profile+name+outline';
    isVariant: boolean;
    isNested: boolean;
    nestedUnder?: string;
    defaultIncluded: boolean;
    included: boolean;
    status: InquiryBookStatus;
    statusLabel: string;
    overrideIncluded?: boolean;
}

export interface InquiryBookResolution {
    candidates: InquiryResolvedBook[];
    includedBooks: InquiryResolvedBook[];
    excludedBooks: InquiryResolvedBook[];
    includedRoots: string[];
    excludedRoots: string[];
    hasVariantExclusions: boolean;
    hasNestedExclusions: boolean;
}

const normalizeMaybeRootPath = (value: string): string => {
    const trimmed = (value || '').trim();
    if (!trimmed || trimmed === '/' || trimmed === '.') return '';
    const normalized = normalizePath(trimmed);
    if (!normalized || normalized === '/' || normalized === '.') return '';
    return normalized;
};

export const normalizeInquiryBookInclusion = (raw?: Record<string, unknown>): Record<string, boolean> => {
    if (!raw || typeof raw !== 'object') return {};
    const normalized: Record<string, boolean> = {};
    Object.entries(raw).forEach(([key, value]) => {
        const path = normalizeMaybeRootPath(key || '');
        if (!path) return;
        if (typeof value !== 'boolean') return;
        normalized[path] = value;
    });
    return normalized;
};

export function resolveBookManagerInquiryBooks(bookProfiles?: BookProfile[]): InquiryBookResolution {
    const candidates: InquiryResolvedBook[] = [];
    getSequencedBooks(bookProfiles).forEach(({ book, sequenceNumber }) => {
            const rootPath = normalizeMaybeRootPath(book.sourceFolder || '');
            if (!rootPath) return;
            candidates.push({
                id: rootPath,
                rootPath,
                bookNumber: sequenceNumber,
                detectedBy: 'profile' as const,
                isVariant: false,
                isNested: false,
                defaultIncluded: true,
                included: true,
                status: 'included' as const,
                statusLabel: 'Included'
            });
        });

    return {
        candidates,
        includedBooks: candidates,
        excludedBooks: [],
        includedRoots: candidates.map(book => book.rootPath),
        excludedRoots: [],
        hasVariantExclusions: false,
        hasNestedExclusions: false
    };
}

export function finalizeInquiryBookResolution(
    discoveredRoots: DiscoveredInquiryBookRoot[],
    rawOverrides?: Record<string, unknown>
): InquiryBookResolution {
    if (!discoveredRoots.length) {
        return {
            candidates: [],
            includedBooks: [],
            excludedBooks: [],
            includedRoots: [],
            excludedRoots: [],
            hasVariantExclusions: false,
            hasNestedExclusions: false
        };
    }

    const overrides = normalizeInquiryBookInclusion(rawOverrides);
    const sorted = [...discoveredRoots].sort((a, b) => {
        const numA = a.bookNumber ?? Number.POSITIVE_INFINITY;
        const numB = b.bookNumber ?? Number.POSITIVE_INFINITY;
        if (numA !== numB) return numA - numB;
        return a.rootPath.localeCompare(b.rootPath);
    });

    const roots = sorted.map(item => item.rootPath);

    const candidates = sorted.map(item => {
        const nestedUnder = findContainingRoot(item.rootPath, roots);
        const isNested = !!nestedUnder;
        const isVariant = isDraftVariantPath(item.rootPath);
        const defaultIncluded = !isVariant && !isNested;
        const overrideIncluded = overrides[item.rootPath];

        let included = defaultIncluded;
        let status: InquiryBookStatus = 'included';
        let statusLabel = 'Included';

        if (typeof overrideIncluded === 'boolean') {
            included = overrideIncluded;
            if (included) {
                status = 'included';
                statusLabel = defaultIncluded ? 'Included' : 'Included (manual override)';
            } else {
                status = 'excluded_manual';
                statusLabel = 'Excluded (manual)';
            }
        } else if (isNested) {
            included = false;
            status = 'excluded_nested';
            statusLabel = 'Excluded (nested draft)';
        } else if (isVariant) {
            included = false;
            status = 'excluded_variant';
            statusLabel = 'Excluded (duplicate/variant)';
        }

        const detectedBy = resolveDetectedBy(item);

        return {
            id: item.rootPath,
            rootPath: item.rootPath,
            bookNumber: item.bookNumber,
            detectedBy,
            isVariant,
            isNested,
            nestedUnder,
            defaultIncluded,
            included,
            status,
            statusLabel,
            overrideIncluded
        } satisfies InquiryResolvedBook;
    });

    const includedBooks = candidates.filter(book => book.included);
    const excludedBooks = candidates.filter(book => !book.included);

    return {
        candidates,
        includedBooks,
        excludedBooks,
        includedRoots: includedBooks.map(book => book.rootPath),
        excludedRoots: excludedBooks.map(book => book.rootPath),
        hasVariantExclusions: candidates.some(book => !book.included && book.status === 'excluded_variant'),
        hasNestedExclusions: candidates.some(book => !book.included && book.status === 'excluded_nested')
    };
}

export function findInquiryBookForPath(path: string, candidates: Pick<InquiryResolvedBook, 'rootPath'>[]): Pick<InquiryResolvedBook, 'rootPath'> | undefined {
    const normalizedPath = normalizeMaybeRootPath(path);
    if (!normalizedPath) return undefined;

    let match: Pick<InquiryResolvedBook, 'rootPath'> | undefined;
    let bestLen = -1;
    candidates.forEach(candidate => {
        const root = normalizeMaybeRootPath(candidate.rootPath || '');
        if (!root) return;
        if (normalizedPath !== root && !normalizedPath.startsWith(`${root}/`)) return;
        if (root.length > bestLen) {
            bestLen = root.length;
            match = candidate;
        }
    });

    return match;
}

export function isPathIncludedByInquiryBooks(
    path: string,
    candidates: InquiryResolvedBook[],
    scope?: 'book' | 'saga'
): boolean {
    const owner = findInquiryBookForPath(path, candidates);
    if (!owner) {
        // Book scope with no candidates = unresolved book. Do not silently include.
        if (scope === 'book' && candidates.length === 0) return false;
        return true;
    }
    const full = candidates.find(candidate => candidate.rootPath === owner.rootPath);
    return !!full?.included;
}

export function isDraftVariantPath(path: string): boolean {
    const normalized = normalizeMaybeRootPath(path);
    if (!normalized) return false;

    const segments = normalized.split('/').filter(Boolean);
    if (!segments.length) return false;

    const bookIndex = segments.findIndex(segment => BOOK_FOLDER_REGEX.test(segment));
    if (bookIndex >= 0) {
        const indexes = [bookIndex - 1, bookIndex, bookIndex + 1].filter(idx => idx >= 0 && idx < segments.length);
        return indexes.some(idx => DRAFT_VARIANT_PATTERNS.some(pattern => pattern.test(segments[idx])));
    }

    const leaf = segments[segments.length - 1];
    return DRAFT_VARIANT_PATTERNS.some(pattern => pattern.test(leaf));
}

function resolveDetectedBy(item: DiscoveredInquiryBookRoot): InquiryResolvedBook['detectedBy'] {
    const parts: string[] = [];
    if (item.detectedByProfile) parts.push('profile');
    if (item.detectedByName) parts.push('name');
    if (item.detectedByOutline) parts.push('outline');
    // Join parts; type-safe cast since the combination is always valid.
    return (parts.join('+') || 'name') as InquiryResolvedBook['detectedBy'];
}

function findContainingRoot(rootPath: string, sortedRoots: string[]): string | undefined {
    let containing: string | undefined;
    sortedRoots.forEach(candidate => {
        if (!candidate || candidate === rootPath) return;
        if (!rootPath.startsWith(`${candidate}/`)) return;
        if (!containing || candidate.length > containing.length) {
            containing = candidate;
        }
    });
    return containing;
}
