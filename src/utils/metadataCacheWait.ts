/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Waiting on Obsidian's metadata cache after vault writes, so a re-render
 * that reads frontmatter sees the files it just changed.
 */

import { TFile, type App } from 'obsidian';

/** Resolve on the cache's next `resolved` event, or after `timeoutMs` if it never comes. */
export function waitForMetadataResolved(app: App, timeoutMs: number): Promise<void> {
    return new Promise<void>(resolve => {
        const timeout = window.setTimeout(resolve, timeoutMs);
        const ref = app.metadataCache.on('resolved', () => {
            window.clearTimeout(timeout);
            app.metadataCache.offref(ref);
            resolve();
        });
    });
}

/**
 * True once every path has its frontmatter in the cache, as the cache
 * reports each file it reads; false when `timeoutMs` passes first, so the
 * caller can say so rather than draw from half-read notes. A path no longer
 * in the vault (renamed or deleted meanwhile) has nothing left to read, and
 * the cache's `resolved` event, sent once it has read everything, checks
 * the paths again.
 */
export function filesIndexed(app: App, paths: readonly string[], timeoutMs: number): Promise<boolean> {
    const pending = new Set(paths);
    const settle = (): boolean => {
        for (const path of [...pending]) {
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile) || app.metadataCache.getFileCache(file)?.frontmatter) pending.delete(path);
        }
        return pending.size === 0;
    };
    if (settle()) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
        const finish = (indexed: boolean): void => {
            window.clearTimeout(timeout);
            app.metadataCache.offref(changed);
            app.metadataCache.offref(resolved);
            resolve(indexed);
        };
        const timeout = window.setTimeout(() => finish(false), timeoutMs);
        const changed = app.metadataCache.on('changed', file => { if (pending.has(file.path) && settle()) finish(true); });
        const resolved = app.metadataCache.on('resolved', () => { if (settle()) finish(true); });
        // A file read between the first check and the subscriptions sends no further event.
        if (settle()) finish(true);
    });
}

/** Wait until every path has frontmatter in the cache, or `timeoutMs` passes. */
export async function waitForFileCaches(app: App, paths: string[], timeoutMs = 5000): Promise<void> {
    await filesIndexed(app, paths, timeoutMs);
}
