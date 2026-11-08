import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import {
    getActiveMigrations,
    getActiveRefactorAlerts,
    getAllNotificationsForHistory,
    getAllRefactorAlertIds,
} from './refactorAlerts';
import { POV_TO_NARRATION_ALERT_ID } from '../utils/narrationMigration';

vi.mock('../i18n', () => ({ t: (key: string) => key }));

/** A vault from before Narration: its stored Core scene template still has POV. */
const upgraderSettings = () => ({
    ...DEFAULT_SETTINGS,
    dismissedAlerts: [],
    sceneYamlTemplates: {
        base: DEFAULT_SETTINGS.sceneYamlTemplates!.base.replace('Character: {{Character}}', 'Character: {{Character}}\nPOV:'),
        advanced: DEFAULT_SETTINGS.sceneYamlTemplates!.advanced,
    },
});

describe('POV → Narration alert', () => {
    it('is offered while the Core scene template still has POV', () => {
        const alert = getActiveRefactorAlerts(upgraderSettings()).find(item => item.id === POV_TO_NARRATION_ALERT_ID);
        expect(alert).toMatchObject({ severity: 'warning', migratesNotes: true });
        expect(alert?.migrations).toEqual([expect.objectContaining({ oldKey: 'POV', newKey: 'Narration' })]);
    });

    it('is not offered to a template without POV, and is history once dismissed', () => {
        expect(getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] }).map(a => a.id)).not.toContain(POV_TO_NARRATION_ALERT_ID);
        const dismissed = { ...upgraderSettings(), dismissedAlerts: [POV_TO_NARRATION_ALERT_ID] };
        expect(getActiveRefactorAlerts(dismissed).map(a => a.id)).not.toContain(POV_TO_NARRATION_ALERT_ID);
        expect(getAllNotificationsForHistory(dismissed).map(a => a.id)).toContain(POV_TO_NARRATION_ALERT_ID);
    });

    it('offers no one-click rename in the Advanced YAML editor, because it rewrites scene notes', () => {
        expect(getActiveMigrations(upgraderSettings()).map(m => m.alertId)).not.toContain(POV_TO_NARRATION_ALERT_ID);
        expect(getActiveMigrations(upgraderSettings()).map(m => m.alertId)).toContain('yaml-revision-to-iteration-v6');
    });
});

describe('settings notification center log-folder alert', () => {
    it('shows the log folder structure notification as the lowest-priority info alert', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        const ids = active.map(alert => alert.id);
        const alert = active.find(item => item.id === 'logs-folder-structure-v1');

        expect(alert).toMatchObject({
            severity: 'info',
            icon: 'folder-tree',
            title: 'ui.refactorAlerts.logFoldersTitle'
        });
        expect(alert?.description).toBe('ui.refactorAlerts.logFoldersDescription');
    });

    it('shows the recovery-folder relocation notification as a moderate (warning) alert', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        const alert = active.find(item => item.id === 'recovery-folder-relocation-v1');

        expect(alert).toMatchObject({
            severity: 'warning',
            icon: 'archive-restore',
            title: 'ui.refactorAlerts.recoveryFilesTitle'
        });
        expect(alert?.description).toBe('ui.refactorAlerts.recoveryFilesDescription');
    });

    it('shows the Inquiry Pro-button restyle as a low-priority (info) notice, newest last', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        const ids = active.map(alert => alert.id);
        const alert = active.find(item => item.id === 'inquiry-pro-button-design-v1');

        expect(alert).toMatchObject({
            severity: 'info',
            icon: 'sparkles',
            title: 'ui.refactorAlerts.inquiryProButtonsTitle'
        });
        expect(alert?.description).toBe('ui.refactorAlerts.inquiryProButtonsDescription');
        // Newest notification sorts last in the active list.
        expect(ids.at(-1)).toBe('inquiry-pro-button-design-v1');
    });
});

describe('fresh-install alert baseline', () => {
    it('suppresses every pre-install alert from the active list', () => {
        const baseline = getAllRefactorAlertIds();
        const active = getActiveRefactorAlerts({
            ...DEFAULT_SETTINGS,
            dismissedAlerts: [],
            installAlertBaseline: baseline,
        });
        expect(active).toEqual([]);
    });

    it('keeps pre-install alerts out of the processed-notifications history too', () => {
        const baseline = getAllRefactorAlertIds();
        const history = getAllNotificationsForHistory({
            ...DEFAULT_SETTINGS,
            dismissedAlerts: [],
            installAlertBaseline: baseline,
        });
        expect(history).toEqual([]);
    });

    it('still surfaces a new alert introduced after install (id not in baseline)', () => {
        // Simulate a vault installed before the newest alert existed: the
        // baseline holds every id except the most recent one.
        const allIds = getAllRefactorAlertIds();
        const newestId = allIds.at(-1)!;
        const partialBaseline = allIds.filter(id => id !== newestId);
        const active = getActiveRefactorAlerts({
            ...upgraderSettings(),
            installAlertBaseline: partialBaseline,
        });
        expect(active.map(a => a.id)).toContain(newestId);
    });

    it('leaves existing users (no baseline) unaffected', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        expect(active.length).toBeGreaterThan(0);
    });
});
