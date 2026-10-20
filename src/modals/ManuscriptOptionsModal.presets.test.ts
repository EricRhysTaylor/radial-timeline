import { describe, expect, it, vi } from 'vitest';
import { ManuscriptOptionsModal } from './ManuscriptOptionsModal';
import type { RadialTimelineSettings } from '../types';
import { buildModalExportProfile, type ModalExportProfile } from '../utils/exportProfileModel';
import { migratePublishingModelState, normalizeExportProfile } from '../utils/publishingMigration';

interface PresetHarness {
    plugin: { settings: RadialTimelineSettings; saveSettings: () => Promise<void> };
    exportProfiles: ModalExportProfile[];
    selectedExportProfileId: string | null;
    selectedExportProfile: ModalExportProfile;
    defaultExportProfile: ModalExportProfile;
    refreshTemplateDropdown: () => void;
    updateExportProfileSummary: () => void;
    deleteTemplate: (id: string) => Promise<void>;
    refreshExportProfileState: () => void;
    getActiveBookPublishingPreferences: () => { bookId: string; defaultExportProfileId?: string };
    buildLiveProfile: () => ModalExportProfile;
    lastUsedPresetId: string | null;
}

function harness(fail = false) {
    const preset = normalizeExportProfile({ id: 'remove', name: 'Remove', templateProfileId: 'layout', usageContext: 'novel' });
    const retained = normalizeExportProfile({ id: 'keep', name: 'Keep', templateProfileId: 'layout', usageContext: 'novel' });
    const settings = {
        books: [{ id: 'a', title: 'A', sourceFolder: 'A' }, { id: 'b', title: 'B', sourceFolder: 'B' }],
        activeBookId: 'a', pandocLayouts: [],
        exportProfiles: [preset, retained], lastUsedExportProfileId: preset.id,
        bookPublishingPreferences: [
            { bookId: 'a', defaultExportProfileId: preset.id, lastUsedExportProfileId: preset.id, profileOverrides: {} },
            { bookId: 'b', defaultExportProfileId: retained.id, lastUsedExportProfileId: preset.id },
        ],
    } as unknown as RadialTimelineSettings;
    const modal = Object.create(ManuscriptOptionsModal.prototype) as PresetHarness;
    const save = vi.fn(async () => {
        Object.assign(settings, migratePublishingModelState(settings));
        if (fail) throw new Error('QA write denied');
    });
    Object.assign(modal, {
        plugin: { settings, saveSettings: save },
        exportProfiles: [preset, retained].map(profile => buildModalExportProfile(profile, [])),
        selectedExportProfileId: preset.id, selectedExportProfile: buildModalExportProfile(preset, []),
        defaultExportProfile: buildModalExportProfile(retained, []),
        refreshTemplateDropdown: vi.fn(), updateExportProfileSummary: vi.fn(),
    });
    return { modal, settings, save };
}

describe('export preset persistence', () => {
    it('deletes the preset and all book assignments in one save', async () => {
        const { modal, settings, save } = harness();
        await modal.deleteTemplate('remove');
        expect(save).toHaveBeenCalledTimes(1);
        expect(settings.exportProfiles?.map(profile => profile.id)).toEqual(['keep']);
        expect(settings.bookPublishingPreferences?.[0]?.defaultExportProfileId).toBeUndefined();
        expect(settings.bookPublishingPreferences?.[1]?.defaultExportProfileId).toBe('keep');
        expect(settings.bookPublishingPreferences?.map(book => book.lastUsedExportProfileId)).toEqual([undefined, undefined]);
        expect(settings.lastUsedExportProfileId).toBeUndefined();
        expect(modal.selectedExportProfileId).toBeNull();
    });

    it('retains the saved preset and assignments when persistence rejects', async () => {
        const { modal, settings } = harness(true);
        const before = structuredClone(settings);
        await expect(modal.deleteTemplate('remove')).rejects.toThrow('QA write denied');
        expect(settings.exportProfiles).toEqual(before.exportProfiles);
        expect(settings.bookPublishingPreferences).toEqual(before.bookPublishingPreferences);
        expect(settings.lastUsedExportProfileId).toBe('remove');
        expect(modal.selectedExportProfileId).toBe('remove');
    });

    it('does not load a global preset ahead of another book\'s explicit default', () => {
        const { modal } = harness();
        modal.getActiveBookPublishingPreferences = () => ({ bookId: 'b', defaultExportProfileId: 'keep' });
        modal.buildLiveProfile = () => modal.defaultExportProfile;
        modal.refreshExportProfileState();
        expect(modal.lastUsedPresetId).toBeNull();
    });
});
