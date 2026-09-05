/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Shared scene-note collection for timeline tools.
 * This keeps Audit and Timeline Order aligned on the same scoped scene files.
 */

import type { TFile, Vault } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { SceneData } from '../sceneAnalysis/types';
import { compareScenesByOrder, getAllSceneData } from '../sceneAnalysis/data';
import type { TimelineItem } from '../types';
import { parseWhenField } from '../utils/date';
import { readSceneId } from '../utils/sceneIds';

export interface SharedSceneNote {
    file: TFile;
    frontmatter: Record<string, unknown>;
    body: string;
    manuscriptOrderIndex: number;
    title: string;
    path: string;
    sceneId: string;
    rawWhen: string | null;
    parsedWhen: Date | null;
    whenParseIssue: 'missing_when' | 'invalid_when' | null;
    summary: string;
    synopsis: string;
}

function normalizeText(value: unknown): string {
    if (Array.isArray(value)) return value.map((entry) => String(entry)).join('\n').trim();
    if (typeof value === 'string') return value.trim();
    return '';
}

export function toRawWhenValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        const hour = String(value.getHours()).padStart(2, '0');
        const minute = String(value.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }
    return null;
}

export function parseSharedSceneWhen(rawWhen: string | null): Date | null {
    if (!rawWhen) return null;
    return parseWhenField(rawWhen);
}

export function mapSceneDataToSharedSceneNotes(sceneData: SceneData[]): SharedSceneNote[] {
    return sceneData
        .slice()
        .sort(compareScenesByOrder)
        .map((scene, manuscriptOrderIndex) => {
            const rawWhen = toRawWhenValue(scene.frontmatter.When);
            const parsedWhen = parseSharedSceneWhen(rawWhen);
            const whenParseIssue = rawWhen === null
                ? 'missing_when'
                : parsedWhen === null
                    ? 'invalid_when'
                    : null;

            return {
                file: scene.file,
                frontmatter: scene.frontmatter,
                body: scene.body,
                manuscriptOrderIndex,
                title: scene.file.basename,
                path: scene.file.path,
                sceneId: readSceneId(scene.frontmatter) || scene.file.path,
                rawWhen,
                parsedWhen,
                whenParseIssue,
                summary: normalizeText(scene.frontmatter.Summary),
                synopsis: normalizeText(scene.frontmatter.Synopsis)
            };
        });
}

export async function loadScopedSceneNotes(
    plugin: RadialTimelinePlugin,
    vault: Vault = plugin.app.vault
): Promise<SharedSceneNote[]> {
    const sceneData = await getAllSceneData(plugin, vault);
    return mapSceneDataToSharedSceneNotes(sceneData);
}

export function mapSharedSceneNoteToTimelineItem(note: SharedSceneNote): TimelineItem {
    return {
        title: note.title,
        date: note.rawWhen ?? '',
        path: note.path,
        sceneId: note.sceneId,
        synopsis: note.synopsis || undefined,
        Summary: note.summary || undefined,
        when: note.parsedWhen ?? undefined,
        missingWhen: note.whenParseIssue !== null,
        itemType: 'Scene',
        rawFrontmatter: note.frontmatter
    };
}

export function mapSharedSceneNotesToTimelineItems(notes: SharedSceneNote[]): TimelineItem[] {
    return notes.map(mapSharedSceneNoteToTimelineItem);
}

export function buildSharedSceneNoteFileMap(notes: SharedSceneNote[]): Map<string, TFile> {
    return new Map(notes.map((note) => [note.path, note.file]));
}
