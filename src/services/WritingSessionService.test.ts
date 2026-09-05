import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../types';
import type { WritingSessionRecord } from '../types/settings';
import {
    buildDailyWritingStats,
    buildDailyWritingSessionProgress,
    buildCorruptSessionLogPath,
    buildWritingRangeStats,
    collectSceneCompletionEvents,
    parsePortableSessionLog,
    normalizeWritingSessionsSettings,
    WritingSessionService
} from './WritingSessionService';

describe('WritingSessionService pure helpers', () => {
    it('derives scene completion events by date, stage, and fresh/revision kind', () => {
        const scenes: TimelineItem[] = [
            {
                title: 'Scene 1',
                path: 'Book/Scene 1.md',
                date: '',
                status: 'Complete',
                due: '2026-05-12',
                'Publish Stage': 'Zero',
            },
            {
                title: 'Scene 2',
                path: 'Book/Scene 2.md',
                date: '',
                status: ['Complete'],
                due: '2026-05-12',
                'Publish Stage': 'Author',
            },
            {
                title: 'Scene 3',
                path: 'Book/Scene 3.md',
                date: '',
                status: 'Working',
                due: '2026-05-12',
                'Publish Stage': 'House',
            },
        ];

        expect(collectSceneCompletionEvents(scenes)).toEqual([
            expect.objectContaining({
                date: '2026-05-12',
                stage: 'Zero',
                workKind: 'fresh',
                revisionRound: 'Zero',
                path: 'Book/Scene 1.md',
            }),
            expect.objectContaining({
                date: '2026-05-12',
                stage: 'Author',
                workKind: 'revision',
                revisionRound: 'Author',
                path: 'Book/Scene 2.md',
            }),
        ]);
    });

    it('combines timer sessions with scene completion stats for a day', () => {
        const sessions: WritingSessionRecord[] = [
            {
                id: 'session-1',
                mode: 'drafting',
                startedAt: '2026-05-12T16:00:00.000Z',
                endedAt: '2026-05-12T17:00:00.000Z',
                elapsedMs: 60 * 60 * 1000,
                wordsAdded: 1200,
                source: 'timer',
            },
            {
                id: 'session-2',
                mode: 'editing',
                startedAt: '2026-05-11T16:00:00.000Z',
                endedAt: '2026-05-11T17:00:00.000Z',
                elapsedMs: 60 * 60 * 1000,
                source: 'timer',
            },
        ];
        const scenes: TimelineItem[] = [
            { title: 'Fresh', date: '', status: 'Complete', due: '2026-05-12', 'Publish Stage': 'Zero' },
            { title: 'Revision', date: '', status: 'Complete', due: '2026-05-12', 'Publish Stage': 'House' },
        ];

        const stats = buildDailyWritingStats({ date: '2026-05-12', sessions, scenes });

        expect(stats.minutesLogged).toBe(60);
        expect(stats.sessionsCompleted).toBe(1);
        expect(stats.wordsDrafted).toBe(1200);
        expect(stats.sessionCountByMode.drafting).toBe(1);
        expect(stats.sessionCountByMode.editing).toBe(0);
        expect(stats.scenesCompletedByStage).toEqual({
            Zero: 1,
            Author: 0,
            House: 1,
            Press: 0,
        });
    });

    it('builds range stats with goal days and fresh versus revision completions', () => {
        const sessions: WritingSessionRecord[] = [
            {
                id: 'session-1',
                mode: 'drafting',
                startedAt: '2026-05-10T16:00:00.000Z',
                endedAt: '2026-05-10T17:00:00.000Z',
                elapsedMs: 60 * 60 * 1000,
                wordsAdded: 900,
                source: 'timer',
            },
            {
                id: 'session-2',
                mode: 'editing',
                startedAt: '2026-05-12T16:00:00.000Z',
                endedAt: '2026-05-12T16:45:00.000Z',
                elapsedMs: 45 * 60 * 1000,
                source: 'timer',
            },
        ];
        const scenes: TimelineItem[] = [
            { title: 'Fresh', date: '', status: 'Complete', due: '2026-05-10', 'Publish Stage': 'Zero' },
            { title: 'Revision', date: '', status: 'Complete', due: '2026-05-12', 'Publish Stage': 'House' },
            { title: 'Old', date: '', status: 'Complete', due: '2026-04-30', 'Publish Stage': 'Press' },
        ];

        const stats = buildWritingRangeStats({
            endDate: '2026-05-12',
            days: 7,
            sessions,
            scenes,
            dailyTargetMinutes: 45,
        });

        expect(stats.startDate).toBe('2026-05-06');
        expect(stats.minutesLogged).toBe(105);
        expect(stats.sessionsCompleted).toBe(2);
        expect(stats.wordsDrafted).toBe(900);
        expect(stats.daysWithSessions).toBe(2);
        expect(stats.daysGoalMet).toBe(2);
        expect(stats.freshScenesCompleted).toBe(1);
        expect(stats.revisionScenesCompleted).toBe(1);
        expect(stats.scenesCompletedByStage).toEqual({
            Zero: 1,
            Author: 0,
            House: 1,
            Press: 0,
        });
    });

    it('subtracts completed sessions from the daily writing goal', () => {
        const sessions: WritingSessionRecord[] = [
            {
                id: 'session-1',
                mode: 'drafting',
                startedAt: '2026-05-12T16:00:00.000Z',
                endedAt: '2026-05-12T16:02:00.000Z',
                elapsedMs: 2 * 60 * 1000,
                source: 'timer',
            },
            {
                id: 'session-2',
                mode: 'editing',
                startedAt: '2026-05-12T17:00:00.000Z',
                endedAt: '2026-05-12T17:03:00.000Z',
                elapsedMs: 3 * 60 * 1000,
                source: 'timer',
            },
        ];

        const stats = buildDailyWritingSessionProgress({
            date: '2026-05-12',
            sessions,
            dailyTargetMinutes: 10,
        });

        expect(stats.minutesLogged).toBe(5);
        expect(stats.sessionsCompleted).toBe(2);
        expect(stats.remainingMinutes).toBe(5);
        expect(stats.overGoalMinutes).toBe(0);
    });

    it('starts a new day fresh when there are no completed sessions for that date', () => {
        const sessions: WritingSessionRecord[] = [
            {
                id: 'session-1',
                mode: 'drafting',
                startedAt: '2026-05-12T16:00:00.000Z',
                endedAt: '2026-05-12T18:00:00.000Z',
                elapsedMs: 120 * 60 * 1000,
                source: 'timer',
            },
        ];

        const stats = buildDailyWritingSessionProgress({
            date: '2026-05-13',
            sessions,
            dailyTargetMinutes: 120,
        });

        expect(stats.minutesLogged).toBe(0);
        expect(stats.sessionsCompleted).toBe(0);
        expect(stats.remainingMinutes).toBe(120);
        expect(stats.overGoalMinutes).toBe(0);
    });

    it('keeps extra completed sessions after the daily goal is exceeded', () => {
        const sessions: WritingSessionRecord[] = [
            {
                id: 'session-1',
                mode: 'drafting',
                startedAt: '2026-05-12T16:00:00.000Z',
                endedAt: '2026-05-12T16:14:00.000Z',
                elapsedMs: 14 * 60 * 1000,
                source: 'timer',
            },
        ];

        const stats = buildDailyWritingSessionProgress({
            date: '2026-05-12',
            sessions,
            dailyTargetMinutes: 10,
        });

        expect(stats.minutesLogged).toBe(14);
        expect(stats.remainingMinutes).toBe(0);
        expect(stats.overGoalMinutes).toBe(4);
    });

    it('tracks daily word targets from drafting session records', () => {
        const sessions: WritingSessionRecord[] = [
            {
                id: 'session-1',
                mode: 'drafting',
                startedAt: '2026-05-12T16:00:00.000Z',
                endedAt: '2026-05-12T16:30:00.000Z',
                elapsedMs: 30 * 60 * 1000,
                wordsAdded: 800,
                source: 'timer',
            },
            {
                id: 'session-2',
                mode: 'editing',
                startedAt: '2026-05-12T17:00:00.000Z',
                endedAt: '2026-05-12T17:30:00.000Z',
                elapsedMs: 30 * 60 * 1000,
                wordsAdded: 500,
                source: 'timer',
            },
        ];

        const stats = buildDailyWritingSessionProgress({
            date: '2026-05-12',
            sessions,
            targetMode: 'words',
            dailyTargetWords: 1000,
        });

        expect(stats.targetMode).toBe('words');
        expect(stats.wordsLogged).toBe(800);
        expect(stats.remainingWords).toBe(200);
        expect(stats.overGoalWords).toBe(0);
    });

    it('normalizes missing or malformed writing session settings', () => {
        const normalized = normalizeWritingSessionsSettings({
            defaults: { defaultMode: 'drafting' },
            records: [],
            active: {
                id: 'active',
                mode: 'drafting',
                startedAt: '2026-05-12T16:00:00.000Z',
                lastResumedAt: '2026-05-12T16:00:00.000Z',
                elapsedMsBeforePause: 0,
            },
        });

        expect(normalized.defaults.defaultMode).toBe('drafting');
        expect(normalized.defaults.targetMode).toBe('time');
        expect(normalized.defaults.countdownSprint).toBe(true);
        expect(normalized.defaults.weeklyGoalDays).toBe(7);
        expect(normalized.defaults.writingStatsOpen).toBe(false);
        expect(normalized.records).toEqual([]);
        expect(normalized.active?.id).toBe('active');
    });

    it('starts countdown sessions with a goal minute target', async () => {
        const plugin = {
            settings: {
                books: [{ id: 'book-1', title: 'Book One', folder: 'Book' }],
                activeBookId: 'book-1',
                writingSessions: {
                    defaults: { defaultMode: 'drafting' },
                    records: [],
                },
                runtimeRateProfiles: [{
                    id: 'default',
                    label: 'Default',
                    contentType: 'novel',
                    dialogueWpm: 160,
                    actionWpm: 100,
                    narrationWpm: 150,
                    beatSeconds: 2,
                    pauseSeconds: 3,
                    longPauseSeconds: 5,
                    momentSeconds: 4,
                    silenceSeconds: 5,
                    sessionPlanning: { dailyMinutes: 120 },
                }],
                defaultRuntimeProfileId: 'default',
            },
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);

        expect(service.getDefaultGoalMinutes()).toBe(120);
        const session = await service.start({ mode: 'revising', goalMinutes: 50 });

        expect(session.mode).toBe('revising');
        expect(session.stage).toBe('Zero');
        expect(session.goalMinutes).toBe(50);
        expect(session.bookId).toBe('book-1');
        expect(plugin.settings.writingSessions.active?.goalMinutes).toBe(50);
    });

    it('continues a completed countdown as the same session with a fresh sprint segment', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-20T16:42:00.000Z'));
            const plugin = {
                settings: {
                    writingSessions: {
                        defaults: { defaultMode: 'revising' },
                        active: {
                            id: 'active-session',
                            mode: 'revising',
                            stage: 'Author',
                            stagePreference: 'Author',
                            startedAt: '2026-05-20T16:00:00.000Z',
                            lastResumedAt: '2026-05-20T16:00:00.000Z',
                            lastSeenAt: '2026-05-20T16:41:30.000Z',
                            elapsedMsBeforePause: 0,
                            goalMinutes: 40,
                        },
                        records: [],
                    },
                },
                saveSettings: vi.fn(async () => undefined),
            };
            const service = new WritingSessionService(plugin as any);

            const continued = await service.continueCountdown();

            expect(continued.id).toBe('active-session');
            expect(continued.goalMinutes).toBe(40);
            expect(continued.elapsedMsBeforePause).toBe(42 * 60000);
            expect(continued.countdownSegmentStartElapsedMs).toBe(42 * 60000);
            expect(continued.pausedAt).toBeUndefined();
            expect(continued.lastResumedAt).toBe('2026-05-20T16:42:00.000Z');
            vi.setSystemTime(new Date('2026-05-20T16:43:00.000Z'));
            expect(service.getActiveElapsedMs()).toBe(43 * 60000);
            expect(plugin.settings.writingSessions.active).toBe(continued);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('auto-pauses a running session at the local day boundary', async () => {
        vi.useFakeTimers();
        try {
            const startedAt = new Date(2026, 4, 20, 23, 50, 0);
            const afterMidnight = new Date(2026, 4, 21, 0, 10, 0);
            const midnight = new Date(2026, 4, 21, 0, 0, 0);
            vi.setSystemTime(afterMidnight);
            const plugin = {
                settings: {
                    writingSessions: {
                        defaults: { defaultMode: 'drafting' },
                        active: {
                            id: 'active-session',
                            mode: 'drafting',
                            stage: 'Zero',
                            stagePreference: 'Zero',
                            startedAt: startedAt.toISOString(),
                            lastResumedAt: startedAt.toISOString(),
                            lastSeenAt: new Date(2026, 4, 21, 0, 9, 30).toISOString(),
                            elapsedMsBeforePause: 0,
                            goalMinutes: 60,
                        },
                        records: [],
                    },
                },
                saveSettings: vi.fn(async () => undefined),
            };
            const service = new WritingSessionService(plugin as any);

            await service.markActiveSessionSeen();

            expect(plugin.settings.writingSessions.active?.pausedAt).toBe(midnight.toISOString());
            expect(plugin.settings.writingSessions.active?.elapsedMsBeforePause).toBe(10 * 60000);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('resolves the automatic session stage from working scenes', async () => {
        const plugin = {
            app: { workspace: { getActiveFile: () => undefined, getLeavesOfType: () => [] } },
            settings: {
                books: [{ id: 'book-1', title: 'Book One', sourceFolder: 'Book' }],
                activeBookId: 'book-1',
                writingSessions: {
                    defaults: { defaultMode: 'drafting', defaultStage: 'auto' },
                    records: [],
                },
            },
            getSceneData: async () => [
                { title: 'Zero pass', date: '', path: 'Book/Zero.md', status: 'Working', 'Publish Stage': 'Zero' },
                { title: 'Author pass', date: '', path: 'Book/Author.md', status: 'Working', 'Publish Stage': 'Author' },
            ],
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);

        const session = await service.start({ mode: 'revising', stage: 'auto' });

        expect(session.stage).toBe('Mixed');
        expect(session.stagePreference).toBe('auto');
    });

    it('persists the default writing session mode', async () => {
        const plugin = {
            settings: {
                writingSessions: {
                    defaults: { defaultMode: 'drafting' },
                    records: [],
                },
            },
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);

        await service.setDefaultMode('revising');

        expect(plugin.settings.writingSessions.defaults.defaultMode).toBe('revising');
    });

    it('persists the default writing session stage preference', async () => {
        const plugin = {
            settings: {
                writingSessions: {
                    defaults: { defaultMode: 'drafting' },
                    records: [],
                },
            },
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);

        await service.setDefaultStage('Author');

        expect(plugin.settings.writingSessions.defaults.defaultStage).toBe('Author');
    });

    it('persists the weekly writing goal day target', async () => {
        const plugin = {
            settings: {
                writingSessions: {
                    defaults: { defaultMode: 'drafting' },
                    records: [],
                },
            },
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);

        await service.setWeeklyGoalDays(5);

        expect(plugin.settings.writingSessions.defaults.weeklyGoalDays).toBe(5);
    });

    it('starts word target sessions and only increments typed words additively', async () => {
        const plugin = {
            settings: {
                writingSessions: {
                    defaults: { defaultMode: 'drafting', targetMode: 'words' },
                    records: [],
                },
                runtimeRateProfiles: [{
                    id: 'default',
                    label: 'Default',
                    contentType: 'novel',
                    dialogueWpm: 160,
                    actionWpm: 100,
                    narrationWpm: 150,
                    beatSeconds: 2,
                    pauseSeconds: 3,
                    longPauseSeconds: 5,
                    momentSeconds: 4,
                    silenceSeconds: 5,
                    sessionPlanning: { dailyWords: 750 },
                }],
                defaultRuntimeProfileId: 'default',
            },
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);

        expect(service.getDefaultGoalWords()).toBe(750);
        const session = await service.start({ mode: 'drafting', targetMode: 'words', goalWords: 500 });
        service.registerTypedWords(3);
        service.registerTypedWords(-2);

        expect(session.targetMode).toBe('words');
        expect(session.goalWords).toBe(500);
        expect(plugin.settings.writingSessions.active?.typedWords).toBe(3);
    });

    it('saves completion details from the stop confirmation modal', async () => {
        const plugin = {
            settings: {
                books: [{ id: 'book-1', title: 'Book One', sourceFolder: 'Book' }],
                activeBookId: 'book-1',
                writingSessions: {
                    defaults: { defaultMode: 'drafting' },
                    records: [],
                },
            },
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);
        await service.start({ mode: 'drafting', goalMinutes: 25 });

        const record = await service.stop({
            elapsedMs: 42 * 60000,
            wordsAdded: 1234,
            typedWords: 1300,
            netWordDelta: -66,
            sessionDate: '2026-05-12',
            scenesCompleted: 2,
            pagesEdited: 4,
            note: 'Worked on the opening.',
            scenePaths: ['Book/Scene 1.md', 'Book/Scene 1.md', 'Book/Scene 2.md'],
        });

        expect(record.elapsedMs).toBe(42 * 60000);
        expect(record.wordsAdded).toBe(1234);
        expect(record.typedWords).toBe(1300);
        expect(record.netWordDelta).toBe(-66);
        expect(record.sessionDate).toBe('2026-05-12');
        expect(record.scenesCompleted).toBe(2);
        expect(record.pagesEdited).toBe(4);
        expect(record.note).toBe('Worked on the opening.');
        expect(record.scenePaths).toEqual(['Book/Scene 1.md', 'Book/Scene 2.md']);
        expect(plugin.settings.writingSessions.active).toBeUndefined();
        expect(plugin.settings.writingSessions.records).toHaveLength(1);
    });

    it('credits recovered sessions to their selected session date instead of save date', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-15T17:00:00.000Z'));
            const plugin = {
                settings: {
                    writingSessions: {
                        defaults: { defaultMode: 'drafting' },
                        active: {
                            id: 'recovered-session',
                            mode: 'drafting',
                            stage: 'Zero',
                            stagePreference: 'Zero',
                            startedAt: '2026-05-12T16:00:00.000Z',
                            lastResumedAt: '2026-05-12T16:00:00.000Z',
                            pausedAt: '2026-05-12T16:30:00.000Z',
                            elapsedMsBeforePause: 30 * 60000,
                            typedWords: 500,
                        },
                        records: [],
                    },
                },
                saveSettings: vi.fn(async () => undefined),
            };
            const service = new WritingSessionService(plugin as any);

            const record = await service.stop({
                sessionDate: '2026-05-12',
                wordsAdded: 500,
            });

            expect(record.endedAt).toBe('2026-05-15T17:00:00.000Z');
            expect(record.sessionDate).toBe('2026-05-12');
            expect(service.getDailySessionProgress('2026-05-12').minutesLogged).toBe(30);
            expect(service.getDailySessionProgress('2026-05-15').minutesLogged).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('suggests touched scenes from active, open, working, and modified files', async () => {
        const start = Date.parse('2026-05-12T16:00:00.000Z');
        const plugin = {
            app: {
                workspace: {
                    getActiveFile: () => ({ path: 'Book/Active.md' }),
                    getLeavesOfType: () => [
                        { view: { file: { path: 'Book/Open.md' } } },
                    ],
                },
                vault: {
                    getAbstractFileByPath: (path: string) => ({
                        stat: { mtime: path === 'Book/Modified.md' ? start + 5000 : start - 5000 },
                    }),
                },
            },
            settings: {
                books: [{ id: 'book-1', title: 'Book One', sourceFolder: 'Book' }],
                activeBookId: 'book-1',
                writingSessions: {
                    defaults: { defaultMode: 'drafting' },
                    active: {
                        id: 'active',
                        mode: 'drafting',
                        startedAt: '2026-05-12T16:00:00.000Z',
                        lastResumedAt: '2026-05-12T16:00:00.000Z',
                        elapsedMsBeforePause: 0,
                    },
                    records: [],
                },
            },
            getSceneData: async () => [
                { title: 'Active', date: '', path: 'Book/Active.md', status: 'Todo', 'Publish Stage': 'Zero' },
                { title: 'Open', date: '', path: 'Book/Open.md', status: 'Todo', 'Publish Stage': 'Author' },
                { title: 'Working', date: '', path: 'Book/Working.md', status: 'Working', 'Publish Stage': 'Author' },
                { title: 'Modified', date: '', path: 'Book/Modified.md', status: 'Todo', 'Publish Stage': 'House' },
            ],
            saveSettings: async () => undefined,
        };
        const service = new WritingSessionService(plugin as any);

        const suggestions = await service.collectTouchedSceneSuggestions();

        expect(suggestions.map(suggestion => suggestion.path)).toEqual([
            'Book/Active.md',
            'Book/Open.md',
            'Book/Working.md',
            'Book/Modified.md',
        ]);
        expect(suggestions.map(suggestion => suggestion.reason)).toEqual([
            'active',
            'open',
            'working',
            'modified',
        ]);
    });
});

describe('WritingSessionService countdown sprint memory', () => {
    const sprintPlugin = (defaults: Record<string, unknown> = {}) => ({
        settings: {
            books: [{ id: 'book-1', title: 'Book One', sourceFolder: 'Book' }],
            activeBookId: 'book-1',
            writingSessions: { defaults: { defaultMode: 'drafting', ...defaults }, records: [] },
        },
        saveSettings: vi.fn(async () => undefined),
    });

    it('sprints on a countdown until the author turns it off', () => {
        expect(new WritingSessionService(sprintPlugin() as any).isCountdownSprintEnabled()).toBe(true);
        expect(new WritingSessionService(sprintPlugin({ countdownSprint: false }) as any).isCountdownSprintEnabled()).toBe(false);
    });

    it('remembers the toggle so the next session opens the way the last one closed', async () => {
        const plugin = sprintPlugin();
        const service = new WritingSessionService(plugin as any);

        await service.setCountdownSprint(false);

        expect(plugin.settings.writingSessions.defaults.countdownSprint).toBe(false);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(service.isCountdownSprintEnabled()).toBe(false);

        // No write when nothing changed.
        await service.setCountdownSprint(false);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

        await service.setCountdownSprint(true);
        expect(service.isCountdownSprintEnabled()).toBe(true);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    });
});

describe('WritingSessionService auto-track', () => {
    const autoTrackPlugin = (overrides: Record<string, unknown> = {}) => ({
        settings: {
            books: [{ id: 'book-1', title: 'Book One', sourceFolder: 'Book' }],
            activeBookId: 'book-1',
            writingSessions: {
                defaults: { defaultMode: 'drafting' },
                records: [],
            },
        },
        getSceneData: async () => [],
        saveSettings: vi.fn(async () => undefined),
        ...overrides,
    });

    it('never starts a session on activity — only the author begins one', async () => {
        const plugin = autoTrackPlugin();
        const service = new WritingSessionService(plugin as any);

        await service.onActivity();

        expect(plugin.settings.writingSessions.active).toBeUndefined();
    });

    it('advances the activity clock of a running session on activity', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-20T16:10:00.000Z'));
            const plugin = autoTrackPlugin();
            plugin.settings.writingSessions.active = {
                id: 'running',
                mode: 'drafting',
                startedAt: '2026-05-20T16:00:00.000Z',
                lastResumedAt: '2026-05-20T16:00:00.000Z',
                lastActivityAt: '2026-05-20T16:00:00.000Z',
                elapsedMsBeforePause: 0,
                idleAuto: false,
            } as any;
            const service = new WritingSessionService(plugin as any);

            await service.onActivity();

            expect(plugin.settings.writingSessions.active?.lastActivityAt).toBe('2026-05-20T16:10:00.000Z');
            expect(plugin.settings.writingSessions.active?.pausedAt).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('pauses at the last activity after the idle timeout, then resumes silently on activity', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-20T16:03:30.000Z'));
            const plugin = autoTrackPlugin();
            plugin.settings.writingSessions.active = {
                id: 'active-session',
                mode: 'drafting',
                stage: 'Zero',
                stagePreference: 'Zero',
                startedAt: '2026-05-20T16:00:00.000Z',
                lastResumedAt: '2026-05-20T16:00:00.000Z',
                lastSeenAt: '2026-05-20T16:03:25.000Z',
                lastActivityAt: '2026-05-20T16:01:00.000Z',
                elapsedMsBeforePause: 0,
                idleAuto: false,
            } as any;
            const service = new WritingSessionService(plugin as any);

            const changed = await service.maybeHandleIdle();

            expect(changed).toBe(true);
            const paused = plugin.settings.writingSessions.active;
            expect(paused?.idleAuto).toBe(true);
            expect(paused?.pausedAt).toBe('2026-05-20T16:01:00.000Z');
            // Counts only the active minute, not the idle gap.
            expect(paused?.elapsedMsBeforePause).toBe(60000);

            // Author returns and types: silent resume, fresh segment.
            vi.setSystemTime(new Date('2026-05-20T16:30:00.000Z'));
            await service.onActivity();
            const resumed = plugin.settings.writingSessions.active;
            expect(resumed?.pausedAt).toBeUndefined();
            expect(resumed?.idleAuto).toBe(false);
            expect(resumed?.lastResumedAt).toBe('2026-05-20T16:30:00.000Z');
            // Elapsed continues from the frozen 1 minute — the 29-minute gap is excluded.
            vi.setSystemTime(new Date('2026-05-20T16:31:00.000Z'));
            expect(service.getActiveElapsedMs()).toBe(120000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves a manual pause untouched (no auto-resume or finalize)', async () => {
        const plugin = autoTrackPlugin();
        plugin.settings.writingSessions.active = {
            id: 'manual-pause',
            mode: 'drafting',
            startedAt: '2026-05-20T16:00:00.000Z',
            lastResumedAt: '2026-05-20T16:00:00.000Z',
            lastActivityAt: '2026-05-20T15:00:00.000Z',
            elapsedMsBeforePause: 30 * 60000,
            pausedAt: '2026-05-20T16:30:00.000Z',
            idleAuto: false,
        } as any;
        const service = new WritingSessionService(plugin as any);

        const changed = await service.maybeHandleIdle();

        expect(changed).toBe(false);
        expect(plugin.settings.writingSessions.active?.id).toBe('manual-pause');
        expect(plugin.settings.writingSessions.records).toHaveLength(0);
    });

    it('never auto-saves a long-idle session — it stays paused until the author saves', async () => {
        vi.useFakeTimers();
        try {
            // Far past any old finalize threshold (5h idle): the session must persist.
            vi.setSystemTime(new Date('2026-05-20T21:20:00.000Z'));
            const plugin = autoTrackPlugin();
            plugin.settings.writingSessions.active = {
                id: 'idle-persists',
                mode: 'drafting',
                stage: 'Zero',
                startedAt: '2026-05-20T16:00:00.000Z',
                lastResumedAt: '2026-05-20T16:00:00.000Z',
                lastSeenAt: '2026-05-20T16:20:00.000Z',
                lastActivityAt: '2026-05-20T16:20:00.000Z',
                elapsedMsBeforePause: 0,
                typedWords: 500,
                idleAuto: false,
            } as any;
            const service = new WritingSessionService(plugin as any);

            const changed = await service.maybeHandleIdle();

            expect(changed).toBe(true);
            const active = plugin.settings.writingSessions.active!;
            expect(active.id).toBe('idle-persists'); // still here — never finalized
            expect(active.idleAuto).toBe(true);
            expect(active.pausedAt).toBe('2026-05-20T16:20:00.000Z'); // frozen at last activity
            expect(active.elapsedMsBeforePause).toBe(20 * 60000);
            expect(plugin.settings.writingSessions.records).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('banks a long gap on a running session so away-time is excluded from elapsed', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-20T16:00:00.000Z'));
            const plugin = autoTrackPlugin();
            plugin.settings.writingSessions.active = {
                id: 'gap-bank',
                mode: 'drafting',
                startedAt: '2026-05-20T16:00:00.000Z',
                lastResumedAt: '2026-05-20T16:00:00.000Z',
                lastSeenAt: '2026-05-20T16:00:00.000Z',
                lastActivityAt: '2026-05-20T16:00:00.000Z',
                elapsedMsBeforePause: 0,
                typedWords: 0,
                sceneActivity: {},
                currentScenePath: 'Book/A.md',
                idleAuto: false,
            } as any;
            const service = new WritingSessionService(plugin as any);

            // Active for 1 minute, then a 30-minute gap the idle tick never paused
            // (backgrounded window), then activity resumes.
            vi.setSystemTime(new Date('2026-05-20T16:01:00.000Z'));
            await service.onActivity('Book/A.md');
            vi.setSystemTime(new Date('2026-05-20T16:31:00.000Z'));
            await service.onActivity('Book/A.md');

            const active = plugin.settings.writingSessions.active!;
            // 1 min banked; the 30-min gap is excluded; a fresh window starts now.
            expect(active.elapsedMsBeforePause).toBe(60000);
            expect(active.lastResumedAt).toBe('2026-05-20T16:31:00.000Z');
            vi.setSystemTime(new Date('2026-05-20T16:32:00.000Z'));
            expect(service.getActiveElapsedMs()).toBe(120000); // 1 min banked + 1 min new
            // Only the active minute counted toward the scene, not the idle gap.
            expect(active.sceneActivity?.['Book/A.md']?.activeMs).toBe(60000);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('WritingSessionService per-scene activity', () => {
    const sessionPlugin = () => ({
        settings: {
            books: [{ id: 'book-1', title: 'Book One', sourceFolder: 'Book' }],
            activeBookId: 'book-1',
            writingSessions: {
                defaults: { defaultMode: 'drafting' },
                records: [],
            },
        },
        saveSettings: vi.fn(async () => undefined),
    });

    const runningSession = (overrides: Record<string, unknown> = {}) => ({
        id: 'session-1',
        mode: 'drafting',
        startedAt: '2026-05-20T16:00:00.000Z',
        lastResumedAt: '2026-05-20T16:00:00.000Z',
        lastActivityAt: '2026-05-20T16:00:00.000Z',
        elapsedMsBeforePause: 0,
        typedWords: 0,
        sceneActivity: {},
        currentScenePath: 'Book/A.md',
        idleAuto: false,
        ...overrides,
    });

    it('buckets typed words per scene, total counts regardless of path', () => {
        const plugin = sessionPlugin();
        plugin.settings.writingSessions.active = runningSession() as any;
        const service = new WritingSessionService(plugin as any);

        service.registerTypedWords(5, 'Book/A.md');
        service.registerTypedWords(3); // no path — total only
        service.registerTypedWords(2, 'Book/B.md');

        const active = plugin.settings.writingSessions.active!;
        expect(active.typedWords).toBe(10);
        expect(active.sceneActivity?.['Book/A.md']).toEqual({ activeMs: 0, typedWords: 5 });
        expect(active.sceneActivity?.['Book/B.md']).toEqual({ activeMs: 0, typedWords: 2 });
    });

    it('credits each activity window to the scene focused during it', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-20T16:00:00.000Z'));
            const plugin = sessionPlugin();
            plugin.settings.writingSessions.active = runningSession() as any;
            const service = new WritingSessionService(plugin as any);

            vi.setSystemTime(new Date('2026-05-20T16:00:30.000Z'));
            await service.onActivity('Book/A.md'); // 30s credited to A

            vi.setSystemTime(new Date('2026-05-20T16:01:30.000Z'));
            await service.onActivity('Book/B.md'); // 60s more on A, then focus moves to B

            vi.setSystemTime(new Date('2026-05-20T16:02:00.000Z'));
            await service.onActivity('Book/B.md'); // 30s credited to B

            const active = plugin.settings.writingSessions.active!;
            expect(active.sceneActivity?.['Book/A.md']?.activeMs).toBe(90000);
            expect(active.sceneActivity?.['Book/B.md']?.activeMs).toBe(30000);
            expect(active.currentScenePath).toBe('Book/B.md');
        } finally {
            vi.useRealTimers();
        }
    });

    it('excludes an idle-length gap from per-scene time', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-20T16:00:00.000Z'));
            const plugin = sessionPlugin();
            plugin.settings.writingSessions.active = runningSession() as any;
            const service = new WritingSessionService(plugin as any);

            // Gap exceeds the 2-min idle timeout: not credited (idle, not writing).
            vi.setSystemTime(new Date('2026-05-20T16:05:00.000Z'));
            await service.onActivity('Book/A.md');

            expect(plugin.settings.writingSessions.active?.sceneActivity?.['Book/A.md']).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('serializes the per-scene map onto the saved record, dropping empties', async () => {
        const plugin = sessionPlugin();
        plugin.settings.writingSessions.active = runningSession({
            sceneActivity: {
                'Book/A.md': { activeMs: 120000, typedWords: 80 },
                'Book/Empty.md': { activeMs: 0, typedWords: 0 },
            },
        }) as any;
        const service = new WritingSessionService(plugin as any);

        const record = await service.stop({ elapsedMs: 120000 });

        expect(record.scenesActivity).toEqual([{ path: 'Book/A.md', activeMs: 120000, typedWords: 80 }]);
    });

    it('aggregates today\'s records plus the active session, newest-effort first', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-05-20T18:00:00')); // local
            const plugin = sessionPlugin();
            plugin.settings.writingSessions.records = [
                {
                    id: 'today-1',
                    mode: 'drafting',
                    startedAt: '2026-05-20T09:00:00.000Z',
                    endedAt: '2026-05-20T10:00:00.000Z',
                    sessionDate: '2026-05-20',
                    elapsedMs: 60 * 60000,
                    source: 'timer',
                    scenesActivity: [{ path: 'Book/A.md', activeMs: 60000, typedWords: 40 }],
                },
                {
                    id: 'yesterday-1',
                    mode: 'drafting',
                    startedAt: '2026-05-19T09:00:00.000Z',
                    endedAt: '2026-05-19T10:00:00.000Z',
                    sessionDate: '2026-05-19',
                    elapsedMs: 60 * 60000,
                    source: 'timer',
                    scenesActivity: [{ path: 'Book/A.md', activeMs: 99999, typedWords: 99 }],
                },
            ] as any;
            plugin.settings.writingSessions.active = runningSession({
                sceneActivity: {
                    'Book/A.md': { activeMs: 30000, typedWords: 10 },
                    'Book/C.md': { activeMs: 5000, typedWords: 0 },
                },
            }) as any;
            const service = new WritingSessionService(plugin as any);

            const today = service.getTodaySceneActivity();

            expect(today).toEqual([
                { path: 'Book/A.md', activeMs: 90000, typedWords: 50 },
                { path: 'Book/C.md', activeMs: 5000, typedWords: 0 },
            ]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('portable session log corruption handling', () => {
    it('reports a damaged archive as unreadable rather than as empty history', () => {
        expect(parsePortableSessionLog('{ not json')).toMatchObject({ kind: 'unreadable' });
        expect(parsePortableSessionLog('{"records":"nope"}')).toMatchObject({ kind: 'unreadable' });
        expect(parsePortableSessionLog('{"records":[]}')).toEqual({ kind: 'ok', records: [] });
    });

    it('dates the quarantine filename', () => {
        expect(buildCorruptSessionLogPath(new Date(2026, 6, 27)))
            .toBe('Radial Timeline/Writing Sessions.corrupt-2026-07-27.json');
    });

    it('renames an unparseable archive instead of overwriting it', async () => {
        const existingFile = { path: 'Radial Timeline/Writing Sessions.json' };
        const calls: string[] = [];
        let created = '';
        const plugin = {
            settings: {
                writingSessions: {
                    defaults: { defaultMode: 'drafting' },
                    records: [],
                    active: {
                        id: 'active-session',
                        mode: 'drafting',
                        stage: 'Zero',
                        stagePreference: 'Zero',
                        startedAt: '2026-07-27T10:00:00.000Z',
                        lastResumedAt: '2026-07-27T10:00:00.000Z',
                        lastSeenAt: '2026-07-27T10:30:00.000Z',
                        elapsedMsBeforePause: 0,
                    },
                },
            },
            saveSettings: async () => undefined,
            app: {
                vault: {
                    getAbstractFileByPath: (path: string) =>
                        (path === 'Radial Timeline/Writing Sessions.json' ? existingFile
                            : path === 'Radial Timeline' ? { path } : null),
                    read: async () => 'these are not the JSON records you are looking for',
                    rename: async (_file: unknown, path: string) => { calls.push(`rename:${path}`); },
                    modify: async () => { calls.push('modify'); },
                    create: async (path: string, data: string) => { calls.push(`create:${path}`); created = data; },
                },
            },
        };
        const service = new WritingSessionService(plugin as any);

        await service.stop({ elapsedMs: 1800000, wordsAdded: 500, scenesCompletedPaths: [] });

        // The damaged archive is preserved under a dated name and a fresh log
        // is created; the original file is never modified in place.
        expect(calls.some(c => c.startsWith('rename:Radial Timeline/Writing Sessions.corrupt-'))).toBe(true);
        expect(calls).toContain('create:Radial Timeline/Writing Sessions.json');
        expect(calls).not.toContain('modify');
        expect(JSON.parse(created).records).toHaveLength(1);
    });
});
