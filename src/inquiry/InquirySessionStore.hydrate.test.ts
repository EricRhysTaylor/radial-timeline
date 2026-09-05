import { describe, expect, it } from 'vitest';
import { InquirySessionStore } from './InquirySessionStore';
import { serializeSessionsToArtifact } from './sessionArtifact';
import type { InquirySession } from './sessionTypes';

// The store debounces saves via window.setTimeout; the node test env has no
// window. Delegate to globalThis timers so scheduleSave() runs. Every test
// below flush()es, which cancels the debounce before it fires, so no stray
// timer callback escapes the test.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as { window?: unknown }).window = globalThis;
}

function makeSession(key: string): InquirySession {
    return {
        key,
        baseKey: key,
        result: {} as never,
        createdAt: 1_000,
        lastAccessed: 1_000,
        targetSceneIds: []
    };
}

/**
 * Fake data adapter standing in for the vault data-adapter. Serves a sidecar payload
 * and records every write so tests can assert whether the store flushed (and
 * with what).
 */
function makeFakeAdapter(initialSessions: InquirySession[] | null) {
    const writes: InquirySession[][] = [];
    const raw = initialSessions === null
        ? null
        : JSON.stringify(serializeSessionsToArtifact(initialSessions, 1_000));
    return {
        writes,
        adapter: {
            exists: async (p: string) => raw !== null || p.endsWith('inquiry'),
            read: async () => raw ?? '',
            write: async (_p: string, data: string) => {
                writes.push(JSON.parse(data).sessions as InquirySession[]);
            },
            mkdir: async () => undefined
        }
    };
}

function makeFakePlugin(adapter: unknown) {
    return {
        settings: { inquirySessionCache: undefined },
        saveSettings: () => Promise.resolve(),
        app: { vault: { adapter } }
    } as never;
}

describe('InquirySessionStore hydrate + write guard', () => {
    it('does NOT write the sidecar before hydrate (clobber guard)', async () => {
        const { writes, adapter } = makeFakeAdapter([makeSession('good')]);
        const store = new InquirySessionStore(makeFakePlugin(adapter));

        // Fresh store, empty cache (no inquirySessionCache in settings). A mutation
        // + flush before hydrate must NOT reach the sidecar.
        store.setSession(makeSession('new'));
        await store.flush();

        expect(writes).toHaveLength(0);
    });

    it('regression: a fresh store cannot overwrite a good sidecar with an empty set', async () => {
        const { writes, adapter } = makeFakeAdapter([makeSession('good')]);
        const store = new InquirySessionStore(makeFakePlugin(adapter));

        // Simulate the exact clobber path: a read getter bumps lastAccessed and
        // schedules a save while the cache is still empty + un-hydrated.
        store.getSession('anything');
        await store.flush();

        expect(writes).toHaveLength(0); // the 'good' sidecar is untouched
    });

    it('hydrate loads the sidecar into the cache', async () => {
        const { adapter } = makeFakeAdapter([makeSession('a'), makeSession('b')]);
        const store = new InquirySessionStore(makeFakePlugin(adapter));

        expect(store.getSessionCount()).toBe(0);
        await store.hydrate();
        expect(store.getSessionCount()).toBe(2);
        expect(store.peekSession('a')?.key).toBe('a');
    });

    it('after hydrate, flush persists the real sessions (not empty)', async () => {
        const { writes, adapter } = makeFakeAdapter([makeSession('keep')]);
        const store = new InquirySessionStore(makeFakePlugin(adapter));

        await store.hydrate();
        await store.flush();

        expect(writes).toHaveLength(1);
        expect(writes[0].map(s => s.key)).toContain('keep');
    });

    it('in-memory (unsaved) work wins over the sidecar on key conflict', async () => {
        const { adapter } = makeFakeAdapter([makeSession('shared')]);
        const plugin = makeFakePlugin(adapter);
        // Seed the in-memory mirror as a same-process reopen would, with a newer
        // version of the same key plus an unsaved session.
        const fresh = makeSession('shared');
        fresh.lastAccessed = 9_999;
        (plugin as { settings: { inquirySessionCache?: unknown } }).settings.inquirySessionCache = {
            sessions: [fresh, makeSession('unsaved')],
            max: 25
        };
        const store = new InquirySessionStore(plugin);

        await store.hydrate();

        expect(store.getSessionCount()).toBe(2);
        expect(store.peekSession('shared')?.lastAccessed).toBe(9_999);
        expect(store.peekSession('unsaved')?.key).toBe('unsaved');
    });

    it('on sidecar read failure, writes stay disarmed (never clobber an unreadable file)', async () => {
        const writes: InquirySession[][] = [];
        const adapter = {
            exists: async () => true,
            read: async () => { throw new Error('disk error'); },
            write: async (_p: string, data: string) => {
                writes.push(JSON.parse(data).sessions as InquirySession[]);
            },
            mkdir: async () => undefined
        };
        const store = new InquirySessionStore(makeFakePlugin(adapter));

        await store.hydrate();
        store.setSession(makeSession('x'));
        await store.flush();

        expect(writes).toHaveLength(0);
    });
});
