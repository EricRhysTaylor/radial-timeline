import { normalizePath, TFile } from 'obsidian';
import * as fs from 'fs'; // SAFE: Node fs copies bundled plugin font assets into the user's vault-local Pandoc font folder during explicit install.
import * as path from 'path'; // SAFE: Node path builds absolute desktop font paths required by XeLaTeX templates.
import type RadialTimelinePlugin from '../main';
import type { HotfixHistoryEntry, PandocLayoutTemplate } from '../types';
import { getPandocLayoutSortRank } from '../publishing/templateTiering';
import { generateDesignedStyleTex, migrateDesignedStyleSpec } from '../publishing/designedStyle';
import { BUNDLED_FICTION_SPECS, type BundledFictionId } from '../publishing/bundledStyleSpecs';
import { getPandocFolder } from './exportFormats';
import { getEmbeddedAssetBytes, getEmbeddedAssetByteLength, type EmbeddedAssetKey } from './embeddedAssets';
import { basename } from './paths';

interface BundledPandocLayoutTemplate extends PandocLayoutTemplate {
    bundled: true;
    content: string;
}

/**
 * Absolute filesystem path to the vault-local Pandoc font root, e.g.
 * `/Users/foo/Vault/Radial Timeline/Pandoc/fonts`. The font resolver
 * (`fontResolver.ts`) checks this directory at .tex generation time to
 * decide whether to emit a `\setmainfont{...}[Path = ...]` block (vault
 * has the font) or a plain `\setmainfont{Name}` block (let XeLaTeX find
 * it via the system font cache).
 */
let MODULE_VAULT_FONT_DIR: string | undefined;

export function setVaultFontDir(path: string | undefined): void {
    MODULE_VAULT_FONT_DIR = path;
}

/**
 * Read-only accessor for the vault font root resolved at plugin load.
 * Consumers (font diagnostics) need this to verify that bundled font
 * files were actually deployed to disk.
 */
export function getVaultFontDir(): string | undefined {
    return MODULE_VAULT_FONT_DIR;
}

function generateBundledFictionTex(id: BundledFictionId): string {
    return generateDesignedStyleTex(BUNDLED_FICTION_SPECS[id], {
        bundledLayoutId: id,
        vaultFontDir: MODULE_VAULT_FONT_DIR,
    });
}

const BUNDLED_FICTION_SIGNATURE_ID = 'bundled-fiction-signature-literary';
const BUNDLED_FICTION_CLASSIC_ID = 'bundled-fiction-classic-manuscript';
const BUNDLED_FICTION_MODERN_CLASSIC_ID = 'bundled-fiction-modern-classic';
const BUNDLED_FICTION_CONTEMPORARY_ID = 'bundled-fiction-contemporary-literary';

// Spec-driven fiction templates whose on-disk content is canonical (generated
// from `BUNDLED_FICTION_SPECS`). Install drift-detects against this set so
// stale legacy on-disk content is auto-overwritten on next Install.
const FICTION_BUNDLED_IDS = new Set<BundledFictionId>([
    BUNDLED_FICTION_SIGNATURE_ID,
    BUNDLED_FICTION_CLASSIC_ID,
    BUNDLED_FICTION_MODERN_CLASSIC_ID,
    BUNDLED_FICTION_CONTEMPORARY_ID,
]);

const LEGACY_BUNDLED_LAYOUT_ID_MAP: Record<string, string> = {
    'bundled-novel': BUNDLED_FICTION_SIGNATURE_ID,
    'bundled-novel-signature-literary-rt': BUNDLED_FICTION_SIGNATURE_ID,
};
const LEGACY_BUNDLED_LAYOUT_BASENAME_MAP: Record<string, string> = {
    'signature_literary_rt.tex': BUNDLED_FICTION_SIGNATURE_ID,
};

function isAbsolutePath(value: string): boolean {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function resolveCanonicalBundledLayoutId(layout: PandocLayoutTemplate, canonicalIds: Set<string>): string | null {
    const rawId = (layout.id || '').trim();
    if (canonicalIds.has(rawId)) return rawId;

    const mappedById = LEGACY_BUNDLED_LAYOUT_ID_MAP[rawId];
    if (mappedById && canonicalIds.has(mappedById)) return mappedById;

    const normalizedPath = normalizePath((layout.path || '').trim().replace(/^\/+/, ''));
    const fileName = basename(normalizedPath).toLowerCase();
    const mappedByPath = LEGACY_BUNDLED_LAYOUT_BASENAME_MAP[fileName];
    if (mappedByPath && canonicalIds.has(mappedByPath)) return mappedByPath;

    return null;
}

const BUNDLED_PANDOC_LAYOUT_TEMPLATES: BundledPandocLayoutTemplate[] = [
    {
        id: 'bundled-screenplay',
        name: 'Screenplay',
        preset: 'screenplay',
        path: 'screenplay_template.tex',
        bundled: true,
        tier: 'pro',
        templateKind: 'screenplay',
        description: 'Industry screenplay format with uppercase sluglines, dialogue-first spacing, and production-safe margins. Page numbers run in the header with a Courier-family typewriter look.',
        content: [
            '% Pandoc LaTeX Template - Screenplay Format',
            '% US industry standard: Courier 12pt, specific margins',
            '\\documentclass[12pt,letterpaper]{article}',
            '',
            '\\usepackage[top=1in,bottom=1in,left=1.5in,right=1in]{geometry}',
            '\\usepackage{fontspec}',
            '\\usepackage{parskip}',
            '',
            '% Courier is the screenplay standard',
            '\\setmainfont{Courier New}[',
            '  BoldFont={Courier New Bold},',
            '  ItalicFont={Courier New Italic}',
            ']',
            '',
            '\\pagestyle{plain}',
            '\\setlength{\\parindent}{0pt}',
            '\\setlength{\\parskip}{12pt}',
            '',
            '% Disable hyphenation (screenplay convention)',
            '\\hyphenpenalty=10000',
            '\\exhyphenpenalty=10000',
            '',
            '% Pandoc --include-in-header injection point (custom preamble, gutter)',
            '$for(header-includes)$',
            '$header-includes$',
            '$endfor$',
            '',
            '\\begin{document}',
            '',
            '$body$',
            '',
            '\\end{document}'
        ].join('\n')
    },
    {
        id: 'bundled-podcast',
        name: 'Podcast Script',
        preset: 'podcast',
        path: 'podcast_template.tex',
        bundled: true,
        tier: 'pro',
        templateKind: 'podcast',
        description: 'Narration-first script format with speaker/segment clarity, timing-friendly spacing, and clean cue separation. Header metadata and page numbering are positioned for fast booth or desk reference.',
        content: [
            '% Pandoc LaTeX Template - Podcast Script Format',
            '% Clean sans-serif for audio production scripts',
            '\\documentclass[11pt,letterpaper]{article}',
            '',
            '\\usepackage[top=1in,bottom=1in,left=1in,right=1in]{geometry}',
            '\\usepackage{fontspec}',
            '\\usepackage{parskip}',
            '',
            '% Clean sans-serif for readability',
            '\\setmainfont{Helvetica Neue}[',
            '  BoldFont={Helvetica Neue Bold},',
            '  ItalicFont={Helvetica Neue Italic}',
            ']',
            '',
            '\\pagestyle{plain}',
            '\\setlength{\\parindent}{0pt}',
            '\\setlength{\\parskip}{8pt}',
            '',
            '% Pandoc --include-in-header injection point (custom preamble, gutter)',
            '$for(header-includes)$',
            '$header-includes$',
            '$endfor$',
            '',
            '\\begin{document}',
            '',
            '$body$',
            '',
            '\\end{document}'
        ].join('\n')
    },
    {
        id: BUNDLED_FICTION_SIGNATURE_ID,
        name: 'Professional',
        preset: 'novel',
        path: 'rt_signature_literary.tex',
        bundled: true,
        tier: 'pro',
        templateKind: 'book',
        hasSceneOpenerHeadingOptions: true,
        description: 'Restrained and considered — the look of a small-press literary novel. Letter-spaced caps in the running head, generous scene-opener pages, and three opener heading modes to match the book’s voice. For literary fiction that wants room to breathe.',
        get content(): string { return generateBundledFictionTex(BUNDLED_FICTION_SIGNATURE_ID); },
        get designedSpec() { return BUNDLED_FICTION_SPECS[BUNDLED_FICTION_SIGNATURE_ID]; },
    },
    {
        id: BUNDLED_FICTION_CLASSIC_ID,
        name: 'Basic',
        preset: 'novel',
        path: 'rt_classic_manuscript.tex',
        bundled: true,
        tier: 'free',
        templateKind: 'book',
        description: 'Plain and to the point. The traditional submission format every editor recognizes — no ornament, no ego, just pure readability. The format that gets your manuscript read.',
        get content(): string { return generateBundledFictionTex(BUNDLED_FICTION_CLASSIC_ID); },
        get designedSpec() { return BUNDLED_FICTION_SPECS[BUNDLED_FICTION_CLASSIC_ID]; },
    },
    {
        id: BUNDLED_FICTION_CONTEMPORARY_ID,
        name: 'Standard',
        preset: 'novel',
        path: 'rt_contemporary_literary.tex',
        bundled: true,
        tier: 'free',
        templateKind: 'book',
        description: 'A polished reading draft for beta readers and proofers. Clean enough to feel like a finished book without committing to a final aesthetic. Contemporary serif body type, comfortable spacing, and clean headers that track the scene title.',
        get content(): string { return generateBundledFictionTex(BUNDLED_FICTION_CONTEMPORARY_ID); },
        get designedSpec() { return BUNDLED_FICTION_SPECS[BUNDLED_FICTION_CONTEMPORARY_ID]; },
    },
    {
        id: BUNDLED_FICTION_MODERN_CLASSIC_ID,
        name: 'Signature',
        preset: 'novel',
        path: 'rt_modern_classic.tex',
        bundled: true,
        tier: 'pro',
        templateKind: 'book',
        usesModernClassicStructure: true,
        hasEpigraphs: true,
        description: 'For ambitious, structural fiction. Acts open with optional epigraphs and Roman numeral PART pages; chapters carry shared titles; scene breaks are lowercase Roman numerals with a short rule. Evokes the considered architecture of mid-20th-century literary novels.',
        get content(): string { return generateBundledFictionTex(BUNDLED_FICTION_MODERN_CLASSIC_ID); },
        get designedSpec() { return BUNDLED_FICTION_SPECS[BUNDLED_FICTION_MODERN_CLASSIC_ID]; },
    }
];

/**
 * Test-facing accessor: returns the raw bundled `.tex` content for a given
 * layout id. Returns `null` for unknown ids. For fiction layouts the content
 * is generator-derived from `BUNDLED_FICTION_SPECS`; screenplay/podcast remain
 * hand-coded.
 */
export function getBundledPandocLayoutContent(layoutId: string): string | null {
    const found = BUNDLED_PANDOC_LAYOUT_TEMPLATES.find(layout => layout.id === layoutId);
    return found ? found.content : null;
}

export function getBundledPandocLayouts(): PandocLayoutTemplate[] {
    return BUNDLED_PANDOC_LAYOUT_TEMPLATES.map(layout => ({
        id: layout.id,
        name: layout.name,
        preset: layout.preset,
        path: layout.path,
        bundled: true,
        tier: layout.tier,
        templateKind: layout.templateKind,
        ...(layout.recommendedUse ? { recommendedUse: layout.recommendedUse } : {}),
        ...(layout.description ? { description: layout.description } : {}),
        ...(layout.usesModernClassicStructure === true ? { usesModernClassicStructure: true } : {}),
        ...(layout.hasEpigraphs === true ? { hasEpigraphs: true } : {}),
        ...(layout.hasSceneOpenerHeadingOptions === true ? { hasSceneOpenerHeadingOptions: true } : {}),
        // Expose the spec on the runtime layout record so getLayoutPictogramRows
        // can derive its preview from the same source as the .tex content.
        ...(layout.designedSpec ? { designedSpec: layout.designedSpec } : {}),
    })).sort((a, b) => getPandocLayoutSortRank(a) - getPandocLayoutSortRank(b) || a.name.localeCompare(b.name));
}

export function ensureBundledPandocLayoutsRegistered(plugin: RadialTimelinePlugin): boolean {
    const canonicalLayouts = getBundledPandocLayouts();
    const canonicalIds = new Set(canonicalLayouts.map(layout => layout.id));
    const canonicalById = new Map(canonicalLayouts.map(layout => [layout.id, layout]));

    const existing = plugin.settings.pandocLayouts || [];
    const normalized: PandocLayoutTemplate[] = [];
    const seenBundledCanonicalIds = new Set<string>();
    let changed = false;

    for (const layout of existing) {
        if (!layout.bundled) {
            // Designed layouts own their spec, so this is the one place a stored
            // spec is read back and can be brought up to the current version.
            // Bundled layouts take their spec from the canonical definition below
            // and are always current by construction.
            if (layout.designedSpec) {
                const migratedSpec = migrateDesignedStyleSpec(layout.designedSpec);
                if (migratedSpec !== layout.designedSpec) {
                    normalized.push({ ...layout, designedSpec: migratedSpec });
                    changed = true;
                    continue;
                }
            }
            normalized.push(layout);
            continue;
        }

        const canonicalId = resolveCanonicalBundledLayoutId(layout, canonicalIds);
        if (!canonicalId) {
            changed = true;
            continue;
        }

        if (seenBundledCanonicalIds.has(canonicalId)) {
            changed = true;
            continue;
        }

        const canonical = canonicalById.get(canonicalId);
        if (!canonical) {
            changed = true;
            continue;
        }

        const migrated: PandocLayoutTemplate = {
            ...layout,
            id: canonical.id,
            name: canonical.name,
            preset: canonical.preset,
            path: canonical.path,
            bundled: true,
            tier: canonical.tier,
            templateKind: canonical.templateKind,
            recommendedUse: canonical.recommendedUse,
            // Bundled descriptions are authored in code and never user-edited; always refresh
            // from canonical so copy updates propagate on plugin upgrade.
            ...(canonical.description ? { description: canonical.description } : {}),
            ...(canonical.usesModernClassicStructure === true ? { usesModernClassicStructure: true } : {}),
            ...(canonical.hasEpigraphs === true ? { hasEpigraphs: true } : {}),
            ...(canonical.hasSceneOpenerHeadingOptions === true ? { hasSceneOpenerHeadingOptions: true } : {})
        };
        if (
            migrated.id !== layout.id
            || migrated.name !== layout.name
            || migrated.preset !== layout.preset
            || migrated.path !== layout.path
            || migrated.tier !== layout.tier
            || migrated.templateKind !== layout.templateKind
            || migrated.recommendedUse !== layout.recommendedUse
            || migrated.description !== layout.description
            || migrated.usesModernClassicStructure !== layout.usesModernClassicStructure
            || migrated.hasEpigraphs !== layout.hasEpigraphs
            || migrated.hasSceneOpenerHeadingOptions !== layout.hasSceneOpenerHeadingOptions
            || layout.bundled !== true
        ) {
            changed = true;
        }

        normalized.push(migrated);
        seenBundledCanonicalIds.add(canonicalId);
    }

    for (const canonical of canonicalLayouts) {
        if (seenBundledCanonicalIds.has(canonical.id)) continue;
        normalized.push({ ...canonical });
        seenBundledCanonicalIds.add(canonical.id);
        changed = true;
    }

    if (changed) {
        plugin.settings.pandocLayouts = normalized;
    }

    return changed;
}

function resolveBundledVaultPath(plugin: RadialTimelinePlugin, relativePath: string): string {
    const normalized = normalizePath(relativePath.replace(/^\/+/, ''));
    const pandocFolder = getPandocFolder(plugin);
    return normalizePath(`${pandocFolder}/${normalized}`);
}

function getVaultBasePath(plugin: RadialTimelinePlugin): string | undefined {
    const adapter = plugin.app.vault.adapter as { getBasePath?: () => string } | undefined; // SAFE: adapter.getBasePath is required to generate absolute local font paths for XeLaTeX.
    return typeof adapter?.getBasePath === 'function' ? adapter.getBasePath() : undefined;
}

export function getPandocFontVaultFolder(plugin: RadialTimelinePlugin): string {
    return normalizePath(`${getPandocFolder(plugin)}/fonts`);
}

export function getPandocFontAbsoluteRoot(plugin: RadialTimelinePlugin): string | undefined {
    const basePath = getVaultBasePath(plugin);
    if (!basePath) return undefined;
    return path.join(basePath, getPandocFontVaultFolder(plugin));
}

/**
 * Font families the plugin carries and writes into the vault, mapped to the
 * embedded asset keys their files come from.
 *
 * The bytes live inside `main.js` (see `src/utils/embeddedAssets.ts`) because
 * Obsidian installs only `manifest.json`/`main.js`/`styles.css` from a release
 * — loose files under the plugin folder never reach a user who installed
 * through the Community Plugins browser (GH #29, #34).
 *
 * Latin Modern is deliberately absent: it ships with every TeX distribution
 * and XeLaTeX resolves it from the texmf tree by filename, so bundling ~449KB
 * of `lmroman*.otf` would be dead weight. `fontResolver.ts` emits the
 * filename form for it instead.
 */
const BUNDLED_PANDOC_FONT_FILES: Record<string, EmbeddedAssetKey[]> = {
    'sorts-mill-goudy': [
        'fonts/sorts-mill-goudy/SortsMillGoudy-Regular.ttf',
        'fonts/sorts-mill-goudy/SortsMillGoudy-Italic.ttf',
        'fonts/sorts-mill-goudy/OFL.txt',
    ],
    'source-serif-4': [
        'fonts/source-serif-4/SourceSerif4-Regular.otf',
        'fonts/source-serif-4/SourceSerif4-It.otf',
        'fonts/source-serif-4/SourceSerif4-Bold.otf',
        'fonts/source-serif-4/SourceSerif4-BoldIt.otf',
        'fonts/source-serif-4/LICENSE.md',
    ],
};

export function setPandocFontPathsForVault(plugin: RadialTimelinePlugin): void {
    setVaultFontDir(getPandocFontAbsoluteRoot(plugin));
}

/** Actual font binaries only — excludes bundled LICENSE/README text files from user-facing reporting. */
const FONT_BINARY_EXTENSIONS = new Set(['.otf', '.ttf']);
function isFontBinaryFile(fileName: string): boolean {
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    return FONT_BINARY_EXTENSIONS.has(ext);
}

export interface BundledFontFileStatus {
    file: string;
    sizeBytes: number;
    /** Absolute filesystem path to this exact file, for "reveal in Finder/Explorer" actions. */
    absolutePath: string;
}

export interface BundledFontFamilyStatus {
    family: string;
    /** Font binaries only (LICENSE/README are copied but not reported here). */
    files: BundledFontFileStatus[];
}

export interface BundledFontInstallResult {
    installed: BundledFontFamilyStatus[];
    alreadyPresent: BundledFontFamilyStatus[];
    failed: string[];
    /** Absolute filesystem folder these fonts were installed under, e.g. ".../Radial Timeline/Pandoc/fonts". */
    targetRoot?: string;
}

export async function installBundledPandocFonts(
    plugin: RadialTimelinePlugin
): Promise<BundledFontInstallResult> {
    const targetRoot = getPandocFontAbsoluteRoot(plugin);
    const installed: BundledFontFamilyStatus[] = [];
    const alreadyPresent: BundledFontFamilyStatus[] = [];
    const failed: string[] = [];

    if (!targetRoot) {
        for (const family of Object.keys(BUNDLED_PANDOC_FONT_FILES)) failed.push(family);
        return { installed, alreadyPresent, failed, targetRoot };
    }

    for (const [family, assetKeys] of Object.entries(BUNDLED_PANDOC_FONT_FILES)) {
        const targetDir = path.join(targetRoot, family);
        try {
            fs.mkdirSync(targetDir, { recursive: true });
            let changed = false;
            const verifiedFiles: BundledFontFileStatus[] = [];
            for (const assetKey of assetKeys) {
                const file = assetKey.slice(assetKey.lastIndexOf('/') + 1);
                const targetFile = path.join(targetDir, file);
                // The authoritative size is the embedded asset's decoded
                // length — no source file exists on disk to stat against.
                const expectedSize = getEmbeddedAssetByteLength(assetKey);
                const needsWrite = !fs.existsSync(targetFile)
                    || fs.statSync(targetFile).size !== expectedSize;
                if (needsWrite) {
                    fs.writeFileSync(targetFile, getEmbeddedAssetBytes(assetKey));
                    changed = true;
                }
                // Verify the file on disk after writing (or after finding it
                // already present) actually matches the embedded payload
                // byte-for-byte in size. A short write or zero-byte file must
                // never be reported as a successful install (GH #29).
                const finalSize = fs.existsSync(targetFile) ? fs.statSync(targetFile).size : 0;
                if (finalSize === 0 || finalSize !== expectedSize) {
                    throw new Error(`Font file verification failed after write: ${targetFile} (expected ${expectedSize} bytes, found ${finalSize})`);
                }
                if (isFontBinaryFile(file)) {
                    verifiedFiles.push({ file, sizeBytes: finalSize, absolutePath: targetFile });
                }
            }
            if (changed) installed.push({ family, files: verifiedFiles });
            else alreadyPresent.push({ family, files: verifiedFiles });
        } catch {
            failed.push(family);
        }
    }

    return { installed, alreadyPresent, failed, targetRoot };
}

/**
 * Bundled Word reference document (standard manuscript format: Times New
 * Roman 12pt, double-spaced, 0.5" first-line indent, centered headings).
 * Pandoc styles DOCX exports from it via `--reference-doc`.
 */
export const MANUSCRIPT_REFERENCE_DOCX = 'reference-manuscript.docx';

/** Embedded payload the vault copy of {@link MANUSCRIPT_REFERENCE_DOCX} is written from. */
const MANUSCRIPT_REFERENCE_DOCX_ASSET: EmbeddedAssetKey = 'pandoc/reference-manuscript.docx';

export function getManuscriptReferenceDocxAbsolutePath(plugin: RadialTimelinePlugin): string | undefined {
    const basePath = getVaultBasePath(plugin);
    if (!basePath) return undefined;
    return path.join(basePath, normalizePath(`${getPandocFolder(plugin)}/${MANUSCRIPT_REFERENCE_DOCX}`));
}

/**
 * Write the bundled reference.docx into the vault Pandoc folder. Same contract
 * as installBundledPandocFonts: size-diff guard, overwrite on drift so shipped
 * style fixes propagate. Returns the absolute path Pandoc should use, or an
 * error string — DOCX export blocks (no silent fallback to Pandoc defaults).
 *
 * The document's bytes are embedded in `main.js`; before that it was read from
 * `<plugin>/assets/pandoc/`, a folder Obsidian never installs, so every
 * Community-Plugins user hit "Missing bundled asset" (GH #34).
 */
export function ensureManuscriptReferenceDocxInstalled(
    plugin: RadialTimelinePlugin
): { path?: string; error?: string } {
    const target = getManuscriptReferenceDocxAbsolutePath(plugin);
    if (!target) {
        return { error: 'Pandoc asset paths are not available in this environment.' };
    }
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const expectedSize = getEmbeddedAssetByteLength(MANUSCRIPT_REFERENCE_DOCX_ASSET);
        const needsWrite = !fs.existsSync(target)
            || fs.statSync(target).size !== expectedSize;
        if (needsWrite) {
            fs.writeFileSync(target, getEmbeddedAssetBytes(MANUSCRIPT_REFERENCE_DOCX_ASSET));
        }
        const finalSize = fs.existsSync(target) ? fs.statSync(target).size : 0;
        if (finalSize === 0 || finalSize !== expectedSize) {
            return { error: `Reference document verification failed after write: ${target} (expected ${expectedSize} bytes, found ${finalSize})` };
        }
        return { path: target };
    } catch (e) {
        return { error: (e as Error).message || String(e) };
    }
}

async function ensureFolderPath(plugin: RadialTimelinePlugin, folderPath: string): Promise<void> {
    const vault = plugin.app.vault;
    const parts = normalizePath(folderPath).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!vault.getAbstractFileByPath(current)) {
            await vault.createFolder(current);
        }
    }
}

export function isBundledPandocLayoutInstalled(plugin: RadialTimelinePlugin, layout: PandocLayoutTemplate): boolean {
    const trimmed = layout.path.trim();
    if (!trimmed) return false;

    if (isAbsolutePath(trimmed)) return false;

    const normalized = normalizePath(trimmed.replace(/^\/+/, ''));
    const direct = plugin.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile) return true;

    const bundledPath = resolveBundledVaultPath(plugin, normalized);
    const bundledFile = plugin.app.vault.getAbstractFileByPath(bundledPath);
    return bundledFile instanceof TFile;
}

export async function installBundledPandocLayouts(
    plugin: RadialTimelinePlugin,
    layoutIds?: string[]
): Promise<{ installed: string[]; alreadyPresent: string[]; failed: string[]; fonts: BundledFontInstallResult }> {
    const vault = plugin.app.vault;
    const selected = BUNDLED_PANDOC_LAYOUT_TEMPLATES.filter(layout => !layoutIds || layoutIds.includes(layout.id));
    const pandocFolder = getPandocFolder(plugin);

    if (!vault.getAbstractFileByPath(pandocFolder)) {
        await ensureFolderPath(plugin, pandocFolder);
    }
    const fontsResult = await installBundledPandocFonts(plugin);
    setPandocFontPathsForVault(plugin);

    const installed: string[] = [];
    const alreadyPresent: string[] = [];
    const failed: string[] = [];

    for (const bundled of selected) {
        const targetPath = resolveBundledVaultPath(plugin, bundled.path);
        const existing = vault.getAbstractFileByPath(targetPath);
        const isFictionSpecDriven = FICTION_BUNDLED_IDS.has(bundled.id as BundledFictionId);

        if (existing instanceof TFile) {
            // Spec-driven fiction templates: drift-detect against the canonical
            // generated content. If the on-disk file diverges (legacy literal
            // labels, stale spacing, etc.), overwrite — install must be
            // self-healing so users don't have to manually delete files.
            if (isFictionSpecDriven) {
                try {
                    const onDisk = await vault.read(existing);
                    const canonical = bundled.content;
                    if (onDisk === canonical) {
                        alreadyPresent.push(bundled.name);
                        continue;
                    }
                    await vault.modify(existing, canonical);
                    installed.push(bundled.name);
                    continue;
                } catch {
                    failed.push(bundled.name);
                    continue;
                }
            }
            // Non-spec-driven templates (screenplay/podcast): preserve the
            // skip-if-exists behavior so users' edits aren't clobbered.
            alreadyPresent.push(bundled.name);
            continue;
        }

        try {
            await vault.create(targetPath, bundled.content);
            installed.push(bundled.name);
        } catch {
            failed.push(bundled.name);
        }
    }

    return { installed, alreadyPresent, failed, fonts: fontsResult };
}

export async function ensureSpecDrivenBundledFictionTemplatesCurrent(
    plugin: RadialTimelinePlugin
): Promise<{ installed: string[]; updated: string[]; alreadyPresent: string[]; failed: string[] }> {
    const vault = plugin.app.vault;
    const pandocFolder = getPandocFolder(plugin);

    if (!vault.getAbstractFileByPath(pandocFolder)) {
        await ensureFolderPath(plugin, pandocFolder);
    }
    await installBundledPandocFonts(plugin);
    setPandocFontPathsForVault(plugin);

    const installed: string[] = [];
    const updated: string[] = [];
    const alreadyPresent: string[] = [];
    const failed: string[] = [];
    let historyChanged = false;

    for (const bundled of BUNDLED_PANDOC_LAYOUT_TEMPLATES) {
        if (!FICTION_BUNDLED_IDS.has(bundled.id as BundledFictionId)) continue;

        const normalizedPath = normalizePath((bundled.path || '').trim().replace(/^\/+/, ''));
        const direct = normalizedPath ? vault.getAbstractFileByPath(normalizedPath) : null;
        const targetPath = resolveBundledVaultPath(plugin, bundled.path);
        const target = direct instanceof TFile ? direct : vault.getAbstractFileByPath(targetPath);
        const canonical = generateBundledFictionTex(bundled.id as BundledFictionId);

        if (target instanceof TFile) {
            try {
                const onDisk = await vault.read(target);
                if (onDisk === canonical) {
                    alreadyPresent.push(bundled.name);
                    continue;
                }

                await vault.modify(target, canonical);
                plugin.settings.templateHotfixHistory = recordHotfixEvent(
                    plugin.settings.templateHotfixHistory ?? [],
                    bundled.id,
                    HOTFIX_ID_SPEC_DRIFT_OVERWRITE
                );
                historyChanged = true;
                updated.push(bundled.name);
                continue;
            } catch {
                failed.push(bundled.name);
                continue;
            }
        }

        try {
            await vault.create(targetPath, canonical);
            installed.push(bundled.name);
        } catch {
            failed.push(bundled.name);
        }
    }

    if (historyChanged && typeof plugin.saveSettings === 'function') {
        try { await plugin.saveSettings(); } catch { /* non-fatal: history will be re-recorded next run */ }
    }

    return { installed, updated, alreadyPresent, failed };
}

/**
 * Stable id for the bundled-template drift-detect rewrite. Recorded once
 * (per layout) into `settings.templateHotfixHistory` whenever the on-disk
 * `.tex` content for a spec-driven fiction layout diverges from the canonical
 * generator output and is overwritten. Feeds the synthetic 'PDF Templates
 * Updated' Core notification.
 */
export const HOTFIX_ID_SPEC_DRIFT_OVERWRITE = 'spec-drift-overwrite-v1';

/**
 * Append a hotfix-history entry for `(layoutId, hotfixId)` if the pair is not
 * already present. Existing entries are preserved (their `acknowledged` flag
 * is intentionally untouched: an unacknowledged entry stays unacknowledged
 * across re-runs; an acknowledged entry stays acknowledged so we don't
 * re-surface the synthetic alert for a hotfix the user already saw).
 */
export function recordHotfixEvent(
    history: HotfixHistoryEntry[] | undefined,
    layoutId: string,
    hotfixId: string,
    now: number = Date.now()
): HotfixHistoryEntry[] {
    const list = Array.isArray(history) ? [...history] : [];
    const exists = list.some(entry => entry.layoutId === layoutId && entry.hotfixId === hotfixId);
    if (exists) return list;
    list.push({ layoutId, hotfixId, appliedAt: now, acknowledged: false });
    return list;
}

/**
 * Mark every unacknowledged hotfix-history entry as acknowledged. Returns a
 * new array so callers can detect change and persist.
 */
export function acknowledgeHotfixHistory(
    history: HotfixHistoryEntry[] | undefined
): HotfixHistoryEntry[] {
    if (!Array.isArray(history)) return [];
    return history.map(entry => entry.acknowledged ? entry : { ...entry, acknowledged: true });
}

export async function ensureBundledLayoutInstalledForExport(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate
): Promise<{ installed: boolean; failed: boolean; fonts: BundledFontInstallResult }> {
    const emptyFonts: BundledFontInstallResult = { installed: [], alreadyPresent: [], failed: [] };
    if (!layout.bundled) return { installed: false, failed: false, fonts: emptyFonts };

    // Export can be reached long after a bundled .tex template was installed.
    // Refresh the vault-local font assets every time so newly bundled fonts
    // self-heal without asking users to delete or move files by hand. This
    // call is authoritative for font install/verification status — the
    // installBundledPandocLayouts call below also touches fonts, but only
    // redundantly (idempotent copy), so its result isn't re-merged here.
    const fonts = await installBundledPandocFonts(plugin);
    setPandocFontPathsForVault(plugin);

    // For spec-driven bundled fiction layouts, the .tex on disk is a derived
    // artifact: source of truth is the spec generator. Compare on-disk content
    // against the canonical output and overwrite if it differs. One read, one
    // compare, one write — no regex patches, no per-shape normalizers.
    // Hand-coded layouts (screenplay, podcast) are NOT in the drift-detect set
    // and are left alone here; users can re-install them via Install all.
    const vault = plugin.app.vault;
    const normalizedPath = normalizePath((layout.path || '').trim().replace(/^\/+/, ''));
    if (normalizedPath && FICTION_BUNDLED_IDS.has(layout.id as BundledFictionId)) {
        const direct = vault.getAbstractFileByPath(normalizedPath);
        const bundled = direct instanceof TFile ? direct : vault.getAbstractFileByPath(resolveBundledVaultPath(plugin, normalizedPath));
        if (bundled instanceof TFile) {
            try {
                const onDisk = await vault.read(bundled);
                const canonical = generateBundledFictionTex(layout.id as BundledFictionId);
                if (onDisk !== canonical) {
                    await vault.modify(bundled, canonical);
                    const history = recordHotfixEvent(
                        plugin.settings.templateHotfixHistory ?? [],
                        layout.id,
                        HOTFIX_ID_SPEC_DRIFT_OVERWRITE
                    );
                    if (history !== plugin.settings.templateHotfixHistory) {
                        plugin.settings.templateHotfixHistory = history;
                        if (typeof plugin.saveSettings === 'function') {
                            try { await plugin.saveSettings(); } catch { /* non-fatal: history will be re-recorded next run */ }
                        }
                    }
                    console.warn(`[Radial Timeline] Overwrote on-disk ${layout.name} template with canonical spec-driven content.`);
                }
            } catch {
                // Non-fatal: continue with standard install/validation flow.
            }
        }
    }

    if (isBundledPandocLayoutInstalled(plugin, layout)) return { installed: false, failed: false, fonts };

    const result = await installBundledPandocLayouts(plugin, [layout.id]);
    return {
        installed: result.installed.length > 0,
        failed: result.failed.length > 0,
        fonts
    };
}

export function formatFontFileSize(bytes: number): string {
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
}

/**
 * Human-readable breakdown of exactly which font files are on disk and
 * where — not just "fonts installed". Each size comes from a post-copy
 * `fs.statSync` read (see `installBundledPandocFonts`), so a zero-byte or
 * truncated file is never reported here as present (GH #29).
 */
export function formatBundledFontInstallSummary(fonts: BundledFontInstallResult): string {
    const families = [...fonts.installed, ...fonts.alreadyPresent].filter(f => f.files.length > 0);
    if (families.length === 0) return '';
    const lines = families.map(({ family, files }) => {
        const fileList = files.map(f => `${f.file} (${formatFontFileSize(f.sizeBytes)})`).join(', ');
        return `${family}/: ${fileList}`;
    });
    const location = fonts.targetRoot ? `Location: ${fonts.targetRoot}` : '';
    return [...lines, location].filter(Boolean).join('\n');
}
