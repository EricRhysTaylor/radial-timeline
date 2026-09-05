/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The two slug contracts in the plugin. Every slug goes through one of these.
 */

/**
 * Lowercase kebab slug: every run of characters outside a-z / 0-9 becomes one
 * hyphen, edge hyphens go, and `fallback` stands in when nothing survives.
 * Used for ids, aliases, and generated file names.
 */
export function kebabSlug(value: string, fallback: string): string {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || fallback;
}

/**
 * Case-preserving file stem: strips characters a file name cannot carry,
 * turns whitespace runs into single hyphens, and falls back when nothing
 * survives. Used where the author's capitalisation should be kept.
 */
export function slugifyToFileStem(title: string, fallback = 'Manuscript'): string {
    return title
        .replace(/[/\\:*?"<>|]+/g, '')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        || fallback;
}
