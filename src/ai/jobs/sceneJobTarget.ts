/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { resolveActiveBookSourcePath } from '../../services/NoteScopeResolver';
import { isPathInExplicitFolderScope } from '../../utils/pathScope';

/**
 * The scene file a scene job (Summary, Synopsis, Pulse) is about, as it is now.
 * Null only when the file no longer exists, which drops the job and its
 * answer. A scene outside the active book throws instead, which leaves both
 * in place until that book is active again: the job's prompt names its book
 * and is built from that book's scenes, so rebuilding it under another book
 * would discard a good answer.
 */
export function resolveSceneJobTarget(plugin: RadialTimelinePlugin, path: string): TFile | null {
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const { sourcePath } = resolveActiveBookSourcePath(plugin.app, plugin.settings);
    if (!isPathInExplicitFolderScope(file.path, sourcePath)) {
        throw new Error(`This job is for "${path}", which is not in the active book. Make its book active, then run Apply AI job answers.`);
    }
    return file;
}

/** For a scene file that exists but did not read as a scene, for example while its properties are being edited. */
export function unreadableSceneError(path: string): Error {
    return new Error(`"${path}" could not be read as a scene just now. Check its properties, then run Apply AI job answers.`);
}
