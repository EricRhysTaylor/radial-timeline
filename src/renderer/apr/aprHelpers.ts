import type { AuthorProgressCampaign, BookProfile } from '../../types/settings';

/**
 * Resolves the effective project path for a target.
 * If the campaign locks to a specific book, uses that book's sourceFolder.
 * Otherwise uses the active book's path (synced to sourcePath by Book Manager).
 */
export function resolveProjectPath(
    campaign: AuthorProgressCampaign | null,
    books: BookProfile[] | undefined,
    activeSourcePath: string
): string {
    if (campaign?.targetBookId) {
        const book = books?.find(b => b.id === campaign.targetBookId);
        if (book?.sourceFolder?.trim()) return book.sourceFolder.trim();
    }
    return activeSourcePath;
}

/**
 * Resolves the effective book title for a target.
 * If the campaign locks to a specific book, uses that book's title.
 * Otherwise uses the active book's title.
 */
export function resolveBookTitle(
    campaign: AuthorProgressCampaign | null,
    books: BookProfile[] | undefined,
    activeBookTitle: string
): string {
    if (campaign?.targetBookId) {
        const book = books?.find(b => b.id === campaign.targetBookId);
        if (book?.title?.trim()) return book.title.trim();
    }
    return activeBookTitle;
}

