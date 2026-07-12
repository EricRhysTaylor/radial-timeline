/*
 * Tracer privacy test — read alongside
 * `docs/engineering/standards/writing-session-privacy.md`.
 *
 * Every private field on `WritingSessionRecord` gets a unique tracer string.
 * For each non-private projection (friends, community), we assert the
 * JSON-serialized output does NOT contain any tracer.
 *
 * Adding a new field to WritingSessionRecord requires adding its tracer here.
 * If you skip that step, the test won't catch a future regression — but the
 * doctrine doc tells you to do it, and the audit pass will catch the omission.
 */

import { describe, expect, it } from 'vitest';
import type { WritingSessionRecord } from '../types/settings';
import {
    buildCommunityDailyLog,
    projectCommunityDaily,
    projectFriends,
    projectPrivate,
    projectSessionFeedPost,
    redactTime,
    SESSION_FEED_POST_BODY_MAX,
} from './WritingSessionLog';

const TRACERS = {
    note: 'PRIVACY_TRACER_NOTE_DO_NOT_LEAK',
    scenePath: 'PRIVACY_TRACER_PATH_DO_NOT_LEAK',
    scenesCompletedPath: 'PRIVACY_TRACER_COMPLETED_PATH_DO_NOT_LEAK',
    sceneActivityPath: 'PRIVACY_TRACER_ACTIVITY_PATH_DO_NOT_LEAK',
    bookTitle: 'PRIVACY_TRACER_TITLE_DO_NOT_LEAK',
} as const;

function tracedRecord(overrides: Partial<WritingSessionRecord> = {}): WritingSessionRecord {
    return {
        id: 'rec-tracer-1',
        bookId: 'book-1',
        bookTitle: TRACERS.bookTitle,
        mode: 'drafting',
        stage: 'Zero',
        startedAt: '2026-06-01T09:00:00.000Z',
        endedAt: '2026-06-01T09:47:00.000Z',
        elapsedMs: 47 * 60 * 1000,
        wordsAdded: 312,
        scenesCompleted: 1,
        scenePaths: [`Book/Scenes/${TRACERS.scenePath}.md`],
        scenesCompletedPaths: [`Book/Scenes/${TRACERS.scenesCompletedPath}.md`],
        scenesActivity: [{ path: `Book/Scenes/${TRACERS.sceneActivityPath}.md`, activeMs: 600000, typedWords: 120 }],
        pagesEdited: undefined,
        note: TRACERS.note,
        source: 'timer',
        ...overrides,
    };
}

function assertNoTracers(value: unknown, except: ReadonlyArray<string> = []): void {
    const serialized = JSON.stringify(value);
    for (const [key, tracer] of Object.entries(TRACERS)) {
        if (except.includes(tracer)) continue;
        expect(serialized, `Tracer "${key}" leaked: ${tracer}`).not.toContain(tracer);
    }
}

describe('WritingSessionLog privacy boundary', () => {
    it('private projection emits all tracers (sanity baseline)', () => {
        const out = projectPrivate(tracedRecord());
        const serialized = JSON.stringify(out);
        expect(serialized).toContain(TRACERS.note);
        expect(serialized).toContain(TRACERS.scenePath);
        expect(serialized).toContain(TRACERS.scenesCompletedPath);
        expect(serialized).toContain(TRACERS.bookTitle);
    });

    describe('friends projection', () => {
        it('strips all private tracers when book sharing is OFF', () => {
            const out = projectFriends(tracedRecord());
            assertNoTracers(out);
        });

        it('strips all private tracers when book sharing is ON (but allows bookTitle)', () => {
            const out = projectFriends(tracedRecord(), { shareBookTitle: true });
            // bookTitle is the only opt-in field allowed through.
            assertNoTracers(out, [TRACERS.bookTitle]);
            expect(JSON.stringify(out)).toContain(TRACERS.bookTitle);
        });

        it('emits hour-precision timestamps only', () => {
            const out = projectFriends(tracedRecord());
            expect(out.date.endsWith('00:00.000Z')).toBe(true);
        });

        it('never emits scenePaths, scenesCompletedPaths, note, bookId, startedAt fields', () => {
            const out = projectFriends(tracedRecord(), { shareBookTitle: true }) as Record<string, unknown>;
            expect(out).not.toHaveProperty('scenePaths');
            expect(out).not.toHaveProperty('scenesCompletedPaths');
            expect(out).not.toHaveProperty('note');
            expect(out).not.toHaveProperty('bookId');
            expect(out).not.toHaveProperty('startedAt');
            expect(out).not.toHaveProperty('endedAt');
        });
    });

    describe('session feed post projection (explicit per-save opt-in)', () => {
        it('carries the note (the sanctioned opt-in exit) but never paths or book identity', () => {
            const out = projectSessionFeedPost(tracedRecord());
            // The note IS the point of the post — the author armed the toggle.
            expect(out.body).toContain(TRACERS.note);
            // Everything else stays private even on this exit.
            assertNoTracers(out, [TRACERS.note]);
        });

        it('never emits exact timestamps, ids, or per-scene detail', () => {
            const out = projectSessionFeedPost(tracedRecord()) as unknown as Record<string, unknown>;
            expect(out).not.toHaveProperty('id');
            expect(out).not.toHaveProperty('startedAt');
            expect(out).not.toHaveProperty('endedAt');
            expect(out).not.toHaveProperty('scenePaths');
            expect(out).not.toHaveProperty('scenesActivity');
            expect(out).not.toHaveProperty('bookId');
            expect(out).not.toHaveProperty('bookTitle');
        });

        it('composes a stats headline and caps the body at the server limit', () => {
            const out = projectSessionFeedPost(tracedRecord({ note: 'x'.repeat(2000) }));
            expect(out.body.startsWith('Drafting · 47 min · 312 words')).toBe(true);
            expect(out.body.length).toBeLessThanOrEqual(SESSION_FEED_POST_BODY_MAX);
        });

        it('posts the stats headline alone when the author left no note', () => {
            const out = projectSessionFeedPost(tracedRecord({ note: undefined }));
            expect(out.body).toBe('Drafting · 47 min · 312 words');
        });
    });

    describe('community daily projection', () => {
        it('strips all private tracers — including bookTitle (community never sees book identity)', () => {
            const out = projectCommunityDaily('2026-06-01', [tracedRecord()]);
            assertNoTracers(out); // no exceptions — bookTitle MUST be stripped at community tier
        });

        it('emits day-precision dates only', () => {
            const out = projectCommunityDaily('2026-06-01', [tracedRecord()]);
            expect(out.date).toBe('2026-06-01');
        });

        it('never emits per-session detail', () => {
            const out = projectCommunityDaily('2026-06-01', [tracedRecord(), tracedRecord({ id: 'rec-tracer-2' })]) as Record<string, unknown>;
            // sessions/records arrays must not be present
            expect(out).not.toHaveProperty('sessions');
            expect(out).not.toHaveProperty('records');
            expect(out).not.toHaveProperty('id');
            // sessionCount is the aggregate proxy
            expect((out as { sessionCount: number }).sessionCount).toBe(2);
        });

        it('rounds words to nearest 50 to coarsen specificity', () => {
            const out = projectCommunityDaily('2026-06-01', [
                tracedRecord({ wordsAdded: 312 }),
                tracedRecord({ id: 'rec-2', wordsAdded: 311 }),
            ]);
            // 312 + 311 = 623 → rounded to 600
            expect(out.wordsAdded).toBe(600);
        });

        it('buildCommunityDailyLog groups per day and produces only aggregate rows', () => {
            const records: WritingSessionRecord[] = [
                tracedRecord({ id: 'a', endedAt: '2026-06-01T09:47:00.000Z' }),
                tracedRecord({ id: 'b', endedAt: '2026-06-01T15:00:00.000Z' }),
                tracedRecord({ id: 'c', endedAt: '2026-06-02T10:00:00.000Z' }),
            ];
            const rows = buildCommunityDailyLog({
                records,
                window: { endDate: '2026-06-02', days: 7 },
            });
            expect(rows).toHaveLength(2);
            assertNoTracers(rows);
            for (const row of rows) {
                expect(row).not.toHaveProperty('id');
            }
        });
    });

    describe('redactTime', () => {
        it('preserves minute precision for private', () => {
            expect(redactTime('2026-06-01T09:47:23.456Z', 'private')).toBe('2026-06-01T09:47:00.000Z');
        });
        it('coarsens to hour for friends', () => {
            expect(redactTime('2026-06-01T09:47:23.456Z', 'friends')).toBe('2026-06-01T09:00:00.000Z');
        });
        it('coarsens to day for community', () => {
            expect(redactTime('2026-06-01T09:47:23.456Z', 'community')).toBe('2026-06-01');
        });
    });
});
