/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { App } from 'obsidian';
import { WRITING_STUDIO_VIEW_TYPE } from './constants';
import { WritingStudioView } from './WritingStudioView';

/** Re-read the book in every open Writing Studio (after its Chapter source changes). */
export function refreshWritingStudios(app: App): void {
    for (const leaf of app.workspace.getLeavesOfType(WRITING_STUDIO_VIEW_TYPE)) {
        if (leaf.view instanceof WritingStudioView) leaf.view.refreshBook();
    }
}

/**
 * Show the Writing Studio for the active book: the one already open, or a new
 * tab. With a scene path it opens at that scene.
 */
export async function openWritingStudio(app: App, scenePath?: string): Promise<void> {
    const existing = app.workspace.getLeavesOfType(WRITING_STUDIO_VIEW_TYPE)[0];
    if (existing) {
        await existing.loadIfDeferred();
        await app.workspace.revealLeaf(existing);
        if (scenePath && existing.view instanceof WritingStudioView) existing.view.showScene(scenePath);
        return;
    }
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: WRITING_STUDIO_VIEW_TYPE, active: true, state: scenePath ? { scenePath } : {} });
    await app.workspace.revealLeaf(leaf);
}
