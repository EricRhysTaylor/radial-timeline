import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefaultAuthorProgressSettings, migrateAuthorProgressSettings } from '../src/authorProgress/authorProgressConfig';
import { resolveBookTitle, resolveProjectPath } from '../src/renderer/apr/aprHelpers';

describe('authorProgress contract', () => {
    it('migrates legacy social settings into canonical defaults', () => {
        const migrated = migrateAuthorProgressSettings({
            enabled: true,
            defaultPublishTarget: 'note',
            dynamicEmbedPath: 'Radial Timeline/Social/base/apr-default-manual-medium.png',
            campaigns: [
                {
                    id: 'campaign-1',
                    name: 'Launch',
                    embedPath: 'Radial Timeline/Social/base/campaigns/apr-launch-auto-weekly-large-teaser.png',
                    teaserReveal: { enabled: true, preset: 'fast' }
                }
            ],
            revealCampaign: { enabled: true, nextRevealAt: '2026-01-01' }
        });

        expect(migrated.enabled).toBe(true);
        expect(migrated.defaults.publishTarget).toBe('note');
        // bookTitleOverride and projectPathOverride no longer exist on defaults
        expect((migrated.defaults as any).bookTitleOverride).toBeUndefined();
        expect((migrated.defaults as any).projectPathOverride).toBeUndefined();
        expect((migrated.defaults as any).defaultPublishTarget).toBeUndefined();
        expect((migrated.defaults as any).dynamicEmbedPath).toBeUndefined();
        expect((migrated.defaults as any).socialProjectPath).toBeUndefined();
        expect(JSON.stringify(migrated)).not.toContain('revealCampaign');

        expect(migrated.campaigns).toHaveLength(1);
        expect(migrated.campaigns?.[0]).toMatchObject({
            id: 'campaign-1',
            name: 'Launch',
            exportPath: 'Radial Timeline/Social/base/campaigns/apr-launch-auto-weekly-large-teaser.png'
        });
        // Legacy overrides no longer exist on campaigns
        expect((migrated.campaigns?.[0] as any).projectPathOverride).toBeUndefined();
        expect((migrated.campaigns?.[0] as any).bookTitleOverride).toBeUndefined();
        expect((migrated.campaigns?.[0] as any).embedPath).toBeUndefined();
        expect((migrated.campaigns?.[0] as any).projectPath).toBeUndefined();
        expect((migrated.campaigns?.[0] as any).bookTitle).toBeUndefined();
    });

    it('resolves book title via targetBookId on campaigns', () => {
        const books = [
            { id: 'book-1', title: 'Novel A', sourceFolder: 'Projects/NovelA' },
            { id: 'book-2', title: 'Novel B', sourceFolder: 'Projects/NovelB' }
        ];

        // No campaign → active book title
        expect(resolveBookTitle(null, books as any, 'Active Title')).toBe('Active Title');

        // Campaign without targetBookId → active book title
        const campaign = {
            id: 'c1', name: 'Launch', isActive: true,
            refreshThresholdDays: 7, exportPath: 'test.png'
        };
        expect(resolveBookTitle(campaign as any, books as any, 'Active Title')).toBe('Active Title');

        // Campaign with targetBookId → locked book title
        const lockedCampaign = { ...campaign, targetBookId: 'book-2' };
        expect(resolveBookTitle(lockedCampaign as any, books as any, 'Active Title')).toBe('Novel B');
    });

    it('resolves project path via targetBookId on campaigns', () => {
        const books = [
            { id: 'book-1', title: 'Novel A', sourceFolder: 'Projects/NovelA' },
            { id: 'book-2', title: 'Novel B', sourceFolder: 'Projects/NovelB' }
        ];

        // No campaign → active source path
        expect(resolveProjectPath(null, books as any, 'Source/Active')).toBe('Source/Active');

        // Campaign without targetBookId → active source path
        const campaign = {
            id: 'c1', name: 'Launch', isActive: true,
            refreshThresholdDays: 7, exportPath: 'test.png'
        };
        expect(resolveProjectPath(campaign as any, books as any, 'Source/Active')).toBe('Source/Active');

        // Campaign with targetBookId → locked book's sourceFolder
        const lockedCampaign = { ...campaign, targetBookId: 'book-1' };
        expect(resolveProjectPath(lockedCampaign as any, books as any, 'Source/Active')).toBe('Projects/NovelA');
    });

    it('uses canonical social contract names outside the migration seam', () => {
        const files = [
            'src/settings/SettingsTab.ts',
            'src/types/settings.ts',
            'src/authorProgress/authorProgressConfig.ts',
            'src/services/authorProgress/AuthorProgressPublishService.ts',
            'src/settings/sections/AuthorProgressSection.ts'
        ];

        const combined = files
            .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
            .join('\n');

        expect(combined.includes('APR_PATH')).toBe(false);
        expect(combined.includes('Author Progress Report')).toBe(false);
        expect(combined.includes('APR campaign management')).toBe(false);
        expect(combined.includes('APR modal')).toBe(false);
        expect(combined.includes('Share · Author Progress Report')).toBe(false);
        expect(combined.includes('preview of your Author Progress Report')).toBe(false);
        expect(combined.includes('Social campaign management and teaser controls')).toBe(true);
        expect(combined.includes("socialTab.createSpan({ text: 'Soc'")).toBe(true);
        expect(combined.includes('Social / authorProgress settings')).toBe(true);
        expect(combined.includes('![Social](')).toBe(true);
        // Path schema lives in aprPaths.ts, not in these contract files
    });
});
