import { describe, expect, it } from 'vitest';
import { buildLegacyTemplateFromModalExportProfile, buildModalExportProfileFromLegacyTemplate, buildTransientModalExportProfile, exportProfilesMatch, getModalExportProfileSummary, resolveIncludeSceneId, type ModalExportProfile } from './exportProfileModel';

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

    describe('preset matching', () => {
        // Shape of a Word preset as saved by the export modal: the TOC flag is
        // stored false because Word has no TOC, while the heading flag is on.
        const wordPreset: ModalExportProfile = {
            id: 'word-edits',
            name: 'Word edits',
            templateProfileId: 'bundled-fiction-signature-literary',
            usageContext: 'novel',
            outputFormat: 'docx',
            exportType: 'manuscript',
            manuscriptPreset: 'novel',
            outlinePreset: 'beat-sheet',
            tocMode: 'none',
            includeSceneIdInToc: false,
            includeSceneIdInHeading: true,
            order: 'narrative',
            subplot: 'All Subplots',
            includeMatter: false,
            includeSynopsis: false,
            updateWordCounts: true,
            saveMarkdownArtifact: false,
            cleanup: { stripComments: true, stripAiComments: false, stripLinks: true, stripCallouts: true, stripBlockIds: true },
            splitMode: 'single',
            splitParts: 1,
            selectionPolicy: 'manual-range',
            selectedLayoutId: 'bundled-fiction-signature-literary',
        };

        it('reads SceneId as on when either flag is on', () => {
            expect(resolveIncludeSceneId({ includeSceneIdInToc: false, includeSceneIdInHeading: true })).toBe(true);
            expect(resolveIncludeSceneId({ includeSceneIdInToc: true, includeSceneIdInHeading: undefined })).toBe(true);
            expect(resolveIncludeSceneId({ includeSceneIdInToc: false, includeSceneIdInHeading: false })).toBe(false);
            expect(resolveIncludeSceneId({})).toBe(false);
        });

        it('matches a preset against the modal state it loads into', () => {
            const loaded: ModalExportProfile = { ...wordPreset, createdAt: '2026-10-07T00:00:00.000Z', rangeStart: 1, rangeEnd: 40 };
            expect(exportProfilesMatch(loaded, wordPreset)).toBe(true);
        });

        it('ignores fields the export mode does not use', () => {
            const legacyMarkdown: ModalExportProfile = { ...wordPreset, outputFormat: 'markdown', tocMode: 'markdown', includeMatter: true, selectionPolicy: 'full-book', selectedLayoutId: 'other-layout' };
            const live: ModalExportProfile = { ...legacyMarkdown, includeMatter: false, includeSceneIdInToc: true, selectionPolicy: 'manual-range', selectedLayoutId: undefined };
            expect(exportProfilesMatch(live, legacyMarkdown)).toBe(true);
        });

        it('reports a real change', () => {
            const edited: ModalExportProfile = { ...wordPreset, cleanup: { ...wordPreset.cleanup, stripBlockIds: false } };
            expect(exportProfilesMatch(edited, wordPreset)).toBe(false);
            expect(exportProfilesMatch({ ...wordPreset, includeSceneIdInHeading: false }, wordPreset)).toBe(false);
        });
    });
});
