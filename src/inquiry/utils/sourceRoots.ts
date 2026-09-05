import type { Vault } from 'obsidian';
import type { BookProfile, InquirySourcesSettings } from '../../types/settings';
import { MAX_RESOLVED_SCAN_ROOTS, normalizeScanRootPatterns, resolveScanRoots, toDisplayRoot, toVaultRoot } from './scanRoots';
import { getSequencedBooks } from '../../utils/books';

type InquirySourceRootResolution = {
    supportPatterns: string[];
    supportResolvedRoots: string[];
    supportVaultRoots: string[];
    bookVaultRoots: string[];
    resolvedRoots: string[];
    resolvedVaultRoots: string[];
};

const unique = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

export const getInquiryBookManagerRoots = (bookProfiles?: BookProfile[]): string[] => {
    return unique(
        getSequencedBooks(bookProfiles)
            .map(({ book }) => toVaultRoot(book.sourceFolder || '/'))
            .filter(root => root.length > 0)
    );
};

export const resolveInquirySourceRoots = (
    vault: Vault,
    sources: Pick<InquirySourcesSettings, 'scanRoots' | 'resolvedScanRoots'>,
    bookProfiles?: BookProfile[]
): InquirySourceRootResolution => {
    const supportPatterns = normalizeScanRootPatterns(sources.scanRoots);
    const supportResolvedRoots = supportPatterns.length
        ? ((sources.resolvedScanRoots && sources.resolvedScanRoots.length)
            ? normalizeScanRootPatterns(sources.resolvedScanRoots)
            : resolveScanRoots(supportPatterns, vault, MAX_RESOLVED_SCAN_ROOTS).resolvedRoots)
        : [];
    const supportVaultRoots = unique(supportResolvedRoots.map(toVaultRoot));
    const bookVaultRoots = getInquiryBookManagerRoots(bookProfiles);
    const resolvedVaultRoots = unique([...supportVaultRoots, ...bookVaultRoots]);

    return {
        supportPatterns,
        supportResolvedRoots,
        supportVaultRoots,
        bookVaultRoots,
        resolvedRoots: resolvedVaultRoots.map(toDisplayRoot),
        resolvedVaultRoots
    };
};
