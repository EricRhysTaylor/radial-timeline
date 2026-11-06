import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { allocationMinutes, applySessionTimeAllocations, parseRecordedHours, readSessionTimeJournal } from './WritingSessionTimeAllocation';

function fixture() {
    const files = new Map([['Book/A.md', new TFile('Book/A.md')], ['Book/B.md', new TFile('Book/B.md')]]);
    const metadata = new Map<string, Record<string, unknown>>([['Book/A.md', { 'Total Time': 5.4, Synopsis: 'Keep' }], ['Book/B.md', { 'Total Time': 1 }]]);
    const store = new Map<string, string>();
    let failPath = '';
    const plugin = {
        manifest: { dir: '.obsidian/plugins/radial-timeline' }, settings: {}, isSceneFile: (path: string) => files.has(path),
        app: { vault: { adapter: { exists: async (p: string) => store.has(p), read: async (p: string) => store.get(p)!, write: async (p: string, v: string) => { store.set(p, v); } }, getAbstractFileByPath: (p: string) => files.get(p) },
            fileManager: { processFrontMatter: async (f: TFile, cb: (fm: Record<string, unknown>) => void) => { if (f.path === failPath) throw new Error('write failed'); cb(metadata.get(f.path)!); } } },
    };
    return { plugin: plugin as never, metadata, store, fail: (p: string) => { failPath = p; } };
}
const allocations = [{ path: 'Book/A.md', minutes: 30, words: 200, beforeHours: 5.4 }, { path: 'Book/B.md', minutes: 15, words: 50, beforeHours: 1 }];

describe('scene time allocation ledger', () => {
    it('adds the approved time once and preserves other properties on repeated saves', async () => {
        const f = fixture();
        await applySessionTimeAllocations(f.plugin, 'session-1', allocations);
        await applySessionTimeAllocations(f.plugin, 'session-1', allocations);
        expect(f.metadata.get('Book/A.md')).toEqual({ 'Total Time': 5.9, Synopsis: 'Keep' });
        expect(f.metadata.get('Book/B.md')?.['Total Time']).toBe(1.25);
    });
    it('resumes a partial failure without adding the first scene again', async () => {
        const f = fixture(); f.fail('Book/B.md');
        await expect(applySessionTimeAllocations(f.plugin, 'session-2', allocations)).rejects.toThrow('write failed');
        expect((await readSessionTimeJournal(f.plugin, 'session-2'))?.entries.map(e => e.applied)).toEqual([true, false]);
        f.fail(''); await applySessionTimeAllocations(f.plugin, 'session-2', allocations);
        expect(f.metadata.get('Book/A.md')?.['Total Time']).toBe(5.9);
        expect(f.metadata.get('Book/B.md')?.['Total Time']).toBe(1.25);
    });
    it('recognizes a scene written before its ledger checkpoint', async () => {
        const f = fixture();
        await applySessionTimeAllocations(f.plugin, 'session-crash', allocations);
        const key = '.obsidian/plugins/radial-timeline/session-time-session-crash.json';
        const journal = JSON.parse(f.store.get(key)!);
        journal.entries[0].applied = false;
        f.store.set(key, JSON.stringify(journal));
        await applySessionTimeAllocations(f.plugin, 'session-crash', allocations);
        expect(f.metadata.get('Book/A.md')?.['Total Time']).toBe(5.9);
        expect((await readSessionTimeJournal(f.plugin, 'session-crash'))?.entries[0].applied).toBe(true);
    });
    it('refuses a changed allocation on retry', async () => {
        const f = fixture(); f.fail('Book/B.md');
        await expect(applySessionTimeAllocations(f.plugin, 'session-retry', allocations)).rejects.toThrow();
        await expect(applySessionTimeAllocations(f.plugin, 'session-retry', [{ ...allocations[0], minutes: 60 }, allocations[1]])).rejects.toThrow('differs');
        expect(f.metadata.get('Book/A.md')?.['Total Time']).toBe(5.9);
    });
    it('retains the approved session summary after an interrupted scene update', async () => {
        const f = fixture(); f.fail('Book/B.md');
        const completion = { elapsedMinutes: 90, elapsedMs: 5400000, sessionDate: '2026-11-05', wordsAdded: 500, scenePaths: ['Book/A.md'], note: 'Keep this private note', postToFeed: false };
        await expect(applySessionTimeAllocations(f.plugin, 'session-summary', allocations, completion)).rejects.toThrow();
        expect((await readSessionTimeJournal(f.plugin, 'session-summary'))?.completion).toEqual(completion);
    });
    it('blocks a changed scene total and preserves it', async () => {
        const f = fixture(); f.metadata.get('Book/A.md')!['Total Time'] = 8;
        await expect(applySessionTimeAllocations(f.plugin, 'session-3', allocations)).rejects.toThrow('changed');
        expect(f.metadata.get('Book/A.md')?.['Total Time']).toBe(8);
    });
    it('lets a retry of fractional minutes match its ledger', async () => {
        const f = fixture(); f.fail('Book/B.md');
        const fractional = [{ ...allocations[0], minutes: 90000 / 60000 }, allocations[1]];
        await expect(applySessionTimeAllocations(f.plugin, 'session-fraction', fractional)).rejects.toThrow('write failed');
        f.fail('');
        const journal = await readSessionTimeJournal(f.plugin, 'session-fraction');
        // The save dialog reopens from the ledger and submits what it shows.
        const retried = journal!.entries.map(entry => {
            const activeMs = Math.round(allocationMinutes(entry.minutes * 60000, true) * 60000);
            return { path: entry.path, minutes: activeMs / 60000, words: entry.words, beforeHours: entry.beforeHours };
        });
        await applySessionTimeAllocations(f.plugin, 'session-fraction', retried);
        expect(f.metadata.get('Book/A.md')?.['Total Time']).toBe(5.425);
        expect(f.metadata.get('Book/B.md')?.['Total Time']).toBe(1.25);
        expect(allocationMinutes(90000, false)).toBe(2);
    });
    it('saves words for a scene whose Total Time cannot be read', async () => {
        const f = fixture(); f.metadata.get('Book/B.md')!['Total Time'] = 'three hours';
        await applySessionTimeAllocations(f.plugin, 'session-words', [allocations[0], { path: 'Book/B.md', minutes: 0, words: 50, beforeHours: NaN }]);
        expect(f.metadata.get('Book/A.md')?.['Total Time']).toBe(5.9);
        expect(f.metadata.get('Book/B.md')?.['Total Time']).toBe('three hours');
    });
    it('rejects an existing nonnumeric value instead of replacing it', () => {
        expect(() => parseRecordedHours('three hours')).toThrow();
    });
});
