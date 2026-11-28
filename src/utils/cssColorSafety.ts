/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Allowlist check for colours that come from settings (data.json) and are
 * written into SVG markup strings. The renderers build SVG as text and then
 * parse and mount it (see utils/svgDom.ts), so a colour such as
 * `red" onload="…` from a tampered or synced data.json would otherwise become
 * a live attribute. Only plain CSS colour forms pass; anything else falls back
 * to the shipped default colour.
 */

const MAX_COLOR_LENGTH = 64;
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:%|deg)?`;
const FUNCTIONAL_RE = new RegExp(
    String.raw`^(?:rgb|hsl)a?\(\s*${NUMBER}(?:\s*[,/]?\s*${NUMBER}){2,3}\s*\)$`,
    'i'
);
const VAR_RE = /^var\(\s*--[a-z0-9_-]+\s*(?:,\s*([^()]*(?:\([^()]*\))?)\s*)?\)$/i;
const NAMED_RE = /^[a-z]+$/i;

/** True when the value is a CSS colour form that is safe to place in an SVG attribute. */
export function isSafeCssColor(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const color = value.trim();
    if (color.length === 0 || color.length > MAX_COLOR_LENGTH) return false;
    if (HEX_RE.test(color) || FUNCTIONAL_RE.test(color) || NAMED_RE.test(color)) return true;
    const varMatch = VAR_RE.exec(color);
    if (!varMatch) return false;
    const fallback = varMatch[1];
    // var(--name) alone, or var(--name, <safe colour>) — never a nested var().
    return fallback === undefined || (!/^var\(/i.test(fallback.trim()) && isSafeCssColor(fallback));
}

/** The value, trimmed, when it is a safe colour; otherwise the fallback. */
export function safeCssColor(value: unknown, fallback: string): string {
    return isSafeCssColor(value) ? value.trim() : fallback;
}

/**
 * Check the publish-stage colour map read from settings. Only the known stage
 * names are kept (they are also written into SVG ids and class names), and each
 * colour that is not safe takes that stage's default.
 */
export function sanitizePublishStageColors<K extends string>(
    raw: unknown,
    defaults: Readonly<Record<K, string>>
): Record<K, string> {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    const result = {} as Record<K, string>;
    for (const stage of Object.keys(defaults) as K[]) {
        result[stage] = safeCssColor(record[stage], defaults[stage]);
    }
    return result;
}

/**
 * Check the subplot palette read from settings. Each slot that is not a safe
 * colour takes that slot's default (the palette repeats past its end), so slot
 * positions never shift.
 */
export function sanitizeSubplotColors(raw: unknown, defaults: readonly string[]): string[] {
    const list = Array.isArray(raw) ? raw : [];
    const length = Math.max(list.length, defaults.length);
    return Array.from({ length }, (_, i) => safeCssColor(list[i], defaults[i % defaults.length]));
}
