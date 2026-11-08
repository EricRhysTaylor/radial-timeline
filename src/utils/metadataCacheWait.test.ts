import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { filesIndexed } from './metadataCacheWait';

/** A vault whose metadata cache has read the notes in `read`, and reports each note it reads next. */
function vault(paths: string[], read: Set<string>) {
    const listeners: Array<{ name: string; listener: (file?: TFile) => void }> = [];
    const files = new Map(paths.map(path => [path, new TFile(path)]));
    const app = {
        vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
        metadataCache: {
            getFileCache: (file: TFile) => read.has(file.path) ? { frontmatter: { Class: 'Scene' } } : null,
            on: (name: string, listener: (file?: TFile) => void) => { const ref = { name, listener }; listeners.push(ref); return ref; },
            offref: (ref: { name: string }) => { listeners.splice(listeners.findIndex(entry => entry === ref), 1); },
        },
    } as unknown as App;
    const send = (name: string, file?: TFile) => { for (const entry of [...listeners]) if (entry.name === name) entry.listener(file); };
    const index = (path: string) => { read.add(path); send('changed', files.get(path)); };
    const rename = (path: string) => { files.delete(path); };
    return { app, index, rename, send, listeners };
}

describe('Waiting for new notes to be indexed', () => {
    afterEach(() => vi.useRealTimers());

    it('answers at once when every note is already read', async () => {
        const { app, listeners } = vault(['a.md'], new Set(['a.md']));
        await expect(filesIndexed(app, ['a.md'], 1000)).resolves.toBe(true);
        expect(listeners).toHaveLength(0);
    });

    it('answers as the cache reads the last note, and stops listening', async () => {
        const { app, index, listeners } = vault(['a.md', 'b.md'], new Set());
        const waiting = filesIndexed(app, ['a.md', 'b.md'], 1000);
        index('a.md');
        expect(listeners.length).toBeGreaterThan(0);
        index('b.md');
        await expect(waiting).resolves.toBe(true);
        expect(listeners).toHaveLength(0);
    });

    it('does not wait out the clock for a note renamed meanwhile: the cache’s resolved event settles it', async () => {
        const { app, index, rename, send } = vault(['a.md', 'b.md'], new Set());
        const waiting = filesIndexed(app, ['a.md', 'b.md'], 60000);
        index('a.md');
        rename('b.md');
        send('resolved');
        await expect(waiting).resolves.toBe(true);
    });

    it('says so when the notes are still unread after the wait', async () => {
        vi.useFakeTimers();
        const { app, listeners } = vault(['a.md'], new Set());
        const waiting = filesIndexed(app, ['a.md'], 1000);
        vi.advanceTimersByTime(1000);
        await expect(waiting).resolves.toBe(false);
        expect(listeners).toHaveLength(0);
    });
});
