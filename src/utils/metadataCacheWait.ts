/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Waiting on Obsidian's metadata cache after vault writes, so a re-render
 * that reads frontmatter sees the files it just changed.
 */

import { TFile, type App } from 'obsidian';
import { sleep } from './sleep';

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

/** Poll until every path has frontmatter in the cache, or `timeoutMs` passes. */
export async function waitForFileCaches(app: App, paths: string[], timeoutMs = 5000, pollMs = 120): Promise<void> {
    if (paths.length === 0) return;
    const start = Date.now();
    const pending = new Set(paths);
    while (pending.size > 0 && (Date.now() - start) < timeoutMs) {
        for (const path of [...pending]) {
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;
            if (app.metadataCache.getFileCache(file)?.frontmatter) {
                pending.delete(path);
            }
        }
        if (pending.size === 0) break;
        await sleep(pollMs);
    }
}
