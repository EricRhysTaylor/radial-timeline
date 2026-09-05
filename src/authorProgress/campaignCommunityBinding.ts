/**
 * Campaign → Community book binding.
 *
 * My Share stores exactly one APR per book (community_apr_reports carries a
 * UNIQUE constraint on project_id). Two campaigns pointed at the same book
 * therefore do not get two cards — they overwrite each other's row, and the
 * label, reveal level, and cadence shown publicly belong to whichever campaign
 * uploaded last. That is a silent, cadence-dependent flip, so the plugin
 * enforces one sharing campaign per book instead of letting the race happen.
 *
 * Both helpers are pure functions over settings so the settings UI and the
 * upload path resolve the binding identically — the conflict is only visible
 * after resolution, never from the stored targetBookId alone.
 */

import type { AuthorProgressCampaign, RadialTimelineSettings } from '../types/settings';

/**
 * The book a campaign actually publishes, following the same
 * `targetBookId ?? activeBookId` fallback the upload path uses. Returns
 * undefined when nothing resolves to a book that still exists — a deleted
 * book id must not resolve to "some other book".
 */
export function resolveCampaignBookId(
    settings: RadialTimelineSettings,
    campaign: Pick<AuthorProgressCampaign, 'targetBookId'>
): string | undefined {
    const candidate = campaign.targetBookId ?? settings.activeBookId;
    if (!candidate) return undefined;
    return settings.books?.some(book => book.id === candidate) ? candidate : undefined;
}

/**
 * Another campaign already sending this campaign's resolved book to Community,
 * or undefined when the book is free. Inactive campaigns still count: they are
 * skipped by the scheduler but "Send now" can still fire them, so a dormant
 * campaign holding the book is a real conflict the author has to resolve.
 */
export function findCommunityBookConflict(
    settings: RadialTimelineSettings,
    campaign: Pick<AuthorProgressCampaign, 'id' | 'targetBookId'>
): AuthorProgressCampaign | undefined {
    const bookId = resolveCampaignBookId(settings, campaign);
    if (!bookId) return undefined;
    return settings.authorProgress?.campaigns?.find(other =>
        other.id !== campaign.id
        && other.sendToCommunity === true
        && resolveCampaignBookId(settings, other) === bookId
    );
}
