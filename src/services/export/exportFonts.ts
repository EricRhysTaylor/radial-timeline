/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * exportFonts
 * -----------
 * Shared @font-face embedding for image exports (timeline + author progress).
 * The plugin bundle embeds its custom fonts as base64 data URIs in styles.css;
 * these helpers harvest the self-contained rules from the live document's
 * CSSOM so an exported SVG can carry the exact glyphs it was rendered with.
 */

/** A @font-face rule harvested from the live document's stylesheets. */
export interface ExportFontFaceRule {
    /** Unquoted font-family name as declared in the rule. */
    family: string;
    /** The full `@font-face { ... }` rule text, src data URIs included. */
    cssText: string;
}

/** Strip one matching pair of surrounding quotes from a font-family name. */
function unquoteFontFamily(name: string): string {
    const match = name.match(/^(['"])(.*)\1$/);
    return (match ? match[2] : name).trim();
}

/** Parse a CSS font-family list ("'04b03b', Monaco, monospace") into names. */
export function parseFontFamilyList(value: string): string[] {
    return value
        .split(',')
        .map((part) => unquoteFontFamily(part.trim()))
        .filter((name) => name.length > 0);
}

/**
 * True when every url() in a @font-face src is a data: URI, i.e. the rule can
 * be copied into a standalone file without introducing external references.
 */
export function isDataUriOnlySrc(src: string): boolean {
    if (!src) return false;
    const urls = Array.from(
        src.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi),
        (match) => match[2].trim()
    );
    return urls.length > 0 && urls.every((url) => url.toLowerCase().startsWith('data:'));
}

/**
 * Filter harvested @font-face rules down to the families a render actually
 * uses (case-insensitive, per CSS family matching), deduplicating identical
 * rules while keeping distinct weight/style variants of the same family.
 */
export function selectFontFacesForFamilies(
    available: ExportFontFaceRule[],
    usedFamilies: Iterable<string>
): ExportFontFaceRule[] {
    const used = new Set(Array.from(usedFamilies, (family) => family.toLowerCase()));
    const seen = new Set<string>();
    const selected: ExportFontFaceRule[] = [];
    for (const rule of available) {
        if (!used.has(rule.family.toLowerCase())) continue;
        if (seen.has(rule.cssText)) continue;
        seen.add(rule.cssText);
        selected.push(rule);
    }
    return selected;
}

/** Join selected @font-face rules into the CSS for the exported <style>. */
export function buildFontFaceCss(rules: ExportFontFaceRule[]): string {
    return rules.map((rule) => rule.cssText).join('\n');
}

/**
 * Harvest every self-contained @font-face rule (all srcs are data: URIs) from
 * the document's stylesheets. The runtime CSSOM is the single source of
 * truth — rules are copied verbatim, never re-encoded. Rules whose src points
 * at an external URL are skipped: they could not resolve outside Obsidian.
 */
export function collectSelfContainedFontFaces(doc: Document): ExportFontFaceRule[] {
    const view = doc.defaultView;
    if (!view) return [];
    const rules: ExportFontFaceRule[] = [];
    for (const sheet of Array.from(doc.styleSheets)) {
        if (sheet.disabled) continue;
        let cssRules: CSSRuleList;
        try {
            cssRules = sheet.cssRules;
        } catch {
            continue; // cross-origin stylesheet — cannot be one of ours
        }
        for (const rule of Array.from(cssRules)) {
            if (!(rule instanceof view.CSSFontFaceRule)) continue;
            const family = unquoteFontFamily(rule.style.getPropertyValue('font-family').trim());
            const src = rule.style.getPropertyValue('src');
            if (!family || !isDataUriOnlySrc(src)) continue;
            rules.push({ family, cssText: rule.cssText });
        }
    }
    return rules;
}
