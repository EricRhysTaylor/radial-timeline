import type { App } from 'obsidian';
import type { BonusVaultDef } from '../settings/bonusVaults';
import { systemFolderPath } from '../utils/systemFolder';

/**
 * Every packaged demo ZIP from scripts/demo-vaults/package_sample_vault.py
 * carries its edition in this file. It is packaging metadata: the plugin only
 * reads it, and scene YAML never carries it.
 */
export const DEMO_EDITION_PATH = systemFolderPath('Demo', 'edition.json');
export const DEMO_EDITION_SCHEMA_VERSION = 1;

// The release date, plus `.N` (N ≥ 2) for a second edition released the same day.
const EDITION = /^(\d{4}-\d{2}-\d{2})(?:\.([2-9]|[1-9]\d+))?$/;

/** True for an edition such as `2026-10-30` or a same-day revision `2026-10-30.2`. */
export const isDemoEdition = (value: unknown): value is string =>
    typeof value === 'string' && EDITION.test(value);

/** Release date and same-day revision; ISO dates compare correctly as strings. */
const editionOrder = (edition: string): [string, number] => {
    const match = EDITION.exec(edition);
    if (!match) throw new Error(`Invalid demo edition: ${edition}`);
    return [match[1], match[2] ? Number(match[2]) : 1];
};

/** The edition date in a stamp file, or null when the file is not a valid stamp. */
export function parseDemoEditionStamp(raw: string): string | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch { // SAFE: an unreadable stamp is no stamp; the caller treats the vault as an older edition
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const stamp = parsed as { schemaVersion?: unknown; edition?: unknown };
    return stamp.schemaVersion === DEMO_EDITION_SCHEMA_VERSION && isDemoEdition(stamp.edition) ? stamp.edition : null;
}

/** Reads the edition stamp of a packaged demo opened as its own vault. */
export async function readDemoEditionStamp(app: App): Promise<string | null> {
    const file = app.vault.getFileByPath(DEMO_EDITION_PATH);
    return file ? parseDemoEditionStamp(await app.vault.cachedRead(file)) : null;
}

/**
 * True when the catalog's edition is newer than the vault's. Editions before
 * stamping carry no stamp, so a vault without one counts as older. An archive
 * without a catalog edition has nothing to compare against.
 */
export function isNewerDemoEdition(catalogEdition: string | undefined, vaultEdition: string | null): boolean {
    if (!catalogEdition) return false;
    if (vaultEdition === null) return true;
    const [catalogDate, catalogRevision] = editionOrder(catalogEdition);
    const [vaultDate, vaultRevision] = editionOrder(vaultEdition);
    return catalogDate > vaultDate || (catalogDate === vaultDate && catalogRevision > vaultRevision);
}

/** The catalog demo that ships this book folder, matched exactly as the packaged vault names it. */
export function findDemoByBookFolder(demos: readonly BonusVaultDef[], bookFolder: string | undefined): BonusVaultDef | undefined {
    const folder = bookFolder?.trim();
    if (!folder) return undefined;
    return demos.find(demo => demo.books?.some(book => book.sourceFolder === folder));
}
