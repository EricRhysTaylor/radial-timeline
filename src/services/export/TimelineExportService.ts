/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * TimelineExportService
 * ---------------------
 * Two user-facing export flows that also serve as the fixture corpus for the
 * greenfield web timeline engine (Stage 0):
 *
 *   1. Export timeline as image (SVG / PNG) — a self-contained image of the
 *      currently rendered radial timeline. The live SVG relies on the plugin's
 *      external CSS (classes + custom properties); an exported file must render
 *      correctly OUTSIDE Obsidian, so we bake the computed presentation styles
 *      onto a detached clone before serializing.
 *
 *   2. Export timeline data (JSON) — a schema-stamped, vault-agnostic snapshot
 *      of everything the renderer consumes (TimelineItem[], book/matter meta,
 *      and a renderConfig snapshot). Reproduces the render elsewhere.
 *
 * The document builder (buildTimelineDataExport / snapshotRenderConfig) is
 * intentionally free of Obsidian imports so it is unit-testable in node.
 */

import { Notice } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { App } from 'obsidian';
import type {
    BookMeta,
    BookProfile,
    ChronologueBackdropMicroRing,
    GlobalPovMode,
    MatterMeta,
    RadialTimelineSettings,
    ReadabilityScale,
    RuntimeContentType,
    TimelineItem,
} from '../../types';
import { isMatterNote } from '../../utils/sceneHelpers';

/** Schema version for the JSON data export document. Bump on breaking changes. */
export const TIMELINE_DATA_EXPORT_SCHEMA_VERSION = '1.0.0';

/** Vault-relative folder new exports are written into. */
export const TIMELINE_EXPORT_FOLDER = 'Radial Timeline Exports';

export type TimelineImageFormat = 'svg' | 'png';

/**
 * The subset of settings the renderer actually consumes via PluginRendererFacade
 * (see src/utils/sceneHelpers.ts). Captured as values so the render can be
 * reproduced in another engine. Completeness favored over minimality — when a
 * facade field exists it is included, even if optional.
 */
export interface TimelineExportRenderConfig {
    publishStageColors: Record<string, string>;
    subplotColors: string[];
    workingPatternId?: string;
    customWorkingPatterns?: RadialTimelineSettings['customWorkingPatterns'];
    targetCompletionDate?: string;
    enableAiSceneAnalysis: boolean;
    chronologueDurationCapSelection?: string;
    showBackdropRing?: boolean;
    chronologueBackdropMicroRings?: ChronologueBackdropMicroRing[];
    dominantSubplots?: Record<string, string>;
    discontinuityThreshold?: string;
    globalPovMode?: GlobalPovMode;
    runtimeContentType?: RuntimeContentType;
    currentMode?: string;
    sortByWhenDate?: boolean;
    showChapterMarkers?: boolean;
    timelineScope?: 'book' | 'saga';
    books: BookProfile[];
    activeBookId?: string;
    readabilityScale?: ReadabilityScale;
    actCount?: number;
    timelapseYearSimulation?: RadialTimelineSettings['timelapseYearSimulation'];
    synopsisGenerationMaxWords?: number;
    synopsisGenerationMaxLines?: number;
}

export interface TimelineMatterEntry {
    path?: string;
    title?: string;
    itemType?: TimelineItem['itemType'];
    matterMeta?: MatterMeta;
}

export interface TimelineDataExportDocument {
    /** Schema version of this document shape. */
    schemaVersion: string;
    /** ISO 8601 timestamp of when the export was produced. */
    exportedAt: string;
    /** Name of the producing tool. */
    generator: 'Radial Timeline';
    /** Plugin version (from manifest) that produced the export. */
    pluginVersion: string;
    /** Active render context (vault-agnostic). */
    context: {
        activeBookId?: string;
        bookTitle?: string;
        mode?: string;
        itemCount: number;
    };
    /** Central book metadata for the active manuscript, if a BookMeta note exists. */
    bookMeta: BookMeta | null;
    /** Front/back matter notes present in the render input, with parsed matter meta. */
    matter: TimelineMatterEntry[];
    /** Renderer configuration snapshot (the facade-consumed settings). */
    renderConfig: TimelineExportRenderConfig;
    /** The full TimelineItem[] as fed to the renderer. */
    items: TimelineItem[];
}

export interface BuildTimelineDataExportParams {
    items: TimelineItem[];
    bookMeta: BookMeta | null;
    settings: RadialTimelineSettings;
    pluginVersion: string;
    mode?: string;
    activeBookId?: string;
    bookTitle?: string;
    /** Injectable clock for deterministic tests. Defaults to now. */
    now?: Date;
}

/**
 * Capture the renderer-consumed subset of settings as plain values. Only the
 * fields the PluginRendererFacade reads are included — no absolute paths or
 * machine-specific state — so the document stays vault-agnostic.
 */
export function snapshotRenderConfig(settings: RadialTimelineSettings): TimelineExportRenderConfig {
    return {
        publishStageColors: settings.publishStageColors,
        subplotColors: settings.subplotColors,
        workingPatternId: settings.workingPatternId,
        customWorkingPatterns: settings.customWorkingPatterns,
        targetCompletionDate: settings.targetCompletionDate,
        enableAiSceneAnalysis: settings.enableAiSceneAnalysis,
        chronologueDurationCapSelection: settings.chronologueDurationCapSelection,
        showBackdropRing: settings.showBackdropRing,
        chronologueBackdropMicroRings: settings.chronologueBackdropMicroRings,
        dominantSubplots: settings.dominantSubplots,
        discontinuityThreshold: settings.discontinuityThreshold,
        globalPovMode: settings.globalPovMode,
        runtimeContentType: settings.runtimeContentType,
        currentMode: settings.currentMode,
        sortByWhenDate: settings.sortByWhenDate,
        showChapterMarkers: settings.showChapterMarkers,
        timelineScope: settings.timelineScope,
        books: settings.books,
        activeBookId: settings.activeBookId,
        readabilityScale: settings.readabilityScale,
        actCount: settings.actCount,
        timelapseYearSimulation: settings.timelapseYearSimulation,
        synopsisGenerationMaxWords: settings.synopsisGenerationMaxWords,
        synopsisGenerationMaxLines: settings.synopsisGenerationMaxLines,
    };
}

/**
 * Build the schema-stamped JSON export document. Pure and Obsidian-free so it
 * can be unit-tested. Deep-clones input so the document is a stable snapshot.
 */
export function buildTimelineDataExport(params: BuildTimelineDataExportParams): TimelineDataExportDocument {
    const now = params.now ?? new Date();
    const items = deepClone(params.items);
    const matter: TimelineMatterEntry[] = items
        .filter((item) => isMatterNote(item))
        .map((item) => ({
            path: item.path,
            title: item.title,
            itemType: item.itemType,
            matterMeta: item.matterMeta,
        }));

    return {
        schemaVersion: TIMELINE_DATA_EXPORT_SCHEMA_VERSION,
        exportedAt: now.toISOString(),
        generator: 'Radial Timeline',
        pluginVersion: params.pluginVersion,
        context: {
            activeBookId: params.activeBookId,
            bookTitle: params.bookTitle,
            mode: params.mode,
            itemCount: items.length,
        },
        bookMeta: params.bookMeta ? deepClone(params.bookMeta) : null,
        matter,
        renderConfig: snapshotRenderConfig(params.settings),
        items,
    };
}

function deepClone<T>(value: T): T {
    // structuredClone is available in Obsidian's Electron runtime and node 17+.
    // TimelineItem may carry Date instances (when) — structuredClone preserves them.
    return structuredClone(value);
}

/**
 * Presentation properties baked onto each element from getComputedStyle so the
 * serialized SVG renders identically without the plugin's stylesheet. Geometry
 * lives in element attributes (d, cx, points, viewBox) and is untouched.
 */
const INLINE_STYLE_PROPS: readonly string[] = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
    'opacity', 'color', 'visibility', 'display',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'letter-spacing', 'word-spacing', 'text-decoration', 'text-transform',
    'transform', 'transform-origin', 'transform-box',
    'mix-blend-mode', 'paint-order', 'vector-effect', 'shape-rendering',
    'filter', 'clip-path', 'marker-start', 'marker-mid', 'marker-end',
];

/**
 * Decide whether a computed value is worth baking onto the clone. Meaningful
 * paint values (including `fill:none`) are kept; `display:none` and non-visible
 * `visibility` are preserved so hidden elements (e.g. unhovered synopses) stay
 * hidden; inert defaults are dropped to keep the file lean.
 */
function shouldInlineProp(prop: string, value: string): boolean {
    if (!value) return false;
    if (prop === 'fill' || prop === 'stroke') return true;
    if (prop === 'display') return value === 'none';
    if (prop === 'visibility') return value !== 'visible';
    return value !== 'normal' && value !== 'none';
}

/** SVG elements that actually render glyphs — the only places a font matters. */
const TEXT_BEARING_SVG_TAGS: ReadonlySet<string> = new Set(['text', 'tspan', 'textPath']);

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
 * the document's stylesheets. The plugin bundle embeds its custom fonts as
 * base64 data URIs in styles.css, so the runtime CSSOM is the single source of
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

export class TimelineExportService {
    constructor(private plugin: RadialTimelinePlugin, private app: App) {}

    /** The first open timeline view's live SVG, or null if none is rendered. */
    private getActiveTimelineSvg(): { svg: SVGSVGElement; mode: string } | null {
        const views = this.plugin.getTimelineViews();
        for (const view of views) {
            const svg = view.contentEl.querySelector<SVGSVGElement>('.radial-timeline-svg');
            if (svg) {
                return { svg, mode: view.currentMode };
            }
        }
        return null;
    }

    /**
     * Serialize a live timeline SVG into a self-contained standalone document.
     * Reads getComputedStyle from the live (in-DOM) elements and bakes the
     * resolved presentation values onto a detached clone, so the file needs no
     * external CSS or custom-property definitions. Custom fonts used by text
     * elements are embedded as @font-face data-URI rules in a <style> element,
     * so glyphs render identically in external viewers and rasterizers.
     */
    private serializeSelfContainedSvg(liveSvg: SVGSVGElement): { svgString: string; width: number; height: number } {
        const doc = liveSvg.ownerDocument;
        const view = doc.defaultView;
        if (!view) {
            throw new Error('Timeline export requires a live document window.');
        }

        const clone = liveSvg.cloneNode(true) as SVGSVGElement;

        // Lockstep walk: clone is an exact deep copy, so querySelectorAll('*')
        // yields identical document order and length in both trees.
        const liveEls: Element[] = [liveSvg, ...Array.from(liveSvg.querySelectorAll('*'))];
        const cloneEls: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
        const count = Math.min(liveEls.length, cloneEls.length);
        const usedFontFamilies = new Set<string>();
        for (let i = 0; i < count; i++) {
            const computed = view.getComputedStyle(liveEls[i]);
            const declarations: string[] = [];
            for (const prop of INLINE_STYLE_PROPS) {
                const value = computed.getPropertyValue(prop);
                if (shouldInlineProp(prop, value)) {
                    declarations.push(`${prop}:${value}`);
                }
            }
            if (declarations.length > 0) {
                cloneEls[i].setAttribute('style', declarations.join(';'));
            }
            if (
                TEXT_BEARING_SVG_TAGS.has(liveEls[i].localName) &&
                computed.getPropertyValue('display') !== 'none'
            ) {
                for (const family of parseFontFamilyList(computed.getPropertyValue('font-family'))) {
                    usedFontFamilies.add(family);
                }
            }
        }

        // Embed only the @font-face rules for families the timeline text
        // actually uses; families without a self-contained rule (system and
        // interface fonts) resolve from the viewer's fallback stack.
        const fontFaces = selectFontFacesForFamilies(collectSelfContainedFontFaces(doc), usedFontFamilies);
        if (fontFaces.length > 0) {
            const styleEl = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
            styleEl.textContent = buildFontFaceCss(fontFaces);
            clone.insertBefore(styleEl, clone.firstChild);
        }

        // Resolve concrete pixel dimensions from the viewBox so the standalone
        // file and any raster have a real intrinsic size (live SVG is 100%/100%).
        const viewBox = liveSvg.getAttribute('viewBox') || '-800 -800 1600 1600';
        const vbParts = viewBox.split(/[\s,]+/).map(Number);
        const width = Number.isFinite(vbParts[2]) && vbParts[2] > 0 ? vbParts[2] : 1600;
        const height = Number.isFinite(vbParts[3]) && vbParts[3] > 0 ? vbParts[3] : 1600;

        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        clone.setAttribute('viewBox', viewBox);
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const serialized = new XMLSerializer().serializeToString(clone);
        const svgString = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${serialized}`;
        return { svgString, width, height };
    }

    /**
     * Rasterize an SVG string to PNG at a scale factor. Mirrors the APR export
     * pattern (Blob -> Image -> offscreen canvas -> toBlob).
     */
    private async svgToPngBuffer(svgString: string, width: number, height: number, scale: number): Promise<ArrayBuffer> {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            throw new Error('PNG export is unavailable in this environment.');
        }
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);
        try {
            const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Failed to load SVG for PNG rendering.'));
                img.src = objectUrl;
            });
            // decode() blocks until the SVG image document is fully ready to
            // paint — including its embedded @font-face data-URI fonts, which
            // load inside the isolated image context and are not observable
            // via this document's FontFaceSet. Without it, drawImage can race
            // the font load and rasterize fallback glyphs.
            await image.decode();

            const targetWidth = Math.max(1, Math.round(width * scale));
            const targetHeight = Math.max(1, Math.round(height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not initialize canvas context.');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

            const pngBlob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob((result) => resolve(result), 'image/png');
            });
            if (!pngBlob) {
                throw new Error('Canvas failed to produce PNG data.');
            }
            return pngBlob.arrayBuffer();
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    private async ensureExportFolder(): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(TIMELINE_EXPORT_FOLDER);
        if (!existing) {
            await this.app.vault.createFolder(TIMELINE_EXPORT_FOLDER);
        }
    }

    private slugify(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'timeline';
    }

    private buildFileName(mode: string, extension: string): string {
        const bookSlug = this.slugify(this.plugin.getActiveBookTitle() || 'timeline');
        const modeSlug = this.slugify(mode || 'timeline');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `timeline-${bookSlug}-${modeSlug}-${stamp}.${extension}`;
    }

    /** Export the currently rendered timeline as a self-contained SVG or PNG. */
    public async exportImage(format: TimelineImageFormat, scale: number = 1): Promise<void> {
        const active = this.getActiveTimelineSvg();
        if (!active) {
            new Notice('Open the Radial Timeline view before exporting an image.');
            return;
        }

        try {
            const { svgString, width, height } = this.serializeSelfContainedSvg(active.svg);
            await this.ensureExportFolder();

            if (format === 'svg') {
                const path = `${TIMELINE_EXPORT_FOLDER}/${this.buildFileName(active.mode, 'svg')}`;
                await this.app.vault.create(path, svgString);
                new Notice(`Timeline SVG exported to ${path}`);
                return;
            }

            const png = await this.svgToPngBuffer(svgString, width, height, scale);
            const scaleTag = scale === 1 ? '' : `@${scale}x`;
            const baseName = this.buildFileName(active.mode, 'png').replace(/\.png$/, `${scaleTag}.png`);
            const path = `${TIMELINE_EXPORT_FOLDER}/${baseName}`;
            // Vault API, not adapter: re-exporting the same mode+scale must
            // overwrite, so modify an existing file rather than failing create.
            const existing = this.app.vault.getFileByPath(path);
            if (existing) await this.app.vault.modifyBinary(existing, png);
            else await this.app.vault.createBinary(path, png);
            new Notice(`Timeline PNG (${scale}x) exported to ${path}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Timeline image export failed: ${message}`);
            console.error('[TimelineExport] Image export failed:', error);
        }
    }

    /** Export the render input pipeline as a schema-stamped JSON document. */
    public async exportDataJson(): Promise<void> {
        try {
            const items = await this.plugin.getSceneData();
            if (!items || items.length === 0) {
                new Notice('No timeline data to export. Create scenes first.');
                return;
            }

            const active = this.getActiveTimelineSvg();
            const doc = buildTimelineDataExport({
                items,
                bookMeta: this.plugin.getBookMeta(),
                settings: this.plugin.settings,
                pluginVersion: this.plugin.manifest.version,
                mode: active?.mode ?? this.plugin.settings.currentMode,
                activeBookId: this.plugin.settings.activeBookId,
                bookTitle: this.plugin.getActiveBookTitle(),
            });

            await this.ensureExportFolder();
            const mode = doc.context.mode ?? 'timeline';
            const path = `${TIMELINE_EXPORT_FOLDER}/${this.buildFileName(mode, 'json')}`;
            await this.app.vault.create(path, JSON.stringify(doc, null, 2));
            new Notice(`Timeline data exported to ${path}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Timeline data export failed: ${message}`);
            console.error('[TimelineExport] Data export failed:', error);
        }
    }
}
