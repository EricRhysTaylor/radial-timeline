import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import { readRecentExportDeliveries } from './exportHistory';
import type { ExportDeliveryReceipt } from './exportDelivery';

vi.mock('../utils/aiOutput', () => ({ resolveExportOutputFolder: () => 'Out' }));

function fixture() {
    const records = new Map<string, string>();
    const plugin = {
        settings: { manuscriptOutputFolder: 'Out' },
        app: { vault: { adapter: {
            exists: async (path: string) => [...records.keys()].some(p => p === path || p.startsWith(`${path}/`)),
            list: async (path: string) => {
                const paths = [...records.keys()].filter(p => p.startsWith(`${path}/`));
                return { files: paths.filter(p => !p.slice(path.length + 1).includes('/')),
                    folders: [...new Set(paths.filter(p => p.slice(path.length + 1).includes('/')).map(p => `${path}/${p.slice(path.length + 1).split('/')[0]}`))] };
            },
            read: async (path: string) => { if (!records.has(path)) throw new Error('Record missing'); return records.get(path); },
        } } },
    } as unknown as RadialTimelinePlugin;
    const add = (root: string, n: number) => {
        const receipt: ExportDeliveryReceipt = {
            schemaVersion: 1, createdAt: `2026-10-13T12:00:${String(n).padStart(2, '0')}Z`, checkedAt: '2026-10-13T12:01:00Z',
            receiptPath: `${root}/Receipts/${n}.json`, destination: root, outputFolder: root, format: 'markdown',
            expectedFiles: 1, expectedWorkingFiles: 0, sourceTitle: `Export ${n}`, sourcePaths: ['Draft/One.md'],
            files: [{ path: `${root}/${n}.md`, primary: true, available: true, bytes: 10 }], problems: [],
        };
        records.set(receipt.receiptPath, JSON.stringify(receipt)); return receipt;
    };
    return { plugin, records, add };
}

describe('recent export history', () => {
    it('discovers legacy receipts without an index and returns the five newest exports', async () => {
        const { plugin, add } = fixture();
        for (let n = 1; n <= 7; n++) add('Out', n);
        const history = await readRecentExportDeliveries(plugin);
        expect(history.receipts.map(r => r.sourceTitle)).toEqual(['Export 7', 'Export 6', 'Export 5', 'Export 4', 'Export 3']);
        expect(history.problems).toEqual([]);
    });
    it('combines destination, split-output, last export and cross-destination indexed records without duplicates', async () => {
        const { plugin, add } = fixture();
        const current = add('Out', 1), split = add('Out/Parts', 2), prior = add('Other', 3), indexed = add('Elsewhere', 4);
        plugin.settings.lastExportDeliveryReceiptPath = prior.receiptPath;
        plugin.settings.recentExportDeliveryReceiptPaths = [indexed.receiptPath, current.receiptPath, split.receiptPath];
        const history = await readRecentExportDeliveries(plugin);
        expect(history.receipts.map(r => r.sourceTitle)).toEqual(['Export 4', 'Export 3', 'Export 2', 'Export 1']);
        expect(history.problems).toEqual([]);
    });
    it('keeps configured-folder history when the next export uses another destination', async () => {
        const { plugin, add } = fixture(); add('Out', 1); add('Another', 2);
        const history = await readRecentExportDeliveries(plugin, 'Another');
        expect(history.receipts.map(r => r.sourceTitle)).toEqual(['Export 2', 'Export 1']);
    });
    it('surfaces malformed and missing records while retaining other available jobs', async () => {
        const { plugin, records, add } = fixture();
        add('Out', 1); records.set('Out/Receipts/broken.json', '{broken');
        plugin.settings.recentExportDeliveryReceiptPaths = ['Missing/Receipts/gone.json'];
        const history = await readRecentExportDeliveries(plugin);
        expect(history.receipts).toHaveLength(1);
        expect(history.problems).toHaveLength(2);
        expect(history.problems.join(' ')).toContain('Record missing');
    });
    it('rejects traversal paths without reading outside the vault', async () => {
        const { plugin } = fixture();
        plugin.settings.recentExportDeliveryReceiptPaths = ['../outside.json'];
        const history = await readRecentExportDeliveries(plugin, '../outside');
        expect(history.receipts).toEqual([]);
        expect(history.problems).toHaveLength(2);
    });
});
