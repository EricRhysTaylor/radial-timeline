import { describe, expect, it } from 'vitest';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import { buildCommunitySharePreview } from './communitySharePreview';

describe('Community Share preview builder', () => {
    it('builds a public aggregate payload without private titles or sensitive fields', async () => {
        const settings = buildDefaultCommunityShareSettings();
        settings.enabled = true;
        settings.tier = 3;
        settings.audience = 'public';
        settings.connection = {
            status: 'connected',
            connectionId: 'connection-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        settings.fieldPolicy['project.title'] = true;
        settings.fieldPolicy['project.genre'] = true;
        settings.fieldPolicy['activity.words_added'] = true;
        settings.fieldPolicy['activity.minutes_total'] = true;
        settings.fieldPolicy['activity.session_count'] = true;
        settings.fieldPolicy['activity.exact_session_timestamps'] = true;

        const plugin = {
            settings: {
                activeBookId: 'book-1',
                books: [{
                    id: 'book-1',
                    title: 'Private Local Draft Title',
                    publicLabel: 'Public Project Alias',
                    sourceFolder: 'Books/Private Path',
                    genre: 'Fantasy'
                }],
                communityShare: settings
            },
            getWritingSessionService: () => ({
                getRangeStats: async () => ({
                    startDate: '2026-06-21',
                    endDate: '2026-06-27',
                    days: 7,
                    targetMode: 'words',
                    minutesLogged: 63,
                    sessionsCompleted: 4,
                    wordsDrafted: 1234,
                    daysWithSessions: 3,
                    daysGoalMet: 2,
                    sessionCountByMode: { drafting: 4, revising: 0, editing: 0, planning: 0 },
                    minutesByMode: { drafting: 63, revising: 0, editing: 0, planning: 0 },
                    scenesCompletedByStage: { Zero: 0, Author: 0, House: 0, Press: 0 },
                    freshScenesCompleted: 0,
                    revisionScenesCompleted: 0,
                    sceneCompletionEvents: []
                })
            }),
            getSceneData: async () => []
        };

        const preview = await buildCommunitySharePreview(plugin as never);

        expect(preview.payload['project.title']).toBe('Public Project Alias');
        expect(JSON.stringify(preview.payload)).not.toContain('Private Local Draft Title');
        expect(JSON.stringify(preview.payload)).not.toContain('Private Path');
        expect(preview.payload['activity.words_added']).toBe(1250);
        expect(preview.payload['activity.minutes_total']).toBe(65);
        expect(preview.payload['activity.session_count']).toBe('4-7');
        expect(preview.payload['activity.exact_session_timestamps']).toBeUndefined();
        expect(preview.fieldManifest['activity.exact_session_timestamps']?.enabled).toBe(false);
        expect(preview.payloadHash).toMatch(/^[0-9a-f]{64}$/);
        expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('publishes stage_mix as the current whole-book stage distribution, distinct from period completions', async () => {
        const settings = buildDefaultCommunityShareSettings();
        settings.enabled = true;
        settings.tier = 4;
        settings.audience = 'public';
        settings.connection = {
            status: 'connected',
            connectionId: 'connection-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        settings.fieldPolicy['activity.stage_mix'] = true;
        settings.fieldPolicy['activity.scenes_completed_by_stage'] = true;

        const plugin = {
            settings: {
                activeBookId: 'book-1',
                books: [{
                    id: 'book-1',
                    title: 'Private Local Draft Title',
                    publicLabel: 'Public Project Alias',
                    sourceFolder: 'Books/Private Path',
                    genre: 'Fantasy'
                }],
                communityShare: settings
            },
            getWritingSessionService: () => ({
                getRangeStats: async () => ({
                    startDate: '2026-06-21',
                    endDate: '2026-06-27',
                    days: 7,
                    targetMode: 'words',
                    minutesLogged: 0,
                    sessionsCompleted: 0,
                    wordsDrafted: 0,
                    daysWithSessions: 0,
                    daysGoalMet: 0,
                    sessionCountByMode: { drafting: 0, revising: 0, editing: 0, planning: 0 },
                    minutesByMode: { drafting: 0, revising: 0, editing: 0, planning: 0 },
                    // Nothing completed in the report period — the old bug
                    // published this all-zero record as the "stage mix".
                    scenesCompletedByStage: { Zero: 0, Author: 0, House: 0, Press: 0 },
                    freshScenesCompleted: 0,
                    revisionScenesCompleted: 0,
                    sceneCompletionEvents: []
                })
            }),
            getSceneData: async () => [
                { date: '', path: 'Books/Private Path/S1.md', itemType: 'Scene', 'Publish Stage': 'Zero', status: 'Working' },
                { date: '', path: 'Books/Private Path/S2.md', itemType: 'Scene', 'Publish Stage': 'zero', status: 'Todo' },
                { date: '', path: 'Books/Private Path/S3.md', itemType: 'Scene', 'Publish Stage': 'Author', status: 'Completed' },
                // Different book: excluded from the connected book's mix.
                { date: '', path: 'Elsewhere/S9.md', bookId: 'book-2', itemType: 'Scene', 'Publish Stage': 'Press', status: 'Todo' },
                // Beat note: never counted as a scene.
                { date: '', path: 'Books/Private Path/beat.md', itemType: 'Beat', 'Publish Stage': 'Press' }
            ]
        };

        const preview = await buildCommunitySharePreview(plugin as never);

        expect(preview.payload['activity.stage_mix']).toEqual({ Zero: 2, Author: 1, House: 0, Press: 0 });
        expect(preview.payload['activity.scenes_completed_by_stage']).toEqual({ Zero: 0, Author: 0, House: 0, Press: 0 });
    });
});
