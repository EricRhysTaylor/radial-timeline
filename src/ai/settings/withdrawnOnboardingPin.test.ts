import { describe, it, expect } from 'vitest';
import { validateAiSettings } from './validateAiSettings';

/**
 * Regression cover for the 2026-08-21 withdrawn onboarding pin.
 *
 * Withdrawing it from buildDefaultAiSettings stopped NEW vaults receiving it
 * but did nothing for vaults that had already written it to disk — two on the
 * author's machine still carried it. Those vaults would resume overriding the
 * author's model the moment they switched to a cloud provider.
 */
const SEEDED = { modelPolicy: { type: 'pinned', pinnedAlias: 'claude-haiku-4-5' } };

const withProfiles = (profiles: unknown) => ({
    provider: 'anthropic',
    featureProfiles: profiles
});

describe('withdrawn onboarding pin', () => {
    it('is stripped from a vault that already persisted it', () => {
        const out = validateAiSettings(withProfiles({ Onboarding: { ...SEEDED } })).value;
        expect(out.featureProfiles?.Onboarding).toBeUndefined();
    });

    it('is never re-seeded into fresh settings', () => {
        const out = validateAiSettings(null).value;
        expect(out.featureProfiles?.Onboarding).toBeUndefined();
    });

    it('LEAVES an author-chosen onboarding profile alone — different alias', () => {
        const mine = { modelPolicy: { type: 'pinned', pinnedAlias: 'claude-sonnet-5' } };
        const out = validateAiSettings(withProfiles({ Onboarding: mine })).value;
        expect(out.featureProfiles?.Onboarding).toEqual(mine);
    });

    it('LEAVES it alone when the author added a provider to the same alias', () => {
        const mine = { provider: 'anthropic', modelPolicy: { ...SEEDED.modelPolicy } };
        const out = validateAiSettings(withProfiles({ Onboarding: mine })).value;
        expect(out.featureProfiles?.Onboarding).toEqual(mine);
    });

    it('LEAVES it alone when the author added overrides', () => {
        const mine = { modelPolicy: { ...SEEDED.modelPolicy }, overrides: { jsonStrict: true } };
        const out = validateAiSettings(withProfiles({ Onboarding: mine })).value;
        expect(out.featureProfiles?.Onboarding).toBeDefined();
    });

    it('does not disturb other feature profiles', () => {
        const other = { modelPolicy: { type: 'pinned', pinnedAlias: 'claude-opus-5' } };
        const out = validateAiSettings(withProfiles({
            Onboarding: { ...SEEDED },
            InquiryMode: other
        })).value;
        expect(out.featureProfiles?.Onboarding).toBeUndefined();
        expect(out.featureProfiles?.InquiryMode).toEqual(other);
    });
});
