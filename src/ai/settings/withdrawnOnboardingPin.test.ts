import { describe, it, expect } from 'vitest';
import {
    applyWithdrawnOnboardingPinMigration,
    migrateAiSettings,
    WITHDRAWN_ONBOARDING_PIN_MIGRATION
} from './migrateAiSettings';
import { buildDefaultAiSettings } from './aiSettings';
import type { AiSettingsV1 } from '../types';

const SEEDED = { modelPolicy: { type: 'pinned', pinnedAlias: 'claude-haiku-4-5' } };

const settingsWith = (profiles: unknown): AiSettingsV1 => ({
    ...buildDefaultAiSettings(),
    featureProfiles: profiles as AiSettingsV1['featureProfiles']
});

describe('withdrawn onboarding pin — one-time migration', () => {
    it('removes the pin a vault already persisted', () => {
        const out = applyWithdrawnOnboardingPinMigration(settingsWith({ Onboarding: { ...SEEDED } }));
        expect(out.aiSettings.featureProfiles?.Onboarding).toBeUndefined();
        expect(out.changed).toBe(true);
    });

    // REGRESSION — review round 3. main.ts persists only when
    // migrateAiSettings reports `changed`. A migration applied in memory
    // without reporting one is reapplied and lost on every load, so the pin
    // would never actually leave the disk.
    it('reports changed through migrateAiSettings so startup writes it to disk', () => {
        const result = migrateAiSettings({ aiSettings: settingsWith({ Onboarding: { ...SEEDED } }) } as never);
        expect(result.changed).toBe(true);
        expect(result.aiSettings.featureProfiles?.Onboarding).toBeUndefined();
    });

    it('runs exactly once — a profile re-created afterwards survives', () => {
        const first = applyWithdrawnOnboardingPinMigration(settingsWith({ Onboarding: { ...SEEDED } }));
        expect(first.aiSettings.appliedMigrations).toContain(WITHDRAWN_ONBOARDING_PIN_MIGRATION);

        // The author deliberately re-creates the same profile after the fix.
        const recreated: AiSettingsV1 = {
            ...first.aiSettings,
            featureProfiles: { Onboarding: { ...SEEDED } }
        };
        const second = applyWithdrawnOnboardingPinMigration(recreated);
        expect(second.aiSettings.featureProfiles?.Onboarding).toEqual(SEEDED);
        expect(second.changed).toBe(false);
    });

    // REGRESSION — review round 3. The first predicate counted OUTER keys
    // only, so a profile with extra keys INSIDE modelPolicy was deleted
    // despite being plainly author-edited.
    it('LEAVES a profile whose modelPolicy carries extra keys', () => {
        const authored = {
            modelPolicy: { type: 'pinned', pinnedAlias: 'claude-haiku-4-5', authorNote: 'deliberate' }
        };
        const out = applyWithdrawnOnboardingPinMigration(settingsWith({ Onboarding: authored }));
        expect(out.aiSettings.featureProfiles?.Onboarding).toEqual(authored);
    });

    it('LEAVES a different alias, an added provider, or added overrides', () => {
        const cases = [
            { modelPolicy: { type: 'pinned', pinnedAlias: 'claude-sonnet-5' } },
            { provider: 'anthropic', modelPolicy: { ...SEEDED.modelPolicy } },
            { modelPolicy: { ...SEEDED.modelPolicy }, overrides: { jsonStrict: true } }
        ];
        for (const authored of cases) {
            const out = applyWithdrawnOnboardingPinMigration(settingsWith({ Onboarding: authored }));
            expect(out.aiSettings.featureProfiles?.Onboarding).toBeDefined();
        }
    });

    it('does not disturb other feature profiles', () => {
        const other = { modelPolicy: { type: 'pinned', pinnedAlias: 'claude-opus-5' } };
        const out = applyWithdrawnOnboardingPinMigration(
            settingsWith({ Onboarding: { ...SEEDED }, InquiryMode: other })
        );
        expect(out.aiSettings.featureProfiles?.Onboarding).toBeUndefined();
        expect(out.aiSettings.featureProfiles?.InquiryMode).toEqual(other);
    });

    it('is key-order independent — shape equality, not string equality', () => {
        const reordered = { modelPolicy: { pinnedAlias: 'claude-haiku-4-5', type: 'pinned' } };
        const out = applyWithdrawnOnboardingPinMigration(settingsWith({ Onboarding: reordered }));
        expect(out.aiSettings.featureProfiles?.Onboarding).toBeUndefined();
    });
});
