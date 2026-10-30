import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BonusVaultDef, DemoArchive } from '../settings/bonusVaults';
import { t } from '../i18n';
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

export type PublishedDemo = BonusVaultDef & { archive: DemoArchive };

const isPublished = (demo: BonusVaultDef | undefined): demo is PublishedDemo => !!demo?.archive;

/**
 * The catalog demo to offer when this vault holds an older edition of it. The
 * demo is matched by book folder; the vault's stamp is compared with the
 * catalog edition bundled in this plugin release, so nothing is requested.
 */
export async function findNewerDemoEdition(
    app: App,
    demos: readonly BonusVaultDef[],
    bookFolder: string | undefined
): Promise<PublishedDemo | null> {
    const demo = findDemoByBookFolder(demos, bookFolder);
    if (!isPublished(demo) || !isNewerDemoEdition(demo.archive.edition, await readDemoEditionStamp(app))) return null;
    return demo;
}

/**
 * One quiet line offering the newer edition through the demo's counted
 * download. It arrives as its own vault, so the reader's files stay as they
 * are. A click on the link stays with the link, for lines inside a clickable card.
 */
export function renderNewerEditionLine(
    parent: HTMLElement,
    plugin: RadialTimelinePlugin,
    demo: PublishedDemo,
    cls: { line: string; link?: string }
): HTMLElement {
    const line = parent.createDiv({ cls: cls.line });
    // [Bracketed] text is the link, so each translation keeps one sentence.
    t('ui.bonusVaults.newerEdition', { title: demo.title }).split(/\[([^\]]+)\]/).forEach((part, index) => {
        if (index % 2 === 0) {
            if (part) line.appendText(part);
            return;
        }
        const link = line.createEl('a', {
            cls: cls.link,
            text: part,
            href: demo.archive.downloadUrl,
            attr: { target: '_blank', rel: 'noopener noreferrer' }
        });
        plugin.registerDomEvent(link, 'click', (evt) => evt.stopPropagation());
    });
    return line;
}
