import type RadialTimelinePlugin from '../main';
import { PRIDE_AND_PREJUDICE_THUMB } from '../branding/bonusVaultThumbs';

/**
 * Bonus ("Website Exclusive") vaults surfaced in the Pro settings tab.
 *
 * These are sample/demo novels that mirror the marketing site's "Featured
 * vaults" grid. An `available` vault renders vibrant with its own artwork; a
 * `coming-soon` vault renders muted behind an incognito glyph placeholder.
 *
 * Delivery model (decided): hybrid — activating a vault downloads a zip from
 * Supabase Storage, unpacks it to a user-chosen folder, and opens it as a
 * standalone Obsidian vault by default, with an advanced "install into a
 * subfolder of the current vault" option. The download/unpack pipeline is not
 * built yet; `downloadPath` is the eventual Supabase object key and is left
 * undefined until hosting is wired.
 */
export type BonusVaultStatus = 'available' | 'coming-soon';

export interface BonusVaultDef {
    /** Stable id, also used as the install-tracking key in settings. */
    id: string;
    /** Display title, e.g. "Pride & Prejudice". */
    title: string;
    /** Author surname shown in the meta line, e.g. "Austen". */
    author: string;
    /** Unit-count label shown after the author, e.g. "61 scenes". */
    countLabel: string;
    /** Visual/availability state. */
    status: BonusVaultStatus;
    /** Inlined data-URL thumbnail (available vaults only). */
    thumb?: string;
    /** Eventual Supabase Storage object key for the downloadable zip. */
    downloadPath?: string;
    /** Rough download size shown on the action row, e.g. "8 MB". */
    approxSizeLabel?: string;
}

export const BONUS_VAULTS: readonly BonusVaultDef[] = [
    {
        id: 'pride-and-prejudice',
        title: 'Pride & Prejudice',
        author: 'Austen',
        countLabel: '61 scenes',
        status: 'available',
        thumb: PRIDE_AND_PREJUDICE_THUMB
    },
    {
        id: 'sherlock-holmes',
        title: 'Sherlock Holmes',
        author: 'Doyle',
        countLabel: '56 stories',
        status: 'coming-soon'
    }
];

/** True when the user has activated/installed the given bonus vault. */
export function isBonusVaultInstalled(plugin: RadialTimelinePlugin, id: string): boolean {
    return Array.isArray(plugin.settings.installedBonusVaults)
        && plugin.settings.installedBonusVaults.includes(id);
}

