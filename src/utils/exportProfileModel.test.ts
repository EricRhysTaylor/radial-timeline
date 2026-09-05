import { describe, expect, it } from 'vitest';
import { buildLegacyTemplateFromModalExportProfile, buildModalExportProfileFromLegacyTemplate, buildTransientModalExportProfile, getModalExportProfileSummary } from './exportProfileModel';

describe('exportProfileModel', () => {
    const templateProfiles = [
        {
            id: 'bundled-fiction-signature-literary',
            assetId: 'bundled-fiction-signature-literary::asset',
            legacyLayoutId: 'bundled-fiction-signature-literary',
            origin: 'built-in' as const,
            name: 'Signature Literary',
            description: 'A refined fiction layout.',
            usageContexts: ['novel' as const],
            outputIntent: 'print-book' as const,
            styleKey: 'signature-literary',
            summary: 'A refined fiction layout.',
            previewMode: 'static' as const,
            capabilities: [],
            requiredBookMetaFields: [],
            recommendedBookMetaFields: [],
            supportedMatterRoles: [],
            status: 'ready' as const,
        }
    ];

    it('preserves stable ids and usage context when adapting legacy templates', () => {
        const profile = buildModalExportProfileFromLegacyTemplate(
            {
                id: 'preset-1',
                name: 'My preset',
                createdAt: '2025-01-01T00:00:00.000Z',
                exportType: 'manuscript',
                manuscriptPreset: 'screenplay',
                outlinePreset: 'beat-sheet',
                outputFormat: 'pdf',
                tocMode: 'none',
                order: 'narrative',
                subplot: 'All Subplots',
                updateWordCounts: false,
                includeSynopsis: false,
                includeMatter: true,
                saveMarkdownArtifact: true,
                exportCleanup: { stripComments: true, stripLinks: false, stripCallouts: false, stripBlockIds: false },
                splitMode: 'single',
                splitParts: 1,
                selectedLayoutId: 'bundled-fiction-signature-literary',
            },
            templateProfiles as any
        );

        expect(profile.id).toBe('preset-1');
        expect(profile.usageContext).toBe('screenplay');
        expect(profile.templateProfileId).toBe('bundled-fiction-signature-literary');

        const roundTrip = buildLegacyTemplateFromModalExportProfile(profile, {
            order: 'narrative',
            subplot: 'All Subplots',
            selectedLayoutId: 'bundled-fiction-signature-literary',
            createdAt: '2025-01-01T00:00:00.000Z',
        });

        expect(roundTrip.id).toBe('preset-1');
        expect(roundTrip.manuscriptPreset).toBe('screenplay');
        expect(roundTrip.selectedLayoutId).toBe('bundled-fiction-signature-literary');
    });

    it('builds a transient profile from current modal state without mutating persistence', () => {
        const profile = buildTransientModalExportProfile({
            name: 'Current settings',
            usageContext: 'novel',
            exportType: 'manuscript',
            outputFormat: 'pdf',
            order: 'chronological',
            subplot: 'Main Plot',
            outlinePreset: 'beat-sheet',
            tocMode: 'none',
            includeMatter: true,
            includeSynopsis: false,
            updateWordCounts: true,
            saveMarkdownArtifact: false,
            cleanup: { stripComments: true, stripLinks: true, stripCallouts: false, stripBlockIds: false },
            splitMode: 'single',
            splitParts: 1,
            selectedLayoutId: 'bundled-fiction-signature-literary',
            templateProfiles: templateProfiles as any,
        });

        expect(profile.templateProfileId).toBe('bundled-fiction-signature-literary');
        expect(profile.selectionPolicy).toBe('full-book');
        expect(getModalExportProfileSummary(profile, templateProfiles as any)).toContain('Current settings');
        expect(getModalExportProfileSummary(profile, templateProfiles as any)).toContain('novel');
    });
});
