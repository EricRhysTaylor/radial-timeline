import { describe, expect, it } from 'vitest';
import { exportProfilesMatch, type ModalExportProfile } from './exportProfileModel';
import { EXPORT_PURPOSES, buildPurposeProfile, builtInPresetId, getExportPurposeForPresetId } from './exportPurposes';

const base: ModalExportProfile = {
    id: 'live',
    name: 'Current settings',
    templateProfileId: 'bundled-fiction-signature-literary',
    usageContext: 'novel',
    outputFormat: 'markdown',
    exportType: 'manuscript',
    outlinePreset: 'beat-sheet',
    tocMode: 'markdown',
    includeSceneIdInToc: false,
    includeSceneIdInHeading: false,
    order: 'chronological',
    subplot: 'Main Plot',
    includeMatter: true,
    includeSynopsis: false,
    updateWordCounts: false,
    saveMarkdownArtifact: true,
    lineBreaksAsParagraphs: true,
    cleanup: { stripComments: false, stripAiComments: false, stripLinks: false, stripCallouts: false, stripBlockIds: false },
    splitMode: 'single',
    splitParts: 1,
    selectionPolicy: 'manual-range',
    rangeStart: 3,
    rangeEnd: 12,
};

const purpose = (id: string) => {
    const found = EXPORT_PURPOSES.find(entry => entry.id === id);
    if (!found) throw new Error(`no purpose ${id}`);
    return found;
};

describe('export purposes', () => {
    it('resolves only built-in preset ids', () => {
        EXPORT_PURPOSES.forEach(entry => expect(getExportPurposeForPresetId(builtInPresetId(entry.id))).toBe(entry));
        expect(getExportPurposeForPresetId('1791403955282')).toBeUndefined();
        expect(getExportPurposeForPresetId(null)).toBeUndefined();
    });

    it('Editor round: Word, scene IDs, questions kept, private notes stripped', () => {
        const profile = buildPurposeProfile(purpose('editor-round'), base);
        expect(profile.outputFormat).toBe('docx');
        expect(profile.includeSceneIdInHeading).toBe(true);
        expect(profile.cleanup).toEqual({ stripComments: true, stripAiComments: false, stripLinks: true, stripCallouts: true, stripBlockIds: true });
        expect(profile.includeMatter).toBe(false);
    });

    it('AI review: Markdown, scene IDs, questions and formatting kept, notes stripped', () => {
        const profile = buildPurposeProfile(purpose('ai-review'), base);
        expect(profile.outputFormat).toBe('markdown');
        expect(profile.includeSceneIdInHeading).toBe(true);
        expect(profile.cleanup).toEqual({ stripComments: true, stripAiComments: false, stripLinks: false, stripCallouts: false, stripBlockIds: false });
    });

    it('Readers: everything stripped, no IDs, keeps PDF and otherwise uses Word', () => {
        const fromMarkdown = buildPurposeProfile(purpose('readers'), base);
        expect(fromMarkdown.outputFormat).toBe('docx');
        expect(fromMarkdown.includeSceneIdInHeading).toBe(false);
        expect(Object.values(fromMarkdown.cleanup).every(Boolean)).toBe(true);
        expect(fromMarkdown.includeMatter).toBe(true);
        const fromPdf = buildPurposeProfile(purpose('readers'), { ...base, outputFormat: 'pdf' });
        expect(fromPdf.outputFormat).toBe('pdf');
        expect(fromPdf.selectionPolicy).toBe('full-book');
    });

    it('keeps the settings a purpose does not own', () => {
        EXPORT_PURPOSES.forEach(entry => {
            const profile = buildPurposeProfile(entry, base);
            expect(profile.order).toBe('chronological');
            expect(profile.subplot).toBe('Main Plot');
            expect(profile.lineBreaksAsParagraphs).toBe(true);
            expect(profile.updateWordCounts).toBe(false);
            expect(profile.templateProfileId).toBe('bundled-fiction-signature-literary');
            expect([profile.rangeStart, profile.rangeEnd]).toEqual([3, 12]);
        });
    });

    it('matches itself once applied, and reports a change to a setting it owns', () => {
        EXPORT_PURPOSES.forEach(entry => {
            const applied = buildPurposeProfile(entry, base);
            expect(exportProfilesMatch(buildPurposeProfile(entry, applied), applied)).toBe(true);
            const overridden = { ...applied, cleanup: { ...applied.cleanup, stripComments: !applied.cleanup.stripComments } };
            expect(exportProfilesMatch(buildPurposeProfile(entry, overridden), overridden)).toBe(false);
        });
    });
});
