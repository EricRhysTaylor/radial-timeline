import { describe, expect, it } from 'vitest';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import {
    COMMUNITY_DAILY_WINDOW_DAYS,
    buildCommunityDailyEntries,
    buildCommunityHourModeMixEntries,
    buildCommunitySharePreview
} from './communitySharePreview';

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

describe('Community daily activity aggregates', () => {
    const localKey = (date: Date) => {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${month}-${day}`;
    };

    it('builds per-day aggregates with the report redaction policy and no private detail', async () => {
        const now = new Date();
        const todayKey = localKey(now);
        const yesterdayKey = localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

        const plugin = {
            getWritingSessionService: () => ({
                getSettings: () => ({
                    records: [
                        {
                            id: 's1',
                            mode: 'drafting',
                            startedAt: `${todayKey}T09:00:00.000Z`,
                            endedAt: `${todayKey}T10:03:00.000Z`,
                            sessionDate: todayKey,
                            elapsedMs: 63 * 60000,
                            wordsAdded: 1234,
                            scenePaths: ['Books/Private Path/S1.md']
                        },
                        {
                            id: 's2',
                            mode: 'revising',
                            startedAt: `${yesterdayKey}T20:00:00.000Z`,
                            endedAt: `${yesterdayKey}T20:30:00.000Z`,
                            sessionDate: yesterdayKey,
                            elapsedMs: 30 * 60000
                        }
                    ]
                })
            }),
            getSceneData: async () => [
                {
                    date: '',
                    path: 'Books/Private Path/S3.md',
                    title: 'Secret Scene Title',
                    itemType: 'Scene',
                    'Publish Stage': 'Author',
                    status: 'Completed',
                    due: todayKey
                }
            ]
        };

        const entries = await buildCommunityDailyEntries(plugin as never);

        expect(entries).toHaveLength(COMMUNITY_DAILY_WINDOW_DAYS);
        const todayEntry = entries.at(-1);
        expect(todayEntry?.date).toBe(todayKey);
        // Same rounding as the weekly report fields: minutes to 5, words to 50.
        expect(todayEntry?.minutes_total).toBe(65);
        expect(todayEntry?.words_added).toBe(1250);
        expect(todayEntry?.session_count).toBe(1);
        expect(todayEntry?.mode_mix).toEqual({ drafting: 100 });
        expect(todayEntry?.scenes_completed_by_stage).toEqual({ Zero: 0, Author: 1, House: 0, Press: 0 });

        const yesterdayEntry = entries.at(-2);
        expect(yesterdayEntry?.date).toBe(yesterdayKey);
        expect(yesterdayEntry?.minutes_total).toBe(30);
        // Revising minutes never count as drafted words.
        expect(yesterdayEntry?.words_added).toBe(0);
        expect(yesterdayEntry?.mode_mix).toEqual({ revising: 100 });

        // Aggregates only: no scene names, paths, or timestamps leave the vault.
        const serialized = JSON.stringify(entries);
        expect(serialized).not.toContain('Secret Scene Title');
        expect(serialized).not.toContain('Private Path');
        expect(serialized).not.toContain('T09:00');
        expect(serialized).not.toContain('s1');
    });
});

// Same tracer strings as WritingSessionLog.privacy.test.ts. These two exits are
// the real wire path for community data; see writing-session-privacy.md.
const TRACERS = {
    note: 'PRIVACY_TRACER_NOTE_DO_NOT_LEAK',
    scenePath: 'PRIVACY_TRACER_PATH_DO_NOT_LEAK',
    scenesCompletedPath: 'PRIVACY_TRACER_COMPLETED_PATH_DO_NOT_LEAK',
    sceneActivityPath: 'PRIVACY_TRACER_ACTIVITY_PATH_DO_NOT_LEAK',
    bookTitle: 'PRIVACY_TRACER_TITLE_DO_NOT_LEAK',
    sceneTitle: 'PRIVACY_TRACER_SCENE_TITLE_DO_NOT_LEAK',
} as const;

function assertNoTracers(value: unknown): void {
    const serialized = JSON.stringify(value);
    for (const [key, tracer] of Object.entries(TRACERS)) {
        expect(serialized, `tracer "${key}" leaked`).not.toContain(tracer);
    }
}

describe('Community wire path carries no private detail (tracer test)', () => {
    const localKey = (date: Date) => {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${month}-${day}`;
    };
    const todayKey = localKey(new Date());

    function tracedPlugin(fieldPolicy: Record<string, boolean>) {
        const settings = buildDefaultCommunityShareSettings();
        settings.enabled = true;
        settings.tier = 4;
        settings.audience = 'public';
        settings.connection = { status: 'connected', connectionId: 'c', profileId: 'p', projectId: 'pr', secretId: 'rt.community-share.connection-secret' };
        for (const [key, on] of Object.entries(fieldPolicy)) (settings.fieldPolicy as Record<string, boolean>)[key] = on;
        return {
            settings: {
                activeBookId: 'book-1',
                // A working title and NO public label: the report must carry no title at all.
                books: [{ id: 'book-1', title: TRACERS.bookTitle, sourceFolder: `Books/${TRACERS.scenePath}`, genre: 'Fantasy' }],
                communityShare: settings
            },
            getWritingSessionService: () => ({
                getRangeStats: async () => ({
                    startDate: todayKey, endDate: todayKey, days: 7, targetMode: 'words',
                    minutesLogged: 63, sessionsCompleted: 1, wordsDrafted: 1234, daysWithSessions: 1, daysGoalMet: 1,
                    sessionCountByMode: { drafting: 1, revising: 0, editing: 0, planning: 0 },
                    minutesByMode: { drafting: 63, revising: 0, editing: 0, planning: 0 },
                    scenesCompletedByStage: { Zero: 0, Author: 1, House: 0, Press: 0 },
                    freshScenesCompleted: 1, revisionScenesCompleted: 0, sceneCompletionEvents: []
                }),
                getSettings: () => ({
                    records: [{
                        id: 'rec-tracer', bookId: 'book-1', bookTitle: TRACERS.bookTitle, mode: 'drafting', stage: 'Zero',
                        startedAt: `${todayKey}T09:00:00.000Z`, endedAt: `${todayKey}T10:03:00.000Z`, sessionDate: todayKey,
                        elapsedMs: 63 * 60000, wordsAdded: 1234, scenesCompleted: 1,
                        scenePaths: [`Books/${TRACERS.scenePath}.md`],
                        scenesCompletedPaths: [`Books/${TRACERS.scenesCompletedPath}.md`],
                        scenesActivity: [{ path: `Books/${TRACERS.sceneActivityPath}.md`, activeMs: 600000, typedWords: 120 }],
                        note: TRACERS.note, source: 'timer'
                    }]
                })
            }),
            getSceneData: async () => [{
                date: '', path: `Books/${TRACERS.scenePath}.md`, title: TRACERS.sceneTitle, itemType: 'Scene',
                'Publish Stage': 'Author', status: 'Completed', due: todayKey
            }]
        };
    }

    it('daily aggregates: fourteen rows of numbers and dates, no tracer', async () => {
        const entries = await buildCommunityDailyEntries(tracedPlugin({}) as never);
        expect(entries).toHaveLength(COMMUNITY_DAILY_WINDOW_DAYS);
        expect(entries.at(-1)?.minutes_total).toBe(65);
        assertNoTracers(entries);
    });

    it('hour x mode rollup: undated buckets, no tracer', async () => {
        assertNoTracers(await buildCommunityHourModeMixEntries(tracedPlugin({}) as never));
    });

    it('standing report: with every field enabled, a book without a public label sends no title field, and nothing private', async () => {
        const allOn = Object.fromEntries([
            'project.title', 'project.alias', 'project.description', 'project.status', 'project.genre', 'project.custom_genre_label',
            'activity.report_period', 'activity.writing_days', 'activity.minutes_total', 'activity.words_added', 'activity.session_count',
            'activity.mode_mix', 'activity.scenes_completed_by_stage', 'activity.stage_mix', 'activity.completed_scene_count',
            'activity.revised_scene_count', 'activity.streak', 'structure.real_scene_titles', 'activity.exact_session_timestamps'
        ].map(key => [key, true]));
        const preview = await buildCommunitySharePreview(tracedPlugin(allOn) as never);
        expect(preview.payload['project.title']).toBeUndefined();
        expect(preview.payload['project.alias']).toBeUndefined();
        expect(Object.keys(preview.payload).length).toBeGreaterThan(0);
        assertNoTracers(preview.payload);
        assertNoTracers(preview.summary);
        assertNoTracers(preview.fieldManifest);
    });
});

describe('Community hour x mode mix rollup', () => {
    const localKey = (date: Date) => {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${month}-${day}`;
    };

    it('rolls trailing 28-day session minutes into local-hour x mode buckets', async () => {
        const now = new Date();
        const todayKey = localKey(now);
        const staleKey = localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 40));

        const plugin = {
            getWritingSessionService: () => ({
                getSettings: () => ({
                    records: [
                        {
                            id: 's1',
                            mode: 'drafting',
                            startedAt: `${todayKey}T09:15:00.000Z`,
                            endedAt: `${todayKey}T09:45:00.000Z`,
                            sessionDate: todayKey,
                            elapsedMs: 30 * 60000,
                            scenePaths: ['Books/Private Path/S1.md']
                        },
                        {
                            id: 's2',
                            mode: 'editing',
                            startedAt: `${todayKey}T09:50:00.000Z`,
                            endedAt: `${todayKey}T10:10:00.000Z`,
                            sessionDate: todayKey,
                            elapsedMs: 20 * 60000
                        },
                        // Outside the trailing 28-day window: must not appear.
                        {
                            id: 's3',
                            mode: 'planning',
                            startedAt: `${staleKey}T09:00:00.000Z`,
                            endedAt: `${staleKey}T09:30:00.000Z`,
                            sessionDate: staleKey,
                            elapsedMs: 30 * 60000
                        }
                    ]
                })
            })
        };

        const mix = await buildCommunityHourModeMixEntries(plugin as never);

        const hour = new Date(`${todayKey}T09:15:00.000Z`).getHours();
        expect(mix[String(hour)]).toEqual({ drafting: 30, revising: 20, planning: 0 });
        // Only the one populated hour is present — no zero-activity hours,
        // no stale-window entries.
        expect(Object.keys(mix)).toHaveLength(1);

        const serialized = JSON.stringify(mix);
        expect(serialized).not.toContain('Private Path');
        expect(serialized).not.toContain('s1');
        expect(serialized).not.toContain(staleKey);
    });
});
