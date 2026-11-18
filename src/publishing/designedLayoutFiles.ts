/*
 * The .tex file behind a style saved by the PDF design wizard.
 *
 * The spec is the source of truth and the .tex is generated from it. Two
 * things about that file depend on the machine rather than on the spec:
 *
 *   1. A font that ships with the plugin is loaded from the vault's Pandoc
 *      font folder by absolute path, so the files must be there.
 *   2. That absolute path changes when the vault moves, is renamed, or syncs
 *      to another computer.
 *
 * Saving therefore installs the font files and writes the vault path into the
 * .tex, and export brings the font lines up to date before each run. Without
 * this a saved style named its font by family only, which prints solely on a
 * computer that happens to have that font installed system-wide.
 */
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate } from '../types';
import { generateDesignedStyleTex, type DesignedStyleSpec } from './designedStyle';
import { renderFontspec } from './designedStyleFragments';
import { getFontDiagnosticHeadline } from './fontDiagnosticMessage';
import { FONT_REGISTRY } from './fontResolver';
import { resolveExistingTemplateVaultPath } from './starterSetup';
import { getFontDiagnosticForFontKey } from '../utils/exportFormats';
import { getVaultFontDir, installBundledPandocFonts, setPandocFontPathsForVault } from '../utils/pandocBundledLayouts';

/** True when the spec's body font is one whose files ship inside the plugin. */
function usesIncludedFont(spec: DesignedStyleSpec): boolean {
    return spec.body.font !== 'custom' && Boolean(FONT_REGISTRY[spec.body.font]?.files.upright);
}

/** The complete .tex for a saved style, with fonts resolved for this vault. */
export function generateDesignedLayoutTex(layoutId: string, spec: DesignedStyleSpec): string {
    return generateDesignedStyleTex(spec, { bundledLayoutId: layoutId, vaultFontDir: getVaultFontDir() });
}

/**
 * Make the spec's body font usable, or throw with the missing-font message.
 *
 * A font that ships with the plugin is copied into the vault (the same copy
 * "Install fonts" in Settings → Publish performs). Any other font has to be
 * loadable already. This is the wizard's Save rule; the export pipeline
 * applies the same diagnostic before it runs Pandoc.
 */
export async function ensureSpecFontReady(plugin: RadialTimelinePlugin, spec: DesignedStyleSpec): Promise<void> {
    if (usesIncludedFont(spec)) {
        await installBundledPandocFonts(plugin);
        setPandocFontPathsForVault(plugin);
    }
    const diagnostic = getFontDiagnosticForFontKey(spec.body.font, undefined, spec.body.customFontName);
    if (diagnostic.state !== 'ok') throw new Error(getFontDiagnosticHeadline(diagnostic));
}

// The generator writes the font setup as one blank-line-delimited block that
// opens with this line (see renderFontspec).
const GENERATED_FONT_BLOCK = /\\defaultfontfeatures\{Ligatures=TeX\}\n[\s\S]*?(?=\n\n)/;

/**
 * Swap the generated font block in a saved style's .tex for a current one.
 * Returns null when the file has no such block (it was not written by the
 * generator, or was edited by hand), so the caller leaves the file alone.
 */
export function replaceGeneratedFontBlock(tex: string, fontBlock: string): string | null {
    if (!GENERATED_FONT_BLOCK.test(tex)) return null;
    return tex.replace(GENERATED_FONT_BLOCK, () => fontBlock);
}

/**
 * Before exporting with a saved style: make sure its included font is in the
 * vault and that the .tex points at where the vault is now.
 *
 * Only the font block is rewritten. Everything else in the file stays byte
 * for byte as it was saved, so a style keeps printing the way its author
 * last saw it.
 */
export async function refreshDesignedLayoutFontsForExport(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate
): Promise<void> {
    const spec = layout.origin === 'designed' && !layout.bundled ? layout.designedSpec : undefined;
    if (!spec || !usesIncludedFont(spec)) return;

    await installBundledPandocFonts(plugin);
    setPandocFontPathsForVault(plugin);

    const vaultPath = resolveExistingTemplateVaultPath(plugin, layout.path);
    const file = vaultPath ? plugin.app.vault.getAbstractFileByPath(vaultPath) : null;
    // A missing template is reported by the layout validation that follows.
    if (!(file instanceof TFile)) return;

    const onDisk = await plugin.app.vault.read(file);
    const refreshed = replaceGeneratedFontBlock(onDisk, renderFontspec(spec, { vaultFontDir: getVaultFontDir() }));
    if (refreshed !== null && refreshed !== onDisk) {
        await plugin.app.vault.modify(file, refreshed);
    }
}
