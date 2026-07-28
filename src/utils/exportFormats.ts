/*
 * Export format helpers (manuscript + outline + Pandoc).
 * Keep this module focused on formatting and process execution.
 */

import { normalizePath, FileSystemAdapter, Platform, Vault, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate, LegacyPersistedSettings } from '../types';
import type { ManuscriptSceneSelection, ManuscriptOrder } from './manuscript';
import { execFile, execFileSync } from 'child_process'; // SAFE: Node child_process for Pandoc subprocess + font probes
import * as fs from 'fs'; // SAFE: Node fs required for Pandoc temp files
import * as os from 'os'; // SAFE: Node os required for temp directory resolution
import * as path from 'path'; // SAFE: Node path required for temp/absolute paths
import { formatRuntimeValue, RuntimeSettings } from './runtimeEstimator';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { getVaultFontDir } from './pandocBundledLayouts';
import type { DesignedStyleSpec } from '../publishing/designedStyle';
import { BUNDLED_FICTION_SPECS, isBundledFictionId } from '../publishing/bundledStyleSpecs';
import { FONT_REGISTRY, vaultDirHasFont } from '../publishing/fontResolver';
import { assertNever } from './assertNever';

export type ExportType = 'manuscript' | 'outline';
export type ManuscriptPreset = 'screenplay' | 'podcast' | 'novel';
export type OutlinePreset = 'beat-sheet' | 'episode-rundown' | 'shooting-schedule' | 'index-cards-csv' | 'index-cards-json';
export type ExportFormat = 'markdown' | 'pdf' | 'docx' | 'csv' | 'json';

// ════════════════════════════════════════════════════════════════════════════
// Pandoc Layout Helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Strip/replace unsafe filename characters and collapse whitespace to hyphens.
 * Produces a clean stem suitable for PDF filenames.
 */
export function slugifyToFileStem(title: string): string {
    return title
        .replace(/[/\\:*?"<>|]+/g, '')   // strip forbidden chars
        .replace(/\s+/g, '-')            // spaces -> hyphens
        .replace(/-{2,}/g, '-')          // collapse runs
        .replace(/^-|-$/g, '')           // trim leading/trailing hyphens
        || 'Manuscript';                  // fallback
}

/** Look up a layout by its unique ID. */
export function getLayoutById(plugin: RadialTimelinePlugin, id: string | undefined): PandocLayoutTemplate | undefined {
    if (!id) return undefined;
    return (plugin.settings.pandocLayouts || []).find(l => l.id === id);
}

/** Return all layouts scoped to a given preset. */
export function getLayoutsForPreset(plugin: RadialTimelinePlugin, preset: ManuscriptPreset): PandocLayoutTemplate[] {
    return (plugin.settings.pandocLayouts || []).filter(l => l.preset === preset);
}

/**
 * Resolve the configured Pandoc folder, falling back to the default literal
 * baked into `DEFAULT_SETTINGS`. `pandocFolder` is required by the settings
 * type and the defaults const always populates it, so this single coalesce
 * covers both the "user blanked the field" and "settings merge succeeded"
 * cases.
 */
export function getPandocFolder(plugin: RadialTimelinePlugin): string {
    return normalizePath(plugin.settings.pandocFolder.trim() || DEFAULT_SETTINGS.pandocFolder);
}

export function readResolvedTemplateText(templatePath: string): { text: string; error?: string } {
    if (!templatePath.trim()) return { text: '', error: 'No template path configured.' };
    if (!path.isAbsolute(templatePath) || !fs.existsSync(templatePath)) {
        return { text: '', error: `Template file not found: ${templatePath}` };
    }
    try {
        return { text: fs.readFileSync(templatePath, 'utf8') };
    } catch (error) {
        return {
            text: '',
            error: (error as Error)?.message || `Unable to read template: ${templatePath}`,
        };
    }
}

export function isConfiguredExecutablePathMissing(configuredPath: string): boolean {
    const trimmed = configuredPath.trim();
    return Boolean(trimmed && (path.isAbsolute(trimmed) || trimmed.includes('/')) && !fs.existsSync(trimmed));
}

function getTemplatePathCandidates(plugin: RadialTimelinePlugin, templatePath: string): string[] {
    const trimmed = templatePath.trim();
    if (!trimmed) return [];
    if (path.isAbsolute(trimmed)) return [trimmed];

    const normalized = normalizePath(trimmed.replace(/^\/+/, ''));
    if (!normalized) return [];

    const candidates = [normalized];
    const pandocFolder = getPandocFolder(plugin);
    const prefixed = normalizePath(`${pandocFolder}/${normalized}`);
    if (!normalized.startsWith(`${pandocFolder}/`) && prefixed !== normalized) {
        candidates.push(prefixed);
    }
    return Array.from(new Set(candidates));
}

/**
 * Validate that a layout's .tex file exists.
 * Used by both Pro Settings (flash validation) and the export runner (hard-guard).
 */
export function validatePandocLayout(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate
): { valid: boolean; error?: string } {
    if (!layout.path || !layout.path.trim()) {
        return { valid: false, error: 'No template path configured.' };
    }
    const trimmed = layout.path.trim();
    const ext = path.extname(trimmed).toLowerCase();
    if (ext !== '.tex') {
        return { valid: false, error: 'Template file must use a .tex extension.' };
    }

    // Absolute path: check via Node fs
    if (path.isAbsolute(trimmed)) {
        try {
            fs.accessSync(trimmed, fs.constants.R_OK);
            return { valid: true };
        } catch {
            return { valid: false, error: `File not found: ${trimmed}` };
        }
    }

    const candidates = getTemplatePathCandidates(plugin, trimmed);
    for (const candidate of candidates) {
        const file = plugin.app.vault.getAbstractFileByPath(candidate);
        if (file instanceof TFile) {
            return { valid: true };
        }
    }
    const fallbackCandidate = candidates.find(candidate => candidate !== trimmed);
    if (fallbackCandidate) {
        return { valid: false, error: `File not found in vault: ${trimmed} (also checked ${fallbackCandidate})` };
    }
    return { valid: false, error: `File not found in vault: ${trimmed}` };
}

/**
 * Convert slugified stem to readable form (hyphens → spaces) for filenames.
 */
export function stemToReadable(stem: string): string {
    return stem.replace(/-+/g, ' ').trim() || 'Manuscript';
}

/**
 * Build the precursor compiled-markdown filename.
 * Pattern: "Manuscript {Preset} {Order} {Timestamp}.md" or "{ReadableStem} {Preset} {Order} {Timestamp}.md"
 * Example: "Working Title Novl Narr Feb 14 @ 11.51AM.md"
 */
export function buildPrecursorFilename(
    fileStem: string,
    preset: ManuscriptPreset,
    order: ManuscriptOrder,
    subplotFilter?: string
): string {
    const presetAcronym = getManuscriptPresetAcronym(preset);
    const orderAcronym = getOrderAcronym(order);
    const hasSubplotFilter = subplotFilter && subplotFilter !== 'All Subplots';
    const orderPart = hasSubplotFilter ? `Sub-${orderAcronym}` : orderAcronym;
    const timestamp = generateFriendlyTimestamp();
    const readableStem = stemToReadable(fileStem);
    const isDefault = fileStem === 'Manuscript' || fileStem === 'Untitled-Manuscript';
    const prefix = isDefault ? 'Manuscript' : readableStem;
    return `${prefix} ${presetAcronym} ${orderPart} ${timestamp}.md`;
}

// ════════════════════════════════════════════════════════════════════════════
// Export Filename Acronyms
// ════════════════════════════════════════════════════════════════════════════

function getOrderAcronym(order: ManuscriptOrder): string {
    switch (order) {
        case 'narrative': return 'Narr';
        case 'reverse-narrative': return 'RevN';
        case 'chronological': return 'Chro';
        case 'reverse-chronological': return 'RevC';
        default: return assertNever(order, 'getOrderAcronym');
    }
}

function getOutlinePresetAcronym(preset: OutlinePreset): string {
    switch (preset) {
        case 'beat-sheet': return 'BtSh';
        case 'episode-rundown': return 'EpRn';
        case 'shooting-schedule': return 'ShSc';
        case 'index-cards-csv': return 'IdxC';
        case 'index-cards-json': return 'IdxJ';
        default: return assertNever(preset, 'getOutlinePresetAcronym');
    }
}

function getManuscriptPresetAcronym(preset: ManuscriptPreset): string {
    switch (preset) {
        case 'screenplay': return 'Scrn';
        case 'podcast': return 'Podc';
        case 'novel': return 'Novl';
        default: return assertNever(preset, 'getManuscriptPresetAcronym');
    }
}

export function generateFriendlyTimestamp(): string {
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[now.getMonth()];
    const day = now.getDate();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${month} ${day} @ ${hour12}.${minutes}${ampm}`;
}

export interface ExportFilenameOptions {
    exportType: ExportType;
    order: ManuscriptOrder;
    subplotFilter?: string;
    manuscriptPreset?: ManuscriptPreset;
    outlinePreset?: OutlinePreset;
    extension: string;
    /** Book title-derived stem used for manuscript PDF naming. */
    fileStem?: string;
    /**
     * Two-letter layout abbreviation appended in square brackets to the PDF
     * filename so the template that produced the file is visible at a glance
     * (e.g. "[CL]" for Contemporary Literary, "[DS]" for designed styles).
     * See `getLayoutAbbreviation` in src/publishing/templateTiering.ts.
     * Only applied to manuscript PDF exports.
     */
    layoutAbbreviation?: string;
}

/**
 * Build export filename with acronyms
 * Pattern: "[Category/Title] [Preset] [Sub-][Order] [Timestamp].[ext]"
 * Examples:
 *   - "Manuscript Novl Narr Jan 12 @ 3.32PM.md"
 *   - "Working Title PDF Feb 14 @ 11.51AM.pdf"
 *   - "Outline BtSh RevN Jan 12 @ 3.32PM.md"
 *   - "Outline IdxC Sub-RevC Jan 12 @ 3.32PM.csv"
 */
export function buildExportFilename(options: ExportFilenameOptions): string {
    const timestamp = generateFriendlyTimestamp();
    const orderAcronym = getOrderAcronym(options.order);
    const hasSubplotFilter = options.subplotFilter && options.subplotFilter !== 'All Subplots';
    const orderPart = hasSubplotFilter ? `Sub-${orderAcronym}` : orderAcronym;
    const isPandocExport = options.exportType === 'manuscript'
        && (options.extension === 'pdf' || options.extension === 'docx');

    // Manuscript Pandoc exports (PDF, Word) use formal, title-first naming —
    // these are the files writers attach to submissions.
    if (isPandocExport) {
        const isDefault = options.fileStem === 'Manuscript' || options.fileStem === 'Untitled-Manuscript';
        const prefix = options.fileStem
            ? (isDefault ? 'Manuscript' : stemToReadable(options.fileStem))
            : 'Manuscript';
        const abbrev = options.layoutAbbreviation && /^[A-Z]{2}$/.test(options.layoutAbbreviation)
            ? ` [${options.layoutAbbreviation}]`
            : '';
        const formatLabel = options.extension === 'docx' ? 'Word' : 'PDF';
        return `${prefix} ${formatLabel} ${timestamp}${abbrev}.${options.extension}`;
    }
    
    if (options.exportType === 'outline') {
        const presetAcronym = getOutlinePresetAcronym(options.outlinePreset || 'beat-sheet');
        return `Outline ${presetAcronym} ${orderPart} ${timestamp}.${options.extension}`;
    } else {
        const category = isPandocExport ? 'Pandoc' : 'Manuscript';
        const presetAcronym = getManuscriptPresetAcronym(options.manuscriptPreset || 'novel');
        return `${category} ${presetAcronym} ${orderPart} ${timestamp}.${options.extension}`;
    }
}

export interface PandocOptions {
    targetFormat: 'pdf' | 'docx';
    pandocPath?: string;
    /** LaTeX template — PDF only. Ignored for docx. */
    templatePath?: string;
    /** Word reference document (styles) — docx only. Ignored for pdf. */
    referenceDocPath?: string;
    /**
     * Raw LaTeX injected into the preamble via `--include-in-header` (PDF only).
     * Carries the opt-in binding gutter (`\geometry{bindingoffset=…}`) and any
     * Pro custom preamble the author supplies. Ignored for docx because it is
     * LaTeX, not Word styling.
     */
    headerIncludes?: string;
    workingDir?: string;
    metadata?: Record<string, string | undefined>;
}

export interface OutlineExportResult {
    text: string;
    extension: 'md' | 'csv' | 'json';
    label: string;
}

/**
 * Parse the Pro "custom Pandoc metadata" setting: one `key: value` per line.
 * Blank lines and `#` comment lines are skipped. Keys are restricted to
 * Pandoc-legal metadata identifiers; anything else is ignored rather than
 * passed through to the CLI (fail-quiet at export time is deliberate — the
 * Publish tab reports skipped lines when the field is edited, and a malformed
 * line must never abort an export or leak arbitrary strings into subprocess
 * args). `title`/`author` keys are accepted here but overridden by BookMeta
 * at the call sites.
 */
export function parseCustomPandocMetadata(raw: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw) return out;
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf(':');
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key) || !value) continue;
        out[key] = value;
    }
    return out;
}

/**
 * LaTeX snippet for the opt-in paperback binding gutter (see
 * settings.pdfBindingGutter). `twoside` is included at the geometry level so
 * the offset alternates inner/outer even for layouts whose documentclass is
 * oneside (Standard Manuscript) — paperbacks print duplex, so a fixed left
 * offset would land on the wrong edge of every verso page. For layouts that
 * are already twoside it is a no-op.
 */
export const BINDING_GUTTER_LATEX = '\\geometry{twoside,bindingoffset=0.25in}';

function resolveVaultAbsolutePath(plugin: RadialTimelinePlugin, vaultPath: string): string | null {
    const adapter = plugin.app.vault.adapter; // SAFE: adapter needed to resolve absolute path for Pandoc output
    const fileSystemAdapterCtor = FileSystemAdapter as unknown as (new (...args: unknown[]) => FileSystemAdapter) | undefined;
    if (fileSystemAdapterCtor && adapter instanceof fileSystemAdapterCtor) {
        const basePath = (adapter).getBasePath();
        return path.join(basePath, normalizePath(vaultPath));
    }
    return null;
}

function resolvePandocBinary(options: PandocOptions): string {
    const configured = options.pandocPath && options.pandocPath.trim()
        ? options.pandocPath.trim()
        : 'pandoc';

    // Recover from settings values incorrectly normalized as vault paths
    // (e.g. "/opt/homebrew/bin/pandoc" stored as "opt/homebrew/bin/pandoc").
    if (
        getCurrentPlatform() !== 'win'
        && configured.includes('/')
        && !configured.startsWith('/')
        && !configured.startsWith('./')
        && !configured.startsWith('../')
    ) {
        const candidate = `/${configured.replace(/^\/+/, '')}`;
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    if (
        configured !== 'pandoc'
        && (path.isAbsolute(configured) || /^[A-Za-z]:[\\/]/.test(configured) || configured.includes('/') || configured.includes('\\'))
        && !fs.existsSync(configured)
    ) {
        // Fail clearly instead of spawning a dead path (which surfaces as an
        // opaque "spawn … ENOENT"). A stale configured path is a settings
        // problem the user can fix in one click — say so.
        throw new Error(`Pandoc not found at the configured path: ${configured}. Open Settings → Publish and click Auto locate, or clear the Pandoc path to use the system default.`);
    }

    return configured;
}

export type PdfEngine = 'pdflatex' | 'xelatex' | 'lualatex';

export interface PdfEngineSelection {
    engine: PdfEngine;
    path: string | null;
    available: Array<{ engine: PdfEngine; path: string }>;
    templateNeedsUnicode: boolean;
}

export interface TemplateFontDiagnostics {
    usesFontspec: boolean;
    fontsEmbeddedInPdf: boolean;
    requiredFonts: string[];
    optionalFonts: string[];
    missingRequiredFonts: string[];
    missingOptionalFonts: string[];
    canVerifySystemFonts: boolean;
}

let systemFontCatalogCache: string[] | null = null;
let systemFontCatalogLoaded = false;

function readTemplateText(templatePath?: string): string {
    if (!templatePath || !templatePath.trim()) return '';
    const trimmed = templatePath.trim();
    if (!path.isAbsolute(trimmed) || !fs.existsSync(trimmed)) return '';
    try {
        return fs.readFileSync(trimmed, 'utf8');
    } catch {
        return '';
    }
}

function normalizeFontFamilyName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractFontFamiliesFromTemplate(tex: string): string[] {
    const fonts = new Set<string>();
    const add = (value: string) => {
        const trimmed = value.trim();
        if (trimmed) fonts.add(trimmed);
    };
    const patterns = [
        /\\setmainfont(?:\[[^\]]*])?\{([^}]+)\}(?:\[[^\]]*])?/g,
        /\\newfontface\\[A-Za-z@]+(?:\[[^\]]*])?\{([^}]+)\}(?:\[[^\]]*])?/g
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(tex)) !== null) {
            add(match[1]);
        }
    }

    return Array.from(fonts);
}

function extractConditionalFontsFromTemplate(tex: string): string[] {
    const fonts = new Set<string>();
    const conditionalPattern = /\\IfFontExistsTF\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = conditionalPattern.exec(tex)) !== null) {
        const trimmed = match[1].trim();
        if (trimmed) fonts.add(trimmed);
    }
    return Array.from(fonts);
}

function extractHardRequiredConditionalFontsFromTemplate(tex: string): string[] {
    const fonts = new Set<string>();
    const conditionalPattern = /\\IfFontExistsTF\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = conditionalPattern.exec(tex)) !== null) {
        const font = match[1].trim();
        if (!font) continue;
        const nextConditional = tex.indexOf('\\IfFontExistsTF{', conditionalPattern.lastIndex);
        const searchEnd = nextConditional === -1 ? tex.length : nextConditional;
        const conditionalBody = tex.slice(conditionalPattern.lastIndex, searchEnd);
        if (/\\errmessage\s*\{/.test(conditionalBody)) {
            fonts.add(font);
        }
    }
    return Array.from(fonts);
}

function extractFontsWithMissingExplicitPathFiles(tex: string, templatePath?: string): string[] {
    const missing = new Set<string>();
    const templateDir = templatePath && path.isAbsolute(templatePath) ? path.dirname(templatePath) : process.cwd();
    const commandPattern = /\\(?:setmainfont|newfontface\\[A-Za-z@]+)(?:\[[^\]]*])?\{([^}]+)\}\s*\[([\s\S]*?)\]/g;
    let match: RegExpExecArray | null;
    while ((match = commandPattern.exec(tex)) !== null) {
        const fontName = match[1].trim();
        const options = match[2];
        const pathMatch = options.match(/(?:^|\n)\s*Path\s*=\s*([^,\]\n]+)\s*,?/);
        if (!fontName || !pathMatch) continue;

        const rawRoot = pathMatch[1].trim();
        if (!rawRoot) continue;
        const root = path.isAbsolute(rawRoot) ? rawRoot : path.resolve(templateDir, rawRoot);
        const fileMatches = Array.from(options.matchAll(/(?:UprightFont|ItalicFont|BoldFont|BoldItalicFont)\s*=\s*([^,\]\n]+)\s*,?/g));
        if (fileMatches.length === 0) continue;

        const anyMissing = fileMatches.some(fileMatch => {
            const fileName = fileMatch[1].trim();
            if (!fileName) return false;
            return !fs.existsSync(path.resolve(root, fileName));
        });
        if (anyMissing) missing.add(fontName);
    }
    return Array.from(missing);
}

function parseFcListFamilies(output: string): string[] {
    return output
        .split(/\r?\n/)
        .flatMap(line => line.split(':')[0]?.split(',') || [])
        .map(entry => entry.trim())
        .filter(Boolean);
}

function loadFontCatalogFromFcList(): string[] | null {
    const candidates = getCurrentPlatform() === 'mac'
        ? ['fc-list', '/opt/homebrew/bin/fc-list', '/usr/local/bin/fc-list', '/usr/bin/fc-list']
        : ['fc-list', '/usr/bin/fc-list', '/usr/local/bin/fc-list'];

    for (const candidate of candidates) {
        try {
            const output = execFileSync(candidate, [':', 'family'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 3000,
                maxBuffer: 1024 * 1024 * 8
            });
            const entries = parseFcListFamilies(output);
            if (entries.length > 0) {
                return Array.from(new Set(entries));
            }
        } catch {
            // Try next candidate path.
        }
    }
    return null;
}

function loadSystemFontCatalog(): string[] | null {
    // Test/CI seam: RT_FONT_CATALOG forces a deterministic catalog (comma-
    // separated font names) so font diagnostics do not depend on which fonts
    // the host machine happens to have installed (e.g. Arial is absent on
    // Linux CI runners). Checked before the cache so it is never poisoned by a
    // prior real fc-list read, and not cached itself so different callers can
    // vary it. Unset → normal system detection.
    const override = process.env.RT_FONT_CATALOG;
    if (override !== undefined) {
        return override.split(',').map(name => name.trim()).filter(Boolean);
    }

    if (systemFontCatalogLoaded) return systemFontCatalogCache;
    systemFontCatalogLoaded = true;

    const catalog = loadFontCatalogFromFcList();
    systemFontCatalogCache = catalog;
    return systemFontCatalogCache;
}

function isFontInstalled(fontName: string, catalog: string[]): boolean {
    const target = normalizeFontFamilyName(fontName);
    if (!target) return true;

    for (const entry of catalog) {
        const normalizedEntry = normalizeFontFamilyName(entry);
        if (!normalizedEntry) continue;
        if (normalizedEntry === target) return true;
    }
    return false;
}

function requiredSystemFontFileExists(fontName: string, platform: FontDiagnosticPlatform): boolean {
    const target = normalizeFontFamilyName(fontName);
    if (target !== 'arial') return false;

    if (platform === 'mac') {
        return [
            '/System/Library/Fonts/Supplemental/Arial.ttf',
            '/Library/Fonts/Arial.ttf',
            path.join(os.homedir(), 'Library/Fonts/Arial.ttf'),
        ].some(fontPath => fs.existsSync(fontPath));
    }

    if (platform === 'win') {
        const windowsRoot = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
        return fs.existsSync(path.join(windowsRoot, 'Fonts', 'arial.ttf'));
    }

    return false;
}

function isLikelyBundledLatexFont(fontName: string): boolean {
    const normalized = fontName.trim().toLowerCase();
    return normalized.startsWith('tex gyre')
        || normalized.startsWith('latin modern')
        || normalized.startsWith('computer modern');
}

export function getTemplateFontDiagnostics(templatePath?: string): TemplateFontDiagnostics {
    const tex = readTemplateText(templatePath);
    const usesFontspec = /\\usepackage\s*\{fontspec\}|\\setmainfont|\\newfontface|\\defaultfontfeatures/i.test(tex);
    const allFonts = extractFontFamiliesFromTemplate(tex);
    const hardRequiredConditionalFonts = extractHardRequiredConditionalFontsFromTemplate(tex);
    const hardRequiredConditionalSet = new Set(hardRequiredConditionalFonts.map(font => font.toLowerCase()));
    const optionalFonts = extractConditionalFontsFromTemplate(tex)
        .filter(font => !hardRequiredConditionalSet.has(font.toLowerCase()));
    const optionalSet = new Set(optionalFonts.map(font => font.toLowerCase()));
    const requiredFonts = Array.from(new Set([
        ...allFonts.filter(font => !optionalSet.has(font.toLowerCase())),
        ...hardRequiredConditionalFonts,
    ]));
    const missingExplicitPathFonts = extractFontsWithMissingExplicitPathFiles(tex, templatePath);
    const missingExplicitPathSet = new Set(missingExplicitPathFonts.map(font => font.toLowerCase()));
    const catalog = loadSystemFontCatalog();
    const canVerifySystemFonts = Array.isArray(catalog) || missingExplicitPathFonts.length > 0;

    const catalogMissingRequiredFonts = Array.isArray(catalog)
        ? requiredFonts.filter(font => !isLikelyBundledLatexFont(font) && !isFontInstalled(font, catalog))
        : [];
    const missingRequiredFonts = Array.from(new Set([
        ...catalogMissingRequiredFonts,
        ...requiredFonts.filter(font => missingExplicitPathSet.has(font.toLowerCase())),
    ]));
    const missingOptionalFonts = Array.isArray(catalog)
        ? optionalFonts.filter(font => !isFontInstalled(font, catalog))
        : [];

    return {
        usesFontspec,
        fontsEmbeddedInPdf: usesFontspec,
        requiredFonts,
        optionalFonts,
        missingRequiredFonts,
        missingOptionalFonts,
        canVerifySystemFonts
    };
}

// ════════════════════════════════════════════════════════════════════════════
// Structured Font Diagnostic
// ════════════════════════════════════════════════════════════════════════════
//
// `FontDiagnostic` is the structured, action-affordance-friendly counterpart
// to `TemplateFontDiagnostics`. Where the latter is the raw scan output, this
// one classifies the result into `ok | missing-system | missing-bundled` and adds
// an install hint suitable for surfacing as an inline link in the modal's
// Export Checks panel.

export type FontDiagnosticState = 'ok' | 'missing-system' | 'missing-bundled';

export type FontDiagnosticPlatform = 'mac' | 'win' | 'linux';

export interface FontDiagnosticInstallHint {
    source: 'google-fonts' | 'ctan' | 'bundled';
    /** Primary download URL (any platform). */
    url?: string;
    /** OS-tailored instruction line. */
    message: string;
    /** Short actionable bullet list, OS-tailored when relevant. */
    steps?: string[];
}

/**
 * Resolve the current OS family for diagnostic hint copy. Prefers Obsidian's
 * `Platform` (covers desktop + mobile cleanly) and falls back to
 * `process.platform` when the import is unavailable in a test environment.
 */
function getCurrentPlatform(): FontDiagnosticPlatform {
    try {
        if (Platform && typeof Platform === 'object') {
            if (Platform.isMacOS) return 'mac';
            if (Platform.isWin) return 'win';
            if (Platform.isLinux) return 'linux';
        }
    } catch {
        // Fall through to process.platform.
    }
    const p = typeof process !== 'undefined' ? process.platform : '';
    if (p === 'darwin') return 'mac';
    if (p === 'win32') return 'win';
    return 'linux';
}

/**
 * Build the OS-tailored Google Fonts install hint. Exported for direct
 * platform-coverage testing — `getStructuredFontDiagnostic` wires this in via
 * its `overridePlatform` argument, so tests can exercise the full hint shape
 * without depending on whether `fc-list` is present in the test runner.
 */
export function buildGoogleFontsHint(
    primaryFontName: string,
    url: string,
    platform: FontDiagnosticPlatform
): FontDiagnosticInstallHint {
    if (platform === 'mac') {
        return {
            source: 'google-fonts',
            url,
            message: `Install ${primaryFontName} via Font Book.`,
            steps: [
                'Download from Google Fonts (link below)',
                'Open the downloaded ZIP',
                'Drag the .ttf files onto Font Book to install',
                'Re-export this PDF',
            ],
        };
    }
    if (platform === 'win') {
        return {
            source: 'google-fonts',
            url,
            message: `Install ${primaryFontName} from Google Fonts.`,
            steps: [
                'Download the ZIP from Google Fonts',
                'Right-click each .ttf file → "Install for all users"',
                'Re-export this PDF',
            ],
        };
    }
    return {
        source: 'google-fonts',
        url,
        message: `Install ${primaryFontName} from Google Fonts.`,
        steps: [
            'Download the ZIP from Google Fonts',
            'Copy .ttf files to ~/.fonts/ or /usr/share/fonts/',
            'Run "fc-cache -f" to refresh',
            'Re-export this PDF',
        ],
    };
}

export function buildCtanHint(primaryFontName: string): FontDiagnosticInstallHint {
    // CTAN-source fonts cover system-installed TeX fonts whose download path
    // varies enough across distributions that fabricating platform-specific
    // steps would be misleading. Keep the message generic — the user will
    // already have a working TeX install if they're exporting PDFs.
    return {
        source: 'ctan',
        message: `Install ${primaryFontName} for the intended look.`,
    };
}

export interface FontDiagnostic {
    state: FontDiagnosticState;
    /** Display name of the font the spec / template requested. */
    primaryFontName: string;
    /** Font XeLaTeX is expected to use. Missing fonts fail instead of falling back. */
    resolvedFontName: string;
    installHint?: FontDiagnosticInstallHint;
}

const FONT_KEY_TO_DISPLAY: Record<DesignedStyleSpec['body']['font'], string> = {
    'sorts-mill-goudy': 'Sorts Mill Goudy',
    'latin-modern':     'Latin Modern Roman',
    'source-serif':     'Source Serif 4',
    'eb-garamond':      'EB Garamond',
    'crimson':          'Crimson Text',
    'system-serif':     'TeX Gyre Pagella',
    'system-sans':      'Arial',
};

const GOOGLE_FONTS_BY_KEY: Partial<Record<DesignedStyleSpec['body']['font'], string>> = {
    'sorts-mill-goudy': 'https://fonts.google.com/specimen/Sorts+Mill+Goudy',
    'eb-garamond':      'https://fonts.google.com/specimen/EB+Garamond',
    'crimson':          'https://fonts.google.com/specimen/Crimson+Text',
};

/**
 * Pick a DesignedStyleSpec for a layout. Bundled fiction layouts have a spec
 * registered in `BUNDLED_FICTION_SPECS`; user-authored designed layouts carry
 * their own `designedSpec`. Other layouts have no spec.
 */
function specForLayout(layout?: PandocLayoutTemplate): DesignedStyleSpec | undefined {
    if (!layout) return undefined;
    if (layout.designedSpec) return layout.designedSpec;
    if (isBundledFictionId(layout.id)) return BUNDLED_FICTION_SPECS[layout.id];
    return undefined;
}

/**
 * Verify that bundled font files for a font key are actually present in the
 * vault's `Radial Timeline/Pandoc/fonts/<slug>/` directory. Delegates to the
 * font resolver — same source of truth used by the LaTeX emit, so the
 * diagnostic and the actual export agree on what counts as "present".
 */
function vaultHasFontFiles(fontKey: DesignedStyleSpec['body']['font']): boolean {
    const root = getVaultFontDir();
    if (!root) return false;
    const entry = FONT_REGISTRY[fontKey];
    if (!entry || !entry.files.upright) return false;
    return vaultDirHasFont(root, entry.files);
}

/**
 * Spec-driven font diagnostic.
 *
 * Returns the structured `FontDiagnostic` for a layout. The state is:
 *   - 'ok'              → primary font resolves by an explicit verified path
 *   - 'missing-system'  → required system font is not installed; export should fail
 *   - 'missing-bundled' → primary is a plugin-bundled font but the asset files
 *                         aren't on disk (build artifact missing)
 *
 * Latin Modern is a hard contract for Modern Classic: the plugin must have
 * resolved a concrete TeX font directory and all four lmroman OTF faces must
 * exist there. No font-name or filename fallback is treated as ready.
 */
/**
 * Spec-key driven font diagnostic. Identical resolution logic to
 * `getStructuredFontDiagnostic` but takes a `body.font` enum value directly
 * rather than a full layout. Used by the Designed Style wizard's live
 * preview where the user is editing a working spec that has not yet been
 * persisted as a layout.
 *
 * Strict policy (Phase 1): no fallback resolution. The state is exactly
 * what the export pipeline will see when this font key is selected.
 */
export function getFontDiagnosticForFontKey(
    fontKey: DesignedStyleSpec['body']['font'] | undefined,
    overridePlatform?: FontDiagnosticPlatform
): FontDiagnostic {
    return resolveFontDiagnosticForKey(fontKey, overridePlatform);
}

/**
 * Single resolution path: vault → TeX tree → system → missing.
 *
 * Mirrors the LaTeX emit logic in `fontResolver.buildFontspecBlock` so the
 * Export Checks panel and the actual export agree on what counts as
 * resolvable.
 *
 *   1. Vault: `Radial Timeline/Pandoc/fonts/<slug>/` has the required files
 *      → 'ok' (export will use a `\setmainfont{...}[Path = ...]` block).
 *   2. TeX tree: the registry lists `texUpright` file names → 'ok' (export
 *      will use the filename form and let kpathsea resolve it). Checked
 *      before the system catalog because texmf fonts are not registered
 *      with the OS and would otherwise read as missing.
 *   3. System: font is in the system catalog → 'ok' (export will use plain
 *      `\setmainfont{Name}` and let XeLaTeX resolve via the OS).
 *   4. Neither → 'missing-bundled' if the registry advertises bundled files
 *      (instructive: tell the user to run Install fonts), otherwise
 *      'missing-system' (instructive: link to Google Fonts / CTAN).
 */
function resolveFontDiagnosticForKey(
    fontKey: DesignedStyleSpec['body']['font'] | undefined,
    overridePlatform?: FontDiagnosticPlatform
): FontDiagnostic {
    const platform = overridePlatform ?? getCurrentPlatform();
    if (!fontKey) {
        return { state: 'ok', primaryFontName: 'Default serif', resolvedFontName: 'Default serif' };
    }
    const primaryFontName = FONT_KEY_TO_DISPLAY[fontKey];

    // 1. Vault-bundled files present → ready (Path-based emit).
    if (vaultHasFontFiles(fontKey)) {
        return { state: 'ok', primaryFontName, resolvedFontName: primaryFontName };
    }

    // 2. TeX-distribution font → ready (filename emit, resolved by kpathsea).
    //    These live in the texmf tree and are invisible to the OS font
    //    catalog, so the system check below would wrongly report them
    //    missing and hard-block export on a machine that compiles them fine.
    if (FONT_REGISTRY[fontKey]?.files.texUpright) {
        return { state: 'ok', primaryFontName, resolvedFontName: primaryFontName };
    }

    // 3. System install present → ready (system-name emit).
    const catalog = loadSystemFontCatalog();
    const canVerify = Array.isArray(catalog);
    const installed = (canVerify && isFontInstalled(primaryFontName, catalog))
        || requiredSystemFontFileExists(primaryFontName, platform);
    if (installed) {
        return { state: 'ok', primaryFontName, resolvedFontName: primaryFontName };
    }

    // 4. Missing. If the registry knows about bundled files for this font,
    //    prompt the user to install them; otherwise prompt for a system install.
    const entry = FONT_REGISTRY[fontKey];
    const hasBundledFiles = !!entry?.files.upright;
    if (hasBundledFiles) {
        return {
            state: 'missing-bundled',
            primaryFontName,
            resolvedFontName: primaryFontName,
            installHint: {
                source: 'bundled',
                message: `${primaryFontName} files are missing from Radial Timeline/Pandoc/fonts/${entry.files.slug}. Click Install fonts in Settings → Publish.`,
            },
        };
    }
    const url = GOOGLE_FONTS_BY_KEY[fontKey];
    const installHint: FontDiagnosticInstallHint = url
        ? buildGoogleFontsHint(primaryFontName, url, platform)
        : buildCtanHint(primaryFontName);
    return { state: 'missing-system', primaryFontName, resolvedFontName: primaryFontName, installHint };
}

export function getStructuredFontDiagnostic(
    layout?: PandocLayoutTemplate,
    overridePlatform?: FontDiagnosticPlatform
): FontDiagnostic {
    const spec = specForLayout(layout);
    return resolveFontDiagnosticForKey(spec?.body.font, overridePlatform);
}

/**
 * Backward-compat string renderer for the structured diagnostic. Mirrors the
 * legacy single-line copy so existing callers can adopt the
 * structured form incrementally.
 */
export function renderFontDiagnosticLine(diag: FontDiagnostic): string | null {
    if (diag.state === 'ok') return null;
    if (diag.state === 'missing-bundled') {
        return diag.installHint?.message || `Font: ${diag.primaryFontName} bundled asset missing.`;
    }
    return diag.installHint?.message || `Font: ${diag.primaryFontName} is not installed. Install it before exporting.`;
}

function templateNeedsUnicodeEngine(templatePath?: string): boolean {
    const diagnostics = getTemplateFontDiagnostics(templatePath);
    return diagnostics.usesFontspec;
}

// Environment variables a Pandoc/LaTeX subprocess legitimately needs. Spawned
// processes receive ONLY these keys — never the full process.env, which can
// carry credentials from the host session.
const SUBPROCESS_ENV_ALLOWLIST = [
    'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
    'ProgramData', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT',
    'TEXMFHOME', 'TEXMFVAR', 'TEXMFCACHE', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE'
];

export function buildMinimalSubprocessEnv(pathOverride?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of SUBPROCESS_ENV_ALLOWLIST) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
    }
    if (pathOverride) env.PATH = pathOverride;
    return env;
}

function getEngineCandidatePaths(engine: PdfEngine): string[] {
    if (getCurrentPlatform() === 'win') {
        const localAppData = path.join(os.homedir(), 'AppData', 'Local');
        const programFiles = 'C:\\Program Files';
        const programFilesX86 = 'C:\\Program Files (x86)';
        return [
            `${programFiles}\\MiKTeX\\miktex\\bin\\x64\\${engine}.exe`,
            `${programFiles}\\MiKTeX\\miktex\\bin\\${engine}.exe`,
            `${programFilesX86}\\MiKTeX\\miktex\\bin\\${engine}.exe`,
            `${programFiles}\\texlive\\2024\\bin\\win32\\${engine}.exe`,
            `${programFilesX86}\\texlive\\2024\\bin\\win32\\${engine}.exe`,
            `${localAppData}\\Programs\\MiKTeX\\miktex\\bin\\x64\\${engine}.exe`
        ];
    }

    return [
        `/Library/TeX/texbin/${engine}`,
        `/opt/homebrew/bin/${engine}`,
        `/usr/local/bin/${engine}`,
        `/usr/bin/${engine}`
    ];
}

export function getAutoPdfEngineSelection(templatePath?: string): PdfEngineSelection {
    const preferUnicode = templateNeedsUnicodeEngine(templatePath);
    const order: PdfEngine[] = preferUnicode
        ? ['xelatex', 'lualatex', 'pdflatex']
        : ['pdflatex', 'xelatex', 'lualatex'];

    const available: Array<{ engine: PdfEngine; path: string }> = [];
    for (const engine of ['pdflatex', 'xelatex', 'lualatex'] as const) {
        const found = getEngineCandidatePaths(engine).find(candidate => fs.existsSync(candidate));
        if (found) {
            available.push({ engine, path: found });
        }
    }

    for (const engine of order) {
        const found = getEngineCandidatePaths(engine).find(candidate => fs.existsSync(candidate));
        if (found) {
            return {
                engine,
                path: found,
                available,
                templateNeedsUnicode: preferUnicode
            };
        }
    }

    return {
        engine: order[0],
        path: null,
        available,
        templateNeedsUnicode: preferUnicode
    };
}

export async function runPandocOnContent(
    content: string,
    outputAbsolutePath: string,
    options: PandocOptions
): Promise<void> {
    const binary = resolvePandocBinary(options);
    const isPdf = options.targetFormat === 'pdf';
    const tmpDir = os.tmpdir();
    const tmpInput = path.join(tmpDir, `rt-pandoc-${Date.now()}.md`);
    const preparedContent = preparePandocContent(content, options);
    await fs.promises.writeFile(tmpInput, preparedContent, 'utf8');

    // Optional preamble injection (PDF only): binding gutter + Pro custom LaTeX.
    // Written to its own temp file so `--include-in-header` can reference it, and
    // cleaned up alongside the markdown temp file in the finally block.
    let tmpHeader: string | null = null;
    if (isPdf && options.headerIncludes && options.headerIncludes.trim()) {
        tmpHeader = path.join(tmpDir, `rt-pandoc-header-${Date.now()}.tex`);
        await fs.promises.writeFile(tmpHeader, options.headerIncludes, 'utf8');
    }

    const args = ['-f', 'markdown', '-t', options.targetFormat, '-o', outputAbsolutePath, tmpInput];
    if (isPdf) {
        const pdfEngineSelection = getAutoPdfEngineSelection(options.templatePath);
        const pdfEngine = pdfEngineSelection.path || pdfEngineSelection.engine;
        args.push('--pdf-engine', pdfEngine);
        if (options.templatePath && options.templatePath.trim()) {
            args.push('--template', options.templatePath.trim());
        }
        if (tmpHeader) {
            args.push('--include-in-header', tmpHeader);
        }
    } else {
        // docx — reader-style Word document from a reference doc (submission format).
        if (options.referenceDocPath && options.referenceDocPath.trim()) {
            args.push('--reference-doc', options.referenceDocPath.trim());
        }
    }
    if (options.metadata) {
        for (const [key, rawValue] of Object.entries(options.metadata)) {
            const value = typeof rawValue === 'string' ? rawValue.trim() : '';
            if (!value) continue;
            const normalized = value.replace(/\r?\n/g, ' ');
            args.push('--metadata', `${key}=${normalized}`);
        }
    }

    await new Promise<void>((resolve, reject) => {
        const env = buildMinimalSubprocessEnv();
        const pathSeparator = getCurrentPlatform() === 'win' ? ';' : ':';
        const extraPaths = getCurrentPlatform() === 'win'
            ? ['C:\\Program Files\\MiKTeX\\miktex\\bin\\x64', 'C:\\Program Files\\texlive\\2024\\bin\\win32']
            : ['/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), '/usr/bin'];
        env.PATH = [env.PATH, ...extraPaths].filter(Boolean).join(pathSeparator);

        execFile(binary, args, { cwd: options.workingDir, env }, (error, _stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
                return;
            }
            resolve();
        });
    }).finally(async () => {
        for (const tmp of [tmpInput, tmpHeader]) {
            if (!tmp) continue;
            try {
                await fs.promises.unlink(tmp);
            } catch (e) {
                console.warn('Failed to clean tmp pandoc file', e);
            }
        }
    });
}

function preparePandocContent(content: string, options: PandocOptions): string {
    if (options.targetFormat !== 'pdf') return content;

    const injectLines: string[] = [];

    // Some custom/legacy templates do not define \tightlist, but Pandoc emits it for markdown lists.
    const hasTightlistDefinition = /\\(?:providecommand|newcommand|def)\s*\\tightlist|\\(?:providecommand|newcommand)\s*\{\\tightlist\}/.test(content);
    if (!hasTightlistDefinition) {
        injectLines.push('\\providecommand{\\tightlist}{\\setlength{\\itemsep}{0pt}\\setlength{\\parskip}{0pt}}');
    }

    if (injectLines.length === 0) return content;
    return `${injectLines.join('\n')}\n\n${content}`;
}

function formatCsvValue(value: string | null | undefined): string {
    const safe = value ?? '';
    if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
}

export function buildOutlineExport(
    selection: ManuscriptSceneSelection,
    preset: OutlinePreset,
    includeSynopsis = false,
    runtimeSettings?: RuntimeSettings
): OutlineExportResult {
    const titles = selection.titles;
    const whenDates = selection.whenDates;
    const sceneNumbers = selection.sceneNumbers;
    const subplots = selection.subplots;
    const synopses = selection.synopses || [];
    const runtimes = selection.runtimes ?? [];
    const wordCounts = selection.wordCounts ?? [];

    const totalRuntimeSeconds = (runtimes).reduce<number>(
        (sum, r) => sum + (r ?? 0),
        0
    );
    const totalFormattedRuntime = formatRuntimeValue(totalRuntimeSeconds);

    const draftingWpm = runtimeSettings?.sessionPlanning?.draftingWpm || 0;
    const dailyMinutes = runtimeSettings?.sessionPlanning?.dailyMinutes || 0;

    const calculateWritingHours = (words: number) => {
        if (!draftingWpm || draftingWpm <= 0) return 0;
        return (words / draftingWpm) / 60;
    };

    const totalWords = (wordCounts).reduce<number>(
        (sum, w) => sum + (w ?? 0),
        0
    );
    const totalWritingHours = calculateWritingHours(totalWords);

    const dailyHours = dailyMinutes > 0 ? dailyMinutes / 60 : 0;
    const totalSessions = dailyHours > 0 ? Math.ceil(totalWritingHours / dailyHours) : 0;

    switch (preset) {
        case 'index-cards-csv': {
            const header = includeSynopsis 
                ? ['Scene', 'Title', 'When', 'Subplot', 'Synopsis', 'Runtime', 'Words', 'Path']
                : ['Scene', 'Title', 'When', 'Subplot', 'Runtime', 'Words', 'Path'];
            const rows = titles.map((title, idx) => {
                const sceneLabel = sceneNumbers[idx] || idx + 1;
                const rt = runtimes[idx] ? formatRuntimeValue(runtimes[idx]!) : '';
                const wc = wordCounts[idx] || 0;
                
                const base = [
                    sceneLabel.toString(),
                    formatCsvValue(title),
                    formatCsvValue(whenDates[idx] || ''),
                    formatCsvValue(subplots[idx] || ''),
                    formatCsvValue(rt),
                    wc.toString()
                ];
                if (includeSynopsis) {
                    base.push(formatCsvValue(synopses[idx] || ''));
                }
                base.push(formatCsvValue(selection.files[idx]?.path || ''));
                return base.join(',');
            });
            return {
                text: [header.join(','), ...rows].join('\n'),
                extension: 'csv',
                label: 'Index cards (CSV)'
            };
        }
        case 'index-cards-json': {
            const cards = titles.map((title, idx) => {
                const rt = runtimes[idx];
                const wc = wordCounts[idx] || 0;
                const writingTimeHours = calculateWritingHours(wc);
                
                const card: Record<string, unknown> = {
                    scene: sceneNumbers[idx] || idx + 1,
                    title,
                    when: whenDates[idx],
                    subplot: subplots[idx] || null,
                    runtime: rt ? formatRuntimeValue(rt) : null,
                    runtimeSeconds: rt,
                    words: wc,
                    writingTimeHours: Number(writingTimeHours.toFixed(2))
                };
                if (includeSynopsis) {
                    card.synopsis = synopses[idx] || null;
                }
                card.path = selection.files[idx]?.path || null;
                return card;
            });
            
            const output: Record<string, unknown> = {
                cards,
                summary: {
                    totalScenes: titles.length,
                    totalWords,
                    totalRuntime: totalFormattedRuntime,
                    totalRuntimeSeconds
                }
            };
            
            if (draftingWpm > 0) {
                output.planning = {
                    draftingWpm,
                    dailyMinutes,
                    estimatedWritingHours: Number(totalWritingHours.toFixed(1)),
                    estimatedSessions: totalSessions
                };
            }
            
            return {
                text: JSON.stringify(output, null, 2),
                extension: 'json',
                label: 'Index cards (JSON)'
            };
        }
        case 'episode-rundown': {
            const lines = ['# Episode rundown', ''];
            
            lines.push(`**Total Runtime:** ${totalFormattedRuntime} (${titles.length} scenes)`);
            lines.push('');
            
            titles.forEach((title, idx) => {
                const sceneLabel = sceneNumbers[idx] || idx + 1;
                const when = whenDates[idx] ? ` · ${whenDates[idx]}` : '';
                const rt = runtimes[idx] ? ` [${formatRuntimeValue(runtimes[idx]!)}]` : '';
                
                lines.push(`${sceneLabel}. ${title}${when}${rt}`);
                if (includeSynopsis && synopses[idx]) {
                    lines.push(`   > ${synopses[idx]}`);
                    lines.push('');
                }
            });
            return { text: lines.join('\n'), extension: 'md', label: 'Episode rundown' };
        }
        case 'shooting-schedule': {
            const header = includeSynopsis
                ? ['# Shooting schedule', '', '| Scene | Title | When | Subplot | Runtime | Synopsis |', '|-------|-------|------|---------|---------|----------|']
                : ['# Shooting schedule', '', '| Scene | Title | When | Subplot | Runtime |', '|-------|-------|------|---------|---------|'];
            const lines = [...header];
            titles.forEach((title, idx) => {
                const sceneLabel = sceneNumbers[idx] || idx + 1;
                const rt = runtimes[idx] ? formatRuntimeValue(runtimes[idx]!) : '—';
                
                if (includeSynopsis) {
                    const synopsis = (synopses[idx] || '—').replace(/\|/g, '\\|'); // Escape pipes for markdown table
                    lines.push(`| ${sceneLabel} | ${title} | ${whenDates[idx] || '—'} | ${subplots[idx] || '—'} | ${rt} | ${synopsis} |`);
                } else {
                    lines.push(`| ${sceneLabel} | ${title} | ${whenDates[idx] || '—'} | ${subplots[idx] || '—'} | ${rt} |`);
                }
            });
            
            lines.push('');
            lines.push(`**Total Estimated Runtime:** ${totalFormattedRuntime}`);
            
            if (draftingWpm > 0) {
                lines.push('');
                lines.push('## Session Planning');
                lines.push(`- **Drafting Pace:** ${draftingWpm} wpm`);
                lines.push(`- **Total Word Count:** ${totalWords.toLocaleString()}`);
                lines.push(`- **Est. Drafting Time:** ${totalWritingHours.toFixed(1)} hours`);
                if (dailyMinutes > 0) {
                    lines.push(`- **Daily Availability:** ${dailyMinutes} mins`);
                    lines.push(`- **Est. Sessions:** ~${totalSessions} sessions`);
                }
            }
            
            return { text: lines.join('\n'), extension: 'md', label: 'Shooting schedule' };
        }
        case 'beat-sheet':
        default: {
            const lines = ['# Beat sheet', ''];
            
            if (draftingWpm > 0) {
                lines.push(`> **Planning:** ${totalWords.toLocaleString()} words · ~${totalWritingHours.toFixed(1)}h drafting`);
                lines.push('');
            }
            
            titles.forEach((title, idx) => {
                const sceneLabel = sceneNumbers[idx] || idx + 1;
                const wc = wordCounts[idx] ? ` (${wordCounts[idx]}w)` : '';
                lines.push(`${sceneLabel}. ${title}${wc}`);
                if (includeSynopsis && synopses[idx]) {
                    lines.push(`   > ${synopses[idx]}`);
                    lines.push('');
                }
            });
            return { text: lines.join('\n'), extension: 'md', label: 'Beat sheet' };
        }
    }
}

export function getTemplateForPreset(
    plugin: RadialTimelinePlugin,
    preset: ManuscriptPreset
): string | undefined {
    const templates = (plugin.settings as LegacyPersistedSettings).pandocTemplates || {};
    switch (preset) {
        case 'screenplay':
            return templates.screenplay || undefined;
        case 'podcast':
            return templates.podcast || undefined;
        case 'novel':
        default:
            return templates.novel || undefined;
    }
}

/**
 * Check if a template is configured and exists for a preset
 * Returns: { configured: boolean, exists: boolean, path: string | null }
 */
export function validateTemplateForPreset(
    plugin: RadialTimelinePlugin,
    preset: ManuscriptPreset
): { configured: boolean; exists: boolean; path: string | null; isAbsolute: boolean } {
    const templatePath = getTemplateForPreset(plugin, preset);
    
    if (!templatePath || !templatePath.trim()) {
        return { configured: false, exists: false, path: null, isAbsolute: false };
    }
    
    const trimmed = templatePath.trim();
    const isAbsolute = path.isAbsolute(trimmed);
    
    // For vault-relative paths, check if file exists
    if (!isAbsolute) {
        const file = plugin.app.vault.getAbstractFileByPath(trimmed);
        const exists = file instanceof TFile;
        return { configured: true, exists, path: trimmed, isAbsolute: false };
    }
    
    // For absolute paths, we can't verify existence in Obsidian
    // Assume it exists if configured (user responsibility)
    return { configured: true, exists: true, path: trimmed, isAbsolute: true };
}

/**
 * Check if a preset requires a template for PDF export
 */
export function presetRequiresTemplate(preset: ManuscriptPreset, format: ExportFormat): boolean {
    if (format === 'markdown') return false; // Markdown never needs templates
    return preset === 'screenplay' || preset === 'podcast'; // Novel can use defaults
}

export function getExportFormatExtension(format: ExportFormat): string {
    switch (format) {
        case 'pdf':
            return 'pdf';
        case 'docx':
            return 'docx';
        case 'csv':
            return 'csv';
        case 'json':
            return 'json';
        case 'markdown':
        default:
            return 'md';
    }
}

export function getVaultAbsolutePath(plugin: RadialTimelinePlugin, vaultPath: string): string | null {
    return resolveVaultAbsolutePath(plugin, vaultPath);
}

/**
 * Resolve a template path to an absolute path for Pandoc.
 * Handles both vault-relative paths and absolute paths.
 * Returns the absolute path, or the original path if resolution fails.
 */
export function resolveTemplatePath(plugin: RadialTimelinePlugin, templatePath: string): string {
    if (!templatePath || !templatePath.trim()) {
        return templatePath;
    }
    
    const trimmed = templatePath.trim();
    
    // If path is already absolute, use it as-is
    if (path.isAbsolute(trimmed)) {
        return trimmed;
    }
    
    const candidates = getTemplatePathCandidates(plugin, trimmed);
    for (const candidate of candidates) {
        const file = plugin.app.vault.getAbstractFileByPath(candidate);
        if (file instanceof TFile) {
            const absolutePath = resolveVaultAbsolutePath(plugin, candidate);
            return absolutePath || candidate;
        }
    }

    // Fallback: prefer the Pandoc-folder candidate when available, then original.
    const preferred = candidates[1] || candidates[0] || trimmed;
    const absolutePreferred = resolveVaultAbsolutePath(plugin, preferred);
    return absolutePreferred || preferred || trimmed;
}

export async function writeTextFile(
    vault: Vault,
    vaultPath: string,
    content: string
): Promise<void> {
    const normalized = normalizePath(vaultPath);
    const adapter = vault.adapter; // SAFE: adapter write used to save generated export content
    await adapter.write(normalized, content);
}
