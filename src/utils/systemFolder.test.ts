import { describe, expect, it } from 'vitest';
import { RT_SYSTEM_FOLDER, systemFolderPath } from './systemFolder';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { DEFAULT_INQUIRY_ARTIFACT_FOLDER } from '../inquiry/constants';
import { INQUIRY_SIDECAR_DIR } from '../inquiry/InquiryArtifactStore';
import { TIMELINE_SNAPSHOT_FOLDER } from '../timelineRepair/timelineSnapshot';
import { buildDefaultEmbedPath } from './aprPaths';

describe('systemFolderPath', () => {
    it('names the plugin\'s single top-level vault folder', () => {
        expect(RT_SYSTEM_FOLDER).toBe('Radial Timeline');
        expect(systemFolderPath()).toBe('Radial Timeline');
    });

    it('joins segments under the canonical root', () => {
        expect(systemFolderPath('Logs')).toBe('Radial Timeline/Logs');
        expect(systemFolderPath('Snapshots', 'Timeline')).toBe('Radial Timeline/Snapshots/Timeline');
    });
});

describe('canonical folder callers', () => {
    it('resolve every plugin-owned destination under the one root', () => {
        const destinations = [
            DEFAULT_SETTINGS.aiOutputFolder,
            DEFAULT_SETTINGS.manuscriptOutputFolder,
            DEFAULT_SETTINGS.outlineOutputFolder,
            DEFAULT_SETTINGS.pandocFolder,
            DEFAULT_INQUIRY_ARTIFACT_FOLDER,
            INQUIRY_SIDECAR_DIR,
            TIMELINE_SNAPSHOT_FOLDER,
            buildDefaultEmbedPath({ bookTitle: 'My Novel' }),
        ];
        for (const destination of destinations) {
            expect(destination).toBeTruthy();
            expect(destination?.startsWith(`${RT_SYSTEM_FOLDER}/`)).toBe(true);
        }
    });
});
