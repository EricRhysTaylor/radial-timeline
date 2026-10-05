import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { InquirySessionStore } from './InquirySessionStore';
import { INQUIRY_SIDECAR_PATH, hasInquirySessionSidecarInVault } from './InquiryArtifactStore';
import { serializeSessionsToArtifact } from './sessionArtifact';
import type { InquirySession } from './sessionTypes';

const makeSession = (key: string): InquirySession => ({ key, baseKey: key, result: {} as never, createdAt: 1, lastAccessed: 1, targetSceneIds: [] });
function fixture() {
    const files = new Map<string, string>();
    const author = Array.from({ length: 30 }, (_, index) => makeSession(`author-${index}`));
    files.set(INQUIRY_SIDECAR_PATH, JSON.stringify(serializeSessionsToArtifact(author, 1)));
    for (const [title, count] of [['Pride', 3], ['Odyssey', 3], ['Sherlock', 12]] as const) {
        files.set(`Demo Projects/${title}/${INQUIRY_SIDECAR_PATH}`, JSON.stringify(serializeSessionsToArtifact(Array.from({ length: count }, (_, index) => makeSession(`${title}-${index}`)), 1)));
    }
    const adapter = {
        exists: async (path: string) => files.has(path) || path === 'Demo Projects' || path.endsWith('/Sessions'),
        read: async (path: string) => files.get(path)!,
        write: async (path: string, value: string) => { files.set(path, value); },
        mkdir: async () => undefined
    };
    const plugin = { settings: {}, app: { vault: { adapter, getFiles: () => Array.from(files.keys()).map(path => new TFile(path)) } } } as never;
    return { files, plugin, store: new InquirySessionStore(plugin) };
}

describe('imported demo Inquiry history', () => {
    it('keeps 18 demo answers beside all 30 authored answers, without writing demos into the author store', async () => {
        const { files, store } = fixture();
        const demoPath = `Demo Projects/Sherlock/${INQUIRY_SIDECAR_PATH}`;
        const originalDemo = files.get(demoPath);
        await store.hydrate();
        expect(store.getSessionCount()).toBe(48);
        expect(store.getSession('Sherlock-1')?.demoSourcePath).toBe(demoPath);
        await store.flush();
        expect(JSON.parse(files.get(INQUIRY_SIDECAR_PATH)!).sessions).toHaveLength(30);
        expect(files.get(demoPath)).toBe(originalDemo);
        expect(JSON.parse(files.get(INQUIRY_SIDECAR_PATH)!).sessions.every((session: InquirySession) => !session.demoSourcePath)).toBe(true);
    });
    it('removes deleted project sessions on refresh, retaining author and other demo history', async () => {
        const { files, store } = fixture();
        await store.hydrate();
        files.delete(`Demo Projects/Sherlock/${INQUIRY_SIDECAR_PATH}`);
        await store.hydrate();
        expect(store.getSessionCount()).toBe(36);
        expect(store.peekSession('Sherlock-1')).toBeUndefined();
        await store.flush();
    });
    it('finds a demo without a root artifact after a fresh restart', async () => {
        const { files, plugin, store } = fixture();
        files.delete(INQUIRY_SIDECAR_PATH);
        expect(await hasInquirySessionSidecarInVault((plugin as { app: never }).app)).toBe(true);
        await store.hydrate();
        expect(store.getSessionCount()).toBe(18);
        await store.flush();
        expect(JSON.parse(files.get(INQUIRY_SIDECAR_PATH)!).sessions).toHaveLength(0);
    });
    it('keeps newly generated work in the author store and does not evict curated demos', async () => {
        const { files, store } = fixture();
        await store.hydrate();
        const fresh = makeSession('new-run');
        fresh.lastAccessed = 99;
        store.setSession(fresh);
        await store.flush();
        const persisted = JSON.parse(files.get(INQUIRY_SIDECAR_PATH)!).sessions;
        expect(persisted).toHaveLength(30);
        expect(persisted.some((session: InquirySession) => session.key === 'new-run')).toBe(true);
        expect(store.getSessionCount()).toBe(48);
    });
    it('disarms writes on a failed reload after successful hydration', async () => {
        const { files, store } = fixture();
        await store.hydrate();
        const before = files.get(INQUIRY_SIDECAR_PATH);
        files.set(`Demo Projects/Odyssey/${INQUIRY_SIDECAR_PATH}`, '{bad');
        await store.hydrate();
        store.setSession(makeSession('should-not-persist'));
        await store.flush();
        expect(files.get(INQUIRY_SIDECAR_PATH)).toBe(before);
    });
});
