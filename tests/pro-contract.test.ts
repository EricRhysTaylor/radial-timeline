import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
    });
}

describe('Pro access is gone', () => {
    // Every feature is open (2026-11-19). A gate that comes back would hide
    // features from writers behind a license that no longer exists.
    it('has no entitlement module and no Pro checks in the plugin', () => {
        expect(existsSync(resolve(process.cwd(), 'src/settings/proEntitlement.ts'))).toBe(false);
        expect(existsSync(resolve(process.cwd(), 'src/settings/proEntitlementSeed.ts'))).toBe(false);
        const offenders = sourceFiles(resolve(process.cwd(), 'src'))
            .filter(path => /hasProFeatureAccess|isProActive|hasProAccess|ert-pro-locked/.test(readFileSync(path, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('strips the stored Pro settings at load and keeps them out of the settings type', () => {
        const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
        const settingsSource = readFileSync(resolve(process.cwd(), 'src/types/settings.ts'), 'utf8');
        const deprecated = mainSource.slice(mainSource.indexOf('FINISHED_DEPRECATION_KEYS = ['), mainSource.indexOf('] as const;'));
        expect(deprecated).toContain("'proLicenseKey'");
        expect(deprecated).toContain("'proAccessEnabled'");
        expect(settingsSource.includes('proLicenseKey')).toBe(false);
        expect(settingsSource.includes('proAccessEnabled')).toBe(false);
    });

    it('draws the Resources tab like every other settings tab', () => {
        const settingsTabSource = readFileSync(resolve(process.cwd(), 'src/settings/SettingsTab.ts'), 'utf8');
        const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/rt-ui.css'), 'utf8');

        expect(settingsTabSource.includes("persistTab('resources')")).toBe(true);
        expect(settingsTabSource.includes('ert-settings-tab-pro')).toBe(false);
        expect(stylesheet.includes('ert-settings-tab-pro')).toBe(false);
        expect(stylesheet.includes('ert-pro-hero')).toBe(false);
        const cardRules = stylesheet.match(/[^{}]*ert-bonus[^{}]*\{[^{}]*\}/g) ?? [];
        expect(cardRules.length).toBeGreaterThan(0);
        expect(cardRules.filter(rule => rule.includes('--ert-pro-accent'))).toEqual([]);
    });
});
