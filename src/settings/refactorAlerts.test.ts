import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import {
    getActiveRefactorAlerts,
    getAllNotificationsForHistory,
    getAllRefactorAlertIds,
} from './refactorAlerts';

describe('settings notification center log-folder alert', () => {
    it('shows the log folder structure notification as the lowest-priority info alert', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        const ids = active.map(alert => alert.id);
        const alert = active.find(item => item.id === 'logs-folder-structure-v1');

        expect(alert).toMatchObject({
            severity: 'info',
            icon: 'folder-tree',
            title: 'Log folders reorganized'
        });
        expect(alert?.description).toContain('Radial Timeline/Logs');
        expect(alert?.description).toContain('Inquiry');
        expect(alert?.description).toContain('Gossamer');
        expect(alert?.description).toContain('Pulse');
        expect(alert?.description).toContain('Moves');
        expect(alert?.description).toContain('Snapshots');
        expect(alert?.description).toContain('Gossamer Archive');
    });

    it('shows the recovery-folder relocation notification as a moderate (warning) alert', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        const alert = active.find(item => item.id === 'recovery-folder-relocation-v1');

        expect(alert).toMatchObject({
            severity: 'warning',
            icon: 'archive-restore',
            title: 'Recovery files moved out of Logs'
        });
        expect(alert?.description).toContain('Radial Timeline/Recover');
        expect(alert?.description).toContain('Snapshots');
        expect(alert?.description).toContain('Gossamer Archive');
    });

    it('shows the Inquiry Pro-button restyle as a low-priority (info) notice, newest last', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        const ids = active.map(alert => alert.id);
        const alert = active.find(item => item.id === 'inquiry-pro-button-design-v1');

        expect(alert).toMatchObject({
            severity: 'info',
            icon: 'sparkles',
            title: 'Inquiry Pro buttons restyled'
        });
        expect(alert?.description).toContain('magenta number');
        expect(alert?.description).toContain('inner ring');
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
            ...DEFAULT_SETTINGS,
            dismissedAlerts: [],
            installAlertBaseline: partialBaseline,
        });
        expect(active.map(a => a.id)).toContain(newestId);
    });

    it('leaves existing users (no baseline) unaffected', () => {
        const active = getActiveRefactorAlerts({ ...DEFAULT_SETTINGS, dismissedAlerts: [] });
        expect(active.length).toBeGreaterThan(0);
    });
});
