import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasProFeatureAccess } from '../src/settings/featureGate';
import { getProEntitlement, isProActive } from '../src/settings/proEntitlement';

describe('Pro contract', () => {
    it('resolves entitlement from one source', () => {
        const activePlugin = {
            settings: {
                proLicenseKey: 'PRO-1234-5678-ABCD'
            }
        } as any;
        const inactivePlugin = {
            settings: {
                proLicenseKey: ''
            }
        } as any;

        expect(getProEntitlement(activePlugin)).toEqual({
            state: 'active',
            isProActive: true,
            hasProLicenseKey: true,
            isProEnabled: true
        });
        expect(isProActive(activePlugin)).toBe(true);
        expect(hasProFeatureAccess(activePlugin)).toBe(true);

        expect(getProEntitlement(inactivePlugin)).toEqual({
            state: 'inactive',
            isProActive: false,
            hasProLicenseKey: false,
            isProEnabled: true
        });
        expect(isProActive(inactivePlugin)).toBe(false);
        expect(hasProFeatureAccess(inactivePlugin)).toBe(false);
    });

    it('removes dev toggles and early-access baggage', () => {
        const settingsSource = readFileSync(resolve(process.cwd(), 'src/types/settings.ts'), 'utf8');
        const defaultsSource = readFileSync(resolve(process.cwd(), 'src/settings/defaults.ts'), 'utf8');
        const entitlementSource = readFileSync(resolve(process.cwd(), 'src/settings/proEntitlement.ts'), 'utf8');

        expect(settingsSource.includes('devProActive')).toBe(false);
        expect(settingsSource.includes('hasSeenProActivation')).toBe(false);
        expect(defaultsSource.includes('hasSeenProActivation')).toBe(false);
        expect(entitlementSource.includes('Early Access')).toBe(false);
        expect(entitlementSource.includes('beta_active')).toBe(false);
        expect(entitlementSource.includes('licensed_active')).toBe(false);
    });

    it('uses Pro as the public tier label in the settings contract', () => {
        const settingsTabSource = readFileSync(resolve(process.cwd(), 'src/settings/SettingsTab.ts'), 'utf8');
        const authorProgressSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/AuthorProgressSection.ts'), 'utf8');
        const commandRegistrarSource = readFileSync(resolve(process.cwd(), 'src/services/CommandRegistrar.ts'), 'utf8');
        const entitlementPanelSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/ProEntitlementPanel.ts'), 'utf8');

        expect(settingsTabSource.includes('PRO · SIGNATURE')).toBe(false);
        expect(authorProgressSource.includes('Pro Signature')).toBe(false);
        expect(commandRegistrarSource.includes('Professional license')).toBe(false);
        expect(entitlementPanelSource.includes('Pro subscription')).toBe(false);
        expect(entitlementPanelSource.includes('Pro access key')).toBe(true);
    });
});
