import { describe, expect, it } from 'vitest';
import type { AuthorProgressCampaign, RadialTimelineSettings } from '../types/settings';
import { findCommunityBookConflict, resolveCampaignBookId } from './campaignCommunityBinding';

function campaign(overrides: Partial<AuthorProgressCampaign> & { id: string }): AuthorProgressCampaign {
    return {
        name: overrides.id,
        isActive: true,
        refreshThresholdDays: 7,
        exportPath: '',
        ...overrides
    } as AuthorProgressCampaign;
}

function settings(campaigns: AuthorProgressCampaign[], activeBookId = 'book-1'): RadialTimelineSettings {
    return {
        activeBookId,
        books: [
            { id: 'book-1', title: 'Shail + Trisan' },
            { id: 'book-2', title: 'Book 2 Saturn' }
        ],
        authorProgress: { campaigns }
    } as unknown as RadialTimelineSettings; // SAFE: these helpers read only books/activeBookId/authorProgress.campaigns
}

describe('resolveCampaignBookId', () => {
    it('falls back to the active book when no target is pinned', () => {
        const target = campaign({ id: 'a' });
        expect(resolveCampaignBookId(settings([target]), target)).toBe('book-1');
    });

    it('prefers an explicit target over the active book', () => {
        const target = campaign({ id: 'a', targetBookId: 'book-2' });
        expect(resolveCampaignBookId(settings([target]), target)).toBe('book-2');
    });

    it('resolves nothing when the pinned book no longer exists', () => {
        const target = campaign({ id: 'a', targetBookId: 'deleted-book' });
        expect(resolveCampaignBookId(settings([target]), target)).toBeUndefined();
    });

    it('resolves nothing when there is no target and no active book', () => {
        const target = campaign({ id: 'a' });
        expect(resolveCampaignBookId(settings([target], ''), target)).toBeUndefined();
    });
});

describe('findCommunityBookConflict', () => {
    it('detects the bSKY / RT Community collision: both unpinned, same active book', () => {
        const bsky = campaign({ id: 'bsky', name: 'bSKY', sendToCommunity: true });
        const community = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true });
        expect(findCommunityBookConflict(settings([bsky, community]), community)?.name).toBe('bSKY');
    });

    it('reports no conflict once the other campaign stops sharing', () => {
        const bsky = campaign({ id: 'bsky', name: 'bSKY', sendToCommunity: false });
        const community = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true });
        expect(findCommunityBookConflict(settings([bsky, community]), community)).toBeUndefined();
    });

    it('reports no conflict when the campaigns resolve to different books', () => {
        const bsky = campaign({ id: 'bsky', name: 'bSKY', sendToCommunity: true, targetBookId: 'book-2' });
        const community = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true, targetBookId: 'book-1' });
        expect(findCommunityBookConflict(settings([bsky, community]), community)).toBeUndefined();
    });

    it('catches a pinned campaign colliding with an unpinned one on the active book', () => {
        const bsky = campaign({ id: 'bsky', name: 'bSKY', sendToCommunity: true, targetBookId: 'book-1' });
        const community = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true });
        expect(findCommunityBookConflict(settings([bsky, community]), community)?.name).toBe('bSKY');
    });

    it('counts an inactive sharing campaign, which Send now can still fire', () => {
        const bsky = campaign({ id: 'bsky', name: 'bSKY', sendToCommunity: true, isActive: false });
        const community = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true });
        expect(findCommunityBookConflict(settings([bsky, community]), community)?.name).toBe('bSKY');
    });

    it('never reports a campaign as conflicting with itself', () => {
        const only = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true });
        expect(findCommunityBookConflict(settings([only]), only)).toBeUndefined();
    });

    it('reports no conflict when the book cannot be resolved', () => {
        const bsky = campaign({ id: 'bsky', name: 'bSKY', sendToCommunity: true });
        const community = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true, targetBookId: 'deleted-book' });
        expect(findCommunityBookConflict(settings([bsky, community]), community)).toBeUndefined();
    });
});
