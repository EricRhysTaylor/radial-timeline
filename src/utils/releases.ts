/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

export const DEFAULT_RELEASES_URL = 'https://github.com/EricRhysTaylor/Radial-Timeline/releases';

export interface ReleaseVersionInfo {
    major: number;
    minor: number | null;
    patch: number | null;
    majorLabel: string;
    fullLabel: string;
}

export function parseReleaseVersion(version: string | undefined | null): ReleaseVersionInfo | null {
    if (!version) return null;
    const normalized = version.trim().replace(/^v/i, '');
    const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    const major = Number.parseInt(match[1], 10);
    const minor = match[2] !== undefined ? Number.parseInt(match[2], 10) : null;
    const patch = match[3] !== undefined ? Number.parseInt(match[3], 10) : null;
    const majorLabel = minor !== null ? `${major}.${minor}` : `${major}`;
    const fullLabel = patch !== null ? `${majorLabel}.${patch}` : majorLabel;
    return { major, minor, patch, majorLabel, fullLabel };
}

export function compareReleaseVersionsDesc(aVersion: string, bVersion: string): number {
    const a = parseReleaseVersion(aVersion);
    const b = parseReleaseVersion(bVersion);
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.major !== b.major) return b.major - a.major;
    const aMinor = a.minor ?? 0;
    const bMinor = b.minor ?? 0;
    if (aMinor !== bMinor) return bMinor - aMinor;
    const aPatch = a.patch ?? 0;
    const bPatch = b.patch ?? 0;
    return bPatch - aPatch;
}

export function formatPublishedDate(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleDateString();
    } catch {
        return null;
    }
}
