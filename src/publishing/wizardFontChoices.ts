/*
 * Which body fonts the PDF design wizard offers.
 *
 * A style can only be saved with a font this machine can print with, so the
 * picker lists three kinds and nothing else:
 *
 *   'included' — the font files ship inside the plugin. Saving a style that
 *                uses one copies them into the vault's Pandoc font folder.
 *   'latex'    — the font comes with every LaTeX installation, which PDF
 *                export needs anyway.
 *   'computer' — a font from FONT_REGISTRY that has to be installed on this
 *                computer. Offered only when XeLaTeX can load it right now.
 *
 * There is no download path. FONT_REGISTRY stays the single list of fonts:
 * adding a row there adds it here.
 */
import type { DesignedStyleSpec } from './designedStyle';
import { FONT_REGISTRY } from './fontResolver';

export type WizardFontKey = Exclude<DesignedStyleSpec['body']['font'], 'custom'>;
export type WizardFontSource = 'included' | 'latex' | 'computer';

export interface WizardFontChoice {
    key: WizardFontKey;
    label: string;
    source: WizardFontSource;
    /** False only for a 'computer' font this machine cannot load. */
    found: boolean;
}

export function getWizardFontSource(key: WizardFontKey): WizardFontSource {
    const files = FONT_REGISTRY[key].files;
    if (files.upright) return 'included';
    if (files.texUpright) return 'latex';
    return 'computer';
}

/**
 * Every registry font with where it comes from and whether it can be used.
 * `isFoundOnComputer` answers for the 'computer' kind only; the wizard and
 * the compile test both pass the export pipeline's own font check, so the
 * picker, the Save rule and the test agree on what "found" means.
 */
export function listWizardFontChoices(isFoundOnComputer: (key: WizardFontKey) => boolean): WizardFontChoice[] {
    return (Object.keys(FONT_REGISTRY) as WizardFontKey[]).map((key) => {
        const source = getWizardFontSource(key);
        return {
            key,
            label: FONT_REGISTRY[key].displayName,
            source,
            found: source !== 'computer' || isFoundOnComputer(key),
        };
    });
}
