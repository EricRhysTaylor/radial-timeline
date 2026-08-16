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

import { Notice, normalizePath } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { App } from 'obsidian';
import { resolveExportOutputFolder } from '../../utils/aiOutput';
import { systemFolderPath } from '../../utils/systemFolder';
import type {
    BookMeta,
    BookProfile,
    ChronologueBackdropMicroRing,
    GlobalPovMode,
    MatterMeta,
    RadialTimelineSettings,
    ReadabilityScale,
    RuntimeContentType,
    SubplotAlignment,
    TimelineItem,
} from '../../types';
import { isMatterNote } from '../../utils/sceneHelpers';
import {
    buildFontFaceCss,
    collectSelfContainedFontFaces,
    parseFontFamilyList,
    selectFontFacesForFamilies,
} from './exportFonts';

/**
 * Schema version for the JSON data export document. Bump on breaking changes.
 * 1.1.0 (additive): adds `exportId`, a per-export provenance UUID that also
 * appears in the SVG image export's <metadata> block.
 */
export const TIMELINE_DATA_EXPORT_SCHEMA_VERSION = '1.1.0';

/**
 * Vault-relative folder the JSON data export (the Community share file) is
 * written into. A sibling of `Social` inside the canonical system folder: the
 * two are the plugin's outward-facing artifact domains — `Social` holds APR
 * artwork, `Community` holds the interactive-timeline share files.
 */
export const TIMELINE_COMMUNITY_EXPORT_FOLDER = systemFolderPath('Community');

/**
 * Subfolder of the author's configured Export folder that timeline images land
 * in. The Export folder itself holds manuscript-shaped documents (compiled
 * manuscripts, outlines, cue cards, Gossamer evidence), so timestamped SVG/PNG
 * artwork gets its own bucket rather than interleaving with the files authors
 * hand to editors — the same sub-scoping the split-run exporter already uses.
 */
export const TIMELINE_IMAGE_EXPORT_SUBFOLDER = 'Timeline';

/**
 * Pre-relocation top-level folder. Exports used to create this as a SECOND
 * top-level Radial Timeline folder beside the canonical one. Nothing writes
 * here any more; the constant survives only so a vault that still has the
 * folder can be told once where its exports moved to. Existing files are never
 * moved or deleted — they are the author's.
 */
export const LEGACY_TIMELINE_EXPORT_FOLDER = 'Radial Timeline Exports';

/**
 * Vault-relative folder timeline images are written into, following the
 * author's configured Export folder (Settings -> Configuration).
 */
export function resolveTimelineImageExportFolder(plugin: RadialTimelinePlugin): string {
    return normalizePath(`${resolveExportOutputFolder(plugin)}/${TIMELINE_IMAGE_EXPORT_SUBFOLDER}`);
}

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
    subplotAlignment?: SubplotAlignment;
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
    /**
     * Per-export provenance UUID (crypto.randomUUID). Uniquely identifies this
     * export; the SVG image export stamps the same shape into its <metadata>.
     */
    exportId: string;
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
    /** Injectable provenance UUID for deterministic tests. Defaults to a new UUID. */
    exportId?: string;
    /**
     * When true, replace every subplot name in the document with a generic
     * label ("Subplot 1", "Subplot 2", …) via {@link applyGenericSubplotNames}.
     * Default false (passthrough) — subplot names are structural per Amendment
     * 1 and are exported verbatim unless the author opts into anonymizing them.
     */
    genericSubplotNames?: boolean;
}

/**
 * Per-export provenance identifier. Uses WebCrypto when present (Obsidian's
 * Electron runtime and modern Node), with a non-crypto fallback so the export
 * never fails purely for lack of a UUID source.
 */
export function generateExportId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // SAFE: fallback id for environments without WebCrypto; provenance only, not a security token.
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
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
        subplotAlignment: settings.subplotAlignment,
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

    const doc: TimelineDataExportDocument = {
        schemaVersion: TIMELINE_DATA_EXPORT_SCHEMA_VERSION,
        exportedAt: now.toISOString(),
        exportId: params.exportId ?? generateExportId(),
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

    if (params.genericSubplotNames) {
        applyGenericSubplotNames(doc);
    }

    return doc;
}

/**
 * Replace every subplot name in an export document with a generic label
 * ("Subplot 1", "Subplot 2", …), mutating `doc` in place. Mapping is
 * assigned in order of first appearance while walking `items` (manuscript /
 * author order) and applied consistently to every place a subplot name lives
 * in the document:
 *
 *  - each item's `subplot` field;
 *  - the same scene's `rawFrontmatter.Subplot` (string or string[]) — the
 *    field the web-engine adapter's dedup reads. A multi-subplot scene is
 *    exploded into one TimelineItem per subplot (SceneDataService), and all
 *    of those sibling items share one `rawFrontmatter` object by reference,
 *    so it is remapped once per unique object;
 *  - `renderConfig.dominantSubplots`, a path -> preferred-subplot-name map.
 *
 * Scene TITLES are never touched here — titles are a revealing field (reveal
 * model, server-side), not structural, and are untouched by this toggle.
 *
 * Per Amendment 1 §Data scope: "the plugin's export offers a 'generic ring
 * names' toggle (Subplot 1, Subplot 2…) for authors whose subplot names are
 * themselves spoilers."
 */
export function applyGenericSubplotNames(doc: TimelineDataExportDocument): void {
    const mapping = new Map<string, string>();
    const genericNameFor = (name: string): string => {
        let mapped = mapping.get(name);
        if (mapped === undefined) {
            mapped = `Subplot ${mapping.size + 1}`;
            mapping.set(name, mapped);
        }
        return mapped;
    };

    const seenRawFrontmatter = new Set<Record<string, unknown>>();
    for (const item of doc.items) {
        if (item.subplot) {
            item.subplot = genericNameFor(item.subplot);
        }

        const raw = item.rawFrontmatter;
        if (raw && !seenRawFrontmatter.has(raw)) {
            seenRawFrontmatter.add(raw);
            const rawSubplot = raw.Subplot;
            if (Array.isArray(rawSubplot)) {
                raw.Subplot = rawSubplot.map((entry) =>
                    typeof entry === 'string' ? genericNameFor(entry) : entry
                );
            } else if (typeof rawSubplot === 'string' && rawSubplot.length > 0) {
                raw.Subplot = genericNameFor(rawSubplot);
            }
        }
    }

    if (doc.renderConfig.dominantSubplots) {
        const remapped: Record<string, string> = {};
        for (const [path, name] of Object.entries(doc.renderConfig.dominantSubplots)) {
            remapped[path] = genericNameFor(name);
        }
        doc.renderConfig.dominantSubplots = remapped;
    }
}

function deepClone<T>(value: T): T {
    // structuredClone is available in Obsidian's Electron runtime and node 17+.
    // TimelineItem may carry Date instances (when) — structuredClone preserves them.
    return structuredClone(value);
}

/**
 * Fill longhands considered alongside the always-emitted `fill` shorthand.
 * (`fill` itself is emitted unconditionally — even `fill:none` is meaningful.)
 */
const FILL_DEP_PROPS: readonly string[] = ['fill-opacity', 'fill-rule'];

/**
 * Stroke longhands that only matter when the element actually has a stroke.
 * When `stroke` resolves to `none`, every one of these is inert and dropped.
 */
const STROKE_DEP_PROPS: readonly string[] = [
    'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
];

/**
 * Remaining paint/geometry-adjacent presentation props. `color` is deliberately
 * excluded: getComputedStyle resolves fill/stroke to concrete values, so any
 * `currentColor` reference is already baked into `fill`/`stroke` — carrying
 * `color` too would repeat that paint on every element for no visual effect.
 */
const OTHER_PAINT_PROPS: readonly string[] = [
    'opacity',
    'transform', 'transform-origin', 'transform-box',
    'mix-blend-mode', 'paint-order', 'vector-effect', 'shape-rendering',
    'filter', 'clip-path', 'marker-start', 'marker-mid', 'marker-end',
];

/**
 * Font/text props — emitted ONLY for glyph-bearing elements. The live CSS puts
 * a full font stack on every node via inheritance; baking it onto all ~9,600
 * elements (paths included) was the bulk of the old export's style bloat.
 */
const TEXT_PROPS: readonly string[] = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'letter-spacing', 'word-spacing', 'text-decoration', 'text-transform',
];

/**
 * Per-property initial (inert) values. getComputedStyle resolves every property
 * to a concrete value, so without this table each element repeats defaults such
 * as `fill-rule:nonzero` or `opacity:1`. A declaration equal to its property's
 * initial value carries no visual meaning and is dropped.
 */
const INERT_DEFAULTS: Readonly<Record<string, string>> = {
    'fill-opacity': '1',
    'fill-rule': 'nonzero',
    'stroke-opacity': '1',
    'stroke-width': '1px',
    'stroke-linecap': 'butt',
    'stroke-linejoin': 'miter',
    'stroke-dashoffset': '0px',
    'stroke-miterlimit': '4',
    'opacity': '1',
    'font-weight': '400',
    'font-style': 'normal',
    'font-variant': 'normal',
    'letter-spacing': 'normal',
    'word-spacing': 'normal',
    'text-transform': 'none',
    'mix-blend-mode': 'normal',
    'paint-order': 'normal',
    'vector-effect': 'none',
    'shape-rendering': 'auto',
    'filter': 'none',
    'clip-path': 'none',
    'marker-start': 'none',
    'marker-mid': 'none',
    'marker-end': 'none',
    'transform': 'none',
};

/** True when a computed declaration is inert (initial value) and can be dropped. */
function isDroppableDeclaration(prop: string, value: string): boolean {
    if (!value) return true;
    if (value === 'normal' || value === 'none') return true;
    if (INERT_DEFAULTS[prop] === value) return true;
    // Computed text-decoration expands to "<line> <style> <color>"; its inert
    // form is the one whose line component is `none` (e.g. "none solid rgb(0,0,0)").
    if (prop === 'text-decoration' && value.startsWith('none')) return true;
    return false;
}

/** SVG elements that actually render glyphs — the only places a font matters. */
const TEXT_BEARING_SVG_TAGS: ReadonlySet<string> = new Set(['text', 'tspan', 'textPath']);

/**
 * Build the baked presentation declaration string for one element from its
 * resolved computed style. `get` returns the computed value for a property
 * (injectable so this is unit-testable without a live DOM). Declarations are
 * emitted in a fixed order so structurally identical elements produce byte-for-
 * byte identical strings — the precondition for class deduplication.
 *
 * Rules:
 *  - `fill` is always emitted (even `fill:none`); its longhands only when non-default.
 *  - `stroke` and its longhands are emitted only when the element has a stroke.
 *  - `display:none` / non-visible `visibility` are preserved so hidden elements stay hidden.
 *  - inert defaults (per INERT_DEFAULTS + the `normal`/`none` sentinels) are dropped.
 *  - font/text props are emitted only when `isTextBearing`.
 */
export function buildBakedStyleDeclaration(get: (prop: string) => string, isTextBearing: boolean): string {
    const decls: string[] = [];
    const emit = (prop: string, value: string): void => {
        if (!isDroppableDeclaration(prop, value)) decls.push(`${prop}:${value}`);
    };

    // Visibility state first (deterministic order). Only the hiding cases matter.
    if (get('display') === 'none') decls.push('display:none');
    const visibility = get('visibility');
    if (visibility && visibility !== 'visible') decls.push(`visibility:${visibility}`);

    // Fill: the primary paint, always emitted (an unfilled shape is meaningful).
    const fill = get('fill');
    if (fill) decls.push(`fill:${fill}`);
    for (const prop of FILL_DEP_PROPS) emit(prop, get(prop));

    // Stroke: when absent, every stroke-* longhand is inert, so emit none of them.
    const stroke = get('stroke');
    if (stroke && stroke !== 'none') {
        decls.push(`stroke:${stroke}`);
        for (const prop of STROKE_DEP_PROPS) emit(prop, get(prop));
    }

    for (const prop of OTHER_PAINT_PROPS) emit(prop, get(prop));

    if (isTextBearing) {
        for (const prop of TEXT_PROPS) emit(prop, get(prop));
    }

    return decls.join(';');
}

/**
 * Interns baked declaration strings into shared, deduplicated CSS classes.
 * Identical declarations map to one class (`rtx0`, `rtx1`, …), emitted once in
 * the export's single <style> element instead of repeated as per-element inline
 * `style` attributes.
 */
export class ExportStyleClasses {
    private readonly byDecl = new Map<string, string>();

    /** Return the shared class name for a declaration string, minting one on first sight. */
    intern(decl: string): string {
        const existing = this.byDecl.get(decl);
        if (existing) return existing;
        const cls = `rtx${this.byDecl.size}`;
        this.byDecl.set(decl, cls);
        return cls;
    }

    /** Number of distinct declaration strings interned so far. */
    get size(): number {
        return this.byDecl.size;
    }

    /** CSS text for every interned class, one rule per line. */
    toCss(): string {
        const parts: string[] = [];
        for (const [decl, cls] of this.byDecl) {
            parts.push(`.${cls}{${decl}}`);
        }
        return parts.join('\n');
    }
}

/**
 * Runtime-only scaffolding that must NOT survive into a still export. The check
 * is an explicit allowlist of two element shapes, each with a documented reason
 * — never a "remove anything unusual" heuristic:
 *
 *  1. `<foreignObject>` — embedded XHTML. Two independent reasons to strip it:
 *     (a) Chromium taints any canvas that draws an SVG <image> containing a
 *         foreignObject, so `canvas.toBlob` throws "Tainted canvases may not be
 *         exported" and PNG export fails; (b) every foreignObject the renderer
 *         injects is interaction chrome (the Chronologue runtime toggle icon,
 *         the Recent-moves overlay, the Gossamer-runs overlay) — none is part
 *         of the still artwork.
 *  2. `.rt-measure-text` — an invisible <text> node the hover engine reuses for
 *     glyph metrics (SceneInteractionManager). It renders nothing.
 */
export function isRuntimeChromeElement(el: { localName: string; classList: DOMTokenList }): boolean {
    if (el.localName === 'foreignObject') return true;
    if (el.classList.contains('rt-measure-text')) return true;
    return false;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DC_NS = 'http://purl.org/dc/elements/1.1/';

/**
 * Build a standards-friendly <metadata> provenance block (RDF + Dublin Core)
 * for the exported SVG. Non-rendered and foreignObject-free, so it neither
 * affects layout nor taints a canvas. Constructed via DOM APIs (no innerHTML)
 * so the serializer emits correct namespace declarations and escapes text.
 */
function buildProvenanceMetadata(
    doc: Document,
    params: { exportId: string; exportedAt: string; pluginVersion: string }
): SVGMetadataElement {
    const metadata = doc.createElementNS(SVG_NS, 'metadata');
    const rdf = doc.createElementNS(RDF_NS, 'rdf:RDF');
    const description = doc.createElementNS(RDF_NS, 'rdf:Description');
    description.setAttributeNS(RDF_NS, 'rdf:about', '');

    const addDc = (localName: string, text: string): void => {
        const el = doc.createElementNS(DC_NS, `dc:${localName}`);
        el.textContent = text;
        description.appendChild(el);
    };

    const year = new Date(params.exportedAt).getUTCFullYear();
    addDc('rights', `© ${year} Radial Timeline LLC. All rights reserved.`);
    addDc('publisher', 'Radial Timeline LLC');
    addDc('source', 'https://radialtimeline.com');
    addDc('creator', `Radial Timeline plugin v${params.pluginVersion}`);
    addDc('date', params.exportedAt);
    addDc('identifier', `urn:uuid:${params.exportId}`);

    rdf.appendChild(description);
    metadata.appendChild(rdf);
    return metadata;
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
     * external CSS or custom-property definitions. Three cooperating steps:
     *  - strip runtime chrome (foreignObject/measurement nodes) so the clone is
     *    pure still artwork and no longer taints a PNG canvas;
     *  - bake computed styles as deduplicated shared classes in one <style>
     *    (alongside the embedded @font-face rules) instead of per-element inline
     *    `style` attributes, which dominated the file size;
     *  - stamp a provenance <metadata> block (© + per-export UUID) as first child.
     */
    private serializeSelfContainedSvg(
        liveSvg: SVGSVGElement,
        pluginVersion: string
    ): { svgString: string; width: number; height: number; exportId: string } {
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

        // Identify runtime chrome on the clone up front (foreignObject subtrees,
        // measurement scaffold). We skip baking styles onto them and remove them
        // after the walk — this fixes the tainted-canvas PNG failure and drops
        // non-artwork nodes from the standalone SVG. Descendants are collected so
        // a removed foreignObject takes its embedded XHTML with it.
        const removed = new Set<Element>();
        for (const el of cloneEls) {
            if (removed.has(el)) continue;
            if (isRuntimeChromeElement(el)) {
                removed.add(el);
                for (const descendant of Array.from(el.querySelectorAll('*'))) {
                    removed.add(descendant);
                }
            }
        }

        // Bake computed presentation styles as deduplicated shared classes. Each
        // element's declaration string is interned once; identical elements share
        // one class, emitted in a single <style> instead of per-element inline
        // `style` attributes (which were ~85% of the old export's bytes).
        const styleClasses = new ExportStyleClasses();
        const usedFontFamilies = new Set<string>();
        for (let i = 0; i < count; i++) {
            const cloneEl = cloneEls[i];
            if (removed.has(cloneEl)) continue;
            const liveEl = liveEls[i];
            const computed = view.getComputedStyle(liveEl);
            const isTextBearing = TEXT_BEARING_SVG_TAGS.has(liveEl.localName);
            const decl = buildBakedStyleDeclaration((prop) => computed.getPropertyValue(prop), isTextBearing);
            if (decl) {
                const generatedClass = styleClasses.intern(decl);
                const existingClass = cloneEl.getAttribute('class');
                cloneEl.setAttribute('class', existingClass ? `${existingClass} ${generatedClass}` : generatedClass);
            }
            if (isTextBearing && computed.getPropertyValue('display') !== 'none') {
                for (const family of parseFontFamilyList(computed.getPropertyValue('font-family'))) {
                    usedFontFamilies.add(family);
                }
            }
        }

        // Physically detach the runtime chrome (no-op for already-detached
        // descendants whose ancestor was removed first).
        for (const el of removed) {
            el.remove();
        }

        // One <style> carries both the embedded @font-face rules (font work) and
        // the deduplicated presentation classes. Font faces first so families are
        // defined before the classes that reference them. Only families the text
        // actually uses are embedded; system/interface fonts resolve from the
        // viewer's fallback stack.
        const fontFaces = selectFontFacesForFamilies(collectSelfContainedFontFaces(doc), usedFontFamilies);
        const styleSections: string[] = [];
        if (fontFaces.length > 0) styleSections.push(buildFontFaceCss(fontFaces));
        if (styleClasses.size > 0) styleSections.push(styleClasses.toCss());
        if (styleSections.length > 0) {
            const styleEl = doc.createElementNS(SVG_NS, 'style');
            styleEl.textContent = styleSections.join('\n');
            clone.insertBefore(styleEl, clone.firstChild);
        }

        // Provenance metadata as the first child of <svg> (© assertion + per-
        // export UUID). Non-rendered and taint-free.
        const exportId = generateExportId();
        const exportedAt = new Date().toISOString();
        const metadata = buildProvenanceMetadata(doc, { exportId, exportedAt, pluginVersion });
        clone.insertBefore(metadata, clone.firstChild);

        // Resolve concrete pixel dimensions from the viewBox so the standalone
        // file and any raster have a real intrinsic size (live SVG is 100%/100%).
        // The viewBox is the only description of what the artwork actually
        // covers. Substituting a guess would write a file that silently crops
        // or letterboxes the author's timeline, so an absent or unparseable
        // viewBox fails the export instead — the caller renders
        // "Timeline image export failed: <reason>".
        const viewBox = liveSvg.getAttribute('viewBox');
        if (!viewBox) {
            throw new Error('The timeline SVG has no viewBox, so its export dimensions cannot be determined. Re-render the timeline and try again.');
        }
        const vbParts = viewBox.split(/[\s,]+/).map(Number);
        const width = vbParts[2];
        const height = vbParts[3];
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error(`The timeline SVG viewBox ("${viewBox}") does not describe a positive width and height, so the export size cannot be determined.`);
        }

        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        clone.setAttribute('viewBox', viewBox);
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const serialized = new XMLSerializer().serializeToString(clone);
        const svgString = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${serialized}`;
        return { svgString, width, height, exportId };
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
            const canvas = createEl('canvas');
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

    /**
     * Create `folderPath` on demand, walking each segment — both destinations
     * are nested (`<system>/Community`, `<Export>/Timeline`), so a single
     * createFolder call cannot be relied on to materialize the parent.
     */
    private async ensureExportFolder(folderPath: string): Promise<void> {
        const normalized = normalizePath(folderPath);
        let current = '';
        for (const segment of normalized.split('/').filter(Boolean)) {
            current = current ? `${current}/${segment}` : segment;
            if (this.app.vault.getAbstractFileByPath(current)) continue;
            await this.app.vault.createFolder(current);
        }
    }

    /**
     * Tell the author once — after an export has actually succeeded at the new
     * location — that the old top-level `Radial Timeline Exports` folder is
     * dead. Only fires for vaults that still have the folder, so authors who
     * never produced a pre-relocation export never see it. The flag is plugin
     * state, not scene YAML.
     */
    private async noticeLegacyFolderOnce(): Promise<void> {
        if (this.plugin.settings.timelineExportRelocationNoticed) return;
        if (!this.app.vault.getAbstractFileByPath(LEGACY_TIMELINE_EXPORT_FOLDER)) return;
        this.plugin.settings.timelineExportRelocationNoticed = true;
        await this.plugin.saveSettings();
        new Notice(
            `Timeline exports now live under ${TIMELINE_COMMUNITY_EXPORT_FOLDER} (data) and `
            + `${resolveTimelineImageExportFolder(this.plugin)} (images). The old `
            + `"${LEGACY_TIMELINE_EXPORT_FOLDER}" folder is no longer used — its files are `
            + `yours to keep, move, or delete.`,
            12000
        );
    }

    private slugify(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'timeline'; // SAFE: a title made only of punctuation slugifies to empty, and filenames must be non-empty
    }

    private buildFileName(mode: string, extension: string): string {
        const bookSlug = this.slugify(this.plugin.getActiveBookTitle() || 'timeline'); // SAFE: filename slug for an untitled book; the timestamp still makes the name unique
        const modeSlug = this.slugify(mode || 'timeline'); // SAFE: filename slug only; guards an empty mode string from collapsing the name
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
            const { svgString, width, height } = this.serializeSelfContainedSvg(
                active.svg,
                this.plugin.manifest.version
            );
            const folder = resolveTimelineImageExportFolder(this.plugin);
            await this.ensureExportFolder(folder);

            if (format === 'svg') {
                const path = `${folder}/${this.buildFileName(active.mode, 'svg')}`;
                await this.app.vault.create(path, svgString);
                new Notice(`Timeline SVG exported to ${path}`);
                await this.noticeLegacyFolderOnce();
                return;
            }

            const png = await this.svgToPngBuffer(svgString, width, height, scale);
            const scaleTag = scale === 1 ? '' : `@${scale}x`;
            const baseName = this.buildFileName(active.mode, 'png').replace(/\.png$/, `${scaleTag}.png`);
            const path = `${folder}/${baseName}`;
            // Vault API, not adapter: re-exporting the same mode+scale must
            // overwrite, so modify an existing file rather than failing create.
            const existing = this.app.vault.getFileByPath(path);
            if (existing) await this.app.vault.modifyBinary(existing, png);
            else await this.app.vault.createBinary(path, png);
            new Notice(`Timeline PNG (${scale}x) exported to ${path}`);
            await this.noticeLegacyFolderOnce();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Timeline image export failed: ${message}`);
            console.error('[TimelineExport] Image export failed:', error);
        }
    }

    /** Export the render input pipeline as a schema-stamped JSON document. */
    public async exportDataJson(options?: { genericSubplotNames?: boolean }): Promise<void> {
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
                genericSubplotNames: options?.genericSubplotNames,
            });

            await this.ensureExportFolder(TIMELINE_COMMUNITY_EXPORT_FOLDER);
            const mode = doc.context.mode ?? 'timeline'; // SAFE: filename slug only; 'timeline' names an export whose document recorded no mode
            const path = `${TIMELINE_COMMUNITY_EXPORT_FOLDER}/${this.buildFileName(mode, 'json')}`;
            await this.app.vault.create(path, JSON.stringify(doc, null, 2));
            new Notice(`Timeline data exported to ${path}`);
            await this.noticeLegacyFolderOnce();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Timeline data export failed: ${message}`);
            console.error('[TimelineExport] Data export failed:', error);
        }
    }
}
