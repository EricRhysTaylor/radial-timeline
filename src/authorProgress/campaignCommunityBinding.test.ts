import { describe, expect, it } from 'vitest';
import type { AuthorProgressCampaign, RadialTimelineSettings } from '../types/settings';
import { findCommunityBookConflict, moveCommunitySending, resolveCampaignBookId } from './campaignCommunityBinding';

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

describe('moveCommunitySending', () => {
    // The Author vault on 2026-11-07: two distinct campaigns, neither pinned,
    // both following the active book; RT Community sends, bSKY does not.
    function authorVault() {
        const bsky = campaign({ id: 'bsky', name: 'bSKY', sendToCommunity: false, updateFrequency: 'weekly' });
        const community = campaign({ id: 'rt', name: 'RT Community', sendToCommunity: true, updateFrequency: 'daily' });
        return { bsky, community, all: settings([bsky, community]) };
    }

    it('names the campaign holding the book, so the toggle can offer the move', () => {
        const { bsky, all } = authorVault();
        expect(findCommunityBookConflict(all, bsky)?.id).toBe('rt');
    });

    it('flips both flags together and pins the moved book', () => {
        const { bsky, community, all } = authorVault();
        expect(moveCommunitySending(all, 'bsky', 'rt')).toBe(true);
        expect(community.sendToCommunity).toBe(false);
        expect(bsky.sendToCommunity).toBe(true);
        expect(bsky.targetBookId).toBe('book-1');
        expect(findCommunityBookConflict(all, bsky)).toBeUndefined();
        expect(findCommunityBookConflict(all, community)?.id).toBe('bsky');
    });

    it('changes nothing when the named campaign does not hold the book', () => {
        const { bsky, community, all } = authorVault();
        community.targetBookId = 'book-2';
        expect(moveCommunitySending(all, 'bsky', 'rt')).toBe(false);
        expect(community.sendToCommunity).toBe(true);
        expect(bsky.sendToCommunity).toBe(false);
        expect(bsky.targetBookId).toBeUndefined();
    });

    it('changes nothing when the book does not resolve, or for an unknown campaign', () => {
        const { bsky, community, all } = authorVault();
        bsky.targetBookId = 'deleted-book';
        expect(moveCommunitySending(all, 'bsky', 'rt')).toBe(false);
        expect(moveCommunitySending(all, 'missing', 'rt')).toBe(false);
        expect(community.sendToCommunity).toBe(true);
        expect(bsky.sendToCommunity).toBe(false);
    });
});
