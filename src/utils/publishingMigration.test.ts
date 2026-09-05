import { describe, expect, it } from 'vitest';
import type { BookProfile, ManuscriptExportTemplate, TemplateProfile } from '../types';
import { getDefaultManuscriptCleanupOptions } from './manuscriptSanitize';
import {
    convertLegacyManuscriptExportTemplateToExportProfile,
    deriveBookPublishingPreferences,
    migratePublishingModelState,
    normalizeBookPublishingPreferences,
    normalizeExportProfile,
} from './publishingMigration';

function buildLayout(id: string, preset: TemplateProfile['usageContexts'][number]): TemplateProfile {
    return {
        id,
        assetId: `${id}::asset`,
        legacyLayoutId: id,
        origin: 'built-in',
        name: id,
        description: id,
        usageContexts: [preset],
        outputIntent: preset === 'screenplay' ? 'screenplay-pdf' : preset === 'podcast' ? 'podcast-script' : 'print-book',
        tier: 'pro',
        templateKind: preset === 'screenplay' ? 'screenplay' : preset === 'podcast' ? 'podcast' : 'book',
        styleKey: id,
        summary: id,
        previewMode: 'static',
        capabilities: [],
        requiredBookMetaFields: [],
        recommendedBookMetaFields: [],
        supportedMatterRoles: [],
        status: 'ready',
    };
}

describe('publishing migration', () => {
    it('normalizes export profiles without coercing usage context to novel', () => {
        const profile = normalizeExportProfile({
            id: 'preset-screenplay',
            name: 'Screenplay Export',
            templateProfileId: 'bundled-screenplay',
            usageContext: 'screenplay',
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'screenplay',
            cleanup: getDefaultManuscriptCleanupOptions('pdf'),
        });

        expect(profile.id).toBe('preset-screenplay');
        expect(profile.usageContext).toBe('screenplay');
        expect(profile.manuscriptPreset).toBe('screenplay');
        expect(profile.templateProfileId).toBe('bundled-screenplay');
    });

    it('migrates a legacy manuscript export template into an export profile', () => {
        const legacy: ManuscriptExportTemplate = {
            id: 'legacy-novel-pdf',
            name: 'Legacy Novel PDF',
            createdAt: '2025-01-01T00:00:00.000Z',
            exportType: 'manuscript',
            manuscriptPreset: 'novel',
            outlinePreset: 'beat-sheet',
            outputFormat: 'pdf',
            tocMode: 'markdown',
            order: 'narrative',
            subplot: 'All Subplots',
            updateWordCounts: false,
            includeSynopsis: false,
            includeMatter: true,
            saveMarkdownArtifact: false,
            exportCleanup: getDefaultManuscriptCleanupOptions('pdf'),
            splitMode: 'single',
            splitParts: 3,
            selectedLayoutId: 'bundled-fiction-signature-literary',
        };

        const profile = convertLegacyManuscriptExportTemplateToExportProfile(legacy, [buildLayout('bundled-fiction-signature-literary', 'novel')]);
        expect(profile.id).toBe('legacy-novel-pdf');
        expect(profile.templateProfileId).toBe('bundled-fiction-signature-literary');
        expect(profile.usageContext).toBe('novel');
        expect(profile.manuscriptPreset).toBe('novel');
    });

    it('derives book publishing preferences from legacy per-book layout selection', () => {
        const book: BookProfile = {
            id: 'book-1',
            title: 'Book',
            sourceFolder: 'Books/Book',
            lastUsedPandocLayoutByPreset: {
                novel: 'bundled-fiction-signature-literary',
            },
        };
        const prefs = deriveBookPublishingPreferences(
            book,
            [
                {
                    ...buildLayout('bundled-fiction-signature-literary', 'novel'),
                    outputIntent: 'print-book',
                },
                {
                    ...buildLayout('preset-novel-pdf', 'novel'),
                    outputIntent: 'print-book',
                },
            ],
            'preset-novel-pdf'
        );

        expect(prefs?.bookId).toBe('book-1');
        expect(prefs?.preferredTemplateProfileIdByContext?.novel).toBe('bundled-fiction-signature-literary');
        expect(prefs?.defaultExportProfileId).toBe('preset-novel-pdf');
    });

    it('migrates legacy template and book state into export profiles and preferences', () => {
        const legacy: ManuscriptExportTemplate = {
            id: 'legacy-podcast',
            name: 'Podcast Export',
            createdAt: '2025-01-01T00:00:00.000Z',
            exportType: 'manuscript',
            manuscriptPreset: 'podcast',
            outlinePreset: 'beat-sheet',
            outputFormat: 'markdown',
            tocMode: 'none',
            order: 'narrative',
            subplot: 'All Subplots',
            updateWordCounts: false,
            includeSynopsis: false,
            includeMatter: true,
            saveMarkdownArtifact: true,
            exportCleanup: getDefaultManuscriptCleanupOptions('markdown'),
            splitMode: 'single',
            splitParts: 3,
            selectedLayoutId: 'bundled-podcast',
        };

        const result = migratePublishingModelState({
            books: [{
                id: 'book-1',
                title: 'Book',
                sourceFolder: 'Books/Book',
                lastUsedPandocLayoutByPreset: {
                    podcast: 'bundled-podcast',
                },
            }],
            activeBookId: 'book-1',
            exportProfiles: [],
            bookPublishingPreferences: [],
            manuscriptExportTemplates: [legacy],
            lastUsedManuscriptExportTemplateId: 'legacy-podcast',
            lastUsedExportProfileId: undefined,
        }, [buildLayout('bundled-podcast', 'podcast')]);

        expect(result.exportProfiles).toHaveLength(1);
        expect(result.exportProfiles[0].usageContext).toBe('podcast');
        expect(result.exportProfiles[0].templateProfileId).toBe('bundled-podcast');
        expect(result.bookPublishingPreferences).toHaveLength(1);
        expect(result.bookPublishingPreferences[0].preferredTemplateProfileIdByContext?.podcast).toBe('bundled-podcast');
        expect(result.lastUsedExportProfileId).toBe('legacy-podcast');
    });

    it('preserves last-used modal snapshots in book publishing preferences', () => {
        const cleanup = {
            ...getDefaultManuscriptCleanupOptions('markdown'),
            stripComments: true,
            stripLinks: true,
        };
        const prefs = normalizeBookPublishingPreferences({
            bookId: 'book-1',
            lastUsedExportProfileSnapshot: {
                id: '__last_used_snapshot__',
                name: 'Last used',
                templateProfileId: 'bundled-fiction-classic-manuscript',
                usageContext: 'novel',
                exportType: 'manuscript',
                outputFormat: 'markdown',
                manuscriptPreset: 'novel',
                tocMode: 'markdown',
                includeSceneIdInToc: true,
                includeSceneIdInHeading: false,
                order: 'chronological',
                subplot: 'Main Plot',
                includeMatter: false,
                includeSynopsis: false,
                updateWordCounts: false,
                saveMarkdownArtifact: false,
                cleanup,
                splitMode: 'parts',
                splitParts: 3,
                selectionPolicy: 'manual-range',
                rangeStart: 2,
                rangeEnd: 8,
            },
        });

        expect(prefs?.lastUsedExportProfileSnapshot?.outputFormat).toBe('markdown');
        expect(prefs?.lastUsedExportProfileSnapshot?.cleanup.stripComments).toBe(true);
        expect(prefs?.lastUsedExportProfileSnapshot?.cleanup.stripLinks).toBe(true);
        expect(prefs?.lastUsedExportProfileSnapshot?.order).toBe('chronological');
        expect(prefs?.lastUsedExportProfileSnapshot?.rangeStart).toBe(2);
    });
});
