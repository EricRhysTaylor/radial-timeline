import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_ID, buildDefaultAuthorProgressSettings, migrateAuthorProgressSettings } from '../src/authorProgress/authorProgressConfig';
import { DEFAULT_REPORT_ID, buildReportEmbedPath } from '../src/utils/aprPaths';
import { resolveBookTitle, resolveProjectPath } from '../src/renderer/apr/aprHelpers';

describe('authorProgress contract', () => {
    it('starts a new vault with the Default report drawn with the Default style', () => {
        const fresh = buildDefaultAuthorProgressSettings();
        expect(fresh.schemaVersion).toBe(2);
        expect(fresh.campaigns.map(report => report.id)).toEqual([DEFAULT_REPORT_ID]);
        expect(fresh.campaigns[0].styleProfileId).toBe(DEFAULT_STYLE_ID);
        expect(fresh.styleProfiles.map(style => style.id)).toEqual([DEFAULT_STYLE_ID]);
    });

    it('folds a schema 1 Default report and its manual style into a report and a style', () => {
        const migrated = migrateAuthorProgressSettings({
            enabled: true,
            defaults: {
                authorName: 'A. Writer',
                aprProgressMode: 'full',
                aprBackgroundColor: '#123456',
                aprCenterTransparent: false,
                aprBookTitleFontFamily: 'Palatino',
                aprExportQuality: 'ultra',
                aprDefaultViewMode: 'scenes',
                updateFrequency: 'weekly',
                stalenessThresholdDays: 21,
                lastPublishedDate: '2026-11-01T00:00:00.000Z',
                exportPath: 'Radial Timeline/Social/base/apr-default-auto-weekly-ultra.svg',
                aprCustomBgPresets: [{ label: 'Mine', color: '#abcdef' }]
            },
            styleProfiles: [{ id: 'style-1', name: 'Launch Style', style: { aprBackgroundColor: '#000000' } }],
            designerCampaignId: 'campaign-1',
            designerDraftStyle: { aprBackgroundColor: '#ff0000' },
            campaigns: [
                {
                    id: 'campaign-1',
                    name: 'Launch',
                    styleSource: 'profile',
                    styleProfileId: 'style-1',
                    updateFrequency: 'daily',
                    embedPath: 'Radial Timeline/Social/base/campaigns/apr-launch-auto-daily-large-teaser.png',
                    teaserReveal: { enabled: true, preset: 'fast' }
                },
                { id: 'campaign-2', name: 'Borrowed', styleSource: 'global', aprExportQuality: 'print' },
                { id: 'campaign-3', name: 'Orphan', styleSource: 'profile', styleProfileId: 'deleted-style' }
            ],
            revealCampaign: { enabled: true, nextRevealAt: '2026-01-01' }
        });

        expect(migrated.schemaVersion).toBe(2);
        // Shared settings stay shared; the Default report's own settings leave `defaults`.
        expect(migrated.defaults).toEqual({
            aprProgressMode: 'full',
            aprTrackedStage: 'Zero',
            aprProgressDateStart: undefined,
            aprProgressDateTarget: undefined,
            aprTargetSceneCount: undefined,
            aprStylingExpanded: undefined,
            aprCustomBgPresets: [{ label: 'Mine', color: '#abcdef' }],
            authorName: 'A. Writer'
        });
        expect(JSON.stringify(migrated)).not.toContain('revealCampaign');
        expect(JSON.stringify(migrated)).not.toContain('designer');
        expect(JSON.stringify(migrated)).not.toContain('exportPath');

        // The manual colors and fonts become the style named Default.
        const defaultStyle = migrated.styleProfiles.find(style => style.id === DEFAULT_STYLE_ID);
        expect(defaultStyle?.style).toMatchObject({
            aprBackgroundColor: '#123456',
            aprCenterTransparent: false,
            aprBookTitleFontFamily: 'Palatino'
        });
        // A saved style missing a setting takes it from the old manual style, as it did before.
        expect(migrated.styleProfiles.find(style => style.id === 'style-1')?.style).toMatchObject({
            aprBackgroundColor: '#000000',
            aprBookTitleFontFamily: 'Palatino'
        });

        const [defaultReport, launch, borrowed, orphan] = migrated.campaigns;
        expect(defaultReport).toMatchObject({
            id: DEFAULT_REPORT_ID,
            isActive: true,
            updateFrequency: 'weekly',
            refreshThresholdDays: 21,
            lastPublishedDate: '2026-11-01T00:00:00.000Z',
            exportFormat: 'svg',
            aprExportQuality: 'ultra',
            styleProfileId: DEFAULT_STYLE_ID,
            teaserReveal: { enabled: false, preset: 'standard' },
            viewMode: 'scenes'
        });
        expect(launch).toMatchObject({
            id: 'campaign-1',
            updateFrequency: 'daily',
            exportFormat: 'png',
            // Campaigns inherited the Default quality and view until they chose their own.
            aprExportQuality: 'ultra',
            viewMode: 'scenes',
            styleProfileId: 'style-1',
            teaserReveal: { enabled: true, preset: 'fast' }
        });
        // A campaign that borrowed the manual style, or whose style is gone, uses Default.
        expect(borrowed).toMatchObject({ aprExportQuality: 'print', styleProfileId: DEFAULT_STYLE_ID });
        expect(orphan.styleProfileId).toBe(DEFAULT_STYLE_ID);
    });

    it('gives a campaign older than saved styles a style of its own', () => {
        const migrated = migrateAuthorProgressSettings({
            defaults: { aprBackgroundColor: '#111111' },
            campaigns: [{ id: 'c1', name: 'Kickstarter', customBackgroundColor: '#0B3B2D', customTransparent: false }]
        });
        const campaign = migrated.campaigns.find(report => report.id === 'c1');
        expect(campaign?.styleProfileId).toBe('legacy-style-c1');
        expect(migrated.styleProfiles.find(style => style.id === 'legacy-style-c1')).toMatchObject({
            name: 'Kickstarter Style',
            style: { aprBackgroundColor: '#0B3B2D', aprCenterTransparent: false }
        });
    });

    it('reads schema 2 back unchanged', () => {
        const saved = migrateAuthorProgressSettings({
            defaults: { aprBackgroundColor: '#123456', updateFrequency: 'weekly' },
            campaigns: [{ id: 'c1', name: 'Launch', teaserReveal: { enabled: true, preset: 'slow' } }]
        });
        saved.campaigns[1].viewMode = 'ring';
        saved.styleProfiles[0].style.aprBackgroundColor = '#654321';
        const reloaded = migrateAuthorProgressSettings(JSON.parse(JSON.stringify(saved)));
        expect(reloaded).toEqual(JSON.parse(JSON.stringify(saved)));
    });

    it('puts each report at one derived path', () => {
        const base = {
            name: 'Launch Week', updateFrequency: 'weekly', aprExportQuality: 'ultra', exportFormat: 'png',
            teaserReveal: { enabled: true }
        } as const;
        expect(buildReportEmbedPath({ ...base, id: DEFAULT_REPORT_ID }, 'My Novel'))
            .toBe('Radial Timeline/Social/my-novel/apr-default-auto-weekly-ultra.png');
        expect(buildReportEmbedPath({ ...base, id: 'c1' }, 'My Novel'))
            .toBe('Radial Timeline/Social/my-novel/campaigns/apr-launch-week-auto-weekly-ultra-teaser.png');
        expect(buildReportEmbedPath({ ...base, id: 'c1', updateFrequency: 'manual', teaserReveal: { enabled: false } }, 'My Novel'))
            .toBe('Radial Timeline/Social/my-novel/campaigns/apr-launch-week-manual-ultra.png');
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
        expect(combined.includes("socialTab.createSpan({ text: t('ui.settingsTab.tabSocial')")).toBe(true);
        expect(combined.includes('Social / authorProgress settings')).toBe(true);
        // Path schema lives in aprPaths.ts, not in these contract files
    });
});
