import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InquirySessionStore } from './InquirySessionStore';
import type { InquirySession, InquirySessionCache } from './sessionTypes';

function makeSession(key: string): InquirySession {
    return {
        key,
        baseKey: key,
        result: {} as never,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        targetSceneIds: []
    };
}

function makeFakePlugin(cache?: InquirySessionCache) {
    return {
        settings: { inquirySessionCache: cache },
        saveSettings: () => Promise.resolve()
    } as never;
}

describe('InquirySessionStore.reloadFromSettings', () => {
    it('re-reads a session persisted into settings after construction', () => {
        const plugin = makeFakePlugin();
        const store = new InquirySessionStore(plugin);
        expect(store.peekSession('k1')).toBeUndefined();

        // Simulate another (orphaned) view instance persisting a session.
        (plugin as { settings: { inquirySessionCache?: InquirySessionCache } })
            .settings.inquirySessionCache = { sessions: [makeSession('k1')], max: 25 };

        // Before reload the store still reflects its construction snapshot.
        expect(store.peekSession('k1')).toBeUndefined();

        store.reloadFromSettings();
        expect(store.peekSession('k1')?.key).toBe('k1');
    });

    it('is a pure re-read: clones sessions (no shared reference with settings)', () => {
        const persisted: InquirySessionCache = { sessions: [makeSession('k2')], max: 25 };
        const plugin = makeFakePlugin(persisted);
        const store = new InquirySessionStore(plugin);
        const got = store.peekSession('k2');
        expect(got).toBeDefined();
        expect(got).not.toBe(persisted.sessions[0]);
    });

    it('reload reflects removal too (settings is the authority)', () => {
        const plugin = makeFakePlugin({ sessions: [makeSession('k3')], max: 25 });
        const store = new InquirySessionStore(plugin);
        expect(store.peekSession('k3')?.key).toBe('k3');
        (plugin as { settings: { inquirySessionCache?: InquirySessionCache } })
            .settings.inquirySessionCache = { sessions: [], max: 25 };
        store.reloadFromSettings();
        expect(store.peekSession('k3')).toBeUndefined();
    });
});

// The InquiryView wiring is locked by source assertions — the class is
// ~12k lines and not unit-instantiable without the full Obsidian runtime
// (same convention as InquiryView.test.ts).
describe('Inquiry close/reopen recovery wiring (Step-B minimal)', () => {
    const viewSrc = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
    const mainSrc = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');

    it('plugin owns the transient in-flight marker (survives view close)', () => {
        expect(mainSrc.includes('public _inquiryRunInFlight: { sessionKey: string; question: string; startedAt: number } | null = null;')).toBe(true);
    });

    it('marker is SET at run start and CLEARED in the same finally, keyed by session key', () => {
        expect(viewSrc.includes('this.plugin._inquiryRunInFlight = { sessionKey: key, question: questionText, startedAt: startTime };')).toBe(true);
        expect(viewSrc.includes('if (this.plugin._inquiryRunInFlight?.sessionKey === key) {')).toBe(true);
        expect(viewSrc.includes('this.plugin._inquiryRunInFlight = null;')).toBe(true);
    });

    it('close during a run shows the continue-in-background Notice', () => {
        expect(viewSrc.includes("new Notice(t('inquiry.notice.runContinuesInBackground'))")).toBe(true);
    });

    it('open re-reads settings, shows passive status, and recovers via the existing session-load path', () => {
        expect(viewSrc.includes('this.recoverInquiryRunOnOpen();')).toBe(true);
        expect(viewSrc.includes('this.sessionStore.reloadFromSettings();')).toBe(true);
        expect(viewSrc.includes("t('inquiry.nav.backgroundRunInProgress')")).toBe(true);
        expect(viewSrc.includes('this.reopenSessionByKey(sessionKey);')).toBe(true);
    });

    it('recovery starts NO new run (observes only — no cancellation or runner call)', () => {
        const start = viewSrc.indexOf('private recoverInquiryRunOnOpen(');
        const end = viewSrc.indexOf('\n    private ', start + 1);
        const body = viewSrc.slice(start, end > start ? end : start + 2000);
        expect(body.includes('this.runInquiry(')).toBe(false);
        expect(body.includes('this.runner.')).toBe(false);
        expect(body.includes('this.requestActiveInquiryCancellation')).toBe(false);
        // Observation only: guarded by isRunning and reads the marker.
        expect(body.includes('if (this.state.isRunning) return;')).toBe(true);
        expect(body.includes('this.plugin._inquiryRunInFlight')).toBe(true);
    });
});
