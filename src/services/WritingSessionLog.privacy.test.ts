/*
 * Tracer privacy test — read alongside
 * `docs/engineering/standards/writing-session-privacy.md`.
 *
 * Every private field on `WritingSessionRecord` gets a unique tracer string.
 * For each exit point in this module that leaves the device (the session feed
 * post and the hour × mode rollup), we assert the JSON-serialized output does
 * NOT contain any tracer. The daily aggregate exit lives in
 * `communitySharePreview.ts` and is traced in `communitySharePreview.test.ts`
 * with the same tracer strings.
 *
 * Adding a new field to WritingSessionRecord requires adding its tracer here.
 * If you skip that step, the test won't catch a future regression — but the
 * doctrine doc tells you to do it, and the audit pass will catch the omission.
 */

import { describe, expect, it } from 'vitest';
import type { WritingSessionRecord } from '../types/settings';
import {
    buildCommunityHourModeMix,
    projectPrivate,
    projectSessionFeedPost,
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

    describe('community hour x mode mix rollup', () => {
        it('strips all private tracers, including bookTitle', () => {
            const out = buildCommunityHourModeMix({
                records: [tracedRecord()],
                endDate: '2026-06-01',
            });
            assertNoTracers(out);
        });

        it('never emits per-session detail, ids, or calendar dates', () => {
            const out = buildCommunityHourModeMix({
                records: [tracedRecord(), tracedRecord({ id: 'rec-tracer-2' })],
                endDate: '2026-06-01',
            }) as Record<string, unknown>;
            expect(JSON.stringify(out)).not.toContain('rec-tracer');
            expect(JSON.stringify(out)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        });

        it('buckets by local start hour and folds editing into revising', () => {
            const out = buildCommunityHourModeMix({
                records: [
                    tracedRecord({ id: 'a', mode: 'drafting', startedAt: '2026-06-01T09:00:00.000Z', elapsedMs: 30 * 60000 }),
                    tracedRecord({ id: 'b', mode: 'editing', startedAt: '2026-06-01T09:15:00.000Z', elapsedMs: 20 * 60000 }),
                ],
                endDate: '2026-06-02',
            });
            const hour = new Date('2026-06-01T09:00:00.000Z').getHours();
            expect(out[String(hour)]).toEqual({ drafting: 30, revising: 20, planning: 0 });
        });

        it('omits hours with zero activity entirely', () => {
            const out = buildCommunityHourModeMix({
                records: [tracedRecord({ startedAt: '2026-06-01T09:00:00.000Z', elapsedMs: 10 * 60000 })],
                endDate: '2026-06-01',
            });
            expect(Object.keys(out)).toHaveLength(1);
        });

        it('excludes records outside the trailing 28-day window', () => {
            const out = buildCommunityHourModeMix({
                records: [tracedRecord({ startedAt: '2026-04-01T09:00:00.000Z', endedAt: '2026-04-01T09:30:00.000Z', elapsedMs: 30 * 60000 })],
                endDate: '2026-06-01',
            });
            expect(out).toEqual({});
        });
    });

});
