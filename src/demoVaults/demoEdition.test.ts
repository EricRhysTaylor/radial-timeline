import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { BONUS_VAULTS, type BonusVaultDef } from '../settings/bonusVaults';
import {
    DEMO_EDITION_PATH,
    findDemoByBookFolder,
    isDemoEdition,
    isNewerDemoEdition,
    parseDemoEditionStamp,
    readDemoEditionStamp,
    getDemoEditionStatus,
    renderDemoEditionStatus
} from './demoEdition';

const stamp = (edition: unknown, schemaVersion: unknown = 1) =>
    JSON.stringify({ schemaVersion, sampleId: 'pride-and-prejudice', edition });

/** A vault holding only the files given, for the two calls the stamp reader makes. */
const vaultWith = (files: Map<string, string>) => ({
    vault: {
        getFileByPath: (path: string) => files.has(path) ? { path } : null,
        cachedRead: async (file: { path: string }) => files.get(file.path)!
    }
} as unknown as App); // SAFE: minimal vault stub

describe('demo edition comparison', () => {
    it('offers the catalog edition to a vault with no stamp', () => {
        expect(isNewerDemoEdition('2026-10-30', null)).toBe(true);
    });

    it('offers the catalog edition only when it is newer than the stamp', () => {
        expect(isNewerDemoEdition('2026-10-30', '2026-10-03')).toBe(true);
        expect(isNewerDemoEdition('2026-10-30', '2026-10-30')).toBe(false);
        expect(isNewerDemoEdition('2026-10-30', '2027-01-15')).toBe(false);
        expect(isNewerDemoEdition('2027-01-02', '2026-12-31')).toBe(true);
    });

    it('orders a same-day revision after the first edition of that day', () => {
        expect(isNewerDemoEdition('2026-10-30.2', '2026-10-30')).toBe(true);
        expect(isNewerDemoEdition('2026-10-30.10', '2026-10-30.9')).toBe(true);
        expect(isNewerDemoEdition('2026-10-30', '2026-10-30.2')).toBe(false);
        expect(isNewerDemoEdition('2026-10-31', '2026-10-30.2')).toBe(true);
        expect(isNewerDemoEdition('2026-10-30.2', null)).toBe(true);
    });

    it('stays quiet when the catalog archive carries no edition', () => {
        expect(isNewerDemoEdition(undefined, null)).toBe(false);
        expect(isNewerDemoEdition(undefined, '2026-10-30')).toBe(false);
    });
});

describe('demo edition stamp', () => {
    it('reads the edition date from a valid stamp', () => {
        expect(parseDemoEditionStamp(stamp('2026-10-30'))).toBe('2026-10-30');
        expect(parseDemoEditionStamp(stamp('2026-10-30.2'))).toBe('2026-10-30.2');
    });

    it('treats a malformed or unknown stamp as no stamp', () => {
        for (const raw of ['', 'not json', 'null', '[]', stamp('October 30'), stamp('2026-10-30', 2), stamp(20261030),
            stamp('2026-10-30.1'), stamp('2026-10-30.02'), stamp('2026-10-30.')]) {
            expect(parseDemoEditionStamp(raw)).toBeNull();
        }
    });

    it('reads the stamp from the packaged vault root and finds none when it is absent', async () => {
        const files = new Map([[DEMO_EDITION_PATH, stamp('2026-10-30')]]);
        const app = vaultWith(files);
        expect(DEMO_EDITION_PATH).toBe('Radial Timeline/Demo/edition.json');
        expect(await readDemoEditionStamp(app)).toBe('2026-10-30');
        files.clear();
        expect(await readDemoEditionStamp(app)).toBeNull();
    });
});

describe('detected demo identity', () => {
    const demos: BonusVaultDef[] = [
        { id: 'single', title: 'Single', author: 'A', countLabel: '', status: 'available', books: [{ title: 'Single', sourceFolder: 'Single' }] },
        { id: 'collection', title: 'Collection', author: 'B', countLabel: '', status: 'available', books: [
            { title: 'One', sourceFolder: '01 One' }, { title: 'Two', sourceFolder: '02 Two' }
        ] },
        { id: 'soon', title: 'Soon', author: 'C', countLabel: '', status: 'coming-soon' }
    ];

    it('matches the packaged book folder to its catalog demo', () => {
        expect(findDemoByBookFolder(demos, 'Single')?.id).toBe('single');
        expect(findDemoByBookFolder(demos, '01 One')?.id).toBe('collection');
        expect(findDemoByBookFolder(demos, ' 02 Two ')?.id).toBe('collection');
    });

    it('finds no demo for an unknown or missing folder', () => {
        expect(findDemoByBookFolder(demos, 'My Novel')).toBeUndefined();
        expect(findDemoByBookFolder(demos, '')).toBeUndefined();
        expect(findDemoByBookFolder(demos, undefined)).toBeUndefined();
    });

    it('identifies each published demo by the folder its own vault opens at', () => {
        for (const demo of BONUS_VAULTS.filter(entry => entry.books?.length)) {
            expect(findDemoByBookFolder(BONUS_VAULTS, demo.books![0].sourceFolder)).toBe(demo);
        }
    });
});

describe('newer edition offer', () => {
    const archive = { url: 'https://example.com/a/2026-10-30/a.zip', downloadUrl: 'https://example.com/go/a', sha256: 'h', bytes: 1, root: 'A' };
    const demos: BonusVaultDef[] = [
        { id: 'a', title: 'A', author: 'X', countLabel: '', status: 'available', books: [{ title: 'A', sourceFolder: 'A' }], archive: { ...archive, edition: '2026-10-30' } },
        { id: 'b', title: 'B', author: 'Y', countLabel: '', status: 'available', books: [{ title: 'B', sourceFolder: 'B' }], archive }
    ];

    it('distinguishes unknown, older, current and newer installed editions', async () => {
        const edition = (value: string, sampleId = 'a') => JSON.stringify({ schemaVersion: 1, sampleId, edition: value });
        const status = (value?: string) => getDemoEditionStatus(vaultWith(new Map(value ? [[DEMO_EDITION_PATH, value]] : [])), demos, 'A');
        expect((await status())?.state).toBe('unknown');
        expect((await status(edition('2026-10-29')))?.state).toBe('update');
        expect((await status(edition('2026-10-30')))?.state).toBe('current');
        expect((await status(edition('2026-10-30.2')))?.state).toBe('ahead');
        expect((await status(edition('2026-10-30', 'b')))?.state).toBe('unknown');
        expect(await getDemoEditionStatus(vaultWith(new Map()), demos, 'Demo Projects/A/A')).toBeNull();
    });

    it('offers a separate download without touching the installed edition', async () => {
        const demo = demos[0];
        const status = await getDemoEditionStatus(vaultWith(new Map()), demos, 'A');
        const lines: string[] = [];
        const links: Array<{ href: string; text: string }> = [];
        const line = {
            createDiv: ({ text }: { text: string }) => { lines.push(text); },
            createEl: (_tag: string, info: { href: string; text: string }) => { links.push(info); return {}; }
        };
        const parent = { createDiv: () => line };
        const plugin = { registerDomEvent: vi.fn() };
        renderDemoEditionStatus(parent as unknown as HTMLElement, plugin as unknown as RadialTimelinePlugin, status!, { line: 'test' }); // SAFE: minimal DOM and plugin stubs
        expect(lines).toContain('Your edition: Unknown · Available: 2026-10-30');
        expect(lines).toContain('Opens as a separate vault; your current copy stays intact.');
        expect(links[0]).toMatchObject({ text: 'Download available edition ↗', href: demo.archive!.downloadUrl });
    });

});

describe('catalog editions', () => {
    it('dates each stamped archive by its dated object path', () => {
        for (const demo of BONUS_VAULTS) {
            const edition = demo.archive?.edition;
            if (edition === undefined) continue;
            expect(isDemoEdition(edition)).toBe(true);
            expect(demo.archive!.url).toContain(`/${demo.id}/${edition}/`);
        }
    });
});

// Opt-in, like the published-edition import test: point at a folder of <id>.zip downloads.
const archiveDirectory = process.env.RT_DEMO_ARCHIVE_DIRECTORY;
describe.skipIf(!archiveDirectory)('published demo edition stamps', () => {
    it.each(BONUS_VAULTS.filter(demo => demo.archive?.edition))('$title carries the catalog edition', demo => {
        const archive = demo.archive!;
        const entry = `${archive.root}/${DEMO_EDITION_PATH}`;
        const files = unzipSync(new Uint8Array(readFileSync(`${archiveDirectory}/${demo.id}.zip`)), { filter: file => file.name === entry });
        expect(parseDemoEditionStamp(strFromU8(files[entry]))).toBe(archive.edition);
    });
});
