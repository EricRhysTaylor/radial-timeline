import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { filesIndexed } from './metadataCacheWait';

/** A vault whose metadata cache has read the notes in `read`, and reports each note it reads next. */
function vault(paths: string[], read: Set<string>) {
    const listeners: Array<(file: TFile) => void> = [];
    const files = new Map(paths.map(path => [path, new TFile(path)]));
    const app = {
        vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
        metadataCache: {
            getFileCache: (file: TFile) => read.has(file.path) ? { frontmatter: { Class: 'Scene' } } : null,
            on: (_name: string, listener: (file: TFile) => void) => { listeners.push(listener); return listener; },
            offref: (ref: (file: TFile) => void) => { listeners.splice(listeners.indexOf(ref), 1); },
        },
    } as unknown as App;
    const index = (path: string) => { read.add(path); for (const listener of [...listeners]) listener(files.get(path)!); };
    return { app, index, listeners };
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
        expect(listeners).toHaveLength(1);
        index('b.md');
        await expect(waiting).resolves.toBe(true);
        expect(listeners).toHaveLength(0);
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
