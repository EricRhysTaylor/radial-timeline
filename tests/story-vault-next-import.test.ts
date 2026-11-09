import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';
import { BONUS_VAULTS } from '../src/settings/bonusVaults';
import { demoBookDefinitions, demoProjectFolder, prepareDemoImport } from '../src/demoVaults/demoImportPlan';
import { matchesBookTimetable, tableFileStem } from '../src/timetable/timetableFiles';
import { parseYaml } from 'obsidian';

const root = process.env.RT_NEXT_STORY_VAULTS;
describe.skipIf(!root)('next Story Vault candidates imported into an existing vault', () => {
    it.each(['odyssey', 'sherlock-holmes'])('%s keeps all book maps and Timetables inside the imported project', async id => {
        const candidate = id === 'sherlock-holmes' ? 'sherlock' : id;
        const bytes = new Uint8Array(readFileSync(`${root}/${candidate}-candidate/${id}-demo-vault.zip`));
        const catalog = BONUS_VAULTS.find(entry => entry.id === id)!;
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
        const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
        const demo = { ...catalog, archive: { ...catalog.archive!, sha256: hash, bytes: bytes.length } };
        const books = demoBookDefinitions(demo);
        const plan = await prepareDemoImport(bytes, demo, new Map(books.map((book, index) => [book.sourceFolder, index + 1])));
        for (const book of books) {
            const stem = tableFileStem(book.title);
            const base = plan.files.get(`Radial Timeline/Timetables/${stem}.base`);
            const canvas = plan.files.get(`Radial Timeline/Story Maps/${stem} - Subplot Map.canvas`);
            expect(base).toBeDefined(); expect(canvas).toBeDefined();
            expect(matchesBookTimetable(parseYaml(strFromU8(base!)), book.sourceFolder)).toBe(true);
            const nodes = JSON.parse(strFromU8(canvas!)).nodes as Array<{ type: string; file?: string }>;
            const cards = nodes.filter(node => node.type === 'file');
            expect(cards.length).toBeGreaterThan(0);
            for (const card of cards) {
                expect(card.file!.startsWith(`${book.sourceFolder}/`)).toBe(true);
                expect(plan.files.has(card.file!.slice(demoProjectFolder(demo).length + 1))).toBe(true);
            }
        }
    });
});
