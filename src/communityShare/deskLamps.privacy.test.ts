/*
 * Tracer privacy test for the Desk Lamp exit — read alongside
 * `docs/engineering/standards/writing-session-privacy.md` ("Any level, per
 * session: the Desk Lamp").
 *
 * The open session carries the book title, stage, goals, the countdown and
 * per-scene activity. The lamp that leaves the device must be exactly
 * `state`, `mode`, `lit_at` and `audience`, with none of them inside it, and
 * what syncDeskLamps sends must be that lamp and the connection credentials,
 * nothing more.
 *
 * Adding a field to ActiveWritingSession requires adding its tracer here.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import type { ActiveWritingSession } from '../types/settings';
import { syncDeskLamps } from './communityShareClient';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import { projectDeskLampLight } from './deskLamps';

const TRACERS = {
    bookTitle: 'PRIVACY_TRACER_TITLE_DO_NOT_LEAK',
    bookId: 'PRIVACY_TRACER_BOOK_ID_DO_NOT_LEAK',
    scenePath: 'PRIVACY_TRACER_PATH_DO_NOT_LEAK',
    activityPath: 'PRIVACY_TRACER_ACTIVITY_PATH_DO_NOT_LEAK',
    sessionId: 'PRIVACY_TRACER_SESSION_ID_DO_NOT_LEAK',
} as const;

const FRIEND = '11111111-1111-4111-8111-111111111111';

function tracedSession(overrides: Partial<ActiveWritingSession> = {}): ActiveWritingSession {
    return {
        id: TRACERS.sessionId,
        bookId: TRACERS.bookId,
        bookTitle: TRACERS.bookTitle,
        mode: 'revising',
        stage: 'House',
        stagePreference: 'House',
        // Exact start, 9:13:27.481 — must never leave unrounded.
        startedAt: '2026-10-04T09:13:27.481Z',
        lastResumedAt: '2026-10-04T09:40:00.000Z',
        lastSeenAt: '2026-10-04T09:41:12.000Z',
        lastActivityAt: '2026-10-04T09:41:10.000Z',
        elapsedMsBeforePause: 1_234_567,
        goalMinutes: 47,
        goalWords: 1313,
        targetMode: 'both',
        typedWords: 777,
        countdownSegmentStartElapsedMs: 99_000,
        idleAuto: false,
        wordSnapshot: { startedWords: 4242, paths: [`Book/${TRACERS.scenePath}.md`] },
        sceneActivity: { [`Book/${TRACERS.activityPath}.md`]: { activeMs: 600_000, typedWords: 120 } },
        currentScenePath: `Book/${TRACERS.scenePath}.md`,
        ...overrides,
    };
}

function assertNoTracers(value: unknown): void {
    const serialized = JSON.stringify(value);
    for (const [key, tracer] of Object.entries(TRACERS)) {
        expect(serialized, `Tracer "${key}" leaked: ${tracer}`).not.toContain(tracer);
    }
    // Nothing of the session's shape beyond the four keys: no stage, goals,
    // word counts, countdown or exact time.
    for (const leak of ['House', '1313', '777', '4242', '47', '99000', '1234567', '09:13:27', '.481']) {
        expect(serialized, `session detail leaked: ${leak}`).not.toContain(leak);
    }
}

describe('Desk Lamp exit: projectDeskLampLight', () => {
    it('emits exactly state, mode, lit_at and audience, with no tracer', () => {
        const light = projectDeskLampLight(tracedSession(), [FRIEND]);
        expect(light).not.toBeNull();
        expect(Object.keys(light!).sort()).toEqual(['audience', 'lit_at', 'mode', 'state']);
        expect(light).toEqual({ state: 'lit', mode: 'revising', lit_at: '2026-10-04T09:10:00.000Z', audience: [FRIEND] });
        assertNoTracers(light);
    });

    it('floors the start to 5 minutes, never sending the exact time', () => {
        expect(projectDeskLampLight(tracedSession({ startedAt: '2026-10-04T09:14:59.999Z' }), [])!.lit_at).toBe('2026-10-04T09:10:00.000Z');
        expect(projectDeskLampLight(tracedSession({ startedAt: '2026-10-04T09:15:00.000Z' }), [])!.lit_at).toBe('2026-10-04T09:15:00.000Z');
    });

    it('reads an auto-track idle pause as lit: idle pauses stay private (D6)', () => {
        const idle = tracedSession({ pausedAt: '2026-10-04T09:45:00.000Z', idleAuto: true });
        expect(projectDeskLampLight(idle, [FRIEND])!.state).toBe('lit');
        const manual = tracedSession({ pausedAt: '2026-10-04T09:45:00.000Z', idleAuto: false });
        expect(projectDeskLampLight(manual, [FRIEND])!.state).toBe('break');
        assertNoTracers(projectDeskLampLight(manual, [FRIEND]));
    });

    it('sends no lamp at all when the start cannot be read', () => {
        expect(projectDeskLampLight(tracedSession({ startedAt: 'not a time' }), [FRIEND])).toBeNull();
    });
});

describe('Desk Lamp exit: syncDeskLamps sends the lamp and the credentials only', () => {
    function connectedPlugin() {
        const communityShare = buildDefaultCommunityShareSettings();
        // Private level: Desk Lamps works there too (D12).
        communityShare.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: null,
            secretId: 'rt.community-share.connection-secret'
        };
        return {
            manifest: { version: '7.3.2' },
            app: { secretStorage: { getSecret: () => 'rtcs_current-secret', setSecret: () => {}, delete: () => {}, listSecrets: () => [] } },
            settings: { communityShare }
        };
    }

    it('posts {connection_id, current_secret, light} with the four-key lamp and no tracer', async () => {
        const request = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({ ok: true, light: { state: 'lit', audience: [FRIEND] }, lamps: [], lit: [], invites_received: 0 })
        } as never);
        const light = projectDeskLampLight(tracedSession(), [FRIEND])!;
        await syncDeskLamps(connectedPlugin() as never, light);
        const sent = JSON.parse((request.mock.calls[0]?.[0] as { body: string }).body) as Record<string, unknown>;
        expect(Object.keys(sent).sort()).toEqual(['connection_id', 'current_secret', 'light']);
        expect(Object.keys(sent.light as object).sort()).toEqual(['audience', 'lit_at', 'mode', 'state']);
        assertNoTracers(sent);
    });
});
