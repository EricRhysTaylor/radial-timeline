/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { extractBodyAfterFrontmatter } from '../utils/frontmatterDocument';
import { getFrontMatterInfo, parseYaml, type Vault, type TFile } from 'obsidian';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { stripObsidianComments } from '../utils/text';
import { normalizeBooleanValue } from '../utils/sceneHelpers';
import type RadialTimelinePlugin from '../main';
import type { ProcessingMode } from '../modals/SceneAnalysisProcessingModal';
import type { ProcessedCheckOptions, SceneData } from './types';
import { isPathInExplicitFolderScope } from '../utils/pathScope';

function extractSceneNumber(filename: string): number | null {
    const match = filename.match(/^(\d+(\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
}

export function compareScenesByOrder(a: SceneData, b: SceneData): number {
    const parse = (name: string) => {
        const m = name.match(/^(\d+)(?:\.(\d+))?/);
        if (!m) return { major: Number.POSITIVE_INFINITY, minor: Number.POSITIVE_INFINITY };
        const major = parseInt(m[1], 10);
        const minor = typeof m[2] !== 'undefined' ? parseInt(m[2], 10) : -1;
        return { major, minor };
    };
    const A = parse(a.file.name);
    const B = parse(b.file.name);
    if (A.major !== B.major) return A.major - B.major;
    return A.minor - B.minor;
}

export function getSubplotNamesFromFM(fm: Record<string, unknown>): string[] {
    const value = (fm?.Subplot ?? fm?.subplot);
    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }
    if (Array.isArray(value)) {
        return (value as unknown[]).map(v => String(v).trim()).filter(Boolean);
    }
    return [];
}

export function getPulseUpdateFlag(fm: Record<string, unknown> | undefined): unknown {
    if (!fm) return undefined;
    const keys = [
        'Pulse Update',
        'PulseUpdate',
        'pulseupdate',
        'Beats Update',
        'BeatsUpdate',
        'beatsupdate',
        'Review Update',
        'ReviewUpdate',
        'reviewupdate'
    ];
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(fm, key)) {
            return (fm)[key];
        }
    }
    return undefined;
}

/**
 * Get the Summary Update flag from frontmatter (separate from Pulse).
 * Checks Summary Update first, then falls back to legacy Synopsis Update for migration.
 */
export function getSummaryUpdateFlag(fm: Record<string, unknown> | undefined): unknown {
    if (!fm) return undefined;
    const keys = [
        'Summary Update',
        'SummaryUpdate',
        'summaryupdate',
        // Legacy fallback — scenes may still have Synopsis Update from before the rename
        'Synopsis Update',
        'SynopsisUpdate',
        'synopsisupdate'
    ];
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(fm, key)) {
            return (fm)[key];
        }
    }
    return undefined;
}

function hasWordsContent(fm: Record<string, unknown>): boolean {
    const w1 = fm?.words;
    const w2 = (fm)['Words'];

    const parseWords = (val: unknown): number | undefined => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const cleaned = val.replace(/,/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? undefined : parsed;
        }
        return undefined;
    };

    const n1 = parseWords(w1);
    const n2 = parseWords(w2);
    const n = typeof n1 === 'number' ? n1 : (typeof n2 === 'number' ? n2 : undefined);
    return typeof n === 'number' && n > 0;
}

export function hasProcessableContent(fm: Record<string, unknown> | undefined): boolean {
    if (!fm) return false;

    const status = fm.Status || fm.status;
    const statusArray = Array.isArray(status) ? status : [status];
    const normalizedStatus = statusArray.map(value => typeof value === 'string' ? value.toLowerCase() : '').filter(Boolean);
    if (normalizedStatus.some(s => s === 'working' || s === 'complete')) return true;
    if (hasWordsContent(fm)) return true;
    return false;
}

function wasProcessedToday(frontmatter: Record<string, unknown> | undefined): boolean {
    if (!frontmatter) return false;

    const pulseLastUpdated = (frontmatter['Pulse Last Updated'] ?? frontmatter['Beats Last Updated']);
    if (!pulseLastUpdated || typeof pulseLastUpdated !== 'string') return false;
    const match = pulseLastUpdated.match(/^(.+?)\s+by\s+/);
    if (!match) return false;

    try {
        const timestampDate = new Date(match[1]);
        if (isNaN(timestampDate.getTime())) return false;
        const today = new Date();
        return timestampDate.toDateString() === today.toDateString();
    } catch {
        return false;
    }
}

export function hasBeenProcessedForBeats(
    frontmatter: Record<string, unknown> | undefined,
    options: ProcessedCheckOptions = {}
): boolean {
    if (!frontmatter) return false;

    const hasTimestamp = !!(frontmatter['Pulse Last Updated'] ?? frontmatter['Beats Last Updated']);
    const hasAnalysis =
        !!frontmatter['previousSceneAnalysis'] ||
        !!frontmatter['currentSceneAnalysis'] ||
        !!frontmatter['nextSceneAnalysis'];

    if (!hasTimestamp && !hasAnalysis) return false;
    if (options.todayOnly) {
        return hasTimestamp && wasProcessedToday(frontmatter);
    }

    return hasTimestamp || hasAnalysis;
}

export interface SceneDataQueryOptions {
    files?: TFile[];
}

export async function getAllSceneData(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    options: SceneDataQueryOptions = {}
): Promise<SceneData[]> {
    const scopedFiles = options.files;
    const sourcePath = plugin.settings.sourcePath.trim();
    const filesInPath = scopedFiles
        ? scopedFiles
        : vault.getMarkdownFiles().filter(file => isPathInExplicitFolderScope(file.path, sourcePath));

    const sceneDataPromises = filesInPath.map(async (file): Promise<SceneData | null> => {
        try {
            const content = await vault.read(file);
            const fmInfo = getFrontMatterInfo(content);
            if (!fmInfo || !(fmInfo as { exists?: boolean }).exists) {
                return null;
            }

            let frontmatter: Record<string, unknown> = {};
            try {
                const fmText = (fmInfo as { frontmatter?: string }).frontmatter ?? '';
                const parsed: unknown = fmText ? parseYaml(fmText) : {};
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected YAML mapping.');
                const rawFrontmatter = parsed as Record<string, unknown>;
                const mappings = getActiveFrontmatterMappings(plugin.settings);
                frontmatter = normalizeFrontmatterKeys(rawFrontmatter, mappings);
            } catch { // SAFE: unparseable frontmatter YAML — null excludes the file from scene data instead of guessing at fields
                return null;
            }

            const fileClass = frontmatter?.Class;
            if (typeof fileClass !== 'string' || fileClass.toLowerCase() !== 'scene') {
                return null;
            }

            const sceneNumber = extractSceneNumber(file.name);
            const body = stripObsidianComments(
                extractBodyAfterFrontmatter(content, fmInfo).trim()
            );
            return { file, frontmatter, sceneNumber, body };
        } catch { // SAFE: unreadable scene file — null skips just this file; the remaining vault files still produce scene data
            return null;
        }
    });

    const results = await Promise.all(sceneDataPromises);
    return results.filter((item): item is SceneData => item !== null);
}

export async function calculateSceneCount(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    mode: ProcessingMode
): Promise<number> {
    const isResuming = plugin.settings._isResuming || false;
    const allScenes = await getAllSceneData(plugin, vault);
    allScenes.sort(compareScenesByOrder);

    const processableScenes = allScenes.filter(scene => {
        if (mode === 'flagged') {
            const pulseUpdateFlag = getPulseUpdateFlag(scene.frontmatter);
            return normalizeBooleanValue(pulseUpdateFlag) && hasProcessableContent(scene.frontmatter);
        }
        if (mode === 'open') {
            return plugin.openScenePaths.has(scene.file.path) && hasProcessableContent(scene.frontmatter);
        }
        return hasProcessableContent(scene.frontmatter);
    });

    if (mode === 'flagged' || mode === 'open') {
        return processableScenes.length;
    }

    if (mode === 'force-all') {
        if (isResuming) {
            return processableScenes.filter(scene =>
                !hasBeenProcessedForBeats(scene.frontmatter, { todayOnly: true })
            ).length;
        }
        return processableScenes.length;
    }

    if (mode === 'unprocessed') {
        if (isResuming) {
            return processableScenes.filter(scene =>
                !hasBeenProcessedForBeats(scene.frontmatter, { todayOnly: true })
            ).length;
        }
        return processableScenes.filter(scene =>
            !hasBeenProcessedForBeats(scene.frontmatter)
        ).length;
    }

    return 0;
}

export async function calculateFlaggedCount(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    mode: ProcessingMode
): Promise<number> {
    const allScenes = await getAllSceneData(plugin, vault);
    allScenes.sort(compareScenesByOrder);
    const isFlagged = (scene: SceneData) =>
        normalizeBooleanValue(getPulseUpdateFlag(scene.frontmatter));

    if (mode === 'flagged') {
        return allScenes.filter(isFlagged).length;
    }
    if (mode === 'force-all') return allScenes.length;
    if (mode === 'unprocessed') {
        return allScenes.filter(s => hasProcessableContent(s.frontmatter) && !hasBeenProcessedForBeats(s.frontmatter)).length;
    }
    return 0;
}

export async function getDistinctSubplotNames(
    plugin: RadialTimelinePlugin,
    vault: Vault
): Promise<string[]> {
    const scenes = await getAllSceneData(plugin, vault);
    const subplotCounts = new Map<string, number>();

    scenes.forEach(scene => {
        const subplotList = getSubplotNamesFromFM(scene.frontmatter);
        subplotList.forEach(subplot => {
            if (subplot) {
                subplotCounts.set(subplot, (subplotCounts.get(subplot) || 0) + 1);
            }
        });
    });

    const subplotArray = Array.from(subplotCounts.entries()).map(([subplot, count]) => ({
        subplot,
        count
    }));

    subplotArray.sort((a, b) => {
        if (a.subplot === 'Main Plot' || !a.subplot) return -1;
        if (b.subplot === 'Main Plot' || !b.subplot) return 1;
        if (a.count !== b.count) return b.count - a.count;
        return a.subplot.localeCompare(b.subplot);
    });

    return subplotArray.map(item => item.subplot);
}
