/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Strict, allowlist-based validator for user-pasted SVG patterns (Pro feature).
 *
 * SECURITY MODEL — see the README threat model. We do NOT sanitize the input
 * markup and re-emit it. Instead we:
 *   1. Parse with DOMParser as image/svg+xml.
 *   2. Walk the tree and reject any element outside {svg, g, path, circle}.
 *   3. Reject any attribute outside a per-tag allowlist (no on*, style, href,
 *      xlink:*, class, id, transform, xmlns:*).
 *   4. Validate path `d` and circle numeric coords against a tight regex.
 *   5. Strip any `fill` (per-stage tint is applied by the renderer wrapper).
 *   6. Extract the bare numeric data into a structured HeroPattern object.
 *
 * That last step is the crucial one: the pasted markup never enters the live
 * DOM. We extract numbers/strings, then the existing built-in renderer
 * (Defs.ts string output + ColorsSection.ts createElementNS preview) emits
 * fresh SVG from the structured shape. A malicious payload cannot survive a
 * parse-then-rewrite round trip.
 */
import type { HeroPattern, HeroPatternShape } from './HeroPatterns';

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_ELEMENTS = 50;
const MAX_PATH_DATA_BYTES = 8 * 1024;
const MIN_TILE = 4;
const MAX_TILE = 200;

// d attribute: SVG path commands + signed decimals + scientific notation
const PATH_DATA_RE = /^[\sMLHVCSQTAZmlhvcsqtaz0-9.,\-+eE]+$/;
// cx/cy/r: optional sign, decimal number
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const FILL_OPACITY_RE = /^(0|1|0?\.\d+)$/;
const FILL_RULE_RE = /^(evenodd|nonzero)$/;

export type ValidatedHeroPattern = Omit<HeroPattern, 'id' | 'name'>;

export type ValidationResult =
    | { ok: true; pattern: ValidatedHeroPattern }
    | { ok: false; error: string };

const ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'circle']);

function readTileDimensions(root: Element): { tileW: number; tileH: number } | string {
    const viewBox = root.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/);
        if (parts.length !== 4) return 'Invalid viewBox (expected "minX minY width height").';
        const w = parseFloat(parts[2]);
        const h = parseFloat(parts[3]);
        if (!Number.isFinite(w) || !Number.isFinite(h)) return 'Invalid viewBox dimensions.';
        return { tileW: w, tileH: h };
    }
    const w = parseFloat(root.getAttribute('width') ?? '');
    const h = parseFloat(root.getAttribute('height') ?? '');
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
        return 'Missing viewBox or width/height on <svg>.';
    }
    return { tileW: w, tileH: h };
}

function checkAllowedAttributes(
    el: Element,
    allowedNames: ReadonlySet<string>,
    ignoredNames: ReadonlySet<string>
): string | null {
    for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (allowedNames.has(name)) continue;
        if (ignoredNames.has(name)) continue;
        return `Disallowed attribute on <${el.tagName.toLowerCase()}>: ${attr.name}`;
    }
    return null;
}

// On <g> we strip fill (we apply per-stage tint ourselves) and ignore
// transform/xmlns:* (don't preserve them, but don't reject them either).
const G_ALLOWED = new Set(['fill-opacity', 'fill-rule']);
const G_IGNORED = new Set(['fill', 'transform']);
// On <path>/<circle> any fill-related attribute is ignored (tint is applied
// at the wrapping <g> at render time). `opacity` is allowed because it lets
// patterns like Graph Paper layer "ghost" lines under solid axes — purely
// visual, validated as a numeric in [0, 1].
const PATH_ALLOWED = new Set(['d', 'opacity']);
const PATH_IGNORED = new Set(['fill', 'fill-opacity', 'fill-rule']);
const CIRCLE_ALLOWED = new Set(['cx', 'cy', 'r', 'opacity']);
const CIRCLE_IGNORED = new Set(['fill', 'fill-opacity', 'fill-rule']);

const OPACITY_RE = /^(0|1|0?\.\d+|1\.0+)$/;

/**
 * Accept either bare SVG markup or a CSS `background-image: url("data:image/svg+xml,...")`
 * rule and return the SVG text. Hero Patterns' "Copy CSS" button gives the
 * latter form, so users who paste it shouldn't see a confusing parse error.
 */
function unwrapInput(text: string): string {
    const trimmed = text.trim();
    const cssUrl = trimmed.match(
        /url\(\s*["']?data:image\/svg\+xml(?:;charset=[^,;]+)?(?:;base64)?,([\s\S]+?)["']?\s*\)/i
    );
    if (cssUrl) {
        try { return decodeURIComponent(cssUrl[1]); } catch { /* fall through */ }
    }
    const bareUri = trimmed.match(
        /^data:image\/svg\+xml(?:;charset=[^,;]+)?(?:;base64)?,([\s\S]+)$/i
    );
    if (bareUri) {
        try { return decodeURIComponent(bareUri[1]); } catch { /* fall through */ }
    }
    return trimmed;
}

export function validateSvgPattern(svgText: string): ValidationResult {
    if (typeof svgText !== 'string') {
        return { ok: false, error: 'Empty input.' };
    }
    const unwrapped = unwrapInput(svgText);
    const trimmed = unwrapped.trim();
    if (trimmed.length === 0) {
        return { ok: false, error: 'Empty input.' };
    }
    if (trimmed.length > MAX_INPUT_BYTES) {
        return { ok: false, error: `Input too large (max ${MAX_INPUT_BYTES} bytes).` };
    }

    let doc: Document;
    try {
        const parser = new DOMParser();
        doc = parser.parseFromString(trimmed, 'image/svg+xml');
    } catch {
        return { ok: false, error: 'Could not parse SVG.' };
    }
    if (doc.querySelector('parsererror')) {
        return { ok: false, error: 'SVG markup is not well-formed.' };
    }

    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') {
        return { ok: false, error: 'Root element must be <svg>.' };
    }

    const dims = readTileDimensions(root);
    if (typeof dims === 'string') return { ok: false, error: dims };
    const { tileW, tileH } = dims;
    if (tileW < MIN_TILE || tileW > MAX_TILE || tileH < MIN_TILE || tileH > MAX_TILE) {
        return { ok: false, error: `Tile size out of range (${MIN_TILE}–${MAX_TILE}).` };
    }

    const shapes: HeroPatternShape[] = [];
    let fillOpacity = 0.4;
    let fillRule: 'evenodd' | 'nonzero' | undefined;
    let elementCount = 0;

    function walk(node: Element): string | null {
        elementCount++;
        if (elementCount > MAX_ELEMENTS) {
            return `Too many elements (max ${MAX_ELEMENTS}).`;
        }
        const tag = node.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
            return `Disallowed element: <${tag}>`;
        }

        if (tag === 'svg') {
            // Root: don't validate root attrs further (viewBox / width / height
            // / xmlns are inherent). Just walk children.
            for (const child of Array.from(node.children)) {
                const err = walk(child);
                if (err) return err;
            }
            return null;
        }

        if (tag === 'g') {
            const fo = node.getAttribute('fill-opacity');
            if (fo) {
                if (!FILL_OPACITY_RE.test(fo)) return 'Invalid fill-opacity on <g>.';
                const parsed = parseFloat(fo);
                if (parsed >= 0 && parsed <= 1) fillOpacity = parsed;
            }
            const fr = node.getAttribute('fill-rule');
            if (fr) {
                if (!FILL_RULE_RE.test(fr)) return 'Invalid fill-rule on <g>.';
                fillRule = fr as 'evenodd' | 'nonzero';
            }
            const attrErr = checkAllowedAttributes(node, G_ALLOWED, G_IGNORED);
            if (attrErr) return attrErr;
            for (const child of Array.from(node.children)) {
                const err = walk(child);
                if (err) return err;
            }
            return null;
        }

        if (tag === 'path') {
            const d = node.getAttribute('d');
            if (!d) return '<path> missing required d attribute.';
            if (d.length > MAX_PATH_DATA_BYTES) {
                return `<path> d attribute too large (max ${MAX_PATH_DATA_BYTES} bytes).`;
            }
            if (!PATH_DATA_RE.test(d)) {
                return '<path> d contains characters outside the SVG path-data grammar.';
            }
            const attrErr = checkAllowedAttributes(node, PATH_ALLOWED, PATH_IGNORED);
            if (attrErr) return attrErr;
            // Also check for fill-rule on the path itself — we collect it
            // (it's how Hero Patterns' Endless Clouds expresses it).
            const fr = node.getAttribute('fill-rule');
            if (fr) {
                if (!FILL_RULE_RE.test(fr)) return 'Invalid fill-rule on <path>.';
                fillRule = fr as 'evenodd' | 'nonzero';
            }
            const fo = node.getAttribute('fill-opacity');
            if (fo) {
                if (!FILL_OPACITY_RE.test(fo)) return 'Invalid fill-opacity on <path>.';
                const parsed = parseFloat(fo);
                if (parsed >= 0 && parsed <= 1) fillOpacity = parsed;
            }
            const attrs: Record<string, string> = { d };
            const op = node.getAttribute('opacity');
            if (op) {
                if (!OPACITY_RE.test(op)) return '<path> opacity must be a number in [0, 1].';
                attrs.opacity = op;
            }
            shapes.push({ tag: 'path', attrs });
            return null;
        }

        if (tag === 'circle') {
            const cx = node.getAttribute('cx');
            const cy = node.getAttribute('cy');
            const r = node.getAttribute('r');
            if (!cx || !cy || !r) return '<circle> requires cx, cy, and r.';
            if (!NUMBER_RE.test(cx) || !NUMBER_RE.test(cy) || !NUMBER_RE.test(r)) {
                return '<circle> cx/cy/r must be plain decimal numbers.';
            }
            const attrErr = checkAllowedAttributes(node, CIRCLE_ALLOWED, CIRCLE_IGNORED);
            if (attrErr) return attrErr;
            const attrs: Record<string, string> = { cx, cy, r };
            const op = node.getAttribute('opacity');
            if (op) {
                if (!OPACITY_RE.test(op)) return '<circle> opacity must be a number in [0, 1].';
                attrs.opacity = op;
            }
            shapes.push({ tag: 'circle', attrs });
            return null;
        }

        return `Disallowed element: <${tag}>`;
    }

    const err = walk(root);
    if (err) return { ok: false, error: err };
    if (shapes.length === 0) {
        return { ok: false, error: 'No <path> or <circle> shapes found.' };
    }

    const pattern: ValidatedHeroPattern = fillRule
        ? { tileW, tileH, shapes, fillOpacity, fillRule }
        : { tileW, tileH, shapes, fillOpacity };
    return { ok: true, pattern };
}
